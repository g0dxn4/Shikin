import { create } from 'zustand'
import { query, execute } from '@/lib/database'
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
  isLoading: boolean
  balanceHistory: Map<string, BalanceHistoryPoint[]>
  fetch: () => Promise<void>
  add: (data: AccountFormData) => Promise<void>
  update: (id: string, data: AccountFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Account | undefined
  /** Snapshot current balances for all active accounts (one per day, upserts) */
  snapshotBalances: () => Promise<void>
  /** Load balance history for a specific account */
  loadBalanceHistory: (accountId: string, months?: number) => Promise<BalanceHistoryPoint[]>
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  isLoading: false,
  balanceHistory: new Map(),

  fetch: async () => {
    set({ isLoading: true })
    try {
      const accounts = await query<Account>(
        'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY created_at DESC'
      )
      set({ accounts })
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    const id = generateId()
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      [id, data.name, data.type, data.currency, toCentavos(data.balance), now, now]
    )
    await get().fetch()
  },

  update: async (id, data) => {
    const now = new Date().toISOString()
    await execute(
      `UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, updated_at = ? WHERE id = ?`,
      [data.name, data.type, data.currency, toCentavos(data.balance), now, id]
    )
    await get().fetch()
  },

  remove: async (id) => {
    await execute('DELETE FROM accounts WHERE id = ?', [id])
    await get().fetch()
  },

  getById: (id) => {
    return get().accounts.find((a) => a.id === id)
  },

  snapshotBalances: async () => {
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
  },

  loadBalanceHistory: async (accountId, months = 6) => {
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
  },
}))

/** Get the decimal balance for display in forms */
export function getAccountBalanceDecimal(account: Account): number {
  return fromCentavos(account.balance)
}
