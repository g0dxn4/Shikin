// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { isCashFlowEligible, type CashFlowCandidate } from '@shikin/finance-core'

// The actual readers run against SQLite, but never initialize app storage or notebooks.
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    const result = state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  },
  transaction: (fn: () => unknown) => state.db!.transaction(fn).immediate(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))
vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))
vi.mock('./notebook-path.js', () => ({ isSafeNotebookPathInput: () => true }))

import { transactionsTools } from './tools/transactions.js'
import { analyticsTools } from './tools/analytics.js'
import { budgetsandnetworthTools } from './tools/budgets-and-net-worth.js'
import { auditAndContextTools } from './tools/audit-and-context.js'
import { financialInsightsTools } from './tools/financial-insights.js'
import { CASH_FLOW_SQL } from './reporting-read.js'

const tools = [
  ...transactionsTools,
  ...analyticsTools,
  ...budgetsandnetworthTools,
  ...auditAndContextTools,
  ...financialInsightsTools,
]
function run(name: string, input: Record<string, unknown> = {}) {
  const tool = tools.find((tool) => tool.name === name)!
  return tool.execute(tool.schema.parse(input))
}
function snapshot() {
  const tables = state
    .db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      state.db!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ])
  )
}
function expense(id: string, amount: number, currency = 'USD', category: string | null = 'food') {
  state
    .db!.prepare(
      `INSERT INTO transactions (id, account_id, type, amount, currency, description, date, category_id)
    VALUES (?, 'account', 'expense', ?, ?, ?, '2026-06-15', ?)`
    )
    .run(id, amount, currency, id, category)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-18T12:00:00Z'))
  const db = (state.db = new Database(':memory:'))
  db.exec(
    readFileSync(new URL('../../src-tauri/migrations/001_core_tables.sql', import.meta.url), 'utf8')
  )
  // Nullable legacy columns deliberately allow malformed-row regression fixtures.
  db.exec(`
    ALTER TABLE accounts ADD COLUMN account_mode TEXT DEFAULT 'transactional';
    ALTER TABLE accounts ADD COLUMN is_primary INTEGER DEFAULT 0;
    ALTER TABLE accounts ADD COLUMN credit_limit INTEGER;
    ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER;
    ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER;
    ALTER TABLE transactions ADD COLUMN status TEXT DEFAULT 'posted';
    ALTER TABLE transactions ADD COLUMN reporting_treatment TEXT;
    ALTER TABLE transactions ADD COLUMN ledger_treatment TEXT;
    ALTER TABLE transactions ADD COLUMN transaction_kind TEXT;
    ALTER TABLE transactions ADD COLUMN is_archived INTEGER;
    ALTER TABLE transactions ADD COLUMN source TEXT;
    ALTER TABLE transactions ADD COLUMN note TEXT;
    CREATE TABLE transaction_splits (id TEXT PRIMARY KEY, transaction_id TEXT, category_id TEXT, amount INTEGER);
    CREATE TABLE recaps (id TEXT PRIMARY KEY, type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL,
      title TEXT NOT NULL, summary TEXT NOT NULL, highlights_json TEXT NOT NULL, generated_at TEXT NOT NULL);
    CREATE TABLE audit_log (id TEXT PRIMARY KEY, entity TEXT, entity_id TEXT, action TEXT, before_json TEXT, after_json TEXT, source TEXT, note TEXT, created_at TEXT);
    INSERT INTO accounts (id, name, type) VALUES ('account', 'Synthetic account', 'checking');
    DELETE FROM categories;
    INSERT INTO categories (id, name, type) VALUES ('food', 'Food', 'expense'), ('other', 'Other Expenses', 'expense');
    INSERT INTO budgets (id, name, category_id, amount, period) VALUES ('budget', 'Food', 'food', 1000, 'monthly');
  `)
  expense('split', 1001)
  db.exec(
    `INSERT INTO transaction_splits VALUES ('split-food', 'split', 'food', 401), ('split-other', 'split', 'other', 600)`
  )
  expense('unsplit', 199, 'USD', 'other')
})
afterEach(() => {
  state.db?.close()
  state.db = null
  vi.useRealTimers()
})

describe('gross reporting cross-reader SQLite parity', () => {
  it('matches canonical eligibility including staged, technical, excluded and invalid states', async () => {
    const candidates: CashFlowCandidate[] = [
      { type: 'expense' },
      { type: 'income', status: '\u00a0CLEARED\t' },
      { type: 'expense', status: '' },
      { type: 'expense', status: 'pending' },
      { type: 'expense', ledgerTreatment: 'staged_no_balance_impact' },
      { type: 'expense', reportingTreatment: 'exclude_from_cashflow' },
      { type: 'income', transactionKind: 'reconciliation_bridge' },
      { type: 'expense', transactionKind: 'archived_transfer_mirror' },
      { type: 'expense', isArchived: 1 },
      { type: 'expense', isArchived: 2 },
      { type: 'expense', status: 'invalid' },
      { type: 'expense', ledgerTreatment: 'invalid' as never },
      { type: 'expense', reportingTreatment: 'invalid' as never },
      { type: 'expense', transactionKind: 'invalid' as never },
      { type: 'transfer' },
    ]
    for (const [index, candidate] of candidates.entries()) {
      expense(`matrix-${index}`, 100)
      state
        .db!.prepare(
          `UPDATE transactions SET type = ?, status = ?, ledger_treatment = ?, reporting_treatment = ?, transaction_kind = ?, is_archived = ? WHERE id = ?`
        )
        .run(
          candidate.type,
          candidate.status ?? null,
          candidate.ledgerTreatment ?? null,
          candidate.reportingTreatment ?? null,
          candidate.transactionKind ?? null,
          candidate.isArchived ?? null,
          `matrix-${index}`
        )
      const included = state
        .db!.prepare(`SELECT t.id FROM transactions t WHERE ${CASH_FLOW_SQL} AND t.id = ?`)
        .get(`matrix-${index}`)
      expect(Boolean(included), JSON.stringify(candidate)).toBe(isCashFlowEligible(candidate))
    }
    const summary = await run('get-spending-summary')
    expect(summary.totalExpenses).toBe(14)
    expect(summary.totalIncome).toBe(1)
    expect(
      (await run('get-spending-recap', { type: 'monthly' })).totalsByCurrency[0]
    ).toMatchObject({ totalExpenses: 14, totalIncome: 1 })
    expect((await run('analyze-spending-trends')).months[0]).toMatchObject({
      totalExpenses: 14,
      totalIncome: 1,
    })
    expect((await run('get-budget-status')).budgets[0].spentAmount).toBe(6.01)
  })

  it('allocates split categories once, preserves centavos and agrees across summary/recap/trends/budget/sanity', async () => {
    const before = snapshot()
    const summary = await run('get-spending-summary')
    const recap = await run('get-spending-recap', { type: 'monthly' })
    const trends = await run('analyze-spending-trends')
    const budget = await run('get-budget-status')
    const sanity = await run('finance-sanity-check', { otherExpensesThreshold: 7 })
    expect(summary).toMatchObject({ basis: 'gross_cashflow', totalExpenses: 12, netSavings: -12 })
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Food', amount: 4.01, transactionCount: 1 }),
        expect.objectContaining({ category: 'Other Expenses', amount: 7.99, transactionCount: 2 }),
      ])
    )
    expect(recap.totalsByCurrency[0]).toMatchObject({ totalExpenses: 12, savings: -12 })
    expect(recap.recap.summary).toContain('deficit -$12.00')
    expect(recap.recap.summary).toContain('gross_cashflow')
    expect(recap.totalsByCurrency[0].topCategories).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'Food', total: 4.01 })])
    )
    expect(trends.months[0]).toMatchObject({
      totalExpenses: 12,
      topCategories: expect.arrayContaining([
        expect.objectContaining({ category: 'Food', amount: 4.01 }),
      ]),
    })
    expect(budget.budgets[0]).toMatchObject({ spentAmount: 4.01 })
    expect(sanity.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'high_other_expenses',
          amountCentavos: 799,
          currency: 'USD',
        }),
      ])
    )
    expect(snapshot()).toEqual(before)
  })

  it('counts a parent only once within a category containing multiple splits', async () => {
    state.db!.exec(
      "UPDATE transaction_splits SET amount = 201 WHERE id = 'split-food'; INSERT INTO transaction_splits VALUES ('second-food', 'split', 'food', 200)"
    )
    const summary = await run('get-spending-summary')
    expect(summary.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Food', amount: 4.01, transactionCount: 1 }),
      ])
    )
    const recap = await run('get-spending-recap', { type: 'monthly' })
    expect(recap.totalsByCurrency[0].topCategories).toEqual(
      expect.arrayContaining([expect.objectContaining({ category: 'Food', total: 4.01, count: 1 })])
    )
  })

  it('never mixes currencies and reports signed deficits in mixed-currency recaps', async () => {
    expense('eur', 501, 'EUR', 'other')
    const summary = await run('get-spending-summary')
    const recap = await run('get-spending-recap', { type: 'monthly' })
    expect(summary.totalExpenses).toBeNull()
    expect(summary.totalsByCurrency).toEqual([
      { currency: 'EUR', totalExpenses: 5.01, totalIncome: 0, netSavings: -5.01 },
      { currency: 'USD', totalExpenses: 12, totalIncome: 0, netSavings: -12 },
    ])
    expect(recap.totalsByCurrency.map((row: { savings: number }) => row.savings)).toEqual([
      -5.01, -12,
    ])
    expect(recap.recap.summary).toContain('deficit')
    const sanity = await run('finance-sanity-check', { otherExpensesThreshold: 7 })
    expect(
      sanity.findings.filter((row: { type: string }) => row.type === 'high_other_expenses')
    ).toEqual([expect.objectContaining({ amountCentavos: 799, currency: 'USD' })])
    expense('eur-food', 100, 'EUR')
    expect(await run('get-budget-status')).toMatchObject({
      success: false,
      complete: false,
      reason: 'budget_currency_conversion_required',
    })
  })

  it.each([
    "UPDATE transaction_splits SET amount = 400 WHERE id = 'split-food'",
    "UPDATE transaction_splits SET amount = -1 WHERE id = 'split-food'",
    "UPDATE transaction_splits SET amount = 400.5 WHERE id = 'split-food'",
    "UPDATE transactions SET currency = '' WHERE id = 'split'",
    "UPDATE transactions SET currency = 'US D' WHERE id = 'split'",
    'DELETE FROM transaction_splits; UPDATE transactions SET amount = 9007199254740991',
  ])('withholds complete reports for malformed data: %s', async (sql) => {
    state.db!.exec(sql)
    const before = snapshot()
    for (const name of [
      'get-spending-summary',
      'analyze-spending-trends',
      'get-budget-status',
      'finance-sanity-check',
      'get-spending-recap',
      'save-spending-recap',
    ]) {
      expect(
        await run(name, name.includes('recap') ? { type: 'monthly' } : {}),
        name
      ).toMatchObject({ success: false, complete: false })
    }
    expect(snapshot()).toEqual(before)
  })

  it('rolls back the recap when its required audit write fails', async () => {
    state.db!.exec(
      `CREATE TRIGGER reject_recap_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'test audit failure'); END`
    )
    const before = snapshot()
    await expect(run('save-spending-recap', { type: 'monthly' })).rejects.toThrow(
      'test audit failure'
    )
    expect(snapshot()).toEqual(before)
  })

  it('saves only recap/audit tables, reuses ULIDs, refreshes new currencies, and leaves legacy duplicates intact', async () => {
    const before = snapshot()
    const read = await run('get-spending-recap', { type: 'monthly' })
    expect(snapshot()).toEqual(before)
    expect(read.recap.id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/)
    const saved = await run('save-spending-recap', { type: 'monthly' })
    const after = snapshot()
    expect(
      Object.keys(after).filter(
        (table) => JSON.stringify(after[table]) !== JSON.stringify(before[table])
      )
    ).toEqual(['audit_log', 'recaps'])
    expect(after.audit_log).toHaveLength(1)
    expect(after.recaps).toHaveLength(1)
    expect((after.audit_log as { action: string }[])[0].action).toBe('create')
    const again = await run('save-spending-recap', { type: 'monthly' })
    expect(again.recap.id).toBe(saved.recap.id)
    expect(snapshot()).toEqual(after)
    // Simulate a pre-existing older duplicate. Never silently consolidate history.
    state
      .db!.prepare(
        `INSERT INTO recaps SELECT '01ARZ3NDEKTSV4RRFFQ69G5FAV', type, period_start, period_end, title, summary, highlights_json, '2026-01-01' FROM recaps`
      )
      .run()
    expense('new-currency', 201, 'EUR', 'other')
    const refreshed = await run('save-spending-recap', { type: 'monthly' })
    expect(refreshed.recap.id).toBe(saved.recap.id)
    expect(refreshed.recap.currencies).toEqual(['EUR', 'USD'])
    expect(snapshot().recaps).toHaveLength(2)
    expect(snapshot().audit_log).toHaveLength(2)
    expect((snapshot().audit_log as { action: string }[])[1].action).toBe('replace')
  })
})
