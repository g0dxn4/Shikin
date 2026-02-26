import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos, fromCentavos } from '@/lib/money'
import type { Account } from '@/types/database'
import type { AccountType, CurrencyCode } from '@/types/common'

export interface AccountFormData {
  name: string
  type: AccountType
  currency: CurrencyCode
  balance: number
}

interface AccountState {
  accounts: Account[]
  isLoading: boolean
  fetch: () => Promise<void>
  add: (data: AccountFormData) => Promise<void>
  update: (id: string, data: AccountFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Account | undefined
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  isLoading: false,

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
}))

/** Get the decimal balance for display in forms */
export function getAccountBalanceDecimal(account: Account): number {
  return fromCentavos(account.balance)
}
