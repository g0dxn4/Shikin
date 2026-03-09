import { create } from 'zustand'
import { query, execute } from '@/lib/database'
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

export interface BudgetFormData {
  name: string
  categoryId: string | null
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
}

interface BudgetState {
  budgets: BudgetWithStatus[]
  isLoading: boolean
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
        start: today.subtract(6, 'day').format('YYYY-MM-DD'),
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

  fetch: async () => {
    set({ isLoading: true })
    try {
      const raw = await query<Budget & { category_name: string | null; category_color: string | null }>(
        `SELECT b.*, c.name as category_name, c.color as category_color
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.is_active = 1
         ORDER BY b.created_at DESC`
      )

      const budgets: BudgetWithStatus[] = await Promise.all(
        raw.map(async (b) => {
          const { start, end } = getPeriodDateRange(b.period)

          const result = await query<{ total: number | null }>(
            `SELECT COALESCE(SUM(t.amount), 0) as total
             FROM transactions t
             WHERE t.category_id = ?
               AND t.type = 'expense'
               AND t.date >= ?
               AND t.date <= ?`,
            [b.category_id, start, end]
          )

          const spent = result[0]?.total ?? 0
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
      )

      set({ budgets })
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    const id = generateId()
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO budgets (id, category_id, name, amount, period, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, data.categoryId, data.name, toCentavos(data.amount), data.period, now, now]
    )
    await get().fetch()
  },

  update: async (id, data) => {
    const now = new Date().toISOString()
    await execute(
      `UPDATE budgets SET name = ?, category_id = ?, amount = ?, period = ?, updated_at = ? WHERE id = ?`,
      [data.name, data.categoryId, toCentavos(data.amount), data.period, now, id]
    )
    await get().fetch()
  },

  remove: async (id) => {
    await execute('DELETE FROM budgets WHERE id = ?', [id])
    await get().fetch()
  },

  getById: (id) => {
    return get().budgets.find((b) => b.id === id)
  },
}))
