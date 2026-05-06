import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import type { Category } from '@/types/database'
import type { TransactionType } from '@/types/common'

interface CategoryFormData {
  name: string
  type: TransactionType
  color: string
  icon: string
}

interface CategoryDependencyCounts {
  transactions: number
  budgets: number
  subscriptions: number
  recurringRules: number
  categoryRules: number
  subcategories: number
  transactionSplits: number
}

async function getDependencyCounts(id: string): Promise<CategoryDependencyCounts> {
  const [
    transactions,
    budgets,
    subscriptions,
    recurringRules,
    categoryRules,
    subcategories,
    splits,
  ] = await Promise.all([
    query<{ count: number }>('SELECT COUNT(*) as count FROM transactions WHERE category_id = ?', [
      id,
    ]),
    query<{ count: number }>('SELECT COUNT(*) as count FROM budgets WHERE category_id = ?', [id]),
    query<{ count: number }>('SELECT COUNT(*) as count FROM subscriptions WHERE category_id = ?', [
      id,
    ]),
    query<{ count: number }>(
      'SELECT COUNT(*) as count FROM recurring_rules WHERE category_id = ?',
      [id]
    ),
    query<{ count: number }>('SELECT COUNT(*) as count FROM category_rules WHERE category_id = ?', [
      id,
    ]),
    query<{ count: number }>('SELECT COUNT(*) as count FROM subcategories WHERE category_id = ?', [
      id,
    ]),
    query<{ count: number }>(
      'SELECT COUNT(*) as count FROM transaction_splits WHERE category_id = ?',
      [id]
    ),
  ])

  return {
    transactions: transactions[0]?.count ?? 0,
    budgets: budgets[0]?.count ?? 0,
    subscriptions: subscriptions[0]?.count ?? 0,
    recurringRules: recurringRules[0]?.count ?? 0,
    categoryRules: categoryRules[0]?.count ?? 0,
    subcategories: subcategories[0]?.count ?? 0,
    transactionSplits: splits[0]?.count ?? 0,
  }
}

function hasDependencies(counts: CategoryDependencyCounts): boolean {
  return Object.values(counts).some((count) => count > 0)
}

interface CategoryState {
  categories: Category[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  add: (data: CategoryFormData) => Promise<void>
  update: (id: string, data: CategoryFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Category | undefined
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const categories = await query<Category>(
        'SELECT * FROM categories ORDER BY sort_order ASC, created_at ASC, id ASC'
      )
      set({ categories, fetchError: null })
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
        `INSERT INTO categories (id, name, icon, color, type, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), ?)`,
        [id, data.name, data.icon, data.color, data.type, now]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // Silent refresh failure
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const existingRows = await query<Pick<Category, 'type'>>(
        'SELECT type FROM categories WHERE id = ?',
        [id]
      )
      const existing = existingRows[0]
      if (existing && existing.type !== data.type) {
        const dependencyCounts = await getDependencyCounts(id)
        if (hasDependencies(dependencyCounts)) {
          throw new Error('Category type cannot be changed while the category is in use.')
        }
      }

      const result = await execute(
        `UPDATE categories SET name = ?, icon = ?, color = ?, type = ? WHERE id = ?`,
        [data.name, data.icon, data.color, data.type, id]
      )
      if (result.rowsAffected === 0) {
        throw new Error('Category not found.')
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // Silent refresh failure
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      const result = await execute(
        `DELETE FROM categories
         WHERE id = ?
           AND NOT EXISTS (SELECT 1 FROM transactions WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM budgets WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM recurring_rules WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM category_rules WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM subcategories WHERE category_id = ?)
           AND NOT EXISTS (SELECT 1 FROM transaction_splits WHERE category_id = ?)`,
        [id, id, id, id, id, id, id, id]
      )
      if (result.rowsAffected === 0) {
        const existing = await query<Pick<Category, 'id'>>(
          'SELECT id FROM categories WHERE id = ?',
          [id]
        )
        if (existing.length === 0) {
          throw new Error('Category not found.')
        }
        throw new Error('Category cannot be deleted while it is used by existing data.')
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // Silent refresh failure
    }
  },

  getById: (id) => {
    return get().categories.find((c) => c.id === id)
  },
}))
