// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../backend-foundation-test-schema.js'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database }))

vi.mock('../database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))

import { recurringTools } from './recurring.js'

const call = (name: string, input: Record<string, unknown>) => {
  const tool = recurringTools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}

const ruleRow = () =>
  holder.db.prepare('SELECT * FROM recurring_rules WHERE id = ?').get('rule-1') as Record<
    string,
    unknown
  >

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance)
    VALUES ('a', 'Checking', 'checking', 'USD', 0);
    INSERT INTO subcategories (id, category_id, name)
    VALUES ('rent-sub', '01HOUSING00000000000000000', 'Rent');
    INSERT INTO recurring_rules (
      id, description, amount, currency, type, frequency, next_date, end_date,
      account_id, category_id, subcategory_id, notes, active, anchor_kind, anchor_day
    ) VALUES (
      'rule-1', 'Rent', 150000, 'USD', 'expense', 'monthly', '2026-04-01', '2027-12-31',
      'a', '01HOUSING00000000000000000', 'rent-sub', 'keep notes', 1, 'fixed_day', 1
    );
    INSERT INTO transactions (id, account_id, type, amount, currency, description, date, recurring_rule_id)
    VALUES ('tx-old', 'a', 'expense', 150000, 'USD', 'Rent', '2026-03-01', 'rule-1');
  `)
})

afterEach(() => holder.db.close())

describe('manage-recurring-transaction nullable maintenance', () => {
  it('omits endDate, notes, and category without changing schedule, subcategory, or generated transactions', async () => {
    const beforeTx = holder.db.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-old')
    const result = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      description: 'Monthly rent',
    })
    expect(result).toMatchObject({ success: true })
    expect(ruleRow()).toMatchObject({
      description: 'Monthly rent',
      end_date: '2027-12-31',
      notes: 'keep notes',
      category_id: '01HOUSING00000000000000000',
      subcategory_id: 'rent-sub',
      next_date: '2026-04-01',
      anchor_kind: 'fixed_day',
      anchor_day: 1,
      amount: 150000,
    })
    expect(holder.db.prepare('SELECT * FROM transactions WHERE id = ?').get('tx-old')).toEqual(
      beforeTx
    )
  })

  it('sets endDate, notes, and a matching category while preserving a valid subcategory', async () => {
    const result = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      endDate: '2028-01-31',
      notes: 'null',
      category: 'Housing',
    })
    expect(result).toMatchObject({ success: true })
    expect(ruleRow()).toMatchObject({
      end_date: '2028-01-31',
      notes: 'null',
      category_id: '01HOUSING00000000000000000',
      subcategory_id: 'rent-sub',
    })
  })

  it('clears endDate, notes, and category with actual null or flags, including dependent subcategory', async () => {
    const byNull = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      endDate: null,
      notes: null,
      category: null,
    })
    expect(byNull).toMatchObject({ success: true })
    expect(ruleRow()).toMatchObject({
      end_date: null,
      notes: null,
      category_id: null,
      subcategory_id: null,
      next_date: '2026-04-01',
    })

    holder.db
      .prepare(
        "UPDATE recurring_rules SET end_date = '2027-12-31', notes = 'keep notes', category_id = '01HOUSING00000000000000000', subcategory_id = 'rent-sub' WHERE id = 'rule-1'"
      )
      .run()
    const byFlag = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      clearEndDate: true,
      clearNotes: true,
      clearCategory: true,
    })
    expect(byFlag).toMatchObject({ success: true })
    expect(ruleRow()).toMatchObject({
      end_date: null,
      notes: null,
      category_id: null,
      subcategory_id: null,
    })
  })

  it('rejects supplied values plus clear flags, including null, without writing', async () => {
    const before = ruleRow()
    for (const input of [
      { clearEndDate: true, endDate: '2028-01-01' },
      { clearEndDate: true, endDate: null },
      { clearNotes: true, notes: 'x' },
      { clearNotes: true, notes: null },
      { clearCategory: true, category: 'Housing' },
      { clearCategory: true, category: null },
    ]) {
      const result = await call('manage-recurring-transaction', {
        action: 'update',
        ruleId: 'rule-1',
        ...input,
      })
      expect(result).toMatchObject({ success: false })
      expect(String((result as { message: string }).message)).toMatch(/conflicts with/)
    }
    expect(ruleRow()).toEqual(before)
  })

  it('rejects opposite-direction categories and clears subcategory when the parent category changes', async () => {
    const direction = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      category: 'Salary',
    })
    expect(direction).toMatchObject({
      success: false,
      message: 'Category direction must match the recurring rule type.',
    })
    expect(ruleRow()).toMatchObject({
      category_id: '01HOUSING00000000000000000',
      subcategory_id: 'rent-sub',
    })

    const changed = await call('manage-recurring-transaction', {
      action: 'update',
      ruleId: 'rule-1',
      category: 'Utilities',
    })
    expect(changed).toMatchObject({ success: true })
    expect(ruleRow()).toMatchObject({
      category_id: '01UTILITIES000000000000000',
      subcategory_id: null,
      end_date: '2027-12-31',
      notes: 'keep notes',
      next_date: '2026-04-01',
    })
  })
})
