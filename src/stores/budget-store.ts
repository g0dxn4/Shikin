import { assertFxCurrency } from '@shikin/finance-core/fx'
import dayjs from 'dayjs'
import { create } from 'zustand'
import { query, execute, withTransaction, type TransactionClient } from '@/lib/database'
import { readBudgetSpending, type BudgetSpendingRead } from '@/lib/budget-dated-read'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Budget } from '@/types/database'
import { useCurrencyStore, type PreferredCurrencyAmountResult } from './currency-store'
import {
  captureCurrencyAuthority,
  convertWithCurrencyAuthority,
  currencyAuthorityKey,
} from './currency-authority'

export interface BudgetMainComparison {
  complete: boolean
  policy: 'current_plan_today_vs_transaction_date_spending'
  toCurrency: string | null
  plan: PreferredCurrencyAmountResult
  spending: BudgetSpendingRead | null
  remainingCentavos: number | null
  reason: 'main_currency_unconfigured' | 'missing_exchange_rates' | null
}

export interface BudgetWithStatus extends Budget {
  currency: Budget['currency'] & string
  categoryName: string
  categoryColor: string
  spent: number
  knownSpent: number
  remaining: number
  percentUsed: number
  complete: boolean
  nativeSpending: BudgetSpendingRead
  mainComparison: BudgetMainComparison
}

export interface BudgetFormData {
  name: string
  categoryId: string
  amount: number
  period: 'weekly' | 'monthly' | 'yearly'
  currency: string
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

function getPeriodDateRange(period: string, today: dayjs.Dayjs): { start: string; end: string } {
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

async function readMainCurrencyInTransaction(tx: TransactionClient): Promise<string> {
  const row = (
    await tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'")
  )[0]
  if (!row) throw new Error('Configure a main currency before creating a budget.')
  const currency = row.value.trim().toUpperCase()
  assertFxCurrency(currency)
  return currency
}

function requiredBudgetCurrency(budget: Budget): string {
  const currency = budget.currency?.trim().toUpperCase()
  if (!currency) throw new Error(`Budget ${budget.id} has no durable currency`)
  assertFxCurrency(currency)
  return currency
}

let budgetFetchRequest = 0
export const useBudgetStore = create<BudgetState>((set, get) => ({
  budgets: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    const requestId = ++budgetFetchRequest
    set({ isLoading: true, fetchError: null })
    try {
      await useCurrencyStore
        .getState()
        .loadRates()
        .catch(() => {})
      const today = dayjs()
      const currencyState = useCurrencyStore.getState()
      const authority = captureCurrencyAuthority(currencyState, today.format('YYYY-MM-DD'))
      const raw = await query<
        Budget & { currency: string; category_name: string | null; category_color: string | null }
      >(
        `SELECT b.*, c.name AS category_name, c.color AS category_color
         FROM budgets b
         LEFT JOIN categories c ON b.category_id = c.id
         WHERE b.is_active = 1
         ORDER BY b.created_at DESC`
      )

      const budgets = await Promise.all(
        raw.map(async (budget): Promise<BudgetWithStatus> => {
          const currency = requiredBudgetCurrency(budget)
          const range = getPeriodDateRange(budget.period, today)
          const nativeSpending = await readBudgetSpending({
            categoryId: budget.category_id,
            ...range,
            currency,
            rates: authority.manualRates,
          })
          const spent = nativeSpending.totalCentavos ?? nativeSpending.knownTotalCentavos
          const remaining = budget.amount - spent
          const percentUsed = budget.amount > 0 ? Math.round((spent / budget.amount) * 100) : 0

          const plan = convertWithCurrencyAuthority(authority, budget.amount, currency)
          const mainSpending = authority.mainCurrency
            ? await readBudgetSpending({
                categoryId: budget.category_id,
                ...range,
                currency: authority.mainCurrency,
                rates: authority.manualRates,
              })
            : null
          const mainComplete = plan.complete && Boolean(mainSpending?.complete)
          const mainRemaining =
            plan.complete && mainSpending?.complete && mainSpending.totalCentavos !== null
              ? plan.amountCentavos - mainSpending.totalCentavos
              : null
          const mainComparison: BudgetMainComparison = {
            complete: mainComplete,
            policy: 'current_plan_today_vs_transaction_date_spending',
            toCurrency: authority.mainCurrency,
            plan,
            spending: mainSpending,
            remainingCentavos: mainRemaining,
            reason: !authority.mainCurrency
              ? 'main_currency_unconfigured'
              : mainComplete
                ? null
                : 'missing_exchange_rates',
          }

          return {
            ...budget,
            currency,
            categoryName: budget.category_name ?? 'Uncategorized',
            categoryColor: budget.category_color ?? '#6b7280',
            spent,
            knownSpent: nativeSpending.knownTotalCentavos,
            remaining,
            percentUsed,
            complete: nativeSpending.complete,
            nativeSpending,
            mainComparison,
          }
        })
      )

      if (requestId === budgetFetchRequest) {
        if (authority.key === currencyAuthorityKey(useCurrencyStore.getState())) {
          set({ budgets, fetchError: null })
        } else {
          void get()
            .fetch()
            .catch(() => {})
        }
      }
    } catch (error) {
      if (requestId === budgetFetchRequest) set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      if (requestId === budgetFetchRequest) set({ isLoading: false })
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
            'Main currency changed while this budget form was open. Review the amount and try again.'
          )
        }
        await tx.execute(
          `INSERT INTO budgets (id, category_id, name, amount, period, is_active, currency, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
          [id, data.categoryId, data.name, toCentavos(data.amount), data.period, currency, now, now]
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
        `UPDATE budgets SET name = ?, category_id = ?, amount = ?, period = ?, updated_at = ? WHERE id = ?`,
        [data.name, data.categoryId, toCentavos(data.amount), data.period, now, id]
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
      await execute('DELETE FROM budgets WHERE id = ?', [id])
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

  getById: (id) => get().budgets.find((budget) => budget.id === id),
}))

let budgetAuthorityKey = currencyAuthorityKey(useCurrencyStore.getState())
useCurrencyStore.subscribe((state) => {
  const key = currencyAuthorityKey(state)
  if (key === budgetAuthorityKey) return
  budgetAuthorityKey = key
  const budgetState = useBudgetStore.getState()
  if (budgetState.isLoading || budgetState.budgets.length > 0) {
    void budgetState.fetch().catch(() => {})
  }
})
