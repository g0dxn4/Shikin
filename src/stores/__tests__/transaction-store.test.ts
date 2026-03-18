import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  runInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TESTTX000000000000000000'),
}))

vi.mock('@/lib/split-service', () => ({
  getSplitTransactionIds: vi.fn().mockResolvedValue(new Set()),
  getSplits: vi.fn().mockResolvedValue([]),
  createSplits: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auto-categorize', () => ({
  learnFromTransaction: vi.fn().mockResolvedValue(undefined),
}))

// Mock account store to prevent cross-store fetch issues
const mockAccountFetch = vi.fn()
vi.mock('../account-store', () => ({
  useAccountStore: {
    getState: () => ({ fetch: mockAccountFetch }),
  },
}))

import { query, execute } from '@/lib/database'
import { useTransactionStore } from '../transaction-store'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('transaction-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useTransactionStore.setState({ transactions: [], isLoading: false })
  })

  describe('fetch', () => {
    it('loads transactions with joined names', async () => {
      const mockTxns = [
        {
          id: '01TX001',
          account_id: '01ACC001',
          category_id: '01CAT001',
          type: 'expense',
          amount: 2500,
          currency: 'USD',
          description: 'Lunch',
          notes: null,
          date: '2024-01-15',
          tags: '[]',
          is_recurring: 0,
          transfer_to_account_id: null,
          created_at: '2024-01-15T12:00:00Z',
          updated_at: '2024-01-15T12:00:00Z',
          account_name: 'Checking',
          category_name: 'Food & Dining',
          category_color: '#f97316',
        },
      ]
      mockQuery.mockResolvedValueOnce(mockTxns)

      await useTransactionStore.getState().fetch()

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LEFT JOIN accounts'))
      expect(useTransactionStore.getState().transactions).toEqual(mockTxns)
    })
  })

  describe('add', () => {
    it('inserts transaction and updates account balance for expense', async () => {
      // execute: insert transaction, update account balance
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      // query: re-fetch transactions
      mockQuery.mockResolvedValueOnce([])

      await useTransactionStore.getState().add({
        amount: 25.5,
        type: 'expense',
        description: 'Groceries',
        categoryId: '01CAT001',
        accountId: '01ACC001',
        transferToAccountId: null,
        currency: 'USD',
        date: '2024-01-15',
        notes: null,
      })

      // Insert transaction with centavos
      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO transactions'),
        expect.arrayContaining([
          '01TESTTX000000000000000000',
          '01ACC001',
          '01CAT001',
          'expense',
          2550, // 25.50 * 100
        ])
      )

      // Expense should decrease balance (negative delta)
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([-2550, expect.any(String), '01ACC001'])
      )

      // Should refresh account store
      expect(mockAccountFetch).toHaveBeenCalled()
    })

    it('inserts transaction and updates account balance for income', async () => {
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useTransactionStore.getState().add({
        amount: 3000,
        type: 'income',
        description: 'Salary',
        categoryId: null,
        accountId: '01ACC001',
        transferToAccountId: null,
        currency: 'USD',
        date: '2024-01-31',
        notes: null,
      })

      // Income should increase balance (positive delta)
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([300000, expect.any(String), '01ACC001'])
      )
    })
  })

  describe('update', () => {
    it('reverses old balance impact and applies new one', async () => {
      // Set up existing transaction in store
      useTransactionStore.setState({
        transactions: [
          {
            id: '01TX001',
            account_id: '01ACC001',
            category_id: '01CAT001',
            subcategory_id: null,
            type: 'expense',
            amount: 2500, // 25.00 in centavos
            currency: 'USD',
            description: 'Old lunch',
            notes: null,
            date: '2024-01-15',
            tags: '[]',
            is_recurring: 0,
            transfer_to_account_id: null,
            created_at: '2024-01-15T12:00:00Z',
            updated_at: '2024-01-15T12:00:00Z',
          },
        ],
      })

      // reverse old balance, update tx row, apply new balance
      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useTransactionStore.getState().update('01TX001', {
        amount: 35,
        type: 'expense',
        description: 'Updated lunch',
        categoryId: '01CAT001',
        accountId: '01ACC001',
        transferToAccountId: null,
        currency: 'USD',
        date: '2024-01-15',
        notes: 'with tip',
      })

      // First execute: reverse old balance (expense was -2500, so reverse is +2500)
      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([2500])
      )

      // Second execute: update the transaction row
      expect(mockExecute).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE transactions SET'),
        expect.arrayContaining([3500]) // 35 * 100
      )

      // Third execute: apply new balance (expense = -3500)
      expect(mockExecute).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([-3500])
      )
    })

    it('does nothing if transaction not found', async () => {
      useTransactionStore.setState({ transactions: [] })

      await useTransactionStore.getState().update('nonexistent', {
        amount: 10,
        type: 'expense',
        description: 'test',
        categoryId: null,
        accountId: '01ACC001',
        transferToAccountId: null,
        currency: 'USD',
        date: '2024-01-01',
        notes: null,
      })

      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('reverses balance impact and deletes transaction', async () => {
      useTransactionStore.setState({
        transactions: [
          {
            id: '01TX001',
            account_id: '01ACC001',
            category_id: null,
            subcategory_id: null,
            type: 'income',
            amount: 500000, // $5000
            currency: 'USD',
            description: 'Salary',
            notes: null,
            date: '2024-01-31',
            tags: '[]',
            is_recurring: 0,
            transfer_to_account_id: null,
            created_at: '2024-01-31T00:00:00Z',
            updated_at: '2024-01-31T00:00:00Z',
          },
        ],
      })

      mockExecute
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
        .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 0 })
      mockQuery.mockResolvedValueOnce([])

      await useTransactionStore.getState().remove('01TX001')

      // Reverse income: -500000
      expect(mockExecute).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('UPDATE accounts SET balance = balance + ?'),
        expect.arrayContaining([-500000])
      )

      // Delete the row
      expect(mockExecute).toHaveBeenNthCalledWith(2, 'DELETE FROM transactions WHERE id = ?', [
        '01TX001',
      ])

      expect(mockAccountFetch).toHaveBeenCalled()
    })

    it('does nothing if transaction not found', async () => {
      useTransactionStore.setState({ transactions: [] })

      await useTransactionStore.getState().remove('nonexistent')

      expect(mockExecute).not.toHaveBeenCalled()
    })
  })

  describe('getById', () => {
    it('returns transaction by id', () => {
      const tx = {
        id: '01TX001',
        account_id: '01ACC001',
        category_id: null,
        subcategory_id: null,
        type: 'expense' as const,
        amount: 1000,
        currency: 'USD',
        description: 'Test',
        notes: null,
        date: '2024-01-01',
        tags: '[]',
        is_recurring: 0,
        transfer_to_account_id: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      }
      useTransactionStore.setState({ transactions: [tx] })

      expect(useTransactionStore.getState().getById('01TX001')).toEqual(tx)
      expect(useTransactionStore.getState().getById('nope')).toBeUndefined()
    })
  })
})
