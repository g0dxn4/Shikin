import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedTransaction } from '@/lib/statement-parser'
import type { TransactionClient } from '@/lib/database'

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  parseStatement: vi.fn(),
  generateId: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchAccounts: vi.fn(),
}))

vi.mock('@/lib/database', () => ({
  withTransaction: mocks.withTransaction,
}))

vi.mock('@/lib/statement-parser', () => ({
  parseStatement: mocks.parseStatement,
}))

vi.mock('@/lib/ulid', () => ({
  generateId: mocks.generateId,
}))

vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: {
    getState: () => ({ fetch: mocks.fetchTransactions }),
  },
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: {
    getState: () => ({ fetch: mocks.fetchAccounts }),
  },
}))

import { importStatementFile } from '../statement-import'

type AccountMode = 'transactional' | 'snapshot_only' | null

interface FakeAccount {
  id: string
  currency: string | null
  account_mode: AccountMode
  is_archived: number
  balance: number
}

interface FakeTransaction {
  id: string
  account_id: string
  type: string
  amount: number
  currency: string
  description: string
  date: string
  status: 'posted'
  ledger_treatment: 'normal'
  reporting_treatment: 'normal'
  transaction_kind: 'standard'
}

interface FakeDatabase {
  accounts: FakeAccount[]
  transactions: FakeTransaction[]
}

interface FailurePlan {
  duplicateQueryAt: number | null
  insertAt: number | null
  balanceUpdate: boolean
  balanceUpdateRowsAffectedZero: boolean
}

interface TransactionStats {
  begun: number
  committed: number
  rolledBack: number
  accountQueries: number
  duplicateQueries: number
  insertAttempts: number
  balanceUpdateAttempts: number
  lastBalanceDelta: number | null
}

let database: FakeDatabase
let failures: FailurePlan
let stats: TransactionStats

function cloneDatabase(source: FakeDatabase): FakeDatabase {
  return {
    accounts: source.accounts.map((account) => ({ ...account })),
    transactions: source.transactions.map((transaction) => ({ ...transaction })),
  }
}

function makeParsed(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    date: '2026-02-10',
    amount: 10,
    description: 'Coffee Shop',
    type: 'expense',
    ...overrides,
  }
}

function seedTransaction(overrides: Partial<FakeTransaction> = {}): FakeTransaction {
  const transaction: FakeTransaction = {
    id: `seed-${database.transactions.length + 1}`,
    account_id: 'account-1',
    type: 'expense',
    amount: 1000,
    currency: 'USD',
    description: 'Coffee Shop',
    date: '2026-02-10',
    status: 'posted',
    ledger_treatment: 'normal',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    ...overrides,
  }
  database.transactions.push(transaction)
  return transaction
}

function isWithinOneDay(left: string, right: string): boolean {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.abs(Date.parse(left) - Date.parse(right)) <= millisecondsPerDay
}

function createTransactionClient(working: FakeDatabase): TransactionClient {
  return {
    query: async <T>(sql: string, bindValues: unknown[] = []): Promise<T[]> => {
      if (sql.includes('FROM accounts')) {
        stats.accountQueries++
        const account = working.accounts.find(({ id }) => id === bindValues[0])
        return (
          account
            ? [
                {
                  currency: account.currency,
                  account_mode: account.account_mode,
                  is_archived: account.is_archived,
                },
              ]
            : []
        ) as T[]
      }

      if (sql.includes('FROM transactions')) {
        stats.duplicateQueries++
        if (failures.duplicateQueryAt === stats.duplicateQueries) {
          throw new Error('duplicate lookup exploded')
        }

        const [accountId, amount, description, type, currency, date] = bindValues as [
          string,
          number,
          string,
          string,
          string,
          string,
          string,
        ]
        const count = working.transactions.filter(
          (transaction) =>
            transaction.account_id === accountId &&
            transaction.amount === amount &&
            transaction.description === description &&
            transaction.type === type &&
            transaction.currency === currency &&
            isWithinOneDay(transaction.date, date)
        ).length
        return [{ cnt: count }] as T[]
      }

      throw new Error(`Unexpected query: ${sql}`)
    },

    execute: async (sql: string, bindValues: unknown[] = []) => {
      if (sql.includes('INSERT INTO transactions')) {
        stats.insertAttempts++
        if (failures.insertAt === stats.insertAttempts) {
          throw new Error('insert exploded')
        }

        const [id, accountId, , type, amount, currency, description, , date] = bindValues as [
          string,
          string,
          null,
          string,
          number,
          string,
          string,
          null,
          string,
          string,
          string,
        ]
        working.transactions.push({
          id,
          account_id: accountId,
          type,
          amount,
          currency,
          description,
          date,
          status: 'posted',
          ledger_treatment: 'normal',
          reporting_treatment: 'normal',
          transaction_kind: 'standard',
        })
        return { rowsAffected: 1, lastInsertId: 0 }
      }

      if (sql.includes('UPDATE accounts SET balance')) {
        stats.balanceUpdateAttempts++
        if (failures.balanceUpdate) throw new Error('balance update exploded')
        if (failures.balanceUpdateRowsAffectedZero) {
          return { rowsAffected: 0, lastInsertId: 0 }
        }

        const [delta, , accountId] = bindValues as [number, string, string]
        stats.lastBalanceDelta = delta
        const account = working.accounts.find(
          (candidate) =>
            candidate.id === accountId &&
            candidate.is_archived === 0 &&
            (candidate.account_mode ?? 'transactional') === 'transactional'
        )
        if (!account) return { rowsAffected: 0, lastInsertId: 0 }
        account.balance += delta
        return { rowsAffected: 1, lastInsertId: 0 }
      }

      throw new Error(`Unexpected execute: ${sql}`)
    },
  }
}

function statementFile(): File {
  return new File(['parsed by the mocked parser'], 'statement.ofx', { type: 'application/xml' })
}

describe('importStatementFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    database = {
      accounts: [
        {
          id: 'account-1',
          currency: 'USD',
          account_mode: 'transactional',
          is_archived: 0,
          balance: 10_000,
        },
      ],
      transactions: [],
    }
    failures = {
      duplicateQueryAt: null,
      insertAt: null,
      balanceUpdate: false,
      balanceUpdateRowsAffectedZero: false,
    }
    stats = {
      begun: 0,
      committed: 0,
      rolledBack: 0,
      accountQueries: 0,
      duplicateQueries: 0,
      insertAttempts: 0,
      balanceUpdateAttempts: 0,
      lastBalanceDelta: null,
    }

    mocks.generateId.mockImplementation(() => `import-${mocks.generateId.mock.calls.length}`)
    mocks.fetchTransactions.mockResolvedValue(undefined)
    mocks.fetchAccounts.mockResolvedValue(undefined)
    mocks.withTransaction.mockImplementation(
      async (callback: (client: TransactionClient) => Promise<unknown>) => {
        stats.begun++
        const working = cloneDatabase(database)
        try {
          const value = await callback(createTransactionClient(working))
          database = working
          stats.committed++
          return value
        } catch (error) {
          stats.rolledBack++
          throw error
        }
      }
    )
  })

  it('commits a multi-row import and applies the balance exactly once', async () => {
    mocks.parseStatement.mockReturnValue([
      makeParsed({ description: 'Groceries', amount: 12.25, type: 'expense' }),
      makeParsed({ description: 'Refund', amount: 30, type: 'income', date: '2026-02-11' }),
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({ imported: 2, skipped: 0, errors: [] })
    expect(stats).toMatchObject({
      begun: 1,
      committed: 1,
      rolledBack: 0,
      accountQueries: 1,
      duplicateQueries: 2,
      insertAttempts: 2,
      balanceUpdateAttempts: 1,
      lastBalanceDelta: 1775,
    })
    expect(database.accounts[0].balance).toBe(11_775)
    expect(database.transactions).toHaveLength(2)
    expect(database.transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          description: 'Groceries',
          type: 'expense',
          currency: 'USD',
          status: 'posted',
          ledger_treatment: 'normal',
          reporting_treatment: 'normal',
        }),
        expect.objectContaining({ description: 'Refund', type: 'income', currency: 'USD' }),
      ])
    )
    expect(mocks.fetchTransactions).toHaveBeenCalledOnce()
    expect(mocks.fetchAccounts).toHaveBeenCalledOnce()
  })

  it('includes transaction type and currency in otherwise exact duplicate matching', async () => {
    seedTransaction({ description: 'Same Amount', type: 'expense', currency: 'USD' })
    seedTransaction({ description: 'Other Currency', type: 'expense', currency: 'EUR' })
    seedTransaction({ description: 'Exact Duplicate', date: '2026-02-09' })
    mocks.parseStatement.mockReturnValue([
      makeParsed({ description: 'Same Amount', type: 'income' }),
      makeParsed({ description: 'Other Currency', type: 'expense' }),
      makeParsed({ description: 'Exact Duplicate', type: 'expense' }),
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({ imported: 2, skipped: 1, errors: [] })
    expect(database.transactions).toHaveLength(5)
    expect(stats.balanceUpdateAttempts).toBe(1)
    expect(stats.lastBalanceDelta).toBe(0)
    expect(database.accounts[0].balance).toBe(10_000)
  })

  it('commits and refreshes an all-duplicates no-op without updating the balance', async () => {
    seedTransaction()
    mocks.parseStatement.mockReturnValue([makeParsed()])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({ imported: 0, skipped: 1, errors: [] })
    expect(stats).toMatchObject({ committed: 1, rolledBack: 0, insertAttempts: 0 })
    expect(stats.balanceUpdateAttempts).toBe(0)
    expect(database.accounts[0].balance).toBe(10_000)
    expect(mocks.fetchTransactions).toHaveBeenCalledOnce()
    expect(mocks.fetchAccounts).toHaveBeenCalledOnce()
  })

  it('rejects snapshot-only accounts without writes or refreshes', async () => {
    database.accounts[0].account_mode = 'snapshot_only'
    mocks.parseStatement.mockReturnValue([makeParsed()])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors[0]).toContain('Snapshot-only accounts')
    expect(stats).toMatchObject({
      committed: 0,
      rolledBack: 1,
      duplicateQueries: 0,
      insertAttempts: 0,
    })
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
    expect(mocks.fetchTransactions).not.toHaveBeenCalled()
    expect(mocks.fetchAccounts).not.toHaveBeenCalled()
  })

  it.each([1, 2])('rejects account is_archived flag %s inside the transaction', async (flag) => {
    database.accounts[0].is_archived = flag
    mocks.parseStatement.mockReturnValue([makeParsed()])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors[0]).toContain('is archived')
    expect(stats).toMatchObject({ insertAttempts: 0, balanceUpdateAttempts: 0, rolledBack: 1 })
  })

  it('rolls back when the final active-account update guard affects zero rows', async () => {
    failures.balanceUpdateRowsAffectedZero = true
    mocks.parseStatement.mockReturnValue([makeParsed({ type: 'income', amount: 25 })])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors[0]).toContain('account update affected 0 rows')
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
    expect(stats).toMatchObject({ insertAttempts: 1, balanceUpdateAttempts: 1, rolledBack: 1 })
  })

  it('rolls back an earlier row when a later insert fails', async () => {
    failures.insertAt = 2
    mocks.parseStatement.mockReturnValue([
      makeParsed({ description: 'First row' }),
      makeParsed({ description: 'Failing row', date: '2026-02-11' }),
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: ['Failed to import "Failing row" (2026-02-11): insert exploded'],
    })
    expect(stats).toMatchObject({ committed: 0, rolledBack: 1, insertAttempts: 2 })
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
    expect(mocks.fetchTransactions).not.toHaveBeenCalled()
    expect(mocks.fetchAccounts).not.toHaveBeenCalled()
  })

  it('rolls back every inserted row when the final balance update fails', async () => {
    failures.balanceUpdate = true
    mocks.parseStatement.mockReturnValue([
      makeParsed({ description: 'Expense' }),
      makeParsed({ description: 'Income', type: 'income', amount: 5 }),
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors[0]).toContain('Failed to update balance for account account-1')
    expect(result.errors[0]).toContain('balance update exploded')
    expect(stats).toMatchObject({
      committed: 0,
      rolledBack: 1,
      insertAttempts: 2,
      balanceUpdateAttempts: 1,
    })
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
  })

  it('rolls back and reports a duplicate-query failure', async () => {
    failures.duplicateQueryAt = 1
    mocks.parseStatement.mockReturnValue([makeParsed({ description: 'Lookup failure' })])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: [
        'Failed to check duplicate for "Lookup failure" (2026-02-10): duplicate lookup exploded',
      ],
    })
    expect(stats).toMatchObject({ committed: 0, rolledBack: 1, insertAttempts: 0 })
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
  })

  it('keeps a committed import successful when a store refresh fails', async () => {
    mocks.parseStatement.mockReturnValue([makeParsed({ type: 'income', amount: 25 })])
    mocks.fetchTransactions.mockRejectedValue(new Error('refresh exploded'))

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result).toEqual({ imported: 1, skipped: 0, errors: [] })
    expect(stats).toMatchObject({ committed: 1, rolledBack: 0 })
    expect(database.transactions).toHaveLength(1)
    expect(database.accounts[0].balance).toBe(12_500)
    expect(mocks.fetchTransactions).toHaveBeenCalledOnce()
    expect(mocks.fetchAccounts).toHaveBeenCalledOnce()
  })

  it('rejects unsupported parsed transaction types instead of treating them as expenses', async () => {
    mocks.parseStatement.mockReturnValue([
      makeParsed({ type: 'transfer' as ParsedTransaction['type'] }),
    ])

    const result = await importStatementFile(statementFile(), 'account-1')

    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors[0]).toContain('Unsupported imported transaction type "transfer"')
    expect(stats).toMatchObject({
      begun: 1,
      committed: 0,
      rolledBack: 1,
      accountQueries: 0,
      duplicateQueries: 0,
      insertAttempts: 0,
      balanceUpdateAttempts: 0,
    })
    expect(database.transactions).toEqual([])
    expect(database.accounts[0].balance).toBe(10_000)
    expect(mocks.fetchTransactions).not.toHaveBeenCalled()
    expect(mocks.fetchAccounts).not.toHaveBeenCalled()
  })
})
