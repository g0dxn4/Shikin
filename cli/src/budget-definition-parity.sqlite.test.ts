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
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db.prepare(sql).run(...params).changes,
  })
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
import { builtInTools } from './tools/index.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import { useBudgetStore } from '@/stores/budget-store'

const run = (input: Record<string, unknown>, name = 'upsert-budget') => {
  const tool = builtInTools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const row = () =>
  state.db.prepare("SELECT * FROM budgets WHERE id='plan'").get() as Record<string, unknown>
const snapshot = () => ({
  budgets: state.db.prepare('SELECT * FROM budgets ORDER BY id').all(),
  audits: state.db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  revision: state.db.prepare('SELECT * FROM app_data_state').all(),
})
async function outcome(fn: () => Promise<unknown>) {
  try {
    await fn()
    return 'accepted'
  } catch (error) {
    return (error as Error).message
  }
}
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT OR REPLACE INTO settings (key,value) VALUES ('main_currency','USD');
    INSERT INTO accounts (id,name,type,currency) VALUES ('bank','Bank','checking','USD');
    INSERT INTO categories (id,name,type) VALUES ('food','Food','expense');
    INSERT INTO budgets (id,name,amount,currency,period,created_at,updated_at)
      VALUES ('plan','B',100,'EUR','monthly','2020-01-01','2020-01-01');
  `)
  useBudgetStore.setState({ error: null, fetch: async () => {} })
})
afterEach(() => state.db.close())

describe('budget definition literal parent pins and SQLite mutations', () => {
  it('pins tiny CLI amounts after the public schema', async () => {
    expect(await outcome(() => run({ budgetId: 'plan', amount: 0.001 }))).toBe(
      'A positive budget amount is required.'
    )
  })
  it('pins unsupported CLI currency', async () => {
    expect(
      await outcome(() => run({ budgetId: 'plan', currency: 'CHF', amount: 1, dryRun: true }))
    ).toBe('Unsupported currency: CHF')
  })
  it.each(['CHF', ' usd '])('pins frontend authoritative main %j', async (main) => {
    state.db.prepare("UPDATE settings SET value=? WHERE key='main_currency'").run(main)
    expect(await outcome(() => useBudgetStore.getState().update('plan', {}))).toBe(
      `Unsupported currency: ${main}`
    )
  })
  it('pins omitted spaced currency without amount', async () => {
    state.db.pragma('ignore_check_constraints = ON')
    state.db.exec("UPDATE budgets SET currency=' usd '")
    expect(await outcome(() => useBudgetStore.getState().update('plan', {}))).toBe('accepted')
  })
  it('pins omitted spaced currency and name when another field changes', async () => {
    state.db.pragma('ignore_check_constraints = ON')
    state.db.exec("UPDATE budgets SET currency=' usd ', name=' B '")
    await useBudgetStore.getState().update('plan', { amount: 2 })
    expect(row()).toMatchObject({ name: ' B ', currency: ' usd ', amount: 200 })
  })
  it('pins oversized frontend amount', async () => {
    expect(
      await outcome(() => useBudgetStore.getState().update('plan', { amount: 1_000_000_001 }))
    ).toBe('Budget amount exceeds the supported maximum.')
  })
  it('rejects an oversized amount even when it rounds back to the centavo maximum', async () => {
    const before = snapshot()
    expect(
      await outcome(() => useBudgetStore.getState().update('plan', { amount: 1_000_000_000.001 }))
    ).toBe('Budget amount exceeds the supported maximum.')
    expect(snapshot()).toEqual(before)
  })
  it('pins explicit repair of malformed CLI scope', async () => {
    state.db.pragma('ignore_check_constraints = ON')
    state.db.exec("UPDATE budgets SET scope_json='bad'")
    expect(await outcome(() => run({ budgetId: 'plan', scope: {} }))).toBe('accepted')
  })
  it('pins new unnamed category budget', async () => {
    expect(await outcome(() => run({ categoryId: 'food', amount: 1, dryRun: true }))).toBe(
      'A budget name is required.'
    )
  })
  it('preserves omitted EUR instead of main USD without revisions, audit or timestamp changes', async () => {
    const before = snapshot()
    expect(await run({ budgetId: 'plan' })).toMatchObject({
      success: true,
      changed: false,
      budget: { currency: 'EUR', amountCentavos: 100 },
    })
    expect(snapshot()).toEqual(before)
    await useBudgetStore.getState().update('plan', {})
    expect(snapshot()).toEqual(before)
  })
  it('keeps dry runs, actual currency re-entry and captured defaults atomic', async () => {
    const before = snapshot()
    expect(await run({ budgetId: 'plan', amount: 2, dryRun: true })).toMatchObject({
      success: true,
      changed: true,
      wouldUpdate: { after: { amountCentavos: 200, currency: 'EUR' } },
    })
    expect(await run({ budgetId: 'plan', currency: 'USD' })).toMatchObject({
      success: false,
      reason: 'amount_required_for_currency_change',
    })
    await expect(useBudgetStore.getState().update('plan', { currency: 'USD' })).rejects.toThrow(
      /Re-enter/
    )
    await expect(
      useBudgetStore.getState().update('plan', { currency: 'EUR', expectedMainCurrency: 'MXN' })
    ).rejects.toThrow(/changed/)
    expect(snapshot()).toEqual(before)
  })
  it('keeps normalized scope no-ops byte exact even on another field write', async () => {
    const raw = '{ "tags": [" Business ","business"], "categoryIds": ["food"] }'
    state.db.prepare("UPDATE budgets SET scope_json=?,category_id='food' WHERE id='plan'").run(raw)
    const before = snapshot()
    expect(
      await run({ budgetId: 'plan', scope: { categoryIds: ['food'], tags: ['BUSINESS'] } })
    ).toMatchObject({ success: true, changed: false })
    expect(snapshot()).toEqual(before)
    await useBudgetStore.getState().update('plan', {})
    expect(snapshot()).toEqual(before)
  })
  it('keeps deleted category scope safe and permits only explicit clear', async () => {
    state.db.exec(
      `UPDATE budgets SET category_id='food',scope_json='{"categoryIds":["food"]}'; DELETE FROM categories WHERE id='food'`
    )
    const before = snapshot()
    expect(await outcome(() => run({ budgetId: 'plan', amount: 2 }))).toBe(
      'Scope category food is missing.'
    )
    expect(await outcome(() => useBudgetStore.getState().update('plan', { amount: 2 }))).toBe(
      'Scope category food is missing.'
    )
    expect(snapshot()).toEqual(before)
    expect(await run({ budgetId: 'plan', scope: {} })).toMatchObject({
      success: true,
      changed: true,
      budget: { categoryId: null, scope: { categoryIds: [] } },
    })
  })
  it('persists the same complete sparse definition, revision and timestamp through both adapters', async () => {
    const raw = '{ "tags": [" Business "], "categoryIds": ["food"] }'
    state.db.prepare("UPDATE budgets SET scope_json=?,category_id='food',name=' B '").run(raw)
    const baseline = state.db.serialize()
    const revision = state.db.prepare('SELECT data_revision FROM app_data_state').get() as {
      data_revision: number
    }
    state.db.function('strftime', { varargs: true }, () => '2026-01-20T12:00:00.000Z')
    expect(await run({ budgetId: 'plan', amount: 2 })).toMatchObject({
      success: true,
      changed: true,
      budget: { name: ' B ', amountCentavos: 200, currency: 'EUR' },
    })
    const cliRow = row()
    expect(cliRow).toEqual({
      id: 'plan',
      name: ' B ',
      amount: 200,
      currency: 'EUR',
      period: 'monthly',
      category_id: 'food',
      scope_json: raw,
      basis: 'gross_cashflow',
      is_active: 1,
      created_at: '2020-01-01',
      updated_at: '2026-01-20T12:00:00.000Z',
    })
    expect(state.db.prepare('SELECT data_revision FROM app_data_state').get()).toEqual({
      data_revision: revision.data_revision + 1,
    })
    const audit = state.db
      .prepare("SELECT action,before_json,after_json FROM audit_log WHERE entity='budget'")
      .get() as { action: string; before_json: string; after_json: string }
    expect(audit.action).toBe('update')
    expect(JSON.parse(audit.before_json).budget).toMatchObject({
      name: ' B ',
      currency: 'EUR',
      amountCentavos: 100,
    })
    expect(JSON.parse(audit.after_json).budget).toMatchObject({
      name: ' B ',
      currency: 'EUR',
      amountCentavos: 200,
    })
    state.db.close()
    state.db = new Database(baseline)
    state.db.function('strftime', { varargs: true }, () => '2026-01-20T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-20T12:00:00.000Z'))
    try {
      await useBudgetStore.getState().update('plan', { amount: 2 })
    } finally {
      vi.useRealTimers()
    }
    expect(row()).toEqual(cliRow)
    expect(state.db.prepare('SELECT data_revision FROM app_data_state').get()).toEqual({
      data_revision: revision.data_revision + 1,
    })
    expect(state.db.prepare('SELECT * FROM audit_log').all()).toEqual([])
  })
  it('keeps settings absence, create conflicts, failed audit and precedence transactional', async () => {
    state.db.exec("DELETE FROM settings WHERE key='main_currency'")
    const before = snapshot()
    expect(await run({ budgetId: 'plan' })).toMatchObject({ success: true, changed: false })
    expect(await run({ budgetId: 'new', name: 'New', amount: 1 })).toMatchObject({
      success: false,
      reason: 'main_currency_unconfigured',
    })
    expect(snapshot()).toEqual(before)
    expect(
      await run(
        { budgetId: 'plan', name: 'Different', amount: 1, currency: 'EUR' },
        'create-budget'
      )
    ).toMatchObject({ success: false, reason: 'budget_id_conflict' })
    expect(snapshot()).toEqual(before)
    expect(
      await run({ budgetId: 'plan', currency: 'USD', scope: { accountIds: ['gone'] } })
    ).toMatchObject({ success: false, reason: 'amount_required_for_currency_change' })
    await expect(
      useBudgetStore.getState().update('plan', { currency: 'USD', scope: { accountIds: ['gone'] } })
    ).rejects.toThrow(/Re-enter/)
    state.db.exec(
      `CREATE TRIGGER reject_budget_audit BEFORE INSERT ON audit_log WHEN NEW.entity='budget' BEGIN SELECT RAISE(ABORT,'audit failure'); END`
    )
    await expect(run({ budgetId: 'plan', amount: 2 })).rejects.toThrow('audit failure')
    expect(snapshot()).toEqual(before)
  })
  it.each([true, false])(
    'rejects malformed-scope deletion with dryRun=%s without changing cascading periods or evidence',
    async (dryRun) => {
      state.db.exec(`UPDATE budgets SET scope_json='{"categoryIds":"bad"}' WHERE id='plan';
        INSERT INTO budget_periods(id,budget_id,start_date,end_date,spent)
          VALUES('period','plan','2026-01-01','2026-01-31',25)`)
      const before = {
        ...snapshot(),
        periods: state.db.prepare('SELECT * FROM budget_periods').all(),
      }
      await expect(run({ budgetId: 'plan', dryRun }, 'delete-budget')).rejects.toThrow(
        'categoryIds must be an array.'
      )
      expect({
        ...snapshot(),
        periods: state.db.prepare('SELECT * FROM budget_periods').all(),
      }).toEqual(before)
    }
  )
})
