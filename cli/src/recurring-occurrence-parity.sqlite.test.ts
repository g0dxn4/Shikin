// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import type { TransactionClient } from '@/lib/database'

const holder = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
  trace: [] as string[],
  id: 0,
  loseClaim: false,
}))

vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) => {
    holder.trace.push('select')
    return holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params)
  },
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected:
      holder.loseClaim && sql.includes('UPDATE recurring_rules')
        ? 0
        : holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => {
    holder.trace.push('begin')
    try {
      const result = holder.db.transaction(fn).immediate()
      holder.trace.push('commit')
      return result
    } catch (error) {
      holder.trace.push('rollback')
      throw error
    }
  },
}))
vi.mock('./ulid.js', () => ({
  generateId: () => `occurrence-${++holder.id}`,
}))
vi.mock('@/lib/ulid', () => ({ generateId: () => `occurrence-${++holder.id}` }))
vi.mock('@/lib/runtime', () => ({ isTauri: true }))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: async () => {} }) },
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: async () => {} }) },
}))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => {
    holder.trace.push('select')
    return holder.db.prepare(sql).all(...params)
  }
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected:
      holder.loseClaim && sql.includes('UPDATE recurring_rules')
        ? 0
        : holder.db.prepare(sql).run(...params).changes,
  })
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: TransactionClient) => Promise<unknown>) => {
      holder.trace.push('begin')
      holder.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute } as TransactionClient)
        holder.db.exec('COMMIT')
        holder.trace.push('commit')
        return result
      } catch (error) {
        holder.db.exec('ROLLBACK')
        holder.trace.push('rollback')
        throw error
      }
    },
  }
})

import { recurringTools } from './tools/recurring.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import { useRecurringStore } from '@/stores/recurring-store'

const materialize = (client: 'cli' | 'native') =>
  client === 'native'
    ? useRecurringStore.getState().materializeTransactions()
    : recurringTools.find((tool) => tool.name === 'materialize-recurring')!.execute({})
const state = () => ({
  count: holder.db
    .prepare<
      [],
      { count: number }
    >('SELECT COUNT(*) AS count FROM transactions WHERE is_recurring = 1')
    .get()!.count,
  balance: holder.db
    .prepare<[], { balance: number }>("SELECT balance FROM accounts WHERE id = 'a'")
    .get()!.balance,
  rules: holder.db.prepare('SELECT id, next_date, active FROM recurring_rules ORDER BY id').all(),
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-08T12:00:00Z'))
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance) VALUES ('a', 'A', 'checking', 'USD', 1000), ('b', 'B', 'checking', 'USD', 0);
    INSERT INTO subcategories (id, category_id, name) VALUES ('s', '01HOUSING00000000000000000', 'Subcategory');
    INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, category_id, subcategory_id, tags, to_account_id, notes, active, anchor_kind, anchor_day)
      VALUES ('r1', 'R', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', '01HOUSING00000000000000000', 's', '["x"]', 'b', 'note', 1, 'fixed_day', 8);
    INSERT INTO transactions (id, account_id, type, amount, currency, description, date, recurring_rule_id)
      VALUES ('historical', 'a', 'expense', 100, 'USD', 'Old details', '2026-10-08', 'r1');
  `)
  holder.trace = []
  holder.id = 0
  holder.loseClaim = false
  useRecurringStore.setState({ rules: [], error: null, fetchError: null })
})
afterEach(() => {
  holder.db.close()
  vi.useRealTimers()
})

// Literal 56a840e calendar results; timestamps retain their original bytes in occurrences.
const dateFormatCases = [
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01',
    next: ['2026-11-02', '2026-11-08', '2026-11-15', '2026-12-01'],
    dailyDates: ['2026-11-01'],
  },
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01T00:00:00',
    next: ['2026-11-02', '2026-11-08', '2026-11-15', null],
    dailyDates: ['2026-11-01T00:00:00'],
  },
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01T00:00:00Z',
    next: ['2026-11-02', '2026-11-07', '2026-11-14', null],
    dailyDates: ['2026-11-01T00:00:00Z', '2026-11-01'],
  },
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01T00:00:00+05:30',
    next: ['2026-11-02', '2026-11-07', '2026-11-14', null],
    dailyDates: ['2026-11-01T00:00:00+05:30', '2026-11-01'],
  },
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01T00:00:00-07:00',
    next: ['2026-11-02', '2026-11-08', '2026-11-15', null],
    dailyDates: ['2026-11-01T00:00:00-07:00'],
  },
  {
    zone: 'America/Mexico_City',
    date: '2026-11-01 00:00:00',
    next: ['2026-11-02', '2026-11-08', '2026-11-15', null],
    dailyDates: ['2026-11-01 00:00:00'],
  },
  {
    zone: 'America/New_York',
    date: '2026-10-31T12:00:00',
    next: ['2026-11-01', '2026-11-07', '2026-11-14', null],
    dailyDates: ['2026-10-31T12:00:00'],
  },
  {
    zone: 'America/New_York',
    date: '2026-03-07T23:30:00',
    next: ['2026-03-08', '2026-03-14', '2026-03-21', null],
    dailyDates: ['2026-03-07T23:30:00'],
  },
].flatMap((entry) =>
  ['daily', 'weekly', 'biweekly', 'monthly'].map((frequency, index) => ({
    ...entry,
    frequency,
    nextDate: entry.next[index],
  }))
)

describe.each(['cli', 'native'] as const)('%s recurring occurrence contract', (client) => {
  it.each([
    [
      'UPDATE recurring_rules SET amount = -1',
      'amountCentavos must be a non-negative safe integer',
    ],
    [
      'UPDATE recurring_rules SET amount = 0.5',
      'amountCentavos must be a non-negative safe integer',
    ],
    [
      'UPDATE recurring_rules SET amount = 9007199254740992',
      'amountCentavos must be a non-negative safe integer',
    ],
    ["UPDATE recurring_rules SET type = 'refund'", 'Unsupported transaction type: refund'],
    [
      "UPDATE accounts SET account_mode = 'hybrid' WHERE id = 'a'",
      'Unsupported account mode: hybrid',
    ],
    [
      "UPDATE accounts SET currency = 'US-D' WHERE id = 'a'; UPDATE recurring_rules SET currency = 'US-D'",
      'account.currency must be a 2-10 character asset or currency code',
    ],
  ])('refuses unsafe occurrence evidence: %s', async (sql, detail) => {
    holder.db.pragma('ignore_check_constraints = ON')
    holder.db.exec(sql)
    const before = {
      state: state(),
      transactions: holder.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
      rules: holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all(),
      revision: holder.db.prepare('SELECT * FROM app_data_state').all(),
    }
    if (client === 'cli')
      expect(await materialize(client)).toMatchObject({
        success: false,
        reason: 'invalid_ledger_evidence',
        message: expect.stringContaining(detail),
      })
    else await expect(materialize(client)).rejects.toThrow(detail)
    expect({
      state: state(),
      transactions: holder.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
      rules: holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all(),
      revision: holder.db.prepare('SELECT * FROM app_data_state').all(),
    }).toEqual(before)
  })
  it.each(dateFormatCases)(
    'preserves parent $frequency dates for $date in $zone',
    async ({ zone, frequency, date, nextDate, dailyDates }) => {
      vi.stubEnv('TZ', zone)
      try {
        holder.db
          .prepare(
            'UPDATE recurring_rules SET frequency = ?, next_date = ?, end_date = ?, anchor_day = 1'
          )
          .run(frequency, date, date)
        const beforeRules = holder.db.prepare('SELECT * FROM recurring_rules').all()
        const beforeRevision = holder.db.prepare('SELECT * FROM app_data_state').all()
        if (nextDate === null) {
          await expect(materialize(client)).rejects.toThrow('date must use YYYY-MM-DD format')
          expect(holder.db.prepare('SELECT * FROM recurring_rules').all()).toEqual(beforeRules)
          expect(holder.db.prepare('SELECT * FROM app_data_state').all()).toEqual(beforeRevision)
          expect(state()).toEqual({
            count: 0,
            balance: 1000,
            rules: [{ id: 'r1', next_date: date, active: 1 }],
          })
          return
        }
        const dates = frequency === 'daily' ? dailyDates : [date]
        expect(await materialize(client)).toEqual(
          client === 'native'
            ? dates.length
            : {
                success: true,
                created: dates.length,
                message: `Created ${dates.length} transaction(s) from recurring rules.`,
              }
        )
        expect(state()).toEqual({
          count: dates.length,
          balance: dates.length === 2 ? 800 : 900,
          rules: [{ id: 'r1', next_date: nextDate, active: 0 }],
        })
        expect(
          holder.db
            .prepare(
              'SELECT date, amount, currency, notes FROM transactions WHERE is_recurring = 1 ORDER BY id'
            )
            .all()
        ).toEqual(
          dates.map((storedDate) => ({
            date: storedDate,
            amount: 100,
            currency: 'USD',
            notes: 'note',
          }))
        )
        expect(
          holder.db.prepare("SELECT end_date FROM recurring_rules WHERE id = 'r1'").get()
        ).toEqual({ end_date: date })
      } finally {
        vi.unstubAllEnvs()
      }
    }
  )

  it('pins committed metadata, read/transaction order, and immutable old occurrences', async () => {
    const old = holder.db.prepare("SELECT * FROM transactions WHERE id = 'historical'").get()
    const result = await materialize(client)
    expect(result).toEqual(
      client === 'native'
        ? 1
        : {
            success: true,
            created: 1,
            message: 'Created 1 transaction(s) from recurring rules.',
          }
    )
    expect(holder.trace).toEqual(
      client === 'native' ? ['begin', 'select', 'commit', 'select'] : ['begin', 'select', 'commit']
    )
    expect(
      holder.db
        .prepare(
          'SELECT account_id, category_id, subcategory_id, tags, transfer_to_account_id, amount, currency, type, description, notes, date, status, recurring_rule_id FROM transactions WHERE is_recurring = 1'
        )
        .get()
    ).toEqual({
      account_id: 'a',
      category_id: '01HOUSING00000000000000000',
      subcategory_id: 's',
      tags: '["x"]',
      transfer_to_account_id: 'b',
      amount: 100,
      currency: 'USD',
      type: 'expense',
      description: 'R',
      notes: 'note',
      date: '2026-11-08',
      status: 'posted',
      recurring_rule_id: 'r1',
    })
    expect(state()).toEqual({
      count: 1,
      balance: 900,
      rules: [{ id: 'r1', next_date: '2026-12-08', active: 1 }],
    })
    expect(holder.db.prepare("SELECT * FROM transactions WHERE id = 'historical'").get()).toEqual(
      old
    )
  })

  it('pins the second-rule insertion fault and both dates', async () => {
    holder.db.exec(`
      INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, active, anchor_kind, anchor_day)
        VALUES ('r2', 'Second', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', 1, 'fixed_day', 8);
      CREATE TRIGGER fail_second BEFORE INSERT ON transactions WHEN NEW.recurring_rule_id = 'r2'
        BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;
    `)
    const beforeRevision = holder.db.prepare('SELECT * FROM app_data_state').all()
    const beforeRules = holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all()
    await expect(materialize(client)).rejects.toThrow('injected insert failure')
    expect(state()).toEqual({
      count: 0,
      balance: 1000,
      rules: [
        { id: 'r1', next_date: '2026-11-08', active: 1 },
        { id: 'r2', next_date: '2026-11-08', active: 1 },
      ],
    })
    expect(holder.trace).toEqual(['begin', 'select', 'rollback'])
    expect(holder.db.prepare('SELECT * FROM app_data_state').all()).toEqual(beforeRevision)
    expect(holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all()).toEqual(
      beforeRules
    )
  })

  it('pins empty due reads', async () => {
    holder.db.exec('UPDATE recurring_rules SET active = 0')
    expect(await materialize(client)).toEqual(
      client === 'native'
        ? 0
        : {
            success: true,
            created: 0,
            message: 'No recurring transactions were due.',
          }
    )
    expect(holder.trace).toEqual(['begin', 'select', 'commit'])
  })

  it('keeps a lost claim balance-neutral', async () => {
    holder.loseClaim = true
    await materialize(client)
    expect(state()).toEqual({
      count: 0,
      balance: 1000,
      rules: [{ id: 'r1', next_date: '2026-11-08', active: 1 }],
    })
  })

  it('catches up through the end date and deactivates without changing historical details', async () => {
    holder.db.exec("UPDATE recurring_rules SET next_date = '2026-09-08', end_date = '2026-10-08'")
    await materialize(client)
    expect(state()).toEqual({
      count: 2,
      balance: 800,
      rules: [{ id: 'r1', next_date: '2026-11-08', active: 0 }],
    })
    expect(
      holder.db.prepare('SELECT date FROM transactions WHERE is_recurring = 1 ORDER BY date').all()
    ).toEqual([{ date: '2026-09-08' }, { date: '2026-10-08' }])
  })

  it('rolls back a later occurrence of the same rule', async () => {
    holder.db.exec(`UPDATE recurring_rules SET next_date = '2026-10-08';
      CREATE TRIGGER fail_later BEFORE INSERT ON transactions WHEN NEW.date = '2026-11-08'
        BEGIN SELECT RAISE(ABORT, 'later occurrence failure'); END;`)
    await expect(materialize(client)).rejects.toThrow('later occurrence failure')
    expect(state()).toEqual({
      count: 0,
      balance: 1000,
      rules: [{ id: 'r1', next_date: '2026-10-08', active: 1 }],
    })
  })

  it('pins unsupported legacy frequency handling without rewriting the rule', async () => {
    holder.db.pragma('ignore_check_constraints = ON')
    holder.db.exec("UPDATE recurring_rules SET frequency = 'bogus'")
    await expect(materialize(client)).rejects.toThrow('Unsupported recurring frequency: bogus')
    expect(state().count).toBe(0)
    expect(
      holder.db.prepare("SELECT frequency FROM recurring_rules WHERE id = 'r1'").get()
    ).toEqual({ frequency: 'bogus' })
  })

  it('rolls back the whole due set when a later rule has an invalid explicit anchor', async () => {
    holder.db
      .exec(`INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, account_id, active, anchor_kind, anchor_day)
      VALUES ('r2', 'Invalid anchor', 100, 'USD', 'expense', 'monthly', '2026-11-08', 'a', 1, 'fixed_day', 8.5);`)
    const beforeRevision = holder.db.prepare('SELECT * FROM app_data_state').all()
    const beforeRules = holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all()
    await expect(materialize(client)).rejects.toThrow(
      'day-of-month recurrence anchor must be an integer from 1 through 31'
    )
    expect(state()).toEqual({
      count: 0,
      balance: 1000,
      rules: [
        { id: 'r1', next_date: '2026-11-08', active: 1 },
        { id: 'r2', next_date: '2026-11-08', active: 1 },
      ],
    })
    expect(holder.db.prepare('SELECT * FROM app_data_state').all()).toEqual(beforeRevision)
    expect(holder.db.prepare('SELECT * FROM recurring_rules ORDER BY id').all()).toEqual(
      beforeRules
    )
  })
})
