import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Goal } from '@/types/database'
import dayjs from 'dayjs'

export interface GoalWithProgress extends Goal {
  accountName: string | null
  progress: number
  daysRemaining: number | null
  monthlyNeeded: number
}

export interface GoalFormData {
  name: string
  targetAmount: number
  currentAmount: number
  deadline: string | null
  accountId: string | null
  icon: string
  color: string
  notes: string | null
}

interface GoalState {
  goals: GoalWithProgress[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  add: (data: GoalFormData) => Promise<void>
  update: (id: string, data: GoalFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => GoalWithProgress | undefined
}

function computeProgress(current: number, target: number): number {
  if (target <= 0) return 0
  return Math.min(Math.round((current / target) * 100), 100)
}

function computeDaysRemaining(deadline: string | null): number | null {
  if (!deadline) return null
  const diff = dayjs(deadline).diff(dayjs(), 'day')
  return Math.max(0, diff)
}

function computeMonthlyNeeded(current: number, target: number, deadline: string | null): number {
  const remaining = target - current
  if (remaining <= 0) return 0
  if (!deadline) return 0
  const monthsLeft = dayjs(deadline).diff(dayjs(), 'month', true)
  if (monthsLeft <= 0) return remaining
  return Math.ceil(remaining / monthsLeft)
}

export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const raw = await query<Goal & { account_name: string | null }>(
        `SELECT g.*, a.name as account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         ORDER BY g.created_at DESC`
      )

      const goals: GoalWithProgress[] = raw.map((g) => ({
        ...g,
        accountName: g.account_name,
        progress: computeProgress(g.current_amount, g.target_amount),
        daysRemaining: computeDaysRemaining(g.deadline),
        monthlyNeeded: computeMonthlyNeeded(g.current_amount, g.target_amount, g.deadline),
      }))

      set({ goals, fetchError: null })
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
        `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          data.name,
          toCentavos(data.targetAmount),
          toCentavos(data.currentAmount),
          data.deadline,
          data.accountId,
          data.icon,
          data.color,
          data.notes,
          now,
          now,
        ]
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
        `UPDATE goals SET name = ?, target_amount = ?, current_amount = ?, deadline = ?, account_id = ?, icon = ?, color = ?, notes = ?, updated_at = ? WHERE id = ?`,
        [
          data.name,
          toCentavos(data.targetAmount),
          toCentavos(data.currentAmount),
          data.deadline,
          data.accountId,
          data.icon,
          data.color,
          data.notes,
          now,
          id,
        ]
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
      await execute('DELETE FROM goals WHERE id = ?', [id])
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
    return get().goals.find((g) => g.id === id)
  },
}))
