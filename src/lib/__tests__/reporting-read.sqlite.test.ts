// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/database', () => ({
  query: async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params),
  execute: vi.fn(),
}))
import { useSpendingInsightsStore } from '@/stores/spending-insights-store'
import { useBudgetStore } from '@/stores/budget-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { assertReportingReadComplete, CATEGORY_ALLOCATION_CTE } from '../reporting-read'
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
    CREATE TABLE budgets (currency TEXT DEFAULT 'USD', id TEXT, category_id TEXT, name TEXT, amount INTEGER, period TEXT,
      is_active INTEGER, created_at TEXT, updated_at TEXT);
    INSERT INTO categories VALUES ('food', 'Food', '#fff'), ('other', 'Other Expenses', '#000');
    INSERT INTO budgets VALUES ('USD', 'food-budget', 'food', 'Food budget', 10000, 'monthly', 1,
      '2026-06-01', '2026-06-01');
    INSERT INTO transactions VALUES ('split', 'expense', 1001, 'USD', '2026-06-15', 'food', 'posted', NULL, NULL, NULL, 0),
      ('unsplit', 'expense', 199, 'USD', '2026-06-15', 'other', 'cleared', NULL, NULL, NULL, 0),
      ('staged', 'expense', 999999, '', '2026-06-15', 'food', 'posted', 'staged_no_balance_impact', NULL, NULL, 0);
    INSERT INTO transaction_splits VALUES ('food-split', 'split', 'food', 401), ('other-split', 'split', 'other', 600);
    ALTER TABLE transactions ADD COLUMN account_id TEXT;
    ALTER TABLE transactions ADD COLUMN description TEXT;
  `)
  useCurrencyStore.setState({
    preferredCurrency: 'USD',
    mainCurrency: 'USD',
    manualRates: [],
    loadRates: async () => {},
  })
  useBudgetStore.setState({ budgets: [], isLoading: false, fetchError: null, error: null })
})
afterEach(() => {
  state.db?.close()
  state.db = null
  vi.useRealTimers()
})

it('executes budget-store split allocation without duplicating the parent', async () => {
  await useBudgetStore.getState().fetch()
  expect(useBudgetStore.getState().budgets).toEqual([
    expect.objectContaining({ id: 'food-budget', spent: 401, remaining: 9599, percentUsed: 4 }),
  ])
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
    momCurrentTotal: null,
  })
})

it.each([
  "UPDATE transactions SET amount = 'not-centavos' WHERE id = 'unsplit'",
  "UPDATE transactions SET amount = 9007199254740992 WHERE id = 'unsplit'",
  "UPDATE transactions SET currency = NULL WHERE id = 'unsplit'",
  "UPDATE transactions SET currency = '' WHERE id = 'unsplit'",
])('withholds malformed eligible parent evidence: %s', async (sql) => {
  state.db!.exec(sql)
  await useSpendingInsightsStore.getState().loadComparisons()
  expect(useSpendingInsightsStore.getState()).toMatchObject({
    complete: false,
    reason: expect.stringMatching(/invalid_category_allocations|invalid_currency_data/),
    momComparisons: [],
    momCurrentTotal: null,
  })
  await expect(useBudgetStore.getState().fetch()).rejects.toMatchObject({
    name: 'ReportingReadError',
    transactionIds: ['unsplit'],
  })
  expect(useBudgetStore.getState().budgets).toEqual([])
})

it('actual frontend validation withholds malformed split evidence', async () => {
  state.db!.exec("UPDATE transaction_splits SET amount = 400 WHERE id = 'food-split'")
  await expect(assertReportingReadComplete('2026-06-01', '2026-06-30')).rejects.toMatchObject({
    reason: 'invalid_category_allocations',
    transactionIds: ['split'],
  })
})

it('carries invalid allocation state even when a split category is null', () => {
  state.db!.exec(
    "UPDATE transaction_splits SET category_id = NULL, amount = NULL WHERE id = 'food-split'"
  )
  const rows = state
    .db!.prepare(
      `${CATEGORY_ALLOCATION_CTE} SELECT * FROM reporting_allocations
       WHERE invalid_allocations = 1 AND transaction_id = 'split'`
    )
    .all()
  expect(rows).toHaveLength(2)
})

it('does not let excluded staged malformed rows poison eligible category reads', async () => {
  state.db!.exec("UPDATE transactions SET amount = 'bad' WHERE id = 'staged'")
  await useSpendingInsightsStore.getState().loadComparisons()
  expect(useSpendingInsightsStore.getState()).toMatchObject({
    complete: true,
    momCurrentTotal: 1200,
  })
})

it('reads heatmap split categories with SQLite while preserving parent counts and daily totals', async () => {
  const rows = await fetchHeatmapLedgerRows('2026-06-01', '2026-06-30')
  const result = aggregateHeatmapSpending(rows, {
    mainCurrency: 'USD',
    manualRates: [],
    today: '2026-06-18',
  })
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

// These are actual SQLite source reads, not pre-aggregated mock results.
import { captureReportingContext, readGrossProjection } from '../dated-reporting-read'
import { readBudgetSpending } from '../budget-dated-read'
import { generateCashFlowForecast } from '../forecast-service'
import { calculateHealthScore } from '../health-score-service'
import { checkAchievements } from '../achievement-service'
import type { DatedExchangeRate } from '@shikin/finance-core/fx'
vi.mock('@/lib/storage', () => ({
  load: async () => ({ get: async () => null, set: async () => {} }),
}))

function manualRate(
  id: string,
  rateDecimal: string,
  effectiveFrom: string,
  fromCurrency = 'USD',
  toCurrency = 'MXN'
): DatedExchangeRate {
  return {
    id,
    rateDecimal,
    effectiveFrom,
    fromCurrency,
    toCurrency,
    supersedesRateId: null,
    createdAt: '2026-06-18',
    sourceNote: null,
  }
}
function seedDatedRows() {
  state.db!.exec(`DELETE FROM transaction_splits; DELETE FROM transactions;
    INSERT INTO transactions (id,type,amount,currency,date,category_id,status,is_archived) VALUES
    ('before','expense',10000,'USD','2026-06-14','food','posted',0),
    ('after','expense',10000,'USD','2026-06-15','food','posted',0);
  `)
  useCurrencyStore.setState({
    mainCurrency: 'MXN',
    preferredCurrency: 'MXN',
    manualRates: [
      manualRate('r17', '17', '2026-06-01'),
      manualRate('r18', '18', '2026-06-15'),
      manualRate('future', '99', '2026-07-01'),
    ],
  })
}
function seedServiceTables() {
  state.db!
    .exec(`CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, balance INTEGER, currency TEXT, is_archived INTEGER);
    CREATE TABLE subscriptions (id TEXT, amount INTEGER, currency TEXT, billing_cycle TEXT, account_id TEXT, is_active INTEGER, next_billing_date TEXT);
    INSERT INTO accounts VALUES ('usd','USD cash','savings',10000,'USD',0);
    UPDATE transactions SET account_id = 'usd';`)
}

it('converts every dated parent before category/day/month grouping across a midmonth change', async () => {
  seedDatedRows()
  const context = captureReportingContext()
  const read = await readGrossProjection('2026-06-01', '2026-06-30', context)
  expect(read).toMatchObject({
    complete: true,
    totalCentavos: 350000,
    nativeTotals: [{ currency: 'USD', amountCentavos: 20000 }],
  })
  expect(read.parents.map((p) => p.conversion?.rateId)).toEqual(['r17', 'r18'])
  const heatmap = aggregateHeatmapSpending(
    await fetchHeatmapLedgerRows('2026-06-01', '2026-06-30'),
    context
  )
  expect([...heatmap.dailyTotals.values()]).toEqual([170000, 180000])
  expect(heatmap.eligibleTransactions.map((p) => p.convertedAmount)).toEqual([170000, 180000])
  expect(heatmap.categoryTotals[0].total).toBe(350000)
  await useSpendingInsightsStore.getState().loadComparisons()
  expect(useSpendingInsightsStore.getState()).toMatchObject({
    complete: true,
    momCurrentTotal: 350000,
  })
  const native = await readGrossProjection('2026-06-01', '2026-06-30', {
    ...context,
    mainCurrency: 'USD',
  })
  expect(native.totalCentavos).toBe(20000)
})

it('apportions the once-rounded parent by stable split ID before category filtering', async () => {
  seedDatedRows()
  state.db!.exec(`DELETE FROM transactions WHERE id = 'after'; UPDATE transactions SET amount = 3;
    INSERT INTO transaction_splits VALUES ('z','before','food',1), ('a','before','other',1), ('m','before','food',1);`)
  useCurrencyStore.setState({ manualRates: [manualRate('half', '0.5', '2026-06-01')] })
  const context = captureReportingContext()
  const read = await readGrossProjection('2026-06-01', '2026-06-30', context)
  expect(read.totalCentavos).toBe(2)
  expect(
    Object.fromEntries(read.parents[0].allocations.map((a) => [a.id, a.convertedAmount]))
  ).toEqual({ a: 1, m: 1, z: 0 })
  const budget = await readBudgetSpending({
    start: '2026-06-01',
    end: '2026-06-30',
    categoryId: 'food',
    currency: 'MXN',
    rates: context.manualRates,
  })
  expect(budget.totalCentavos).toBe(1)
  const heatmap = aggregateHeatmapSpending(
    await fetchHeatmapLedgerRows('2026-06-01', '2026-06-30'),
    context
  )
  expect(heatmap.totalSpent).toBe(2)
  expect(heatmap.categoryTotals.map((c) => c.total)).toEqual([1, 1])
  expect(heatmap.eligibleTransactions[0].convertedAmount).toBe(2)
})

it.each(['unset', 'future-only', 'inverse-only', 'triangulation-only'] as const)(
  'withholds full main totals with %s authority but retains native evidence',
  async (mode) => {
    seedDatedRows()
    useCurrencyStore.setState({
      mainCurrency: mode === 'unset' ? null : 'MXN',
      manualRates:
        mode === 'future-only'
          ? [manualRate('future', '18', '2026-07-01')]
          : mode === 'inverse-only'
            ? [manualRate('inverse', '0.05', '2026-01-01', 'MXN', 'USD')]
            : mode === 'triangulation-only'
              ? [
                  manualRate('a', '1', '2026-01-01', 'USD', 'EUR'),
                  manualRate('b', '18', '2026-01-01', 'EUR', 'MXN'),
                ]
              : [],
    })
    const read = await readGrossProjection('2026-06-01', '2026-06-30', captureReportingContext())
    expect(read.complete).toBe(false)
    expect(read.totalCentavos).toBeNull()
    expect(read.nativeTotals).toEqual([{ currency: 'USD', amountCentavos: 20000 }])
    expect(read.parents.every((p) => p.convertedAmount === null)).toBe(true)
  }
)

it('uses local today for current stocks and future subscription estimates, but historical dates for realized inputs', async () => {
  seedDatedRows()
  seedServiceTables()
  state.db!.exec(
    `INSERT INTO subscriptions VALUES ('sub',30000,'USD','monthly','usd',1,'2026-07-20');`
  )
  const result = await generateCashFlowForecast(90, 0, { accountId: 'usd' })
  expect(result).toMatchObject({
    complete: true,
    currency: 'MXN',
    currentBalance: 180000,
    dailyBurnRate: 18000,
    estimateAsOf: '2026-06-18',
  })
  expect(result.evidence.totalCentavos).toBe(350000)
  expect(result.points).toHaveLength(91)
  expect(result.points[1].projected).toBe(162000)
  expect(result.points[result.points.length - 1]?.date).toBe('2026-09-16')
  const empty = await generateCashFlowForecast(30, 0, { accountId: 'other' })
  expect(empty).toMatchObject({ complete: true, currentBalance: 0, dailyBurnRate: 0 })
  useCurrencyStore.setState({ mainCurrency: null })
  expect(await generateCashFlowForecast()).toMatchObject({
    complete: false,
    currentBalance: null,
    dailyBurnRate: null,
    dailyIncome: null,
    points: [],
  })
})

it('health compares a durable USD plan valued today against individually dated MXN main spending', async () => {
  seedDatedRows()
  seedServiceTables()
  state.db!.exec(
    `DELETE FROM transactions WHERE id = 'after'; UPDATE budgets SET amount = 9500, currency = 'USD';`
  )
  const score = await calculateHealthScore()
  // Native USD spend100 exceeds plan95, but main spending1700 is below today's plan1710.
  expect(score.subscores.find((s) => s.name === 'Budget Adherence')?.score).toBe(100)
  state.db!.exec(`UPDATE budgets SET currency = 'EUR'`)
  await expect(calculateHealthScore()).rejects.toThrow(/unavailable/)
})

it('achievements use dated period money and never award an unknown savings ratio or currency stock', async () => {
  seedDatedRows()
  seedServiceTables()
  state.db!.exec(`DELETE FROM transactions; DELETE FROM budgets;
    INSERT INTO transactions (id,type,amount,currency,date,status,is_archived,account_id) VALUES
    ('inc','income',10000,'USD','2026-05-14','posted',0,'usd'),
    ('exp','expense',8000,'USD','2026-05-15','posted',0,'usd');`)
  useCurrencyStore.setState({
    manualRates: [
      manualRate('income', '18', '2026-05-01'),
      manualRate('expense', '17', '2026-05-15'),
    ],
  })
  expect((await checkAchievements()).map((a) => a.id)).toContain('savings_star')
  useCurrencyStore.setState({ manualRates: [manualRate('too-late', '18', '2026-06-01')] })
  expect((await checkAchievements()).map((a) => a.id)).not.toContain('savings_star')
  useCurrencyStore.setState({ mainCurrency: null })
  const ids = (await checkAchievements()).map((a) => a.id)
  expect(ids).not.toContain('goal_getter')
  expect(ids).not.toContain('budget_boss')
})

it('returns nullable full totals for unsafe converted aggregates and malformed dated source, never complete zero', async () => {
  seedDatedRows()
  state.db!.exec(`UPDATE transactions SET amount = 9007199254740991`)
  useCurrencyStore.setState({ mainCurrency: 'USD', manualRates: [] })
  const unsafe = await readGrossProjection('2026-06-01', '2026-06-30', captureReportingContext())
  expect(unsafe).toMatchObject({
    complete: false,
    totalCentavos: null,
    knownTotalCentavos: null,
    reason: 'invalid_currency_data',
  })
  state.db!.exec(
    `UPDATE transactions SET amount = 100, date = '2026-06-0x' WHERE id = 'before'; DELETE FROM transactions WHERE id = 'after'`
  )
  const malformed = await readGrossProjection('2026-06-01', '2026-06-30', captureReportingContext())
  expect(malformed).toMatchObject({
    complete: false,
    totalCentavos: null,
    reason: 'invalid_currency_data',
    unresolvedIds: ['before'],
  })
})

import { getDashboardSplitRows } from '../dashboard-splits'
it('retains stable split identities in the dashboard data helper', async () => {
  expect(await getDashboardSplitRows('2026-06-01', '2026-06-30')).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: 'food-split', transaction_id: 'split', amount: 401 }),
      expect.objectContaining({ id: 'other-split', transaction_id: 'split', amount: 600 }),
    ])
  )
})
