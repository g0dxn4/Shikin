import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
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

import { query, execute } from '@/lib/database'
import { useRecurringStore } from '../recurring-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('recurring-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useRecurringStore.setState({ rules: [], isLoading: false })
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
  })

  describe('create', () => {
    it('inserts rule with centavos and next_date', async () => {
      mockExecute.mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
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
          'expense',
          'monthly',
          '2026-04-01',
        ])
      )
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
    it('creates transactions for due rules and advances next_date', async () => {
      // query for due rules
      mockQuery.mockResolvedValueOnce([
        {
          id: '01RULE001',
          description: 'Netflix',
          amount: 1599,
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

      // For each due date: INSERT transaction, UPDATE account balance, then UPDATE next_date
      mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })
      // re-fetch after done
      mockQuery.mockResolvedValueOnce([]) // transaction fetch
      mockQuery.mockResolvedValueOnce([]) // recurring fetch (self)

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBeGreaterThanOrEqual(1)
      // Should insert transaction
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining(['01ACC001', '01CAT001', 'expense', 1599])
      )
      // Should update account balance (expense = negative delta)
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([-1599, '01ACC001'])
      )
      // Should update next_date
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE recurring_rules SET next_date = ?'),
        expect.arrayContaining([expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), '01RULE001'])
      )
      // Should refresh related stores
      expect(mockTxFetch).toHaveBeenCalled()
      expect(mockAccountFetch).toHaveBeenCalled()
    })

    it('returns 0 when no rules are due', async () => {
      mockQuery.mockResolvedValueOnce([]) // no due rules

      const created = await useRecurringStore.getState().materializeTransactions()

      expect(created).toBe(0)
      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('getById', () => {
    it('returns rule by id', () => {
      const rule = {
        id: '01RULE001',
        description: 'Test',
        amount: 1000,
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
