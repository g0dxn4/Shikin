import {
  BudgetHistoryError,
  assertBudgetHistoryMonth,
  assertBudgetHistoryPreview,
  budgetHistoryInsert,
  budgetHistoryPreviewToken,
  budgetHistoryRequestJson,
  budgetHistorySummary,
  planBudgetHistory,
  type BudgetHistoryRequest,
  type BudgetHistoryRow,
  type HistoricalBudgetDefinition,
} from '@shikin/finance-core/budget-history'
import { loadScopedDataset } from '../scoped-report-read.js'
import {
  z,
  query,
  execute,
  transaction,
  generateId,
  boundedText,
  currencyCode,
  positiveMoneyAmount,
  toCentavos,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

const month = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM')
const scope = z
  .object({
    accountIds: z.array(z.string().min(1).max(128)).max(200).optional(),
    excludeAccountIds: z.array(z.string().min(1).max(128)).max(200).optional(),
    categoryIds: z.array(z.string().min(1).max(128).nullable()).max(200).optional(),
    excludeCategoryIds: z.array(z.string().min(1).max(128).nullable()).max(200).optional(),
    tags: z.array(z.string().min(1).max(120)).max(100).optional(),
    excludeTags: z.array(z.string().min(1).max(120)).max(100).optional(),
  })
  .strict()

const recordSchema = z
  .object({
    budgetId: boundedText('Budget ID', 'Stable live or historical budget ID', 128),
    month: month.describe('Calendar month to capture or correct; future months are rejected'),
    expectedRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER - 1)
      .describe('0 for a first capture; otherwise latest saved revision. Corrections append.'),
    expectedDataRevision: z
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .optional()
      .describe('Optional preview guard: sourceState.dataRevision from the reviewed preview'),
    expectedToken: z
      .string()
      .regex(/^sha256:[a-f0-9]{64}$/)
      .optional()
      .describe('Required on apply: unchanged previewToken from reviewing this request and key'),
    idempotencyKey: boundedText(
      'Idempotency key',
      'Unique stable request key; reuse exactly for retries',
      128
    ),
    reason: boundedText(
      'Reason',
      'Why this month is being captured or corrected; identify reconstruction evidence',
      1000
    ),
    correction: z
      .object({
        name: boundedText('Budget name', 'Historical name only', 120).optional(),
        amount: positiveMoneyAmount(
          'Historical limit in its plan currency; does not modify the live budget'
        ).optional(),
        currency: currencyCode('Historical currency; changing requires amount').optional(),
        scope: scope.optional(),
        basis: z.enum(['gross_cashflow', 'net_consumption']).optional(),
      })
      .strict()
      .optional(),
    timeZone: boundedText(
      'Time zone',
      'IANA time zone for the current-month cutoff',
      100
    ).optional(),
    dryRun: z
      .boolean()
      .default(true)
      .describe('Preview by default; apply with false and the reviewed expectedToken'),
  })
  .strict()

const recordBudgetHistory: ToolDefinition = {
  name: 'record-budget-history',
  description:
    'Capture a calendar month or append a reasoned correction without rewriting its original configuration or totals. Past first captures are retrospective reconstructions. Both gross and classified net are saved; unknown totals remain null.',
  schema: recordSchema,
  effects: {
    idempotent: true,
    writesTo: ['budget_history_revisions', 'audit_log', 'app_data_state'],
  },
  execute: async (raw) => {
    const input = recordSchema.parse(raw)
    const request: BudgetHistoryRequest = {
      budgetId: input.budgetId,
      month: input.month,
      expectedRevision: input.expectedRevision,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      source: 'cli_mcp',
      ...(input.expectedToken === undefined ? {} : { expectedToken: input.expectedToken }),
      ...(input.expectedDataRevision === undefined
        ? {}
        : { expectedDataRevision: input.expectedDataRevision }),
      ...(input.timeZone === undefined ? {} : { timeZone: input.timeZone }),
      ...(input.correction === undefined
        ? {}
        : {
            correction: {
              ...(input.correction.name === undefined ? {} : { name: input.correction.name }),
              ...(input.correction.amount === undefined
                ? {}
                : { amountCentavos: toCentavos(input.correction.amount) }),
              ...(input.correction.currency === undefined
                ? {}
                : { currency: input.correction.currency }),
              ...(input.correction.scope === undefined ? {} : { scope: input.correction.scope }),
              ...(input.correction.basis === undefined ? {} : { basis: input.correction.basis }),
            },
          }),
    }
    try {
      return transaction(() => {
        const requestJson = budgetHistoryRequestJson(request)
        const replay = query<BudgetHistoryRow>(
          'SELECT * FROM budget_history_revisions WHERE idempotency_key = $1',
          [request.idempotencyKey]
        )[0]
        if (replay) {
          if (replay.request_json !== requestJson)
            throw new BudgetHistoryError(
              'budget_history_idempotency_conflict',
              'This idempotencyKey was used for a different request. Use the original request for a retry, or a new key for a new correction.'
            )
          return {
            success: true,
            changed: false,
            replayed: true,
            dryRun: input.dryRun,
            previewToken: budgetHistoryPreviewToken(replay),
            history: budgetHistorySummary(replay),
          }
        }
        const latest =
          query<BudgetHistoryRow>(
            'SELECT * FROM budget_history_revisions WHERE budget_id = $1 AND month = $2 ORDER BY revision DESC LIMIT 1',
            [request.budgetId, request.month]
          )[0] ?? null
        const budget =
          query<HistoricalBudgetDefinition>('SELECT * FROM budgets WHERE id = $1', [
            request.budgetId,
          ])[0] ?? null
        const sourceState = query<{ database_id: string; data_revision: number }>(
          'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
        )[0]
        if (!sourceState)
          throw new BudgetHistoryError(
            'invalid_source_state',
            'Database identity and revision are unavailable.'
          )
        const row = planBudgetHistory({
          request,
          latest,
          budget,
          id: generateId(),
          now: new Date(),
          dataset: loadScopedDataset(),
          sourceState: {
            databaseId: sourceState.database_id,
            dataRevision: sourceState.data_revision,
          },
        })
        const previewToken = budgetHistoryPreviewToken(row)
        if (!input.dryRun) {
          assertBudgetHistoryPreview(request.expectedToken, previewToken)
          const statement = budgetHistoryInsert(row)
          execute(statement.sql, statement.params)
          writeAuditLog({
            entity: 'budget_history',
            entityId: row.id,
            action: latest ? 'append_correction' : 'capture',
            before: latest ? { revisionId: latest.id, revision: latest.revision } : null,
            after: budgetHistorySummary(row),
            source: request.source,
            note: request.reason,
            createdAt: row.created_at,
          })
        }
        return {
          success: true,
          changed: !input.dryRun,
          dryRun: input.dryRun,
          replayed: false,
          previewToken,
          history: budgetHistorySummary(row),
          message: input.dryRun
            ? 'Preview only. No history or financial data was written.'
            : 'Budget history saved. Earlier revisions and live budget configuration are unchanged.',
        }
      })
    } catch (error) {
      if (error instanceof BudgetHistoryError)
        return { success: false, reason: error.code, message: error.message }
      throw error
    }
  },
}

const getBudgetHistory: ToolDefinition = {
  name: 'get-budget-history',
  description:
    'Read frozen monthly budget history, including deleted budgets. Shows latest revisions by default; opt into all revisions or native allocation/FX evidence. Missing months are not inferred.',
  schema: z
    .object({
      budgetId: boundedText(
        'Budget ID',
        'Optional stable budget ID, including deleted budgets',
        128
      ).optional(),
      startMonth: month.optional(),
      endMonth: month.optional(),
      includeRevisions: z.boolean().default(false),
      includeEvidence: z.boolean().default(false),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).max(100000).default(0),
    })
    .strict(),
  effects: { readOnly: true, writesTo: [] },
  execute: async ({
    budgetId,
    startMonth,
    endMonth,
    includeRevisions,
    includeEvidence,
    limit,
    offset,
  }) =>
    transaction(() => {
      if (startMonth && endMonth && startMonth > endMonth)
        return {
          success: false,
          reason: 'invalid_history_range',
          message: 'startMonth must be before or equal to endMonth.',
        }
      const conditions: string[] = []
      const params: unknown[] = []
      for (const [value, clause] of [
        [budgetId, 'h.budget_id = ?'],
        [startMonth, 'h.month >= ?'],
        [endMonth, 'h.month <= ?'],
      ] as const) {
        if (value) {
          conditions.push(clause)
          params.push(value)
        }
      }
      if (!includeRevisions)
        conditions.push(
          'h.revision = (SELECT MAX(r.revision) FROM budget_history_revisions r WHERE r.budget_id = h.budget_id AND r.month = h.month)'
        )
      const rows = query<BudgetHistoryRow>(
        `SELECT h.* FROM budget_history_revisions h ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY h.month DESC, h.budget_id, h.revision DESC LIMIT ? OFFSET ?`,
        [...params, limit + 1, offset]
      )
      const missingMonths: string[] = []
      let coverageRangeTruncated = false
      if (budgetId && startMonth && endMonth) {
        const saved = new Set(
          query<{ month: string }>(
            'SELECT DISTINCT month FROM budget_history_revisions WHERE budget_id = ? AND month BETWEEN ? AND ?',
            [budgetId, startMonth, endMonth]
          ).map((row) => row.month)
        )
        let cursor = startMonth
        for (let index = 0; cursor <= endMonth && index < 120; index++) {
          assertBudgetHistoryMonth(cursor)
          if (!saved.has(cursor)) missingMonths.push(cursor)
          const [year, monthNumber] = cursor.split('-').map(Number)
          cursor =
            monthNumber === 12
              ? `${year + 1}-01`
              : `${year}-${String(monthNumber + 1).padStart(2, '0')}`
        }
        coverageRangeTruncated = cursor <= endMonth
      }
      return {
        success: true,
        history: rows.slice(0, limit).map((row) => budgetHistorySummary(row, includeEvidence)),
        nextOffset: rows.length > limit ? offset + limit : null,
        missingMonths,
        coverageRangeTruncated,
        definitionPolicy: 'captured_definition_revision',
        message:
          'Saved revisions only. Missing months require an explicit retrospective reconstruction; current-definition reports are separate.',
      }
    }),
}

export const budgetHistoryTools: ToolDefinition[] = [getBudgetHistory, recordBudgetHistory]
