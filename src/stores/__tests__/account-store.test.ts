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
  })

  describe('update', () => {
    it('updates account with centavo conversion and re-fetches', async () => {
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
      expect(mockQuery).toHaveBeenCalledTimes(1)
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
