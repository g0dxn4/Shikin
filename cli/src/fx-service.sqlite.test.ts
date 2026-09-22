// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertCentavosAsOf, type SetExchangeRateInput } from '@shikin/finance-core/fx'
import { runHostedTestMigrations } from './backend-foundation-test-schema'

let db: Database.Database
const query = <T>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...params) as T[]
const execute = (sql: string, params: unknown[] = []) => {
  const result = db.prepare(sql.replace(/\$\d+/g, '?')).run(...params)
  return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
}
async function service(mode: 'sync' | 'async') {
  vi.resetModules()
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  runHostedTestMigrations(db)
  vi.doMock('./database.js', () => ({
    query,
    execute,
    transaction: <T>(fn: () => T) => db.transaction(fn).immediate(),
  }))
  vi.doMock('@/lib/database', () => ({
    query: async <T>(sql: string, params?: unknown[]) => query<T>(sql, params),
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({
          query: async <T>(sql: string, params?: unknown[]) => query<T>(sql, params),
          execute: async (sql: string, params?: unknown[]) => execute(sql, params),
        })
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }))
  return mode === 'sync'
    ? import('./fx-service')
    : import(/* @vite-ignore */ ['../../src', 'lib/fx-service'].join('/'))
}
afterEach(() => {
  db?.close()
  vi.doUnmock('./database.js')
  vi.doUnmock('@/lib/database')
  vi.resetModules()
})
const input = (overrides: Partial<SetExchangeRateInput> = {}): SetExchangeRateInput => ({
  fromCurrency: 'USD',
  toCurrency: 'MXN',
  rateDecimal: '17',
  effectiveFrom: '2025-09-14',
  today: '2025-09-14',
  ...overrides,
})
const state = () => query('SELECT * FROM app_data_state')
const financial = () =>
  Object.fromEntries(
    [
      'accounts',
      'transactions',
      'budgets',
      'goals',
      'exchange_rates',
      'transaction_fx_evidence',
    ].map((table) => [table, query(`SELECT * FROM ${table}`)])
  )

describe.each(['sync', 'async'] as const)('%s FX service on real SQLite', (mode) => {
  it('explicitly configures missing main, appends/corrects manual history, audits and never rewrites protected money', async () => {
    const api = await service(mode)
    db.exec(`INSERT INTO accounts(id, name, type, balance) VALUES ('a', 'Cash', 'checking', 12345);
      INSERT INTO transactions(id, account_id, type, amount, description, date) VALUES ('t', 'a', 'expense', 50, 'Native', '2025-09-14');
      INSERT INTO budgets(id, name, amount, period) VALUES ('b', 'Budget', 10000, 'monthly');
      INSERT INTO goals(id, name, target_amount) VALUES ('g', 'Goal', 20000);
      INSERT INTO exchange_rates(id, from_currency, to_currency, rate, date) VALUES ('provider', 'USD', 'MXN', 999, '2025-09-01')`)
    const before = financial()
    const beforeRead = state()
    expect(await api.getCurrencySettings()).toEqual({ configured: false, mainCurrency: null })
    expect(await api.listExchangeRates()).toEqual([])
    expect(state()).toEqual(beforeRead)
    expect(await api.setMainCurrency('MXN')).toEqual({ configured: true, mainCurrency: 'MXN' })
    const first = await api.setExchangeRate(input())
    await api.setExchangeRate(input({ effectiveFrom: '2025-09-15', rateDecimal: '18' }))
    await api.setExchangeRate(input({ effectiveFrom: '2026-01-01', rateDecimal: '19' }))
    const beforeCorrection = state()
    const corrected = await api.setExchangeRate(
      input({
        replacesRateId: first.id,
        rateDecimal: '17.000000000000000001',
        auditNote: 'Correct original decimal transcription',
        acknowledgeHistoricalChange: true,
        today: '2025-09-30',
      })
    )
    expect(corrected.rateDecimal).toBe('17.000000000000000001')
    expect(corrected.supersedesRateId).toBe(first.id)
    expect(state()).not.toEqual(beforeCorrection)
    const history = await api.listExchangeRates()
    expect(history).toHaveLength(4)
    expect(
      convertCentavosAsOf({
        amountCentavos: 10000,
        fromCurrency: 'USD',
        toCurrency: 'MXN',
        asOfDate: '2025-09-14',
        rates: history,
      })
    ).toMatchObject({ amountCentavos: 170000, rateId: corrected.id })
    await api.setMainCurrency('EUR')
    expect(financial()).toEqual(before)
    const audits = query<{ entity: string; before_json: string; after_json: string; note: string }>(
      'SELECT * FROM audit_log ORDER BY rowid'
    )
    expect(audits).toHaveLength(6)
    expect(JSON.parse(audits[4]!.before_json)).toMatchObject({ id: first.id })
    expect(JSON.parse(audits[4]!.after_json)).toMatchObject({
      id: corrected.id,
      historicalReportsRecalculate: true,
    })
    db.exec("UPDATE exchange_rates SET rate = 1 WHERE id = 'provider'")
    expect(await api.listExchangeRates()).toEqual(history)
  })
  it('rejects stale/fork/backdated/invalid writes and rolls back rate/main if audit fails', async () => {
    const api = await service(mode)
    const first = await api.setExchangeRate(input())
    await api.setExchangeRate(
      input({
        replacesRateId: first.id,
        rateDecimal: '18',
        acknowledgeHistoricalChange: true,
        auditNote: 'Fix',
      })
    )
    const before = {
      history: await api.listExchangeRates(),
      state: state(),
      audit: query('SELECT * FROM audit_log'),
    }
    for (const invalid of [
      input(),
      input({
        replacesRateId: first.id,
        rateDecimal: '19',
        acknowledgeHistoricalChange: true,
        auditNote: 'Stale',
      }),
      input({ effectiveFrom: '2025-09-13' }),
      input({ effectiveFrom: '2025-02-30' }),
      input({ fromCurrency: 'XYZ' }),
      input({ rateDecimal: '1e2' }),
    ]) {
      await expect(Promise.resolve().then(() => api.setExchangeRate(invalid))).rejects.toThrow()
    }
    await expect(Promise.resolve().then(() => api.setMainCurrency('XYZ'))).rejects.toThrow()
    expect({
      history: await api.listExchangeRates(),
      state: state(),
      audit: query('SELECT * FROM audit_log'),
    }).toEqual(before)
    db.exec(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit failure'); END"
    )
    await expect(
      Promise.resolve().then(() => api.setExchangeRate(input({ effectiveFrom: '2025-09-15' })))
    ).rejects.toThrow('audit failure')
    await expect(Promise.resolve().then(() => api.setMainCurrency('USD'))).rejects.toThrow(
      'audit failure'
    )
    expect(await api.getCurrencySettings()).toEqual({ configured: false, mainCurrency: null })
    expect(state()).toEqual(before.state)
    expect(await api.listExchangeRates()).toEqual(before.history)
  })
  it('enforces SQL history immutability, correction pair/leaf constraints and retained evidence snapshots', async () => {
    const api = await service(mode)
    const rate = await api.setExchangeRate(input())
    for (const sql of [
      "UPDATE manual_exchange_rates SET rate_decimal = '20'",
      'DELETE FROM manual_exchange_rates',
    ])
      expect(() => db.exec(sql)).toThrow(/immutable/)
    expect(() =>
      db
        .prepare(
          'INSERT INTO manual_exchange_rates (id,from_currency,to_currency,rate_decimal,effective_from,supersedes_rate_id,created_at) VALUES (?,?,?,?,?,?,?)'
        )
        .run('bad', 'EUR', 'MXN', '1', '2025-09-14', rate.id, 'now')
    ).toThrow(/pair\/date/)
    for (const bad of ['0', '1e2', '.1', '1.', '1..1'])
      expect(() =>
        db
          .prepare(
            'INSERT INTO manual_exchange_rates (id,from_currency,to_currency,rate_decimal,effective_from,created_at) VALUES (?,?,?,?,?,?)'
          )
          .run('bad', 'EUR', 'MXN', bad, '2025-09-14', 'now')
      ).toThrow()
    expect(() =>
      db.exec('INSERT OR REPLACE INTO manual_exchange_rates SELECT * FROM manual_exchange_rates')
    ).toThrow(/append-only/)
    db.exec(
      "INSERT INTO accounts(id,name,type) VALUES ('a','Cash','checking'); INSERT INTO transactions(id,account_id,type,amount,description,date) VALUES ('t','a','expense',1700,'Test','2025-09-14')"
    )
    const sql = `INSERT INTO transaction_fx_evidence (id,transaction_id,original_transaction_id,original_account_id,transaction_type,status,ledger_treatment,input_amount_centavos,input_currency,account_amount_centavos,account_currency,account_balance_delta_centavos,transaction_date,rate_id,rate_decimal,created_at) VALUES (?, 't', 't', 'a', ?, ?, ?, 100, 'USD', 1700, 'MXN', ?, '2025-09-14', ?, '17', '2025-09-14T00:00:00Z')`
    db.prepare(sql).run('expense', 'expense', 'posted', 'normal', -1700, rate.id)
    db.prepare(sql).run('income', 'income', 'cleared', 'normal', 1700, rate.id)
    db.prepare(sql).run('pending', 'expense', 'pending', 'normal', 0, rate.id)
    db.prepare(sql).run('staged', 'expense', 'posted', 'staged_no_balance_impact', 0, rate.id)
    expect(() =>
      db.prepare(sql).run('bad', 'expense', 'pending', 'normal', -1700, rate.id)
    ).toThrow()
    expect(() => db.exec('UPDATE transaction_fx_evidence SET transaction_id = NULL')).toThrow(
      /immutable/
    )
    expect(() => db.exec('UPDATE transaction_fx_evidence SET input_amount_centavos = 200')).toThrow(
      /immutable/
    )
    expect(() => db.exec('DELETE FROM transaction_fx_evidence')).toThrow(/retained/)
    expect(() =>
      db.exec(
        'INSERT OR REPLACE INTO transaction_fx_evidence SELECT * FROM transaction_fx_evidence'
      )
    ).toThrow(/append-only/)
    db.exec("DELETE FROM transactions WHERE id = 't'; DELETE FROM accounts WHERE id = 'a'")
    const evidence = query<Record<string, unknown>>('SELECT * FROM transaction_fx_evidence')
    expect(evidence).toHaveLength(4)
    expect(
      evidence.every(
        (row) =>
          row.transaction_id === null &&
          row.original_transaction_id === 't' &&
          row.original_account_id === 'a'
      )
    ).toBe(true)
    expect(evidence.map((row) => row.account_balance_delta_centavos)).toEqual([-1700, 1700, 0, 0])
    expect(() => db.exec("UPDATE transaction_fx_evidence SET original_account_id = 'new'")).toThrow(
      /immutable/
    )
  })
})
