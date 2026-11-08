import {
  resolveBudgetDefinition,
  type ReportScope,
  type ReportWindowInput,
  type ScopedActualBasis,
} from '@shikin/finance-core'
import { create } from 'zustand'
import { execute, withTransaction, type TransactionClient } from '@/lib/database'
import { readScopedSnapshot, projectBudget, type ScopedReferences } from '@/lib/scoped-report-read'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Budget } from '@/types/database'

export type BudgetWithStatus = ReturnType<typeof projectBudget>
export interface BudgetFormData {
  name: string
  categoryId?: string | null
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  currency?: string
  scope?: ReportScope
  basis?: ScopedActualBasis
  isActive?: boolean
  /** Captured DB default; only checked when the user did not explicitly choose currency. */
  expectedMainCurrency?: string
}
export interface BudgetReadOptions extends ReportWindowInput {
  includeInactive?: boolean
  budgetId?: string
}
interface BudgetState {
  references: ScopedReferences
  budgets: BudgetWithStatus[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  options: BudgetReadOptions
  fetch: (options?: BudgetReadOptions) => Promise<void>
  add: (data: BudgetFormData) => Promise<void>
  update: (id: string, data: Partial<BudgetFormData>) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => BudgetWithStatus | undefined
}
async function definition(tx: TransactionClient, data: Partial<BudgetFormData>, stored?: Budget) {
  const main =
    (await tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'"))[0]
      ?.value ?? null
  const [accounts, categories] = await Promise.all([
    tx.query<{ id: string }>('SELECT id FROM accounts'),
    tx.query<{ id: string }>('SELECT id FROM categories'),
  ])
  return resolveBudgetDefinition({
    stored,
    mainCurrency: main,
    references: { accounts, categories },
    patch: {
      ...data,
      ...(data.amount !== undefined ? { amountCentavos: toCentavos(data.amount) } : {}),
    },
  })
}
let request = 0
export const useBudgetStore = create<BudgetState>((set, get) => ({
  references: { accounts: [], categories: [] },
  budgets: [],
  isLoading: false,
  fetchError: null,
  error: null,
  options: {},
  fetch: async (options = get().options) => {
    const owned = ++request
    set({ isLoading: true, fetchError: null, options })
    try {
      const snapshot = await readScopedSnapshot()
      const { includeInactive, budgetId, ...window } = options
      const now = new Date()
      const budgets = snapshot.budgets
        .filter((b) => (budgetId ? b.id === budgetId : includeInactive || b.is_active === 1))
        .map((b) => projectBudget(snapshot, b, { now, ...window }))
      if (owned === request)
        set({
          budgets,
          references: { accounts: snapshot.accounts, categories: snapshot.categories },
        })
    } catch (error) {
      if (owned === request) set({ fetchError: getErrorMessage(error), budgets: [] })
      throw error
    } finally {
      if (owned === request) set({ isLoading: false })
    }
  },
  add: async (data) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const d = await definition(tx, data)
        const now = new Date().toISOString()
        await tx.execute(
          'INSERT INTO budgets (id,name,category_id,amount,period,currency,basis,scope_json,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          [
            generateId(),
            d.name,
            d.category_id,
            d.amount,
            d.period,
            d.currency,
            d.basis,
            d.scope_json,
            d.is_active,
            now,
            now,
          ]
        )
      })
      await get()
        .fetch()
        .catch(() => {})
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
  update: async (id, data) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const stored = (await tx.query<Budget>('SELECT * FROM budgets WHERE id = ?', [id]))[0]
        if (!stored) throw new Error('Budget not found.')
        const d = await definition(tx, data, stored)
        if (Object.entries(d).every(([key, value]) => stored[key as keyof Budget] === value)) return
        await tx.execute(
          'UPDATE budgets SET name=?,category_id=?,amount=?,period=?,currency=?,basis=?,scope_json=?,is_active=?,updated_at=? WHERE id=?',
          [
            d.name,
            d.category_id,
            d.amount,
            d.period,
            d.currency,
            d.basis,
            d.scope_json,
            d.is_active,
            new Date().toISOString(),
            id,
          ]
        )
      })
      await get()
        .fetch()
        .catch(() => {})
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
  remove: async (id) => {
    set({ error: null })
    try {
      await execute('DELETE FROM budgets WHERE id = ?', [id])
      await get()
        .fetch()
        .catch(() => {})
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
  getById: (id) => get().budgets.find((b) => b.id === id),
}))
