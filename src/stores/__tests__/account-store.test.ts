import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTACC00000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { useAccountStore } from '../account-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('account-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    it('inserts account with centavo conversion and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useAccountStore.getState().add({
        name: 'Savings',
        type: 'savings',
        currency: 'USD',
        balance: 1500.5,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO accounts'),
        expect.arrayContaining([
          '01TESTACC00000000000000000',
          'Savings',
          'savings',
          'USD',
          150050, // 1500.50 * 100 = 150050 centavos
        ])
      )
      // Should re-fetch after insert
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('does not reject when refresh fails after a committed write', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockRejectedValueOnce(new Error('refresh failed'))

      await expect(
        useAccountStore.getState().add({
          name: 'Savings',
          type: 'savings',
          currency: 'USD',
          balance: 1500.5,
        })
      ).resolves.toBeUndefined()

      expect(useAccountStore.getState().error).toBeNull()
      expect(useAccountStore.getState().fetchError).toBe('refresh failed')
    })

    it('stores credit card limit and statement dates', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().add({
        name: 'Credit Card',
        type: 'credit_card',
        currency: 'USD',
        balance: -1000,
        creditLimit: 27000,
        statementClosingDay: 15,
        paymentDueDay: 5,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('credit_limit, statement_closing_day, payment_due_day'),
        expect.arrayContaining([2700000, 15, 5])
      )
    })
  })

  describe('update', () => {
    it('updates account with centavo conversion and re-fetches', async () => {
      mockQuery.mockResolvedValueOnce([{ currency: 'EUR' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useAccountStore.getState().update('01ACC001', {
        name: 'Updated',
        type: 'checking',
        currency: 'EUR',
        balance: 200,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET'),
        expect.arrayContaining([
          'Updated',
          'checking',
          'EUR',
          20000,
          expect.any(String),
          '01ACC001',
        ])
      )
      expect(mockQuery).toHaveBeenCalledTimes(2)
    })

    it('rejects account currency changes while recurring rules still point at the account', async () => {
      mockQuery
        .mockResolvedValueOnce([{ currency: 'USD' }])
        .mockResolvedValueOnce([{ currency: 'BRL' }])

      await expect(
        useAccountStore.getState().update('01ACC001', {
          name: 'Updated',
          type: 'checking',
          currency: 'EUR',
          balance: 200,
        })
      ).rejects.toThrow(
        'Cannot change this account currency while 1 recurring rule(s) still point at the account. Repair, move, or recreate those recurring rules first so scheduled amounts do not silently change meaning.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
      expect(useAccountStore.getState().error).toBe(
        'Cannot change this account currency while 1 recurring rule(s) still point at the account. Repair, move, or recreate those recurring rules first so scheduled amounts do not silently change meaning.'
      )
    })

    it('allows currency normalization-only saves when recurring rules depend on the account', async () => {
      mockQuery.mockResolvedValueOnce([{ currency: ' usd ' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().update('01ACC001', {
        name: 'Updated',
        type: 'checking',
        currency: 'USD',
        balance: 200,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET'),
        expect.arrayContaining([
          'Updated',
          'checking',
          'USD',
          20000,
          expect.any(String),
          '01ACC001',
        ])
      )
    })

    it('allows repairing account currency when dependent recurring rules already match the target', async () => {
      mockQuery
        .mockResolvedValueOnce([{ currency: 'EUR' }])
        .mockResolvedValueOnce([{ currency: 'USD' }, { currency: ' usd ' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().update('01ACC001', {
        name: 'Updated',
        type: 'checking',
        currency: 'USD',
        balance: 200,
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET'),
        expect.arrayContaining([
          'Updated',
          'checking',
          'USD',
          20000,
          expect.any(String),
          '01ACC001',
        ])
      )
    })

    it('clears credit card fields when an account is saved as non-credit', async () => {
      mockQuery.mockResolvedValueOnce([{ currency: 'USD' }])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().update('01ACC001', {
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 200,
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
    it('deletes account and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useAccountStore.getState().remove('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith('DELETE FROM accounts WHERE id = ?', ['01ACC001'])
      expect(mockQuery).toHaveBeenCalledTimes(1)
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
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useAccountStore.getState().archive('01ACC001')

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?',
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
