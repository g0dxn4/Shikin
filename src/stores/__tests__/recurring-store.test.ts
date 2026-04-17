import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TransactionClient } from '@/lib/database'

const runtimeState = vi.hoisted(() => ({ isTauri: true }))

const databaseMocks = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(),
  withTransaction: vi.fn(),
  materializeRecurringTransactionsBrowser: vi.fn(),
}))

vi.mock('@/lib/database', () => ({
  query: databaseMocks.query,
  execute: databaseMocks.execute,
  withTransaction: databaseMocks.withTransaction,
  materializeRecurringTransactionsBrowser: databaseMocks.materializeRecurringTransactionsBrowser,
}))

vi.mock('@/lib/runtime', () => ({
  get isTauri() {
    return runtimeState.isTauri
  },
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTRULE0000000000000000'),
}))

const mockTxFetch = vi.fn()
vi.mock('../transaction-store', () => ({
  useTransactionStore: {
    getState: () => ({ fetch: mockTxFetch }),
  },
}))

const mockAccountFetch = vi.fn()
vi.mock('../account-store', () => ({
  useAccountStore: {
    getState: () => ({ fetch: mockAccountFetch }),
  },
}))

import {
  query,
  execute,
  withTransaction,
  materializeRecurringTransactionsBrowser,
} from '@/lib/database'
import { useRecurringStore } from '../recurring-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const mockWithTransaction = vi.mocked(withTransaction)
const mockMaterializeRecurringTransactionsBrowser = vi.mocked(
  materializeRecurringTransactionsBrowser
)

describe('recurring-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeState.isTauri = true
    mockQuery.mockReset()
    mockExecute.mockReset()
    mockMaterializeRecurringTransactionsBrowser.mockReset()
    mockWithTransaction.mockImplementation(
      async (fn: (tx: TransactionClient) => Promise<unknown>) =>
        fn({ query: databaseMocks.query, execute: databaseMocks.execute } as TransactionClient)
    )
    useRecurringStore.setState({ rules: [], isLoading: false, fetchError: null, error: null })
  })

  describe('fetch', () => {
    it('loads rules with joined account and category names', async () => {
      const mockRules = [
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-04-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_name: 'Checking',
          account_currency: 'USD',
          category_name: 'Entertainment',
          category_color: '#8b5cf6',
        },
      ]
      mockQuery.mockResolvedValueOnce(mockRules)

      await useRecurringStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN accounts'))
      expect(useRecurringStore.getState().rules).toEqual(mockRules)
    })

    it('sets isLoading correctly', async () => {
      mockQuery.mockResolvedValueOnce([])
      const promise = useRecurringStore.getState().fetch()
      expect(useRecurringStore.getState().isLoading).toBe(true)
      await promise
      expect(useRecurringStore.getState().isLoading).toBe(false)
    })

    it('stores an error message when fetch fails', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'))

      await expect(useRecurringStore.getState().fetch()).rejects.toThrow('DB error')

      expect(useRecurringStore.getState().isLoading).toBe(false)
      expect(useRecurringStore.getState().fetchError).toBe('DB error')
      expect(useRecurringStore.getState().error).toBeNull()
    })
  })

  describe('create', () => {
    it('inserts rule with centavos and next_date', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([{ currency: ' eur ' }])
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useRecurringStore.getState().create({
        description: 'Rent',
        amount: 1500,
        type: 'expense',
        frequency: 'monthly',
        nextDate: '2026-04-01',
        endDate: null,
        accountId: '01ACC001',
        toAccountId: null,
        categoryId: '01CAT001',
        subcategoryId: null,
        tags: '',
        notes: 'Monthly rent',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO recurring_rules'),
        expect.arrayContaining([
          '01TESTRULE0000000000000000',
          'Rent',
          150000, // toCentavos(1500)
          'EUR',
          'expense',
          'monthly',
          '2026-04-01',
        ])
      )
    })

    it('does not reject when refresh fails after a committed write', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([{ currency: 'EUR' }])
      mockQuery.mockRejectedValueOnce(new Error('refresh failed'))

      await expect(
        useRecurringStore.getState().create({
          description: 'Rent',
          amount: 1500,
          type: 'expense',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC001',
          toAccountId: null,
          categoryId: '01CAT001',
          subcategoryId: null,
          tags: '',
          notes: 'Monthly rent',
        })
      ).resolves.toBeUndefined()

      expect(useRecurringStore.getState().error).toBeNull()
      expect(useRecurringStore.getState().fetchError).toBe('refresh failed')
    })

    it('rejects recurring-rule creation when the linked account currency is invalid after normalization', async () => {
      mockQuery.mockResolvedValueOnce([{ currency: '   ' }])

      await expect(
        useRecurringStore.getState().create({
          description: 'Rent',
          amount: 1500,
          type: 'expense',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC001',
          toAccountId: null,
          categoryId: '01CAT001',
          subcategoryId: null,
          tags: '',
          notes: 'Monthly rent',
        })
      ).rejects.toThrow(
        'Account 01ACC001 has no valid stored currency. Repair the account currency before creating or updating recurring rules.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('rejects unsupported recurring transfers', async () => {
      await expect(
        useRecurringStore.getState().create({
          description: 'Move to savings',
          amount: 100,
          type: 'transfer',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC001',
          toAccountId: null,
          categoryId: null,
          subcategoryId: null,
          tags: '',
          notes: null,
        })
      ).rejects.toThrow(
        'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('update', () => {
    it('persists stored rule currency when moving to a same-currency account', async () => {
      mockQuery
        .mockResolvedValueOnce([
          {
            id: '01RULE001',
            description: 'Rent',
            amount: 150000,
            currency: 'EUR',
            type: 'expense',
            frequency: 'monthly',
            next_date: '2026-04-01',
            end_date: null,
            account_id: '01ACC001',
            to_account_id: null,
            category_id: '01CAT001',
            subcategory_id: null,
            tags: '',
            notes: 'Monthly rent',
            active: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
        .mockResolvedValueOnce([{ currency: 'EUR' }])
        .mockResolvedValueOnce([])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })

      await useRecurringStore.getState().update('01RULE001', {
        description: 'Rent',
        amount: 1500,
        type: 'expense',
        frequency: 'monthly',
        nextDate: '2026-04-01',
        endDate: null,
        accountId: '01ACC002',
        toAccountId: null,
        categoryId: '01CAT001',
        subcategoryId: null,
        tags: '',
        notes: 'Monthly rent',
      })

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining(
          'UPDATE recurring_rules SET description = ?, amount = ?, currency = ?'
        ),
        expect.arrayContaining(['Rent', 150000, 'EUR', 'expense', 'monthly', '2026-04-01'])
      )
    })

    it('rejects cross-currency recurring-rule moves', async () => {
      mockQuery
        .mockResolvedValueOnce([
          {
            id: '01RULE001',
            description: 'Rent',
            amount: 150000,
            currency: 'USD',
            type: 'expense',
            frequency: 'monthly',
            next_date: '2026-04-01',
            end_date: null,
            account_id: '01ACC001',
            to_account_id: null,
            category_id: '01CAT001',
            subcategory_id: null,
            tags: '',
            notes: 'Monthly rent',
            active: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ])
        .mockResolvedValueOnce([{ currency: 'EUR' }])

      await expect(
        useRecurringStore.getState().update('01RULE001', {
          description: 'Rent',
          amount: 1500,
          type: 'expense',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC002',
          toAccountId: null,
          categoryId: '01CAT001',
          subcategoryId: null,
          tags: '',
          notes: 'Monthly rent',
        })
      ).rejects.toThrow(
        'Cannot move this recurring rule from USD to EUR. Cross-currency moves are not supported because they would change amount semantics without FX conversion.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('rejects unsupported recurring transfers on update', async () => {
      await expect(
        useRecurringStore.getState().update('01RULE001', {
          description: 'Move to savings',
          amount: 100,
          type: 'transfer',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC001',
          toAccountId: null,
          categoryId: null,
          subcategoryId: null,
          tags: '',
          notes: null,
        })
      ).rejects.toThrow(
        'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
      )

      expect(mockQuery).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('rejects updating a recurring rule when stored currency is unknown', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Rent',
          amount: 150000,
          currency: null,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-04-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '',
          notes: 'Monthly rent',
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ])

      await expect(
        useRecurringStore.getState().update('01RULE001', {
          description: 'Rent',
          amount: 1500,
          type: 'expense',
          frequency: 'monthly',
          nextDate: '2026-04-01',
          endDate: null,
          accountId: '01ACC001',
          toAccountId: null,
          categoryId: '01CAT001',
          subcategoryId: null,
          tags: '',
          notes: 'Monthly rent',
        })
      ).rejects.toThrow(
        'Recurring rule "Rent" has no stored currency. Repair or recreate the rule before moving or materializing it.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('deletes rule and re-fetches', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useRecurringStore.getState().remove('01RULE001')

      expect(mockExecute).toHaveBeenCalledWith('DELETE FROM recurring_rules WHERE id = ?', [
        '01RULE001',
      ])
    })
  })

  describe('toggleActive', () => {
    it('flips active flag from 1 to 0', async () => {
      useRecurringStore.setState({
        rules: [
          {
            id: '01RULE001',
            description: 'Netflix',
            amount: 1599,
            currency: 'EUR',
            type: 'expense',
            frequency: 'monthly',
            next_date: '2026-04-01',
            end_date: null,
            account_id: '01ACC001',
            to_account_id: null,
            category_id: null,
            subcategory_id: null,
            tags: '',
            notes: null,
            active: 1,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ],
      })

      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([]) // re-fetch

      await useRecurringStore.getState().toggleActive('01RULE001')

      expect(mockExecute).toHaveBeenCalledWith(
        'UPDATE recurring_rules SET active = ?, updated_at = ? WHERE id = ?',
        [0, expect.any(String), '01RULE001']
      )
    })

    it('does nothing for nonexistent rule', async () => {
      useRecurringStore.setState({ rules: [] })

      await useRecurringStore.getState().toggleActive('nonexistent')

      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('materializeTransactions', () => {
    it('uses the data-server materialization endpoint in browser mode', async () => {
      runtimeState.isTauri = false
      mockMaterializeRecurringTransactionsBrowser.mockResolvedValueOnce({
        success: true,
        created: 2,
        message: 'Created 2 transaction(s) from recurring rules.',
      })
      mockQuery.mockResolvedValueOnce([])

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(2)
      expect(mockMaterializeRecurringTransactionsBrowser).toHaveBeenCalledTimes(1)
      expect(mockWithTransaction).not.toHaveBeenCalled()
      expect(mockExecute).not.toHaveBeenCalled()
      expect(mockTxFetch).toHaveBeenCalledTimes(1)
      expect(mockAccountFetch).toHaveBeenCalledTimes(1)
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('creates transactions for due rules and advances next_date', async () => {
      // query for due rules
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: 'USD',
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_currency: 'USD',
        },
      ])

      // For each due date: INSERT transaction, UPDATE account balance, then UPDATE next_date
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
      // re-fetch after done
      mockQuery.mockResolvedValueOnce([]) // transaction fetch
      mockQuery.mockResolvedValueOnce([]) // recurring fetch (self)

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBeGreaterThanOrEqual(1)
      expect(mockWithTransaction).toHaveBeenCalledTimes(1)
      // Should insert transaction
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['01ACC001', '01CAT001', 'expense', 1599, 'USD'])
      )
      // Should update account balance (expense = negative delta)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([-1599, '01ACC001'])
      )
      // Should atomically claim and advance next_date
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE recurring_rules SET active = ?, next_date = ?'),
        [1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), '01RULE001', '2026-03-01']
      )
      // Should refresh related stores
      expect(mockTxFetch).toHaveBeenCalled()
      expect(mockAccountFetch).toHaveBeenCalled()
    })

    it('treats recurring rule and account currencies with casing or whitespace drift as equivalent', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: ' usd ',
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_currency: 'USD',
        },
      ])
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])
      mockQuery.mockResolvedValueOnce([])

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBeGreaterThanOrEqual(1)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['01ACC001', '01CAT001', 'expense', 1599, 'USD'])
      )
      expect(mockTxFetch).toHaveBeenCalled()
      expect(mockAccountFetch).toHaveBeenCalled()
    })

    it('returns 0 when no rules are due', async () => {
      mockQuery.mockResolvedValueOnce([]) // no due rules

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(0)
      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('fails materialization when a legacy rule has unknown currency', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: null,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_currency: 'EUR',
        },
      ])

      await expect(useRecurringStore.getState().materializeTransactions()).rejects.toThrow(
        'Recurring rule "Netflix" has no stored currency. Repair or recreate the rule before moving or materializing it.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
      expect(mockTxFetch).not.toHaveBeenCalled()
      expect(mockAccountFetch).not.toHaveBeenCalled()
    })

    it('fails materialization when stored rule currency no longer matches the linked account currency', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: 'USD',
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_currency: 'EUR',
        },
      ])

      await expect(useRecurringStore.getState().materializeTransactions()).rejects.toThrow(
        'Recurring rule "Netflix" has stored currency USD but the linked account is now EUR. Repair or recreate the rule before materializing it.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
      expect(mockTxFetch).not.toHaveBeenCalled()
      expect(mockAccountFetch).not.toHaveBeenCalled()
    })

    it('fails materialization for any unsupported transfer rule', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Move to savings',
          amount: 1599,
          currency: 'USD',
          type: 'transfer',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: '01ACC002',
          category_id: null,
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
          account_currency: 'USD',
        },
      ])

      await expect(useRecurringStore.getState().materializeTransactions()).rejects.toThrow(
        'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
      )

      expect(mockExecute).not.toHaveBeenCalled()
    })

    it('skips duplicate materialization when another runner already claimed the occurrence', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: 'EUR',
          account_currency: 'EUR',
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ])
      mockExecute.mockResolvedValueOnce({ rowsAffected: 0, lastInsertId: 0 })

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(0)
      expect(mockWithTransaction).toHaveBeenCalledTimes(1)
      expect(mockExecute).toHaveBeenCalledTimes(1)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('WHERE id = ? AND active = 1 AND next_date = ?'),
        [1, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), '01RULE001', '2026-03-01']
      )
      expect(mockTxFetch).not.toHaveBeenCalled()
      expect(mockAccountFetch).not.toHaveBeenCalled()
    })

    it('clears background materialization error after a successful retry', async () => {
      mockQuery.mockRejectedValueOnce(new Error('materialize failed'))

      await expect(useRecurringStore.getState().materializeTransactions()).rejects.toThrow(
        'materialize failed'
      )

      expect(useRecurringStore.getState().error).toBe('materialize failed')
      expect(useRecurringStore.getState().fetchError).toBeNull()

      mockQuery.mockResolvedValueOnce([])

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(0)
      expect(useRecurringStore.getState().error).toBeNull()
    })

    it('keeps partial materialization wrapped for safe retry after a mid-rule failure', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
          currency: 'EUR',
          account_currency: 'EUR',
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-03-01',
          end_date: null,
          account_id: '01ACC001',
          to_account_id: null,
          category_id: '01CAT001',
          subcategory_id: null,
          tags: '[]',
          notes: null,
          active: 1,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ])
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockRejectedValueOnce(new Error('balance update failed'))

      await expect(useRecurringStore.getState().materializeTransactions()).rejects.toThrow(
        'balance update failed'
      )

      expect(mockWithTransaction).toHaveBeenCalledTimes(1)
      expect(useRecurringStore.getState().error).toBe('balance update failed')
      expect(mockTxFetch).not.toHaveBeenCalled()
      expect(mockAccountFetch).not.toHaveBeenCalled()

      mockQuery.mockResolvedValueOnce([])

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(0)
      expect(useRecurringStore.getState().error).toBeNull()
    })
  })

  describe('getById', () => {
    it('returns rule by id', () => {
      const rule = {
        id: '01RULE001',
        description: 'Test',
        amount: 1000,
        currency: 'USD' as const,
        type: 'expense' as const,
        frequency: 'monthly' as const,
        next_date: '2026-04-01',
        end_date: null,
        account_id: '01ACC001',
        to_account_id: null,
        category_id: null,
        subcategory_id: null,
        tags: '',
        notes: null,
        active: 1,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      useRecurringStore.setState({ rules: [rule] })

      expect(useRecurringStore.getState().getById('01RULE001')).toEqual(rule)
      expect(useRecurringStore.getState().getById('nope')).toBeUndefined()
    })
  })
})
