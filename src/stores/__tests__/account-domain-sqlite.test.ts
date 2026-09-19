// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'
const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database, fail: '' }))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => holder.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => {
    if (holder.fail && sql.includes(holder.fail)) throw new Error('Injected native failure')
    return { rowsAffected: holder.db.prepare(sql).run(...params).changes }
  }
  return {
    query,
    execute,
    withTransaction: async (
      fn: (tx: { query: typeof query; execute: typeof execute }) => Promise<unknown>
    ) => {
      holder.db.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        holder.db.exec('COMMIT')
        return result
      } catch (error) {
        holder.db.exec('ROLLBACK')
        throw error
      }
    },
  }
})
import { useAccountStore } from '../account-store'
const store = () => useAccountStore.getState()
const rows = (table: string) =>
  holder.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
const history = () =>
  Object.fromEntries(
    [
      'accounts',
      'transactions',
      'account_reconciliations',
      'account_balance_history',
      'audit_log',
      'app_data_state',
    ].map((t) => [t, rows(t)])
  )
const data = { name: 'Synthetic', type: 'checking' as const, currency: 'USD' }
beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.fail = ''
  useAccountStore.setState({
    accounts: [],
    archivedAccounts: [],
    error: null,
    lastReconciliation: null,
  })
})
afterEach(() => holder.db.close())
describe('native account domain real SQLite parity', () => {
  it('requires explicit portfolio choice and audits ownership without balance/history writes', async () => {
    const before = history()
    await expect(store().add({ ...data, type: 'investment', balance: 0 })).rejects.toThrow(
      'explicit valuationMode'
    )
    expect(history()).toEqual(before)
    await store().add({
      ...data,
      type: 'investment',
      valuationMode: 'portfolio_snapshot',
      balance: 12,
    })
    const account = rows('accounts')[0]!,
      transactions = rows('transactions'),
      observations = rows('account_reconciliations')
    await store().update(account.id as string, {
      ...data,
      type: 'investment',
      valuationMode: 'cash_plus_holdings',
    })
    expect(rows('accounts')[0]).toMatchObject({
      balance: 1200,
      valuation_mode: 'cash_plus_holdings',
    })
    expect(rows('transactions')).toEqual(transactions)
    expect(rows('account_reconciliations')).toEqual(observations)
    expect(rows('audit_log')[rows('audit_log').length - 1]?.action).toBe('update')
    expect(store().lastReconciliation).toBeNull()
  })
  it('distinguishes omission, clear and value for nullable fields, including zero credit limit', async () => {
    await store().add({
      ...data,
      type: 'credit_card',
      balance: 0,
      creditLimit: 0,
      statementClosingDay: 7,
      paymentDueDay: 20,
      icon: 'wallet',
      color: 'blue',
    })
    const id = rows('accounts')[0]!.id as string
    await store().update(id, { ...data, type: 'credit_card' })
    expect(rows('accounts')[0]).toMatchObject({
      credit_limit: 0,
      statement_closing_day: 7,
      payment_due_day: 20,
      icon: 'wallet',
      color: 'blue',
    })
    const before = history()
    await expect(store().update(id, { ...data, clearIcon: true, icon: null })).rejects.toThrow(
      'conflicts'
    )
    expect(history()).toEqual(before)
    await store().update(id, {
      ...data,
      creditLimit: null,
      clearStatementClosingDay: true,
      paymentDueDay: null,
      icon: null,
      clearColor: true,
    })
    expect(rows('accounts')[0]).toMatchObject({
      credit_limit: null,
      statement_closing_day: null,
      payment_due_day: null,
      icon: null,
      color: null,
    })
  })
  it('reconciles as of a date, retains later activity, discloses discrepancy, protects later anchors and rolls back failures', async () => {
    await store().add({ ...data, balance: 0 })
    const id = rows('accounts')[0]!.id as string
    holder.db
      .prepare(
        "INSERT INTO transactions (id, account_id, type, amount, currency, date, description) VALUES ('early', ?, 'income', 1000, 'USD', '2025-01-01', 'early'), ('later', ?, 'expense', 200, 'USD', '2025-02-01', 'later')"
      )
      .run(id, id)
    holder.db.prepare('UPDATE accounts SET balance = 777 WHERE id = ?').run(id)
    await store().update(id, { ...data, balance: 12, observedDate: '2025-01-31' })
    expect(rows('accounts')[0]?.balance).toBe(1000)
    expect(store().lastReconciliation).toMatchObject({
      asOfLedger: 1000,
      currentLedger: 800,
      adjustment: 200,
      currentBalanceAfter: 1000,
      storedVsLedgerDiscrepancy: -23,
      laterActivityRetained: -200,
    })
    await store().update(id, { ...data, balance: 10, observedDate: '2025-02-28' })
    const before = history()
    await expect(
      store().update(id, {
        ...data,
        name: 'Must rollback',
        balance: 13,
        observedDate: '2025-01-31',
      })
    ).rejects.toThrow('later anchor')
    expect(history()).toEqual(before)
    holder.fail = 'UPDATE account_reconciliations SET adjustment_transaction_id'
    await expect(
      store().update(id, { ...data, balance: 20, observedDate: '2025-03-31' })
    ).rejects.toThrow('Injected native failure')
    expect(history()).toEqual(before)
    expect(store().lastReconciliation).toBeNull()
  })
})

it('native reconciliation uses archived matched-leg dates and rejects corrupt pair evidence atomically', async () => {
  await store().add({ ...data, name: 'Source', balance: 0 })
  await store().add({ ...data, name: 'Destination', balance: 0 })
  const source = rows('accounts')[0]!.id as string,
    dest = rows('accounts')[1]!.id as string
  holder.db
    .prepare(
      `INSERT INTO transactions (id, account_id, type, amount, currency, date, description, transfer_to_account_id, matched_transaction_id, reporting_treatment)
    VALUES ('pair-source', ?, 'transfer', 1000, 'USD', '2025-01-30', 'original expense', ?, NULL, 'exclude_from_cashflow')`
    )
    .run(source, dest)
  holder.db
    .prepare(
      `INSERT INTO transactions (id, account_id, type, amount, currency, date, description, matched_transaction_id, transaction_kind, is_archived, reporting_treatment)
    VALUES ('pair-mirror', ?, 'income', 1000, 'USD', '2025-02-02', 'original income', 'pair-source', 'archived_transfer_mirror', 1, 'exclude_from_cashflow')`
    )
    .run(dest)
  holder.db.exec(
    "UPDATE transactions SET matched_transaction_id='pair-mirror' WHERE id='pair-source'"
  )
  const originals = rows('transactions')
  const result = await store().update(dest, {
    ...data,
    name: 'Destination',
    balance: 0,
    observedDate: '2025-01-31',
  })
  expect(result).toMatchObject({
    asOfLedger: 0,
    currentLedger: 1000,
    adjustment: 0,
    currentBalanceAfter: 1000,
    laterActivityRetained: 1000,
  })
  expect(rows('transactions')).toEqual(originals)
  holder.db.exec("UPDATE transactions SET amount=999 WHERE id='pair-mirror'")
  const before = history()
  await expect(
    store().update(dest, { ...data, balance: 0, observedDate: '2025-01-31' })
  ).rejects.toThrow('Broken or ambiguous')
  expect(history()).toEqual(before)
})
