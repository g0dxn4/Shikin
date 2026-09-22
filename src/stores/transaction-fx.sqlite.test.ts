// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from '../../cli/src/backend-foundation-test-schema'

const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db!.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql).run(...params).changes,
    lastInsertId: 0,
  })
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      state.db!.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn({ query, execute })
        state.db!.exec('COMMIT')
        return result
      } catch (error) {
        state.db!.exec('ROLLBACK')
        throw error
      }
    },
  }
})
vi.mock('./account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: async () => {} }) },
}))
vi.mock('@/lib/auto-categorize', () => ({ learnFromTransaction: async () => {} }))

import { previewTransactionFxInput } from '@/lib/transaction-fx'
import { useTransactionStore } from './transaction-store'

function snapshot() {
  return {
    accounts: state.db!.prepare('SELECT id,balance FROM accounts ORDER BY id').all(),
    transactions: state.db!.prepare('SELECT * FROM transactions ORDER BY id').all(),
    evidence: state.db!.prepare('SELECT * FROM transaction_fx_evidence ORDER BY id').all(),
    audit: state.db!.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  }
}

const formData = {
  amount: 10,
  inputCurrency: 'EUR',
  type: 'expense' as const,
  description: 'Async foreign input',
  categoryId: null,
  accountId: 'main-mxn',
  transferToAccountId: null,
  currency: 'MXN',
  date: '2026-09-14',
  notes: null,
}

beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db!.exec(
    `INSERT INTO accounts (id,name,type,currency,balance) VALUES
       ('main-mxn','Main MXN','checking','MXN',0),
       ('reserve-mxn','Reserve MXN','checking','MXN',0);
     INSERT INTO settings (key,value) VALUES ('main_currency','MXN');
     INSERT INTO manual_exchange_rates
       (id,from_currency,to_currency,rate_decimal,effective_from,supersedes_rate_id,created_at,source_note)
     VALUES ('eur-mxn-17','EUR','MXN','17','2026-09-01',NULL,'2026-09-01T00:00:00Z',NULL);`
  )
})
afterEach(() => state.db?.close())

describe('frontend async transaction FX adapter on real SQLite', () => {
  it('matches the synchronous acceptance contract and writes one account effect plus immutable evidence', async () => {
    const preview = await previewTransactionFxInput({
      inputAmountCentavos: 1000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    expect(preview).toMatchObject({
      accountAmountCentavos: 17000,
      accountBalanceDeltaCentavos: -17000,
      conversion: { rateId: 'eur-mxn-17', rateDecimal: '17' },
    })

    await useTransactionStore
      .getState()
      .add({ ...formData, fxAcceptanceGuard: preview.acceptanceGuard }, { skipRefresh: true })
    expect(state.db!.prepare("SELECT balance FROM accounts WHERE id='main-mxn'").get()).toEqual({
      balance: -17000,
    })
    expect(state.db!.prepare('SELECT amount,currency FROM transactions').get()).toEqual({
      amount: 17000,
      currency: 'MXN',
    })
    expect(
      state
        .db!.prepare(
          'SELECT input_amount_centavos,input_currency,account_amount_centavos,account_currency,account_balance_delta_centavos,rate_id FROM transaction_fx_evidence'
        )
        .get()
    ).toEqual({
      input_amount_centavos: 1000,
      input_currency: 'EUR',
      account_amount_centavos: 17000,
      account_currency: 'MXN',
      account_balance_delta_centavos: -17000,
      rate_id: 'eur-mxn-17',
    })
    expect(
      state
        .db!.prepare(
          `SELECT
             json_extract(before_json,'$') AS before_snapshot,
             json_extract(after_json,'$.balances[0].balanceCentavos') AS after_balance,
             json_extract(after_json,'$.balanceChanges[0].deltaCentavos') AS delta
           FROM audit_log WHERE action='create'`
        )
        .get()
    ).toEqual({ before_snapshot: null, after_balance: -17000, delta: -17000 })
  })

  it('records the actual before and after balances for an FX amount update', async () => {
    const createPreview = await previewTransactionFxInput({
      inputAmountCentavos: 1000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    await useTransactionStore
      .getState()
      .add({ ...formData, fxAcceptanceGuard: createPreview.acceptanceGuard }, { skipRefresh: true })

    const transaction = state.db!.prepare('SELECT id FROM transactions LIMIT 1').get() as {
      id: string
    }
    const updatePreview = await previewTransactionFxInput({
      inputAmountCentavos: 2000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    await useTransactionStore.getState().update(transaction.id, {
      ...formData,
      amount: 20,
      fxFinancialEdit: true,
      fxAcceptanceGuard: updatePreview.acceptanceGuard,
    })

    expect(state.db!.prepare("SELECT balance FROM accounts WHERE id='main-mxn'").get()).toEqual({
      balance: -34000,
    })
    expect(
      state.db!.prepare('SELECT amount FROM transactions WHERE id = ?').get(transaction.id)
    ).toEqual({
      amount: 34000,
    })
    expect(
      state
        .db!.prepare(
          `SELECT
             json_extract(before_json,'$.balances[0].balanceCentavos') AS before_balance,
             json_extract(after_json,'$.balances[0].balanceCentavos') AS after_balance,
             json_extract(after_json,'$.balanceChanges[0].deltaCentavos') AS delta,
             json_extract(after_json,'$.fxEvidence.accountBalanceDeltaCentavos') AS acceptance_contribution
           FROM audit_log WHERE action='update'`
        )
        .get()
    ).toEqual({
      before_balance: -17000,
      after_balance: -34000,
      delta: -17000,
      acceptance_contribution: -34000,
    })

    await useTransactionStore.getState().remove(transaction.id)
    expect(state.db!.prepare("SELECT balance FROM accounts WHERE id='main-mxn'").get()).toEqual({
      balance: 0,
    })
    expect(
      state
        .db!.prepare(
          `SELECT
             json_extract(before_json,'$.balances[0].balanceCentavos') AS before_balance,
             json_extract(after_json,'$') AS after_snapshot
           FROM audit_log WHERE action='delete'`
        )
        .get()
    ).toEqual({ before_balance: -34000, after_snapshot: null })
  })

  it('records both account balances when an FX transaction moves accounts', async () => {
    const createPreview = await previewTransactionFxInput({
      inputAmountCentavos: 1000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    await useTransactionStore
      .getState()
      .add({ ...formData, fxAcceptanceGuard: createPreview.acceptanceGuard }, { skipRefresh: true })
    const transaction = state.db!.prepare('SELECT id FROM transactions LIMIT 1').get() as {
      id: string
    }
    const movePreview = await previewTransactionFxInput({
      inputAmountCentavos: 2000,
      inputCurrency: 'EUR',
      accountId: 'reserve-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })

    await useTransactionStore.getState().update(transaction.id, {
      ...formData,
      amount: 20,
      accountId: 'reserve-mxn',
      fxFinancialEdit: true,
      fxAcceptanceGuard: movePreview.acceptanceGuard,
    })

    expect(state.db!.prepare('SELECT id,balance FROM accounts ORDER BY id').all()).toEqual([
      { id: 'main-mxn', balance: 0 },
      { id: 'reserve-mxn', balance: -34000 },
    ])
    const audit = state
      .db!.prepare("SELECT before_json,after_json FROM audit_log WHERE action='update'")
      .get() as { before_json: string; after_json: string }
    expect(JSON.parse(audit.before_json).balances).toEqual([
      { accountId: 'main-mxn', balanceCentavos: -17000 },
      { accountId: 'reserve-mxn', balanceCentavos: 0 },
    ])
    expect(JSON.parse(audit.after_json).balances).toEqual([
      { accountId: 'main-mxn', balanceCentavos: 0 },
      { accountId: 'reserve-mxn', balanceCentavos: -34000 },
    ])
  })

  it('rejects a stale preview and rolls back transaction, evidence, audit, and balance together', async () => {
    const preview = await previewTransactionFxInput({
      inputAmountCentavos: 1000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    state.db!.exec(
      `INSERT INTO manual_exchange_rates
       (id,from_currency,to_currency,rate_decimal,effective_from,supersedes_rate_id,created_at,source_note)
       VALUES ('eur-mxn-18','EUR','MXN','18','2026-09-10',NULL,'2026-09-10T00:00:00Z',NULL)`
    )
    const before = snapshot()
    await expect(
      useTransactionStore
        .getState()
        .add({ ...formData, fxAcceptanceGuard: preview.acceptanceGuard }, { skipRefresh: true })
    ).rejects.toThrow(/stale/)
    expect(snapshot()).toEqual(before)
  })

  it('rolls back the ledger mutation when immutable evidence insertion fails', async () => {
    const preview = await previewTransactionFxInput({
      inputAmountCentavos: 1000,
      inputCurrency: 'EUR',
      accountId: 'main-mxn',
      transactionDate: '2026-09-14',
      transactionType: 'expense',
    })
    state.db!.exec(
      `CREATE TRIGGER reject_fx_evidence BEFORE INSERT ON transaction_fx_evidence
       BEGIN SELECT RAISE(ABORT, 'synthetic evidence failure'); END`
    )
    const before = snapshot()
    await expect(
      useTransactionStore
        .getState()
        .add({ ...formData, fxAcceptanceGuard: preview.acceptanceGuard }, { skipRefresh: true })
    ).rejects.toThrow('synthetic evidence failure')
    expect(snapshot()).toEqual(before)
  })
})
