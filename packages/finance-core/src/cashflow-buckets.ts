export const CASHFLOW_BUCKET_CLEARABLE_FIELDS = ['description', 'targetAmount'] as const

export type CashflowBucketClearableField = (typeof CASHFLOW_BUCKET_CLEARABLE_FIELDS)[number]

export type CashflowBucketPolicyFailure = {
  success: false
  reason: string
  message: string
  remainingCentavos?: number
  field?: string
}

export type CashflowBucketPolicySuccess<T> = { success: true; plan: T }
export type CashflowBucketPolicyResult<T> =
  | CashflowBucketPolicySuccess<T>
  | CashflowBucketPolicyFailure

export type BucketPolicySnapshot = {
  id: string
  name: string
  description: string | null
  targetAmountCentavos: number | null
  balanceCentavos: number
  currency: string
  sortOrder: number
  isActive: boolean
}

export type AllocationPolicySnapshot = {
  id: string
  bucketId: string
  transactionId: string | null
  amountCentavos: number
  currency: string
  allocationDate: string
  source: string | null
  note: string | null
  reversesAllocationId: string | null
  replacesAllocationId: string | null
}

export type IncomeSourcePolicySnapshot = {
  id: string
  accountId: string
  type: string
  amountCentavos: number
  currency: string
  status: string | null
  ledgerTreatment: string | null
  transactionKind: string | null
  reportingTreatment?: string | null
  isArchived?: boolean
  accountIsArchived?: boolean
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/

export function normalizeBucketCurrency(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase() ?? ''
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null
}

export function safeBucketInteger(
  value: unknown,
  message = 'Amount is not a safe integer.'
): number | CashflowBucketPolicyFailure {
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? value
    : { success: false, reason: 'unsafe_amount', message }
}

export function safeBucketSum(
  left: number,
  right: number,
  message = 'Amount exceeds the safe integer range.'
): number | CashflowBucketPolicyFailure {
  const total = left + right
  return Number.isSafeInteger(total) ? total : { success: false, reason: 'unsafe_amount', message }
}

export function moneyToSafeCentavos(
  amount: number,
  message = 'Amount must convert to a safe integer in centavos.'
): number | CashflowBucketPolicyFailure {
  const centavos = Math.round(amount * 100)
  return Number.isFinite(amount) && Number.isSafeInteger(centavos)
    ? centavos
    : { success: false, reason: 'unsafe_amount', message }
}

export function validateBucketIncomeSource(
  source: IncomeSourcePolicySnapshot
): CashflowBucketPolicyResult<{ amountCentavos: number; currency: string }> {
  if (source.isArchived) {
    return {
      success: false,
      reason: 'source_transaction_not_found',
      message: `Source transaction ${source.id} not found.`,
    }
  }
  if (source.accountIsArchived) {
    return {
      success: false,
      reason: 'account_archived',
      message: `Source transaction ${source.id} belongs to an archived account. Unarchive it before allocating income from it.`,
    }
  }
  if (source.type !== 'income') {
    return {
      success: false,
      reason: 'source_transaction_not_income',
      message: `Source transaction ${source.id} is a ${source.type} transaction, not income.`,
    }
  }
  const status = source.status?.trim() || 'posted'
  if (status !== 'posted' && status !== 'cleared') {
    return {
      success: false,
      reason: 'source_transaction_not_posted',
      message: `Source transaction ${source.id} must be posted or cleared before allocating income.`,
    }
  }
  if ((source.ledgerTreatment ?? 'normal') !== 'normal') {
    return {
      success: false,
      reason: 'source_transaction_staged',
      message: `Source transaction ${source.id} is staged or not ordinary normal-ledger income.`,
    }
  }
  if ((source.reportingTreatment ?? 'normal') !== 'normal') {
    return {
      success: false,
      reason: 'source_transaction_not_found',
      message: `Source transaction ${source.id} not found.`,
    }
  }
  if ((source.transactionKind ?? 'standard') !== 'standard') {
    return {
      success: false,
      reason: 'source_transaction_technical',
      message: `Source transaction ${source.id} is a technical ${source.transactionKind} record, not ordinary income.`,
    }
  }
  const currency = normalizeBucketCurrency(source.currency)
  if (!currency) {
    return {
      success: false,
      reason: 'malformed_currency',
      message: `Source transaction ${source.id} has malformed or ambiguous currency evidence.`,
    }
  }
  const amount = safeBucketInteger(
    source.amountCentavos,
    `Source transaction ${source.id} amount is not a safe integer.`
  )
  if (typeof amount !== 'number') return amount
  if (amount <= 0) {
    return {
      success: false,
      reason: 'source_transaction_not_income',
      message: `Source transaction ${source.id} amount must be a positive safe integer.`,
    }
  }
  return { success: true, plan: { amountCentavos: amount, currency } }
}

export function planBucketPatch(
  current: BucketPolicySnapshot,
  patch: {
    name?: string
    description?: string
    targetAmountCentavos?: number
    sortOrder?: number
    active?: boolean
    clearFields?: readonly CashflowBucketClearableField[]
  }
): CashflowBucketPolicyResult<BucketPolicySnapshot> {
  const clearSet = new Set(patch.clearFields ?? [])
  if (patch.description !== undefined && clearSet.has('description')) {
    return {
      success: false,
      reason: 'clear_field_conflict',
      message: 'Cannot set description and clear it in the same request.',
      field: 'description',
    }
  }
  if (patch.targetAmountCentavos !== undefined && clearSet.has('targetAmount')) {
    return {
      success: false,
      reason: 'clear_field_conflict',
      message: 'Cannot set targetAmount and clear it in the same request.',
      field: 'targetAmount',
    }
  }
  if (
    patch.name === undefined &&
    patch.description === undefined &&
    patch.targetAmountCentavos === undefined &&
    patch.sortOrder === undefined &&
    patch.active === undefined &&
    clearSet.size === 0
  ) {
    return {
      success: false,
      reason: 'no_updates',
      message: 'Provide at least one field to update or clear.',
    }
  }
  if (patch.targetAmountCentavos !== undefined) {
    const target = safeBucketInteger(
      patch.targetAmountCentavos,
      'Target amount must be a safe integer in centavos.'
    )
    if (typeof target !== 'number') return target
    if (target < 0) {
      return {
        success: false,
        reason: 'invalid_target',
        message: 'Target amount cannot be negative.',
      }
    }
  }

  return {
    success: true,
    plan: {
      ...current,
      name: patch.name ?? current.name,
      description: clearSet.has('description')
        ? null
        : patch.description === undefined
          ? current.description
          : patch.description,
      targetAmountCentavos: clearSet.has('targetAmount')
        ? null
        : patch.targetAmountCentavos === undefined
          ? current.targetAmountCentavos
          : patch.targetAmountCentavos,
      sortOrder: patch.sortOrder ?? current.sortOrder,
      isActive: patch.active ?? current.isActive,
    },
  }
}

export function planBucketAllocation(input: {
  bucket: BucketPolicySnapshot
  amountCentavos: number
  currency: string
  sourceTransactionId?: string | null | undefined
  sourceAmountCentavos?: number | undefined
  sourceAllocatedCentavos?: number | undefined
  sourceUnwindCentavos?: number | undefined
}): CashflowBucketPolicyResult<{
  currency: string
  nextBalanceCentavos: number
  nextSourceAllocatedCentavos: number | null
}> {
  if (!input.bucket.isActive) {
    return {
      success: false,
      reason: 'bucket_inactive',
      message: `Cashflow bucket "${input.bucket.name}" is inactive. Activate it before allocating income.`,
    }
  }
  const bucketCurrency = normalizeBucketCurrency(input.bucket.currency)
  const currency = normalizeBucketCurrency(input.currency)
  if (!bucketCurrency || !currency) {
    return {
      success: false,
      reason: 'malformed_currency',
      message: 'Allocation or bucket currency evidence is malformed or ambiguous.',
    }
  }
  if (currency !== bucketCurrency) {
    return {
      success: false,
      reason: 'bucket_currency_mismatch',
      message: `Allocation currency ${currency} does not match bucket currency ${bucketCurrency}.`,
    }
  }
  const amount = safeBucketInteger(
    input.amountCentavos,
    'Allocation amount must convert to a positive safe integer.'
  )
  if (typeof amount !== 'number') return amount
  if (amount <= 0) {
    return {
      success: false,
      reason: 'unsafe_amount',
      message: 'Allocation amount must convert to a positive safe integer.',
    }
  }
  const balance = safeBucketInteger(
    input.bucket.balanceCentavos,
    `Cashflow bucket "${input.bucket.name}" balance is not a safe integer.`
  )
  if (typeof balance !== 'number') return balance
  const nextBalance = safeBucketSum(
    balance,
    amount,
    `Cashflow bucket "${input.bucket.name}" balance exceeds the safe integer range.`
  )
  if (typeof nextBalance !== 'number') return nextBalance

  let nextSourceAllocatedCentavos: number | null = null
  if (input.sourceTransactionId) {
    const sourceAmount = safeBucketInteger(
      input.sourceAmountCentavos,
      `Source transaction ${input.sourceTransactionId} amount is not a safe integer.`
    )
    if (typeof sourceAmount !== 'number') return sourceAmount
    const allocated = safeBucketInteger(
      input.sourceAllocatedCentavos ?? 0,
      `Allocated total for source transaction ${input.sourceTransactionId} is not a safe integer.`
    )
    if (typeof allocated !== 'number') return allocated
    const afterUnwind = safeBucketSum(
      allocated,
      -(input.sourceUnwindCentavos ?? 0),
      `Source transaction ${input.sourceTransactionId} allocated total exceeds the safe integer range.`
    )
    if (typeof afterUnwind !== 'number') return afterUnwind
    const nextAllocated = safeBucketSum(
      afterUnwind,
      amount,
      `Source transaction ${input.sourceTransactionId} allocated total exceeds the safe integer range.`
    )
    if (typeof nextAllocated !== 'number') return nextAllocated
    if (nextAllocated > sourceAmount) {
      return {
        success: false,
        reason: 'source_transaction_overallocated',
        message: `Source transaction ${input.sourceTransactionId} does not have enough remaining funding.`,
        remainingCentavos: Math.max(sourceAmount - afterUnwind, 0),
      }
    }
    nextSourceAllocatedCentavos = nextAllocated
  }

  return {
    success: true,
    plan: { currency, nextBalanceCentavos: nextBalance, nextSourceAllocatedCentavos },
  }
}

export function planBucketReversal(input: {
  original: AllocationPolicySnapshot
  bucket: BucketPolicySnapshot
  alreadyReversed: boolean
}): CashflowBucketPolicyResult<{ reversalAmountCentavos: number; nextBalanceCentavos: number }> {
  if (input.original.reversesAllocationId) {
    return {
      success: false,
      reason: 'cannot_reverse_reversal',
      message: `Allocation ${input.original.id} is a reversal and cannot be reversed.`,
    }
  }
  const amount = safeBucketInteger(
    input.original.amountCentavos,
    `Allocation ${input.original.id} amount is not a safe integer.`
  )
  if (typeof amount !== 'number') return amount
  if (amount <= 0) {
    return {
      success: false,
      reason: 'allocation_not_reversible',
      message: `Allocation ${input.original.id} is not a positive original allocation.`,
    }
  }
  if (input.alreadyReversed) {
    return {
      success: false,
      reason: 'allocation_already_reversed',
      message: `Allocation ${input.original.id} already has a reversal.`,
    }
  }
  const currency = normalizeBucketCurrency(input.original.currency)
  const bucketCurrency = normalizeBucketCurrency(input.bucket.currency)
  if (!currency || !bucketCurrency || currency !== bucketCurrency) {
    return {
      success: false,
      reason: 'malformed_currency',
      message: `Allocation ${input.original.id} currency does not match its bucket; refusing to guess.`,
    }
  }
  const reversalAmount = -amount
  const nextBalance = safeBucketSum(
    input.bucket.balanceCentavos,
    reversalAmount,
    `Cashflow bucket "${input.bucket.name}" balance exceeds the safe integer range.`
  )
  if (typeof nextBalance !== 'number') return nextBalance
  return {
    success: true,
    plan: { reversalAmountCentavos: reversalAmount, nextBalanceCentavos: nextBalance },
  }
}

export function planBucketCorrection(input: {
  original: AllocationPolicySnapshot
  originalBucket: BucketPolicySnapshot
  targetBucket: BucketPolicySnapshot
  replacementAmountCentavos: number
  replacementCurrency: string
  alreadyReversed: boolean
  sourceTransactionId?: string | null | undefined
  sourceAmountCentavos?: number | undefined
  sourceAllocatedCentavos?: number | undefined
}): CashflowBucketPolicyResult<{
  reversalAmountCentavos: number
  originalNextBalanceCentavos: number
  targetNextBalanceCentavos: number
  nextSourceAllocatedCentavos: number | null
}> {
  const reversal = planBucketReversal({
    original: input.original,
    bucket: input.originalBucket,
    alreadyReversed: input.alreadyReversed,
  })
  if (!reversal.success) return reversal
  const sameBucket = input.originalBucket.id === input.targetBucket.id
  const targetBefore: BucketPolicySnapshot = {
    ...input.targetBucket,
    balanceCentavos: sameBucket
      ? reversal.plan.nextBalanceCentavos
      : input.targetBucket.balanceCentavos,
  }
  const allocation = planBucketAllocation({
    bucket: targetBefore,
    amountCentavos: input.replacementAmountCentavos,
    currency: input.replacementCurrency,
    sourceTransactionId: input.sourceTransactionId,
    sourceAmountCentavos: input.sourceAmountCentavos,
    sourceAllocatedCentavos: input.sourceAllocatedCentavos,
    sourceUnwindCentavos:
      input.sourceTransactionId && input.sourceTransactionId === input.original.transactionId
        ? input.original.amountCentavos
        : 0,
  })
  if (!allocation.success) return allocation
  return {
    success: true,
    plan: {
      reversalAmountCentavos: reversal.plan.reversalAmountCentavos,
      originalNextBalanceCentavos: sameBucket
        ? allocation.plan.nextBalanceCentavos
        : reversal.plan.nextBalanceCentavos,
      targetNextBalanceCentavos: allocation.plan.nextBalanceCentavos,
      nextSourceAllocatedCentavos: allocation.plan.nextSourceAllocatedCentavos,
    },
  }
}
