import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockDbQuery, mockDbExecute, mockDbWithTransaction } = vi.hoisted(() => {
  const mockDbQuery = vi.fn()
  const mockDbExecute = vi.fn()
  return {
    mockDbQuery,
    mockDbExecute,
    mockDbWithTransaction: vi.fn((fn) => fn({ query: mockDbQuery, execute: mockDbExecute })),
  }
})

vi.mock('@/lib/database', () => ({
  query: mockDbQuery,
  execute: mockDbExecute,
  withTransaction: mockDbWithTransaction,
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTACC00000000000000000'),
}))

import { query, execute, withTransaction } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { useAccountStore } from '../account-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const mockWithTransaction = vi.mocked(withTransaction)

type LedgerCandidate = {
  id: string
  type: string
  amount: number
  currency: string | null
  status: string | null
  ledger_treatment: string | null
  transaction_kind: string | null
  is_archived: number | null
  account_id: string
  source_account_id: string | null
  source_currency: string | null
  source_account_mode: string | null
  transfer_to_account_id: string | null
  destination_account_id: string | null
  destination_currency: string | null
  destination_account_mode: string | null
}

function ledgerCandidate(overrides: Partial<LedgerCandidate> = {}): LedgerCandidate {
  return {
    id: 'ledger-row',
    type: 'income',
    amount: 0,
    currency: 'USD',
    status: 'posted',
    ledger_treatment: 'normal',
    transaction_kind: 'standard',
    is_archived: 0,
    account_id: '01ACC001',
    source_account_id: '01ACC001',
    source_currency: 'USD',
    source_account_mode: 'transactional',
    transfer_to_account_id: null,
    destination_account_id: null,
    destination_currency: null,
    destination_account_mode: null,
    ...overrides,
  }
}

describe('account-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue([])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
    mockWithTransaction.mockImplementation((fn) =>
      fn({ query: mockQuery, execute: mockExecute } as TransactionClient)
    )
    // Reset zustand store between tests
    useAccountStore.setState({
      accounts: [],
      archivedAccounts: [],
      isLoading: false,
      fetchError: null,
      error: null,
    })
  })

  describe('fetch', () => {
    it('loads accounts from database', async () => {
      const mockAccounts = [
        {
          id: '01ACC001',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 150000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
      ]
      mockQuery.mockResolvedValueOnce(mockAccounts)

      await useAccountStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM accounts ORDER BY is_archived ASC, created_at DESC'
      )
      expect(useAccountStore.getState().accounts).toEqual(mockAccounts)
      expect(useAccountStore.getState().archivedAccounts).toEqual([])
      expect(useAccountStore.getState().isLoading).toBe(false)
    })

    it('splits active and archived accounts', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01ACC001',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 150000,
          icon: null,
          color: null,
          is_archived: 0,
          created_at: '2024-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
        },
        {
          id: '01ACC002',
          name: 'Old Card',
          type: 'credit_card',
          currency: 'USD',
          balance: -20000,
          icon: null,
          color: null,
          is_archived: 1,
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2023-01-01T00:00:00Z',
        },
      ])

      await useAccountStore.getState().fetch()

      expect(useAccountStore.getState().accounts).toHaveLength(1)
      expect(useAccountStore.getState().archivedAccounts).toHaveLength(1)
    })

    it('sets isLoading during fetch', async () => {
      mockQuery.mockImplementation(
        () =>
          new Promise((resolve) => {
            // Check loading state is true while waiting
            expect(useAccountStore.getState().isLoading).toBe(true)
            resolve([])
          })
      )

      await useAccountStore.getState().fetch()
      expect(useAccountStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await expect(useAccountStore.getState().fetch()).rejects.toThrow('DB error')
      expect(useAccountStore.getState().isLoading).toBe(false)
      expect(useAccountStore.getState().fetchError).toBe('DB error')
      expect(useAccountStore.getState().error).toBeNull()
    })
  })

  describe('add', () => {
    it('inserts a transactional account at zero before linking an opening bridge', async () => {
      let ledgerRead = 0
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM transactions t')) {
          const balance = [0, 150050][ledgerRead++]
          return Promise.resolve(
            balance === 0
              ? []
              : [
                  ledgerCandidate({
                    id: 'opening-bridge',
                    amount: balance,
                    account_id: '01TESTACC00000000000000000',
                    source_account_id: '01TESTACC00000000000000000',
                  }),
                ]
          )
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().add({
        name: 'Savings',
        type: 'savings',
        currency: 'USD',
        balance: 1500.5,
      })

      expect(mockWithTransaction).toHaveBeenCalledTimes(1)
      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO accounts'),
        expect.arrayContaining(['01TESTACC00000000000000000', 'Savings', 'savings', 'USD', 0])
      )
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO account_reconciliations'),
        expect.arrayContaining([150050, 0, 0, 150050, 150050])
      )
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining([
          'income',
          150050,
          'USD',
          'exclude_from_cashflow',
          'reconciliation_bridge',
        ])
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE account_reconciliations SET adjustment_transaction_id = ? WHERE id = ?',
        ['01TESTACC00000000000000000', '01TESTACC00000000000000000']
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND is_archived = 0',
        [150050, expect.any(String), '01TESTACC00000000000000000']
      )
    })

    it('does not create reconciliation history for a zero transactional opening', async () => {
      await useAccountStore.getState().add({
        name: 'Empty checking',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      })

      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('account_reconciliations'),
        expect.anything()
      )
    })

    it('stores snapshot-only observed balances without a transaction', async () => {
      await useAccountStore.getState().add({
        name: 'Portfolio',
        type: 'investment',
        currency: 'USD',
        balance: 1234.56,
        accountMode: 'snapshot_only',
      })

      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO accounts'),
        expect.arrayContaining(['USD', 123456, null, null, null, 'snapshot_only'])
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.anything()
      )
    })

    it('does not reject when refresh fails after a committed write', async () => {
      mockQuery.mockRejectedValueOnce(new Error('refresh failed'))

      await expect(
        useAccountStore.getState().add({
          name: 'Savings',
          type: 'savings',
          currency: 'USD',
          balance: 0,
        })
      ).resolves.toBeUndefined()

      expect(useAccountStore.getState().error).toBeNull()
      expect(useAccountStore.getState().fetchError).toBe('refresh failed')
    })

    it('stores credit card limit and statement dates', async () => {
      await useAccountStore.getState().add({
        name: 'Credit Card',
        type: 'credit_card',
        currency: 'USD',
        balance: 0,
        creditLimit: 27000,
        statementClosingDay: 15,
        paymentDueDay: 5,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('credit_limit, statement_closing_day, payment_due_day'),
        expect.arrayContaining([2700000, 15, 5])
      )
    })

    it('propagates transaction rollback failures without refreshing', async () => {
      mockWithTransaction.mockRejectedValueOnce(new Error('bridge insert failed'))

      await expect(
        useAccountStore.getState().add({
          name: 'Rollback checking',
          type: 'checking',
          currency: 'USD',
          balance: 25,
        })
      ).rejects.toThrow('bridge insert failed')

      expect(useAccountStore.getState().error).toBe('bridge insert failed')
      expect(mockQuery).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('corrects a transactional balance with a ledger-derived bridge', async () => {
      let ledgerRead = 0
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'EUR', is_archived: 0, balance: 10000, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM transactions t')) {
          return Promise.resolve([
            ledgerCandidate({
              amount: [12500, 20000][ledgerRead++],
              currency: 'EUR',
              source_currency: 'EUR',
            }),
          ])
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().update('01ACC001', {
        name: 'Updated',
        type: 'checking',
        currency: 'EUR',
        balance: 200,
      })

      const metadataUpdate = mockExecute.mock.calls.find(([sql]) =>
        String(sql).includes('UPDATE accounts SET name = ?')
      )
      expect(String(metadataUpdate?.[0])).not.toContain('balance = ?')
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining([
          'income',
          7500,
          'EUR',
          'exclude_from_cashflow',
          'reconciliation_bridge',
        ])
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND is_archived = 0',
        [20000, expect.any(String), '01ACC001']
      )
    })

    it('records a no-bridge reconciliation when the ledger already equals the requested balance', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 10000, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM transactions t')) {
          return Promise.resolve([ledgerCandidate({ amount: 20000 })])
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().update('01ACC001', {
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 200,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO account_reconciliations'),
        expect.arrayContaining([20000, 10000, 20000, 20000, 0])
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.anything()
      )
    })

    it.each([
      [
        'an unarchived archived-transfer mirror',
        ledgerCandidate({
          transaction_kind: 'archived_transfer_mirror',
          is_archived: 0,
          amount: 700,
        }),
      ],
      [
        'a transfer with a missing destination',
        ledgerCandidate({ type: 'transfer', amount: 700, transfer_to_account_id: null }),
      ],
      [
        'a same-account transfer',
        ledgerCandidate({
          type: 'transfer',
          amount: 700,
          transfer_to_account_id: '01ACC001',
          destination_account_id: '01ACC001',
          destination_currency: 'USD',
          destination_account_mode: 'transactional',
        }),
      ],
      [
        'a cross-currency transfer',
        ledgerCandidate({
          type: 'transfer',
          amount: 700,
          transfer_to_account_id: '01ACC002',
          destination_account_id: '01ACC002',
          destination_currency: 'EUR',
          destination_account_mode: 'transactional',
        }),
      ],
      [
        'a transfer to a snapshot-only destination',
        ledgerCandidate({
          type: 'transfer',
          amount: 700,
          transfer_to_account_id: '01ACC002',
          destination_account_id: '01ACC002',
          destination_currency: 'USD',
          destination_account_mode: 'snapshot_only',
        }),
      ],
    ])('excludes %s from effective-ledger reconciliation', async (_label, excludedRow) => {
      let ledgerRead = 0
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM transactions t')) {
          ledgerRead++
          return Promise.resolve(
            ledgerRead === 1
              ? [excludedRow]
              : [excludedRow, ledgerCandidate({ id: 'reconciliation-bridge', amount: 10000 })]
          )
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().update('01ACC001', {
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 100,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['income', 10000, 'USD'])
      )
    })

    it('fails reconciliation on an unsupported ledger discriminant', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM transactions t')) {
          return Promise.resolve([ledgerCandidate({ transaction_kind: 'malformed-kind' })])
        }
        return Promise.resolve([])
      })

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 100,
        })
      ).rejects.toThrow('Unsupported transaction kind: malformed-kind')
    })

    it.each([
      ['blank', '   ', 'currency must not be empty'],
      ['mismatched', 'EUR', 'Transaction currency EUR does not match source account currency USD'],
    ])(
      'aborts reconciliation without balance history for a %s transaction currency',
      async (_label, transactionCurrency, message) => {
        mockQuery.mockImplementation((sql: string) => {
          if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
            return Promise.resolve([
              { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
            ])
          }
          if (sql.includes('FROM transactions t')) {
            return Promise.resolve([ledgerCandidate({ currency: transactionCurrency })])
          }
          return Promise.resolve([])
        })

        await expect(
          useAccountStore.getState().update('01ACC001', {
            name: 'Should roll back',
            type: 'checking',
            currency: 'USD',
            balance: 100,
          })
        ).rejects.toThrow(message)

        expect(mockExecute).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO account_reconciliations'),
          expect.anything()
        )
        expect(mockExecute).not.toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO transactions'),
          expect.anything()
        )
        expect(mockExecute).not.toHaveBeenCalledWith(
          'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND is_archived = 0',
          expect.anything()
        )
      }
    )

    it('aborts reconciliation without balance history for a malformed archive flag', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM transactions t')) {
          return Promise.resolve([ledgerCandidate({ is_archived: 2 })])
        }
        return Promise.resolve([])
      })

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Should roll back',
          type: 'checking',
          currency: 'USD',
          balance: 100,
        })
      ).rejects.toThrow('Unsupported archive flag: 2')

      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO account_reconciliations'),
        expect.anything()
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.anything()
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND is_archived = 0',
        expect.anything()
      )
    })

    it('does not create history for a metadata-only transactional save', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 1000, account_mode: 'transactional' },
          ])
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().update('01ACC001', {
        name: 'Everyday Checking',
        type: 'checking',
        currency: 'USD',
        balance: 10,
      })

      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('account_reconciliations'),
        expect.anything()
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.anything()
      )
    })

    it('updates snapshot-only balances directly without ledger history', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 1000, account_mode: 'snapshot_only' },
          ])
        }
        return Promise.resolve([])
      })

      await useAccountStore.getState().update('01ACC001', {
        name: 'Portfolio',
        type: 'investment',
        currency: 'USD',
        balance: 25,
        accountMode: 'snapshot_only',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('balance = ? WHERE id = ?'),
        expect.arrayContaining([2500, '01ACC001'])
      )
      expect(mockExecute).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.anything()
      )
    })

    it('rejects account currency changes while linked monetary rows still point at the account', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode FROM accounts')) {
          return Promise.resolve([
            { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('FROM recurring_rules WHERE account_id')) {
          return Promise.resolve([{ count: 1 }])
        }
        if (sql.includes('COUNT(*) as count')) return Promise.resolve([{ count: 0 }])
        return Promise.resolve([])
      })

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Updated',
          type: 'checking',
          currency: 'EUR',
          balance: 200,
        })
      ).rejects.toThrow('Cannot change this account currency while 1 linked monetary reference')

      expect(mockExecute).not.toHaveBeenCalled()
      expect(useAccountStore.getState().error).toContain('recurring rules as source=1')
    })

    it('allows currency normalization-only saves when recurring rules depend on the account', async () => {
      mockQuery.mockResolvedValueOnce([
        { currency: ' usd ', is_archived: 0, balance: 0, account_mode: 'transactional' },
      ])
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().update('01ACC001', {
        name: 'Updated',
        type: 'checking',
        currency: 'USD',
        balance: 0,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET'),
        expect.arrayContaining(['Updated', 'checking', 'USD', expect.any(String), '01ACC001'])
      )
    })

    it.each([1, 2])('rejects updates when is_archived is %s', async (isArchived) => {
      mockQuery.mockResolvedValueOnce([
        { currency: 'USD', is_archived: isArchived, balance: 0, account_mode: 'transactional' },
      ])

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Archived update',
          type: 'checking',
          currency: 'USD',
          balance: 200,
        })
      ).rejects.toThrow('Account 01ACC001 is archived. Unarchive it before editing it.')

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('rejects an update when the active-row write guard affects zero rows', async () => {
      mockQuery.mockResolvedValueOnce([
        { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
      ])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Guarded update',
          type: 'checking',
          currency: 'USD',
          balance: 0,
        })
      ).rejects.toThrow('Account 01ACC001 could not be updated safely.')
    })

    it('rejects account currency changes when the account has a nonzero balance', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('SELECT currency, is_archived, balance, account_mode FROM accounts')) {
          return Promise.resolve([
            { currency: 'EUR', is_archived: 0, balance: 1234, account_mode: 'transactional' },
          ])
        }
        if (sql.includes('COUNT(*) as count')) return Promise.resolve([{ count: 0 }])
        return Promise.resolve([])
      })

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Updated',
          type: 'checking',
          currency: 'USD',
          balance: 200,
        })
      ).rejects.toThrow('nonzero account balance=1')

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('clears credit card fields when an account is saved as non-credit', async () => {
      mockQuery.mockResolvedValueOnce([
        { currency: 'USD', is_archived: 0, balance: 0, account_mode: 'transactional' },
      ])
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().update('01ACC001', {
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 0,
        creditLimit: 27000,
        statementClosingDay: 15,
        paymentDueDay: 5,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('credit_limit = ?, statement_closing_day = ?, payment_due_day = ?'),
        expect.arrayContaining([null, null, null])
      )
    })
  })

  describe('remove', () => {
    it('deletes account with no linked references and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useAccountStore.getState().remove('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith('DELETE FROM accounts WHERE id = ?', ['01ACC001'])
      expect(mockWithTransaction).toHaveBeenCalledTimes(1)
    })

    it('archives accounts with linked references instead of deleting them', async () => {
      mockQuery.mockResolvedValueOnce([{ count: 1 }])
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })

      await useAccountStore.getState().remove('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?',
        [expect.any(String), '01ACC001']
      )
      expect(mockExecute).not.toHaveBeenCalledWith('DELETE FROM accounts WHERE id = ?', [
        '01ACC001',
      ])
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE recurring_rules SET active = 0, updated_at = ? WHERE active = 1 AND (account_id = ? OR to_account_id = ?)',
        [expect.any(String), '01ACC001', '01ACC001']
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE subscriptions SET is_active = 0, updated_at = ? WHERE is_active = 1 AND account_id = ?',
        [expect.any(String), '01ACC001']
      )
    })
  })

  describe('setPrimary', () => {
    it('marks one active liquid account as primary and clears other liquid primaries', async () => {
      mockQuery.mockResolvedValueOnce([{ name: 'is_primary' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 2, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().setPrimary('01ACC001')

      expect(mockQuery).toHaveBeenCalledWith('PRAGMA table_info(accounts)')
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END'),
        ['01ACC001', '01ACC001', expect.any(String)]
      )
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining("type NOT IN ('investment', 'crypto', 'credit_card')"),
        expect.any(Array)
      )
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('creates the primary account column before marking primary when migrations are stale', async () => {
      mockQuery.mockResolvedValueOnce([{ name: 'id' }])
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 2, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().setPrimary('01ACC001')

      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        'ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0'
      )
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END'),
        ['01ACC001', '01ACC001', expect.any(String)]
      )
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })
  })

  describe('archive', () => {
    it('archives an account and re-fetches', async () => {
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().archive('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?',
        [expect.any(String), '01ACC001']
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE recurring_rules SET active = 0, updated_at = ? WHERE active = 1 AND (account_id = ? OR to_account_id = ?)',
        [expect.any(String), '01ACC001', '01ACC001']
      )
      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE subscriptions SET is_active = 0, updated_at = ? WHERE is_active = 1 AND account_id = ?',
        [expect.any(String), '01ACC001']
      )
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('unarchive', () => {
    it('unarchives an account and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().unarchive('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET is_archived = 0, updated_at = ? WHERE id = ?',
        [expect.any(String), '01ACC001']
      )
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })
  })

  describe('getById', () => {
    it('returns account by id', () => {
      const account = {
        id: '01ACC001',
        name: 'Test',
        type: 'checking' as const,
        currency: 'USD',
        balance: 0,
        icon: null,
        color: null,
        is_archived: 0,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      useAccountStore.setState({ accounts: [account], archivedAccounts: [] })

      expect(useAccountStore.getState().getById('01ACC001')).toEqual(account)
      expect(useAccountStore.getState().getById('nonexistent')).toBeUndefined()
    })

    it('returns archived accounts by id as well', () => {
      const archivedAccount = {
        id: '01ACC002',
        name: 'Archived',
        type: 'checking' as const,
        currency: 'USD',
        balance: 0,
        icon: null,
        color: null,
        is_archived: 1,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      useAccountStore.setState({ accounts: [], archivedAccounts: [archivedAccount] })

      expect(useAccountStore.getState().getById('01ACC002')).toEqual(archivedAccount)
    })
  })
})
