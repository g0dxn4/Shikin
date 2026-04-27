import { create } from 'zustand'
import { query } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { calculatePayoffPlan, compareStrategies } from '@/lib/debt-service'
import type { Debt, PayoffPlan, StrategyComparison } from '@/lib/debt-service'
import type { Account } from '@/types/database'

export type DebtStrategy = 'snowball' | 'avalanche'

interface DebtState {
  debts: Debt[]
  manualDebts: Debt[]
  strategy: DebtStrategy
  extraPayment: number // centavos
  isLoading: boolean
  error: string | null

  // Computed
  payoffPlan: PayoffPlan | null
  comparison: StrategyComparison | null
  totalDebt: number
  totalMinPayment: number

  // Actions
  loadDebts: () => Promise<void>
  addManualDebt: (debt: Omit<Debt, 'id'>) => void
  removeDebt: (id: string) => void
  setStrategy: (strategy: DebtStrategy) => void
  setExtraPayment: (amount: number) => void
}

function recalculate(state: {
  debts: Debt[]
  manualDebts: Debt[]
  strategy: DebtStrategy
  extraPayment: number
}) {
  const allDebts = [...state.debts, ...state.manualDebts]
  const totalDebt = allDebts.reduce((s, d) => s + d.balance, 0)
  const totalMinPayment = allDebts.reduce((s, d) => s + d.minPayment, 0)

  if (allDebts.length === 0) {
    return {
      payoffPlan: null,
      comparison: null,
      totalDebt: 0,
      totalMinPayment: 0,
    }
  }

  const payoffPlan = calculatePayoffPlan(allDebts, state.strategy, state.extraPayment)
  const comparison = compareStrategies(allDebts, state.extraPayment)

  return { payoffPlan, comparison, totalDebt, totalMinPayment }
}

export const useDebtStore = create<DebtState>((set, get) => ({
  debts: [],
  manualDebts: [],
  strategy: 'avalanche',
  extraPayment: 0,
  isLoading: false,
  error: null,
  payoffPlan: null,
  comparison: null,
  totalDebt: 0,
  totalMinPayment: 0,

  loadDebts: async () => {
    set({ isLoading: true, error: null })
    try {
      // Pull credit card accounts with balances (negative balance = debt)
      const accounts = await query<Account>(
        `SELECT * FROM accounts WHERE type = 'credit_card' AND is_archived = 0 AND balance < 0`
      )

      const debts: Debt[] = accounts.map((a) => ({
        id: a.id,
        name: a.name,
        balance: Math.abs(a.balance), // stored as negative, we want positive
        apr: 0, // Default; users can set this via manual override
        minPayment: Math.max(Math.round(Math.abs(a.balance) * 0.02), 2500), // 2% or $25 min
      }))

      const state = get()
      const computed = recalculate({
        debts,
        manualDebts: state.manualDebts,
        strategy: state.strategy,
        extraPayment: state.extraPayment,
      })

      set({ debts, isLoading: false, ...computed })
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Unknown error' })
    }
  },

  addManualDebt: (debt) => {
    const newDebt: Debt = { ...debt, id: generateId() }
    const state = get()
    const manualDebts = [...state.manualDebts, newDebt]
    const computed = recalculate({
      debts: state.debts,
      manualDebts,
      strategy: state.strategy,
      extraPayment: state.extraPayment,
    })
    set({ manualDebts, ...computed })
  },

  removeDebt: (id) => {
    const state = get()
    const manualDebts = state.manualDebts.filter((d) => d.id !== id)
    const computed = recalculate({
      debts: state.debts,
      manualDebts,
      strategy: state.strategy,
      extraPayment: state.extraPayment,
    })
    set({ manualDebts, ...computed })
  },

  setStrategy: (strategy) => {
    const state = get()
    const computed = recalculate({
      debts: state.debts,
      manualDebts: state.manualDebts,
      strategy,
      extraPayment: state.extraPayment,
    })
    set({ strategy, ...computed })
  },

  setExtraPayment: (amount) => {
    const state = get()
    const computed = recalculate({
      debts: state.debts,
      manualDebts: state.manualDebts,
      strategy: state.strategy,
      extraPayment: amount,
    })
    set({ extraPayment: amount, ...computed })
  },
}))
