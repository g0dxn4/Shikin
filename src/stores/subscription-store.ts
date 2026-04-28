import { create } from 'zustand'

export interface StoredSubscription {
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
  subscriptions: StoredSubscription[]
  upcomingPayments: UpcomingPayment[]
  monthlyTotal: number
  isLoading: boolean
  isConnected: boolean
  error: string | null
  fetch: () => Promise<void>
  checkConnection: () => Promise<boolean>
}

/**
 * MVP limitation: the browser subscriptions page is an explicit placeholder.
 * Shikin can store subscription rows for CLI/MCP analytics, but the browser UI
 * does not yet read/write those rows or connect to an external Subby source.
 */
export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  upcomingPayments: [],
  monthlyTotal: 0,
  isLoading: false,
  isConnected: false,
  error: null,

  checkConnection: async () => {
    set({
      isConnected: false,
      error: 'Subscription browser UI is not wired to local subscription data in this MVP.',
    })
    return false
  },

  fetch: async () => {
    set({ isLoading: true })
    try {
      set({
        isConnected: false,
        error: 'Subscription browser UI is not wired to local subscription data in this MVP.',
        subscriptions: [],
        upcomingPayments: [],
        monthlyTotal: 0,
      })
    } finally {
      set({ isLoading: false })
    }
  },
}))
