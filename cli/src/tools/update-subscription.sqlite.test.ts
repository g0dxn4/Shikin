// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../backend-foundation-test-schema.js'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database, nextAuditId: 0 }))

vi.mock('../database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))

vi.mock('../ulid.js', () => ({
  generateId: () => `audit-${++holder.nextAuditId}`,
}))

vi.mock('./credit-cards.js', () => ({
  getCreditCardBillEntries: () => [],
}))

vi.mock('../insights.js', () => ({
  listSubscriptionsSummary: vi.fn(),
  getSubscriptionSpendingSummary: vi.fn(),
}))

vi.mock('../valuation-read.js', () => ({
  readInvestmentValuationRows: () => [],
  readValuationRates: () => [],
  rowToHoldingInput: () => ({}),
}))

import { investmentsandsubscriptionsTools } from './investments-and-subscriptions.js'

const call = (input: Record<string, unknown>) => {
  const tool = investmentsandsubscriptionsTools.find((item) => item.name === 'update-subscription')!
  return tool.execute(tool.schema.parse(input))
}

const row = () =>
  holder.db.prepare('SELECT * FROM subscriptions WHERE id = ?').get('sub-1') as Record<
    string,
    unknown
  >

beforeEach(() => {
  holder.nextAuditId = 0
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance)
    VALUES ('a', 'Checking', 'checking', 'USD', 0);
    INSERT INTO subscriptions (
      id, account_id, category_id, name, amount, currency, billing_cycle, next_billing_date,
      icon, color, url, notes, is_active
    ) VALUES (
      'sub-1', 'a', NULL, 'Stream', 999, 'USD', 'monthly', '2026-06-01',
      'play', '#111111', 'https://example.test', 'keep notes', 1
    );
  `)
})

afterEach(() => holder.db.close())

describe('update-subscription nullable metadata', () => {
  it('omits icon, color, url, and notes without changing money or provenance-adjacent fields', async () => {
    const result = await call({ subscriptionId: 'sub-1', name: 'Streaming' })
    expect(result).toMatchObject({ success: true, changed: true })
    expect(row()).toMatchObject({
      name: 'Streaming',
      amount: 999,
      icon: 'play',
      color: '#111111',
      url: 'https://example.test',
      notes: 'keep notes',
      account_id: 'a',
    })
  })

  it('sets values, clears with empty string compatibility, actual null, and clear flags', async () => {
    const set = await call({
      subscriptionId: 'sub-1',
      icon: 'star',
      color: '#ffffff',
      url: 'https://new.test',
      notes: 'null',
    })
    expect(set).toMatchObject({ success: true })
    expect(row()).toMatchObject({
      icon: 'star',
      color: '#ffffff',
      url: 'https://new.test',
      notes: 'null',
      amount: 999,
    })

    const empty = await call({
      subscriptionId: 'sub-1',
      icon: '',
      color: '',
      url: '',
      notes: '',
    })
    expect(empty).toMatchObject({ success: true })
    expect(row()).toMatchObject({ icon: null, color: null, url: null, notes: null, amount: 999 })

    holder.db
      .prepare(
        "UPDATE subscriptions SET icon = 'play', color = '#111111', url = 'https://example.test', notes = 'keep notes' WHERE id = 'sub-1'"
      )
      .run()
    const byNull = await call({
      subscriptionId: 'sub-1',
      icon: null,
      color: null,
      url: null,
      notes: null,
    })
    expect(byNull).toMatchObject({ success: true })
    expect(row()).toMatchObject({ icon: null, color: null, url: null, notes: null })

    holder.db
      .prepare(
        "UPDATE subscriptions SET icon = 'play', color = '#111111', url = 'https://example.test', notes = 'keep notes' WHERE id = 'sub-1'"
      )
      .run()
    const byFlag = await call({
      subscriptionId: 'sub-1',
      clearIcon: true,
      clearColor: true,
      clearUrl: true,
      clearNotes: true,
    })
    expect(byFlag).toMatchObject({ success: true })
    expect(row()).toMatchObject({
      icon: null,
      color: null,
      url: null,
      notes: null,
      amount: 999,
      name: 'Stream',
    })
  })

  it('rejects supplied values plus clear flags, including null', async () => {
    const before = row()
    for (const input of [
      { clearIcon: true, icon: 'x' },
      { clearIcon: true, icon: null },
      { clearColor: true, color: '#000' },
      { clearColor: true, color: null },
      { clearUrl: true, url: 'https://x.test' },
      { clearUrl: true, url: null },
      { clearNotes: true, notes: 'x' },
      { clearNotes: true, notes: null },
    ]) {
      const result = await call({ subscriptionId: 'sub-1', ...input })
      expect(result).toMatchObject({ success: false })
      expect(String((result as { message: string }).message)).toMatch(/Use either/)
    }
    expect(row()).toEqual(before)
  })
})
