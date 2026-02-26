import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { useAccountStore } from './account-store'
import type { Transaction } from '@/types/database'
import type { TransactionType, CurrencyCode } from '@/types/common'

export interface TransactionFormData {
  amount: number
  type: TransactionType
  description: string
  categoryId: string | null
  accountId: string
  currency: CurrencyCode
  date: string
  notes: string | null
}

/** Transaction row with joined display names */
export interface TransactionWithDetails extends Transaction {
  account_name?: string
  category_name?: string
  category_color?: string
}

interface TransactionState {
  transactions: TransactionWithDetails[]
  isLoading: boolean
  fetch: () => Promise<void>
  add: (data: TransactionFormData) => Promise<void>
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
        `SELECT t.*, a.name as account_name, c.name as category_name, c.color as category_color
         FROM transactions t
         LEFT JOIN accounts a ON t.account_id = a.id
         LEFT JOIN categories c ON t.category_id = c.id
         ORDER BY t.date DESC, t.created_at DESC`
      )
      set({ transactions })
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    const id = generateId()
    const now = new Date().toISOString()
    const amountCentavos = toCentavos(data.amount)

    await execute(
      `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.accountId,
        data.categoryId,
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

    // Update account balance
    const balanceDelta = data.type === 'income' ? amountCentavos : -amountCentavos
    await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
      balanceDelta,
      now,
      data.accountId,
    ])

    await get().fetch()
    await useAccountStore.getState().fetch()
  },

  update: async (id, data) => {
    const existing = get().getById(id)
    if (!existing) return

    const now = new Date().toISOString()
    const newAmountCentavos = toCentavos(data.amount)

    // Reverse old balance impact
    const oldDelta = existing.type === 'income' ? -existing.amount : existing.amount
    await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
      oldDelta,
      now,
      existing.account_id,
    ])

    // If account changed, also reverse from old account (already done above)
    // and apply to new account below

    // Update the transaction row
    await execute(
      `UPDATE transactions SET account_id = ?, category_id = ?, type = ?, amount = ?, currency = ?, description = ?, notes = ?, date = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.accountId,
        data.categoryId,
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

    // Apply new balance impact
    const newDelta = data.type === 'income' ? newAmountCentavos : -newAmountCentavos
    await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
      newDelta,
      now,
      data.accountId,
    ])

    await get().fetch()
    await useAccountStore.getState().fetch()
  },

  remove: async (id) => {
    const existing = get().getById(id)
    if (!existing) return

    const now = new Date().toISOString()

    // Reverse balance impact
    const reverseDelta = existing.type === 'income' ? -existing.amount : existing.amount
    await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
      reverseDelta,
      now,
      existing.account_id,
    ])

    await execute('DELETE FROM transactions WHERE id = ?', [id])

    await get().fetch()
    await useAccountStore.getState().fetch()
  },

  getById: (id) => {
    return get().transactions.find((t) => t.id === id)
  },
}))
