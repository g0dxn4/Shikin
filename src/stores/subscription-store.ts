import { create } from 'zustand'

export interface SubbySubscription {
  id: string
  name: string
  amount: number
  currency: string
  billing_cycle: string
  billing_day: number | null
  category_name: string | null
  card_name: string | null
  color: string | null
  logo_url: string | null
  notes: string | null
  is_active: boolean
  next_payment_date: string | null
  status: string
  trial_end_date: string | null
  shared_count: number
  created_at: string
  updated_at: string
}

export interface UpcomingPayment {
  name: string
  amount: number
  currency: string
  date: string
  daysUntil: number
  color: string | null
}

interface SubscriptionState {
  subscriptions: SubbySubscription[]
  upcomingPayments: UpcomingPayment[]
  monthlyTotal: number
  isLoading: boolean
  isConnected: boolean
  error: string | null
  fetch: () => Promise<void>
  checkConnection: () => Promise<boolean>
}

/**
 * Subby integration is not available in browser mode.
 * Direct SQLite access to Subby's database requires Tauri (native filesystem).
 * Future: integrate via Subby MCP server or data import.
 */
export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  upcomingPayments: [],
  monthlyTotal: 0,
  isLoading: false,
  isConnected: false,
  error: null,

  checkConnection: async () => {
    set({ isConnected: false, error: 'Subby integration requires the Subby MCP server (not available in browser mode)' })
    return false
  },

  fetch: async () => {
    set({ isLoading: true })
    try {
      set({
        isConnected: false,
        error: 'Subby integration requires the Subby MCP server (not available in browser mode)',
        subscriptions: [],
        upcomingPayments: [],
        monthlyTotal: 0,
      })
    } finally {
      set({ isLoading: false })
    }
  },
}))
