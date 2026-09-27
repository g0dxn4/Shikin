// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'
const state = vi.hoisted(() => ({ db: null as Database.Database | null, snapshots: 0, writes: 0 }))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => {
    state.writes++
    return { rowsAffected: state.db!.prepare(sql).run(...params).changes }
  }
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.snapshots++
      state.db!.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        state.db!.exec('COMMIT')
        return result
      } catch (error) {
        state.db!.exec('ROLLBACK')
        throw error
      }
    },
  }
})
import { readScopedReport, readScopedSnapshot, projectBudget } from '../scoped-report-read'
import { useBudgetStore } from '@/stores/budget-store'
const window = { asOf: '2026-01-20', timeZone: 'UTC' }
const report = (input: Partial<Parameters<typeof readScopedReport>[0]> = {}) =>
  readScopedReport({ basis: 'gross_cashflow', window, ...input })
const row = () =>
  state.db!.prepare("SELECT * FROM budgets WHERE id='plan'").get() as Record<string, unknown>
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db
    .exec(`INSERT INTO accounts (id,name,type,currency) VALUES ('bank','Bank','checking','MXN');
    INSERT INTO categories (id,name,type) VALUES ('food','Food','expense'),('other','Other','expense');
    INSERT OR REPLACE INTO settings (key,value) VALUES ('main_currency','MXN');
    INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description,tags) VALUES ('expense','bank','food','expense',25000,'MXN','2026-01-10','Food','["business",{"label":" Business "}]');
    INSERT INTO budgets (id,name,category_id,amount,currency,period) VALUES ('plan','Food plan','food',100000,'MXN','monthly');`)
  state.snapshots = 0
  state.writes = 0
  useBudgetStore.setState({ budgets: [], options: window })
})
afterEach(() => state.db?.close())
describe('scoped frontend adapter on disposable SQLite', () => {
  it('reads coherent MXN 250/750 with no FX or writes and legacy category scope', async () => {
    const snapshot = await readScopedSnapshot()
    expect(state.snapshots).toBe(1)
    const budget = projectBudget(snapshot, snapshot.budgets[0], window)
    expect(budget).toMatchObject({
      currency: 'MXN',
      spent: 25000,
      remaining: 75000,
      percentUsed: 25,
    })
    expect(budget.result.scope?.categoryIds).toEqual(['food'])
    expect(state.writes).toBe(0)
  })
  it('retains a once-resolved period window and original requested null boundaries', async () => {
    const read = await report()
    expect(read.window).toMatchObject({
      period: 'month',
      start: '2026-01-01',
      end: '2026-01-20',
      periodEnd: '2026-01-31',
      requested: { start: null, end: null },
    })
    if (read.result.basis !== 'recurring_estimate') expect(read.result.window).toEqual(read.window)
    const snapshot = await readScopedSnapshot()
    expect(projectBudget(snapshot, snapshot.budgets[0], window).result.window).toEqual(read.window)
  })
  it('never substitutes preference currency when DB main is absent', async () => {
    state.db!.exec("DELETE FROM settings WHERE key='main_currency'")
    await expect(report()).rejects.toThrow(/main currency/)
    const explicit = await report({ currency: 'MXN' })
    expect(explicit.result.currency).toBe('MXN')
    const snapshot = await readScopedSnapshot()
    expect(projectBudget(snapshot, snapshot.budgets[0], window).spent).toBe(25000)
  })
  it('uses canonical split, tags and excludes without duplicate parents', async () => {
    state.db!.exec(
      "INSERT INTO transaction_splits (id,transaction_id,category_id,amount) VALUES ('s1','expense','food',15000),('s2','expense','other',10000)"
    )
    const { result } = await report({
      scope: {
        accountIds: ['bank', 'bank'],
        categoryIds: ['food'],
        tags: ['BUSINESS', 'business'],
      },
    })
    expect(result.basis).toBe('gross_cashflow')
    if (result.basis === 'recurring_estimate') return
    expect(result.budgetUsage.amountCentavos).toBe(15000)
    expect(result.transactionIds).toEqual(['expense'])
    expect(result.allocations.map((a) => a.allocationId)).toEqual(['s1'])
    const excluded = await report({ scope: { tags: ['business'], excludeTags: ['business'] } })
    if (excluded.result.basis !== 'recurring_estimate')
      expect(excluded.result.budgetUsage.amountCentavos).toBe(0)
  })
  it('returns unknown not known fallback for missing FX and classification coverage', async () => {
    state.db!.exec("UPDATE transactions SET currency='EUR'")
    await useBudgetStore.getState().fetch(window)
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      spent: null,
      remaining: null,
      percentUsed: null,
      knownSpent: 0,
      complete: false,
    })
    const { result } = await report({ basis: 'net_consumption' })
    if (result.basis === 'recurring_estimate') return
    expect(result.totals.consumptionCentavos).toBeNull()
    expect(result.coverage.complete).toBe(false)
  })
  it('keeps expense-only budget usage complete when only income FX is unavailable', async () => {
    state.db!.exec(
      "INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description) VALUES ('income','bank','food','income',1000,'EUR','2026-01-11','Income')"
    )
    const snapshot = await readScopedSnapshot()
    const budget = projectBudget(snapshot, snapshot.budgets[0], window)
    expect(budget).toMatchObject({
      complete: true,
      spent: 25000,
      remaining: 75000,
      result: { complete: false },
    })
  })
  it('keeps full out-of-window purchase/refund evidence for net category attribution', async () => {
    state.db!.exec(`UPDATE transactions SET date='2025-12-10';
      INSERT INTO transactions (id,account_id,category_id,type,amount,currency,date,description) VALUES ('refund','bank','other','income',5000,'MXN','2026-01-15','Refund');
      INSERT INTO transaction_consumption_classifications (id,transaction_id,role) VALUES ('purchase','expense','purchase');
      INSERT INTO transaction_consumption_classifications (id,transaction_id,role,referenced_purchase_id) VALUES ('return','refund','refund','purchase');`)
    const { result } = await report({ basis: 'net_consumption', scope: { categoryIds: ['food'] } })
    if (result.basis === 'recurring_estimate') return
    expect(result.known.consumptionCentavos).toBe(-5000)
    expect(result.transactionIds).toEqual(['refund'])
    expect(result.allocations[0].referencedPurchaseId).toBe('purchase')
  })
  it('loads active links joined to statement card account, excludes confirmed full ordinary repayment', async () => {
    state.db!
      .exec(`INSERT INTO accounts (id,name,type,currency) VALUES ('card','Card','credit_card','MXN');
      INSERT INTO credit_card_statements (id,account_id,statement_end_date,due_date,statement_balance,currency) VALUES ('statement','card','2026-01-15','2026-01-25',25000,'MXN');
      INSERT INTO card_statement_payment_links (id,statement_id,transaction_id,original_statement_id,original_transaction_id,amount,mode) VALUES ('link','statement','expense','statement','expense',25000,'apply_to_unpaid');`)
    const snapshot = await readScopedSnapshot()
    expect(snapshot.dataset.activePaymentLinks[0].cardAccountId).toBe('card')
    const { result } = await report()
    if (result.basis === 'recurring_estimate') return
    expect(result.budgetUsage.amountCentavos).toBe(0)
    expect(result.repayments[0].status).toBe('excluded_full_parent')
    state.db!.exec('UPDATE card_statement_payment_links SET amount=10000')
    const partial = await report()
    if (partial.result.basis !== 'recurring_estimate')
      expect(partial.result.budgetUsage).toMatchObject({ complete: false, amountCentavos: null })
  })
  it('keeps recurring source currency, aliases active, separates sources and never materializes', async () => {
    state.db!
      .exec(`INSERT INTO recurring_rules (id,description,amount,currency,type,frequency,next_date,account_id,category_id,tags,active) VALUES ('rule','Rule',1000,'MXN','expense','monthly','2026-01-01','bank','food','["business"]',1),('inactive','Inactive',9999,'MXN','expense','monthly','2026-01-01','bank','food','[]',0);
      INSERT INTO subscriptions (id,name,amount,currency,billing_cycle,next_billing_date,account_id,category_id) VALUES ('subscription','Subscription',2000,'MXN','monthly','2026-01-01','bank','food');`)
    const count = state.db!.prepare('SELECT count(*) AS n FROM transactions').get()
    const { result } = await report({ basis: 'recurring_estimate' })
    if (result.basis !== 'recurring_estimate') return
    expect(result.recurringRules.monthlyCentavos).toBe(1000)
    expect(result.subscriptions.monthlyCentavos).toBe(2000)
    expect(result.combinedMonthlyCentavos).toBeNull()
    const tagged = await report({ basis: 'recurring_estimate', scope: { tags: ['business'] } })
    if (tagged.result.basis === 'recurring_estimate')
      expect(tagged.result.subscriptions).toMatchObject({ complete: false, monthlyCentavos: null })
    state.db!.exec("UPDATE recurring_rules SET currency='EUR' WHERE id='rule'")
    const missing = await report({ basis: 'recurring_estimate' })
    if (missing.result.basis === 'recurring_estimate')
      expect(missing.result.recurringRules.monthlyCentavos).toBeNull()
    expect(state.db!.prepare('SELECT count(*) AS n FROM transactions').get()).toEqual(count)
    expect(state.writes).toBe(0)
  })
  it('persists explicit scope/basis/currency, omitted fields preserve and normalized noop writes nothing', async () => {
    await useBudgetStore.getState().update('plan', {
      scope: {
        accountIds: ['bank', 'bank'],
        categoryIds: ['food'],
        tags: [' Business ', 'business'],
      },
      basis: 'net_consumption',
    })
    expect(JSON.parse(row().scope_json as string)).toEqual({
      accountIds: ['bank'],
      excludeAccountIds: [],
      categoryIds: ['food'],
      excludeCategoryIds: [],
      tags: ['business'],
      excludeTags: [],
    })
    expect(row().currency).toBe('MXN')
    expect(row().category_id).toBe('food')
    const before = row()
    state.writes = 0
    await useBudgetStore.getState().update('plan', {
      scope: { tags: ['BUSINESS'], categoryIds: ['food'], accountIds: ['bank'] },
    })
    expect(state.writes).toBe(0)
    expect(row()).toEqual(before)
    await expect(useBudgetStore.getState().update('plan', { currency: 'USD' })).rejects.toThrow(
      /Re-enter/
    )
    await useBudgetStore.getState().update('plan', { currency: 'USD', amount: 500, scope: {} })
    expect(row()).toMatchObject({
      currency: 'USD',
      amount: 50000,
      category_id: null,
      basis: 'net_consumption',
    })
  })
  it('captures DB main default at write, rejects stale draft and invalid references atomically', async () => {
    await useBudgetStore
      .getState()
      .add({ name: 'New', amount: 1000, period: 'monthly', categoryId: 'food' })
    expect(state.db!.prepare("SELECT currency FROM budgets WHERE name='New'").get()).toEqual({
      currency: 'MXN',
    })
    const before = row()
    await expect(
      useBudgetStore.getState().update('plan', { scope: { excludeAccountIds: ['missing'] } })
    ).rejects.toThrow()
    expect(row()).toEqual(before)
    await expect(
      useBudgetStore
        .getState()
        .add({ name: 'Stale', amount: 100, period: 'monthly', expectedMainCurrency: 'USD' })
    ).rejects.toThrow(/changed/)
    await useBudgetStore
      .getState()
      .add({ name: 'Explicit', amount: 20, period: 'monthly', currency: 'EUR' })
    expect(
      state.db!.prepare("SELECT currency,amount FROM budgets WHERE name='Explicit'").get()
    ).toEqual({ currency: 'EUR', amount: 2000 })
  })
  it('preserves deleted category scope and inactive inspection, never widens malformed JSON', async () => {
    state.db!.exec(
      "DELETE FROM categories WHERE id='food'; UPDATE budgets SET is_active=0 WHERE id='plan'"
    )
    await useBudgetStore.getState().fetch({ ...window, budgetId: 'plan' })
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      spent: null,
      complete: false,
      is_active: 0,
    })
    expect(useBudgetStore.getState().budgets[0].result.issues[0].code).toBe('missing_category')
    state.db!.exec('UPDATE budgets SET scope_json=\'{"categoryIds":"bad"}\' WHERE id=\'plan\'')
    await useBudgetStore.getState().fetch({ ...window, budgetId: 'plan' })
    expect(useBudgetStore.getState().budgets[0].result.issues[0].code).toBe('malformed_scope')
    await useBudgetStore.getState().update('plan', { scope: {}, isActive: true })
    expect(row().is_active).toBe(1)
  })
  it('does not include future posted rows by default; cross-period comparison is null', async () => {
    state.db!.exec("UPDATE transactions SET date='2026-01-30'")
    await useBudgetStore.getState().fetch(window)
    expect(useBudgetStore.getState().budgets[0].spent).toBe(0)
    await useBudgetStore.getState().fetch({ ...window, through: 'period_end' })
    expect(useBudgetStore.getState().budgets[0].spent).toBe(25000)
    await useBudgetStore
      .getState()
      .fetch({ ...window, start: '2025-12-01', end: '2026-01-31', through: 'period_end' })
    expect(useBudgetStore.getState().budgets[0]).toMatchObject({
      spent: 25000,
      remaining: null,
      percentUsed: null,
    })
  })
})
