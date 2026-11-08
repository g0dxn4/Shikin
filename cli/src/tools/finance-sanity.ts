import { REPORTING_CTE, reportingReadFailure } from '../reporting-read.js'
import { z, query, fromCentavos, dayjs, isoDate, type ToolDefinition } from './shared.js'
import { findTransactionDuplicate, transactionDuplicateReason } from '../duplicate-detection.js'
import { paymentAmounts, effectiveStatementStatus } from '../statement-read.js'
import { type AuditLogRow, REDACTED_VALUE, redactText } from '../audit-read.js'
import {
  type AccountContextRow,
  type SubscriptionContextRow,
  type CreditCardStatementContextRow,
  tableExists,
  tableHasColumns,
} from '../automation-read.js'

type FinanceSanityFinding = {
  severity: 'info' | 'warning' | 'critical'
  type: string
  message: string
  [key: string]: unknown
}

const SANITY_DEFAULT_DAYS_AHEAD = 30

const SANITY_DEFAULT_LIMIT = 25

const SANITY_DEFAULT_LARGE_TRANSACTION = 1000

function maybeRedactText(value: string | null | undefined, redacted: boolean) {
  return redactText(value, redacted)
}

function addFinding(
  findings: FinanceSanityFinding[],
  severity: FinanceSanityFinding['severity'],
  type: string,
  message: string,
  extra: Record<string, unknown> = {}
) {
  findings.push({ severity, type, message, ...extra })
}

function getCreditCardSanityFindings(input: {
  asOf: string
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('credit_card_statements', [
      'id',
      'account_id',
      'due_date',
      'statement_balance',
      'paid_amount',
    ])
  ) {
    return []
  }
  const dueRows = query<CreditCardStatementContextRow>(
    `SELECT s.*, a.name AS account_name
     FROM credit_card_statements s
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.statement_balance > s.paid_amount
       AND s.due_date <= $1
     ORDER BY s.due_date ASC, s.statement_end_date DESC, s.id ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  const dueFindings = dueRows.map((statement) => {
    const payment = paymentAmounts(statement)
    const overdue = dayjs(statement.due_date).isBefore(dayjs(input.asOf), 'day')
    return {
      severity: overdue ? 'critical' : 'warning',
      type: overdue ? 'credit_card_statement_overdue' : 'credit_card_statement_due_soon',
      statementId: statement.id,
      accountId: statement.account_id,
      accountName: maybeRedactText(statement.account_name, input.redacted),
      dueDate: statement.due_date,
      amountToPay: payment.amountToPay,
      amountToPayCentavos: payment.amountToPayCentavos,
      minimumPaymentDue: payment.minimumPaymentDue,
      minimumPaymentDueCentavos: payment.minimumPaymentDueCentavos,
      currency: statement.currency,
      paymentStatus: effectiveStatementStatus(statement),
      message: overdue
        ? `Credit-card statement ${statement.id} is overdue with ${payment.amountToPay.toFixed(2)} ${statement.currency} remaining.`
        : `Credit-card statement ${statement.id} is due by ${statement.due_date} with ${payment.amountToPay.toFixed(2)} ${statement.currency} remaining.`,
    } satisfies FinanceSanityFinding
  })
  if (
    !tableHasColumns('credit_card_statements', ['unattributed_paid_amount']) ||
    !tableExists('card_statement_payment_links')
  )
    return dueFindings
  const evidenceRows = query<
    CreditCardStatementContextRow & { linked_amount: number; account_name: string | null }
  >(
    `SELECT s.*, a.name AS account_name,
            COALESCE(SUM(CASE WHEN l.voided_at IS NULL THEN l.amount ELSE 0 END), 0) AS linked_amount
     FROM credit_card_statements s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN card_statement_payment_links l ON l.statement_id = s.id
     GROUP BY s.id
     HAVING s.unattributed_paid_amount + linked_amount <> s.paid_amount
         OR s.paid_amount > s.statement_balance
     ORDER BY s.due_date ASC, s.id ASC
     LIMIT $1`,
    [input.limit]
  )
  const evidenceFindings = evidenceRows.map((statement) => {
    const inconsistent =
      statement.unattributed_paid_amount + statement.linked_amount !== statement.paid_amount
    return {
      severity: inconsistent ? ('critical' as const) : ('warning' as const),
      type: inconsistent
        ? 'credit_card_payment_evidence_inconsistent'
        : 'credit_card_statement_legacy_overpaid',
      statementId: statement.id,
      accountId: statement.account_id,
      accountName: maybeRedactText(statement.account_name, input.redacted),
      statementBalanceCentavos: statement.statement_balance,
      paidAmountCentavos: statement.paid_amount,
      unattributedPaidAmountCentavos: statement.unattributed_paid_amount,
      linkedAmountCentavos: statement.linked_amount,
      currency: statement.currency,
      message: inconsistent
        ? `Statement ${statement.id} paid total does not equal unattributed baseline plus active payment links.`
        : `Statement ${statement.id} retains a historical overpayment; it was not clipped.`,
    } satisfies FinanceSanityFinding
  })
  return [...evidenceFindings, ...dueFindings].slice(0, input.limit)
}

function getPlaceholderSanityFindings(input: { redacted: boolean; limit: number }) {
  if (!tableHasColumns('transactions', ['is_placeholder', 'placeholder_status'])) return []
  const rows = query<{
    id: string
    description: string
    amount: number
    currency: string | null
    date: string
    account_id: string
    account_name: string | null
    placeholder_reason: string | null
  }>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.account_id,
            a.name AS account_name, t.placeholder_reason
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.is_placeholder = 1
       AND COALESCE(t.placeholder_status, 'unresolved') = 'unresolved'
     ORDER BY t.date ASC, t.id ASC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'unresolved_placeholder',
    transactionId: row.id,
    accountId: row.account_id,
    accountName: maybeRedactText(row.account_name, input.redacted),
    date: row.date,
    amount: fromCentavos(row.amount),
    amountCentavos: row.amount,
    currency: row.currency,
    description: maybeRedactText(row.description, input.redacted),
    placeholderReason: maybeRedactText(row.placeholder_reason, input.redacted),
    message: `Placeholder transaction ${row.id} is still unresolved.`,
  }))
}

function getDuplicateSanityFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<{
    id: string
    account_id: string
    account_name: string | null
    date: string
    amount: number
    currency: string | null
    type: 'expense' | 'income' | 'transfer'
    status: 'pending' | 'posted' | 'cleared' | null
    transfer_to_account_id: string | null
    description: string
    source: string | null
    note: string | null
  }>(
    `SELECT t.id, t.account_id, a.name AS account_name, t.date, t.amount, t.currency, t.type,
            COALESCE(NULLIF(TRIM(t.status), ''), 'posted') AS status,
             t.transfer_to_account_id, t.description, t.source, t.note
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.type IN ('expense', 'income', 'transfer')
       AND t.account_id IS NOT NULL
       AND t.date IS NOT NULL
        AND t.description IS NOT NULL
        AND COALESCE(t.is_archived, 0) = 0
      ORDER BY t.date DESC, t.id DESC
     LIMIT $1`,
    [Math.max(input.limit * 4, input.limit)]
  )
  const findings: FinanceSanityFinding[] = []
  const seenPairs = new Set<string>()

  for (const row of rows) {
    if (findings.length >= input.limit) break

    const duplicateCheck = findTransactionDuplicate({
      accountId: row.account_id,
      date: row.date,
      amountCentavos: row.amount,
      type: row.type,
      status: row.status,
      transferToAccountId: row.transfer_to_account_id,
      description: row.description,
      source: row.source,
      note: row.note,
      excludeTransactionId: row.id,
    })
    const match = duplicateCheck.match
    if (!match) continue

    const transactionIds = [row.id, match.existingTransactionId].sort((a, b) => a.localeCompare(b))
    const pairKey = transactionIds.join('\u0000')
    if (seenPairs.has(pairKey)) continue
    seenPairs.add(pairKey)

    findings.push({
      severity: 'warning' as const,
      type: 'duplicate_looking_transactions',
      duplicateKind: match.kind,
      duplicateReason: transactionDuplicateReason(match.kind),
      transactionIds,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      date: row.date,
      matchedDate: match.date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
      transactionType: row.type,
      status: duplicateCheck.input.status,
      transferToAccountId: duplicateCheck.input.transferToAccountId,
      description: maybeRedactText(row.description, input.redacted),
      daysApart: match.daysApart,
      descriptionSimilarity: match.descriptionSimilarity,
      windowDays: match.windowDays,
      similarityThreshold: match.similarityThreshold,
      duplicateSignals: match.signals,
      provenance: match.provenance,
      message:
        match.kind === 'exact_duplicate'
          ? `Transactions ${transactionIds[0]} and ${transactionIds[1]} match on ${match.signals.join(', ')}.`
          : `Transactions ${transactionIds[0]} and ${transactionIds[1]} match on ${match.signals.join(', ')} within ${match.windowDays} days.`,
    })
  }

  return findings
}

function getSubscriptionSanityFindings(input: {
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('subscriptions', [
      'id',
      'name',
      'amount',
      'currency',
      'next_billing_date',
      'is_active',
    ])
  )
    return []
  const rows = query<SubscriptionContextRow>(
    `SELECT s.*, a.name AS account_name, c.name AS category_name
     FROM subscriptions s
     LEFT JOIN accounts a ON a.id = s.account_id
     LEFT JOIN categories c ON c.id = s.category_id
     WHERE s.is_active = 1 AND s.next_billing_date <= $1
     ORDER BY s.next_billing_date ASC, s.name ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  return rows.map((row) => ({
    severity: 'info' as const,
    type: 'subscription_due_soon',
    subscriptionId: row.id,
    name: maybeRedactText(row.name, input.redacted),
    nextBillingDate: row.next_billing_date,
    amount: fromCentavos(row.amount),
    amountCentavos: row.amount,
    currency: row.currency,
    accountId: row.account_id,
    accountName: maybeRedactText(row.account_name, input.redacted),
    message: `Subscription ${row.id} is due by ${row.next_billing_date}.`,
  }))
}

function getRecurringSanityFindings(input: {
  asOf: string
  cutoff: string
  redacted: boolean
  limit: number
}) {
  if (
    !tableHasColumns('recurring_rules', [
      'id',
      'description',
      'amount',
      'type',
      'next_date',
      'active',
    ])
  )
    return []
  const rows = query<RecurringRuleRow>(
    `SELECT r.*, a.name AS account_name, c.name AS category_name
     FROM recurring_rules r
     LEFT JOIN accounts a ON a.id = r.account_id
     LEFT JOIN categories c ON c.id = r.category_id
     WHERE r.active = 1 AND r.next_date <= $1
     ORDER BY r.next_date ASC, r.description ASC
     LIMIT $2`,
    [input.cutoff, input.limit]
  )
  return rows.map((row) => {
    const late = dayjs(row.next_date).isBefore(dayjs(input.asOf), 'day')
    return {
      severity: late ? ('warning' as const) : ('info' as const),
      type: late ? 'recurring_expected_late' : 'recurring_expected_due_soon',
      recurringRuleId: row.id,
      description: maybeRedactText(row.description, input.redacted),
      nextDate: row.next_date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      message: `Recurring rule ${row.id} is expected by ${row.next_date}.`,
    }
  })
}

type RecurringRuleRow = {
  id: string
  description: string
  amount: number
  type: string
  next_date: string
  account_id: string
  category_id: string | null
  active: number
  currency: string | null
  account_name: string | null
  category_name: string | null
}

function getAccountSanityFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<AccountContextRow>(
    `SELECT id, name, type, currency, balance, is_archived, is_primary, credit_limit, statement_closing_day, payment_due_day
     FROM accounts
     WHERE COALESCE(is_archived, 0) = 0 AND type <> 'credit_card' AND balance < 0
     ORDER BY balance ASC, name ASC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'low_balance',
    accountId: row.id,
    accountName: maybeRedactText(row.name, input.redacted),
    balance: fromCentavos(row.balance),
    balanceCentavos: row.balance,
    currency: row.currency,
    message: `Account ${row.id} has a negative balance.`,
  }))
}

function getBalanceMismatchFindings(input: { redacted: boolean; limit: number }) {
  const rows = query<{
    id: string
    name: string
    currency: string
    stored_balance: number
    computed_balance: number | null
    account_mode: 'transactional' | 'snapshot_only' | null
  }>(
    `SELECT a.id, a.name, a.currency, a.balance AS stored_balance, a.account_mode,
            COALESCE(SUM(CASE
              WHEN COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending' THEN 0
              WHEN t.type = 'income' THEN t.amount
              WHEN t.type = 'expense' THEN -t.amount
              WHEN t.type = 'transfer' AND t.account_id = a.id THEN -t.amount
              ELSE 0
            END), 0) + COALESCE((
              SELECT SUM(t2.amount)
              FROM transactions t2
              WHERE t2.transfer_to_account_id = a.id
                AND t2.type = 'transfer'
                 AND COALESCE(NULLIF(TRIM(t2.status), ''), 'posted') <> 'pending'
                 AND COALESCE(t2.ledger_treatment, 'normal') = 'normal'
                 AND COALESCE(t2.is_archived, 0) = 0
             ), 0) AS computed_balance
     FROM accounts a
     LEFT JOIN transactions t ON t.account_id = a.id
       AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
       AND COALESCE(t.is_archived, 0) = 0
     WHERE COALESCE(a.is_archived, 0) = 0
     GROUP BY a.id
     HAVING ABS(stored_balance - computed_balance) > 0
     ORDER BY ABS(stored_balance - computed_balance) DESC
     LIMIT $1`,
    [input.limit]
  )
  return rows.map((row) => ({
    severity: row.account_mode === 'snapshot_only' ? ('info' as const) : ('critical' as const),
    type: row.account_mode === 'snapshot_only' ? 'snapshot_ledger_difference' : 'balance_mismatch',
    accountId: row.id,
    accountName: maybeRedactText(row.name, input.redacted),
    storedBalance: fromCentavos(row.stored_balance),
    storedBalanceCentavos: row.stored_balance,
    computedBalance: fromCentavos(row.computed_balance ?? 0),
    computedBalanceCentavos: row.computed_balance ?? 0,
    currency: row.currency,
    accountMode: row.account_mode ?? 'transactional',
    message:
      row.account_mode === 'snapshot_only'
        ? `Snapshot-only account ${row.id} valuation differs from its incomplete transaction ledger; this is informational until holdings or history are imported.`
        : `Account ${row.id} stored balance differs from transaction-derived balance.`,
  }))
}

function getTransactionHygieneFindings(input: {
  asOf: string
  largeAmountCentavos: number
  redacted: boolean
  limit: number
}) {
  const staleDate = dayjs(input.asOf).subtract(7, 'day').format('YYYY-MM-DD')
  const recentDate = dayjs(input.asOf).subtract(30, 'day').format('YYYY-MM-DD')
  const rows = query<{
    id: string
    description: string
    amount: number
    currency: string | null
    type: string
    date: string
    status: string | null
    category_id: string | null
    account_id: string
    account_name: string | null
  }>(
    `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.status,
            t.category_id, t.account_id, a.name AS account_name
     FROM transactions t
     LEFT JOIN accounts a ON a.id = t.account_id
      WHERE (
        (COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = 'pending' AND t.date <= $1)
        OR (t.type = 'expense' AND t.category_id IS NULL AND t.date >= $2)
        OR (ABS(t.amount) >= $3 AND t.date >= $4)
      )
        AND COALESCE(t.is_archived, 0) = 0
        AND COALESCE(t.transaction_kind, 'standard') <> 'reconciliation_bridge'
      ORDER BY t.date DESC, t.id DESC
      LIMIT $5`,
    [staleDate, recentDate, input.largeAmountCentavos, recentDate, input.limit]
  )
  const findings: FinanceSanityFinding[] = []
  for (const row of rows) {
    const base = {
      transactionId: row.id,
      accountId: row.account_id,
      accountName: maybeRedactText(row.account_name, input.redacted),
      description: maybeRedactText(row.description, input.redacted),
      date: row.date,
      amount: fromCentavos(row.amount),
      amountCentavos: row.amount,
      currency: row.currency,
    }
    if ((row.status ?? 'posted') === 'pending' && row.date <= staleDate) {
      addFinding(
        findings,
        'warning',
        'old_pending_transaction',
        `Pending transaction ${row.id} is older than 7 days.`,
        base
      )
    }
    if (row.type === 'expense' && row.category_id === null && row.date >= recentDate) {
      addFinding(
        findings,
        'warning',
        'missing_category',
        `Expense transaction ${row.id} is missing a category.`,
        base
      )
    }
    if (Math.abs(row.amount) >= input.largeAmountCentavos && row.date >= recentDate) {
      addFinding(
        findings,
        'info',
        'unusually_large_transaction',
        `Transaction ${row.id} is unusually large.`,
        base
      )
    }
  }
  return findings
}

function getOtherExpensesFindings(input: {
  asOf: string
  thresholdCentavos: number
  redacted: boolean
}) {
  const monthStart = dayjs(input.asOf).startOf('month').format('YYYY-MM-DD')
  const failure = reportingReadFailure(monthStart, input.asOf)
  if (failure)
    return [{ severity: 'warning' as const, type: 'incomplete_cashflow_reporting', ...failure }]
  const rows = query<{
    currency: string
    category_id: string | null
    category_name: string | null
    total: number
  }>(
    `${REPORTING_CTE}
     SELECT t.currency, t.category_id, c.name AS category_name, SUM(t.amount) AS total
     FROM category_allocations t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
       AND lower(COALESCE(c.name, '')) IN ('other', 'other expenses')
     GROUP BY t.currency, t.category_id, c.name
     HAVING total >= $3`,
    [monthStart, input.asOf, input.thresholdCentavos]
  )
  return rows.map((row) => ({
    severity: 'warning' as const,
    type: 'high_other_expenses',
    basis: 'gross_cashflow',
    currency: row.currency,
    categoryId: row.category_id,
    categoryName: maybeRedactText(row.category_name, input.redacted),
    periodStart: monthStart,
    periodEnd: input.asOf,
    amount: fromCentavos(row.total),
    amountCentavos: row.total,
    threshold: fromCentavos(input.thresholdCentavos),
    thresholdCentavos: input.thresholdCentavos,
    message: `Other Expenses are above the configured threshold for the current month.`,
  }))
}

function getRecentAuditSanityFindings(input: { asOf: string; redacted: boolean; limit: number }) {
  if (!tableExists('audit_log')) return []
  const since = dayjs(input.asOf).subtract(7, 'day').toISOString()
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE created_at >= $1 AND source IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [since, input.limit]
  )
  return rows.map((row) => ({
    severity: 'info' as const,
    type: 'recent_provenance_write',
    auditId: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    source: maybeRedactText(row.source, input.redacted),
    note: maybeRedactText(row.note, input.redacted),
    createdAt: row.created_at,
    message: `Recent provenance-tagged write ${row.id} from ${input.redacted ? REDACTED_VALUE : row.source}.`,
  }))
}

export const financeSanityCheck: ToolDefinition = {
  name: 'finance-sanity-check',
  description:
    'Run generic automation-safe finance checks for card statements, placeholders, duplicate-looking transactions, subscriptions, recurring rules, balances, uncategorized spending, and recent provenance writes.',
  schema: z.object({
    asOf: isoDate('Date used for due/overdue checks').optional(),
    daysAhead: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .default(SANITY_DEFAULT_DAYS_AHEAD)
      .describe('Days ahead to include due-soon statements, subscriptions, and recurring rules'),
    largeTransactionAmount: z
      .number()
      .positive()
      .optional()
      .default(SANITY_DEFAULT_LARGE_TRANSACTION)
      .describe('Main-currency amount threshold for unusually large transactions'),
    otherExpensesThreshold: z
      .number()
      .positive()
      .optional()
      .default(250)
      .describe('Main-currency monthly threshold for Other Expenses warnings'),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact names, descriptions, notes, and source labels'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(SANITY_DEFAULT_LIMIT)
      .describe('Maximum rows per check'),
  }),
  execute: async ({
    asOf,
    daysAhead,
    largeTransactionAmount,
    otherExpensesThreshold,
    redacted,
    limit,
  }) => {
    const asOfDate = asOf ?? dayjs().format('YYYY-MM-DD')
    const cutoff = dayjs(asOfDate).add(daysAhead, 'day').format('YYYY-MM-DD')
    const findings: FinanceSanityFinding[] = [
      ...getCreditCardSanityFindings({ asOf: asOfDate, cutoff, redacted, limit }),
      ...getPlaceholderSanityFindings({ redacted, limit }),
      ...getDuplicateSanityFindings({ redacted, limit }),
      ...getSubscriptionSanityFindings({ cutoff, redacted, limit }),
      ...getRecurringSanityFindings({ asOf: asOfDate, cutoff, redacted, limit }),
      ...getAccountSanityFindings({ redacted, limit }),
      ...getBalanceMismatchFindings({ redacted, limit }),
      ...getTransactionHygieneFindings({
        asOf: asOfDate,
        largeAmountCentavos: Math.round(largeTransactionAmount * 100),
        redacted,
        limit,
      }),
      ...getOtherExpensesFindings({
        asOf: asOfDate,
        thresholdCentavos: Math.round(otherExpensesThreshold * 100),
        redacted,
      }),
      ...getRecentAuditSanityFindings({ asOf: asOfDate, redacted, limit }),
    ]
    const summary = findings.reduce(
      (acc, finding) => {
        acc[finding.severity] += 1
        return acc
      },
      { critical: 0, warning: 0, info: 0 } as Record<FinanceSanityFinding['severity'], number>
    )
    const status = summary.critical > 0 ? 'critical' : summary.warning > 0 ? 'warning' : 'ok'

    return {
      success: !findings.some((finding) => finding.type === 'incomplete_cashflow_reporting'),
      complete: !findings.some((finding) => finding.type === 'incomplete_cashflow_reporting'),
      asOf: asOfDate,
      daysAhead,
      cutoffDate: cutoff,
      redacted,
      status,
      summary: {
        totalFindings: findings.length,
        ...summary,
      },
      findings,
      message:
        findings.length === 0
          ? 'Finance sanity check found no issues.'
          : `Finance sanity check found ${findings.length} finding(s): ${summary.critical} critical, ${summary.warning} warning, ${summary.info} info.`,
    }
  },
}
