import { create } from 'zustand'
import { query, execute, runInTransaction } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { learnFromTransaction } from '@/lib/auto-categorize'
import { useAccountStore } from './account-store'
import type { Transaction } from '@/types/database'
import type { TransactionType, CurrencyCode } from '@/types/common'

export interface TransactionFormData {
  amount: number
  type: TransactionType
  description: string
  categoryId: string | null
  accountId: string
  transferToAccountId: string | null
  currency: CurrencyCode
  date: string
  notes: string | null
}

interface MutationOptions {
  skipRefresh?: boolean
}

/** Transaction row with joined display names */
export interface TransactionWithDetails extends Transaction {
  account_name?: string
  transfer_to_account_name?: string
  category_name?: string
  category_color?: string
}

interface TransactionState {
  transactions: TransactionWithDetails[]
  isLoading: boolean
  fetch: () => Promise<void>
  add: (data: TransactionFormData, options?: MutationOptions) => Promise<void>
  update: (id: string, data: TransactionFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => TransactionWithDetails | undefined
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true })
    try {
      const transactions = await query<TransactionWithDetails>(
        `SELECT t.*, a.name as account_name, c.name as category_name, c.color as category_color,
                ta.name as transfer_to_account_name
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
         ORDER BY t.date DESC, t.created_at DESC`
      )
      set({ transactions })
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data, options) => {
    await runInTransaction(async () => {
      const id = generateId()
      const now = new Date().toISOString()
      const amountCentavos = toCentavos(data.amount)
      const isTransfer = data.type === 'transfer' && !!data.transferToAccountId

      await execute(
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.accountId,
          isTransfer ? null : data.categoryId,
          isTransfer ? data.transferToAccountId : null,
          data.type,
          amountCentavos,
          data.currency,
          data.description,
          data.notes,
          data.date,
          now,
          now,
        ]
      )

      if (isTransfer && data.transferToAccountId) {
        await execute('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?', [
          amountCentavos,
          now,
          data.accountId,
        ])
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          amountCentavos,
          now,
          data.transferToAccountId,
        ])
      } else {
        const balanceDelta = data.type === 'income' ? amountCentavos : -amountCentavos
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          balanceDelta,
          now,
          data.accountId,
        ])
      }
    })

    // Learn categorization from this transaction
    if (data.categoryId && data.description) {
      learnFromTransaction(data.description, data.categoryId).catch(() => {})
    }

    if (!options?.skipRefresh) {
      await get().fetch()
      await useAccountStore.getState().fetch()
    }
  },

  update: async (id, data) => {
    const existing = get().getById(id)
    if (!existing) return

    await runInTransaction(async () => {
      const now = new Date().toISOString()
      const newAmountCentavos = toCentavos(data.amount)
      const oldIsTransfer = existing.type === 'transfer' && !!existing.transfer_to_account_id
      const newIsTransfer = data.type === 'transfer' && !!data.transferToAccountId

      if (oldIsTransfer && existing.transfer_to_account_id) {
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          existing.amount,
          now,
          existing.account_id,
        ])
        await execute('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?', [
          existing.amount,
          now,
          existing.transfer_to_account_id,
        ])
      } else {
        const oldDelta = existing.type === 'income' ? -existing.amount : existing.amount
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          oldDelta,
          now,
          existing.account_id,
        ])
      }

      await execute(
        `UPDATE transactions SET account_id = ?, category_id = ?, transfer_to_account_id = ?, type = ?, amount = ?, currency = ?, description = ?, notes = ?, date = ?, updated_at = ?
          WHERE id = ?`,
        [
          data.accountId,
          newIsTransfer ? null : data.categoryId,
          newIsTransfer ? data.transferToAccountId : null,
          data.type,
          newAmountCentavos,
          data.currency,
          data.description,
          data.notes,
          data.date,
          now,
          id,
        ]
      )

      if (newIsTransfer && data.transferToAccountId) {
        await execute('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?', [
          newAmountCentavos,
          now,
          data.accountId,
        ])
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          newAmountCentavos,
          now,
          data.transferToAccountId,
        ])
      } else {
        const newDelta = data.type === 'income' ? newAmountCentavos : -newAmountCentavos
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          newDelta,
          now,
          data.accountId,
        ])
      }
    })

    await get().fetch()
    await useAccountStore.getState().fetch()
  },

  remove: async (id) => {
    const existing = get().getById(id)
    if (!existing) return

    await runInTransaction(async () => {
      const now = new Date().toISOString()

      if (existing.type === 'transfer' && existing.transfer_to_account_id) {
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          existing.amount,
          now,
          existing.account_id,
        ])
        await execute('UPDATE accounts SET balance = balance - ?, updated_at = ? WHERE id = ?', [
          existing.amount,
          now,
          existing.transfer_to_account_id,
        ])
      } else {
        const reverseDelta = existing.type === 'income' ? -existing.amount : existing.amount
        await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
          reverseDelta,
          now,
          existing.account_id,
        ])
      }

      await execute('DELETE FROM transactions WHERE id = ?', [id])
    })

    await get().fetch()
    await useAccountStore.getState().fetch()
  },

  getById: (id) => {
    return get().transactions.find((t) => t.id === id)
  },
}))
