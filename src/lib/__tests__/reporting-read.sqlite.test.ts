// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/database', () => ({
  query: async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params),
  execute: vi.fn(),
}))
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { CATEGORY_ALLOCATION_CTE } from '../reporting-read'
import { aggregateHeatmapSpending, fetchHeatmapLedgerRows } from '../spending-heatmap'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-18T12:00:00Z'))
  const db = (state.db = new Database(':memory:'))
  db.exec(`
    CREATE TABLE transactions (id TEXT, type TEXT, amount INTEGER, currency TEXT, date TEXT,
      category_id TEXT, status TEXT, ledger_treatment TEXT, reporting_treatment TEXT, transaction_kind TEXT, is_archived INTEGER);
    CREATE TABLE transaction_splits (id TEXT, transaction_id TEXT, category_id TEXT, amount INTEGER);
    CREATE TABLE categories (id TEXT, name TEXT, color TEXT);
    INSERT INTO categories VALUES ('food', 'Food', '#fff'), ('other', 'Other Expenses', '#000');
    INSERT INTO transactions VALUES ('split', 'expense', 1001, 'USD', '2026-06-15', 'food', 'posted', NULL, NULL, NULL, 0),
      ('unsplit', 'expense', 199, 'USD', '2026-06-15', 'other', 'cleared', NULL, NULL, NULL, 0),
      ('staged', 'expense', 999999, '', '2026-06-15', 'food', 'posted', 'staged_no_balance_impact', NULL, NULL, 0);
    INSERT INTO transaction_splits VALUES ('food-split', 'split', 'food', 401), ('other-split', 'split', 'other', 600);
    ALTER TABLE transactions ADD COLUMN account_id TEXT;
    ALTER TABLE transactions ADD COLUMN description TEXT;
  `)
  useCurrencyStore.setState({ preferredCurrency: 'USD', rates: {}, invalidRates: [] })
})
afterEach(() => {
  state.db?.close()
  state.db = null
  vi.useRealTimers()
})

it('executes the frontend category allocation read with centavo and staging parity', async () => {
  await useSpendingInsightsStore.getState().loadComparisons()
  expect(useSpendingInsightsStore.getState()).toMatchObject({
    complete: true,
    momCurrentTotal: 1200,
    momComparisons: expect.arrayContaining([
      expect.objectContaining({ categoryName: 'Food', current: 401 }),
      expect.objectContaining({ categoryName: 'Other Expenses', current: 799 }),
    ]),
  })
})

it('marks malformed splits incomplete rather than showing partial category totals', async () => {
  state.db!.exec("UPDATE transaction_splits SET amount = 400 WHERE id = 'food-split'")
  await useSpendingInsightsStore.getState().loadComparisons()
  expect(useSpendingInsightsStore.getState()).toMatchObject({
    complete: false,
    reason: 'invalid_category_allocations',
    momComparisons: [],
    momCurrentTotal: 0,
  })
})

it('carries invalid allocation state even when a split category is null', () => {
  state.db!.exec(
    "UPDATE transaction_splits SET category_id = NULL, amount = NULL WHERE id = 'food-split'"
  )
  const rows = state
    .db!.prepare(
      `${CATEGORY_ALLOCATION_CTE} SELECT * FROM reporting_allocations WHERE invalid_allocations = 1`
    )
    .all()
  expect(rows).toHaveLength(2)
})

it('reads heatmap split categories with SQLite while preserving parent counts and daily totals', async () => {
  const rows = await fetchHeatmapLedgerRows('2026-06-01', '2026-06-30')
  const result = aggregateHeatmapSpending(rows, 'USD', (amountCentavos) => ({
    complete: true,
    amountCentavos,
  }))
  expect(result.complete).toBe(true)
  expect(result.eligibleTransactions).toHaveLength(2)
  expect(result.totalSpent).toBe(1200)
  expect(result.categoryTotals).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ categoryId: 'food', total: 401 }),
      expect.objectContaining({ categoryId: 'other', total: 799 }),
    ])
  )
})
