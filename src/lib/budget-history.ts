import {
  BudgetHistoryError,
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
import { withTransaction } from '@/lib/database'
import { loadScopedSnapshot } from '@/lib/scoped-report-read'
import { generateId } from '@/lib/ulid'

export type BudgetHistoryEntry = ReturnType<typeof budgetHistorySummary>
export type AppBudgetHistoryRequest = Omit<BudgetHistoryRequest, 'source'>

export function listBudgetHistory(budgetId?: string) {
  return withTransaction(async (tx) => {
    const [rows, budgets] = await Promise.all([
      tx.query<BudgetHistoryRow>(
        `SELECT * FROM budget_history_revisions ${budgetId ? 'WHERE budget_id = ?' : ''}
         ORDER BY month DESC, budget_id, revision DESC LIMIT 201`,
        budgetId ? [budgetId] : []
      ),
      tx.query<{ id: string; name: string; currency: string; amount: number }>(
        'SELECT id, name, currency, amount FROM budgets ORDER BY name, id'
      ),
    ])
    return {
      history: rows.slice(0, 200).map((row) => budgetHistorySummary(row)),
      budgets,
      truncated: rows.length > 200,
    }
  })
}

export function recordBudgetHistory(input: AppBudgetHistoryRequest, dryRun = false) {
  return withTransaction(async (tx) => {
    const request: BudgetHistoryRequest = { ...input, source: 'app' }
    const requestJson = budgetHistoryRequestJson(request)
    request.budgetId = request.budgetId.trim()
    request.idempotencyKey = request.idempotencyKey.trim()
    const replay = (
      await tx.query<BudgetHistoryRow>(
        'SELECT * FROM budget_history_revisions WHERE idempotency_key = ?',
        [request.idempotencyKey]
      )
    )[0]
    if (replay) {
      if (replay.request_json !== requestJson)
        throw new BudgetHistoryError(
          'budget_history_idempotency_conflict',
          'This request key belongs to a different correction. Review a new preview.'
        )
      return {
        history: budgetHistorySummary(replay),
        previewToken: budgetHistoryPreviewToken(replay),
        changed: false,
        replayed: true,
        dryRun,
      }
    }
    const [latestRows, budgetRows, states] = await Promise.all([
      tx.query<BudgetHistoryRow>(
        'SELECT * FROM budget_history_revisions WHERE budget_id = ? AND month = ? ORDER BY revision DESC LIMIT 1',
        [request.budgetId, request.month]
      ),
      tx.query<HistoricalBudgetDefinition>('SELECT * FROM budgets WHERE id = ?', [
        request.budgetId,
      ]),
      tx.query<{ database_id: string; data_revision: number }>(
        'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
      ),
    ])
    const state = states[0]
    if (!state)
      throw new BudgetHistoryError(
        'invalid_source_state',
        'Database identity and revision are unavailable.'
      )
    const latest = latestRows[0] ?? null
    const snapshot = await loadScopedSnapshot(tx)
    const row = planBudgetHistory({
      request,
      latest,
      budget: budgetRows[0] ?? null,
      dataset: snapshot.dataset,
      id: generateId(),
      now: new Date(),
      sourceState: { databaseId: state.database_id, dataRevision: state.data_revision },
    })
    const previewToken = budgetHistoryPreviewToken(row)
    if (!dryRun) {
      assertBudgetHistoryPreview(request.expectedToken, previewToken)
      const statement = budgetHistoryInsert(row)
      await tx.execute(statement.sql, statement.params)
      await tx.execute(
        'INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [
          generateId(),
          'budget_history',
          row.id,
          latest ? 'append_correction' : 'capture',
          latest ? JSON.stringify({ revisionId: latest.id, revision: latest.revision }) : null,
          JSON.stringify(budgetHistorySummary(row)),
          'app',
          request.reason,
          row.created_at,
        ]
      )
    }
    return {
      history: budgetHistorySummary(row),
      previewToken,
      changed: !dryRun,
      replayed: false,
      dryRun,
    }
  })
}
