import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  positiveMoneyAmount,
  isoDate,
  currencyCode,
  resolveAccountId,
  normalizeCurrencyCode,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  planReceivablePayment,
  planReceivablePaymentReversal,
  ReceivablePaymentError,
  type ReceivablePaymentLink,
} from '@shikin/finance-core/receivable-payments'
import { importPlanToken } from '@shikin/finance-core/imports'

type ReceivableStatus = 'open' | 'partial' | 'received' | 'cancelled'

type ReceivableRow = {
  id: string
  payer: string
  amount: number
  received_amount: number
  unattributed_received_amount: number
  currency: string
  due_date: string
  project_reference: string | null
  invoice_reference: string | null
  status: ReceivableStatus
  account_id: string | null
  matched_transaction_id: string | null
  notes: string | null
  source: string | null
  note: string | null
  created_at: string
  updated_at: string
}

type ReceivableWithAccountRow = ReceivableRow & {
  account_name: string | null
  payments?: ReceivablePaymentLink[]
}

type IncomeTransactionRow = {
  id: string
  account_id: string
  amount: number
  currency: string | null
  type: 'expense' | 'income' | 'transfer'
  status: 'pending' | 'posted' | 'cleared' | null
  ledger_treatment: string | null
  reporting_treatment: string | null
  transaction_kind: string | null
  matched_transaction_id: string | null
  is_archived: number | null
  description: string
  date: string
  account_mode: string | null
  account_is_archived: number | null
  is_card_payment: number
  is_non_income_classification: number
}

function optionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function redactText(value: string | null, redacted: boolean): string | null {
  return redacted && value !== null ? '[REDACTED]' : value
}

function isOverdue(receivable: ReceivableRow, asOf: string): boolean {
  return (
    (receivable.status === 'open' || receivable.status === 'partial') &&
    receivable.amount > receivable.received_amount &&
    receivable.due_date < asOf
  )
}

function receivableSnapshot(
  receivable: ReceivableWithAccountRow,
  options: { redacted?: boolean; asOf?: string; includePayments?: boolean } = {}
) {
  const redacted = options.redacted ?? false
  const remainingAmountCentavos = Math.max(0, receivable.amount - receivable.received_amount)
  const asOf = options.asOf ?? dayjs().format('YYYY-MM-DD')

  return {
    id: receivable.id,
    payer: redactText(receivable.payer, redacted),
    amount: fromCentavos(receivable.amount),
    amountCentavos: receivable.amount,
    receivedAmount: fromCentavos(receivable.received_amount),
    receivedAmountCentavos: receivable.received_amount,
    unattributedReceivedAmount: fromCentavos(receivable.unattributed_received_amount),
    unattributedReceivedAmountCentavos: receivable.unattributed_received_amount,
    linkedReceivedAmountCentavos:
      receivable.received_amount - receivable.unattributed_received_amount,
    activePaymentCount: (receivable.payments ?? []).filter((payment) => !payment.reversed_at)
      .length,
    remainingAmount: fromCentavos(remainingAmountCentavos),
    remainingAmountCentavos,
    currency: receivable.currency,
    dueDate: receivable.due_date,
    projectReference: redactText(receivable.project_reference, redacted),
    invoiceReference: redactText(receivable.invoice_reference, redacted),
    status: receivable.status,
    isOverdue: isOverdue(receivable, asOf),
    accountId: receivable.account_id,
    accountName: redactText(receivable.account_name, redacted),
    matchedTransactionId: receivable.matched_transaction_id,
    notes: redactText(receivable.notes, redacted),
    source: redactText(receivable.source, redacted),
    note: redactText(receivable.note, redacted),
    createdAt: receivable.created_at,
    updatedAt: receivable.updated_at,
    ...(options.includePayments
      ? {
          payments: (receivable.payments ?? []).map((payment) =>
            paymentSnapshot(payment, redacted)
          ),
        }
      : {}),
  }
}

function getReceivable(receivableId: string): ReceivableWithAccountRow | null {
  const row = query<ReceivableWithAccountRow>(
    `SELECT r.*, a.name AS account_name
       FROM receivables r
       LEFT JOIN accounts a ON a.id = r.account_id
       WHERE r.id = $1
       LIMIT 1`,
    [receivableId]
  )[0]
  return row ? { ...row, payments: paymentLinks(receivableId) } : null
}

function paymentLinks(receivableId: string, transactionId?: string): ReceivablePaymentLink[] {
  return query<ReceivablePaymentLink>(
    `SELECT * FROM receivable_payment_links WHERE receivable_id = $1${transactionId ? ' OR transaction_id = $2' : ''} ORDER BY created_at, id`,
    transactionId ? [receivableId, transactionId] : [receivableId]
  )
}

function paymentSnapshot(payment: ReceivablePaymentLink, redacted = false) {
  return {
    id: payment.id,
    transactionId: payment.transaction_id,
    amount: fromCentavos(payment.amount),
    amountCentavos: payment.amount,
    currency: payment.currency,
    date: payment.transaction_date,
    source: redactText(payment.source, redacted),
    note: redactText(payment.note, redacted),
    createdAt: payment.created_at,
    reversedAt: payment.reversed_at,
    reversalSource: redactText(payment.reversal_source, redacted),
    reversalNote: redactText(payment.reversal_note, redacted),
    transactionSnapshot: redacted ? '[REDACTED]' : JSON.parse(payment.transaction_snapshot_json),
  }
}

function paymentFailure(error: unknown) {
  return {
    success: false,
    reason: error instanceof ReceivablePaymentError ? error.reason : 'receivable_payment_conflict',
    message: error instanceof Error ? error.message : 'The receipt could not be applied safely.',
  }
}

function incomeEvidence(id: string): IncomeTransactionRow | undefined {
  return query<IncomeTransactionRow>(
    `SELECT t.*, a.account_mode, a.is_archived AS account_is_archived,
      EXISTS (SELECT 1 FROM card_statement_payment_links p WHERE p.transaction_id = t.id AND p.voided_at IS NULL) AS is_card_payment,
      EXISTS (SELECT 1 FROM transaction_consumption_classifications c WHERE c.transaction_id = t.id AND c.role NOT IN ('earned_income', 'other_income')) AS is_non_income_classification
      FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE t.id = $1`,
    [id]
  )[0]
}

function resolveOptionalAccount(accountId?: string, account?: string) {
  const normalizedAccountId = optionalText(accountId)
  const normalizedAccount = optionalText(account)
  if (!normalizedAccountId && !normalizedAccount) {
    return { success: true as const, id: null, currency: null, name: null }
  }

  const resolved = resolveAccountId(
    normalizedAccountId ?? undefined,
    normalizedAccount ?? undefined
  )
  if (!resolved.success) return resolved

  const accountRow = query<{ name: string | null }>(
    'SELECT name FROM accounts WHERE id = $1 LIMIT 1',
    [resolved.id]
  )[0]
  return {
    success: true as const,
    id: resolved.id,
    currency: resolved.currency,
    name: accountRow?.name ?? null,
  }
}

function linkedAccountCurrency(accountId: string | null): string | null {
  if (!accountId) return null
  return (
    query<{ currency: string }>('SELECT currency FROM accounts WHERE id = $1 LIMIT 1', [
      accountId,
    ])[0]?.currency ?? null
  )
}

function accountCurrencyFailure(currency: string, accountCurrency: string | null) {
  if (
    !accountCurrency ||
    normalizeCurrencyCode(currency) === normalizeCurrencyCode(accountCurrency)
  ) {
    return null
  }
  return {
    success: false as const,
    reason: 'receivable_currency_mismatch' as const,
    message: `Receivable currency ${currency} does not match linked account currency ${accountCurrency}.`,
  }
}

function statusForAmounts(amount: number, receivedAmount: number): ReceivableStatus {
  if (receivedAmount >= amount) return 'received'
  return receivedAmount > 0 ? 'partial' : 'open'
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) throw new Error(message)
}

const manageReceivable: ToolDefinition = {
  name: 'manage-receivable',
  description:
    'Create, update, cancel, or delete a receivable. Amount inputs and display fields use main currency units; stored values use centavos.',
  schema: z.object({
    action: z
      .enum(['create', 'update', 'cancel', 'delete'])
      .describe('The lifecycle action to perform'),
    receivableId: boundedText(
      'Receivable ID',
      'Required for update, cancel, and delete',
      128
    ).optional(),
    payer: boundedText('Payer', 'Person or organization expected to pay', 200).optional(),
    amount: positiveMoneyAmount('Expected amount in the main currency unit').optional(),
    dueDate: isoDate('Due date in YYYY-MM-DD format').optional(),
    currency: currencyCode('Three-letter currency code').optional(),
    projectReference: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Optional project reference. Pass an empty string on update to clear.'),
    invoiceReference: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe('Optional invoice reference. Pass an empty string on update to clear.'),
    accountId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('Optional linked account ID. Pass an empty string on update to clear.'),
    account: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe(
        'Optional account alias, ID, or exact name. Pass an empty string on update to clear.'
      ),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Optional receivable notes. Pass an empty string on update to clear.'),
    source: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Optional automation source. Pass an empty string on update to clear.'),
    note: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe('Optional workflow note. Pass an empty string on update to clear.'),
    redacted: z.boolean().optional().default(false).describe('Redact payer and reference fields'),
    apply: z.boolean().optional().default(false).describe('Apply the mutation. Omit to preview.'),
  }),
  execute: async ({
    action,
    receivableId,
    payer,
    amount,
    dueDate,
    currency,
    projectReference,
    invoiceReference,
    accountId,
    account,
    notes,
    source,
    note,
    redacted,
    apply,
  }) => {
    if (action === 'create') {
      if (!payer || amount === undefined || !dueDate) {
        return {
          success: false,
          reason: 'missing_required_fields',
          message: 'payer, amount, and dueDate are required when creating a receivable.',
        }
      }

      const resolvedAccount = resolveOptionalAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      const resolvedCurrency = normalizeCurrencyCode(currency ?? resolvedAccount.currency ?? 'USD')
      const currencyFailure = accountCurrencyFailure(resolvedCurrency, resolvedAccount.currency)
      if (currencyFailure) return currencyFailure
      const now = dayjs().toISOString()
      const receivable: ReceivableWithAccountRow = {
        id: generateId(),
        payer,
        amount: toCentavos(amount),
        received_amount: 0,
        unattributed_received_amount: 0,
        currency: resolvedCurrency,
        due_date: dueDate,
        project_reference: optionalText(projectReference),
        invoice_reference: optionalText(invoiceReference),
        status: 'open',
        account_id: resolvedAccount.id,
        account_name: resolvedAccount.name,
        matched_transaction_id: null,
        notes: optionalText(notes),
        source: optionalText(source),
        note: optionalText(note),
        created_at: now,
        updated_at: now,
      }
      const snapshot = receivableSnapshot(receivable)
      const outputSnapshot = receivableSnapshot(receivable, { redacted })

      if (!apply) {
        return {
          success: true,
          action: 'created' as const,
          dryRun: true,
          wouldCreate: outputSnapshot,
          message: redacted
            ? 'Dry run: the receivable would be created.'
            : `Dry run: receivable from ${payer} would be created.`,
        }
      }

      transaction(() => {
        execute(
          `INSERT INTO receivables (
             id, payer, amount, received_amount, currency, due_date, project_reference,
             invoice_reference, status, account_id, matched_transaction_id, notes, source, note,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            receivable.id,
            receivable.payer,
            receivable.amount,
            receivable.received_amount,
            receivable.currency,
            receivable.due_date,
            receivable.project_reference,
            receivable.invoice_reference,
            receivable.status,
            receivable.account_id,
            receivable.matched_transaction_id,
            receivable.notes,
            receivable.source,
            receivable.note,
            receivable.created_at,
            receivable.updated_at,
          ]
        )
        writeAuditLog({
          entity: 'receivable',
          entityId: receivable.id,
          action: 'create',
          before: null,
          after: { receivable: snapshot },
          source: receivable.source,
          note: receivable.note,
        })
      })

      return {
        success: true,
        action: 'created' as const,
        dryRun: false,
        receivable: outputSnapshot,
        message: redacted
          ? `Created receivable: ${resolvedCurrency} ${amount.toFixed(2)}.`
          : `Created receivable from ${payer}: ${resolvedCurrency} ${amount.toFixed(2)}.`,
      }
    }

    if (!receivableId) {
      return {
        success: false,
        reason: 'receivable_id_required',
        message: `receivableId is required for ${action}.`,
      }
    }

    const existing = getReceivable(receivableId)
    if (!existing) {
      return {
        success: false,
        reason: 'receivable_not_found',
        message: `Receivable ${receivableId} not found.`,
      }
    }
    const beforeSnapshot = receivableSnapshot(existing)
    const beforeOutput = receivableSnapshot(existing, { redacted })

    if (action === 'update') {
      const accountWasProvided = accountId !== undefined || account !== undefined
      const resolvedAccount = accountWasProvided ? resolveOptionalAccount(accountId, account) : null
      if (resolvedAccount && !resolvedAccount.success) return resolvedAccount
      const nextAccountId = resolvedAccount?.success ? resolvedAccount.id : existing.account_id
      const nextAccountName = resolvedAccount?.success
        ? resolvedAccount.name
        : existing.account_name
      const nextCurrency = normalizeCurrencyCode(currency ?? existing.currency)
      const currencyFailure = accountCurrencyFailure(
        nextCurrency,
        linkedAccountCurrency(nextAccountId)
      )
      if (currencyFailure) return currencyFailure
      const nextAmount = amount === undefined ? existing.amount : toCentavos(amount)
      if (nextAmount < existing.received_amount) {
        return {
          success: false,
          reason: 'amount_below_received',
          message: 'Amount cannot be reduced below the amount already received.',
        }
      }
      if (
        existing.received_amount > 0 &&
        (nextAmount !== existing.amount ||
          nextCurrency !== existing.currency ||
          nextAccountId !== existing.account_id)
      ) {
        return {
          success: false,
          reason: 'receivable_has_receipts',
          message: 'Amount, currency, and account cannot change after a receipt is recorded.',
        }
      }

      const fieldsChanged =
        payer !== undefined ||
        amount !== undefined ||
        dueDate !== undefined ||
        currency !== undefined ||
        accountWasProvided ||
        projectReference !== undefined ||
        invoiceReference !== undefined ||
        notes !== undefined ||
        source !== undefined ||
        note !== undefined
      if (!fieldsChanged) {
        return { success: false, reason: 'no_receivable_changes', message: 'No fields to update.' }
      }

      const now = dayjs().toISOString()
      const updated: ReceivableWithAccountRow = {
        ...existing,
        payer: payer ?? existing.payer,
        amount: nextAmount,
        currency: nextCurrency,
        due_date: dueDate ?? existing.due_date,
        project_reference:
          projectReference === undefined
            ? existing.project_reference
            : optionalText(projectReference),
        invoice_reference:
          invoiceReference === undefined
            ? existing.invoice_reference
            : optionalText(invoiceReference),
        account_id: nextAccountId,
        account_name: nextAccountName,
        notes: notes === undefined ? existing.notes : optionalText(notes),
        source: source === undefined ? existing.source : optionalText(source),
        note: note === undefined ? existing.note : optionalText(note),
        status:
          existing.status === 'cancelled'
            ? 'cancelled'
            : statusForAmounts(nextAmount, existing.received_amount),
        updated_at: now,
      }
      const afterSnapshot = receivableSnapshot(updated)
      const afterOutput = receivableSnapshot(updated, { redacted })

      if (!apply) {
        return {
          success: true,
          action: 'updated' as const,
          dryRun: true,
          wouldUpdate: { receivableId, before: beforeOutput, after: afterOutput },
          message: redacted
            ? 'Dry run: the receivable would be updated.'
            : `Dry run: receivable from ${updated.payer} would be updated.`,
        }
      }

      transaction(() => {
        const result = execute(
          `UPDATE receivables
           SET payer = $1, amount = $2, currency = $3, due_date = $4, project_reference = $5,
               invoice_reference = $6, status = $7, account_id = $8, notes = $9, source = $10,
               note = $11, updated_at = $12
            WHERE id = $13
              AND status = $14
              AND received_amount = $15
              AND matched_transaction_id IS $16
              AND updated_at = $17`,
          [
            updated.payer,
            updated.amount,
            updated.currency,
            updated.due_date,
            updated.project_reference,
            updated.invoice_reference,
            updated.status,
            updated.account_id,
            updated.notes,
            updated.source,
            updated.note,
            updated.updated_at,
            receivableId,
            existing.status,
            existing.received_amount,
            existing.matched_transaction_id,
            existing.updated_at,
          ]
        )
        assertSingleRowUpdated(result, `Receivable ${receivableId} could not be updated safely.`)
        writeAuditLog({
          entity: 'receivable',
          entityId: receivableId,
          action: 'update',
          before: { receivable: beforeSnapshot },
          after: { receivable: afterSnapshot },
          source: updated.source,
          note: updated.note,
        })
      })

      return {
        success: true,
        action: 'updated' as const,
        dryRun: false,
        receivable: afterOutput,
        message: redacted ? 'Updated receivable.' : `Updated receivable from ${updated.payer}.`,
      }
    }

    if (action === 'cancel') {
      if (existing.status === 'cancelled') {
        return {
          success: false,
          reason: 'already_cancelled',
          message: 'Receivable is already cancelled.',
        }
      }
      if (existing.status === 'received') {
        return {
          success: false,
          reason: 'received_receivable',
          message:
            'A received receivable cannot be cancelled. Keep it for the payment audit trail.',
        }
      }

      const cancelled: ReceivableWithAccountRow = {
        ...existing,
        status: 'cancelled',
        updated_at: dayjs().toISOString(),
      }
      const afterSnapshot = receivableSnapshot(cancelled)
      const afterOutput = receivableSnapshot(cancelled, { redacted })
      if (!apply) {
        return {
          success: true,
          action: 'cancelled' as const,
          dryRun: true,
          wouldCancel: { receivableId, before: beforeOutput, after: afterOutput },
          message: redacted
            ? 'Dry run: the receivable would be cancelled.'
            : `Dry run: receivable from ${existing.payer} would be cancelled.`,
        }
      }

      transaction(() => {
        const result = execute(
          `UPDATE receivables
           SET status = $1, updated_at = $2
           WHERE id = $3 AND status = $4 AND received_amount = $5
             AND matched_transaction_id IS $6 AND updated_at = $7`,
          [
            cancelled.status,
            cancelled.updated_at,
            receivableId,
            existing.status,
            existing.received_amount,
            existing.matched_transaction_id,
            existing.updated_at,
          ]
        )
        assertSingleRowUpdated(result, `Receivable ${receivableId} could not be cancelled safely.`)
        writeAuditLog({
          entity: 'receivable',
          entityId: receivableId,
          action: 'cancel',
          before: { receivable: beforeSnapshot },
          after: { receivable: afterSnapshot },
          source: cancelled.source,
          note: cancelled.note,
        })
      })

      return {
        success: true,
        action: 'cancelled' as const,
        dryRun: false,
        receivable: afterOutput,
        message: redacted
          ? 'Cancelled receivable.'
          : `Cancelled receivable from ${existing.payer}.`,
      }
    }

    if (
      existing.matched_transaction_id ||
      existing.received_amount > 0 ||
      existing.payments?.length
    ) {
      return {
        success: false,
        reason: 'receivable_has_receipts',
        message:
          'Receivables with payment history cannot be deleted. Cancel them to preserve the audit trail.',
      }
    }
    if (!apply) {
      return {
        success: true,
        action: 'deleted' as const,
        dryRun: true,
        wouldDelete: beforeOutput,
        message: redacted
          ? 'Dry run: the receivable would be deleted.'
          : `Dry run: receivable from ${existing.payer} would be deleted.`,
      }
    }

    transaction(() => {
      const result = execute(
        `DELETE FROM receivables
         WHERE id = $1 AND received_amount = 0 AND matched_transaction_id IS NULL
           AND status = $2 AND updated_at = $3`,
        [receivableId, existing.status, existing.updated_at]
      )
      assertSingleRowUpdated(result, `Receivable ${receivableId} could not be deleted safely.`)
      writeAuditLog({
        entity: 'receivable',
        entityId: receivableId,
        action: 'delete',
        before: { receivable: beforeSnapshot },
        after: null,
        source: existing.source,
        note: existing.note,
      })
    })

    return {
      success: true,
      action: 'deleted' as const,
      dryRun: false,
      receivable: beforeOutput,
      message: redacted ? 'Deleted receivable.' : `Deleted receivable from ${existing.payer}.`,
    }
  },
}

const listReceivables: ToolDefinition = {
  name: 'list-receivables',
  effects: { readOnly: true, writesTo: [] },
  description:
    'List receivables with lifecycle, due-date, payer, account, overdue, and text filters. Returns stable centavo and display fields.',
  schema: z.object({
    status: z
      .enum(['open', 'partial', 'received', 'cancelled'])
      .optional()
      .describe('Filter by status'),
    dueStart: isoDate('Inclusive due-date range start (YYYY-MM-DD)').optional(),
    dueEnd: isoDate('Inclusive due-date range end (YYYY-MM-DD)').optional(),
    payer: boundedText('Payer', 'Filter by exact payer name', 200).optional(),
    search: boundedText('Search', 'Search payer, references, and notes', 200).optional(),
    accountId: boundedText('Account ID', 'Filter by linked account ID', 128).optional(),
    account: boundedText(
      'Account',
      'Filter by linked account alias, ID, or exact name',
      128
    ).optional(),
    overdue: z.boolean().optional().describe('Filter by the derived overdue state'),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact payer, references, account names, and notes'),
    includePayments: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include preserved active and reversed receipt evidence'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  execute: async ({
    status,
    dueStart,
    dueEnd,
    payer,
    search,
    accountId,
    account,
    overdue,
    redacted,
    includePayments,
    limit,
  }) => {
    if (dueStart && dueEnd && dueStart > dueEnd) {
      return {
        success: false,
        reason: 'invalid_due_range',
        message: 'dueStart must be on or before dueEnd.',
      }
    }

    const conditions: string[] = []
    const params: unknown[] = []
    let parameter = 1
    const addCondition = (sql: string, value: unknown) => {
      conditions.push(sql.replace('?', `$${parameter++}`))
      params.push(value)
    }
    let resolvedAccountId: string | null = null
    if (status) addCondition('r.status = ?', status)
    if (dueStart) addCondition('r.due_date >= ?', dueStart)
    if (dueEnd) addCondition('r.due_date <= ?', dueEnd)
    if (payer) addCondition('LOWER(r.payer) = LOWER(?)', payer)
    if (accountId || account) {
      const resolvedAccount = resolveOptionalAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      resolvedAccountId = resolvedAccount.id
      addCondition('r.account_id = ?', resolvedAccount.id)
    }
    if (search) {
      const pattern = `%${search}%`
      const placeholders = [
        `$${parameter++}`,
        `$${parameter++}`,
        `$${parameter++}`,
        `$${parameter++}`,
      ]
      conditions.push(
        `(LOWER(r.payer) LIKE LOWER(${placeholders[0]}) OR LOWER(COALESCE(r.project_reference, '')) LIKE LOWER(${placeholders[1]}) OR LOWER(COALESCE(r.invoice_reference, '')) LIKE LOWER(${placeholders[2]}) OR LOWER(COALESCE(r.notes, '')) LIKE LOWER(${placeholders[3]}))`
      )
      params.push(pattern, pattern, pattern, pattern)
    }

    const asOf = dayjs().format('YYYY-MM-DD')
    if (overdue === true) {
      addCondition(
        "r.status IN ('open', 'partial') AND r.due_date < ? AND r.amount > r.received_amount",
        asOf
      )
    } else if (overdue === false) {
      addCondition(
        "NOT (r.status IN ('open', 'partial') AND r.due_date < ? AND r.amount > r.received_amount)",
        asOf
      )
    }
    params.push(limit)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const receivables = query<ReceivableWithAccountRow>(
      `SELECT r.*, a.name AS account_name
       FROM receivables r
       LEFT JOIN accounts a ON a.id = r.account_id
       ${where}
       ORDER BY r.due_date ASC, LOWER(r.payer) ASC, r.id ASC
       LIMIT $${parameter}`,
      params
    )
    const receiptRows = receivables.length
      ? query<ReceivablePaymentLink>(
          `SELECT * FROM receivable_payment_links WHERE receivable_id IN (${receivables.map((_, index) => `$${index + 1}`).join(',')}) ORDER BY created_at, id`,
          receivables.map((receivable) => receivable.id)
        )
      : []
    const snapshots = receivables.map((receivable) =>
      receivableSnapshot(
        {
          ...receivable,
          payments: receiptRows.filter((payment) => payment.receivable_id === receivable.id),
        },
        { redacted, asOf, includePayments }
      )
    )

    return {
      success: true,
      receivables: snapshots,
      count: snapshots.length,
      redacted,
      filters: {
        status: status ?? null,
        dueStart: dueStart ?? null,
        dueEnd: dueEnd ?? null,
        payer: payer ?? null,
        search: search ?? null,
        accountId: resolvedAccountId,
        overdue: overdue ?? null,
      },
      message:
        snapshots.length === 0
          ? 'No receivables found.'
          : `Found ${snapshots.length} receivable${snapshots.length === 1 ? '' : 's'}.`,
    }
  },
}

const matchReceivable: ToolDefinition = {
  name: 'match-receivable',
  description:
    'Preview or link a posted income transaction as a partial or final receivable payment. Existing bank income is preserved; active match retries are no-ops.',
  schema: z.object({
    receivableId: boundedText('Receivable ID', 'The expected income to settle', 128),
    transactionId: boundedText('Transaction ID', 'A posted or cleared income transaction ID', 128),
    apply: z.boolean().optional().default(false).describe('Apply the receipt; defaults to preview'),
    expectedToken: boundedText(
      'Expected token',
      'Token from the reviewed receipt preview; rejects changed evidence',
      128
    ).optional(),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    redacted: z.boolean().optional().default(false).describe('Redact payer and reference fields'),
  }),
  execute: async ({
    receivableId,
    transactionId,
    apply,
    expectedToken,
    source,
    note,
    redacted,
  }) => {
    try {
      return transaction(() => {
        const receivable = getReceivable(receivableId)
        if (!receivable)
          return {
            success: false,
            reason: 'receivable_not_found',
            message: `Receivable ${receivableId} not found.`,
          }
        const income = incomeEvidence(transactionId)
        if (!income)
          return {
            success: false,
            reason: 'transaction_not_found',
            message: `Transaction ${transactionId} not found.`,
          }
        const payments = paymentLinks(receivableId, transactionId)
        const plan = planReceivablePayment({ receivable, payments, income })
        const token = importPlanToken({ action: 'match', receivable, payments, income })
        if (apply && !plan.replayed && expectedToken && token !== expectedToken)
          throw new ReceivablePaymentError(
            'stale_preview',
            'Payment evidence changed. Preview again and pass its current token before applying.'
          )
        const transactionSnapshot = {
          id: income.id,
          accountId: redactText(income.account_id, redacted),
          amount: fromCentavos(income.amount),
          amountCentavos: income.amount,
          currency: income.currency,
          type: income.type,
          status: income.status,
          ledgerTreatment: income.ledger_treatment,
          description: redacted ? '[REDACTED]' : income.description,
          date: income.date,
        }
        if (plan.replayed) {
          return {
            success: true,
            action: 'matched',
            dryRun: !apply,
            changed: false,
            replayed: true,
            token,
            receivable: receivableSnapshot(receivable, { redacted }),
            payment: paymentSnapshot(plan.payment, redacted),
            transaction: transactionSnapshot,
            message: 'This bank transaction is already linked to this receivable. Nothing changed.',
          }
        }
        const now = dayjs().toISOString()
        const link: ReceivablePaymentLink = {
          id: generateId(),
          receivable_id: receivableId,
          transaction_id: transactionId,
          amount: income.amount,
          currency: normalizeCurrencyCode(income.currency!),
          transaction_date: income.date,
          transaction_snapshot_json: JSON.stringify(income),
          source: source ?? receivable.source,
          note: note ?? receivable.note,
          created_at: now,
          reversed_at: null,
          reversal_source: null,
          reversal_note: null,
        }
        const projected: ReceivableWithAccountRow = {
          ...receivable,
          received_amount: plan.after.receivedAmount,
          status: plan.after.status,
          matched_transaction_id: plan.after.matchedTransactionId,
          updated_at: now,
          payments: [...(receivable.payments ?? []), link],
        }
        if (!apply) {
          return {
            success: true,
            action: 'matched',
            dryRun: true,
            changed: true,
            token,
            wouldMatch: {
              receivable: receivableSnapshot(projected, { redacted }),
              transaction: transactionSnapshot,
            },
            payment: paymentSnapshot(link, redacted),
            message:
              'Preview: link this existing bank payment without creating another income transaction.',
          }
        }
        execute(
          `INSERT INTO receivable_payment_links
            (id, receivable_id, transaction_id, amount, currency, transaction_date,
             transaction_snapshot_json, source, note, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            link.id,
            link.receivable_id,
            link.transaction_id,
            link.amount,
            link.currency,
            link.transaction_date,
            link.transaction_snapshot_json,
            link.source,
            link.note,
            link.created_at,
          ]
        )
        const saved = getReceivable(receivableId)!
        writeAuditLog({
          entity: 'receivable',
          entityId: receivableId,
          action: 'match',
          before: { receivable: receivableSnapshot(receivable), transaction: income },
          after: { receivable: receivableSnapshot(saved), payment: link },
          source: link.source,
          note: link.note,
        })
        return {
          success: true,
          action: 'matched',
          dryRun: false,
          changed: true,
          token,
          receivable: receivableSnapshot(saved, { redacted }),
          payment: paymentSnapshot(link, redacted),
          transaction: transactionSnapshot,
          message:
            saved.status === 'received'
              ? 'The receivable is fully received.'
              : 'Partial payment linked; the remaining amount is still expected.',
        }
      })
    } catch (error) {
      return paymentFailure(error)
    }
  },
}

const unmatchReceivable: ToolDefinition = {
  name: 'unmatch-receivable',
  description:
    'Preview or reverse a receivable payment link, preserving bank transactions and receipt history. Select paymentId or all=true when several payments exist.',
  schema: z.object({
    receivableId: boundedText('Receivable ID', 'Expected income with receipt history', 128),
    paymentId: boundedText(
      'Payment ID',
      'One receipt link to reverse; omit for a sole active payment',
      200
    ).optional(),
    all: z
      .boolean()
      .optional()
      .default(false)
      .describe('Explicitly reverse all active payment links'),
    apply: z
      .boolean()
      .optional()
      .default(false)
      .describe('Apply the reversal; defaults to preview'),
    expectedToken: boundedText(
      'Expected token',
      'Token from the reviewed reversal preview; rejects changed receipts',
      128
    ).optional(),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    redacted: z.boolean().optional().default(false).describe('Redact payer and reference fields'),
  }),
  execute: async ({
    receivableId,
    paymentId,
    all,
    apply,
    expectedToken,
    source,
    note,
    redacted,
  }) => {
    try {
      return transaction(() => {
        const receivable = getReceivable(receivableId)
        if (!receivable)
          return {
            success: false,
            reason: 'receivable_not_found',
            message: `Receivable ${receivableId} not found.`,
          }
        const plan = planReceivablePaymentReversal({
          receivable,
          payments: receivable.payments ?? [],
          paymentId,
          all,
        })
        const token = importPlanToken({
          action: 'reverse',
          receivable,
          paymentId: paymentId ?? null,
          all,
        })
        if (apply && !plan.replayed && expectedToken && token !== expectedToken)
          throw new ReceivablePaymentError(
            'stale_preview',
            'Payment evidence changed. Preview again and pass its current token before applying.'
          )
        const now = dayjs().toISOString()
        const projected: ReceivableWithAccountRow = {
          ...receivable,
          received_amount: plan.after.receivedAmount,
          status: plan.after.status,
          matched_transaction_id: plan.after.matchedTransactionId,
          updated_at: plan.replayed ? receivable.updated_at : now,
          payments: (receivable.payments ?? []).map((payment) =>
            plan.paymentIds.includes(payment.id) ? { ...payment, reversed_at: now } : payment
          ),
        }
        if (!apply || plan.replayed) {
          return {
            success: true,
            dryRun: !apply,
            changed: !plan.replayed,
            replayed: plan.replayed,
            token,
            paymentIds: plan.paymentIds,
            ...(!apply
              ? { wouldUnmatch: receivableSnapshot(projected, { redacted }) }
              : { receivable: receivableSnapshot(projected, { redacted }) }),
            message: plan.replayed
              ? 'The selected payment links are already reversed.'
              : 'Preview: reverse the selected receipts while preserving the original bank income.',
          }
        }
        for (const id of plan.paymentIds) {
          assertSingleRowUpdated(
            execute(
              `UPDATE receivable_payment_links SET reversed_at = $1, reversal_source = $2, reversal_note = $3
              WHERE id = $4 AND receivable_id = $5 AND reversed_at IS NULL`,
              [now, source ?? null, note ?? null, id, receivableId]
            ),
            'The selected receipt changed. Refresh its payment history before retrying.'
          )
        }
        const saved = getReceivable(receivableId)!
        writeAuditLog({
          entity: 'receivable',
          entityId: receivableId,
          action: 'unmatch',
          before: { receivable: receivableSnapshot(receivable), payments: receivable.payments },
          after: { receivable: receivableSnapshot(saved), paymentIds: plan.paymentIds },
          source: source ?? receivable.source,
          note: note ?? receivable.note,
        })
        const transactionIds = (receivable.payments ?? [])
          .filter((payment) => plan.paymentIds.includes(payment.id))
          .map((payment) => payment.transaction_id)
        return {
          success: true,
          dryRun: false,
          changed: true,
          token,
          receivable: receivableSnapshot(saved, { redacted }),
          paymentIds: plan.paymentIds,
          transactionIds,
          transactionId: transactionIds.length === 1 ? transactionIds[0] : null,
          message:
            'Receipt links reversed. The bank transactions and original receipt evidence remain preserved.',
        }
      })
    } catch (error) {
      return paymentFailure(error)
    }
  },
}

export const receivablesTools: ToolDefinition[] = [
  manageReceivable,
  listReceivables,
  matchReceivable,
  unmatchReceivable,
]
