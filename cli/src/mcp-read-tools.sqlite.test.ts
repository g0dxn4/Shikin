// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
import { isReadOnlyMcpTool } from './mcp-profiles.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  writeAttempts: 0,
  queries: 0,
}))

vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) => {
    const statement = state.db!.prepare(sql.replace(/\$\d+/g, '?'))
    if (!statement.readonly) {
      state.writeAttempts += 1
      throw new Error('A declared read-only tool attempted a write through query().')
    }
    state.queries += 1
    return statement.all(...params)
  },
  execute: () => {
    state.writeAttempts += 1
    throw new Error('A declared read-only tool attempted execute().')
  },
  transaction: (fn: () => unknown) => state.db!.transaction(fn).deferred(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))

import { accountsTools } from './tools/accounts.js'
import { investmentsandsubscriptionsTools } from './tools/investments-and-subscriptions.js'
import { auditAndContextTools } from './tools/audit-and-context.js'
import { cashflowBucketTools } from './tools/cashflow-buckets.js'

const auditedTools = [
  ...accountsTools,
  ...investmentsandsubscriptionsTools,
  ...auditAndContextTools,
  ...cashflowBucketTools,
]

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-17T12:00:00Z'))
  const db = (state.db = new Database(':memory:'))
  db.pragma('foreign_keys = ON')
  runHostedTestMigrations(db)
  db.exec(`
    INSERT INTO settings (key, value, updated_at)
      VALUES ('main_currency', 'USD', '2026-10-01'),
             ('account_aliases', '{"checking":"account"}', '2026-10-01'),
             ('finance_profile', '{"currency":"USD"}', '2026-10-01');
    INSERT INTO accounts (id, name, type, currency, account_mode, balance)
      VALUES ('account', 'Synthetic checking', 'checking', 'USD', 'transactional', -2000);
    DELETE FROM categories;
    INSERT INTO categories (id, name, type) VALUES ('home', 'Home', 'expense');
    INSERT INTO budgets (id, name, category_id, amount, period)
      VALUES ('budget', 'Household', 'home', 10000, 'monthly');
    INSERT INTO transactions (id, account_id, type, amount, currency, description, date, category_id)
      VALUES ('txn', 'account', 'expense', 2000, 'USD', 'Synthetic purchase', '2026-10-10', 'home');
    INSERT INTO subscriptions (id, name, amount, currency, billing_cycle, next_billing_date, account_id)
      VALUES ('sub', 'Annual membership', 120000, 'USD', 'yearly', '2026-12-01', 'account');
    INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id)
      VALUES ('recurring', 'Monthly bill', 5000, 'USD', 'expense', 'monthly', '2026-10-20', 'account');
    INSERT INTO cashflow_buckets (id, name, target_amount, currency)
      VALUES ('bucket', 'Pet supplies', 60000, 'USD');
    INSERT INTO audit_log (id, entity, entity_id, action, source, created_at)
      VALUES ('audit-read', 'transaction', 'txn', 'CREATE', 'synthetic-test', '2026-10-10T12:00:00Z');
  `)
  db.pragma('query_only = ON')
  state.writeAttempts = 0
  state.queries = 0
})

afterEach(() => {
  state.db?.close()
  state.db = null
  vi.useRealTimers()
})

describe('audited MCP read tools on populated synthetic SQLite', () => {
  it.each([
    ['automation-context', {}],
    ['finance-sanity-check', {}],
    ['audit-list', {}],
    ['audit-show', { id: 'audit-read' }],
    ['list-categories', {}],
    ['list-subscriptions', {}],
    ['list-buckets', {}],
  ] as const)('%s performs no financial or metadata writes', async (name, input) => {
    const tool = auditedTools.find((candidate) => candidate.name === name)!
    expect(tool.effects).toEqual({ readOnly: true, writesTo: [] })
    expect(isReadOnlyMcpTool(tool)).toBe(true)
    const before = state.db!.serialize()
    const result = await tool.execute(tool.schema.parse(input))
    expect(result.success).not.toBe(false)
    expect(state.queries).toBeGreaterThan(0)
    expect(state.writeAttempts).toBe(0)
    expect(state.db!.serialize()).toEqual(before)
  })

  it('shows annual planning equivalents and recurring context without materializing expenses', async () => {
    const subscriptions = auditedTools.find((tool) => tool.name === 'list-subscriptions')!
    const result = await subscriptions.execute(subscriptions.schema.parse({}))
    expect(result.subscriptions[0]).toMatchObject({
      id: 'sub',
      billingCycle: 'yearly',
      monthlyAmount: 100,
      yearlyAmount: 1200,
    })
    const context = auditedTools.find((tool) => tool.name === 'automation-context')!
    const overview = await context.execute(context.schema.parse({}))
    expect(overview.recurring.expected).toEqual(
      expect.arrayContaining([expect.objectContaining({ ruleId: 'recurring' })])
    )
    expect(state.db!.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({
      count: 1,
    })
    expect(state.writeAttempts).toBe(0)
  })
})
