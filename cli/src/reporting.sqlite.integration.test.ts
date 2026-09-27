// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
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
  db.pragma('foreign_keys = ON')
  runHostedTestMigrations(db)
  db.exec(`
    INSERT INTO settings (key,value,updated_at) VALUES ('main_currency','USD','2026-06-01');
    INSERT INTO accounts (id,name,type,currency,account_mode) VALUES ('account','Synthetic account','checking','USD','transactional');
    DELETE FROM categories;
    INSERT INTO categories (id,name,type) VALUES ('food','Food','expense'),('other','Other Expenses','expense');
    INSERT INTO budgets (id,name,category_id,amount,period) VALUES ('budget','Food','food',1000,'monthly');
  `)
  expense('split', 1001)
  db.exec(
    `INSERT INTO transaction_splits (id,transaction_id,category_id,amount) VALUES ('split-food', 'split', 'food', 401), ('split-other', 'split', 'other', 600)`
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
      try {
        state
          .db!.prepare(
            `UPDATE transactions SET type = ?, status = ?, ledger_treatment = ?, reporting_treatment = ?, transaction_kind = ?, is_archived = ? WHERE id = ?`
          )
          .run(
            candidate.type,
            candidate.status ?? 'posted',
            candidate.ledgerTreatment ?? 'normal',
            candidate.reportingTreatment ?? 'normal',
            candidate.transactionKind ?? 'standard',
            candidate.isArchived ?? 0,
            `matrix-${index}`
          )
      } catch (error) {
        // Latest schema rejects invalid enum evidence at write time rather than allowing
        // old nullable malformed rows. Retain the eligibility proof for accepted rows.
        expect(String(error)).toMatch(/Invalid transaction|constraint failed/)
        state.db!.prepare('DELETE FROM transactions WHERE id = ?').run(`matrix-${index}`)
        continue
      }
      const included = state
        .db!.prepare(`SELECT t.id FROM transactions t WHERE ${CASH_FLOW_SQL} AND t.id = ?`)
        .get(`matrix-${index}`)
      expect(Boolean(included), JSON.stringify(candidate)).toBe(isCashFlowEligible(candidate))
    }
    const summary = await run('get-spending-summary')
    expect(summary.totalExpenses).toBe(13)
    expect(summary.totalIncome).toBe(0)
    expect(
      (await run('get-spending-recap', { type: 'monthly' })).totalsByCurrency[0]
    ).toMatchObject({ totalExpenses: 13, totalIncome: 0 })
    expect((await run('analyze-spending-trends')).months[0]).toMatchObject({
      totalExpenses: 13,
      totalIncome: 0,
    })
    expect((await run('get-budget-status')).budgets[0].spentAmount).toBe(5.01)
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
      "UPDATE transaction_splits SET amount = 201 WHERE id = 'split-food'; INSERT INTO transaction_splits (id,transaction_id,category_id,amount) VALUES ('second-food', 'split', 'food', 200)"
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
      if (sql.includes('9007199254740991') && name === 'get-spending-summary') {
        await expect(run(name), name).rejects.toThrow(/safe integer|Unsafe|exceeds safe/)
      } else if (sql.includes('9007199254740991') && name === 'get-budget-status') {
        // Selected Food remains one safe-integer parent despite the all-category overflow.
        expect((await run(name)).budgets[0].spending.budgetUsage.amountCentavos).toBe(
          Number.MAX_SAFE_INTEGER
        )
      } else {
        expect(
          await run(name, name.includes('recap') ? { type: 'monthly' } : {}),
          name
        ).toMatchObject({ success: false, complete: false })
      }
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
        `INSERT INTO recaps SELECT '01ARZ3NDEKTSV4RRFFQ69G5FAV', type, period_start, period_end, title, summary, highlights_json, '2026-01-01', basis, currency_scope FROM recaps`
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
