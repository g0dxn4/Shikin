import {
  isConsumptionEligible,
  owningAllocation,
  validateConsumptionClassification,
  type ConsumptionClassification,
  type ConsumptionEvidence,
  type CorrectionSplit,
  type CorrectionTransaction,
} from './corrections.js'

/** Side-effect-free policy for allocating existing ledger evidence to card statements. */
export interface PaymentAccount {
  id: string
  type: string
  currency: string | null
  account_mode?: string | null
  is_archived?: number | null
}

export type PaymentTransaction = CorrectionTransaction

export interface ActivePaymentLink {
  id: string
  transaction_id: string
  amount: number
}

export interface PaymentEvidence {
  accounts: readonly PaymentAccount[]
  transactions: readonly PaymentTransaction[]
  splits: readonly CorrectionSplit[]
  classifications: readonly ConsumptionClassification[]
  activeLinks: readonly ActivePaymentLink[]
}

export type PaymentEvidenceShape =
  | 'canonical_transfer'
  | 'ordinary_card_income'
  | 'ordinary_bank_expense'

export interface ResolvedPaymentEvidence {
  requestedTransactionId: string
  canonicalTransactionId: string
  shape: PaymentEvidenceShape
  capacity: number
  amount: number
  currency: string
  cardAccountId: string
  aliasTransactionIds: string[]
  explicitRepaymentConfirmation: boolean
}

function normalizedCurrency(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? ''
}

function positiveSafeAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer amount.`)
  }
  return value
}

function safeAdd(total: number, amount: number, label: string): number {
  const result = total + amount
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer capacity.`)
  return result
}

function posted(row: PaymentTransaction): boolean {
  return row.status === 'posted' || row.status === 'cleared'
}

function accountById(evidence: PaymentEvidence, id: string): PaymentAccount {
  const matches = evidence.accounts.filter((account) => account.id === id)
  if (matches.length !== 1)
    throw new Error(`Payment evidence account ${id} is missing or ambiguous.`)
  return matches[0]!
}

function transactionById(evidence: PaymentEvidence, id: string): PaymentTransaction {
  const matches = evidence.transactions.filter((row) => row.id === id)
  if (matches.length !== 1) throw new Error(`Payment transaction ${id} is missing or ambiguous.`)
  return matches[0]!
}

function assertAccountCurrency(account: PaymentAccount, currency: string): void {
  if (
    normalizedCurrency(account.currency) !== currency ||
    (account.account_mode ?? 'transactional') !== 'transactional'
  ) {
    throw new Error('Payment evidence account currency or tracking mode is incompatible.')
  }
}

function resolveCanonicalTransfer(
  requested: PaymentTransaction,
  card: PaymentAccount,
  evidence: PaymentEvidence
): ResolvedPaymentEvidence | null {
  const looksLikeMirror =
    requested.transaction_kind === 'archived_transfer_mirror' ||
    (requested.is_archived === 1 && Boolean(requested.matched_transaction_id))
  const source = looksLikeMirror
    ? transactionById(evidence, requested.matched_transaction_id ?? '')
    : requested
  const currency = normalizedCurrency(source.currency)
  if (source.type !== 'transfer' || source.transfer_to_account_id !== card.id) return null

  const sourceAccount = accountById(evidence, source.account_id ?? '')
  positiveSafeAmount(source.amount, 'Payment transaction amount')
  if (
    !posted(source) ||
    (source.ledger_treatment ?? 'normal') !== 'normal' ||
    (source.transaction_kind ?? 'standard') !== 'standard' ||
    source.is_archived === 1 ||
    source.account_id === card.id ||
    !source.account_id ||
    !currency ||
    currency !== normalizedCurrency(card.currency)
  ) {
    throw new Error('Transfer is not eligible posted, normal-ledger payment evidence.')
  }
  assertAccountCurrency(sourceAccount, currency)
  assertAccountCurrency(card, currency)

  if (!source.matched_transaction_id) {
    if (looksLikeMirror) throw new Error('Archived payment mirror is not symmetrically matched.')
    return {
      requestedTransactionId: requested.id,
      canonicalTransactionId: source.id,
      shape: 'canonical_transfer',
      capacity: source.amount,
      amount: source.amount,
      currency,
      cardAccountId: card.id,
      aliasTransactionIds: [source.id],
      explicitRepaymentConfirmation: false,
    }
  }

  const mirror = transactionById(evidence, source.matched_transaction_id)
  const mirrorAccount = accountById(evidence, mirror.account_id ?? '')
  if (
    mirror.id === source.id ||
    mirror.matched_transaction_id !== source.id ||
    (requested.id !== source.id && requested.id !== mirror.id) ||
    mirror.type !== 'income' ||
    mirror.account_id !== card.id ||
    (mirror.transfer_to_account_id !== null && mirror.transfer_to_account_id !== undefined) ||
    mirror.amount !== source.amount ||
    normalizedCurrency(mirror.currency) !== currency ||
    !posted(mirror) ||
    mirror.ledger_treatment !== 'normal' ||
    source.ledger_treatment !== 'normal' ||
    mirror.reporting_treatment !== 'exclude_from_cashflow' ||
    source.reporting_treatment !== 'exclude_from_cashflow' ||
    mirror.transaction_kind !== 'archived_transfer_mirror' ||
    mirror.is_archived !== 1
  ) {
    throw new Error('Archived payment mirror does not form a fully validated canonical transfer.')
  }
  assertAccountCurrency(mirrorAccount, currency)

  return {
    requestedTransactionId: requested.id,
    canonicalTransactionId: source.id,
    shape: 'canonical_transfer',
    capacity: source.amount,
    amount: source.amount,
    currency,
    cardAccountId: card.id,
    aliasTransactionIds: [source.id, mirror.id].sort(),
    explicitRepaymentConfirmation: false,
  }
}

function ordinaryCapacity(
  row: PaymentTransaction,
  evidence: PaymentEvidence,
  confirmed: boolean
): number {
  if (!confirmed)
    throw new Error(
      'Explicit operator confirmation that this transaction repays this card is required.'
    )
  positiveSafeAmount(row.amount, 'Payment transaction amount')
  if (!isConsumptionEligible(row))
    throw new Error('Ordinary payment evidence must be posted, normal-ledger and nontechnical.')

  const ownedSplits = evidence.splits.filter((split) => split.transaction_id === row.id)
  let splitTotal = 0
  for (const split of ownedSplits) {
    positiveSafeAmount(split.amount, 'Payment split amount')
    splitTotal = safeAdd(splitTotal, split.amount, 'Payment split total')
  }
  if (ownedSplits.length && splitTotal !== row.amount)
    throw new Error('Payment splits must exactly equal their parent transaction amount.')

  const allocations = ownedSplits.length ? ownedSplits.map((split) => split.id) : [null]
  let capacity = 0
  for (const splitId of allocations) {
    const matches = evidence.classifications.filter(
      (classification) =>
        classification.transaction_id === row.id && classification.split_id === splitId
    )
    if (matches.length > 1) throw new Error('Payment allocation has ambiguous classifications.')
    const classification = matches[0]
    const amount = splitId ? ownedSplits.find((split) => split.id === splitId)!.amount : row.amount
    if (classification) {
      owningAllocation(classification, evidence as ConsumptionEvidence)
      validateConsumptionClassification(classification, evidence as ConsumptionEvidence)
    }
    const excluded =
      (row.type === 'income' && classification?.role === 'refund') ||
      (row.type === 'expense' &&
        classification !== undefined &&
        ['purchase', 'fee', 'cash_withdrawal'].includes(classification.role))
    if (!excluded) capacity = safeAdd(capacity, amount, 'Eligible payment capacity')
  }
  if (capacity <= 0) throw new Error('Transaction has no eligible repayment allocation capacity.')
  return capacity
}

export function resolvePaymentEvidence(input: {
  transactionId: string
  cardAccountId: string
  explicitRepaymentConfirmation: boolean
  evidence: PaymentEvidence
}): ResolvedPaymentEvidence {
  const card = accountById(input.evidence, input.cardAccountId)
  if (card.type !== 'credit_card')
    throw new Error('Payment statement account is not a credit card.')
  const requested = transactionById(input.evidence, input.transactionId)
  const transfer = resolveCanonicalTransfer(requested, card, input.evidence)
  if (transfer) return transfer

  const currency = normalizedCurrency(requested.currency)
  if (!currency || currency !== normalizedCurrency(card.currency))
    throw new Error('Payment transaction currency does not match the card statement currency.')
  assertAccountCurrency(card, currency)
  const owner = accountById(input.evidence, requested.account_id ?? '')
  assertAccountCurrency(owner, currency)
  const shape =
    requested.type === 'income' && requested.account_id === card.id
      ? 'ordinary_card_income'
      : requested.type === 'expense' &&
          requested.account_id !== card.id &&
          ['checking', 'savings', 'cash', 'other'].includes(owner.type)
        ? 'ordinary_bank_expense'
        : null
  if (!shape)
    throw new Error('Transaction direction does not provide repayment evidence for this card.')
  const capacity = ordinaryCapacity(requested, input.evidence, input.explicitRepaymentConfirmation)
  return {
    requestedTransactionId: requested.id,
    canonicalTransactionId: requested.id,
    shape,
    capacity,
    amount: requested.amount,
    currency,
    cardAccountId: card.id,
    aliasTransactionIds: [requested.id],
    explicitRepaymentConfirmation: input.explicitRepaymentConfirmation,
  }
}

export function activeLinkedAmount(
  links: readonly ActivePaymentLink[],
  canonicalTransactionId: string
): number {
  let total = 0
  for (const link of links.filter((item) => item.transaction_id === canonicalTransactionId)) {
    positiveSafeAmount(link.amount, 'Active payment link amount')
    total = safeAdd(total, link.amount, 'Active payment link total')
  }
  return total
}

export function assertPaymentLinkCapacity(input: {
  resolved: ResolvedPaymentEvidence
  activeLinks: readonly ActivePaymentLink[]
  additionalAmount?: number
}): { activeAmount: number; remainingCapacity: number } {
  const additional = input.additionalAmount ?? 0
  if (!Number.isSafeInteger(additional) || additional < 0)
    throw new Error('Additional payment allocation must be a non-negative safe integer.')
  const activeAmount = activeLinkedAmount(input.activeLinks, input.resolved.canonicalTransactionId)
  const resulting = safeAdd(activeAmount, additional, 'Resulting payment allocation')
  if (resulting > input.resolved.capacity)
    throw new Error('Payment allocations across statements exceed eligible transaction capacity.')
  return { activeAmount, remainingCapacity: input.resolved.capacity - resulting }
}
