// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db.transaction(fn).immediate(),
}))
import { readConvertedCashFlow, readBudgetSpending } from './reporting-read.js'
import { readNetConsumption } from './consumption-read.js'
import { readMainOwnershipValuation, readValuationRates } from './valuation-read.js'
import { setMainCurrency, setExchangeRate } from './fx-service.js'
import { analyticsTools } from './tools/analytics.js'
import { budgetsandnetworthTools } from './tools/budgets-and-net-worth.js'
import { transactionsTools } from './tools/transactions.js'
import { goalsTools } from './tools/goals.js'

const tools = [...analyticsTools, ...budgetsandnetworthTools, ...goalsTools, ...transactionsTools]
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
    auditNote: 'Synthetic history',
    acknowledgeHistoricalChange: true,
  })
}
function tx(id: string, amount: number, date = '2026-09-14', currency = 'USD', type = 'expense') {
  state.db
    .prepare(
      `INSERT INTO transactions (id, account_id, type, amount, currency, description, date, category_id)
    VALUES (?, 'cash', ?, ?, ?, ?, ?, 'food')`
    )
    .run(id, type, amount, currency, id, date)
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 20, 12))
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db
    .exec(`INSERT INTO accounts (id, name, type, balance, currency) VALUES ('cash', 'Cash', 'checking', 10000, 'USD');
    INSERT INTO categories (id, name, type) VALUES ('food', 'Food fixture', 'expense'), ('other', 'Other fixture', 'expense');
    INSERT INTO exchange_rates (id, from_currency, to_currency, rate, date) VALUES ('provider', 'USD', 'MXN', 999, '2026-09-01');`)
})
afterEach(() => {
  state.db.close()
  vi.useRealTimers()
})

describe('dated CLI readers on schema 22 SQLite', () => {
  it('uses the captured MXN budget currency without requiring a USD conversion', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency = 'MXN' WHERE id = 'cash'")
    tx('mxn-food', 25000, '2026-09-14', 'MXN')
    const created = await run('create-budget', {
      categoryId: 'food',
      name: 'MXN Food',
      amount: 1000,
    })
    expect(created).toMatchObject({ success: true, budget: { currency: 'MXN', amount: 1000 } })
    const transactions = rows('transactions')
    expect(rows('manual_exchange_rates')).toHaveLength(0)
    expect(await run('get-budget-status')).toMatchObject({
      success: true,
      budgets: [
        { currency: 'MXN', budgetAmount: 1000, spentAmount: 250, remaining: 750, complete: true },
      ],
    })
    expect(rows('transactions')).toEqual(transactions)
  })

  it('retains native evidence without asserting a main currency, including ownership', async () => {
    tx('a', 10000)
    const before = rows('app_data_state')
    expect(readConvertedCashFlow('2026-09-01', '2026-09-30')).toMatchObject({
      complete: false,
      toCurrency: null,
      incomeCentavos: null,
      expenseCentavos: null,
      conversion: { nativeTotals: [{ currency: 'USD', amountCentavos: 10000 }] },
    })
    expect(await run('get-net-worth')).toMatchObject({
      complete: false,
      currency: null,
      netWorth: null,
      reason: 'main_currency_unconfigured',
      nativeTotals: [{ currency: 'USD', netWorth: 100 }],
    })
    expect(rows('app_data_state')).toEqual(before)
  })

  it('selects direct historical rates per parent, ignores provider/future, preserves native public fields', async () => {
    setMainCurrency('MXN')
    const first = rate('2026-09-14', '17')
    const second = rate('2026-09-15', '18')
    rate('2026-09-27', '25')
    tx('before', 10000)
    tx('after', 10000, '2026-09-15')
    const report = readConvertedCashFlow('2026-09-01', '2026-09-30')
    expect(report).toMatchObject({
      complete: true,
      expenseCentavos: 350000,
      conversion: {
        converted: [
          { id: 'before', rateId: first.id },
          { id: 'after', rateId: second.id },
        ],
      },
    })
    expect(readMainOwnershipValuation()).toMatchObject({
      complete: true,
      targetCurrency: 'MXN',
      netWorthCentavos: 180000,
      asOfDate: '2026-09-20',
      provenance: [{ id: second.id, rateDecimal: '18' }],
    })
    const overview = await run('get-balance-overview')
    expect(overview).toMatchObject({
      totalBalance: 100,
      totalsByCurrency: [{ currency: 'USD', totalBalance: 100 }],
      monthlyChange: { current: -200 },
      mainConversion: {
        currentMonth: { netCentavos: -350000 },
        balances: { totalCentavos: 180000 },
      },
    })
    expect(rows('transactions')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'before', amount: 10000, currency: 'USD' }),
      ])
    )
  })

  it('retains verified quote identity and ownership coverage, with one exact holding conversion today', () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '20')
    rate('2026-09-27', '999')
    const key = 'v1|stock|manual|TEST|XNAS|USD'
    state.db.exec(`UPDATE accounts SET balance = 0 WHERE id = 'cash';
      INSERT INTO accounts(id, name, type, balance, currency, account_mode, valuation_mode)
      VALUES ('snapshot', 'Snapshot', 'investment', 500, 'USD', 'snapshot_only', 'portfolio_snapshot');
      INSERT INTO instrument_prices (id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date)
      VALUES ('quote', '${key}', 'stock', 'manual', 'TEST', 'XNAS', 'USD', '0.0049', '2026-09-19');
      INSERT INTO investments (id, account_id, symbol, name, type, quantity_decimal, avg_cost_basis_decimal, cost_basis_known, currency, instrument_key)
      VALUES ('included', NULL, 'TEST', 'Included', 'stock', '1', '0', 1, 'USD', '${key}'),
             ('comparison', 'snapshot', 'TEST', 'Comparison', 'stock', '1', '0', 1, 'USD', '${key}')`)
    expect(readMainOwnershipValuation()).toMatchObject({
      complete: true,
      netWorthCentavos: 10010,
      holdings: expect.arrayContaining([
        expect.objectContaining({
          id: 'included',
          included: true,
          valueCentavos: 0,
          convertedValueCentavos: 10,
        }),
        expect.objectContaining({ id: 'comparison', included: false, comparisonOnly: true }),
      ]),
    })
    state.db.exec("UPDATE accounts SET valuation_mode = 'unresolved' WHERE id = 'snapshot'")
    expect(readMainOwnershipValuation()).toMatchObject({
      complete: false,
      netWorthCentavos: null,
      unresolvedAccountIds: ['snapshot'],
    })
    state.db.exec("UPDATE investments SET instrument_key = 'wrong-identity' WHERE id = 'included'")
    expect(readMainOwnershipValuation()).toMatchObject({
      complete: false,
      incompleteHoldingIds: ['included'],
    })
  })

  it('rounds two tiny parents independently and apportions one split parent by stable IDs exactly once', () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '1.5')
    tx('tiny-a', 1)
    tx('tiny-b', 1)
    expect(readConvertedCashFlow('2026-09-01', '2026-09-30')).toMatchObject({ expenseCentavos: 4 })
    tx('split', 2)
    state.db.exec(
      `INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES ('z', 'split', 'other', 1), ('a', 'split', 'food', 1)`
    )
    const report = readConvertedCashFlow('2026-09-01', '2026-09-30')
    expect(report).toMatchObject({
      expenseCentavos: 7,
      allocations: expect.arrayContaining([
        expect.objectContaining({ allocationId: 'a', amountCentavos: 2 }),
        expect.objectContaining({ allocationId: 'z', amountCentavos: 1 }),
      ]),
    })
    expect(readBudgetSpending('other', '2026-09-01', '2026-09-30', 'MXN')).toMatchObject({
      success: true,
      total: 1,
    })
  })

  it('never uses inverse, future or provider authority for missing history and labels known subtotals', () => {
    setMainCurrency('MXN')
    rate('2026-09-15', '18')
    rate('2026-09-01', '0.05', 'MXN', 'USD')
    tx('missing', 10000)
    tx('known', 10000, '2026-09-15')
    expect(readConvertedCashFlow('2026-09-01', '2026-09-30')).toMatchObject({
      complete: false,
      expenseCentavos: null,
      knownExpenseCentavos: 180000,
      conversion: {
        unresolvedIds: ['missing'],
        nativeTotals: [{ currency: 'USD', amountCentavos: 20000 }],
      },
    })
    setMainCurrency('EUR')
    expect(readValuationRates('EUR')).toEqual([])
    expect(readMainOwnershipValuation()).toMatchObject({
      complete: false,
      netWorthCentavos: null,
      targetCurrency: 'EUR',
    })
  })

  it('corrections recalculate reporting but never ledger or native snapshots', () => {
    setMainCurrency('MXN')
    const first = rate('2026-09-14', '17')
    tx('past', 10000)
    state.db.exec(
      "INSERT INTO net_worth_snapshots (id, date, currency, net_worth) VALUES ('original', '2026-09-20', 'USD', 10000)"
    )
    const before = {
      accounts: rows('accounts'),
      transactions: rows('transactions'),
      snapshots: rows('net_worth_snapshots'),
    }
    setExchangeRate({
      fromCurrency: 'USD',
      toCurrency: 'MXN',
      rateDecimal: '17.5',
      effectiveFrom: '2026-09-14',
      replacesRateId: first.id,
      today: '2026-09-20',
      acknowledgeHistoricalChange: true,
      auditNote: 'Fix test transcription',
    })
    expect(readConvertedCashFlow('2026-09-14', '2026-09-14')).toMatchObject({
      expenseCentavos: 175000,
    })
    expect({
      accounts: rows('accounts'),
      transactions: rows('transactions'),
      snapshots: rows('net_worth_snapshots'),
    }).toEqual(before)
  })

  it('preserves consumption recognition dates, refund category/signs, source coverage and split rounding', () => {
    setMainCurrency('MXN')
    rate('2026-09-01', '1.5')
    rate('2026-09-15', '2')
    tx('purchase', 2)
    tx('refund', 1, '2026-09-15', 'USD', 'income')
    state.db
      .exec(`INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES ('z', 'purchase', 'other', 1), ('a', 'purchase', 'food', 1);
      INSERT INTO transaction_consumption_classifications (id, transaction_id, split_id, role, referenced_purchase_id) VALUES
      ('p1', 'purchase', 'a', 'purchase', NULL), ('p2', 'purchase', 'z', 'purchase', NULL), ('r', 'refund', NULL, 'refund', 'p1')`)
    const report = readNetConsumption('2026-09-01', '2026-09-30')
    expect(report).toMatchObject({
      complete: false,
      classificationComplete: true,
      coverageComplete: false,
      totalsByCurrency: [{ currency: 'USD', consumptionCentavos: 1, earnedIncomeCentavos: 0 }],
      mainConversion: {
        complete: false,
        consumptionCentavos: null,
        knownConsumptionCentavos: 1,
        allocations: expect.arrayContaining([
          expect.objectContaining({
            classificationId: 'r',
            date: '2026-09-15',
            categoryId: 'food',
            consumptionCentavos: -2,
          }),
          expect.objectContaining({ classificationId: 'p1', consumptionCentavos: 2 }),
          expect.objectContaining({ classificationId: 'p2', consumptionCentavos: 1 }),
        ]),
      },
    })
    state.db
      .exec(`INSERT INTO source_coverage (id, account_id, source_namespace, period_start, period_end, status)
      VALUES ('coverage', 'cash', 'test', '2026-09-01', '2026-09-30', 'verified')`)
    expect(readNetConsumption('2026-09-01', '2026-09-30')).toMatchObject({
      complete: true,
      mainConversion: { complete: true, consumptionCentavos: 1 },
    })
  })

  it('requires setup for creation, atomically persists new denomination, retains it on budget/goal edits', async () => {
    expect(await run('create-budget', { amount: 10 })).toMatchObject({
      success: false,
      reason: 'main_currency_unconfigured',
    })
    expect(await run('create-goal', { name: 'Trip', targetAmount: 10 })).toMatchObject({
      success: false,
      reason: 'main_currency_unconfigured',
    })
    setMainCurrency('MXN')
    const before = rows('budgets')
    expect(await run('create-budget', { amount: 10, dryRun: true })).toMatchObject({
      wouldCreate: { currency: 'MXN' },
    })
    expect(rows('budgets')).toEqual(before)
    const budget = await run('create-budget', { amount: 10 })
    const goal = await run('create-goal', { name: 'Trip', targetAmount: 20, accountId: 'cash' })
    expect(budget.budget.currency).toBe('MXN')
    expect(goal.goal.currency).toBe('MXN')
    setMainCurrency('EUR')
    expect(await run('upsert-budget', { budgetId: budget.budget.id, amount: 12 })).toMatchObject({
      budget: { amount: 12, currency: 'MXN' },
    })
    expect(await run('update-goal', { goalId: goal.goal.id, addAmount: 3 })).toMatchObject({
      goal: { currency: 'MXN', currentAmount: 3 },
    })
    expect(rows('accounts')[0]).toMatchObject({ balance: 10000, currency: 'USD' })
    expect(rows('budgets')[0]).toMatchObject({ currency: 'MXN', amount: 1200 })
    expect(rows('goals')[0]).toMatchObject({ currency: 'MXN', current_amount: 300 })
  })

  it('keeps mixed-denomination plan summaries native, compares dated spending to original currency and current main plan separately', async () => {
    setMainCurrency('MXN')
    rate('2026-09-14', '17')
    rate('2026-09-15', '18')
    state.db
      .exec(`INSERT INTO budgets (id, name, amount, period) VALUES ('legacy', 'Legacy', 10000, 'monthly');
      INSERT INTO goals (id, name, target_amount) VALUES ('legacy', 'Legacy', 10000)`)
    await run('create-budget', { amount: 20, name: 'New' })
    await run('create-goal', { name: 'New', targetAmount: 20 })
    tx('expense', 10000)
    const budgets = await run('get-budget-status')
    expect(budgets).toMatchObject({
      currency: null,
      summary: { totalBudget: null, totalSpent: null },
      budgets: expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy',
          currency: 'USD',
          budgetAmount: 100,
          spentAmount: 100,
          mainComparison: {
            complete: true,
            policy: 'current_plan_today_vs_transaction_date_spending',
            toCurrency: 'MXN',
            plan: expect.objectContaining({ totalCentavos: 180000 }),
            spending: expect.objectContaining({ expenseCentavos: 170000 }),
            remainingCentavos: 10000,
          },
        }),
      ]),
    })
    expect(await run('get-goal-status')).toMatchObject({
      currency: null,
      summary: { totalTarget: null },
      totalsByCurrency: [
        { currency: 'MXN', totalTarget: 20 },
        { currency: 'USD', totalTarget: 100 },
      ],
    })
    tx('foreign', 1, '2026-09-14', 'EUR')
    expect(await run('get-budget-status')).toMatchObject({
      complete: false,
      budgets: expect.arrayContaining([
        expect.objectContaining({
          id: 'legacy',
          currency: 'USD',
          budgetAmount: 100,
          spentAmount: null,
          remaining: null,
        }),
      ]),
    })
  })

  it('rolls back denomination, audit and revision together on budget audit failure', async () => {
    setMainCurrency('MXN')
    const before = {
      budgets: rows('budgets'),
      audit: rows('audit_log'),
      revision: rows('app_data_state'),
    }
    state.db
      .exec(`CREATE TRIGGER reject_budget_audit BEFORE INSERT ON audit_log WHEN NEW.entity = 'budget'
      BEGIN SELECT RAISE(ABORT, 'audit failure'); END`)
    await expect(run('create-budget', { amount: 10 })).rejects.toThrow('audit failure')
    await expect(run('upsert-budget', { name: 'New', amount: 10 })).rejects.toThrow('audit failure')
    expect({
      budgets: rows('budgets'),
      audit: rows('audit_log'),
      revision: rows('app_data_state'),
    }).toEqual(before)
  })
})

describe('scoped budget adapter on disposable SQLite', () => {
  it('replays an explicit native budget ID without writes and retains dangling category scope', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency='MXN' WHERE id='cash'")
    tx('food-expense', 25000, '2026-09-14', 'MXN')
    const input = {
      budgetId: 'stable-food',
      name: 'Food',
      categoryId: 'food',
      amount: 1000,
      currency: 'MXN',
      scope: { categoryIds: ['food'], accountIds: ['cash'] },
      basis: 'gross_cashflow',
    }
    const first = await run('create-budget', input)
    expect(first).toMatchObject({
      success: true,
      budget: { id: 'stable-food', currency: 'MXN', scope: { accountIds: ['cash'] } },
    })
    expect(
      await run('get-budget-status', { budgetId: 'stable-food', asOf: '2026-09-20' })
    ).toMatchObject({
      budgets: [{ spentAmount: 250, remaining: 750, complete: true, contributorCount: 1 }],
    })
    const before = rows('audit_log')
    expect(await run('create-budget', input)).toMatchObject({
      success: true,
      action: 'noop',
      changed: false,
    })
    expect(rows('audit_log')).toEqual(before)
    expect(await run('upsert-budget', { budgetId: 'stable-food', currency: 'USD' })).toMatchObject({
      success: false,
      reason: 'amount_required_for_currency_change',
    })
    state.db.exec("DELETE FROM categories WHERE id='food'")
    expect(await run('get-budget-status', { budgetId: 'stable-food' })).toMatchObject({
      budgets: [{ complete: false, spentAmount: null, scope: { categoryIds: ['food'] } }],
    })
  })

  it('does not add overlapping budget totals or include future rows by default', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency='MXN' WHERE id='cash'")
    tx('now', 5000, '2026-09-14', 'MXN')
    tx('future', 2000, '2026-09-27', 'MXN')
    await run('create-budget', { budgetId: 'a', amount: 100, scope: { categoryIds: ['food'] } })
    expect(await run('get-budget-status', { budgetId: 'a', asOf: '2026-09-20' })).toMatchObject({
      budgets: [{ spentAmount: 50 }],
    })
    expect(
      await run('get-budget-status', { budgetId: 'a', asOf: '2026-09-20', through: 'period_end' })
    ).toMatchObject({ budgets: [{ spentAmount: 70 }] })
    await run('create-budget', { budgetId: 'b', amount: 100, scope: { categoryIds: ['food'] } })
    expect(await run('get-budget-status', { asOf: '2026-09-20' })).toMatchObject({
      summary: { totalSpent: null, reason: 'independent_budgets_nonadditive' },
    })
  })
})

describe('scoped report and contributor traversal', () => {
  it('selects source-account/category allocations, paginates parents, rejects stale or altered cursors', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency='MXN' WHERE id='cash'")
    tx('one', 1000, '2026-09-14', 'MXN')
    tx('two', 2000, '2026-09-15', 'MXN')
    const scope = { categoryIds: ['food'], accountIds: ['cash'] }
    const summary = await run('get-spending-summary', {
      currency: 'MXN',
      scope,
      asOf: '2026-09-20',
    })
    expect(summary).toMatchObject({
      complete: true,
      totalExpenses: 30,
      contributorCount: 2,
      contributorQuery: { scope: { categoryIds: ['food'], accountIds: ['cash'] } },
    })
    const params = { ...summary.contributorQuery, limit: 1 }
    const first = await run('query-transactions', params)
    expect(first).toMatchObject({
      success: true,
      totalMatched: 2,
      hasMore: true,
      transactions: [{ id: 'two' }],
    })
    const second = await run('query-transactions', { ...params, cursor: first.nextCursor })
    expect(second).toMatchObject({ success: true, hasMore: false, transactions: [{ id: 'one' }] })
    expect(
      await run('query-transactions', {
        ...params,
        scope: { categoryIds: ['other'] },
        cursor: first.nextCursor,
      })
    ).toMatchObject({ success: false, reason: 'cursor_filter_mismatch' })
    expect(
      await run('query-transactions', { ...params, cursor: first.nextCursor + 'x' })
    ).toMatchObject({ success: false, reason: 'invalid_cursor' })
    state.db.exec("UPDATE transactions SET amount=3000 WHERE id='one'")
    expect(await run('query-transactions', { ...params, cursor: first.nextCursor })).toMatchObject({
      success: false,
      reason: 'cursor_stale',
    })
  })
})

describe('net evidence and planning sources on SQLite', () => {
  it('keeps referenced purchases outside the window, recognizes refunds by refund tags and category', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency='MXN' WHERE id='cash'")
    tx('purchase', 10000, '2026-08-14', 'MXN')
    tx('refund', 2500, '2026-09-14', 'MXN', 'income')
    state.db
      .exec(`UPDATE transactions SET category_id='other', tags='["business"]' WHERE id='refund';
      INSERT INTO transaction_consumption_classifications (id,transaction_id,role) VALUES ('cp','purchase','purchase');
      INSERT INTO transaction_consumption_classifications (id,transaction_id,role,referenced_purchase_id) VALUES ('cr','refund','refund','cp');
      INSERT INTO source_coverage (id,account_id,source_namespace,period_start,period_end,status)
        VALUES ('coverage','cash','statement','2026-09-01','2026-09-30','verified');`)
    const options = {
      basis: 'net_consumption',
      currency: 'MXN',
      scope: { categoryIds: ['food'], tags: ['business'] },
      asOf: '2026-09-20',
    }
    const before = rows('transactions')
    const report = await run('get-spending-summary', options)
    expect(report).toMatchObject({
      complete: true,
      totals: { consumptionCentavos: -2500, earnedIncomeCentavos: 0 },
      allocations: [{ transactionId: 'refund', categoryId: 'food', referencedPurchaseId: 'cp' }],
    })
    expect(rows('transactions')).toEqual(before)
    state.db.exec('DELETE FROM source_coverage')
    expect(await run('get-spending-summary', options)).toMatchObject({
      complete: false,
      totals: { consumptionCentavos: null },
      known: { consumptionCentavos: -2500 },
    })
  })

  it('keeps recurring rules and subscriptions separate, never materializes transactions', async () => {
    setMainCurrency('MXN')
    state.db.exec("UPDATE accounts SET currency='MXN' WHERE id='cash'")
    state.db
      .prepare(
        `INSERT INTO subscriptions (id,name,amount,currency,billing_cycle,next_billing_date,account_id,category_id)
      VALUES ('sub','Plan',12000,'MXN','monthly','2026-09-22','cash','food')`
      )
      .run()
    const before = rows('transactions')
    const estimate = await run('get-spending-summary', {
      basis: 'recurring_estimate',
      currency: 'MXN',
      asOf: '2026-09-20',
    })
    expect(estimate).toMatchObject({
      subscriptions: { monthlyCentavos: 12000 },
      combinedMonthlyCentavos: null,
      totalExpenses: null,
    })
    const tagged = await run('get-spending-summary', {
      basis: 'recurring_estimate',
      currency: 'MXN',
      scope: { tags: ['business'] },
      asOf: '2026-09-20',
    })
    expect(tagged).toMatchObject({ subscriptions: { complete: false, monthlyCentavos: null } })
    expect(rows('transactions')).toEqual(before)
  })
})

describe('budget mutation preservation', () => {
  it('preserves omitted fields, explicitly clears scope, and inspects inactive plans by ID', async () => {
    setMainCurrency('MXN')
    const created = await run('upsert-budget', {
      budgetId: 'future',
      amount: 100,
      currency: 'MXN',
      scope: { tags: ['business'], categoryIds: ['food'] },
      active: false,
    })
    expect(created).toMatchObject({ success: true, budget: { id: 'future', isActive: false } })
    expect(await run('get-budget-status')).toMatchObject({ budgets: [] })
    expect(await run('get-budget-status', { budgetId: 'future' })).toMatchObject({
      budgets: [{ id: 'future', isActive: false }],
    })
    const before = {
      budget: rows('budgets'),
      audit: rows('audit_log'),
      revision: rows('app_data_state'),
    }
    expect(
      await run('upsert-budget', { budgetId: 'future', dryRun: true, scope: {} })
    ).toMatchObject({ success: true, dryRun: true, changed: true })
    expect({
      budget: rows('budgets'),
      audit: rows('audit_log'),
      revision: rows('app_data_state'),
    }).toEqual(before)
    expect(await run('upsert-budget', { budgetId: 'future', amount: 100 })).toMatchObject({
      success: true,
      changed: false,
      budget: { currency: 'MXN', scope: { tags: ['business'], categoryIds: ['food'] } },
    })
    expect(rows('app_data_state')).toEqual(before.revision)
    await run('upsert-budget', { budgetId: 'future', scope: {} })
    expect(rows('budgets')[0]).toMatchObject({ category_id: null, currency: 'MXN', amount: 10000 })
  })
})
