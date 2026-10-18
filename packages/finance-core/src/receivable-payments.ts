/** Receivables plan expected income. Payment links recognize existing bank income once. */
export interface ReceivablePaymentState {
  id: string
  amount: number
  received_amount: number
  unattributed_received_amount: number
  currency: string
  status: 'open' | 'partial' | 'received' | 'cancelled'
  account_id: string | null
  matched_transaction_id: string | null
}

export interface ReceivablePaymentLink {
  id: string
  receivable_id: string
  transaction_id: string
  amount: number
  currency: string
  transaction_date: string
  transaction_snapshot_json: string
  source: string | null
  note: string | null
  created_at: string
  reversed_at: string | null
  reversal_source: string | null
  reversal_note: string | null
}

export interface ReceivableIncomeEvidence {
  id: string
  account_id: string
  amount: number
  currency: string | null
  type: string
  status: string | null
  ledger_treatment: string | null
  reporting_treatment?: string | null
  transaction_kind: string | null
  matched_transaction_id: string | null
  is_archived: number | null
  date: string
  description: string
  account_mode?: string | null
  account_is_archived?: number | null
  is_card_payment?: number
  is_non_income_classification?: number
}

export class ReceivablePaymentError extends Error {
  constructor(
    public readonly reason: string,
    message: string
  ) {
    super(message)
    this.name = 'ReceivablePaymentError'
  }
}

function fail(reason: string, message: string): never {
  throw new ReceivablePaymentError(reason, message)
}

function integer(value: number, positive = false): number {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0))
    fail('invalid_payment_amount', 'Receipt amounts must be non-negative safe integer centavos.')
  return value
}

function currency(value: string | null): string {
  const normalized = value?.trim().toUpperCase() ?? ''
  if (!/^[A-Z]{3}$/.test(normalized))
    fail('currency_mismatch', 'A valid, explicit receipt currency is required.')
  return normalized
}

export function summarizeReceivablePayments(
  receivable: ReceivablePaymentState,
  payments: readonly ReceivablePaymentLink[]
) {
  integer(receivable.amount, true)
  const baseline = integer(receivable.unattributed_received_amount)
  const denomination = currency(receivable.currency)
  const active = payments.filter(
    (payment) => payment.receivable_id === receivable.id && payment.reversed_at === null
  )
  const transactionIds = new Set<string>()
  let linkedAmount = 0
  for (const payment of active) {
    if (transactionIds.has(payment.transaction_id))
      fail('invalid_payment_provenance', 'A bank transaction appears more than once in receipts.')
    transactionIds.add(payment.transaction_id)
    if (currency(payment.currency) !== denomination)
      fail('currency_mismatch', 'Receipt currency does not match the expected income currency.')
    linkedAmount = integer(linkedAmount + integer(payment.amount, true))
  }
  const receivedAmount = integer(baseline + linkedAmount)
  if (receivedAmount > receivable.amount)
    fail('payment_amount_mismatch', 'Recorded receipts exceed the expected receivable amount.')
  const status =
    receivable.status === 'cancelled'
      ? 'cancelled'
      : receivedAmount === receivable.amount
        ? 'received'
        : receivedAmount > 0
          ? 'partial'
          : 'open'
  return {
    receivedAmount,
    remainingAmount: receivable.amount - receivedAmount,
    linkedAmount,
    unattributedReceivedAmount: baseline,
    activePaymentCount: active.length,
    matchedTransactionId: active.length === 1 ? active[0]!.transaction_id : null,
    status,
  } as const
}

export function assertReceivablePaymentState(
  receivable: ReceivablePaymentState,
  payments: readonly ReceivablePaymentLink[]
) {
  const summary = summarizeReceivablePayments(receivable, payments)
  if (
    summary.receivedAmount !== receivable.received_amount ||
    summary.matchedTransactionId !== receivable.matched_transaction_id ||
    summary.status !== receivable.status
  )
    fail(
      'invalid_payment_provenance',
      'Receivable totals or legacy payment evidence do not agree with preserved receipt links. Review the record before matching.'
    )
  return summary
}

export function planReceivablePayment(input: {
  receivable: ReceivablePaymentState
  payments: readonly ReceivablePaymentLink[]
  income: ReceivableIncomeEvidence
}) {
  const { receivable, payments, income } = input
  const before = assertReceivablePaymentState(receivable, payments)
  const existing = payments.find(
    (payment) => payment.transaction_id === income.id && payment.reversed_at === null
  )
  if (existing) {
    if (existing.receivable_id !== receivable.id)
      fail(
        'transaction_already_matched',
        'This income transaction already settles another receivable.'
      )
    return { replayed: true, before, after: before, payment: existing } as const
  }
  if (receivable.status !== 'open' && receivable.status !== 'partial')
    fail('receivable_not_open', `A ${receivable.status} receivable cannot receive another payment.`)
  if (income.type !== 'income')
    fail('transaction_not_income', 'Only income can settle a receivable.')
  if (income.status !== 'posted' && income.status !== 'cleared')
    fail(
      'transaction_not_posted',
      'The income transaction must be posted or cleared before matching.'
    )
  if (income.is_archived === 1 || income.account_is_archived === 1)
    fail('transaction_archived', 'The income transaction and its account must not be archived.')
  if (income.account_mode === 'snapshot_only')
    fail('snapshot_only_account', 'Snapshot-only accounts cannot supply bank payment evidence.')
  if (income.ledger_treatment !== 'normal')
    fail('transaction_non_normal_ledger_treatment', 'Staged income cannot settle a receivable.')
  if (
    (income.transaction_kind ?? 'standard') !== 'standard' ||
    (income.reporting_treatment ?? 'normal') !== 'normal' ||
    income.matched_transaction_id ||
    income.is_card_payment ||
    income.is_non_income_classification
  )
    fail(
      'protected_transaction',
      'The transaction is reserved financial evidence or is not ordinary income.'
    )
  if (currency(income.currency) !== currency(receivable.currency))
    fail('currency_mismatch', 'The income transaction currency must match the receivable currency.')
  if (receivable.account_id && income.account_id !== receivable.account_id)
    fail('account_mismatch', 'The income transaction account must match the receivable account.')
  const amount = integer(income.amount, true)
  if (amount > before.remainingAmount)
    fail(
      'payment_amount_mismatch',
      'The payment exceeds the remaining receivable. Split allocation across invoices is not supported.'
    )
  const receivedAmount = before.receivedAmount + amount
  const count = before.activePaymentCount + 1
  return {
    replayed: false,
    before,
    after: {
      receivedAmount,
      remainingAmount: receivable.amount - receivedAmount,
      linkedAmount: before.linkedAmount + amount,
      unattributedReceivedAmount: before.unattributedReceivedAmount,
      activePaymentCount: count,
      matchedTransactionId: count === 1 ? income.id : null,
      status: receivedAmount === receivable.amount ? ('received' as const) : ('partial' as const),
    },
    payment: null,
  } as const
}

export function planReceivablePaymentReversal(input: {
  receivable: ReceivablePaymentState
  payments: readonly ReceivablePaymentLink[]
  paymentId?: string
  all?: boolean
}) {
  const { receivable, payments, paymentId, all } = input
  const before = assertReceivablePaymentState(receivable, payments)
  if (paymentId && all)
    fail('conflicting_payment_selection', 'Select paymentId or all=true, not both.')
  const owned = payments.filter((payment) => payment.receivable_id === receivable.id)
  const selected = paymentId ? owned.find((payment) => payment.id === paymentId) : null
  if (paymentId && !selected)
    fail('payment_not_found', 'The selected payment does not belong to this receivable.')
  if (selected?.reversed_at)
    return { replayed: true, before, after: before, paymentIds: [] as string[] } as const
  const active = owned.filter((payment) => payment.reversed_at === null)
  if (!paymentId && !all && active.length > 1)
    fail(
      'payment_selection_required',
      'This receivable has several payments. Select paymentId or explicitly use all=true.'
    )
  const targets = selected ? [selected] : all ? active : active.slice(0, 1)
  if (!targets.length) {
    if (all) return { replayed: true, before, after: before, paymentIds: [] as string[] } as const
    fail('receivable_not_matched', 'This receivable has no active matched payment.')
  }
  const ids = new Set(targets.map((payment) => payment.id))
  const after = summarizeReceivablePayments(
    receivable,
    payments.map((payment) =>
      ids.has(payment.id) ? { ...payment, reversed_at: 'preview' } : payment
    )
  )
  return { replayed: false, before, after, paymentIds: [...ids] } as const
}
