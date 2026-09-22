import { projectDatedNetConsumption } from '@shikin/finance-core'
import { readDatedAmounts } from './dated-read.js'
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
  const projection = projectDatedNetConsumption({
    evidence,
    start,
    end,
    conversion,
    coverageComplete,
  })
  const { native: nativeProjection, ...datedProjection } = projection
  void nativeProjection
  const mainConversion = {
    ...datedProjection,
    conversion,
    uncoveredAccountIds,
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
