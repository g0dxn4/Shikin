import { create } from 'zustand'
import { query, withTransaction } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Receivable } from '@/types/database'
import type { CurrencyCode } from '@/types/common'
import dayjs from 'dayjs'

export type ReceivableStatus = Receivable['status']

export interface ReceivableWithDetails extends Receivable {
  accountName: string | null
  accountCurrency: CurrencyCode | null
  isOverdue: boolean
  remainingAmount: number
}

export interface ReceivableFormData {
  payer: string
  amount: number
  currency: CurrencyCode
  dueDate: string
  projectReference: string | null
  invoiceReference: string | null
  accountId: string | null
  notes: string | null
}

interface ReceivableState {
  receivables: ReceivableWithDetails[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  create: (data: ReceivableFormData) => Promise<void>
  update: (id: string, data: ReceivableFormData) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => ReceivableWithDetails | undefined
}

function deriveStatus(receivedAmount: number, amount: number): ReceivableStatus {
  if (receivedAmount <= 0) return 'open'
  if (receivedAmount >= amount) return 'received'
  return 'partial'
}

function computeIsOverdue(dueDate: string, status: ReceivableStatus): boolean {
  if (status === 'received' || status === 'cancelled') return false
  return dayjs(dueDate).isBefore(dayjs(), 'day')
}

function computeRemaining(amount: number, receivedAmount: number): number {
  return Math.max(0, amount - receivedAmount)
}

export const useReceivableStore = create<ReceivableState>((set, get) => ({
  receivables: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const raw = await query<
        Receivable & { account_name: string | null; account_currency: CurrencyCode | null }
      >(
        `SELECT r.*, a.name as account_name, a.currency as account_currency
         FROM receivables r
         LEFT JOIN accounts a ON r.account_id = a.id
         ORDER BY r.due_date ASC, r.created_at DESC`
      )

      const receivables: ReceivableWithDetails[] = raw.map((r) => ({
        ...r,
        accountName: r.account_name,
        accountCurrency: r.account_currency,
        isOverdue: computeIsOverdue(r.due_date, r.status),
        remainingAmount: computeRemaining(r.amount, r.received_amount),
      }))

      set({ receivables, fetchError: null })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  create: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const amountCentavos = toCentavos(data.amount)
      await withTransaction(async (tx) => {
        if (data.accountId) {
          const accounts = await tx.query<{ currency: string; is_archived: number }>(
            'SELECT currency, is_archived FROM accounts WHERE id = ? LIMIT 1',
            [data.accountId]
          )
          if (!accounts[0] || accounts[0].is_archived !== 0) {
            throw new Error('The linked account is unavailable or archived.')
          }
          if (accounts[0].currency.trim().toUpperCase() !== data.currency.trim().toUpperCase()) {
            throw new Error('Receivable currency must match the linked account currency.')
          }
        }
        await tx.execute(
          `INSERT INTO receivables
             (id, payer, amount, received_amount, currency, due_date, project_reference, invoice_reference, status, account_id, matched_transaction_id, notes, source, note, created_at, updated_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, ?, 'open', ?, NULL, ?, NULL, NULL, ?, ?)`,
          [
            id,
            data.payer,
            amountCentavos,
            data.currency.trim().toUpperCase(),
            data.dueDate,
            data.projectReference,
            data.invoiceReference,
            data.accountId,
            data.notes,
            now,
            now,
          ]
        )
      })
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was written successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const now = new Date().toISOString()
      const amountCentavos = toCentavos(data.amount)
      await withTransaction(async (tx) => {
        const existingRows = await tx.query<Receivable>(
          'SELECT * FROM receivables WHERE id = ? LIMIT 1',
          [id]
        )
        const existing = existingRows[0]
        if (!existing) throw new Error(`Receivable ${id} not found.`)
        const normalizedCurrency = data.currency.trim().toUpperCase()
        if (
          existing.received_amount > 0 &&
          (amountCentavos !== existing.amount ||
            normalizedCurrency !== existing.currency.trim().toUpperCase() ||
            data.accountId !== existing.account_id)
        ) {
          throw new Error(
            'Amount, currency, and account cannot change after a receipt is recorded.'
          )
        }
        if (amountCentavos < existing.received_amount) {
          throw new Error('Amount cannot be less than the amount already received.')
        }
        if (data.accountId) {
          const accounts = await tx.query<{ currency: string; is_archived: number }>(
            'SELECT currency, is_archived FROM accounts WHERE id = ? LIMIT 1',
            [data.accountId]
          )
          if (!accounts[0] || accounts[0].is_archived !== 0) {
            throw new Error('The linked account is unavailable or archived.')
          }
          if (accounts[0].currency.trim().toUpperCase() !== normalizedCurrency) {
            throw new Error('Receivable currency must match the linked account currency.')
          }
        }
        const status =
          existing.status === 'cancelled'
            ? 'cancelled'
            : deriveStatus(existing.received_amount, amountCentavos)
        const result = await tx.execute(
          `UPDATE receivables
           SET payer = ?, amount = ?, currency = ?, due_date = ?, project_reference = ?,
               invoice_reference = ?, status = ?, account_id = ?, notes = ?, updated_at = ?
           WHERE id = ? AND status = ? AND received_amount = ?
             AND matched_transaction_id IS ? AND updated_at = ?`,
          [
            data.payer,
            amountCentavos,
            normalizedCurrency,
            data.dueDate,
            data.projectReference,
            data.invoiceReference,
            status,
            data.accountId,
            data.notes,
            now,
            id,
            existing.status,
            existing.received_amount,
            existing.matched_transaction_id,
            existing.updated_at,
          ]
        )
        if (result.rowsAffected !== 1)
          throw new Error('Receivable changed while it was being edited.')
      })
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was written successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  cancel: async (id) => {
    set({ error: null })
    try {
      const now = new Date().toISOString()
      await withTransaction(async (tx) => {
        const rows = await tx.query<Receivable>('SELECT * FROM receivables WHERE id = ? LIMIT 1', [
          id,
        ])
        const existing = rows[0]
        if (!existing) throw new Error(`Receivable ${id} not found.`)
        if (existing.status === 'received' || existing.received_amount > 0) {
          throw new Error('A receivable with recorded receipts cannot be cancelled.')
        }
        if (existing.status === 'cancelled') return
        const result = await tx.execute(
          `UPDATE receivables SET status = 'cancelled', updated_at = ?
           WHERE id = ? AND status = ? AND received_amount = 0
             AND matched_transaction_id IS NULL AND updated_at = ?`,
          [now, id, existing.status, existing.updated_at]
        )
        if (result.rowsAffected !== 1)
          throw new Error('Receivable changed while it was being cancelled.')
      })
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was written successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const rows = await tx.query<Receivable>('SELECT * FROM receivables WHERE id = ? LIMIT 1', [
          id,
        ])
        const existing = rows[0]
        if (!existing) throw new Error(`Receivable ${id} not found.`)
        if (existing.matched_transaction_id || existing.received_amount > 0) {
          throw new Error('Receivables with recorded receipts cannot be deleted.')
        }
        const result = await tx.execute(
          `DELETE FROM receivables
           WHERE id = ? AND received_amount = 0 AND matched_transaction_id IS NULL
             AND status = ? AND updated_at = ?`,
          [id, existing.status, existing.updated_at]
        )
        if (result.rowsAffected !== 1)
          throw new Error('Receivable changed while it was being deleted.')
      })
      // Refresh optimistically; don't fail the mutation if refresh fails
      try {
        await get().fetch()
      } catch {
        // Silent refresh failure - data was deleted successfully
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  getById: (id) => {
    return get().receivables.find((r) => r.id === id)
  },
}))
