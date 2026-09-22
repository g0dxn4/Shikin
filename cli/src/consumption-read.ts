import { apportionConvertedAmount } from '@shikin/finance-core/fx'
import { readDatedAmounts, sumCentavos } from './dated-read.js'
import {
  consumptionCoverage,
  netConsumption,
  validateConsumptionClassification,
  owningAllocation,
} from '@shikin/finance-core/corrections'
import { readConsumptionEvidence } from './transaction-corrections.js'
import { query } from './database.js'

/** Explicit coverage only; transaction dates cannot prove statement coverage. */
export function readNetConsumption(start: string, end: string) {
  const evidence = readConsumptionEvidence()
  const result = netConsumption(evidence, start, end)
  const accounts = query<{ id: string }>(
    "SELECT id FROM accounts WHERE COALESCE(account_mode, 'transactional') = 'transactional'"
  )
  const coverage = query<{
    account_id: string
    source_namespace: string
    period_start: string
    period_end: string
    status: string
  }>('SELECT * FROM source_coverage')
  const { coverageComplete, uncoveredAccountIds } = consumptionCoverage(
    accounts.map((account) => account.id),
    coverage,
    start,
    end
  )
  // Reuse the core's explicit classification/reference validation, never infer roles.
  const recognized = evidence.classifications.flatMap((item) => {
    try {
      validateConsumptionClassification(item, evidence)
      const owner = owningAllocation(item, evidence)
      if (
        !owner.row.date ||
        owner.row.date < start ||
        owner.row.date > end ||
        result.unresolvedIds.includes(item.split_id ?? item.transaction_id)
      )
        return []
      const purchase =
        item.role === 'refund'
          ? evidence.classifications.find((entry) => entry.id === item.referenced_purchase_id)!
          : null
      return [
        {
          item,
          owner,
          categoryId: purchase ? owningAllocation(purchase, evidence).categoryId : owner.categoryId,
        },
      ]
    } catch {
      return []
    }
  })
  const parentIds = new Set(recognized.map(({ owner }) => owner.row.id))
  const parents = evidence.transactions.filter((row) => parentIds.has(row.id))
  const conversion = readDatedAmounts(
    parents.map((row) => ({
      id: row.id,
      amountCentavos: row.amount,
      currency: row.currency!.trim().toUpperCase(),
      date: row.date!,
    }))
  )
  const amounts = new Map<string, number>()
  for (const parent of parents) {
    const converted = conversion.converted.find((row) => row.id === parent.id)
    if (!converted?.complete) continue
    const splits = evidence.splits.filter((row) => row.transaction_id === parent.id)
    for (const allocation of apportionConvertedAmount(
      converted.amountCentavos,
      splits.length
        ? splits.map((row) => ({ id: row.id, amountCentavos: row.amount }))
        : [{ id: parent.id, amountCentavos: parent.amount }],
      parent.amount
    ))
      amounts.set(JSON.stringify([parent.id, allocation.id]), allocation.amountCentavos)
  }
  const allocations = recognized.map(({ item, owner, categoryId }) => {
    const amount =
      amounts.get(JSON.stringify([item.transaction_id, item.split_id ?? item.transaction_id])) ??
      null
    const sign = item.role === 'refund' ? -1 : ['purchase', 'fee'].includes(item.role) ? 1 : 0
    return {
      classificationId: item.id,
      transactionId: item.transaction_id,
      allocationId: item.split_id ?? item.transaction_id,
      role: item.role,
      referencedPurchaseId: item.referenced_purchase_id,
      categoryId,
      date: owner.row.date!,
      currency: owner.currency,
      nativeAmountCentavos: owner.amount,
      amountCentavos: amount,
      consumptionCentavos: amount === null ? null : amount * sign,
      earnedIncomeCentavos: amount === null ? null : item.role === 'earned_income' ? amount : 0,
    }
  })
  const mainComplete = conversion.complete && result.classificationComplete && coverageComplete
  const knownConsumption =
    conversion.toCurrency === null
      ? null
      : sumCentavos(allocations.map((row) => row.consumptionCentavos ?? 0))
  const knownIncome =
    conversion.toCurrency === null
      ? null
      : sumCentavos(allocations.map((row) => row.earnedIncomeCentavos ?? 0))
  const mainConversion = {
    complete: mainComplete,
    toCurrency: conversion.toCurrency,
    reason: conversion.reason,
    policy: 'recognition_transaction_date_parent_then_allocation' as const,
    consumptionCentavos: mainComplete ? knownConsumption : null,
    earnedIncomeCentavos: mainComplete ? knownIncome : null,
    knownConsumptionCentavos: knownConsumption,
    knownEarnedIncomeCentavos: knownIncome,
    conversion,
    allocations,
    classificationComplete: result.classificationComplete,
    coverageComplete,
    unresolvedClassificationIds: result.unresolvedIds,
    uncoveredAccountIds,
    byCategory: [...new Set(allocations.map((row) => row.categoryId))].map((categoryId) => {
      const rows = allocations.filter((row) => row.categoryId === categoryId)
      const known =
        conversion.toCurrency === null
          ? null
          : sumCentavos(rows.map((row) => row.consumptionCentavos ?? 0))
      return { categoryId, amountCentavos: mainComplete ? known : null, knownAmountCentavos: known }
    }),
  }
  return {
    success: true,
    mainConversion,
    ...result,
    complete: result.classificationComplete && coverageComplete,
    coverageComplete,
    uncoveredAccountIds,
    period: { start, end },
    currencyScope: 'all' as const,
    message:
      coverageComplete && result.classificationComplete
        ? 'Explicit net consumption, native currencies; no FX conversion.'
        : 'Known net consumption subtotals only. Classification or independently verified source coverage is incomplete.',
  }
}
