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

import { goalsTools } from './goals.js'

const call = (name: string, input: Record<string, unknown>) => {
  const tool = goalsTools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}

const goalRow = () =>
  holder.db.prepare('SELECT * FROM goals WHERE id = ?').get('goal-1') as Record<string, unknown>

function seedGoal() {
  holder.db
    .prepare(
      `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes)
       VALUES ('goal-1', 'Vacation', 500000, 100000, '2027-06-01', 'a', '🎯', '#bf5af2', 'keep notes')`
    )
    .run()
}

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(
    "INSERT INTO accounts (id, name, type, currency, balance) VALUES ('a', 'Savings', 'checking', 'USD', 0), ('b', 'Brokerage', 'investment', 'USD', 0)"
  )
  seedGoal()
})

afterEach(() => holder.db.close())

describe('update-goal nullable maintenance', () => {
  it('omits deadline, notes, and account without changing stored values or money', async () => {
    const before = goalRow()
    const result = await call('update-goal', { goalId: 'goal-1', name: 'Trip' })
    expect(result).toMatchObject({ success: true, goal: { name: 'Trip', deadline: '2027-06-01' } })
    expect(goalRow()).toMatchObject({
      name: 'Trip',
      target_amount: before.target_amount,
      current_amount: before.current_amount,
      deadline: '2027-06-01',
      account_id: 'a',
      icon: '🎯',
      color: '#bf5af2',
      notes: 'keep notes',
    })
  })

  it('sets deadline, notes, and accountId and rejects unknown or archived accounts', async () => {
    const set = await call('update-goal', {
      goalId: 'goal-1',
      deadline: '2028-01-15',
      notes: 'null',
      accountId: 'b',
    })
    expect(set).toMatchObject({ success: true, goal: { deadline: '2028-01-15' } })
    expect(goalRow()).toMatchObject({
      deadline: '2028-01-15',
      notes: 'null',
      account_id: 'b',
      current_amount: 100000,
    })

    const missing = await call('update-goal', { goalId: 'goal-1', accountId: 'missing' })
    expect(missing).toMatchObject({ success: false, message: 'Account missing not found.' })
    expect(goalRow().account_id).toBe('b')

    holder.db.prepare("UPDATE accounts SET is_archived = 1 WHERE id = 'a'").run()
    const archived = await call('update-goal', { goalId: 'goal-1', accountId: 'a' })
    expect(archived).toMatchObject({ success: false })
    expect(String((archived as { message: string }).message)).toMatch(/archived/)
    expect(goalRow().account_id).toBe('b')
  })

  it('clears deadline, notes, and account with actual null or clear flags', async () => {
    const byNull = await call('update-goal', {
      goalId: 'goal-1',
      deadline: null,
      notes: null,
      accountId: null,
    })
    expect(byNull).toMatchObject({ success: true, goal: { deadline: null } })
    expect(goalRow()).toMatchObject({
      deadline: null,
      notes: null,
      account_id: null,
      current_amount: 100000,
      icon: '🎯',
    })

    holder.db
      .prepare(
        "UPDATE goals SET deadline = '2027-06-01', notes = 'keep notes', account_id = 'a' WHERE id = 'goal-1'"
      )
      .run()
    const byFlag = await call('update-goal', {
      goalId: 'goal-1',
      clearDeadline: true,
      clearNotes: true,
      clearAccount: true,
    })
    expect(byFlag).toMatchObject({ success: true, goal: { deadline: null } })
    expect(goalRow()).toMatchObject({ deadline: null, notes: null, account_id: null })
  })

  it('rejects supplied values plus clear flags, including null', async () => {
    const before = goalRow()
    for (const input of [
      { clearDeadline: true, deadline: '2028-01-01' },
      { clearDeadline: true, deadline: null },
      { clearNotes: true, notes: 'x' },
      { clearNotes: true, notes: null },
      { clearAccount: true, accountId: 'b' },
      { clearAccount: true, accountId: null },
    ]) {
      const result = await call('update-goal', { goalId: 'goal-1', ...input })
      expect(result).toMatchObject({ success: false })
      expect(String((result as { message: string }).message)).toMatch(/conflicts with/)
    }
    expect(goalRow()).toEqual(before)
  })

  it('rejects non-calendar deadline values and preserves addAmount money updates', async () => {
    expect(() => call('update-goal', { goalId: 'goal-1', deadline: '2027-02-30' })).toThrow()
    expect(goalRow().deadline).toBe('2027-06-01')

    const added = await call('update-goal', { goalId: 'goal-1', addAmount: 25 })
    expect(added).toMatchObject({
      success: true,
      goal: { currentAmount: 1025, deadline: '2027-06-01' },
    })
    expect(goalRow()).toMatchObject({
      current_amount: 102500,
      deadline: '2027-06-01',
      notes: 'keep notes',
      icon: '🎯',
      color: '#bf5af2',
    })
  })
})
