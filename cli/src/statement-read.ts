import { query, fromCentavos, dayjs, nextDateForDay } from './tools/shared.js'

export type StatementStatus = 'open' | 'partial' | 'paid' | 'overdue'

type StatementDisplayAmounts = {
  statement_balance: number
  minimum_payment: number
  paid_amount: number
}

type StatementDisplayRow = StatementDisplayAmounts & {
  due_date: string
  status: StatementStatus
}

type CreditCardBillStatementRow = StatementDisplayRow & {
  id: string
  account_id: string
  account_name?: string | null
  currency: string
}

type CreditCardBillAccountRow = {
  id: string
  name: string
  currency: string
  balance: number
  payment_due_day: number | null
}

export type CreditCardBillEntry = {
  name: string
  amount: number
  currency: string
  dueDate: string
  source: 'credit_card'
  daysUntilDue: number
  accountId: string
  statementId: string | null
  statementBalance: number | null
  minimumPayment: number | null
  minimumPaymentDue: number | null
  paidAmount: number | null
  paymentStatus: StatementStatus | 'estimated'
}

export function paymentAmounts(statement: StatementDisplayAmounts) {
  const amountToPayCentavos = Math.max(statement.statement_balance - statement.paid_amount, 0)
  const minimumPaymentDueCentavos = Math.max(
    Math.min(statement.minimum_payment, statement.statement_balance) - statement.paid_amount,
    0
  )

  return {
    amountToPayCentavos,
    amountToPay: fromCentavos(amountToPayCentavos),
    minimumPaymentDueCentavos,
    minimumPaymentDue: fromCentavos(minimumPaymentDueCentavos),
  }
}

// Display precedence intentionally differs from core payment-write status. Without an explicit
// as-of date, evaluate today at each comparison, not once for an entire read or at module load.
export function effectiveStatementStatus(
  statement: StatementDisplayRow,
  asOf?: dayjs.Dayjs
): StatementStatus {
  const payment = paymentAmounts(statement)
  if (payment.amountToPayCentavos <= 0) return 'paid'
  if (
    statement.status === 'overdue' ||
    dayjs(statement.due_date).isBefore(asOf ?? dayjs(), 'day')
  ) {
    return 'overdue'
  }
  if (statement.status === 'partial' || statement.paid_amount > 0) return 'partial'
  return 'open'
}

export function getCreditCardBillEntries(daysAhead: number): CreditCardBillEntry[] {
  const today = dayjs()
  const cutoff = today.add(daysAhead, 'day').format('YYYY-MM-DD')
  const todayDate = today.format('YYYY-MM-DD')
  const statementRows = query<CreditCardBillStatementRow>(
    `SELECT s.*, a.name as account_name, a.currency as account_currency
     FROM credit_card_statements s
     JOIN accounts a ON s.account_id = a.id
     WHERE a.type = 'credit_card'
       AND a.is_archived = 0
       AND s.due_date <= $1
     ORDER BY s.due_date ASC, s.statement_end_date DESC`,
    [cutoff]
  )

  const bills: CreditCardBillEntry[] = []
  const accountsWithUnpaidStatements = new Set<string>()
  for (const statement of statementRows) {
    const payment = paymentAmounts(statement)
    accountsWithUnpaidStatements.add(statement.account_id)
    if (payment.amountToPayCentavos <= 0) continue

    bills.push({
      name: `${statement.account_name ?? statement.account_id} payment`,
      amount: payment.amountToPay,
      currency: statement.currency,
      dueDate: statement.due_date,
      source: 'credit_card',
      daysUntilDue: dayjs(statement.due_date).diff(today, 'day'),
      accountId: statement.account_id,
      statementId: statement.id,
      statementBalance: fromCentavos(statement.statement_balance),
      minimumPayment: fromCentavos(statement.minimum_payment),
      minimumPaymentDue: payment.minimumPaymentDue,
      paidAmount: fromCentavos(statement.paid_amount),
      paymentStatus: effectiveStatementStatus(statement),
    })
  }

  const fallbackCards = query<CreditCardBillAccountRow>(
    "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND payment_due_day IS NOT NULL"
  )
  for (const card of fallbackCards) {
    if (!card.payment_due_day || accountsWithUnpaidStatements.has(card.id)) continue
    const dueDate = nextDateForDay(card.payment_due_day)
    const dueDateText = dueDate.format('YYYY-MM-DD')
    if (dueDateText < todayDate || dueDateText > cutoff) continue
    const amount = fromCentavos(Math.abs(card.balance))
    bills.push({
      name: `${card.name} payment`,
      amount,
      currency: card.currency,
      dueDate: dueDateText,
      source: 'credit_card',
      daysUntilDue: dueDate.diff(today, 'day'),
      accountId: card.id,
      statementId: null,
      statementBalance: null,
      minimumPayment: null,
      minimumPaymentDue: null,
      paidAmount: null,
      paymentStatus: 'estimated',
    })
  }

  return bills.sort((a, b) => a.daysUntilDue - b.daysUntilDue)
}
