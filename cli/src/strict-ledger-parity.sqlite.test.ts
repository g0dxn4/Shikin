// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
import {
  datedLedgerQuery,
  projectDatedLedger,
  type DatedLedgerRow,
} from '@shikin/finance-core/reconciliation'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database, id: 0 }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))
vi.mock('./ulid.js', () => ({ generateId: () => `strict-${++holder.id}` }))
vi.mock('@/lib/ulid', () => ({ generateId: () => `strict-${++holder.id}` }))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: async () => {} }) },
}))
vi.mock('@/lib/auto-categorize', () => ({ learnFromTransaction: async () => {} }))
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
import {
  addTransaction,
  deleteTransaction,
  updateTransaction,
  matchTransferTransactions,
} from './tools/transactions.js'
import {
  createImportedTransactionSync,
  validateImportedTransactionSync,
  type ImportedTransactionCreateInput,
} from './transaction-mutations.js'
import { undo } from './tools/undo.js'
import { creditCardsTools } from './tools/credit-cards.js'
import {
  accountReconciliationTools,
  previewTransactionalAccountBalance,
} from './tools/account-reconciliation.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest resolves it.
import { commitAccountStagedTransactions } from '@/lib/account-reconciliation-service'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest resolves it.
import { useTransactionStore } from '@/stores/transaction-store'

beforeEach(() => {
  holder.db = new Database(':memory:')
  runHostedTestMigrations(holder.db)
  holder.db.pragma('ignore_check_constraints = ON')
  holder.db.exec(
    "INSERT INTO accounts (id,name,type,currency,balance) VALUES ('a','A','checking','USD',1000),('b','B','checking','USD',0)"
  )
  // Legacy databases may contain these values despite today's status triggers.
  holder.db.exec(
    'DROP TRIGGER trg_transactions_status_insert_valid; DROP TRIGGER trg_transactions_status_update_valid'
  )
  holder.id = 0
})
afterEach(() => holder.db.close())
const state = () => ({
  rows: holder.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
  accounts: holder.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
  audit: holder.db.prepare('SELECT * FROM audit_log ORDER BY id').all(),
  revision: holder.db.prepare('SELECT * FROM app_data_state').all(),
})
function seed(patch: Record<string, unknown>) {
  holder.db
    .prepare(
      "INSERT INTO transactions (id,account_id,type,amount,currency,description,date,status) VALUES ('t','a','expense',100,'USD','Old','2026-01-01','posted')"
    )
    .run()
  for (const [key, value] of Object.entries(patch))
    holder.db.prepare(`UPDATE transactions SET ${key} = ? WHERE id = 't'`).run(value)
}
const form = {
  amount: 1,
  type: 'expense' as const,
  description: 'New',
  categoryId: null,
  accountId: 'a',
  transferToAccountId: null,
  currency: 'USD',
  date: '2026-01-02',
  notes: null,
}

it('retains the literal ad9ba06 schema-to-execute rejection of unchanged Cleared', async () => {
  seed({ status: 'Cleared' })
  const before = state()
  let executed = false
  await expect(
    (async () => {
      const parsed = updateTransaction.schema.parse({
        transactionId: 't',
        amount: 2,
        status: 'Cleared',
      })
      executed = true
      return updateTransaction.execute(parsed)
    })()
  ).rejects.toMatchObject({
    name: 'ZodError',
    issues: [
      {
        received: 'Cleared',
        code: 'invalid_enum_value',
        options: ['pending', 'posted', 'cleared'],
        path: ['status'],
        message:
          "Invalid enum value. Expected 'pending' | 'posted' | 'cleared', received 'Cleared'",
      },
    ],
  })
  expect(executed).toBe(false)
  expect(state()).toEqual(before)
})

it.each(['Cleared', ' POSTED ', ' Pending ', '\u00a0PENDING\uFEFF', '', '  ', 'bogus'])(
  'keeps public add/update status grammar strict for %j',
  async (status) => {
    seed({})
    const before = state()
    for (const tool of [addTransaction, updateTransaction]) {
      let executed = false
      await expect(
        (async () => {
          const parsed = tool.schema.parse({
            transactionId: 't',
            accountId: 'a',
            amount: 2,
            type: 'expense',
            description: 'Updated',
            status,
          })
          executed = true
          return tool.execute(parsed)
        })()
      ).rejects.toMatchObject({
        issues: [
          {
            received: status,
            code: 'invalid_enum_value',
            options: ['pending', 'posted', 'cleared'],
            path: ['status'],
          },
        ],
      })
      expect(executed).toBe(false)
      expect(state()).toEqual(before)
    }
  }
)

describe.each(['cli', 'app'] as const)('%s strict ledger parity', (client) => {
  it.each([' Pending ', '\u00a0PENDING\uFEFF', 'pending', ' POSTED ', 'Cleared', '', '  '])(
    'pins direct adapter status handling, not public schema acceptance, for %j',
    async (status) => {
      if (client === 'cli')
        expect(
          await addTransaction.execute({
            amount: 1,
            type: 'expense',
            description: 'New',
            accountId: 'a',
            date: '2026-01-02',
            status,
          })
        ).toMatchObject({ success: true })
      else await useTransactionStore.getState().add({ ...form, status }, { skipRefresh: true })
      expect(holder.db.prepare("SELECT balance FROM accounts WHERE id = 'a'").get()).toEqual({
        balance: status.trim().toLowerCase() === 'pending' ? 1000 : 900,
      })
    }
  )
  it.each([
    ['padded pending', { status: ' Pending ' }],
    ['unknown status', { status: 'bogus' }],
    ['unknown treatment', { ledger_treatment: 'normal ' }],
    ['unknown archive', { is_archived: 2 }],
    ['negative', { amount: -100 }],
    ['fractional', { amount: 0.5 }],
    ['unsafe', { amount: 9007199254740992 }],
    ['self transfer', { type: 'transfer', transfer_to_account_id: 'a' }],
    ['pending missing destination', { type: 'transfer', status: 'pending' }],
    ['pending invalid treatment', { status: 'pending', ledger_treatment: 'bad' }],
    ['pending negative', { status: 'pending', amount: -100 }],
    ['currency mismatch', { currency: 'EUR' }],
    ['malformed currency', { currency: 'US-D' }],
  ])('pins deletion of existing %s', async (_name, patch) => {
    seed(patch as Record<string, unknown>)
    const before = state()
    if (client === 'cli')
      expect(await deleteTransaction.execute({ transactionId: 't' })).toMatchObject({
        success: false,
        message: expect.stringContaining('audited financial correction'),
      })
    else
      await expect(useTransactionStore.getState().remove('t')).rejects.toThrow(
        'audited financial correction'
      )
    expect(state()).toEqual(before)
    if (client === 'cli')
      expect(await updateTransaction.execute({ transactionId: 't', amount: 2 })).toMatchObject({
        success: false,
      })
    else
      await expect(
        useTransactionStore.getState().update('t', { ...form, amount: 2 }, { skipRefresh: true })
      ).rejects.toThrow()
    expect(state()).toEqual(before)
  })
  it.each([' POSTED ', 'Cleared'])(
    'preserves an omitted historical status %j during financial replacement',
    async (status) => {
      seed({ status })
      if (client === 'cli')
        expect(await updateTransaction.execute({ transactionId: 't', amount: 2 })).toMatchObject({
          success: true,
        })
      else
        await useTransactionStore
          .getState()
          .update('t', { ...form, amount: 2 }, { skipRefresh: true })
      expect(
        holder.db.prepare("SELECT status,amount FROM transactions WHERE id='t'").get()
      ).toEqual({ status, amount: 200 })
    }
  )
  it.each(['Cleared', ' POSTED '])(
    'preserves inherited status bytes %j on an account move',
    async (status) => {
      seed({ status })
      if (client === 'cli')
        expect(
          await updateTransaction.execute({ transactionId: 't', accountId: 'b' })
        ).toMatchObject({ success: true })
      else await useTransactionStore.getState().updateReviewFields('t', { accountId: 'b' })
      expect(
        holder.db.prepare("SELECT account_id,status,amount FROM transactions WHERE id='t'").get()
      ).toEqual({ account_id: 'b', status, amount: 100 })
    }
  )
  it('keeps metadata-only correction available for malformed ordinary rows', async () => {
    seed({ status: 'bogus', amount: -100 })
    const before = state().accounts
    if (client === 'cli')
      expect(
        await updateTransaction.execute({ transactionId: 't', description: 'Corrected' })
      ).toMatchObject({ success: true })
    else
      await useTransactionStore
        .getState()
        .update(
          't',
          { ...form, amount: -1, date: '2026-01-01', status: 'bogus', description: 'Corrected' },
          { skipRefresh: true }
        )
    expect(state().accounts).toEqual(before)
    expect(
      holder.db.prepare("SELECT description,status,amount FROM transactions WHERE id = 't'").get()
    ).toEqual({ description: 'Corrected', status: 'bogus', amount: -100 })
  })
})

it.each(['Cleared', ' POSTED '])(
  'preserves inherited full-form status bytes %j on an account move',
  async (status) => {
    seed({ status })
    await useTransactionStore.getState().update('t', { ...form, accountId: 'b', status })
    expect(
      holder.db.prepare("SELECT account_id,status,amount FROM transactions WHERE id='t'").get()
    ).toEqual({ account_id: 'b', status, amount: 100 })
  }
)

it('pins the first invalid transfer-pair account message without writes', async () => {
  seed({})
  holder.db.exec(
    "INSERT INTO accounts (id,name,type,currency,balance) VALUES ('','Legacy empty ID','checking','USD',0); INSERT INTO transactions (id,account_id,type,amount,currency,description,date,status) VALUES ('mirror','','income',100,'USD','Mirror','2026-01-01','posted')"
  )
  const before = state()
  expect(
    await matchTransferTransactions.execute({
      sourceTransactionId: 't',
      mirrorTransactionId: 'mirror',
      dateWindowDays: 3,
      apply: true,
    })
  ).toEqual({
    success: false,
    reason: 'balance_impact_invalid',
    message:
      'Invalid ledger transaction mirror: account.accountId must not be empty. Use an audited financial correction to repair the transaction and account evidence before retrying; no historical balance inverse was inferred.',
  })
  expect(state()).toEqual(before)
})

it.each([
  [
    'source',
    "UPDATE transactions SET ledger_treatment='normal ' WHERE id='t'",
    'Invalid ledger transaction t: Unsupported ledger treatment: normal . Use an audited financial correction to repair the transaction and account evidence before retrying; no historical balance inverse was inferred.',
  ],
  [
    'mirror',
    "UPDATE transactions SET ledger_treatment='normal ' WHERE id='mirror'",
    'Invalid ledger transaction mirror: Unsupported ledger treatment: normal . Use an audited financial correction to repair the transaction and account evidence before retrying; no historical balance inverse was inferred.',
  ],
  [
    'both',
    "UPDATE transactions SET ledger_treatment='normal '",
    'Invalid ledger transaction t: Unsupported ledger treatment: normal . Use an audited financial correction to repair the transaction and account evidence before retrying; no historical balance inverse was inferred.',
  ],
])('forwards the first strict transfer refusal for %s evidence', async (_case, sql, message) => {
  seed({})
  holder.db.exec(
    "INSERT INTO transactions (id,account_id,type,amount,currency,description,date,status) VALUES ('mirror','b','income',100,'USD','Mirror','2026-01-01','posted')"
  )
  holder.db.exec(sql)
  const before = state()
  for (const apply of [false, true]) {
    expect(
      await matchTransferTransactions.execute({
        sourceTransactionId: 't',
        mirrorTransactionId: 'mirror',
        dateWindowDays: 3,
        apply,
      })
    ).toEqual({ success: false, reason: 'balance_impact_invalid', message })
    expect(state()).toEqual(before)
  }
})

it.each([
  ['Cleared', 'cleared'],
  [' Pending ', 'pending'],
])('normalizes explicitly changed full-form status %j', async (status, expected) => {
  seed({})
  await useTransactionStore.getState().update('t', { ...form, accountId: 'b', status })
  expect(
    holder.db.prepare("SELECT account_id,status FROM transactions WHERE id='t'").get()
  ).toEqual({ account_id: 'b', status: expected })
})

it.each([
  [{ status: 'bogus' }, 'invalid_ledger_evidence'],
  [{ status: ' Pending ' }, 'invalid_ledger_evidence'],
  [{ amountCentavos: -1 }, 'invalid_ledger_evidence'],
  [{ amountCentavos: 0.5 }, 'invalid_ledger_evidence'],
  [{ amountCentavos: 9007199254740992 }, 'invalid_ledger_evidence'],
  [{ type: 'transfer' }, 'invalid_ledger_evidence'],
  [{ type: 'transfer', transferToAccountId: 'a' }, 'invalid_ledger_evidence'],
  [{ isArchived: 1 }, 'dedicated_financial_undo_required'],
  [{ isArchived: true }, 'dedicated_financial_undo_required'],
  [{ ledgerTreatment: null }, 'dedicated_financial_undo_required'],
  [{ transactionKind: null }, 'dedicated_financial_undo_required'],
] as const)('refuses unsafe undo without changing evidence %j', async (patch, reason) => {
  const snapshot = {
    id: 't',
    accountId: 'a',
    type: 'expense',
    amountCentavos: 100,
    currency: 'USD',
    description: 'Old',
    date: '2026-01-01',
    status: 'posted',
    ...patch,
  }
  holder.db
    .prepare(
      "INSERT INTO audit_log (id,entity,entity_id,action,before_json,after_json) VALUES ('audit','transaction','t','delete',?,NULL)"
    )
    .run(JSON.stringify({ transaction: snapshot }))
  const before = state()
  expect(await undo.execute({ auditId: 'audit', apply: true })).toMatchObject({
    success: false,
    reason,
  })
  expect(state()).toEqual(before)
})

it.each(['not-a-date', '2026/01/01', '2026-01-01T00:00:00+05:30'])(
  'does not add a date parser to generic undo: %s',
  async (date) => {
    const snapshot = {
      id: 't',
      accountId: 'a',
      type: 'expense',
      amountCentavos: 100,
      currency: 'USD',
      description: 'Old',
      date,
      status: 'posted',
    }
    holder.db
      .prepare(
        "INSERT INTO audit_log (id,entity,entity_id,action,before_json,after_json) VALUES ('audit','transaction','t','delete',?,NULL)"
      )
      .run(JSON.stringify({ transaction: snapshot }))
    expect(await undo.execute({ auditId: 'audit', apply: true })).toMatchObject({ success: true })
    expect(holder.db.prepare("SELECT date FROM transactions WHERE id='t'").get()).toEqual({ date })
  }
)

it('refuses an unknown account mode in import previews before pending neutrality', () => {
  holder.db.exec("UPDATE accounts SET account_mode = 'hybrid' WHERE id = 'a'")
  expect(() =>
    validateImportedTransactionSync({
      accountId: 'a',
      amountCentavos: 100,
      type: 'expense',
      description: 'New',
      date: '2026-01-01',
      status: 'pending',
      importSource: 'test',
      importExternalId: null,
      importFingerprint: 'fp',
      importContentFingerprint: 'cfp',
    })
  ).toThrow('Unsupported account mode: hybrid')
})

it.each([
  { ledgerTreatment: 'normal ', status: 'pending' },
  { ledgerTreatment: 'normal', status: 'bogus' },
])('rejects imported unsafe neutral shapes without a partial file %j', (patch) => {
  const before = state()
  const input = {
    accountId: 'a',
    amountCentavos: 100,
    type: 'expense',
    description: 'New',
    date: '2026-01-01',
    importSource: 'test',
    importExternalId: null,
    importFingerprint: 'fp',
    importContentFingerprint: 'cfp',
    ...patch,
  } as ImportedTransactionCreateInput
  expect(() =>
    holder.db
      .transaction(() => {
        createImportedTransactionSync({
          ...input,
          status: 'posted',
          ledgerTreatment: 'normal',
          importFingerprint: 'first',
        })
        createImportedTransactionSync(input)
      })
      .immediate()
  ).toThrow()
  expect(state()).toEqual(before)
})
it.each([{ status: 'bogus' }, { type: 'transfer', status: 'pending' }])(
  'pins invalid projection %j',
  (patch) => {
    seed(patch)
    const rows = holder.db
      .prepare(datedLedgerQuery)
      .all('a', 'a', 'a', 'a', 'a', 'a') as DatedLedgerRow[]
    expect(() => projectDatedLedger(rows, 'a')).toThrow(
      patch.status === 'bogus' ? 'invalid_status' : 'missing_transfer_destination'
    )
  }
)

it('pins malformed payment currencies in CLI preview and apply', async () => {
  holder.db.exec(
    "UPDATE accounts SET currency = 'US-D'; UPDATE accounts SET type = 'credit_card' WHERE id = 'b'"
  )
  const payment = creditCardsTools.find((tool) => tool.name === 'record-card-payment')!
  const input = payment.schema.parse({
    fromAccount: 'a',
    cardAccount: 'b',
    amount: 1,
    mode: 'transfer',
    date: '2026-01-01',
  })
  const before = state()
  expect(await payment.execute({ ...input, dryRun: true })).toMatchObject({
    success: false,
    reason: 'invalid_ledger_evidence',
  })
  expect(await payment.execute(input)).toMatchObject({
    success: false,
    reason: 'invalid_ledger_evidence',
  })
  expect(state()).toEqual(before)
})

it.each(['US-D', 'U', 'TOOLONGCODE'])(
  'pins empty-ledger reconciliation preview currency %s',
  (currency) => {
    holder.db.prepare("UPDATE accounts SET currency=? WHERE id='a'").run(currency)
    const before = state()
    expect(() => previewTransactionalAccountBalance('a', 100, '2026-01-01')).toThrow(
      'Account a has invalid reconciliation ledger evidence'
    )
    expect(state()).toEqual(before)
  }
)

it.each(['cli', 'app'] as const)('pins malformed staged settlement through %s', async (client) => {
  holder.db.exec("UPDATE accounts SET currency='US-D' WHERE id='a'")
  seed({ currency: 'US-D', status: 'pending', ledger_treatment: 'staged_no_balance_impact' })
  const before = state()
  if (client === 'cli') {
    const settle = accountReconciliationTools.find(
      (tool) => tool.name === 'settle-staged-transactions'
    )!
    await expect(
      settle.execute({ accountId: 'a', transactionIds: ['t'], status: 'posted', apply: true })
    ).rejects.toThrow('Account a has invalid reconciliation ledger evidence')
  } else {
    await expect(
      commitAccountStagedTransactions({ accountId: 'a', transactionIds: ['t'], status: 'posted' })
    ).rejects.toThrow('Account a has invalid reconciliation ledger evidence')
  }
  expect(state()).toEqual(before)
})
