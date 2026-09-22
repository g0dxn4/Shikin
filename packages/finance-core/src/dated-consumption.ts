import { classificationContribution, type ConsumptionRole } from './classification-policy.js'
import {
  netConsumption,
  owningAllocation,
  validateConsumptionClassification,
  type ConsumptionEvidence,
} from './corrections.js'
import { apportionConvertedAmount } from './fx.js'

export interface DatedConsumptionConversion {
  complete: boolean
  toCurrency: string | null
  reason: string | null
  converted: readonly { id: string; complete: boolean; amountCentavos: number | null }[]
}

export interface DatedConsumptionAllocation {
  classificationId: string
  transactionId: string
  allocationId: string
  role: ConsumptionRole
  referencedPurchaseId: string | null
  categoryId: string | null
  date: string
  currency: string
  nativeAmountCentavos: number
  amountCentavos: number | null
  consumptionCentavos: number | null
  earnedIncomeCentavos: number | null
  otherIncomeCentavos: number | null
  principalRecoveryCentavos: number | null
  assetAcquisitionCentavos: number | null
}

function sum(amounts: readonly number[]): number {
  const total = amounts.reduce((result, amount) => {
    if (!Number.isSafeInteger(amount)) throw new Error('Unsafe centavo subtotal.')
    return result + BigInt(amount)
  }, 0n)
  const value = Number(total)
  if (!Number.isSafeInteger(value)) throw new Error('Unsafe centavo subtotal.')
  return value
}

/** Shared dated projection. Conversion occurs per parent, then is apportioned, then policy contributes. */
export function projectDatedNetConsumption(input: {
  evidence: ConsumptionEvidence
  start: string
  end: string
  conversion: DatedConsumptionConversion
  coverageComplete: boolean
}) {
  const native = netConsumption(input.evidence, input.start, input.end)
  const recognized = input.evidence.classifications.flatMap((item) => {
    try {
      validateConsumptionClassification(item, input.evidence)
      const owner = owningAllocation(item, input.evidence)
      if (
        !owner.row.date ||
        owner.row.date < input.start ||
        owner.row.date > input.end ||
        native.unresolvedIds.includes(item.split_id ?? item.transaction_id)
      )
        return []
      const purchase =
        item.role === 'refund'
          ? input.evidence.classifications.find(
              (entry) => entry.id === item.referenced_purchase_id
            )!
          : null
      return [
        {
          item,
          owner,
          categoryId: purchase
            ? owningAllocation(purchase, input.evidence).categoryId
            : owner.categoryId,
        },
      ]
    } catch {
      return []
    }
  })
  const amounts = new Map<string, number>()
  for (const parentId of new Set(recognized.map(({ owner }) => owner.row.id))) {
    const parent = input.evidence.transactions.find((row) => row.id === parentId)!
    const converted = input.conversion.converted.find((row) => row.id === parentId)
    if (!converted?.complete || converted.amountCentavos === null) continue
    const splits = input.evidence.splits.filter((row) => row.transaction_id === parentId)
    for (const allocation of apportionConvertedAmount(
      converted.amountCentavos,
      splits.length
        ? splits.map((row) => ({ id: row.id, amountCentavos: row.amount }))
        : [{ id: parentId, amountCentavos: parent.amount }],
      parent.amount
    ))
      amounts.set(JSON.stringify([parentId, allocation.id]), allocation.amountCentavos)
  }
  const allocations: DatedConsumptionAllocation[] = recognized.map(
    ({ item, owner, categoryId }) => {
      const amount =
        amounts.get(JSON.stringify([item.transaction_id, item.split_id ?? item.transaction_id])) ??
        null
      const contribution =
        amount === null
          ? {
              consumptionCentavos: null,
              earnedIncomeCentavos: null,
              otherIncomeCentavos: null,
              principalRecoveryCentavos: null,
              assetAcquisitionCentavos: null,
            }
          : classificationContribution(item.role, amount)
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
        ...contribution,
      }
    }
  )
  const fields = [
    'consumptionCentavos',
    'earnedIncomeCentavos',
    'otherIncomeCentavos',
    'principalRecoveryCentavos',
    'assetAcquisitionCentavos',
  ] as const
  const known = Object.fromEntries(
    fields.map((field) => [
      field,
      input.conversion.toCurrency === null
        ? null
        : sum(allocations.flatMap((row) => (row[field] === null ? [] : [row[field]]))),
    ])
  ) as Record<(typeof fields)[number], number | null>
  const complete =
    input.conversion.complete && native.classificationComplete && input.coverageComplete
  const byCategory = [...new Set(allocations.map((row) => row.categoryId))].map((categoryId) => {
    const value =
      input.conversion.toCurrency === null
        ? null
        : sum(
            allocations
              .filter((row) => row.categoryId === categoryId)
              .flatMap((row) => (row.consumptionCentavos === null ? [] : [row.consumptionCentavos]))
          )
    return {
      categoryId,
      amountCentavos: complete ? value : null,
      knownAmountCentavos: value,
    }
  })
  return {
    native,
    allocations,
    complete,
    toCurrency: input.conversion.toCurrency,
    reason: input.conversion.reason,
    policy: 'recognition_transaction_date_parent_then_allocation' as const,
    consumptionCentavos: complete ? known.consumptionCentavos : null,
    earnedIncomeCentavos: complete ? known.earnedIncomeCentavos : null,
    otherIncomeCentavos: complete ? known.otherIncomeCentavos : null,
    principalRecoveryCentavos: complete ? known.principalRecoveryCentavos : null,
    assetAcquisitionCentavos: complete ? known.assetAcquisitionCentavos : null,
    knownConsumptionCentavos: known.consumptionCentavos,
    knownEarnedIncomeCentavos: known.earnedIncomeCentavos,
    knownOtherIncomeCentavos: known.otherIncomeCentavos,
    knownPrincipalRecoveryCentavos: known.principalRecoveryCentavos,
    knownAssetAcquisitionCentavos: known.assetAcquisitionCentavos,
    classificationComplete: native.classificationComplete,
    coverageComplete: input.coverageComplete,
    unresolvedClassificationIds: native.unresolvedIds,
    byCategory,
  }
}
