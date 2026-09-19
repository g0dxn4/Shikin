// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database }))

vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => holder.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql).run(...params).changes,
  })
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

import { useAccountStore, type AccountFormData } from '../account-store'

const form = (overrides: Partial<AccountFormData> = {}): AccountFormData => ({
  name: 'Guarded account',
  type: 'checking',
  currency: 'USD',
  ...overrides,
})

function insertAccount(
  id: string,
  accountMode: 'transactional' | 'snapshot_only' = 'transactional'
) {
  holder.db
    .prepare(
      `INSERT INTO accounts (
         id, name, type, currency, balance, is_archived, account_mode, valuation_mode
       ) VALUES (?, 'Guarded account', 'checking', 'USD', 0, 0, ?, 'cash_plus_holdings')`
    )
    .run(id, accountMode)
}

function insertReconciliation(id: string, accountId: string) {
  holder.db
    .prepare(
      `INSERT INTO account_reconciliations (
         id, account_id, reconciliation_date, actual_balance, stored_balance_before,
         ledger_balance_before, ledger_balance_after, adjustment_amount, selection_mode
       ) VALUES (?, ?, '2026-01-31', 0, 0, 0, 0, 0, 'explicit_rows')`
    )
    .run(id, accountId)
}

function insertCoverage(id: string, accountId: string) {
  holder.db
    .prepare(
      `INSERT INTO source_coverage (
         id, account_id, source_namespace, period_start, period_end, status, zero_rows
       ) VALUES (?, ?, 'bank', '2026-01-01', '2026-01-31', 'verified', 1)`
    )
    .run(id, accountId)
}

function allTables() {
  const tables = holder.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      holder.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ])
  )
}

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  useAccountStore.setState({
    accounts: [],
    archivedAccounts: [],
    error: null,
    lastReconciliation: null,
  })
})

afterEach(() => holder.db.close())

describe('native account durable-provenance guards with real SQLite', () => {
  it.each([
    ['transactional', 'snapshot_only'],
    ['snapshot_only', 'transactional'],
  ] as const)('blocks %s to %s mode changes for reconciliation-only accounts', async (from, to) => {
    insertAccount('account', from)
    insertReconciliation('observation', 'account')
    const before = allTables()

    await expect(
      useAccountStore.getState().update('account', form({ accountMode: to }))
    ).rejects.toThrow('transactions=0, account reconciliations=1')

    expect(allTables()).toEqual(before)
  })

  it('blocks reconciliation-only currency changes and preserves every table', async () => {
    insertAccount('account')
    insertReconciliation('observation', 'account')
    const before = allTables()

    await expect(
      useAccountStore.getState().update('account', form({ currency: 'EUR' }))
    ).rejects.toThrow('account reconciliations=1')

    expect(useAccountStore.getState().error).toContain('source coverage=0')
    expect(allTables()).toEqual(before)
  })

  it('blocks coverage-only currency changes but allows same-context metadata and mode changes', async () => {
    insertAccount('account')
    insertCoverage('coverage', 'account')
    const evidenceBefore = holder.db.prepare('SELECT * FROM source_coverage').all()
    const beforeRejection = allTables()

    await expect(
      useAccountStore.getState().update('account', form({ currency: 'EUR' }))
    ).rejects.toThrow('source coverage=1')
    expect(allTables()).toEqual(beforeRejection)

    await useAccountStore
      .getState()
      .update(
        'account',
        form({ name: 'Metadata edit', accountMode: 'transactional', icon: 'bank' })
      )
    await useAccountStore
      .getState()
      .update(
        'account',
        form({ name: 'Metadata edit', accountMode: 'snapshot_only', icon: 'bank' })
      )

    expect(
      holder.db.prepare('SELECT name, currency, account_mode, icon FROM accounts').get()
    ).toEqual({
      name: 'Metadata edit',
      currency: 'USD',
      account_mode: 'snapshot_only',
      icon: 'bank',
    })
    expect(holder.db.prepare('SELECT * FROM source_coverage').all()).toEqual(evidenceBefore)
  })

  it('keeps no-evidence empty-account mode and currency changes compatible', async () => {
    insertAccount('account')

    await useAccountStore
      .getState()
      .update('account', form({ currency: 'EUR', accountMode: 'snapshot_only' }))

    expect(holder.db.prepare('SELECT currency, account_mode, balance FROM accounts').get()).toEqual(
      {
        currency: 'EUR',
        account_mode: 'snapshot_only',
        balance: 0,
      }
    )
  })
})
