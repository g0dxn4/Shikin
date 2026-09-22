// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
  notes: new Map<string, string>(),
}))
vi.mock('../database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db.transaction(fn).immediate(),
}))
vi.mock('../notebook.js', () => ({
  noteExists: async (path: string) => state.notes.has(path),
  writeNote: async (path: string, content: string) => {
    state.notes.set(path, content)
  },
  writeNoteIfAbsent: async (path: string, content: string) => {
    if (state.notes.has(path)) return false
    state.notes.set(path, content)
    return true
  },
}))
import { setExchangeRate, setMainCurrency } from '../fx-service.js'
import { financialInsightsTools } from '../tools/financial-insights.js'
import { alertsAndForecastTools } from '../tools/alerts-and-forecast.js'
import { listSubscriptionsSummary, getSubscriptionSpendingSummary } from './subscriptions.js'
import { generatePortfolioReview } from './portfolio.js'

const tools = [...financialInsightsTools, ...alertsAndForecastTools]
const run = (name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const rows = (table: string) => state.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
function rate(date: string, decimal: string, fromCurrency = 'USD', toCurrency = 'MXN') {
  return setExchangeRate({
    fromCurrency,
    toCurrency,
    rateDecimal: decimal,
    effectiveFrom: date,
    today: '2026-09-20',
    auditNote: 'Synthetic rate',
    acknowledgeHistoricalChange: true,
  })
}
function tx(
  id: string,
  amount: number,
  date = '2026-09-14',
  currency = 'USD',
  type = 'expense',
  description = id
) {
  state.db
    .prepare(
      `INSERT INTO transactions(id, account_id, type, amount, currency, description, date, category_id)
    VALUES (?, 'cash', ?, ?, ?, ?, ?, 'food')`
    )
    .run(id, type, amount, currency, description, date)
}
function subscription(id = 'bill', amount = 3000, currency = 'USD', cycle = 'monthly') {
  state.db
    .prepare(
      `INSERT INTO subscriptions(id, name, amount, currency, billing_cycle, next_billing_date)
    VALUES (?, ?, ?, ?, ?, '2026-09-28')`
    )
    .run(id, id, amount, currency, cycle)
}
function holding() {
  const key = 'v1|stock|manual|TEST|XNAS|USD'
  state.db
    .exec(`INSERT INTO instrument_prices(id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date)
    VALUES ('quote', '${key}', 'stock', 'manual', 'TEST', 'XNAS', 'USD', '0.0049', '2026-09-19');
    INSERT INTO investments(id, symbol, name, type, quantity_decimal, avg_cost_basis_decimal, cost_basis_known, currency, instrument_key)
    VALUES ('holding', 'TEST', 'Tiny holding', 'stock', '1', '0', 1, 'USD', '${key}')`)
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 20, 12))
  state.notes.clear()
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db
    .exec(`INSERT INTO accounts(id, name, type, balance, currency) VALUES ('cash', 'Cash', 'checking', 10000, 'USD');
    INSERT INTO categories(id, name, type) VALUES ('food', 'Food fixture', 'expense'), ('other', 'Other fixture', 'expense');
    INSERT INTO exchange_rates(id, from_currency, to_currency, rate, date) VALUES ('provider', 'USD', 'MXN', 999, '2026-09-01')`)
})
afterEach(() => {
  state.db.close()
  vi.useRealTimers()
})

describe('dated main-currency insight adapters', () => {
  it('keeps native fields without an implicit main or complete zero, including empty reports', async () => {
    tx('expense', 10000)
    subscription()
    const before = rows('app_data_state')
    expect(
      await run('get-spending-recap', { type: 'monthly', period: '2026-09-20' })
    ).toMatchObject({
      totalsByCurrency: [{ currency: 'USD', totalExpenses: 100 }],
      mainConversion: {
        complete: false,
        toCurrency: null,
        reason: 'main_currency_unconfigured',
        current: {
          expenseCentavos: null,
          knownExpenseCentavos: null,
          conversion: { nativeTotals: [{ currency: 'USD', amountCentavos: 10000 }] },
        },
      },
    })
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: { complete: false, toCurrency: null, score: null },
    })
    expect(await run('get-forecasted-cash-flow')).toMatchObject({
      forecast: { currentBalance: 100 },
      mainConversion: {
        complete: false,
        forecast: null,
        balances: { totalCentavos: null, knownTotalCentavos: null },
      },
    })
    expect(await run('get-spending-anomalies')).toMatchObject({
      mainConversion: { complete: false, anomalies: null },
    })
    expect(await listSubscriptionsSummary(true)).toMatchObject({
      summary: { monthlyTotal: 30 },
      mainConversion: { complete: false, monthlyTotal: null, knownMonthlyTotal: null },
    })
    expect(rows('app_data_state')).toEqual(before)
    state.db.exec('DELETE FROM transactions; DELETE FROM subscriptions; DELETE FROM accounts')
    expect(await run('get-forecasted-cash-flow')).toMatchObject({
      mainConversion: { complete: false, forecast: null },
    })
    expect(await getSubscriptionSpendingSummary()).toMatchObject({
      mainConversion: { complete: false, monthlyTotal: null },
    })
  })

  it('converts each midmonth parent and preserves native groups, provenance and read-only state', async () => {
    setMainCurrency('MXN')
    const first = rate('2026-09-14', '17')
    const second = rate('2026-09-15', '18')
    rate('2026-09-27', '25')
    tx('before', 10000)
    tx('after', 10000, '2026-09-15')
    tx('native', 100, '2026-09-16', 'MXN')
    const before = {
      revision: rows('app_data_state'),
      audit: rows('audit_log'),
      transactions: rows('transactions'),
    }
    const recap = await run('get-spending-recap', { type: 'monthly', period: '2026-09-20' })
    expect(recap).toMatchObject({
      totalsByCurrency: [
        { currency: 'MXN', totalExpenses: 1 },
        { currency: 'USD', totalExpenses: 200 },
      ],
      mainConversion: {
        complete: true,
        toCurrency: 'MXN',
        current: {
          expenseCentavos: 350100,
          conversion: {
            converted: expect.arrayContaining([
              expect.objectContaining({ id: 'before', rateId: first.id, amountCentavos: 170000 }),
              expect.objectContaining({ id: 'after', rateId: second.id, amountCentavos: 180000 }),
            ]),
          },
        },
      },
    })
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: {
        complete: true,
        current: { expenseCentavos: 350100 },
        score: { subscores: expect.any(Array) },
      },
    })
    expect({
      revision: rows('app_data_state'),
      audit: rows('audit_log'),
      transactions: rows('transactions'),
    }).toEqual(before)
  })

  it('keeps partial missing amounts null; neither provider, inverse nor future fills history', async () => {
    setMainCurrency('MXN')
    rate('2026-09-15', '18')
    rate('2026-09-01', '0.05', 'MXN', 'USD')
    tx('missing', 10000)
    tx('known', 10000, '2026-09-15')
    const recap = await run('get-spending-recap', { type: 'monthly', period: '2026-09-20' })
    expect(recap.mainConversion).toMatchObject({
      complete: false,
      reason: 'missing_direct_rate',
      expenseChange: null,
      current: {
        expenseCentavos: null,
        knownExpenseCentavos: 180000,
        conversion: {
          unresolvedIds: ['missing'],
          nativeTotals: [{ currency: 'USD', amountCentavos: 20000 }],
        },
      },
    })
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: { complete: false, score: null },
    })
    expect(await run('get-forecasted-cash-flow')).toMatchObject({
      mainConversion: { complete: false, forecast: null, balances: { totalCentavos: 180000 } },
    })
    expect(await run('get-spending-anomalies', { largeTransactionThreshold: 50 })).toMatchObject({
      mainConversion: {
        complete: false,
        anomalies: null,
        knownAnomalies: expect.arrayContaining([
          expect.objectContaining({ transactionId: 'known', amountCentavos: 180000 }),
        ]),
      },
    })
  })

  it('rounds individual parents once and apportions category splits by stable IDs', async () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '1.5')
    tx('cent-a', 1)
    tx('cent-b', 1)
    tx('split', 2)
    state.db.exec(
      `INSERT INTO transaction_splits(id, transaction_id, category_id, amount) VALUES ('z', 'split', 'other', 1), ('a', 'split', 'food', 1)`
    )
    const recap = await run('get-spending-recap', { type: 'monthly', period: '2026-09-20' })
    expect(recap.mainConversion.current).toMatchObject({
      expenseCentavos: 7,
      categories: expect.arrayContaining([
        expect.objectContaining({ categoryId: 'food', expenseCentavos: 6 }),
        expect.objectContaining({ categoryId: 'other', expenseCentavos: 1 }),
      ]),
      allocations: expect.arrayContaining([
        expect.objectContaining({ allocationId: 'a', amountCentavos: 2 }),
        expect.objectContaining({ allocationId: 'z', amountCentavos: 1 }),
      ]),
    })
    expect(await run('get-spending-anomalies')).toMatchObject({
      mainConversion: { current: { expenseCentavos: 7 } },
    })
  })

  it('uses dated realized inputs before averaging and today rates for future planning and each bill', async () => {
    setMainCurrency('MXN')
    rate('2026-09-14', '17')
    const today = rate('2026-09-15', '18')
    rate('2026-09-27', '25')
    tx('before', 10000)
    tx('after', 10000, '2026-09-15')
    subscription()
    const forecast = await run('get-forecasted-cash-flow', { days: 2 })
    expect(forecast.mainConversion).toMatchObject({
      complete: true,
      asOfDate: '2026-09-20',
      policy: 'planning_estimate_today_with_dated_realized_inputs',
      balances: { totalCentavos: 180000 },
      realized: { expenseCentavos: 350000 },
      subscriptions: {
        monthlyTotal: 540,
        dailyCostCentavos: 1800,
        converted: [expect.objectContaining({ rateId: today.id, asOfDate: '2026-09-20' })],
      },
      forecast: {
        currentBalance: 1800,
        dailyBurnRate: 38.89,
        points: [
          expect.objectContaining({ projected: 1800 }),
          expect.objectContaining({ projected: 1761.11 }),
          expect.objectContaining({ projected: 1722.22 }),
        ],
      },
    })
    expect(await listSubscriptionsSummary(true)).toMatchObject({
      summary: { monthlyTotal: 30 },
      mainConversion: { policy: 'planning_estimate_today', monthlyTotal: 540, yearlyTotal: 6480 },
    })
    expect(await getSubscriptionSpendingSummary()).toMatchObject({
      mainConversion: { monthlyTotal: 540 },
    })
  })

  it('normalizes subscription cycles after exact per-bill conversion and labels partial known estimates', async () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '1.5')
    subscription('tiny-a', 1)
    subscription('tiny-b', 1)
    subscription('quarter', 2, 'USD', 'quarterly')
    subscription('unknown', 100, 'EUR')
    expect(await getSubscriptionSpendingSummary()).toMatchObject({
      summary: {
        monthlyTotal: null,
        totalsByCurrency: expect.arrayContaining([
          expect.objectContaining({ currency: 'EUR' }),
          expect.objectContaining({ currency: 'USD' }),
        ]),
      },
      mainConversion: {
        complete: false,
        monthlyTotal: null,
        knownMonthlyTotal: 0.05,
        knownTotalCentavos: 7,
        unresolvedIds: ['unknown'],
        estimates: expect.arrayContaining([
          expect.objectContaining({ id: 'quarter', amountCentavos: 3, monthlyAmount: 0.01 }),
        ]),
      },
    })
  })

  it('compares mixed-denomination budgets natively, then provides current-plan vs dated-spending main comparison', async () => {
    setMainCurrency('MXN')
    rate('2026-09-14', '17')
    rate('2026-09-15', '18')
    tx('before', 10000)
    tx('after', 10000, '2026-09-15')
    state.db.exec(`INSERT INTO budgets(id, name, category_id, amount, currency, period) VALUES
      ('usd', 'USD plan', 'food', 15000, 'USD', 'monthly'), ('mxn', 'MXN plan', 'food', 360000, 'MXN', 'monthly')`)
    const comparisons = expect.arrayContaining([
      expect.objectContaining({
        id: 'usd',
        currency: 'USD',
        isOverBudget: true,
        spending: expect.objectContaining({ total: 20000 }),
        mainComparison: expect.objectContaining({
          remainingCentavos: -80000,
          plan: expect.objectContaining({ totalCentavos: 270000 }),
        }),
      }),
      expect.objectContaining({
        id: 'mxn',
        currency: 'MXN',
        isOverBudget: false,
        spending: expect.objectContaining({ total: 350000 }),
        mainComparison: expect.objectContaining({ remainingCentavos: 10000 }),
      }),
    ])
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: {
        complete: true,
        budgetComparisons: comparisons,
        score: {
          subscores: expect.arrayContaining([
            expect.objectContaining({ name: 'Budget Adherence', score: 50 }),
          ]),
        },
      },
    })
    const recap = await run('get-spending-recap', { type: 'monthly', period: '2026-09-20' })
    expect(recap.budgetComparisons).toEqual(comparisons)
    expect(recap.recap.summary).toContain('Over budget on: USD plan.')
    setMainCurrency('EUR')
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: { complete: false, score: null },
    })
    expect(rows('budgets')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'usd', amount: 15000, currency: 'USD' }),
        expect.objectContaining({ id: 'mxn', amount: 360000, currency: 'MXN' }),
      ])
    )
  })

  it('does not substitute zero when spending cannot be converted into a durable budget currency', async () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '18')
    tx('native', 10000, '2026-09-14', 'MXN')
    state.db.exec(
      `INSERT INTO budgets(id, name, amount, currency, period) VALUES ('usd', 'USD plan', 15000, 'USD', 'monthly')`
    )
    expect(await run('get-financial-health-score')).toMatchObject({
      mainConversion: {
        complete: false,
        score: null,
        budgetComparisons: [
          expect.objectContaining({
            isOverBudget: null,
            spending: expect.objectContaining({
              success: false,
              reason: 'budget_currency_conversion_required',
            }),
          }),
        ],
      },
    })
  })

  it('preserves net-consumption classification, refund references/date/sign and independent coverage', async () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '1.5')
    rate('2026-09-15', '2')
    tx('purchase', 2)
    tx('refund', 1, '2026-09-15', 'USD', 'income')
    state.db
      .exec(`INSERT INTO transaction_splits(id, transaction_id, category_id, amount) VALUES ('z', 'purchase', 'other', 1), ('a', 'purchase', 'food', 1);
      INSERT INTO transaction_consumption_classifications(id, transaction_id, split_id, role, referenced_purchase_id) VALUES
      ('p1', 'purchase', 'a', 'purchase', NULL), ('p2', 'purchase', 'z', 'purchase', NULL), ('r', 'refund', NULL, 'refund', 'p1')`)
    const input = { type: 'monthly', period: '2026-09-20', basis: 'net_consumption' }
    expect(await run('get-spending-recap', input)).toMatchObject({
      mainConversion: {
        complete: false,
        consumptionCentavos: null,
        knownConsumptionCentavos: 1,
        coverageComplete: false,
        allocations: expect.arrayContaining([
          expect.objectContaining({
            classificationId: 'r',
            referencedPurchaseId: 'p1',
            categoryId: 'food',
            date: '2026-09-15',
            consumptionCentavos: -2,
          }),
        ]),
      },
    })
    state.db.exec(
      `INSERT INTO source_coverage(id, account_id, source_namespace, period_start, period_end, status) VALUES ('coverage', 'cash', 'test', '2026-09-01', '2026-09-30', 'verified')`
    )
    expect(await run('get-spending-recap', input)).toMatchObject({
      mainConversion: { complete: true, consumptionCentavos: 1 },
    })
  })

  it('keeps saved recap identity/content and native snapshots unchanged after a main switch or rate correction', async () => {
    setMainCurrency('MXN')
    const original = rate('2026-09-14', '17')
    tx('past', 10000)
    state.db.exec(
      `INSERT INTO net_worth_snapshots(id, date, currency, net_worth) VALUES ('original', '2026-09-20', 'USD', 10000)`
    )
    const input = { type: 'monthly', period: '2026-09-20' }
    const saved = await run('save-spending-recap', input)
    const recaps = rows('recaps')
    const snapshots = rows('net_worth_snapshots')
    setExchangeRate({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '17.5',
      effectiveFrom: '2026-09-14',
      replacesRateId: original.id,
      today: '2026-09-20',
      acknowledgeHistoricalChange: true,
      auditNote: 'Synthetic correction',
    })
    expect(await run('get-spending-recap', input)).toMatchObject({
      mainConversion: { current: { expenseCentavos: 175000 } },
    })
    expect(rows('recaps')).toEqual(recaps)
    setMainCurrency('EUR')
    const beforeAudit = rows('audit_log')
    const resaved = await run('save-spending-recap', input)
    expect(resaved.recap.id).toBe(saved.recap.id)
    expect(rows('recaps')).toEqual(recaps)
    expect(rows('audit_log')).toEqual(beforeAudit)
    expect(rows('net_worth_snapshots')).toEqual(snapshots)
  })

  it('derives main category spikes and merchant statistics from dated inputs while preserving native thresholds', async () => {
    setMainCurrency('MXN')
    rate('2026-06-01', '1')
    rate('2026-09-15', '18')
    tx('old-a', 10000, '2026-07-01', 'USD', 'expense', 'Merchant')
    tx('old-b', 11000, '2026-07-10', 'USD', 'expense', 'Merchant')
    tx('old-c', 12000, '2026-07-20', 'USD', 'expense', 'Merchant')
    tx('recent', 10000, '2026-09-15', 'USD', 'expense', 'Merchant')
    const result = await run('get-spending-anomalies', { largeTransactionThreshold: 500 })
    expect(result.anomalies.some((row: { type: string }) => row.type === 'large_transaction')).toBe(
      false
    )
    expect(result.mainConversion).toMatchObject({
      complete: true,
      largeTransactionThresholdCurrencyMode: 'per_transaction_currency',
      anomalies: expect.arrayContaining([
        expect.objectContaining({
          type: 'unusual_amount',
          transactionId: 'recent',
          amountCentavos: 180000,
        }),
        expect.objectContaining({
          type: 'spending_spike',
          categoryId: 'food',
          amountCentavos: 180000,
        }),
      ]),
    })
    expect(
      result.mainConversion.anomalies.some(
        (row: { type: string }) => row.type === 'large_transaction'
      )
    ).toBe(false)
  })

  it('values generated portfolio reviews exactly at today rates without relabeling an existing note', async () => {
    holding()
    const unconfigured = await generatePortfolioReview(true)
    expect(unconfigured).toMatchObject({
      mainConversion: {
        complete: false,
        toCurrency: null,
        portfolioValueCentavos: null,
        knownValueCentavos: null,
      },
    })
    setMainCurrency('MXN')
    const current = rate('2026-09-15', '18')
    rate('2026-09-27', '25')
    const review = await generatePortfolioReview(true)
    expect(review).toMatchObject({
      mainConversion: {
        complete: true,
        portfolioValueCentavos: 9,
        policy: 'current_holdings_today',
        asOfDate: '2026-09-20',
        provenance: [expect.objectContaining({ id: current.id, rateDecimal: '18' })],
      },
    })
    const saved = [...state.notes.entries()]
    setMainCurrency('EUR')
    expect(await generatePortfolioReview(false)).toMatchObject({ success: true, skipped: true })
    expect([...state.notes.entries()]).toEqual(saved)
    expect(await generatePortfolioReview(true)).toMatchObject({
      mainConversion: { complete: false, portfolioValueCentavos: null, knownValueCentavos: 0 },
    })
  })

  it('keeps known portfolio values separate when another holding lacks verified price identity', async () => {
    holding()
    setMainCurrency('MXN')
    rate('2026-09-01', '18')
    state.db
      .exec(`INSERT INTO investments(id, symbol, name, type, quantity_decimal, cost_basis_known, currency)
      VALUES ('unverified', 'OTHER', 'Unverified', 'stock', '1', 0, 'USD')`)
    expect(await generatePortfolioReview(true)).toMatchObject({
      mainConversion: {
        complete: false,
        portfolioValueCentavos: null,
        knownValueCentavos: 9,
        costBasisCentavos: null,
        incompleteHoldingIds: ['unverified'],
      },
    })
  })

  it('does not turn FX movement into a subscription price change; native detections retain dated evidence', async () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '17')
    rate('2026-09-15', '18')
    tx('same-before', 1000, '2026-09-14', 'USD', 'expense', 'Stable bill')
    tx('same-after', 1000, '2026-09-15', 'USD', 'expense', 'Stable bill')
    tx('raised-before', 1000, '2026-09-14', 'USD', 'expense', 'Raised bill')
    tx('raised-after', 1200, '2026-09-15', 'USD', 'expense', 'Raised bill')
    state.db.exec('UPDATE transactions SET is_recurring = 1')
    const result = await run('get-spending-anomalies')
    const nativeChanges = result.anomalies.filter(
      (row: { type: string }) => row.type === 'subscription_price_change'
    )
    expect(nativeChanges).toHaveLength(1)
    expect(nativeChanges[0]).toMatchObject({ transactionId: 'raised-after', amount: 12 })
    const mainChanges = result.mainConversion.anomalies.filter(
      (row: { type: string }) => row.type === 'subscription_price_change'
    )
    expect(mainChanges).toEqual([
      expect.objectContaining({ transactionId: 'raised-after', amountCentavos: 21600 }),
    ])
    expect(result.mainConversion.nativeDetections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          transactionId: 'raised-after',
          conversion: expect.objectContaining({ asOfDate: '2026-09-15', rateDecimal: '18' }),
        }),
      ])
    )
  })
})
