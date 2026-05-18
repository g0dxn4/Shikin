import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Budget } from '@/types/database'
import dayjs from 'dayjs'

export interface BudgetWithStatus extends Budget {
  categoryName: string
  categoryColor: string
  spent: number
  remaining: number
  percentUsed: number
}

interface BudgetFormData {
  name: string
  categoryId: string
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
}

interface BudgetState {
  budgets: BudgetWithStatus[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  add: (data: BudgetFormData) => Promise<void>
  update: (id: string, data: BudgetFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => BudgetWithStatus | undefined
}

function getPeriodDateRange(period: string): { start: string; end: string } {
  const today = dayjs()
  switch (period) {
    case 'weekly':
      return {
        start: today.startOf('week').format('YYYY-MM-DD'),
        end: today.format('YYYY-MM-DD'),
      }
    case 'yearly':
      return {
        start: today.startOf('year').format('YYYY-MM-DD'),
        end: today.format('YYYY-MM-DD'),
      }
    case 'monthly':
    default:
      return {
        start: today.startOf('month').format('YYYY-MM-DD'),
        end: today.format('YYYY-MM-DD'),
      }
  }
}

export const useBudgetStore = create<BudgetState>((set, get) => ({
  budgets: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const weeklyRange = getPeriodDateRange('weekly')
      const monthlyRange = getPeriodDateRange('monthly')
      const yearlyRange = getPeriodDateRange('yearly')
      const raw = await query<
        Budget & { category_name: string | null; category_color: string | null; spent: number }
      >(
        `SELECT b.*, c.name as category_name, c.color as category_color,
                COALESCE(SUM(t.amount), 0) as spent
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         LEFT JOIN transactions t ON t.category_id = b.category_id
          AND t.type = 'expense'
          AND COALESCE(NULLIF(TRIM(t.status), ''), 'posted') IN ('posted', 'cleared')
          AND (
            (b.period = 'weekly' AND t.date >= ? AND t.date <= ?) OR
            (b.period = 'monthly' AND t.date >= ? AND t.date <= ?) OR
            (b.period = 'yearly' AND t.date >= ? AND t.date <= ?)
          )
         WHERE b.is_active = 1
         GROUP BY b.id
         ORDER BY b.created_at DESC`,
        [
          weeklyRange.start,
          weeklyRange.end,
          monthlyRange.start,
          monthlyRange.end,
          yearlyRange.start,
          yearlyRange.end,
        ]
      )

      const budgets: BudgetWithStatus[] = raw.map((b) => {
        const spent = b.spent ?? 0
        const remaining = b.amount - spent
        const percentUsed = b.amount > 0 ? Math.round((spent / b.amount) * 100) : 0

        return {
          ...b,
          categoryName: b.category_name ?? 'Uncategorized',
          categoryColor: b.category_color ?? '#6b7280',
          spent,
          remaining,
          percentUsed,
        }
      })

      set({ budgets, fetchError: null })
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
        `INSERT INTO budgets (id, category_id, name, amount, period, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, data.categoryId, data.name, toCentavos(data.amount), data.period, now, now]
      )
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
      await execute(
        `UPDATE budgets SET name = ?, category_id = ?, amount = ?, period = ?, updated_at = ? WHERE id = ?`,
        [data.name, data.categoryId, toCentavos(data.amount), data.period, now, id]
      )
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
      await execute('DELETE FROM budgets WHERE id = ?', [id])
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
    return get().budgets.find((b) => b.id === id)
  },
}))
