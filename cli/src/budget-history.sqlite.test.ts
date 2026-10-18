// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
import {
  budgetHistoryStatements,
  assertBudgetHistoryReady,
  BUDGET_HISTORY_SCHEMA,
} from '@shikin/finance-core/budget-history-migration'
import {
  BudgetHistoryError,
  budgetHistoryInsert,
  readBudgetHistorySnapshot,
  type BudgetHistoryRequest,
  type BudgetHistoryRow,
} from '@shikin/finance-core/budget-history'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database, failAudit: false }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    if (state.failAudit && sql.includes('INSERT INTO audit_log'))
      throw new Error('Synthetic audit failure')
    return { rowsAffected: state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes }
  },
  transaction: (fn: () => unknown) => state.db.transaction(fn).immediate(),
}))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => {
    if (state.failAudit && sql.includes('INSERT INTO audit_log'))
      throw new Error('Synthetic audit failure')
    const result = state.db.prepare(sql).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  }
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        state.db.exec('COMMIT')
        return result
      } catch (error) {
        state.db.exec('ROLLBACK')
        throw error
      }
    },
  }
})

import { budgetHistoryTools } from './tools/budget-history.js'
// @ts-expect-error CLI tsc has no @ alias; Vitest resolves the app adapter.
import { listBudgetHistory, recordBudgetHistory } from '@/lib/budget-history'

const call = (name: string, input: Record<string, unknown> = {}) => {
  const tool = budgetHistoryTools.find((entry) => entry.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const request = (patch: Record<string, unknown> = {}) => ({
  budgetId: 'home-budget',
  month: '2026-01',
  expectedRevision: 0,
  idempotencyKey: 'first-capture',
  dryRun: false,
  reason: 'Reconstructed from January bank statement and original plan',
  timeZone: 'UTC',
  ...patch,
})
async function reviewedRequest(input: Record<string, unknown> = request()) {
  const preview = await call('record-budget-history', { ...input, dryRun: true })
  expect(preview).toMatchObject({ success: true, dryRun: true, changed: false })
  expect(preview.previewToken).toMatch(/^sha256:[a-f0-9]{64}$/)
  return { ...input, dryRun: false, expectedToken: preview.previewToken }
}
async function applyRequest(input: Record<string, unknown> = request()) {
  return call('record-budget-history', await reviewedRequest(input))
}
function databaseSnapshot() {
  const tables = state.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      state.db
        .prepare(
          `SELECT * FROM "${name}" ORDER BY ${['budget_history_revisions', 'receivable_payment_links'].includes(name) ? 'id' : 'rowid'}`
        )
        .all(),
    ])
  )
}
function latest() {
  return state.db
    .prepare('SELECT * FROM budget_history_revisions ORDER BY revision DESC LIMIT 1')
    .get() as BudgetHistoryRow
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-03-05T12:00:00Z'))
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  state.failAudit = false
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO settings (key, value) VALUES ('main_currency', 'MXN');
    INSERT INTO accounts (id, name, type, currency) VALUES ('bank', 'Bank', 'checking', 'MXN');
    INSERT INTO categories (id, name, type) VALUES ('home', 'Home', 'expense'), ('other', 'Other', 'expense');
    INSERT INTO budgets (id,name,amount,currency,period,category_id,scope_json,basis,created_at,updated_at)
      VALUES ('home-budget','Home',20000,'MXN','monthly','home','{"categoryIds":["home"]}','gross_cashflow','2025-12-01T00:00:00Z','2025-12-01T00:00:00Z');
    INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description,import_source,import_external_id)
      VALUES ('purchase','bank','home','expense',10000,'MXN','2026-01-10','Bank purchase evidence','statement','original-bank-id'),
      ('refund','bank','other','income',2000,'MXN','2026-01-15','Partial refund','statement','refund-bank-id');
    INSERT INTO transaction_consumption_classifications (id,transaction_id,role)
      VALUES ('purchase-class','purchase','purchase');
    INSERT INTO transaction_consumption_classifications (id,transaction_id,role,referenced_purchase_id)
      VALUES ('refund-class','refund','refund','purchase-class');
    INSERT INTO source_coverage (id,account_id,source_namespace,period_start,period_end,status)
      VALUES ('january','bank','statement','2026-01-01','2026-01-31','verified');
  `)
})
afterEach(() => {
  state.db.close()
  vi.useRealTimers()
})

describe('append-only monthly budget history', () => {
  it('captures frozen gross/net limits, refund evidence, and explicit retrospective provenance', async () => {
    const bankBefore = state.db.prepare('SELECT * FROM transactions ORDER BY id').all()
    const result = await applyRequest()
    expect(result).toMatchObject({
      success: true,
      changed: true,
      replayed: false,
      history: {
        month: '2026-01',
        revision: 1,
        kind: 'retrospective_reconstruction',
        retrospective: true,
        configuration: {
          amountCentavos: 20000,
          currency: 'MXN',
          period: 'monthly',
          scope: { categoryIds: ['home'] },
        },
        gross: { amountCentavos: 10000, remainingCentavos: 10000, complete: true },
        net: { amountCentavos: 8000, remainingCentavos: 12000, complete: true },
        comparison: { definitionPolicy: 'captured_definition_revision', limitComparable: true },
      },
    })
    expect(result.history.gross.evidence).toBeUndefined()
    const detail = await call('get-budget-history', {
      budgetId: 'home-budget',
      includeEvidence: true,
    })
    expect(detail.history[0].net.evidence.allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: 'refund',
          referencedPurchaseId: 'purchase-class',
          nativeAmountCentavos: 2000,
          categoryId: 'home',
        }),
      ])
    )
    expect(state.db.prepare('SELECT * FROM transactions ORDER BY id').all()).toEqual(bankBefore)
    expect(
      state.db
        .prepare('SELECT COUNT(*) AS count FROM audit_log WHERE entity = ?')
        .get('budget_history')
    ).toEqual({ count: 1 })
  })

  it('preserves the original record through definition edits/deletion and appends corrections against the saved configuration', async () => {
    await applyRequest()
    const original = latest()
    state.db.exec(
      "UPDATE budgets SET amount = 90000, name = 'New current plan', scope_json = '{}' WHERE id = 'home-budget'"
    )
    state.db.exec("DELETE FROM budgets WHERE id = 'home-budget'")
    expect(latest()).toEqual(original)
    const correction = await applyRequest(
      request({
        expectedRevision: 1,
        idempotencyKey: 'january-correction',
        reason: 'Correct January limit per original worksheet',
        correction: { amount: 150 },
      })
    )
    expect(correction.history).toMatchObject({
      revision: 2,
      kind: 'correction',
      supersedesId: original.id,
      originalRevisionId: original.id,
      configuration: { name: 'Home', amountCentavos: 15000, scope: { categoryIds: ['home'] } },
      gross: { amountCentavos: 10000, remainingCentavos: 5000 },
    })
    expect(
      state.db.prepare('SELECT * FROM budget_history_revisions WHERE id = ?').get(original.id)
    ).toEqual(original)
    const all = await call('get-budget-history', {
      budgetId: 'home-budget',
      includeRevisions: true,
    })
    expect(all.history.map((row: { revision: number }) => row.revision)).toEqual([2, 1])
    expect((await call('get-budget-history', { budgetId: 'home-budget' })).history).toHaveLength(1)
  })

  it('does not silently recalculate history after late ledger changes; explicit revision recomputes gross and net', async () => {
    await applyRequest()
    const original = latest()
    state.db
      .exec(`INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description)
      VALUES ('late','bank','home','expense',500,'MXN','2026-01-30','Late statement correction');
      INSERT INTO transaction_consumption_classifications (id,transaction_id,role) VALUES ('late-class','late','purchase');`)
    expect((await call('get-budget-history')).history[0].gross.amountCentavos).toBe(10000)
    const corrected = await applyRequest(
      request({
        expectedRevision: 1,
        idempotencyKey: 'late-statement',
        reason: 'Include the late imported statement row',
      })
    )
    expect(corrected.history.gross.amountCentavos).toBe(10500)
    expect(corrected.history.net.amountCentavos).toBe(8500)
    expect(readBudgetHistorySnapshot(original).gross.amountCentavos).toBe(10000)
  })

  it('keeps net and remaining unknown with incomplete coverage, while retaining the known subtotal', async () => {
    state.db.exec('DELETE FROM source_coverage')
    const result = await applyRequest()
    expect(result.history.net).toMatchObject({
      complete: false,
      amountCentavos: null,
      knownAmountCentavos: 8000,
      remainingCentavos: null,
      coverage: { required: true, complete: false },
    })
    expect(result.history.net.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'coverage' })])
    )
    expect(result.history.gross.amountCentavos).toBe(10000)
  })

  it('has write-free previews and read-only history, with complete rollback when audit insertion fails', async () => {
    const before = databaseSnapshot()
    const preview = await call('record-budget-history', request({ dryRun: undefined }))
    expect(preview).toMatchObject({ success: true, dryRun: true, changed: false })
    await call('get-budget-history')
    expect(databaseSnapshot()).toEqual(before)
    state.failAudit = true
    await expect(
      call('record-budget-history', request({ expectedToken: preview.previewToken }))
    ).rejects.toThrow('Synthetic audit failure')
    expect(databaseSnapshot()).toEqual(before)
  })

  it('safely replays committed receipts and rejects changed request keys, stale revisions, and stale previews', async () => {
    const preview = await call('record-budget-history', request({ dryRun: true }))
    const dataRevision = preview.history.sourceState.dataRevision
    state.db.exec("UPDATE budgets SET name = 'Changed during review'")
    expect(
      await call(
        'record-budget-history',
        request({ expectedDataRevision: dataRevision, expectedToken: preview.previewToken })
      )
    ).toMatchObject({ success: false, reason: 'budget_history_data_conflict' })
    expect(
      state.db.prepare('SELECT COUNT(*) AS count FROM budget_history_revisions').get()
    ).toEqual({ count: 0 })
    const saveRequest = await reviewedRequest()
    const saved = await call('record-budget-history', saveRequest)
    const committed = databaseSnapshot()
    const replay = await call('record-budget-history', saveRequest)
    expect(replay).toMatchObject({
      success: true,
      changed: false,
      replayed: true,
      history: saved.history,
    })
    expect(databaseSnapshot()).toEqual(committed)
    expect(
      await call('record-budget-history', {
        ...saveRequest,
        reason: 'Different request with same key',
      })
    ).toMatchObject({ success: false, reason: 'budget_history_idempotency_conflict' })
    expect(
      await call('record-budget-history', { ...saveRequest, idempotencyKey: 'stale-new-key' })
    ).toMatchObject({ success: false, reason: 'budget_history_revision_conflict' })
  })

  it('enforces append-only chain invariants in SQLite, not only in tool handlers', async () => {
    await applyRequest()
    const original = latest()
    expect(() =>
      state.db.prepare('UPDATE budget_history_revisions SET reason = ?').run('overwrite')
    ).toThrow('append-only')
    expect(() => state.db.exec('DELETE FROM budget_history_revisions')).toThrow('append-only')
    const replace = budgetHistoryInsert({
      ...original,
      revision: 2,
      supersedes_id: original.id,
      kind: 'correction',
    })
    expect(() =>
      state.db
        .prepare(replace.sql.replace('INSERT INTO', 'INSERT OR REPLACE INTO'))
        .run(...replace.params)
    ).toThrow('identity already exists')
    expect(state.db.pragma('recursive_triggers', { simple: true })).toBe(0)
    const replacement = budgetHistoryInsert({
      ...original,
      id: 'different-history',
      budget_id: 'different-budget',
      idempotency_key: 'different-key',
    })
    for (const hiddenRowId of ['rowid', '_rowid_', 'oid']) {
      expect(() =>
        state.db
          .prepare(
            replacement.sql
              .replace('INSERT INTO', 'INSERT OR REPLACE INTO')
              .replace('(id,', `(${hiddenRowId},id,`)
              .replace('VALUES (', 'VALUES (1,')
          )
          .run(...replacement.params)
      ).toThrow(`no column named ${hiddenRowId}`)
    }
    const statement = budgetHistoryInsert({
      ...original,
      id: 'gap',
      idempotency_key: 'gap',
      revision: 3,
      supersedes_id: original.id,
      kind: 'correction',
    })
    expect(() => state.db.prepare(statement.sql).run(...statement.params)).toThrow(
      'revision conflict'
    )
    expect(latest()).toEqual(original)
  })

  it('reports missing captured months, paginates revisions, and rejects future or malformed requests', async () => {
    await applyRequest()
    await applyRequest(
      request({ month: '2026-03', idempotencyKey: 'march', reason: 'Capture month to date' })
    )
    const history = await call('get-budget-history', {
      budgetId: 'home-budget',
      startMonth: '2025-12',
      endMonth: '2026-03',
      limit: 1,
    })
    expect(history.missingMonths).toEqual(['2025-12', '2026-02'])
    expect(history.nextOffset).toBe(1)
    expect(history.history[0]).toMatchObject({
      month: '2026-03',
      kind: 'capture',
      retrospective: false,
      window: { end: '2026-03-05' },
    })
    expect((await call('get-budget-history', { limit: 1, offset: 1 })).history[0].month).toBe(
      '2026-01'
    )
    expect(
      await call('record-budget-history', request({ month: '2026-04', idempotencyKey: 'future' }))
    ).toMatchObject({ success: false, reason: 'future_history_month' })
    expect(() => call('record-budget-history', request({ month: '2026-13' }))).toThrow()
    expect(() => call('record-budget-history', request({ unexpected: true }))).toThrow()
  })

  it('withholds monthly remaining for a yearly plan instead of comparing one month against an annual limit', async () => {
    state.db.exec("UPDATE budgets SET period = 'yearly'")
    const result = await applyRequest()
    expect(result.history).toMatchObject({
      configuration: { period: 'yearly', amountCentavos: 20000 },
      comparison: { limitComparable: false, reason: 'calendar_month_is_not_plan_period' },
      gross: { amountCentavos: 10000, remainingCentavos: null },
    })
  })

  it('uses identical financial projection and atomic audits in app and CLI adapters', async () => {
    const cli = await call('record-budget-history', request({ dryRun: true }))
    const appRequest = {
      budgetId: ' home-budget ',
      month: '2026-01',
      expectedRevision: 0,
      idempotencyKey: ' app-preview ',
      reason: 'Review January',
      timeZone: 'UTC',
    }
    const before = databaseSnapshot()
    const appPreview = await recordBudgetHistory(appRequest, true)
    expect(databaseSnapshot()).toEqual(before)
    for (const field of ['configuration', 'window', 'comparison', 'gross', 'net', 'sourceState'])
      expect(appPreview.history[field as keyof typeof appPreview.history]).toEqual(
        cli.history[field]
      )
    const saveRequest = {
      ...appRequest,
      expectedDataRevision: appPreview.history.sourceState.dataRevision,
      expectedToken: appPreview.previewToken,
    }
    const saved = await recordBudgetHistory(saveRequest)
    expect(saved).toMatchObject({ changed: true, history: { source: 'app' } })
    expect((await listBudgetHistory('home-budget')).history[0]).toEqual(saved.history)
    expect(await recordBudgetHistory(saveRequest)).toMatchObject({
      changed: false,
      replayed: true,
      history: saved.history,
    })
    state.failAudit = true
    const committed = databaseSnapshot()
    const correctionRequest = {
      ...appRequest,
      expectedRevision: 1,
      idempotencyKey: 'app-correction',
    }
    const correctionPreview = await recordBudgetHistory(correctionRequest, true)
    await expect(
      recordBudgetHistory({ ...correctionRequest, expectedToken: correctionPreview.previewToken })
    ).rejects.toThrow('Synthetic audit failure')
    expect(databaseSnapshot()).toEqual(committed)
  })
})

describe.each(['cli', 'app'] as const)('budget-history reviewed apply through %s', (adapter) => {
  const input: Omit<BudgetHistoryRequest, 'source'> = {
    budgetId: 'home-budget',
    month: '2026-10',
    expectedRevision: 0,
    idempotencyKey: 'reviewed-october',
    reason: 'Capture October from available statement evidence',
    timeZone: 'UTC',
  }
  const invoke = async (request: Omit<BudgetHistoryRequest, 'source'>, dryRun: boolean) => {
    if (adapter === 'cli') return call('record-budget-history', { ...request, dryRun })
    try {
      return { success: true, ...(await recordBudgetHistory(request, dryRun)) }
    } catch (error) {
      if (error instanceof BudgetHistoryError)
        return { success: false, reason: error.code, message: error.message }
      throw error
    }
  }

  it('requires the reviewed token and binds request intent without writing on rejection', async () => {
    vi.setSystemTime(new Date('2026-10-17T23:59:00Z'))
    const before = databaseSnapshot()
    expect(await invoke(input, false)).toMatchObject({
      success: false,
      reason: 'budget_history_preview_required',
    })
    const preview = await invoke(input, true)
    expect(preview.previewToken).toMatch(/^sha256:[a-f0-9]{64}$/)
    for (const change of [{ reason: 'An unreviewed reason' }, { idempotencyKey: 'another-key' }]) {
      expect(
        await invoke({ ...input, ...change, expectedToken: preview.previewToken }, false)
      ).toMatchObject({ success: false, reason: 'budget_history_stale_preview' })
    }
    expect(databaseSnapshot()).toEqual(before)
  })

  it('rejects midnight cutoff drift with unchanged data revision and replays committed requests before revalidation', async () => {
    vi.setSystemTime(new Date('2026-10-17T23:59:00Z'))
    state.db
      .exec(`INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description,status)
      VALUES ('tomorrow','bank','home','expense',10000,'MXN','2026-10-18','Already posted future-dated evidence','posted')`)
    const preview = await invoke(input, true)
    expect(preview.history).toMatchObject({
      window: { end: '2026-10-17' },
      gross: { amountCentavos: 0 },
    })
    const before = databaseSnapshot()
    vi.setSystemTime(new Date('2026-10-18T00:01:00Z'))
    expect(
      await invoke(
        {
          ...input,
          expectedToken: preview.previewToken,
          expectedDataRevision: preview.history.sourceState.dataRevision,
        },
        false
      )
    ).toMatchObject({ success: false, reason: 'budget_history_stale_preview' })
    expect(databaseSnapshot()).toEqual(before)
    const fresh = await invoke(input, true)
    expect(fresh.history).toMatchObject({
      window: { end: '2026-10-18' },
      gross: { amountCentavos: 10000 },
      sourceState: preview.history.sourceState,
    })
    expect(fresh.previewToken).not.toEqual(preview.previewToken)
    const apply = {
      ...input,
      expectedToken: fresh.previewToken,
      expectedDataRevision: fresh.history.sourceState.dataRevision,
    }
    const saved = await invoke(apply, false)
    expect(saved).toMatchObject({ success: true, changed: true, replayed: false })
    const committed = databaseSnapshot()
    vi.setSystemTime(new Date('2026-11-01T00:01:00Z'))
    expect(await invoke(apply, false)).toMatchObject({
      success: true,
      changed: false,
      replayed: true,
      history: saved.history,
      previewToken: fresh.previewToken,
    })
    expect(databaseSnapshot()).toEqual(committed)
  })

  it('rejects a different database identity with the same revision and financial projection', async () => {
    vi.setSystemTime(new Date('2026-10-17T23:59:00Z'))
    const preview = await invoke(input, true)
    state.db.exec("UPDATE app_data_state SET database_id = 'different-database' WHERE id = 1")
    const before = databaseSnapshot()
    expect(
      await invoke(
        {
          ...input,
          expectedToken: preview.previewToken,
          expectedDataRevision: preview.history.sourceState.dataRevision,
        },
        false
      )
    ).toMatchObject({ success: false, reason: 'budget_history_stale_preview' })
    const fresh = await invoke(input, true)
    expect(fresh.history.sourceState).toEqual({
      databaseId: 'different-database',
      dataRevision: preview.history.sourceState.dataRevision,
    })
    expect(fresh.history.gross).toEqual(preview.history.gross)
    expect(fresh.previewToken).not.toEqual(preview.previewToken)
    expect(databaseSnapshot()).toEqual(before)
  })
})

describe('budget history migration', () => {
  it('does not invent past records, changes no legacy amounts, and checks exact protective schema objects', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys = ON')
      runHostedTestMigrations(db, 24)
      db.exec(
        "INSERT INTO budgets (id,name,amount,currency,period) VALUES ('legacy','Legacy',12345,'MXN','monthly'); INSERT INTO budget_periods (id,budget_id,start_date,end_date,spent) VALUES ('old','legacy','2025-12-01','2025-12-31',9876)"
      )
      const before = db.prepare('SELECT * FROM budget_periods').all()
      db.transaction(() => {
        for (const sql of budgetHistoryStatements()) db.exec(sql)
      }).immediate()
      expect(db.prepare('SELECT * FROM budget_periods').all()).toEqual(before)
      expect(db.prepare('SELECT * FROM budget_history_revisions').all()).toEqual([])
      const columns = Object.fromEntries(
        Object.keys(BUDGET_HISTORY_SCHEMA).map((table) => [
          table,
          (db.pragma(`table_info(${table})`) as { name: string }[]).map((row) => row.name),
        ])
      )
      const objects = () =>
        db
          .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table','trigger','index')")
          .all() as { name: string; sql: string | null }[]
      expect(() => assertBudgetHistoryReady(columns, objects())).not.toThrow()
      db.exec('DROP TRIGGER trg_budget_history_no_delete')
      expect(() => assertBudgetHistoryReady(columns, objects())).toThrow(
        'trg_budget_history_no_delete'
      )
    } finally {
      db.close()
    }
  })
})
