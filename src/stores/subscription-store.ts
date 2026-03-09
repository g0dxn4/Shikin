import { create } from 'zustand'
import Database from '@tauri-apps/plugin-sql'
import { homeDir } from '@tauri-apps/api/path'

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

function toMonthly(amount: number, cycle: string): number {
  switch (cycle) {
    case 'weekly': return amount * 4.33
    case 'monthly': return amount
    case 'quarterly': return amount / 3
    case 'yearly': return amount / 12
    default: return amount
  }
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

async function getSubbyDb(): Promise<Database> {
  const home = await homeDir()
  return Database.load(`sqlite:${home}/.local/share/com.newstella.subby/subby.db`)
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  subscriptions: [],
  upcomingPayments: [],
  monthlyTotal: 0,
  isLoading: false,
  isConnected: false,
  error: null,

  checkConnection: async () => {
    try {
      const db = await getSubbyDb()
      await db.select('SELECT 1')
      set({ isConnected: true, error: null })
      return true
    } catch {
      set({ isConnected: false, error: 'Could not connect to Subby database' })
      return false
    }
  },

  fetch: async () => {
    set({ isLoading: true })
    try {
      const db = await getSubbyDb()

      const subs = await db.select<SubbySubscription[]>(
        `SELECT s.id, s.name, s.amount, s.currency, s.billing_cycle,
                s.billing_day, c.name as category_name, ca.name as card_name,
                s.color, s.logo_url, s.notes, s.is_active,
                s.next_payment_date, s.status, s.trial_end_date,
                s.shared_count, s.created_at, s.updated_at
         FROM subscriptions s
         LEFT JOIN categories c ON s.category_id = c.id
         LEFT JOIN cards ca ON s.card_id = ca.id
         ORDER BY s.next_payment_date ASC`
      )

      const activeSubs = subs.filter((s) => s.status === 'active' || s.status === 'trial')
      const monthlyTotal = activeSubs.reduce(
        (sum, s) => sum + toMonthly(s.amount, s.billing_cycle),
        0
      )

      // Compute upcoming payments (next 30 days)
      const today = new Date()
      const cutoff = new Date(today)
      cutoff.setDate(cutoff.getDate() + 30)

      const upcomingPayments: UpcomingPayment[] = subs
        .filter((s) => {
          if (!s.next_payment_date || s.status === 'cancelled' || s.status === 'paused') return false
          const date = new Date(s.next_payment_date)
          return date >= today && date <= cutoff
        })
        .map((s) => {
          const date = new Date(s.next_payment_date!)
          const daysUntil = Math.ceil((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
          return {
            name: s.name,
            amount: s.amount,
            currency: s.currency,
            date: s.next_payment_date!,
            daysUntil,
            color: s.color,
          }
        })
        .sort((a, b) => a.daysUntil - b.daysUntil)

      set({
        subscriptions: subs,
        upcomingPayments,
        monthlyTotal: Math.round(monthlyTotal * 100) / 100,
        isConnected: true,
        error: null,
      })
    } catch {
      set({
        isConnected: false,
        error: 'Could not connect to Subby database',
        subscriptions: [],
        upcomingPayments: [],
        monthlyTotal: 0,
      })
    } finally {
      set({ isLoading: false })
    }
  },
}))
