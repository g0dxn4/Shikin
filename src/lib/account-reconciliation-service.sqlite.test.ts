// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../../cli/src/backend-foundation-test-schema'
import type { TransactionClient } from '@/lib/database'

const holder = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
  failSql: '',
  id: 0,
  accountRefresh: vi.fn(async () => {}),
  transactionRefresh: vi.fn(async () => {}),
}))

vi.mock('@/lib/database', () => {
  const query = async <Row>(sql: string, bindValues: unknown[] = []) =>
    holder.db.prepare(sql).all(...bindValues) as Row[]
  const execute = async (sql: string, bindValues: unknown[] = []) => {
    if (holder.failSql && sql.includes(holder.failSql)) throw new Error('Injected failure')
    const result = holder.db.prepare(sql).run(...bindValues)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  }
  return {
    query,
    withTransaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
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
vi.mock('@/lib/ulid', () => ({ generateId: () => `maintenance-${++holder.id}` }))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: holder.accountRefresh }) },
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: holder.transactionRefresh }) },
}))

import {
  finalizeAccountStatementHistory,
  previewAccountBridgeSupersession,
  previewAccountStatementFinalization,
  readAccountMaintenance,
  setAccountSourceCoverage,
  settleAccountStagedTransactions,
  supersedeAccountReconciliationBridge,
} from './account-reconciliation-service'

function rows(table: string): Record<string, unknown>[] {
  return holder.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<
    string,
    unknown
  >[]
}

function snapshot() {
  const tables = holder.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(tables.map(({ name }) => [name, rows(name)]))
}

function transaction(
  id: string,
  amount: number,
  options: {
    account?: string
    type?: 'income' | 'expense'
    status?: 'pending' | 'posted' | 'cleared'
    batch?: string
    date?: string
  } = {}
) {
  holder.db
    .prepare(
      `INSERT INTO transactions (
         id, account_id, type, amount, currency, description, date, status,
         ledger_treatment, reporting_treatment, transaction_kind, staging_batch_id,
         import_source, import_external_id, source, note, is_archived
       ) VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, 'staged_no_balance_impact', 'normal',
         'standard', ?, 'Bank', ?, 'original-source', 'original-note', 0)`
    )
    .run(
      id,
      options.account ?? 'a',
      options.type ?? 'income',
      amount,
      id,
      options.date ?? '2025-01-15',
      options.status ?? 'posted',
      options.batch ?? 'batch',
      `external-${id}`
    )
}

async function coverage(status: 'verified' | 'provisional' | 'gap' = 'verified') {
  return (
    await setAccountSourceCoverage({
      accountId: 'a',
      sourceNamespace: 'Bank',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      status,
      documentRef: 'synthetic statement',
    })
  ).coverage.id
}

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(
    `INSERT INTO accounts (id, name, type, currency, balance, account_mode, valuation_mode)
     VALUES ('a', 'Synthetic', 'checking', 'USD', 0, 'transactional', 'cash_plus_holdings'),
            ('b', 'Other', 'checking', 'USD', 0, 'transactional', 'cash_plus_holdings')`
  )
  holder.failSql = ''
  holder.id = 0
  holder.accountRefresh.mockClear()
  holder.transactionRefresh.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  holder.db.close()
})

describe('native/browser account reconciliation service on real schema 021 SQLite', () => {
  it('uses the local calendar day at the UTC/local midnight boundary', async () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-02-01T00:30:00.000Z'))
    try {
      transaction('future-locally', 100, { date: '2025-02-01' })
      const coverageId = (
        await setAccountSourceCoverage({
          accountId: 'a',
          sourceNamespace: 'Bank',
          periodStart: '2025-02-01',
          periodEnd: '2025-02-01',
          status: 'verified',
          documentRef: 'synthetic statement',
        })
      ).coverage.id
      await expect(
        previewAccountStatementFinalization({
          accountId: 'a',
          transactionIds: ['future-locally'],
          coverageIds: [coverageId],
          statementStartDate: '2025-02-01',
          statementEndDate: '2025-02-01',
          actualBalanceCentavos: 100,
        })
      ).rejects.toThrow('future')
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('reports a committed mutation when one post-commit store refresh rejects', async () => {
    holder.transactionRefresh.mockRejectedValueOnce(new Error('refresh failed'))
    const result = await setAccountSourceCoverage({
      accountId: 'a',
      sourceNamespace: 'Bank',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      status: 'verified',
      documentRef: 'synthetic statement',
    })
    expect(result.refreshIncomplete).toBe(true)
    expect(rows('source_coverage')).toHaveLength(1)
    expect(holder.accountRefresh).toHaveBeenCalledTimes(1)
    expect(holder.transactionRefresh).toHaveBeenCalledTimes(1)
  })

  it('finalizes exact multi-batch rows, preserves source evidence, and settles pending separately', async () => {
    transaction('first', 400)
    transaction('second', 600, { batch: 'other-batch' })
    transaction('hold', 100, { status: 'pending' })
    const coverageId = await coverage()
    const input = {
      accountId: 'a',
      transactionIds: ['second', 'first'],
      coverageIds: [coverageId],
      statementStartDate: '2025-01-01',
      statementEndDate: '2025-01-31',
      actualBalanceCentavos: 1_000,
    }
    const preview = await previewAccountStatementFinalization(input)
    expect(preview).toMatchObject({
      transactionIds: ['first', 'second'],
      stagedBalanceEffect: 1_000,
      adjustment: 0,
    })
    const result = await finalizeAccountStatementHistory({
      ...input,
      previewToken: preview.previewToken,
    })
    expect(result.adjustmentTransactionId).toBeNull()
    expect(rows('account_balance_history')).toEqual([])
    expect(rows('accounts').find((row) => row.id === 'a')?.balance).toBe(1_000)
    for (const id of ['first', 'second'])
      expect(rows('transactions').find((row) => row.id === id)).toMatchObject({
        ledger_treatment: 'normal',
        finalization_id: result.reconciliationId,
        reconciliation_id: null,
        import_source: 'Bank',
        import_external_id: `external-${id}`,
        source: 'original-source',
        note: 'original-note',
      })
    expect(rows('transactions').find((row) => row.id === 'hold')).toMatchObject({
      status: 'pending',
      ledger_treatment: 'staged_no_balance_impact',
      finalization_id: null,
    })

    await settleAccountStagedTransactions({
      accountId: 'a',
      transactionIds: ['hold'],
      status: 'cleared',
    })
    expect(rows('transactions').find((row) => row.id === 'hold')).toMatchObject({
      status: 'cleared',
      ledger_treatment: 'staged_no_balance_impact',
    })
    expect(holder.accountRefresh).toHaveBeenCalled()
    expect(holder.transactionRefresh).toHaveBeenCalled()
  })

  it('rejects pending, gap, zero-row, provisional, cross-account, and boundary evidence without writes', async () => {
    transaction('posted', 100)
    transaction('pending', 100, { status: 'pending' })
    transaction('other', 100, { account: 'b' })
    transaction('late', 100, { date: '2025-02-01' })
    const verified = await coverage()
    const base = {
      accountId: 'a',
      coverageIds: [verified],
      statementStartDate: '2025-01-01',
      statementEndDate: '2025-01-31',
      actualBalanceCentavos: 100,
    }
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['pending'] })
    ).rejects.toThrow('posted/cleared')
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['other'] })
    ).rejects.toThrow('account scope')
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['late'] })
    ).rejects.toThrow('statement period')
    holder.db.prepare('UPDATE source_coverage SET zero_rows = 1 WHERE id = ?').run(verified)
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['posted'] })
    ).rejects.toThrow('coverage')
    holder.db
      .prepare("UPDATE source_coverage SET zero_rows = 0, status = 'gap' WHERE id = ?")
      .run(verified)
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['posted'] })
    ).rejects.toThrow('gap')
    holder.db
      .prepare("UPDATE source_coverage SET status = 'provisional' WHERE id = ?")
      .run(verified)
    const before = snapshot()
    await expect(
      previewAccountStatementFinalization({ ...base, transactionIds: ['posted'] })
    ).rejects.toThrow('acknowledgeProvisional')
    expect(snapshot()).toEqual(before)
  })

  it('rolls back activation, audit, and revision when a later write fails', async () => {
    transaction('posted', 100)
    const coverageId = await coverage()
    const input = {
      accountId: 'a',
      transactionIds: ['posted'],
      coverageIds: [coverageId],
      statementStartDate: '2025-01-01',
      statementEndDate: '2025-01-31',
      actualBalanceCentavos: 100,
    }
    const preview = await previewAccountStatementFinalization(input)
    const before = snapshot()
    holder.failSql = 'INSERT INTO audit_log'
    await expect(
      finalizeAccountStatementHistory({ ...input, previewToken: preview.previewToken })
    ).rejects.toThrow('Injected failure')
    expect(snapshot()).toEqual(before)
  })

  it.each([
    [400, 'income', 600],
    [1_500, 'income', -500],
    [1_000, 'income', 0],
    [300, 'expense', 1_300],
  ] as const)(
    'supersedes immutable bridge evidence with residual %s/%s/%s and preserves anchors/current values',
    async (amount, type, residual) => {
      holder.db.exec(
        `BEGIN;
         PRAGMA defer_foreign_keys = ON;
         UPDATE accounts SET balance = 777 WHERE id = 'a';
         INSERT INTO account_reconciliations (
           id, account_id, reconciliation_date, actual_balance, stored_balance_before,
           ledger_balance_before, ledger_balance_after, adjustment_amount,
           adjustment_transaction_id, selection_mode
         ) VALUES ('original', 'a', '2025-01-31', 1000, 0, 0, 1000, 1000, 'bridge', 'explicit_rows');
         INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date, status,
           ledger_treatment, reporting_treatment, transaction_kind, reconciliation_id, is_archived
         ) VALUES ('bridge', 'a', 'income', 1000, 'USD', 'Original bridge', '2025-01-31',
           'posted', 'normal', 'exclude_from_cashflow', 'reconciliation_bridge', 'original', 0);
         INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date, status,
           ledger_treatment, reporting_treatment, transaction_kind, is_archived
         ) VALUES ('later', 'a', 'expense', 200, 'USD', 'Later activity', '2025-02-01',
           'posted', 'normal', 'normal', 'standard', 0);
         INSERT INTO account_reconciliations (
           id, account_id, reconciliation_date, actual_balance, stored_balance_before,
           ledger_balance_before, ledger_balance_after, adjustment_amount, selection_mode
         ) VALUES ('later-anchor', 'a', '2025-02-28', 888, 777, 800, 800, 0, 'explicit_rows');
         COMMIT;`
      )
      transaction('replacement', amount, { type })
      const coverageId = await coverage()
      const input = {
        accountId: 'a',
        reconciliationId: 'original',
        bridgeId: 'bridge',
        transactionIds: ['replacement'],
        coverageIds: [coverageId],
      }
      const preview = await previewAccountBridgeSupersession(input)
      expect(preview.successorSignedBridge).toBe(residual)
      const originalBridge = rows('transactions').find((row) => row.id === 'bridge')!
      const accountsBefore = rows('accounts')
      const historyBefore = rows('account_balance_history')
      const applied = await supersedeAccountReconciliationBridge({
        ...input,
        previewToken: preview.previewToken,
      })
      expect(rows('transactions').find((row) => row.id === 'bridge')).toEqual({
        ...originalBridge,
        is_archived: 1,
      })
      expect(rows('accounts')).toEqual(accountsBefore)
      expect(rows('account_balance_history')).toEqual(historyBefore)
      expect(applied.currentStoredAfter).toBe(777)
      expect(applied.currentEffectiveAfter).toBe(800)
      expect(applied.laterAnchorsAfter).toEqual(preview.laterAnchors)
      if (residual === 0) expect(applied.successorBridgeId).toBeNull()
      else
        expect(
          rows('transactions').find((row) => row.id === applied.successorBridgeId)
        ).toMatchObject({
          amount: Math.abs(residual),
          type: residual > 0 ? 'income' : 'expense',
        })
      expect(rows('transactions').find((row) => row.id === 'replacement')).toMatchObject({
        finalization_id: applied.successorReconciliationId,
        reconciliation_id: null,
        source: 'original-source',
        note: 'original-note',
      })
    }
  )

  it('rejects a stale supersession token and reports history without mutating it', async () => {
    holder.db.exec(
      `BEGIN;
       PRAGMA defer_foreign_keys = ON;
       UPDATE accounts SET balance = 1000 WHERE id = 'a';
       INSERT INTO account_reconciliations (
         id, account_id, reconciliation_date, actual_balance, stored_balance_before,
         ledger_balance_before, ledger_balance_after, adjustment_amount,
         adjustment_transaction_id, selection_mode
       ) VALUES ('original', 'a', '2025-01-31', 1000, 0, 0, 1000, 1000, 'bridge', 'explicit_rows');
       INSERT INTO transactions (
         id, account_id, type, amount, currency, description, date, status,
         ledger_treatment, reporting_treatment, transaction_kind, reconciliation_id, is_archived
       ) VALUES ('bridge', 'a', 'income', 1000, 'USD', 'Original bridge', '2025-01-31',
         'posted', 'normal', 'exclude_from_cashflow', 'reconciliation_bridge', 'original', 0);
       COMMIT;`
    )
    transaction('replacement', 400)
    const input = {
      accountId: 'a',
      reconciliationId: 'original',
      bridgeId: 'bridge',
      transactionIds: ['replacement'],
      coverageIds: [await coverage()],
    }
    const preview = await previewAccountBridgeSupersession(input)
    holder.db.prepare("UPDATE accounts SET name = 'revision change' WHERE id = 'b'").run()
    const before = snapshot()
    await expect(
      supersedeAccountReconciliationBridge({ ...input, previewToken: preview.previewToken })
    ).rejects.toThrow('stale')
    expect(snapshot()).toEqual(before)
    const history = await readAccountMaintenance('a')
    expect(history.observations).toHaveLength(1)
    expect(history.transactions.some((row) => row.id === 'replacement')).toBe(true)
  })
})
