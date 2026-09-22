import { assertFxCurrency } from '@shikin/finance-core/fx'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { query, execute, withTransaction, type TransactionClient } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Goal } from '@/types/database'
import { useCurrencyStore, type PreferredCurrencyAmountResult } from './currency-store'
import {
  captureCurrencyAuthority,
  convertWithCurrencyAuthority,
  currencyAuthorityKey,
} from './currency-authority'

export interface GoalMainConversion {
  complete: boolean
  policy: 'recorded_goal_value_today'
  toCurrency: string | null
  target: PreferredCurrencyAmountResult
  saved: PreferredCurrencyAmountResult
  reason: 'main_currency_unconfigured' | 'missing_exchange_rates' | null
}

export interface GoalWithProgress extends Goal {
  currency: Goal['currency'] & string
  accountName: string | null
  progress: number
  daysRemaining: number | null
  monthlyNeeded: number
  mainConversion: GoalMainConversion
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
  currency: string
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
  return dayjs(deadline).diff(dayjs(), 'day')
}

function computeMonthlyNeeded(current: number, target: number, deadline: string | null): number {
  const remaining = target - current
  if (remaining <= 0) return 0
  if (!deadline) return 0
  const monthsLeft = dayjs(deadline).diff(dayjs(), 'month', true)
  if (monthsLeft <= 0) return remaining
  return Math.ceil(remaining / monthsLeft)
}

async function readMainCurrencyInTransaction(tx: TransactionClient): Promise<string> {
  const row = (
    await tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'")
  )[0]
  if (!row) throw new Error('Configure a main currency before creating a goal.')
  const currency = row.value.trim().toUpperCase()
  assertFxCurrency(currency)
  return currency
}

function requiredGoalCurrency(goal: Goal): string {
  const currency = goal.currency?.trim().toUpperCase()
  if (!currency) throw new Error(`Goal ${goal.id} has no durable currency`)
  assertFxCurrency(currency)
  return currency
}

let goalFetchRequest = 0
export const useGoalStore = create<GoalState>((set, get) => ({
  goals: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    const requestId = ++goalFetchRequest
    set({ isLoading: true, fetchError: null })
    try {
      await useCurrencyStore
        .getState()
        .loadRates()
        .catch(() => {})
      const currencyState = useCurrencyStore.getState()
      const authority = captureCurrencyAuthority(currencyState, dayjs().format('YYYY-MM-DD'))
      const raw = await query<Goal & { currency: string; account_name: string | null }>(
        `SELECT g.*, a.name AS account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         ORDER BY g.created_at DESC`
      )

      const goals: GoalWithProgress[] = raw.map((goal) => {
        const currency = requiredGoalCurrency(goal)
        const target = convertWithCurrencyAuthority(authority, goal.target_amount, currency)
        const saved = convertWithCurrencyAuthority(authority, goal.current_amount, currency)
        const complete = target.complete && saved.complete
        return {
          ...goal,
          currency,
          accountName: goal.account_name,
          progress: computeProgress(goal.current_amount, goal.target_amount),
          daysRemaining: computeDaysRemaining(goal.deadline),
          monthlyNeeded: computeMonthlyNeeded(
            goal.current_amount,
            goal.target_amount,
            goal.deadline
          ),
          mainConversion: {
            complete,
            policy: 'recorded_goal_value_today',
            toCurrency: authority.mainCurrency,
            target,
            saved,
            reason: !authority.mainCurrency
              ? 'main_currency_unconfigured'
              : complete
                ? null
                : 'missing_exchange_rates',
          },
        }
      })

      if (requestId === goalFetchRequest) {
        if (authority.key === currencyAuthorityKey(useCurrencyStore.getState())) {
          set({ goals, fetchError: null })
        } else {
          void get()
            .fetch()
            .catch(() => {})
        }
      }
    } catch (error) {
      if (requestId === goalFetchRequest) set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      if (requestId === goalFetchRequest) set({ isLoading: false })
    }
  },

  add: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const expectedCurrency = data.currency.trim().toUpperCase()
      assertFxCurrency(expectedCurrency)
      await withTransaction(async (tx) => {
        const currency = await readMainCurrencyInTransaction(tx)
        if (currency !== expectedCurrency) {
          throw new Error(
            'Main currency changed while this goal form was open. Review the amounts and try again.'
          )
        }
        await tx.execute(
          `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            currency,
            now,
            now,
          ]
        )
      })
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; expose refresh errors separately.
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
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; expose refresh errors separately.
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
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; expose refresh errors separately.
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  getById: (id) => get().goals.find((goal) => goal.id === id),
}))

let goalAuthorityKey = currencyAuthorityKey(useCurrencyStore.getState())
useCurrencyStore.subscribe((state) => {
  const key = currencyAuthorityKey(state)
  if (key === goalAuthorityKey) return
  goalAuthorityKey = key
  const goalState = useGoalStore.getState()
  if (goalState.isLoading || goalState.goals.length > 0) {
    void goalState.fetch().catch(() => {})
  }
})
