import {
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

function knownReportingTreatment(row: PaymentTransaction): boolean {
  return ['normal', 'exclude_from_cashflow'].includes(row.reporting_treatment ?? 'normal')
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
    Boolean(source.is_archived) ||
    !knownReportingTreatment(source) ||
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

function paymentClassificationEvidence(evidence: PaymentEvidence): ConsumptionEvidence {
  return {
    ...evidence,
    transactions: evidence.transactions.map((transaction) => {
      const treatment = transaction.reporting_treatment ?? 'normal'
      if (!['normal', 'exclude_from_cashflow'].includes(treatment)) return transaction
      return { ...transaction, reporting_treatment: 'normal' }
    }),
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
  if (!knownReportingTreatment(row))
    throw new Error('Ordinary payment evidence has an unknown reporting treatment.')
  if (
    !['expense', 'income'].includes(row.type) ||
    !posted(row) ||
    (row.ledger_treatment ?? 'normal') !== 'normal' ||
    (row.transaction_kind ?? 'standard') !== 'standard' ||
    Boolean(row.is_archived) ||
    Boolean(row.matched_transaction_id) ||
    Boolean(row.is_placeholder)
  )
    throw new Error('Ordinary payment evidence must be posted, normal-ledger and nontechnical.')

  const classificationEvidence = paymentClassificationEvidence(evidence)
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
      owningAllocation(classification, classificationEvidence)
      validateConsumptionClassification(classification, classificationEvidence)
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

export type StatementPaymentStatus = 'open' | 'partial' | 'paid' | 'overdue'
export type StatementPaymentLinkMode = 'apply_to_unpaid' | 'attribute_existing'

export interface StatementPaymentState {
  statementBalance: number
  paidAmount: number
  unattributedPaidAmount: number
  dueDate: string
  status: StatementPaymentStatus
}

export interface StatementPaymentPlan {
  before: StatementPaymentState
  after: StatementPaymentState
  activeLinkedAmountBefore: number
  activeLinkedAmountAfter: number
  legacyOverpaidBefore: boolean
  legacyOverpaidAfter: boolean
}

function nonNegativeSafeAmount(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer amount.`)
  return value
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new Error(`${label} must be an ISO date.`)
}

export function deriveStatementPaymentStatus(input: {
  statementBalance: number
  paidAmount: number
  dueDate: string
  today: string
}): StatementPaymentStatus {
  nonNegativeSafeAmount(input.statementBalance, 'Statement balance')
  nonNegativeSafeAmount(input.paidAmount, 'Statement paid amount')
  assertIsoDate(input.dueDate, 'Statement due date')
  assertIsoDate(input.today, 'Current date')
  if (input.statementBalance === 0 || input.paidAmount >= input.statementBalance) return 'paid'
  if (input.paidAmount > 0) return 'partial'
  return input.dueDate < input.today ? 'overdue' : 'open'
}

export function assertStatementPaymentEquation(
  statement: StatementPaymentState,
  activeLinkedAmount: number
): void {
  nonNegativeSafeAmount(statement.statementBalance, 'Statement balance')
  nonNegativeSafeAmount(statement.paidAmount, 'Statement paid amount')
  nonNegativeSafeAmount(statement.unattributedPaidAmount, 'Statement unattributed paid amount')
  nonNegativeSafeAmount(activeLinkedAmount, 'Statement active linked amount')
  if (
    safeAdd(statement.unattributedPaidAmount, activeLinkedAmount, 'Statement payment equation') !==
    statement.paidAmount
  )
    throw new Error('Statement payment evidence is inconsistent; repair it before continuing.')
}

function statementPlan(
  before: StatementPaymentState,
  afterAmounts: Pick<
    StatementPaymentState,
    'statementBalance' | 'paidAmount' | 'unattributedPaidAmount'
  >,
  activeLinkedAmountBefore: number,
  activeLinkedAmountAfter: number,
  today: string
): StatementPaymentPlan {
  assertStatementPaymentEquation(before, activeLinkedAmountBefore)
  const after: StatementPaymentState = {
    ...before,
    ...afterAmounts,
    status: deriveStatementPaymentStatus({ ...afterAmounts, dueDate: before.dueDate, today }),
  }
  assertStatementPaymentEquation(after, activeLinkedAmountAfter)
  return {
    before,
    after,
    activeLinkedAmountBefore,
    activeLinkedAmountAfter,
    legacyOverpaidBefore: before.paidAmount > before.statementBalance,
    legacyOverpaidAfter: after.paidAmount > after.statementBalance,
  }
}

export function planStatementPaymentLink(input: {
  statement: StatementPaymentState
  activeLinkedAmount: number
  amount: number
  mode: StatementPaymentLinkMode
  today: string
}): StatementPaymentPlan {
  positiveSafeAmount(input.amount, 'Payment link amount')
  const activeAfter = safeAdd(
    input.activeLinkedAmount,
    input.amount,
    'Statement linked payment total'
  )
  if (activeAfter > input.statement.statementBalance)
    throw new Error('Linked allocations cannot exceed the statement balance.')
  if (input.mode === 'attribute_existing' && input.statement.unattributedPaidAmount < input.amount)
    throw new Error('Statement has insufficient unattributed paid amount for this attribution.')
  const paidAmount =
    input.mode === 'apply_to_unpaid'
      ? safeAdd(input.statement.paidAmount, input.amount, 'Statement paid total')
      : input.statement.paidAmount
  if (input.mode === 'apply_to_unpaid' && paidAmount > input.statement.statementBalance)
    throw new Error('Applying this link would newly overpay the statement.')
  return statementPlan(
    input.statement,
    {
      statementBalance: input.statement.statementBalance,
      paidAmount,
      unattributedPaidAmount:
        input.mode === 'attribute_existing'
          ? input.statement.unattributedPaidAmount - input.amount
          : input.statement.unattributedPaidAmount,
    },
    input.activeLinkedAmount,
    activeAfter,
    input.today
  )
}

export function planStatementPaymentUnlink(input: {
  statement: StatementPaymentState
  activeLinkedAmount: number
  amount: number
  mode: StatementPaymentLinkMode
  today: string
}): StatementPaymentPlan {
  positiveSafeAmount(input.amount, 'Payment link amount')
  if (input.amount > input.activeLinkedAmount)
    throw new Error('Payment link amount exceeds the statement active linked amount.')
  const paidAmount =
    input.mode === 'apply_to_unpaid'
      ? input.statement.paidAmount - input.amount
      : input.statement.paidAmount
  const baseline =
    input.mode === 'attribute_existing'
      ? safeAdd(
          input.statement.unattributedPaidAmount,
          input.amount,
          'Statement unattributed paid amount'
        )
      : input.statement.unattributedPaidAmount
  if (paidAmount < 0) throw new Error('Unlink would produce an invalid statement total.')
  return statementPlan(
    input.statement,
    {
      statementBalance: input.statement.statementBalance,
      paidAmount,
      unattributedPaidAmount: baseline,
    },
    input.activeLinkedAmount,
    input.activeLinkedAmount - input.amount,
    input.today
  )
}

export function planStatementBaselinePayment(input: {
  statement: StatementPaymentState
  activeLinkedAmount: number
  amount: number
  today: string
}): StatementPaymentPlan {
  positiveSafeAmount(input.amount, 'Statement-only payment amount')
  const paidAmount = safeAdd(input.statement.paidAmount, input.amount, 'Statement paid total')
  if (paidAmount > input.statement.statementBalance)
    throw new Error('This payment would newly increase the statement paid total above its balance.')
  return statementPlan(
    input.statement,
    {
      statementBalance: input.statement.statementBalance,
      paidAmount,
      unattributedPaidAmount: safeAdd(
        input.statement.unattributedPaidAmount,
        input.amount,
        'Statement unattributed paid amount'
      ),
    },
    input.activeLinkedAmount,
    input.activeLinkedAmount,
    input.today
  )
}

export function planStatementTotalsEdit(input: {
  statement: StatementPaymentState
  activeLinkedAmount: number
  statementBalance?: number
  paidAmount?: number
  dueDate?: string
  today: string
}): StatementPaymentPlan {
  const statementBalance =
    input.statementBalance === undefined
      ? input.statement.statementBalance
      : nonNegativeSafeAmount(input.statementBalance, 'Statement balance')
  const paidAmount =
    input.paidAmount === undefined
      ? input.statement.paidAmount
      : nonNegativeSafeAmount(input.paidAmount, 'Statement paid amount')
  if (statementBalance < input.activeLinkedAmount)
    throw new Error('Statement balance cannot be lower than active linked payment allocations.')
  if (paidAmount < input.activeLinkedAmount)
    throw new Error('Paid amount cannot be lower than active linked payment allocations.')
  const wasOverpaid = input.statement.paidAmount > input.statement.statementBalance
  if (paidAmount > statementBalance && (!wasOverpaid || paidAmount !== input.statement.paidAmount))
    throw new Error('A changed statement total cannot introduce or increase overpayment.')
  const dueDate = input.dueDate ?? input.statement.dueDate
  assertIsoDate(dueDate, 'Statement due date')
  const before = input.statement
  const after = {
    statementBalance,
    paidAmount,
    unattributedPaidAmount: paidAmount - input.activeLinkedAmount,
  }
  const plan = statementPlan(
    before,
    after,
    input.activeLinkedAmount,
    input.activeLinkedAmount,
    input.today
  )
  plan.after.dueDate = dueDate
  plan.after.status = deriveStatementPaymentStatus({ ...after, dueDate, today: input.today })
  return plan
}
