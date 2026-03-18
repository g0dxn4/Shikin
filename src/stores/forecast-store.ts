import { create } from 'zustand'
import {
  generateCashFlowForecast,
  type CashFlowForecast,
} from '@/lib/forecast-service'

type ForecastRange = 30 | 60 | 90

interface ForecastState {
  forecast: CashFlowForecast | null
  isLoading: boolean
  selectedRange: ForecastRange
  dangerThreshold: number

  setRange: (range: ForecastRange) => void
  setDangerThreshold: (threshold: number) => void
  generateForecast: (days?: number) => Promise<void>
  getMinBalanceDate: () => { date: string; amount: number } | null
  getDangerDates: () => string[]
}

export const useForecastStore = create<ForecastState>((set, get) => ({
  forecast: null,
  isLoading: false,
  selectedRange: 30,
  dangerThreshold: 0,

  setRange: (range) => {
    set({ selectedRange: range })
    get().generateForecast(range)
  },

  setDangerThreshold: (threshold) => {
    set({ dangerThreshold: threshold })
  },

  generateForecast: async (days) => {
    const range = days ?? get().selectedRange
    set({ isLoading: true })
    try {
      const forecast = await generateCashFlowForecast(range, get().dangerThreshold)
      set({ forecast })
    } finally {
      set({ isLoading: false })
    }
  },

  getMinBalanceDate: () => {
    const { forecast } = get()
    if (!forecast) return null
    return forecast.minBalance
  },

  getDangerDates: () => {
    const { forecast } = get()
    if (!forecast) return []
    return forecast.dangerDates
  },
}))
