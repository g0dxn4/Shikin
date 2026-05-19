import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  nextDateForDay,
  boundedText,
  positiveMoneyAmount,
  nonNegativeMoneyAmount,
  isoDate,
  currencyCode,
  normalizeCurrencyCode,
  resolveAccountId,
  getAccountAliases,
  normalizeAccountAlias,
  resolveCategoryId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  findTransactionDuplicate,
  transactionDuplicateReason,
  type TransactionDuplicateCheck,
} from '../duplicate-detection.js'

type StatementStatus = 'open' | 'partial' | 'paid' | 'overdue'

type CreditCardAccountRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
  credit_limit: number | null
  statement_closing_day: number | null
  payment_due_day: number | null
  is_archived: number
}

type CreditCardStatementRow = {
  id: string
  account_id: string
  statement_start_date: string | null
  statement_end_date: string
  due_date: string
  statement_balance: number
  minimum_payment: number
  paid_amount: number
  currency: string
  status: StatementStatus
  source: string | null
  note: string | null
  created_at?: string | null
  updated_at?: string | null
  account_name?: string | null
  account_currency?: string | null
  account_type?: string | null
  account_is_archived?: number | null
}

type StatementAccountFilterRow = {
  id: string
  type: string
  is_archived: number
}

type PaymentSourceAccountRow = {
  id: string
  name: string
  type: string
  currency: string | null
  balance: number
  is_archived: number
}

type CardPaymentMode = 'transfer' | 'cleanup-expense' | 'statement-payment-only'

type CardPaymentTransactionPreview = {
  id: string
  accountId: string
  accountName: string
  transferToAccountId: string | null
  transferToAccountName: string | null
  categoryId: string | null
  type: 'expense' | 'transfer'
  amount: number
  amountCentavos: number
  currency: string
  description: string
  notes: string | null
  source: string | null
  note: string | null
  status: 'posted'
  date: string
}

type CardPaymentBalanceChange = {
  accountId: string
  accountName: string
  previousBalance: number
  newBalance: number
  delta: number
  previousBalanceCentavos: number
  newBalanceCentavos: number
  deltaCentavos: number
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

const statementStatusSchema = z.enum(['open', 'partial', 'paid', 'overdue'])

const cardPaymentModeSchema = z.enum(['transfer', 'cleanup-expense', 'statement-payment-only'])
const STATEMENT_FILTER_SCAN_LIMIT = 1000

function paymentAmounts(statement: {
  statement_balance: number
  minimum_payment: number
  paid_amount: number
}) {
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

function effectiveStatementStatus(statement: CreditCardStatementRow): StatementStatus {
  const payment = paymentAmounts(statement)
  if (payment.amountToPayCentavos <= 0) return 'paid'
  if (statement.status === 'overdue' || dayjs(statement.due_date).isBefore(dayjs(), 'day')) {
    return 'overdue'
  }
  if (statement.status === 'partial' || statement.paid_amount > 0) return 'partial'
  return 'open'
}

function effectiveStatementStatusAsOf(
  statement: CreditCardStatementRow,
  asOf: dayjs.Dayjs
): StatementStatus {
  const payment = paymentAmounts(statement)
  if (payment.amountToPayCentavos <= 0) return 'paid'
  if (statement.status === 'overdue' || dayjs(statement.due_date).isBefore(asOf, 'day')) {
    return 'overdue'
  }
  if (statement.status === 'partial' || statement.paid_amount > 0) return 'partial'
  return 'open'
}

function deriveStatementStatus(input: {
  statementBalance: number
  paidAmount: number
  dueDate: string
  explicitStatus?: StatementStatus
}): StatementStatus {
  if (input.explicitStatus) return input.explicitStatus
  if (input.statementBalance <= 0 || input.paidAmount >= input.statementBalance) return 'paid'
  if (input.paidAmount > 0) return 'partial'
  return dayjs(input.dueDate).isBefore(dayjs(), 'day') ? 'overdue' : 'open'
}

function validateStatementStatusConsistency(input: {
  status: StatementStatus
  statementBalance: number
  paidAmount: number
  currency: string
}) {
  const payment = paymentAmounts({
    statement_balance: input.statementBalance,
    minimum_payment: 0,
    paid_amount: input.paidAmount,
  })

  if (input.status === 'paid' && payment.amountToPayCentavos > 0) {
    return {
      success: false as const,
      reason: 'statement_status_inconsistent',
      message: `Statement status cannot be paid while ${payment.amountToPay.toFixed(2)} ${input.currency} remains unpaid.`,
    }
  }

  return { success: true as const }
}

function readPaymentSourceAccount(accountId: string) {
  const account = query<PaymentSourceAccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [
    accountId,
  ])[0]

  if (!account) {
    return {
      success: false as const,
      reason: 'account_not_found',
      message: `Account ${accountId} not found.`,
    }
  }
  if (account.is_archived === 1) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Account ${accountId} is archived. Unarchive it before using it for new writes.`,
    }
  }
  if (account.type === 'credit_card') {
    return {
      success: false as const,
      reason: 'source_account_cannot_be_credit_card',
      message:
        'fromAccount must resolve to a checking, cash, savings, or other non-credit-card account.',
    }
  }
  if (!normalizeCurrencyCode(account.currency ?? undefined)) {
    return {
      success: false as const,
      reason: 'source_account_currency_missing',
      message: `Account ${accountId} is missing a currency. Repair it before recording card payments.`,
    }
  }

  return { success: true as const, account }
}

function resolvePaymentSourceAccount(fromAccount: string) {
  const resolved = resolveAccountId(undefined, fromAccount)
  if (!resolved.success) return resolved
  return readPaymentSourceAccount(resolved.id)
}

function formatCardPaymentBalanceImpact(changes: CardPaymentBalanceChange[]) {
  return {
    affectsBalances: changes.length > 0,
    accounts: changes,
    deltas: changes,
  }
}

function buildCardPaymentBalanceImpact(input: {
  mode: CardPaymentMode
  amountCentavos: number
  fromAccount: PaymentSourceAccountRow | null
  cardAccount: CreditCardAccountRow
}) {
  const changes: CardPaymentBalanceChange[] = []
  const addChange = (
    account: { id: string; name: string; balance: number },
    deltaCentavos: number
  ) => {
    changes.push({
      accountId: account.id,
      accountName: account.name,
      previousBalance: fromCentavos(account.balance),
      newBalance: fromCentavos(account.balance + deltaCentavos),
      delta: fromCentavos(deltaCentavos),
      previousBalanceCentavos: account.balance,
      newBalanceCentavos: account.balance + deltaCentavos,
      deltaCentavos,
    })
  }

  if (input.mode === 'transfer' && input.fromAccount) {
    addChange(input.fromAccount, -input.amountCentavos)
    addChange(input.cardAccount, input.amountCentavos)
  }
  if (input.mode === 'cleanup-expense' && input.fromAccount) {
    addChange(input.fromAccount, -input.amountCentavos)
  }

  return formatCardPaymentBalanceImpact(changes)
}

function cardPaymentTransactionSnapshot(transaction: CardPaymentTransactionPreview) {
  return transaction
}

function cardPaymentDuplicateWarnings(duplicateCheck: TransactionDuplicateCheck) {
  const match = duplicateCheck.match
  if (!match) return []
  return [
    {
      type: match.kind,
      reason: transactionDuplicateReason(match.kind),
      existingTransactionId: match.existingTransactionId,
      accountId: match.accountId,
      date: match.date,
      amount: fromCentavos(match.amountCentavos),
      amountCentavos: match.amountCentavos,
      daysApart: match.daysApart,
      descriptionSimilarity: match.descriptionSimilarity,
      message:
        match.kind === 'exact_duplicate'
          ? `Exact duplicate transaction ${match.existingTransactionId} already exists.`
          : `Potential duplicate transaction ${match.existingTransactionId} is within ${match.windowDays} days with similar description.`,
    },
  ]
}

function buildStatementPaymentImpact(input: {
  statement: CreditCardStatementRow
  amountCentavos: number
  source?: string
  note?: string
}) {
  const previousPaidAmountCentavos = input.statement.paid_amount
  const newPaidAmountCentavos = previousPaidAmountCentavos + input.amountCentavos
  const updatedStatement: CreditCardStatementRow = {
    ...input.statement,
    paid_amount: newPaidAmountCentavos,
    status: deriveStatementStatus({
      statementBalance: input.statement.statement_balance,
      paidAmount: newPaidAmountCentavos,
      dueDate: input.statement.due_date,
    }),
    source: input.source !== undefined ? input.source : input.statement.source,
    note: input.note !== undefined ? input.note : input.statement.note,
  }
  const payment = paymentAmounts(updatedStatement)

  return {
    statement: updatedStatement,
    preview: {
      statementId: input.statement.id,
      accountId: input.statement.account_id,
      previousPaidAmount: fromCentavos(previousPaidAmountCentavos),
      previousPaidAmountCentavos,
      newPaidAmount: fromCentavos(newPaidAmountCentavos),
      newPaidAmountCentavos,
      paidDelta: fromCentavos(input.amountCentavos),
      paidDeltaCentavos: input.amountCentavos,
      statementBalance: fromCentavos(input.statement.statement_balance),
      statementBalanceCentavos: input.statement.statement_balance,
      amountToPay: payment.amountToPay,
      amountToPayCentavos: payment.amountToPayCentavos,
      minimumPaymentDue: payment.minimumPaymentDue,
      minimumPaymentDueCentavos: payment.minimumPaymentDueCentavos,
      previousPaymentStatus: effectiveStatementStatus(input.statement),
      paymentStatus: effectiveStatementStatus(updatedStatement),
      dueDate: input.statement.due_date,
    },
  }
}

function statementSnapshot(statement: CreditCardStatementRow) {
  const payment = paymentAmounts(statement)
  const paymentStatus = effectiveStatementStatus(statement)

  return {
    id: statement.id,
    accountId: statement.account_id,
    accountName: statement.account_name ?? null,
    statementPeriod: {
      startDate: statement.statement_start_date,
      endDate: statement.statement_end_date,
      closingDate: statement.statement_end_date,
    },
    statementStartDate: statement.statement_start_date,
    statementEndDate: statement.statement_end_date,
    closingDate: statement.statement_end_date,
    dueDate: statement.due_date,
    statementBalance: fromCentavos(statement.statement_balance),
    statementBalanceCentavos: statement.statement_balance,
    minimumPayment: fromCentavos(statement.minimum_payment),
    minimumPaymentCentavos: statement.minimum_payment,
    paidAmount: fromCentavos(statement.paid_amount),
    paidAmountCentavos: statement.paid_amount,
    ...payment,
    currency: statement.currency,
    status: statement.status,
    paymentStatus,
    source: statement.source,
    note: statement.note,
    createdAt: statement.created_at ?? null,
    updatedAt: statement.updated_at ?? null,
  }
}

function statementAuditSnapshot(statement: CreditCardStatementRow) {
  return statementSnapshot(statement)
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

function resolveClosingDate(input: {
  statementEndDate?: string
  closingDate?: string
}): { success: true; date: string } | { success: false; reason: string; message: string } {
  if (input.statementEndDate && input.closingDate && input.statementEndDate !== input.closingDate) {
    return {
      success: false,
      reason: 'statement_date_conflict',
      message: 'Use either statementEndDate or closingDate, or pass the same date for both.',
    }
  }

  const date = input.statementEndDate ?? input.closingDate
  if (!date) {
    return {
      success: false,
      reason: 'statement_closing_date_required',
      message: 'statementEndDate or closingDate is required.',
    }
  }

  return { success: true, date }
}

function validateStatementDates(input: {
  statementStartDate?: string | null
  statementEndDate: string
  dueDate: string
}) {
  if (
    input.statementStartDate &&
    dayjs(input.statementStartDate).isAfter(dayjs(input.statementEndDate), 'day')
  ) {
    return {
      success: false as const,
      reason: 'invalid_statement_dates',
      message: 'statementStartDate must be on or before statementEndDate.',
    }
  }

  if (dayjs(input.dueDate).isBefore(dayjs(input.statementEndDate), 'day')) {
    return {
      success: false as const,
      reason: 'invalid_statement_dates',
      message: 'dueDate must be on or after the statement closing date.',
    }
  }

  return { success: true as const }
}

function getCreditCardAccountById(accountId: string) {
  const account = query<CreditCardAccountRow>('SELECT * FROM accounts WHERE id = $1 LIMIT 1', [
    accountId,
  ])[0]

  if (!account) {
    return {
      success: false as const,
      reason: 'account_not_found',
      message: `Account ${accountId} not found.`,
    }
  }
  if (account.is_archived === 1) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Account ${accountId} is archived. Unarchive it before using it for new writes.`,
    }
  }
  if (account.type !== 'credit_card') {
    return {
      success: false as const,
      reason: 'not_credit_card',
      message: `Account ${accountId} is not a credit card account.`,
    }
  }

  return { success: true as const, account }
}

function resolveCreditCardAccount(accountId?: string, account?: string) {
  if (accountId && account) {
    return {
      success: false as const,
      reason: 'account_reference_conflict',
      message: 'Use either accountId or account, not both.',
    }
  }

  if (accountId) return getCreditCardAccountById(accountId)

  if (account) {
    const resolved = resolveAccountId(undefined, account)
    if (!resolved.success) return resolved
    return getCreditCardAccountById(resolved.id)
  }

  const cards = query<CreditCardAccountRow>(
    "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 ORDER BY name ASC, id ASC LIMIT 2"
  )
  if (cards.length === 0) {
    return {
      success: false as const,
      reason: 'credit_card_not_found',
      message: 'No active credit card accounts found. Provide accountId after creating one.',
    }
  }
  if (cards.length > 1) {
    return {
      success: false as const,
      reason: 'account_required',
      message: 'Multiple credit cards found. Provide accountId or account explicitly.',
    }
  }

  return { success: true as const, account: cards[0] }
}

function getStatementAccountById(accountId: string, includeArchivedAccounts: boolean) {
  const account = query<StatementAccountFilterRow>(
    'SELECT id, type, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  )[0]
  if (!account) {
    return {
      success: false as const,
      reason: 'account_not_found',
      message: `Account ${accountId} not found.`,
    }
  }
  if (account.type !== 'credit_card') {
    return {
      success: false as const,
      reason: 'not_credit_card',
      message: `Account ${accountId} is not a credit card account.`,
    }
  }
  if (account.is_archived === 1 && !includeArchivedAccounts) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Account ${accountId} is archived. Pass includeArchivedAccounts to list its statements.`,
    }
  }
  return { success: true as const, accountId: account.id }
}

function resolveStatementAccountFilter(
  accountId?: string,
  account?: string,
  includeArchivedAccounts = false
) {
  if (accountId && account) {
    return {
      success: false as const,
      reason: 'account_reference_conflict',
      message: 'Use either accountId or account, not both.',
    }
  }
  if (accountId) return getStatementAccountById(accountId, includeArchivedAccounts)
  if (!account) return { success: true as const, accountId: null }

  const aliasAccountId = getAccountAliases()[normalizeAccountAlias(account)]
  if (aliasAccountId) return getStatementAccountById(aliasAccountId, includeArchivedAccounts)

  const matches = query<StatementAccountFilterRow>(
    `SELECT id, type, is_archived
     FROM accounts
     WHERE id = $1 OR LOWER(name) = LOWER($2)
     ORDER BY id ASC
     LIMIT 2`,
    [account, account]
  )
  const creditCards = matches.filter((row) => row.type === 'credit_card')
  const visible = includeArchivedAccounts
    ? creditCards
    : creditCards.filter((row) => row.is_archived !== 1)

  if (visible.length === 1) return { success: true as const, accountId: visible[0].id }
  if (visible.length > 1) {
    return {
      success: false as const,
      reason: 'account_match_ambiguous',
      message: `Account reference "${account}" matches multiple credit card accounts. Use accountId.`,
    }
  }
  if (creditCards.length > 0) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Account reference "${account}" only matches archived credit card accounts. Pass includeArchivedAccounts to list their statements.`,
    }
  }
  return {
    success: false as const,
    reason: 'credit_card_not_found',
    message: `Credit card account "${account}" not found.`,
  }
}

function resolveStatementCurrency(accountCurrency: string, currency?: string) {
  const normalizedAccountCurrency = normalizeCurrencyCode(accountCurrency)
  const normalizedCurrency = normalizeCurrencyCode(currency ?? accountCurrency)
  if (!normalizedAccountCurrency || !normalizedCurrency) {
    return {
      success: false as const,
      reason: 'statement_currency_invalid',
      message: 'Credit card statements require a valid account currency.',
    }
  }

  if (normalizedCurrency !== normalizedAccountCurrency) {
    return {
      success: false as const,
      reason: 'statement_currency_mismatch',
      message: `Statement currency ${normalizedCurrency} does not match credit card account currency ${normalizedAccountCurrency}.`,
    }
  }

  return { success: true as const, currency: normalizedCurrency }
}

function getStatement(statementId: string): CreditCardStatementRow | null {
  return (
    query<CreditCardStatementRow>(
      `SELECT s.*, a.name as account_name, a.currency as account_currency, a.type as account_type,
              a.is_archived as account_is_archived
       FROM credit_card_statements s
       LEFT JOIN accounts a ON s.account_id = a.id
       WHERE s.id = $1
       LIMIT 1`,
      [statementId]
    )[0] ?? null
  )
}

function ensureStatementWritable(statement: CreditCardStatementRow) {
  if (statement.account_is_archived === 1) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Account ${statement.account_id} is archived. Unarchive it before changing linked statements.`,
    }
  }
  if (statement.account_type && statement.account_type !== 'credit_card') {
    return {
      success: false as const,
      reason: 'not_credit_card',
      message: `Account ${statement.account_id} is not a credit card account.`,
    }
  }
  return { success: true as const }
}

function statementConflictExists(
  accountId: string,
  statementEndDate: string,
  excludingId?: string
) {
  const params: unknown[] = [accountId, statementEndDate]
  const idFilter = excludingId ? ' AND id <> $3' : ''
  if (excludingId) params.push(excludingId)
  const existing = (query<{ id: string }>(
    `SELECT id FROM credit_card_statements WHERE account_id = $1 AND statement_end_date = $2${idFilter} LIMIT 1`,
    params
  ) ?? [])[0]
  return existing ?? null
}

function previousDateForDay(day: number): dayjs.Dayjs {
  const today = dayjs()
  const thisMonth = today.date(Math.min(day, today.daysInMonth()))
  if (thisMonth.isBefore(today, 'day') || thisMonth.isSame(today, 'day')) return thisMonth
  const previousMonth = today.subtract(1, 'month')
  return previousMonth.date(Math.min(day, previousMonth.daysInMonth()))
}

function dateForDayInMonth(month: dayjs.Dayjs, day: number): dayjs.Dayjs {
  return month.date(Math.min(day, month.daysInMonth()))
}

function nextDateForDayAfter(day: number, afterDate: dayjs.Dayjs): dayjs.Dayjs {
  const sameMonth = dateForDayInMonth(afterDate, day)
  if (sameMonth.isAfter(afterDate, 'day')) return sameMonth
  return dateForDayInMonth(afterDate.add(1, 'month'), day)
}

function previousClosingBefore(closingDate: dayjs.Dayjs, closingDay: number): dayjs.Dayjs {
  const previousMonth = closingDate.subtract(1, 'month')
  return dateForDayInMonth(previousMonth, closingDay)
}

function cycleForDate(input: {
  closingDay: number
  dueDay: number
  date: dayjs.Dayjs
  explicitClosingDate?: string
  explicitDueDate?: string
}) {
  const currentCycleClosing = input.explicitClosingDate
    ? dayjs(input.explicitClosingDate)
    : (() => {
        const thisMonthClosing = dateForDayInMonth(input.date, input.closingDay)
        return input.date.isAfter(thisMonthClosing, 'day')
          ? dateForDayInMonth(input.date.add(1, 'month'), input.closingDay)
          : thisMonthClosing
      })()
  const previousClosing = previousClosingBefore(currentCycleClosing, input.closingDay)
  const nextCycleClosing = dateForDayInMonth(currentCycleClosing.add(1, 'month'), input.closingDay)
  const currentCycleExpectedDue = input.explicitDueDate
    ? dayjs(input.explicitDueDate)
    : nextDateForDayAfter(input.dueDay, currentCycleClosing)
  const nextCycleExpectedDue = nextDateForDayAfter(input.dueDay, nextCycleClosing)

  return {
    currentCycleStartDate: previousClosing.add(1, 'day').format('YYYY-MM-DD'),
    currentCycleClosingDate: currentCycleClosing.format('YYYY-MM-DD'),
    currentCycleExpectedDueDate: currentCycleExpectedDue.format('YYYY-MM-DD'),
    nextCycleStartDate: currentCycleClosing.add(1, 'day').format('YYYY-MM-DD'),
    nextClosingDate: nextCycleClosing.format('YYYY-MM-DD'),
    nextCycleExpectedDueDate: nextCycleExpectedDue.format('YYYY-MM-DD'),
  }
}

function getLatestStatementForAccount(accountId: string): CreditCardStatementRow | null {
  return (
    query<CreditCardStatementRow>(
      `SELECT s.*
       FROM credit_card_statements s
       WHERE s.account_id = $1
       ORDER BY s.statement_end_date DESC, s.created_at DESC, s.id DESC
       LIMIT 1`,
      [accountId]
    )[0] ?? null
  )
}

function getCurrentPeriodSpending(
  card: CreditCardAccountRow,
  latest: CreditCardStatementRow | null
) {
  const today = dayjs().format('YYYY-MM-DD')
  const startDate = latest?.statement_end_date
    ? dayjs(latest.statement_end_date).add(1, 'day').format('YYYY-MM-DD')
    : card.statement_closing_day
      ? previousDateForDay(card.statement_closing_day).add(1, 'day').format('YYYY-MM-DD')
      : dayjs().startOf('month').format('YYYY-MM-DD')

  const total =
    query<{ total: number | null }>(
      `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE account_id = $1
       AND type = 'expense'
       AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
       AND date >= $2 AND date <= $3`,
      [card.id, startDate, today]
    )[0]?.total ?? 0

  return {
    startDate,
    endDate: today,
    spending: fromCentavos(total),
    spendingCentavos: total,
  }
}

const recordCardPayment: ToolDefinition = {
  name: 'record-card-payment',
  description:
    'Record or preview a credit-card payment as an accounting transfer, cleanup expense, or statement-only payment update.',
  schema: z.object({
    fromAccount: boundedText(
      'Source account reference',
      'Paying account alias, ID, or exact name. Required unless mode is statement-payment-only',
      128
    ).optional(),
    cardAccount: boundedText('Card account reference', 'Credit card alias, ID, or exact name', 128),
    amount: positiveMoneyAmount('Payment amount in the main currency unit'),
    date: isoDate('Payment date').optional(),
    mode: cardPaymentModeSchema.optional().default('transfer'),
    statementId: boundedText('Statement ID', 'Statement to mark as paid', 128).optional(),
    applyToLatestStatement: z
      .boolean()
      .optional()
      .default(false)
      .describe('Apply the payment amount to the latest statement for the card account'),
    description: boundedText('Description', 'Transaction description', 240).optional(),
    category: boundedText(
      'Category reference',
      'Category ID or exact category name for cleanup-expense mode',
      128
    ).optional(),
    notes: z.string().trim().max(2000).optional().describe('Transaction notes'),
    source: z.string().trim().max(120).optional().describe('Automation source or origin label'),
    note: z.string().trim().max(1000).optional().describe('Workflow changelog note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
    allowDuplicate: z
      .boolean()
      .optional()
      .default(false)
      .describe('Allow recording even when a similar transaction already exists'),
  }),
  execute: async ({
    fromAccount,
    cardAccount,
    amount,
    date,
    mode,
    statementId,
    applyToLatestStatement,
    description,
    category,
    notes,
    source,
    note,
    dryRun,
    allowDuplicate,
  }) => {
    const paymentDate = date ?? dayjs().format('YYYY-MM-DD')
    const amountCentavos = toCentavos(amount)
    const warnings: Array<{ type: string; message: string; [key: string]: unknown }> = []

    const resolvedCard = resolveCreditCardAccount(undefined, cardAccount)
    if (!resolvedCard.success) return resolvedCard
    const card = resolvedCard.account

    let sourceAccount: PaymentSourceAccountRow | null = null
    if (mode !== 'statement-payment-only') {
      if (!fromAccount) {
        return {
          success: false,
          reason: 'from_account_required',
          message: 'fromAccount is required unless mode is statement-payment-only.',
        }
      }
      const resolvedSource = resolvePaymentSourceAccount(fromAccount)
      if (!resolvedSource.success) return resolvedSource
      sourceAccount = resolvedSource.account
      if (
        normalizeCurrencyCode(sourceAccount.currency ?? undefined) !==
        normalizeCurrencyCode(card.currency)
      ) {
        return {
          success: false,
          reason: 'currency_mismatch',
          message: `Payment source currency ${sourceAccount.currency} does not match card currency ${card.currency}.`,
        }
      }
    }

    let categoryId: string | null = null
    if (mode === 'cleanup-expense') {
      if (!category) {
        return {
          success: false,
          reason: 'category_required',
          message:
            'category is required for cleanup-expense mode so the cleanup spend is explicit.',
        }
      }
      const resolvedCategory = resolveCategoryId(category)
      if (!resolvedCategory.success) return resolvedCategory
      categoryId = resolvedCategory.id
    }

    if (mode !== 'cleanup-expense' && category) {
      warnings.push({
        type: 'category_ignored',
        message: 'category is only used for cleanup-expense mode and will be ignored.',
      })
    }

    let selectedStatement: CreditCardStatementRow | null = null
    if (statementId) {
      selectedStatement = getStatement(statementId)
      if (!selectedStatement) {
        return {
          success: false,
          reason: 'statement_not_found',
          message: `Credit card statement ${statementId} not found.`,
        }
      }
      const writable = ensureStatementWritable(selectedStatement)
      if (!writable.success) return writable
      if (selectedStatement.account_id !== card.id) {
        return {
          success: false,
          reason: 'statement_card_mismatch',
          message: `Statement ${statementId} belongs to account ${selectedStatement.account_id}, not ${card.id}.`,
        }
      }
    } else if (applyToLatestStatement) {
      selectedStatement = getLatestStatementForAccount(card.id)
      if (!selectedStatement) {
        warnings.push({
          type: 'statement_not_found',
          message:
            'No latest statement exists for this card account; no statement paid amount will be updated.',
        })
      }
    }

    if (mode === 'statement-payment-only' && !selectedStatement) {
      return {
        success: false,
        reason: 'statement_required',
        message:
          'statement-payment-only mode requires statementId or applyToLatestStatement with an existing statement.',
        warnings,
      }
    }

    const statementImpact = selectedStatement
      ? buildStatementPaymentImpact({ statement: selectedStatement, amountCentavos, source, note })
      : null

    const transactionDescription =
      description ??
      (mode === 'cleanup-expense'
        ? `Credit card payment cleanup: ${card.name}`
        : `Credit card payment: ${card.name}`)
    const transactionPreview: CardPaymentTransactionPreview | null =
      mode === 'statement-payment-only' || !sourceAccount
        ? null
        : {
            id: generateId(),
            accountId: sourceAccount.id,
            accountName: sourceAccount.name,
            transferToAccountId: mode === 'transfer' ? card.id : null,
            transferToAccountName: mode === 'transfer' ? card.name : null,
            categoryId,
            type: mode === 'transfer' ? 'transfer' : 'expense',
            amount,
            amountCentavos,
            currency: normalizeCurrencyCode(sourceAccount.currency ?? card.currency),
            description: transactionDescription,
            notes: notes ?? null,
            source: source ?? null,
            note: note ?? null,
            status: 'posted',
            date: paymentDate,
          }

    const balanceImpact = buildCardPaymentBalanceImpact({
      mode,
      amountCentavos,
      fromAccount: sourceAccount,
      cardAccount: card,
    })

    const duplicateCheck = transactionPreview
      ? findTransactionDuplicate({
          accountId: transactionPreview.accountId,
          date: transactionPreview.date,
          amountCentavos,
          type: transactionPreview.type,
          status: transactionPreview.status,
          transferToAccountId: transactionPreview.transferToAccountId,
          description: transactionPreview.description,
        })
      : null
    const duplicateWarnings = duplicateCheck ? cardPaymentDuplicateWarnings(duplicateCheck) : []
    if (duplicateCheck?.match && !allowDuplicate && !dryRun) {
      return {
        success: false,
        reason: transactionDuplicateReason(duplicateCheck.match.kind),
        duplicate: duplicateCheck.match,
        duplicateCheck,
        duplicateWarnings,
        message:
          duplicateCheck.match.kind === 'exact_duplicate'
            ? `Exact duplicate transaction ${duplicateCheck.match.existingTransactionId} already exists. Re-run with allowDuplicate to record it anyway.`
            : `Potential duplicate transaction ${duplicateCheck.match.existingTransactionId} is within ${duplicateCheck.match.windowDays} days with similar description. Re-run with allowDuplicate to record it anyway.`,
      }
    }

    const wouldCreateTransactions = transactionPreview ? [transactionPreview] : []
    const wouldUpdateStatements = statementImpact ? [statementImpact.preview] : []
    const transactionAuditPreview = transactionPreview
      ? {
          entity: 'transaction',
          entityId: transactionPreview.id,
          action: 'create',
          before: null,
          after: {
            transaction: cardPaymentTransactionSnapshot(transactionPreview),
            balances: balanceImpact.accounts.map((change) => ({
              accountId: change.accountId,
              balanceCentavos: change.newBalanceCentavos,
              balance: change.newBalance,
            })),
          },
          source: source ?? null,
          note: note ?? null,
          balanceChanges: balanceImpact.accounts,
        }
      : null
    const statementAuditPreview = statementImpact
      ? {
          entity: 'credit_card_statement',
          entityId: statementImpact.statement.id,
          action: 'update',
          before: { statement: statementAuditSnapshot(selectedStatement!) },
          after: { statement: statementAuditSnapshot(statementImpact.statement) },
          source: source ?? null,
          note: note ?? null,
        }
      : null

    if (dryRun) {
      return {
        success: true,
        action: 'recorded' as const,
        dryRun: true,
        mode,
        amount,
        amountCentavos,
        wouldCreateTransactions,
        wouldUpdateStatements,
        balanceImpact,
        statementImpact: statementImpact?.preview ?? null,
        duplicateWarnings,
        duplicatePolicy: duplicateCheck?.match
          ? {
              allowDuplicate,
              applyBlocked: !allowDuplicate,
              reason: transactionDuplicateReason(duplicateCheck.match.kind),
            }
          : { allowDuplicate, applyBlocked: false, reason: null },
        warnings,
        auditPreview: [transactionAuditPreview, statementAuditPreview].filter(Boolean),
        message: `Dry run: ${mode} card payment for ${card.name} would be recorded.`,
      }
    }

    transaction(() => {
      if (transactionPreview) {
        execute(
          `INSERT INTO transactions
             (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            transactionPreview.id,
            transactionPreview.accountId,
            transactionPreview.categoryId,
            transactionPreview.transferToAccountId,
            transactionPreview.type,
            transactionPreview.amountCentavos,
            transactionPreview.currency,
            transactionPreview.description,
            transactionPreview.notes,
            transactionPreview.status,
            transactionPreview.source,
            transactionPreview.note,
            transactionPreview.date,
          ]
        )
        for (const change of balanceImpact.accounts) {
          execute(
            "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
            [change.deltaCentavos, change.accountId]
          )
        }
        writeAuditLog({
          entity: 'transaction',
          entityId: transactionPreview.id,
          action: 'create',
          before: null,
          after: transactionAuditPreview?.after ?? null,
          source,
          note,
        })
      }

      if (statementImpact) {
        const updateResult = execute(
          `UPDATE credit_card_statements
           SET paid_amount = $1, status = $2, source = $3, note = $4, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $5`,
          [
            statementImpact.statement.paid_amount,
            statementImpact.statement.status,
            statementImpact.statement.source,
            statementImpact.statement.note,
            statementImpact.statement.id,
          ]
        )
        assertSingleRowUpdated(
          updateResult,
          `Credit card statement ${statementImpact.statement.id} could not be updated safely.`
        )
        writeAuditLog({
          entity: 'credit_card_statement',
          entityId: statementImpact.statement.id,
          action: 'update',
          before: statementAuditPreview?.before ?? null,
          after: statementAuditPreview?.after ?? null,
          source,
          note,
        })
      }
    })

    return {
      success: true,
      action: 'recorded' as const,
      mode,
      transactions: wouldCreateTransactions,
      updatedStatements: wouldUpdateStatements,
      balanceImpact,
      statementImpact: statementImpact?.preview ?? null,
      duplicateWarnings,
      warnings,
      message: `${mode} card payment for ${card.name} recorded.`,
    }
  },
}

const creditCardCycleExplain: ToolDefinition = {
  name: 'credit-card-cycle-explain',
  description:
    'Explain a credit-card statement cycle, due-date status, next upcoming due date, and optional purchase-date classification.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Credit card account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Credit card account alias, ID, or exact name',
      128
    ).optional(),
    asOf: isoDate('Date to explain the cycle from').optional(),
    purchaseDate: isoDate('Optional purchase date to classify into a statement cycle').optional(),
    closingDate: isoDate('Explicit current cycle closing date override').optional(),
    dueDate: isoDate('Explicit current cycle expected due date override').optional(),
  }),
  execute: async ({ accountId, account, asOf, purchaseDate, closingDate, dueDate }) => {
    const resolved = resolveCreditCardAccount(accountId, account)
    if (!resolved.success) return resolved
    const card = resolved.account
    const asOfDate = dayjs(asOf ?? dayjs().format('YYYY-MM-DD'))
    const closingDay =
      card.statement_closing_day ?? (closingDate ? dayjs(closingDate).date() : null)
    const dueDay = card.payment_due_day ?? (dueDate ? dayjs(dueDate).date() : null)

    if (!closingDay || !dueDay) {
      return {
        success: false,
        reason: 'cycle_settings_required',
        message:
          'Credit-card cycle explanation requires statement closing and payment due days, or explicit closingDate and dueDate overrides.',
      }
    }

    const cycle = cycleForDate({
      closingDay,
      dueDay,
      date: asOfDate,
      explicitClosingDate: closingDate,
      explicitDueDate: dueDate,
    })
    const latest = getLatestStatementForAccount(card.id)
    const latestPaymentStatus = latest ? effectiveStatementStatusAsOf(latest, asOfDate) : null
    const latestPayment = latest ? paymentAmounts(latest) : null
    const latestDuePassed = latest ? dayjs(latest.due_date).isBefore(asOfDate, 'day') : null
    const latestStatement = latest
      ? {
          ...statementSnapshot({ ...latest, account_name: card.name }),
          paymentStatus: latestPaymentStatus,
          duePassed: latestDuePassed,
        }
      : null
    const latestStatementHasFutureDue =
      latest && latestPayment && latestPayment.amountToPayCentavos > 0 && !latestDuePassed
    const nextUpcomingDueDate = latestStatementHasFutureDue
      ? latest.due_date
      : cycle.currentCycleExpectedDueDate

    let purchaseClassification: null | {
      purchaseDate: string
      cycleStartDate: string
      cycleClosingDate: string
      expectedDueDate: string
      classification: string
      summary: string
    } = null
    if (purchaseDate) {
      const purchase = dayjs(purchaseDate)
      const purchaseCycle = cycleForDate({ closingDay, dueDay, date: purchase })
      const classification =
        latest &&
        !purchase.isAfter(dayjs(latest.statement_end_date), 'day') &&
        !purchase.isBefore(dayjs(latest.statement_start_date ?? latest.statement_end_date), 'day')
          ? 'latest_statement'
          : purchase.isBefore(asOfDate, 'day')
            ? 'past_cycle_or_current_unstatemented'
            : 'current_or_future_cycle'
      purchaseClassification = {
        purchaseDate,
        cycleStartDate: purchaseCycle.currentCycleStartDate,
        cycleClosingDate: purchaseCycle.currentCycleClosingDate,
        expectedDueDate: purchaseCycle.currentCycleExpectedDueDate,
        classification,
        summary: `A purchase on ${purchaseDate} is expected to close on ${purchaseCycle.currentCycleClosingDate} and be due on ${purchaseCycle.currentCycleExpectedDueDate}.`,
      }
    }

    const humanSummary = latest
      ? `${card.name}: latest statement closed ${latest.statement_end_date} and is ${latestPaymentStatus} with ${latestPayment?.amountToPay.toFixed(2)} ${latest.currency} remaining. Current cycle closes ${cycle.currentCycleClosingDate} and is expected due ${cycle.currentCycleExpectedDueDate}.`
      : `${card.name}: no persisted statements yet. Current cycle closes ${cycle.currentCycleClosingDate} and is expected due ${cycle.currentCycleExpectedDueDate}.`

    return {
      success: true,
      account: {
        id: card.id,
        name: card.name,
        currency: card.currency,
        statementClosingDay: card.statement_closing_day ?? null,
        paymentDueDay: card.payment_due_day ?? null,
      },
      asOf: asOfDate.format('YYYY-MM-DD'),
      latestStatement,
      latestStatementDueDate: latest?.due_date ?? null,
      latestStatementPaymentStatus: latestPaymentStatus,
      latestStatementDuePassed: latestDuePassed,
      currentCycleStartDate: cycle.currentCycleStartDate,
      currentCycleClosingDate: cycle.currentCycleClosingDate,
      currentCycleExpectedDueDate: cycle.currentCycleExpectedDueDate,
      nextCycleStartDate: cycle.nextCycleStartDate,
      nextClosingDate: cycle.nextClosingDate,
      nextCycleExpectedDueDate: cycle.nextCycleExpectedDueDate,
      nextUpcomingDueDate,
      purchaseClassification,
      summary: humanSummary,
      message: humanSummary,
    }
  },
}

const createCreditCardStatement: ToolDefinition = {
  name: 'create-credit-card-statement',
  description:
    'Create a persisted credit-card statement with closing/due dates, statement balance, minimum payment, paid amount, status, source, and note.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Credit card account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Credit card account alias, ID, or exact name',
      128
    ).optional(),
    statementStartDate: isoDate('Statement period start date').optional(),
    statementEndDate: isoDate('Statement period end/closing date').optional(),
    closingDate: isoDate('Alias for statementEndDate/closing date').optional(),
    dueDate: isoDate('Payment due date'),
    statementBalance: nonNegativeMoneyAmount('Statement balance in the main currency unit'),
    minimumPayment: nonNegativeMoneyAmount('Minimum payment in the main currency unit')
      .optional()
      .default(0),
    paidAmount: nonNegativeMoneyAmount('Paid amount in the main currency unit')
      .optional()
      .default(0),
    status: statementStatusSchema
      .optional()
      .describe('Payment status. Defaults from balance, paid amount, and due date.'),
    currency: currencyCode(
      'Statement currency. Defaults to the credit card account currency'
    ).optional(),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({
    accountId,
    account,
    statementStartDate,
    statementEndDate,
    closingDate,
    dueDate,
    statementBalance,
    minimumPayment,
    paidAmount,
    status,
    currency,
    source,
    note,
    dryRun,
  }) => {
    const closing = resolveClosingDate({ statementEndDate, closingDate })
    if (!closing.success) return closing
    const dateValidation = validateStatementDates({
      statementStartDate: statementStartDate ?? null,
      statementEndDate: closing.date,
      dueDate,
    })
    if (!dateValidation.success) return dateValidation

    const resolvedAccount = resolveCreditCardAccount(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount

    const resolvedCurrency = resolveStatementCurrency(resolvedAccount.account.currency, currency)
    if (!resolvedCurrency.success) return resolvedCurrency

    const conflict = statementConflictExists(resolvedAccount.account.id, closing.date)
    if (conflict) {
      return {
        success: false,
        reason: 'statement_exists',
        message: `A statement already exists for account ${resolvedAccount.account.id} ending ${closing.date}. Update ${conflict.id} instead.`,
        statementId: conflict.id,
      }
    }

    const id = generateId()
    const statementBalanceCentavos = toCentavos(statementBalance)
    const paidAmountCentavos = toCentavos(paidAmount)
    const statementStatus = deriveStatementStatus({
      statementBalance: statementBalanceCentavos,
      paidAmount: paidAmountCentavos,
      dueDate,
      explicitStatus: status,
    })
    const statusValidation = validateStatementStatusConsistency({
      status: statementStatus,
      statementBalance: statementBalanceCentavos,
      paidAmount: paidAmountCentavos,
      currency: resolvedCurrency.currency,
    })
    if (!statusValidation.success) return statusValidation

    const row: CreditCardStatementRow = {
      id,
      account_id: resolvedAccount.account.id,
      account_name: resolvedAccount.account.name,
      statement_start_date: statementStartDate ?? null,
      statement_end_date: closing.date,
      due_date: dueDate,
      statement_balance: statementBalanceCentavos,
      minimum_payment: toCentavos(minimumPayment),
      paid_amount: paidAmountCentavos,
      currency: resolvedCurrency.currency,
      status: statementStatus,
      source: source ?? null,
      note: note ?? null,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreate: statementSnapshot(row),
        message: `Dry run: statement for ${resolvedAccount.account.name} ending ${closing.date} would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO credit_card_statements
           (id, account_id, statement_start_date, statement_end_date, due_date, statement_balance, minimum_payment, paid_amount, currency, status, source, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          row.id,
          row.account_id,
          row.statement_start_date,
          row.statement_end_date,
          row.due_date,
          row.statement_balance,
          row.minimum_payment,
          row.paid_amount,
          row.currency,
          row.status,
          row.source,
          row.note,
        ]
      )
      writeAuditLog({
        entity: 'credit_card_statement',
        entityId: row.id,
        action: 'create',
        before: null,
        after: { statement: statementAuditSnapshot(row) },
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'created' as const,
      statement: statementSnapshot(row),
      message: `Created statement for ${resolvedAccount.account.name} ending ${closing.date}.`,
    }
  },
}

const updateCreditCardStatement: ToolDefinition = {
  name: 'update-credit-card-statement',
  description:
    'Update a persisted credit-card statement, including paid amount and payment status.',
  schema: z.object({
    statementId: boundedText('Statement ID', 'Credit card statement ID to update', 128),
    accountId: boundedText(
      'Account ID',
      'Move statement to this credit card account ID',
      128
    ).optional(),
    account: boundedText(
      'Account reference',
      'Move statement to this credit card account alias, ID, or exact name',
      128
    ).optional(),
    statementStartDate: isoDate('New statement period start date').optional(),
    statementEndDate: isoDate('New statement period end/closing date').optional(),
    closingDate: isoDate('Alias for statementEndDate/closing date').optional(),
    dueDate: isoDate('New payment due date').optional(),
    statementBalance: nonNegativeMoneyAmount(
      'New statement balance in the main currency unit'
    ).optional(),
    minimumPayment: nonNegativeMoneyAmount(
      'New minimum payment in the main currency unit'
    ).optional(),
    paidAmount: nonNegativeMoneyAmount('New paid amount in the main currency unit').optional(),
    status: statementStatusSchema
      .optional()
      .describe(
        'New payment status. Defaults from updated amounts and due date when amount/date fields change.'
      ),
    currency: currencyCode('New statement currency').optional(),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({
    statementId,
    accountId,
    account,
    statementStartDate,
    statementEndDate,
    closingDate,
    dueDate,
    statementBalance,
    minimumPayment,
    paidAmount,
    status,
    currency,
    source,
    note,
    dryRun,
  }) => {
    const existing = getStatement(statementId)
    if (!existing) {
      return {
        success: false,
        reason: 'statement_not_found',
        message: `Credit card statement ${statementId} not found.`,
      }
    }

    const writable = ensureStatementWritable(existing)
    if (!writable.success) return writable

    if (accountId && account) {
      return {
        success: false,
        reason: 'account_reference_conflict',
        message: 'Use either accountId or account, not both.',
      }
    }

    let targetAccount: CreditCardAccountRow | null = null
    if (accountId || account) {
      const resolved = resolveCreditCardAccount(accountId, account)
      if (!resolved.success) return resolved
      targetAccount = resolved.account
    }

    const closing =
      statementEndDate || closingDate
        ? resolveClosingDate({ statementEndDate, closingDate })
        : { success: true as const, date: existing.statement_end_date }
    if (!closing.success) return closing

    const updated: CreditCardStatementRow = {
      ...existing,
      account_id: targetAccount?.id ?? existing.account_id,
      account_name: targetAccount?.name ?? existing.account_name,
      statement_start_date:
        statementStartDate !== undefined ? statementStartDate : existing.statement_start_date,
      statement_end_date: closing.date,
      due_date: dueDate ?? existing.due_date,
      statement_balance:
        statementBalance !== undefined ? toCentavos(statementBalance) : existing.statement_balance,
      minimum_payment:
        minimumPayment !== undefined ? toCentavos(minimumPayment) : existing.minimum_payment,
      paid_amount: paidAmount !== undefined ? toCentavos(paidAmount) : existing.paid_amount,
      currency: normalizeCurrencyCode(currency ?? existing.currency),
      source: source !== undefined ? source : existing.source,
      note: note !== undefined ? note : existing.note,
      status: existing.status,
    }

    const dates = validateStatementDates({
      statementStartDate: updated.statement_start_date,
      statementEndDate: updated.statement_end_date,
      dueDate: updated.due_date,
    })
    if (!dates.success) return dates

    const accountCurrency =
      targetAccount?.currency ?? existing.account_currency ?? existing.currency
    const resolvedCurrency = resolveStatementCurrency(accountCurrency, updated.currency)
    if (!resolvedCurrency.success) return resolvedCurrency
    updated.currency = resolvedCurrency.currency

    const shouldDeriveStatus =
      status === undefined &&
      (statementBalance !== undefined ||
        minimumPayment !== undefined ||
        paidAmount !== undefined ||
        dueDate !== undefined)
    updated.status = shouldDeriveStatus
      ? deriveStatementStatus({
          statementBalance: updated.statement_balance,
          paidAmount: updated.paid_amount,
          dueDate: updated.due_date,
        })
      : (status ?? existing.status)

    const statusValidation = validateStatementStatusConsistency({
      status: updated.status,
      statementBalance: updated.statement_balance,
      paidAmount: updated.paid_amount,
      currency: updated.currency,
    })
    if (!statusValidation.success) return statusValidation

    if (
      updated.account_id !== existing.account_id ||
      updated.statement_end_date !== existing.statement_end_date
    ) {
      const conflict = statementConflictExists(
        updated.account_id,
        updated.statement_end_date,
        statementId
      )
      if (conflict) {
        return {
          success: false,
          reason: 'statement_exists',
          message: `A statement already exists for account ${updated.account_id} ending ${updated.statement_end_date}.`,
          statementId: conflict.id,
        }
      }
    }

    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`)
      params.push(value)
    }

    if (updated.account_id !== existing.account_id) addSet('account_id', updated.account_id)
    if (updated.statement_start_date !== existing.statement_start_date)
      addSet('statement_start_date', updated.statement_start_date)
    if (updated.statement_end_date !== existing.statement_end_date)
      addSet('statement_end_date', updated.statement_end_date)
    if (updated.due_date !== existing.due_date) addSet('due_date', updated.due_date)
    if (updated.statement_balance !== existing.statement_balance)
      addSet('statement_balance', updated.statement_balance)
    if (updated.minimum_payment !== existing.minimum_payment)
      addSet('minimum_payment', updated.minimum_payment)
    if (updated.paid_amount !== existing.paid_amount) addSet('paid_amount', updated.paid_amount)
    if (normalizeCurrencyCode(updated.currency) !== normalizeCurrencyCode(existing.currency))
      addSet('currency', updated.currency)
    if (updated.status !== existing.status) addSet('status', updated.status)
    if (source !== undefined && updated.source !== existing.source) addSet('source', updated.source)
    if (note !== undefined && updated.note !== existing.note) addSet('note', updated.note)

    if (setClauses.length === 0) {
      return {
        success: true,
        action: 'updated' as const,
        changed: false,
        ...(dryRun ? { dryRun: true } : {}),
        statement: statementSnapshot(existing),
        message: dryRun
          ? `Dry run: statement ${statementId} already matches the requested values.`
          : `Statement ${statementId} already matches the requested values.`,
      }
    }

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        changed: true,
        wouldUpdate: {
          statementId,
          before: statementSnapshot(existing),
          after: statementSnapshot(updated),
        },
        message: `Dry run: statement ${statementId} would be updated.`,
      }
    }

    transaction(() => {
      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(statementId)
      const updateResult = execute(
        `UPDATE credit_card_statements SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )
      assertSingleRowUpdated(
        updateResult,
        `Credit card statement ${statementId} could not be updated safely.`
      )
      writeAuditLog({
        entity: 'credit_card_statement',
        entityId: statementId,
        action: 'update',
        before: { statement: statementAuditSnapshot(existing) },
        after: { statement: statementAuditSnapshot(updated) },
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'updated' as const,
      changed: true,
      statement: statementSnapshot(updated),
      message: `Updated statement ${statementId}.`,
    }
  },
}

const listCreditCardStatements: ToolDefinition = {
  name: 'list-credit-card-statements',
  description: 'List persisted credit-card statements with payment amounts and statuses.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Filter by credit card account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Filter by credit card account alias, ID, or exact name',
      128
    ).optional(),
    status: z.enum(['all', 'open', 'partial', 'paid', 'overdue']).optional().default('all'),
    startDate: isoDate('Statement end date lower bound').optional(),
    endDate: isoDate('Statement end date upper bound').optional(),
    includeArchivedAccounts: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include statements linked to archived accounts'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  execute: async ({
    accountId,
    account,
    status,
    startDate,
    endDate,
    includeArchivedAccounts,
    limit,
  }) => {
    if (startDate && endDate && dayjs(startDate).isAfter(dayjs(endDate), 'day')) {
      return {
        success: false,
        reason: 'invalid_statement_dates',
        message: 'startDate must be on or before endDate.',
      }
    }

    const resolvedAccount = resolveStatementAccountFilter(
      accountId,
      account,
      includeArchivedAccounts
    )
    if (!resolvedAccount.success) return resolvedAccount
    const resolvedAccountId = resolvedAccount.accountId

    const filters: string[] = []
    const params: unknown[] = []
    const addFilter = (sql: string, value: unknown) => {
      params.push(value)
      filters.push(sql.replace('?', `$${params.length}`))
    }
    if (resolvedAccountId) addFilter('s.account_id = ?', resolvedAccountId)
    if (startDate) addFilter('s.statement_end_date >= ?', startDate)
    if (endDate) addFilter('s.statement_end_date <= ?', endDate)
    if (!includeArchivedAccounts) filters.push('COALESCE(a.is_archived, 0) = 0')

    const scanLimit = status === 'all' ? limit : Math.max(limit, STATEMENT_FILTER_SCAN_LIMIT)
    params.push(scanLimit)
    const rows = query<CreditCardStatementRow>(
      `SELECT s.*, a.name as account_name, a.currency as account_currency, a.type as account_type,
              a.is_archived as account_is_archived
       FROM credit_card_statements s
       LEFT JOIN accounts a ON s.account_id = a.id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY s.statement_end_date DESC, s.due_date DESC, s.id DESC
        LIMIT $${params.length}`,
      params
    )
    const statements = rows
      .map(statementSnapshot)
      .filter((statement) => status === 'all' || statement.paymentStatus === status)
      .slice(0, limit)

    return {
      success: true,
      statements,
      count: statements.length,
      message:
        statements.length === 0
          ? 'No credit-card statements found.'
          : `Found ${statements.length} credit-card statement(s).`,
    }
  },
}

const deleteCreditCardStatement: ToolDefinition = {
  name: 'delete-credit-card-statement',
  description: 'Delete a persisted credit-card statement with a dry-run preview.',
  schema: z.object({
    statementId: boundedText('Statement ID', 'Credit card statement ID to delete', 128),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({ statementId, source, note, dryRun }) => {
    const existing = getStatement(statementId)
    if (!existing) {
      return {
        success: false,
        reason: 'statement_not_found',
        message: `Credit card statement ${statementId} not found.`,
      }
    }

    const writable = ensureStatementWritable(existing)
    if (!writable.success) return writable

    if (dryRun) {
      return {
        success: true,
        action: 'deleted' as const,
        dryRun: true,
        wouldDelete: statementSnapshot(existing),
        message: `Dry run: statement ${statementId} would be deleted.`,
      }
    }

    transaction(() => {
      const deleteResult = execute('DELETE FROM credit_card_statements WHERE id = $1', [
        statementId,
      ])
      assertSingleRowUpdated(
        deleteResult,
        `Credit card statement ${statementId} could not be deleted safely.`
      )
      writeAuditLog({
        entity: 'credit_card_statement',
        entityId: statementId,
        action: 'delete',
        before: { statement: statementAuditSnapshot(existing) },
        after: null,
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'deleted' as const,
      statement: statementSnapshot(existing),
      message: `Deleted statement ${statementId}.`,
    }
  },
}

const getCreditCardStatus: ToolDefinition = {
  name: 'get-credit-card-status',
  description:
    'Get credit card status including credit utilization, persisted statement balances, minimum payments, payment status, due dates, and current-period spending.',
  schema: z.object({
    accountId: z
      .string()
      .optional()
      .describe('Specific credit card account ID. Omit to get all credit cards.'),
  }),
  execute: async ({ accountId }) => {
    let cards: CreditCardAccountRow[]

    if (accountId) {
      cards = query<CreditCardAccountRow>(
        "SELECT * FROM accounts WHERE id = $1 AND type = 'credit_card' AND is_archived = 0",
        [accountId]
      )
      if (cards.length === 0) {
        return {
          success: false,
          reason: 'credit_card_not_found',
          message: `Credit card ${accountId} not found.`,
        }
      }
    } else {
      cards = query<CreditCardAccountRow>(
        "SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 ORDER BY name"
      )
      if (cards.length === 0) {
        return {
          success: false,
          reason: 'credit_card_not_found',
          message: 'No credit cards found.',
        }
      }
    }

    const statuses = cards.map((card) => {
      const balance = fromCentavos(Math.abs(card.balance))
      const limit = card.credit_limit ? fromCentavos(card.credit_limit) : null
      const available = limit !== null ? limit - balance : null
      const utilization = limit !== null && limit > 0 ? Math.round((balance / limit) * 100) : null
      const latestStatement = getLatestStatementForAccount(card.id)
      const statement = latestStatement
        ? statementSnapshot({ ...latestStatement, account_name: card.name })
        : null
      const currentPeriod = getCurrentPeriodSpending(card, latestStatement)

      return {
        id: card.id,
        name: card.name,
        currency: card.currency,
        currentBalance: balance,
        creditLimit: limit,
        availableCredit: available,
        utilizationPercent: utilization,
        nextClosingDate: card.statement_closing_day
          ? nextDateForDay(card.statement_closing_day).format('YYYY-MM-DD')
          : null,
        nextPaymentDueDate:
          statement?.dueDate ??
          (card.payment_due_day ? nextDateForDay(card.payment_due_day).format('YYYY-MM-DD') : null),
        statementClosingDay: card.statement_closing_day ?? null,
        paymentDueDay: card.payment_due_day ?? null,
        latestStatement: statement,
        statementBalance: statement?.statementBalance ?? null,
        minimumPayment: statement?.minimumPayment ?? null,
        minimumPaymentDue: statement?.minimumPaymentDue ?? null,
        paidAmount: statement?.paidAmount ?? null,
        amountToPay: statement?.amountToPay ?? null,
        paymentStatus: statement?.paymentStatus ?? null,
        statementDueDate: statement?.dueDate ?? null,
        currentPeriod,
        currentPeriodSpending: currentPeriod.spending,
      }
    })

    const totalBalance = statuses.reduce((sum, card) => sum + card.currentBalance, 0)
    const totalLimit = statuses.reduce((sum, card) => sum + (card.creditLimit ?? 0), 0)
    const totalStatementBalance = statuses.reduce(
      (sum, card) => sum + (card.statementBalance ?? 0),
      0
    )
    const totalAmountToPay = statuses.reduce((sum, card) => sum + (card.amountToPay ?? 0), 0)
    const totalMinimumDue = statuses.reduce((sum, card) => sum + (card.minimumPaymentDue ?? 0), 0)

    return {
      success: true,
      cards: statuses,
      summary: {
        totalCards: statuses.length,
        totalBalance,
        totalLimit: totalLimit > 0 ? totalLimit : null,
        totalAvailable: totalLimit > 0 ? totalLimit - totalBalance : null,
        overallUtilization: totalLimit > 0 ? Math.round((totalBalance / totalLimit) * 100) : null,
        totalStatementBalance,
        totalAmountToPay,
        totalMinimumDue,
        paymentStatusCounts: {
          open: statuses.filter((card) => card.paymentStatus === 'open').length,
          partial: statuses.filter((card) => card.paymentStatus === 'partial').length,
          paid: statuses.filter((card) => card.paymentStatus === 'paid').length,
          overdue: statuses.filter((card) => card.paymentStatus === 'overdue').length,
        },
      },
      message: `${statuses.length} credit card(s). Total balance: $${totalBalance.toFixed(2)}${totalLimit > 0 ? `, utilization: ${Math.round((totalBalance / totalLimit) * 100)}%` : ''}. Statements due: $${totalAmountToPay.toFixed(2)} total, $${totalMinimumDue.toFixed(2)} minimum.`,
    }
  },
}

export function getCreditCardBillEntries(daysAhead: number): CreditCardBillEntry[] {
  const today = dayjs()
  const cutoff = today.add(daysAhead, 'day').format('YYYY-MM-DD')
  const todayDate = today.format('YYYY-MM-DD')
  const statementRows = query<CreditCardStatementRow>(
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

  const fallbackCards = query<CreditCardAccountRow>(
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

export const creditCardsTools: ToolDefinition[] = [
  getCreditCardStatus,
  recordCardPayment,
  creditCardCycleExplain,
  createCreditCardStatement,
  updateCreditCardStatement,
  listCreditCardStatements,
  deleteCreditCardStatement,
]
