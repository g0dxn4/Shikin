import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos, fromCentavos } from '@/lib/money'
import type { Account } from '@/types/database'
import type { AccountType, CurrencyCode } from '@/types/common'
import dayjs from 'dayjs'

export interface AccountFormData {
  name: string
  type: AccountType
  currency: CurrencyCode
  balance: number
}

export interface BalanceHistoryPoint {
  date: string
  balance: number // centavos
}

interface AccountState {
  accounts: Account[]
  archivedAccounts: Account[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  balanceHistory: Map<string, BalanceHistoryPoint[]>
  fetch: () => Promise<void>
  add: (data: AccountFormData) => Promise<void>
  update: (id: string, data: AccountFormData) => Promise<void>
  archive: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Account | undefined
  /** Snapshot current balances for all active accounts (one per day, upserts) */
  snapshotBalances: () => Promise<void>
  /** Load balance history for a specific account */
  loadBalanceHistory: (accountId: string, months?: number) => Promise<BalanceHistoryPoint[]>
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  archivedAccounts: [],
  isLoading: false,
  fetchError: null,
  error: null,
  balanceHistory: new Map(),

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const allAccounts = await query<Account>(
        'SELECT * FROM accounts ORDER BY is_archived ASC, created_at DESC'
      )
      set({
        accounts: allAccounts.filter((account) => account.is_archived === 0),
        archivedAccounts: allAccounts.filter((account) => account.is_archived === 1),
        fetchError: null,
      })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      await execute(
        `INSERT INTO accounts (id, name, type, currency, balance, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, data.name, data.type, data.currency, toCentavos(data.balance), now, now]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const now = new Date().toISOString()
      await execute(
        `UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, updated_at = ? WHERE id = ?`,
        [data.name, data.type, data.currency, toCentavos(data.balance), now, id]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  archive: async (id) => {
    set({ error: null })
    try {
      await execute('UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        id,
      ])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  unarchive: async (id) => {
    set({ error: null })
    try {
      await execute('UPDATE accounts SET is_archived = 0, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        id,
      ])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await execute('DELETE FROM accounts WHERE id = ?', [id])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  getById: (id) => {
    return [...get().accounts, ...get().archivedAccounts].find((a) => a.id === id)
  },

  snapshotBalances: async () => {
    set({ error: null })
    try {
      const { accounts } = get()
      const today = dayjs().format('YYYY-MM-DD')

      for (const acc of accounts) {
        const existing = await query<{ id: string }>(
          'SELECT id FROM account_balance_history WHERE account_id = ? AND date = ?',
          [acc.id, today]
        )

        if (existing.length > 0) {
          await execute(
            'UPDATE account_balance_history SET balance = ? WHERE account_id = ? AND date = ?',
            [acc.balance, acc.id, today]
          )
        } else {
          await execute(
            'INSERT INTO account_balance_history (id, account_id, date, balance) VALUES (?, ?, ?, ?)',
            [generateId(), acc.id, today, acc.balance]
          )
        }
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  loadBalanceHistory: async (accountId, months = 6) => {
    try {
      const startDate = dayjs().subtract(months, 'month').format('YYYY-MM-DD')
      const rows = await query<BalanceHistoryPoint>(
        'SELECT date, balance FROM account_balance_history WHERE account_id = ? AND date >= ? ORDER BY date ASC',
        [accountId, startDate]
      )
      set((s) => {
        const newMap = new Map(s.balanceHistory)
        newMap.set(accountId, rows)
        return { balanceHistory: newMap }
      })
      return rows
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
}))

/** Get the decimal balance for display in forms */
export function getAccountBalanceDecimal(account: Account): number {
  return fromCentavos(account.balance)
}
