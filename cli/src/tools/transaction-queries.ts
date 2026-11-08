import { loadScopedDataset, scopedActual, storedBudgetScope } from '../scoped-report-read.js'
import { getCurrencySettings } from '../fx-service.js'
import { normalizeReportScope } from '@shikin/finance-core'
import {
  z,
  query,
  transaction,
  fromCentavos,
  boundedText,
  isoDate,
  resolveAccountId,
  type ToolDefinition,
} from './shared.js'
import { sha256Fingerprint } from '@shikin/finance-core/imports'
import {
  normalizeLedgerTreatment,
  normalizeReportingTreatment,
  publicFxEvidence,
  normalizeTransactionTagKey,
  parseStoredTransactionTags,
  type TransactionStatus,
  type LedgerTreatment,
  type ReportingTreatment,
  type PlaceholderTransactionStatus,
  type TransactionTag,
  type TransactionFxEvidenceRow,
} from '../transaction-values.js'

const placeholderStatusSchema = z.enum(['unresolved', 'resolved', 'split', 'cancelled'])

type QueriedTransactionRow = {
  id: string
  description: string
  amount: number
  currency: string | null
  type: 'expense' | 'income' | 'transfer'
  date: string
  notes: string | null
  status: TransactionStatus
  source: string | null
  note: string | null
  recurring_rule_id: string | null
  ledger_treatment: LedgerTreatment | null
  reporting_treatment: ReportingTreatment | null
  transaction_kind: 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror' | null
  staging_batch_id: string | null
  finalization_id: string | null
  reconciliation_id: string | null
  matched_transaction_id: string | null
  is_archived: number | null
  tags: string | null
  is_placeholder: number | null
  placeholder_status: PlaceholderTransactionStatus | null
  resolved_at: string | null
  resolved_by_transaction_id: string | null
  placeholder_reason: string | null
  placeholder_parent_transaction_id: string | null
  category_name: string
  account_name: string
  transfer_to_account_id: string | null
  transfer_to_account_name: string | null
  reconciliation_date: string | null
  reconciliation_account_id: string | null
  reconciliation_adjustment_amount: number | null
  reconciliation_staging_batch_id: string | null
  statement_start_date: string | null
  statement_end_date: string | null
  reconciliation_source: string | null
  reconciliation_note: string | null
}

function transactionTagOutput(tags: TransactionTag[]) {
  return {
    tags: tags.map((tag) => tag.label),
    tagDetails: tags,
  }
}

// ---------------------------------------------------------------------------
// 4. query-transactions
// ---------------------------------------------------------------------------

type TransactionCursorPayload = {
  version: 1
  databaseId: string
  dataRevision: number
  filtersFingerprint: string
  date: string
  createdAt: string
  id: string
}

type TransactionSplitRow = {
  id: string
  transaction_id: string
  category_id: string
  subcategory_id: string | null
  amount: number
  notes: string | null
  created_at: string
  category_name: string
  subcategory_name: string | null
}

function encodeTransactionCursor(payload: TransactionCursorPayload): string {
  const body = JSON.stringify(payload)
  const checksum = sha256Fingerprint(body)
  return Buffer.from(JSON.stringify({ body, checksum }), 'utf8').toString('base64url')
}

function decodeTransactionCursor(value: string): TransactionCursorPayload {
  try {
    const decodedBody = Buffer.from(value, 'base64url').toString('utf8')
    if (Buffer.from(decodedBody, 'utf8').toString('base64url') !== value)
      throw new Error('noncanonical cursor')
    const wrapper = JSON.parse(decodedBody) as {
      body?: unknown
      checksum?: unknown
    }
    if (typeof wrapper.body !== 'string' || wrapper.checksum !== sha256Fingerprint(wrapper.body)) {
      throw new Error('checksum mismatch')
    }
    const payload = JSON.parse(wrapper.body) as Partial<TransactionCursorPayload>
    if (
      payload.version !== 1 ||
      typeof payload.databaseId !== 'string' ||
      !Number.isSafeInteger(payload.dataRevision) ||
      typeof payload.filtersFingerprint !== 'string' ||
      typeof payload.date !== 'string' ||
      typeof payload.createdAt !== 'string' ||
      typeof payload.id !== 'string'
    ) {
      throw new Error('invalid cursor fields')
    }
    return payload as TransactionCursorPayload
  } catch {
    throw new Error('Malformed or tampered transaction cursor.')
  }
}

export const queryTransactions: ToolDefinition = {
  name: 'query-transactions',
  description:
    'Search and exhaustively traverse transactions with a bounded, snapshot-consistent keyset cursor.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    categoryId: boundedText('Category ID', 'Filter by category ID', 128).optional(),
    type: z.enum(['expense', 'income', 'transfer']).optional(),
    status: z.enum(['pending', 'posted', 'cleared']).optional(),
    ledgerTreatment: z.enum(['normal', 'staged_no_balance_impact']).optional(),
    reportingTreatment: z.enum(['normal', 'exclude_from_cashflow']).optional(),
    stagingBatchId: boundedText('Staging batch ID', 'Filter by staging batch', 128).optional(),
    includeArchived: z.boolean().optional().default(false),
    startDate: isoDate('Start date (YYYY-MM-DD) inclusive').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) inclusive').optional(),
    search: boundedText('Search term', 'Search transaction descriptions', 200).optional(),
    tag: boundedText('Tag', 'Filter by transaction tag label or key', 120).optional(),
    cursor: boundedText(
      'Cursor',
      'Opaque continuation cursor returned by an earlier page',
      4096
    ).optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
    budgetId: boundedText('Budget ID', 'Select contributors to this stored budget', 128).optional(),
    scope: z
      .object({
        accountIds: z.array(z.string()).optional(),
        excludeAccountIds: z.array(z.string()).optional(),
        categoryIds: z.array(z.string().nullable()).optional(),
        excludeCategoryIds: z.array(z.string().nullable()).optional(),
        tags: z.array(z.string()).optional(),
        excludeTags: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    basis: z.enum(['gross_cashflow', 'net_consumption']).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    asOf: isoDate('Reference date').optional(),
    start: isoDate('Window start').optional(),
    end: isoDate('Window end').optional(),
    through: z.enum(['as_of', 'period_end']).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
    timeZone: z.string().optional(),
    period: z.enum(['week', 'month', 'year', 'custom']).optional(),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) => {
    try {
      return transaction(() => {
        const {
          accountId,
          categoryId,
          type,
          status,
          ledgerTreatment,
          reportingTreatment,
          stagingBatchId,
          includeArchived,
          startDate,
          endDate,
          search,
          tag,
          cursor,
          limit,
        } = input
        const scoped =
          input.budgetId !== undefined ||
          input.scope !== undefined ||
          input.basis !== undefined ||
          input.currency !== undefined ||
          input.asOf !== undefined ||
          input.start !== undefined ||
          input.end !== undefined ||
          input.through !== undefined ||
          input.weekStartsOn !== undefined ||
          input.timeZone !== undefined ||
          input.period !== undefined
        const tagKey = tag ? normalizeTransactionTagKey(tag) : null
        if (tag && !tagKey) return { success: false, message: 'Tag filter must not be empty.' }
        const canonicalFilters = {
          accountId: accountId ?? null,
          categoryId: categoryId ?? null,
          type: type ?? null,
          status: status ?? null,
          ledgerTreatment: ledgerTreatment ?? null,
          reportingTreatment: reportingTreatment ?? null,
          stagingBatchId: stagingBatchId ?? null,
          includeArchived: Boolean(includeArchived),
          startDate: startDate ?? null,
          endDate: endDate ?? null,
          search: search ?? null,
          tagKey,
          order: ['date:desc', 'created_at:desc', 'id:desc'],
        }
        let selection: ReturnType<typeof scopedActual> | null = null
        let scopedDefinition: unknown = null
        if (scoped) {
          if (
            [
              accountId,
              categoryId,
              type,
              status,
              ledgerTreatment,
              reportingTreatment,
              stagingBatchId,
              includeArchived,
              startDate,
              endDate,
              search,
              tag,
            ].some((value) => value !== undefined && value !== false)
          )
            return {
              success: false,
              reason: 'conflicting_filters',
              message: 'Scoped contributor queries cannot combine legacy transaction filters.',
            }
          const budget = input.budgetId
            ? query<{
                id: string
                currency: string
                basis: 'gross_cashflow' | 'net_consumption'
                period: 'weekly' | 'monthly' | 'yearly'
                scope_json: string
                category_id: string | null
                amount: number
                is_active: number
              }>(
                'SELECT id,currency,basis,period,scope_json,category_id,amount,is_active FROM budgets WHERE id=$1',
                [input.budgetId]
              )[0]
            : null
          if (input.budgetId && !budget)
            return { success: false, reason: 'budget_not_found', message: 'Budget not found.' }
          if (
            budget &&
            (input.scope !== undefined || input.basis !== undefined || input.currency !== undefined)
          )
            return {
              success: false,
              reason: 'conflicting_definition',
              message: 'Budget contributor definition cannot be overridden.',
            }
          const currency = budget?.currency ?? input.currency ?? getCurrencySettings().mainCurrency
          if (!currency)
            return {
              success: false,
              reason: 'main_currency_unconfigured',
              message: 'Supply currency or configure main currency.',
            }
          let scope: unknown = normalizeReportScope(input.scope)
          if (budget) {
            try {
              scope = storedBudgetScope(budget)
            } catch {
              scope = budget.scope_json
            }
          }
          const period =
            input.period ??
            (budget
              ? ({ weekly: 'week', monthly: 'month', yearly: 'year' } as const)[budget.period]
              : undefined)
          selection = scopedActual({
            dataset: loadScopedDataset(),
            scope,
            currency,
            basis: budget?.basis ?? input.basis ?? 'gross_cashflow',
            window: {
              period,
              asOf: input.asOf,
              start: input.start,
              end: input.end,
              through: input.through,
              weekStartsOn: input.weekStartsOn,
              timeZone: input.timeZone,
            },
          })
          scopedDefinition = {
            budget: budget
              ? {
                  id: budget.id,
                  scope: budget.scope_json,
                  categoryId: budget.category_id,
                  currency: budget.currency,
                  basis: budget.basis,
                  period: budget.period,
                  amount: budget.amount,
                  isActive: budget.is_active,
                }
              : null,
            scope: selection.scope,
            currency: selection.currency,
            basis: selection.basis,
            window: selection.window,
          }
        }
        const filtersFingerprint = sha256Fingerprint(
          JSON.stringify(
            scoped
              ? { definition: scopedDefinition, order: canonicalFilters.order }
              : canonicalFilters
          )
        )
        const state = query<{ database_id: string; data_revision: number }>(
          'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
        )[0]
        if (!state || !state.database_id || !Number.isSafeInteger(state.data_revision)) {
          return {
            success: false,
            reason: 'data_state_unavailable',
            message: 'Transaction traversal requires a ready app_data_state singleton.',
          }
        }
        let decoded: TransactionCursorPayload | null = null
        if (cursor) {
          decoded = decodeTransactionCursor(cursor)
          if (decoded.databaseId !== state.database_id) {
            return {
              success: false,
              reason: 'cursor_database_mismatch',
              message: 'This cursor belongs to a different database.',
            }
          }
          if (decoded.filtersFingerprint !== filtersFingerprint) {
            return {
              success: false,
              reason: 'cursor_filter_mismatch',
              message: 'Cursor filters do not match this query.',
            }
          }
          if (decoded.dataRevision !== state.data_revision) {
            return {
              success: false,
              reason: 'cursor_stale',
              message: 'Transaction data changed after the previous page. Restart traversal.',
            }
          }
        }

        const conditions: string[] = []
        const params: unknown[] = []
        const add = (condition: (placeholder: string) => string, value: unknown) => {
          params.push(value)
          conditions.push(condition(`$${params.length}`))
        }
        if (accountId) {
          params.push(accountId, accountId)
          conditions.push(
            `(t.account_id = $${params.length - 1} OR t.transfer_to_account_id = $${params.length})`
          )
        }
        if (categoryId) add((p) => `t.category_id = ${p}`, categoryId)
        if (type) add((p) => `t.type = ${p}`, type)
        if (status) add((p) => `COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = ${p}`, status)
        if (ledgerTreatment)
          add((p) => `COALESCE(t.ledger_treatment, 'normal') = ${p}`, ledgerTreatment)
        if (reportingTreatment)
          add((p) => `COALESCE(t.reporting_treatment, 'normal') = ${p}`, reportingTreatment)
        if (stagingBatchId) add((p) => `t.staging_batch_id = ${p}`, stagingBatchId)
        if (!includeArchived) conditions.push('COALESCE(t.is_archived, 0) = 0')
        if (startDate) add((p) => `t.date >= ${p}`, startDate)
        if (endDate) add((p) => `t.date <= ${p}`, endDate)
        if (search) add((p) => `t.description LIKE ${p}`, `%${search}%`)
        if (tagKey) {
          const first = params.length + 1
          params.push(tagKey, tagKey, tagKey, tagKey, tagKey)
          conditions.push(`json_valid(t.tags) AND EXISTS (
            SELECT 1 FROM json_each(t.tags) AS tag_value
            WHERE (tag_value.type = 'text' AND lower(trim(tag_value.value)) = $${first})
               OR (tag_value.type = 'object' AND (
                 lower(trim(COALESCE(json_extract(tag_value.value, '$.key'), ''))) = $${first + 1}
                 OR lower(trim(COALESCE(json_extract(tag_value.value, '$.label'), ''))) = $${first + 2}
                 OR lower(trim(COALESCE(json_extract(tag_value.value, '$.name'), ''))) = $${first + 3}
                 OR lower(trim(COALESCE(json_extract(tag_value.value, '$.value'), ''))) = $${first + 4}
               )))`)
        }
        if (selection) {
          if (selection.transactionIds.length) {
            params.push(JSON.stringify(selection.transactionIds))
            conditions.push(`t.id IN (SELECT value FROM json_each($${params.length}))`)
          } else conditions.push('0=1')
        }
        const baseWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
        const countParams = [...params]
        const totalMatched =
          query<{ count: number }>(
            `SELECT COUNT(*) AS count FROM transactions t ${baseWhere}`,
            countParams
          )[0]?.count ?? 0
        if (decoded) {
          const first = params.length + 1
          params.push(
            decoded.date,
            decoded.date,
            decoded.createdAt,
            decoded.date,
            decoded.createdAt,
            decoded.id
          )
          conditions.push(`(t.date < $${first}
            OR (t.date = $${first + 1} AND t.created_at < $${first + 2})
            OR (t.date = $${first + 3} AND t.created_at = $${first + 4} AND t.id < $${first + 5}))`)
        }
        const pageWhere = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
        params.push(limit + 1)
        const transactionRows = query<QueriedTransactionRow & { created_at: string }>(
          `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.created_at, t.notes,
                  COALESCE(NULLIF(TRIM(t.status), ''), 'posted') AS status, t.source, t.note,
                  t.recurring_rule_id, t.tags, t.transfer_to_account_id, t.ledger_treatment,
                  t.reporting_treatment, t.transaction_kind, t.staging_batch_id, t.finalization_id,
                  t.reconciliation_id, t.matched_transaction_id, t.is_archived, t.is_placeholder,
                  t.placeholder_status, t.resolved_at, t.resolved_by_transaction_id,
                  t.placeholder_reason, t.placeholder_parent_transaction_id,
                  COALESCE(c.name, 'Uncategorized') AS category_name, a.name AS account_name,
                  ta.name AS transfer_to_account_name, ar.reconciliation_date,
                  ar.account_id AS reconciliation_account_id,
                  ar.adjustment_amount AS reconciliation_adjustment_amount,
                  ar.staging_batch_id AS reconciliation_staging_batch_id,
                  ar.statement_start_date, ar.statement_end_date,
                  ar.source AS reconciliation_source, ar.note AS reconciliation_note
           FROM transactions t
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts a ON t.account_id = a.id
           LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
           LEFT JOIN account_reconciliations ar ON t.reconciliation_id = ar.id
           ${pageWhere}
           ORDER BY t.date DESC, t.created_at DESC, t.id DESC
           LIMIT $${params.length}`,
          params
        )
        const hasMore = transactionRows.length > limit
        const pageRows = transactionRows.slice(0, limit)
        const splitsByTransaction = new Map<string, TransactionSplitRow[]>()
        const fxEvidenceByTransaction = new Map<string, TransactionFxEvidenceRow>()
        if (pageRows.length) {
          const placeholders = pageRows.map((_, index) => `$${index + 1}`).join(',')
          const splits = query<TransactionSplitRow>(
            `SELECT s.id, s.transaction_id, s.category_id, s.subcategory_id, s.amount, s.notes,
                    s.created_at, c.name AS category_name, sc.name AS subcategory_name
             FROM transaction_splits s
             LEFT JOIN categories c ON c.id = s.category_id
             LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
             WHERE s.transaction_id IN (${placeholders})
             ORDER BY s.transaction_id ASC, s.created_at ASC, s.id ASC`,
            pageRows.map((row) => row.id)
          )
          for (const split of splits) {
            const list = splitsByTransaction.get(split.transaction_id) ?? []
            list.push(split)
            splitsByTransaction.set(split.transaction_id, list)
          }
          const evidenceRows = query<TransactionFxEvidenceRow>(
            `SELECT * FROM transaction_fx_evidence
             WHERE original_transaction_id IN (${placeholders})
             ORDER BY original_transaction_id ASC, created_at DESC, id DESC`,
            pageRows.map((row) => row.id)
          )
          for (const evidence of evidenceRows) {
            if (!fxEvidenceByTransaction.has(evidence.original_transaction_id)) {
              fxEvidenceByTransaction.set(evidence.original_transaction_id, evidence)
            }
          }
        }
        const last = pageRows.at(-1)
        const nextCursor =
          hasMore && last
            ? encodeTransactionCursor({
                version: 1,
                databaseId: state.database_id,
                dataRevision: state.data_revision,
                filtersFingerprint,
                date: last.date,
                createdAt: last.created_at,
                id: last.id,
              })
            : null
        const transactions = pageRows.map((t) => ({
          id: t.id,
          description: t.description,
          amount: fromCentavos(t.amount),
          currency: t.currency,
          type: t.type,
          category: t.category_name,
          account: t.account_name,
          transferToAccountId: t.transfer_to_account_id,
          transferToAccount: t.transfer_to_account_name,
          date: t.date,
          createdAt: t.created_at,
          notes: t.notes,
          status: t.status,
          source: t.source,
          note: t.note,
          recurringRuleId: t.recurring_rule_id,
          ledgerTreatment: normalizeLedgerTreatment(t.ledger_treatment),
          reportingTreatment: normalizeReportingTreatment(t.reporting_treatment),
          transactionKind: t.transaction_kind ?? 'standard',
          stagingBatchId: t.staging_batch_id,
          finalizationId: t.finalization_id,
          reconciliationId: t.reconciliation_id,
          reconciliation: t.reconciliation_id
            ? {
                id: t.reconciliation_id,
                accountId: t.reconciliation_account_id,
                date: t.reconciliation_date,
                adjustmentAmount: fromCentavos(t.reconciliation_adjustment_amount ?? 0),
                adjustmentAmountCentavos: t.reconciliation_adjustment_amount,
                stagingBatchId: t.reconciliation_staging_batch_id,
                statementStartDate: t.statement_start_date,
                statementEndDate: t.statement_end_date,
                source: t.reconciliation_source,
                note: t.reconciliation_note,
              }
            : null,
          matchedTransactionId: t.matched_transaction_id,
          isArchived: t.is_archived === 1,
          ...transactionTagOutput(parseStoredTransactionTags(t.tags)),
          splits: (splitsByTransaction.get(t.id) ?? []).map((split) => ({
            id: split.id,
            categoryId: split.category_id,
            category: split.category_name,
            subcategoryId: split.subcategory_id,
            subcategory: split.subcategory_name,
            amount: fromCentavos(split.amount),
            amountCentavos: split.amount,
            notes: split.notes,
            createdAt: split.created_at,
          })),
          isPlaceholder: Boolean(t.is_placeholder),
          placeholderStatus: t.placeholder_status,
          resolvedAt: t.resolved_at,
          resolvedByTransactionId: t.resolved_by_transaction_id,
          placeholderReason: t.placeholder_reason,
          placeholderParentTransactionId: t.placeholder_parent_transaction_id,
          fxEvidence: publicFxEvidence(fxEvidenceByTransaction.get(t.id) ?? null),
        }))
        return {
          success: true,
          ...(selection
            ? {
                selection: {
                  basis: selection.basis,
                  currency: selection.currency,
                  scope: selection.scope,
                  window: selection.window,
                  complete: selection.complete,
                  issues: selection.issues,
                  budgetUsage: selection.budgetUsage,
                  definitionPolicy: selection.definitionPolicy,
                },
                contributors: pageRows.map(
                  (row) => selection!.contributors.find((c) => c.transactionId === row.id) ?? null
                ),
                allocations: selection.allocations.filter((a) =>
                  pageRows.some((row) => row.id === a.transactionId)
                ),
              }
            : {}),
          transactions,
          count: transactions.length,
          totalMatched,
          hasMore,
          nextCursor,
          dataRevision: state.data_revision,
          message: transactions.length
            ? `Found ${totalMatched} transaction${totalMatched === 1 ? '' : 's'}; returned ${transactions.length}.`
            : 'No transactions found matching your criteria.',
        }
      })
    } catch (error) {
      return {
        success: false,
        reason: 'invalid_cursor',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },
}

export const listTags: ToolDefinition = {
  name: 'list-tags',
  description: 'List transaction tags with usage counts.',
  schema: z.object({}),
  execute: async () => {
    const rows = query<{ id: string; date: string; tags: string | null }>(
      `SELECT id, date, tags
       FROM transactions
       WHERE tags IS NOT NULL AND TRIM(tags) NOT IN ('', '[]')
       ORDER BY date DESC, created_at DESC`,
      []
    )
    const tagsByKey = new Map<
      string,
      { key: string; label: string; count: number; lastUsedDate: string | null }
    >()

    for (const row of rows) {
      for (const tag of parseStoredTransactionTags(row.tags)) {
        const existing = tagsByKey.get(tag.key)
        if (!existing) {
          tagsByKey.set(tag.key, {
            key: tag.key,
            label: tag.label,
            count: 1,
            lastUsedDate: row.date ?? null,
          })
          continue
        }
        existing.count += 1
        if (row.date && (!existing.lastUsedDate || row.date > existing.lastUsedDate)) {
          existing.lastUsedDate = row.date
        }
      }
    }

    const tags = [...tagsByKey.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    )

    return {
      tags,
      count: tags.length,
      message:
        tags.length === 0
          ? 'No transaction tags found.'
          : `Found ${tags.length} tag${tags.length === 1 ? '' : 's'}.`,
    }
  },
}

export const listPlaceholderTransactions: ToolDefinition = {
  name: 'list-placeholder-transactions',
  description:
    'List transactions marked as placeholders, optionally filtered by placeholder status.',
  schema: z.object({
    status: placeholderStatusSchema.optional().describe('Filter by placeholder status'),
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, ID, or exact account name',
      200
    ).optional(),
    limit: z.number().int().min(1).max(100).optional().default(50),
  }),
  execute: async ({ status, accountId, account, limit }) => {
    const conditions = ['t.is_placeholder = 1']
    const params: unknown[] = []
    let paramIndex = 0

    if (status) {
      paramIndex++
      conditions.push(`t.placeholder_status = $${paramIndex}`)
      params.push(status)
    }
    if (accountId || account) {
      const resolvedAccount = resolveAccountId(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      paramIndex++
      conditions.push(`t.account_id = $${paramIndex}`)
      params.push(resolvedAccount.id)
    }
    paramIndex++
    params.push(limit)

    const placeholders = query<QueriedTransactionRow>(
      `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.notes, t.status, t.source, t.note, t.recurring_rule_id, t.tags, t.transfer_to_account_id,
              t.is_placeholder, t.placeholder_status, t.resolved_at, t.resolved_by_transaction_id, t.placeholder_reason, t.placeholder_parent_transaction_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name,
              ta.name as transfer_to_account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT $${paramIndex}`,
      params
    )

    return {
      placeholders: placeholders.map((t) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        amountCentavos: t.amount,
        currency: t.currency,
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        date: t.date,
        notes: t.notes,
        status: t.status,
        source: t.source,
        note: t.note,
        placeholderStatus: t.placeholder_status,
        resolvedAt: t.resolved_at,
        resolvedByTransactionId: t.resolved_by_transaction_id,
        placeholderReason: t.placeholder_reason,
        placeholderParentTransactionId: t.placeholder_parent_transaction_id,
      })),
      count: placeholders.length,
      message:
        placeholders.length === 0
          ? 'No placeholder transactions found.'
          : `Found ${placeholders.length} placeholder transaction${placeholders.length === 1 ? '' : 's'}.`,
    }
  },
}
