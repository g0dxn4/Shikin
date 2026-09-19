import { normalizePostingStatus } from './ledger.js'

/** Shared, side-effect-free correction and explicit consumption policy. Amounts are centavos. */
export interface CorrectionTransaction {
  id: string
  type: string
  amount: number
  currency: string | null
  category_id?: string | null
  subcategory_id?: string | null
  description?: string
  notes?: string | null
  date?: string
  account_id?: string
  transfer_to_account_id?: string | null
  status?: string | null
  ledger_treatment?: string | null
  reporting_treatment?: string | null
  transaction_kind?: string | null
  matched_transaction_id?: string | null
  is_archived?: number | null
  is_placeholder?: number | null
  placeholder_status?: string | null
  finalization_id?: string | null
}
export interface CorrectionSplit {
  id: string
  transaction_id: string
  amount: number
  category_id: string | null
}
export const consumptionRoles = [
  'purchase',
  'fee',
  'earned_income',
  'refund',
  'internal_inflow',
  'cash_withdrawal',
  'principal',
] as const
export type ConsumptionRole = (typeof consumptionRoles)[number]
export interface ConsumptionClassification {
  id: string
  transaction_id: string
  split_id: string | null
  role: ConsumptionRole
  referenced_purchase_id: string | null
}
export interface ConsumptionEvidence {
  transactions: readonly CorrectionTransaction[]
  splits: readonly CorrectionSplit[]
  classifications: readonly ConsumptionClassification[]
}
export interface MetadataCorrection {
  description?: string
  category_id?: string | null
  subcategory_id?: string | null
  notes?: string | null
  reporting_treatment?: 'normal' | 'exclude_from_cashflow'
}
export function assertOrdinaryCorrection(row: CorrectionTransaction): void {
  if (
    row.is_archived ||
    (row.transaction_kind ?? 'standard') !== 'standard' ||
    row.matched_transaction_id ||
    row.type === 'transfer' ||
    (row.is_placeholder && (row.placeholder_status ?? 'unresolved') !== 'unresolved')
  ) {
    throw new Error('Protected financial provenance requires its dedicated workflow.')
  }
}
export function applyMetadataCorrection<T extends CorrectionTransaction>(
  row: T,
  patch: MetadataCorrection,
  hasSplits: boolean,
  replacingSplits = false
): T {
  assertOrdinaryCorrection(row)
  const allowed = ['description', 'category_id', 'subcategory_id', 'notes', 'reporting_treatment']
  if (Object.keys(patch).some((key) => !allowed.includes(key)))
    throw new Error('Only metadata correction fields are allowed.')
  if (patch.description !== undefined && !patch.description.trim())
    throw new Error('Description cannot be empty.')
  if (
    patch.reporting_treatment !== undefined &&
    !['normal', 'exclude_from_cashflow'].includes(patch.reporting_treatment)
  )
    throw new Error('Invalid reporting treatment.')
  if (
    hasSplits &&
    !replacingSplits &&
    ((patch.category_id !== undefined && patch.category_id !== row.category_id) ||
      (patch.subcategory_id !== undefined && patch.subcategory_id !== row.subcategory_id))
  )
    throw new Error('Parent categorization requires explicit split replacement.')
  return {
    ...row,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
  }
}
export function isConsumptionEligible(row: CorrectionTransaction): boolean {
  return (
    ['expense', 'income'].includes(row.type) &&
    ['posted', 'cleared'].includes(normalizePostingStatus(row.status)) &&
    (row.ledger_treatment ?? 'normal') === 'normal' &&
    (row.reporting_treatment ?? 'normal') === 'normal' &&
    (row.transaction_kind ?? 'standard') === 'standard' &&
    !row.is_archived &&
    !row.matched_transaction_id &&
    !row.is_placeholder
  )
}
export function owningAllocation(
  classification: ConsumptionClassification,
  evidence: ConsumptionEvidence
) {
  const row = evidence.transactions.find((tx) => tx.id === classification.transaction_id)
  if (!row || !isConsumptionEligible(row))
    throw new Error('Classification requires an eligible ordinary posted allocation.')
  const ownedSplits = evidence.splits.filter((split) => split.transaction_id === row.id)
  const split = classification.split_id
    ? ownedSplits.find((item) => item.id === classification.split_id)
    : undefined
  if ((classification.split_id && !split) || (!classification.split_id && ownedSplits.length))
    throw new Error('Classification must identify an owned split, or an unsplit transaction.')
  if (
    ownedSplits.length &&
    (ownedSplits.some((item) => !Number.isSafeInteger(item.amount) || item.amount <= 0) ||
      ownedSplits.reduce((sum, item) => sum + item.amount, 0) !== row.amount)
  )
    throw new Error('Invalid split allocation totals.')
  const amount = split?.amount ?? row.amount
  if (
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !row.currency ||
    !/^[A-Z]{3}$/.test(row.currency.trim().toUpperCase())
  )
    throw new Error('Owning amount must be a positive safe integer with known currency.')
  const expense = ['purchase', 'fee', 'principal', 'cash_withdrawal'].includes(classification.role)
  if (
    !consumptionRoles.includes(classification.role) ||
    row.type !== (expense ? 'expense' : 'income')
  )
    throw new Error('Classification role does not match transaction direction.')
  return {
    row,
    amount,
    categoryId: split ? split.category_id : (row.category_id ?? null),
    currency: row.currency.trim().toUpperCase(),
  }
}
export function validateConsumptionClassification(
  item: ConsumptionClassification,
  evidence: ConsumptionEvidence
): void {
  const owner = owningAllocation(item, evidence)
  if (
    evidence.classifications.some(
      (other) =>
        other.id !== item.id &&
        other.transaction_id === item.transaction_id &&
        other.split_id === item.split_id
    )
  )
    throw new Error('Allocation already classified.')
  const needsPurchase = item.role === 'refund' || item.role === 'principal'
  if (!needsPurchase) {
    if (item.referenced_purchase_id)
      throw new Error('Only refunds and principal may reference a purchase.')
    return
  }
  const target = evidence.classifications.find((other) => other.id === item.referenced_purchase_id)
  if (
    !target ||
    target.id === item.id ||
    target.role !== 'purchase' ||
    target.referenced_purchase_id
  )
    throw new Error('A same-currency purchase classification is required.')
  const purchase = owningAllocation(target, evidence)
  if (owner.currency !== purchase.currency) throw new Error('Purchase reference currency differs.')
  const total = evidence.classifications
    .filter((other) => other.referenced_purchase_id === target.id && other.role === item.role)
    .reduce((sum, other) => sum + owningAllocation(other, evidence).amount, 0)
  if (!Number.isSafeInteger(total) || total > purchase.amount)
    throw new Error(`${item.role} allocations exceed purchase capacity.`)
}
export function validateConsumptionEvidence(evidence: ConsumptionEvidence): void {
  for (const item of evidence.classifications) validateConsumptionClassification(item, evidence)
}
export function assertSplitReplacementAllowed(
  transactionId: string,
  evidence: ConsumptionEvidence,
  activePayments = false,
  activeBuckets = false
): void {
  if (
    activePayments ||
    activeBuckets ||
    evidence.classifications.some((item) => item.transaction_id === transactionId)
  )
    throw new Error(
      'Clear classifications, unlink payments or reverse bucket allocations before replacing splits.'
    )
}
export function assertEvidenceMutationAllowed(
  financialChanged: boolean,
  activePayments: boolean,
  activeBuckets: boolean
): void {
  if (financialChanged && (activePayments || activeBuckets))
    throw new Error(
      'Unlink active payments or reverse source bucket allocations before financial edits.'
    )
}
export function assertBucketSourcePreserved(
  before: CorrectionTransaction,
  after: CorrectionTransaction | null,
  allocations: readonly { currency: string; total: number }[]
): void {
  const active = allocations.filter((row) => row.total > 0)
  if (!active.length) return
  const total = active.reduce((sum, row) => sum + row.total, 0)
  if (
    !after ||
    !isConsumptionEligible(after) ||
    after.type !== 'income' ||
    after.account_id !== before.account_id ||
    after.date !== before.date ||
    !Number.isSafeInteger(after.amount) ||
    !Number.isSafeInteger(total) ||
    total > after.amount ||
    active.some((row) => row.currency.trim().toUpperCase() !== after.currency?.trim().toUpperCase())
  )
    throw new Error(
      'Reverse source bucket allocations before invalidating their evidence or capacity.'
    )
}
export function financialFieldsChanged(
  before: CorrectionTransaction,
  after: CorrectionTransaction
): boolean {
  return (
    [
      'type',
      'amount',
      'currency',
      'date',
      'account_id',
      'transfer_to_account_id',
      'status',
      'ledger_treatment',
      'reporting_treatment',
    ] as const
  ).some((field) => before[field] !== after[field])
}

/** Known native-currency subtotals only. Coverage is independently verified by the caller. */
export function netConsumption(evidence: ConsumptionEvidence, start: string, end: string) {
  const unresolvedIds: string[] = evidence.classifications
    .filter((item) => {
      const row = evidence.transactions.find((tx) => tx.id === item.transaction_id)
      return (
        !row || (row.date && row.date >= start && row.date <= end && !isConsumptionEligible(row))
      )
    })
    .map((item) => item.id)
  const totals = new Map<
    string,
    { currency: string; consumptionCentavos: number; earnedIncomeCentavos: number }
  >()
  const categories = new Map<
    string,
    { currency: string; categoryId: string | null; amountCentavos: number }
  >()
  for (const row of evidence.transactions) {
    if (!row.date || row.date < start || row.date > end) continue
    if (!isConsumptionEligible(row)) {
      if (
        row.type !== 'transfer' &&
        !row.is_archived &&
        !row.matched_transaction_id &&
        !row.is_placeholder &&
        !['reconciliation_bridge', 'archived_transfer_mirror'].includes(
          row.transaction_kind ?? 'standard'
        ) &&
        row.ledger_treatment !== 'staged_no_balance_impact' &&
        row.reporting_treatment !== 'exclude_from_cashflow' &&
        normalizePostingStatus(row.status) !== 'pending'
      )
        unresolvedIds.push(row.id)
      continue
    }
    const splits = evidence.splits.filter((split) => split.transaction_id === row.id)
    for (const splitId of splits.length ? splits.map((split) => split.id) : [null]) {
      const item = evidence.classifications.find(
        (entry) => entry.transaction_id === row.id && entry.split_id === splitId
      )
      try {
        if (!item) throw new Error('Unclassified allocation')
        validateConsumptionClassification(item, evidence)
        const owner = owningAllocation(item, evidence)
        let categoryId = owner.categoryId
        let consumption = ['purchase', 'fee'].includes(item.role) ? owner.amount : 0
        if (item.role === 'refund') {
          const purchase = evidence.classifications.find(
            (entry) => entry.id === item.referenced_purchase_id
          )!
          categoryId = owningAllocation(purchase, evidence).categoryId
          consumption = -owner.amount
        }
        const total = {
          ...(totals.get(owner.currency) ?? {
            currency: owner.currency,
            consumptionCentavos: 0,
            earnedIncomeCentavos: 0,
          }),
        }
        total.consumptionCentavos += consumption
        if (item.role === 'earned_income') total.earnedIncomeCentavos += owner.amount
        if (
          !Number.isSafeInteger(total.consumptionCentavos) ||
          !Number.isSafeInteger(total.earnedIncomeCentavos)
        )
          throw new Error('Unsafe aggregate')
        if (consumption !== 0) {
          const key = JSON.stringify([owner.currency, categoryId])
          const category = {
            ...(categories.get(key) ?? {
              currency: owner.currency,
              categoryId,
              amountCentavos: 0,
            }),
          }
          category.amountCentavos += consumption
          if (!Number.isSafeInteger(category.amountCentavos))
            throw new Error('Unsafe category aggregate')
          categories.set(key, category)
        }
        totals.set(owner.currency, total)
      } catch {
        unresolvedIds.push(splitId ?? row.id)
      }
    }
  }
  return {
    basis: 'net_consumption' as const,
    classificationComplete: unresolvedIds.length === 0,
    unresolvedIds,
    totalsByCurrency: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    byCategory: [...categories.values()].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b))
    ),
  }
}
