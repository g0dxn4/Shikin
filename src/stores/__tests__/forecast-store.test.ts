import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockGenerateForecast } = vi.hoisted(() => ({
  mockGenerateForecast: vi.fn(),
}))

vi.mock('@/lib/forecast-service', () => ({
  generateCashFlowForecast: mockGenerateForecast,
}))

import { useForecastStore } from '../forecast-store'

describe('forecast-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useForecastStore.setState({
      forecast: null,
      isLoading: false,
      error: null,
      selectedRange: 30,
      dangerThreshold: 0,
    })
  })

  describe('generateForecast', () => {
    it('sets forecast data from service', async () => {
      const mockForecast = {
        points: [
          { date: '2026-03-17', projected: 5000, optimistic: 5500, pessimistic: 4500 },
          { date: '2026-03-18', projected: 4800, optimistic: 5300, pessimistic: 4300 },
        ],
        currentBalance: 500000,
        dailyBurnRate: 20000,
        dailyIncome: 15000,
        minBalance: { date: '2026-04-10', amount: 100000 },
        dangerDates: [],
      }
      mockGenerateForecast.mockResolvedValueOnce(mockForecast)

      await useForecastStore.getState().generateForecast()

      expect(mockGenerateForecast).toHaveBeenCalledWith(30, 0) // default range and threshold
      expect(useForecastStore.getState().forecast).toEqual(mockForecast)
    })

    it('uses provided days parameter over selectedRange', async () => {
      mockGenerateForecast.mockResolvedValueOnce({ points: [], currentBalance: 0, dailyBurnRate: 0, dailyIncome: 0, minBalance: { date: '', amount: 0 }, dangerDates: [] })

      await useForecastStore.getState().generateForecast(90)

      expect(mockGenerateForecast).toHaveBeenCalledWith(90, 0)
    })

    it('sets isLoading during generation', async () => {
      mockGenerateForecast.mockResolvedValueOnce({ points: [], currentBalance: 0, dailyBurnRate: 0, dailyIncome: 0, minBalance: { date: '', amount: 0 }, dangerDates: [] })

      const promise = useForecastStore.getState().generateForecast()
      expect(useForecastStore.getState().isLoading).toBe(true)
      await promise
      expect(useForecastStore.getState().isLoading).toBe(false)
    })

    it('resets isLoading on error', async () => {
      mockGenerateForecast.mockRejectedValueOnce(new Error('Service error'))

      await useForecastStore.getState().generateForecast()
      expect(useForecastStore.getState().isLoading).toBe(false)
      expect(useForecastStore.getState().error).toBe('Service error')
    })
  })

  describe('setRange', () => {
    it('updates selectedRange and triggers regeneration', async () => {
      mockGenerateForecast.mockResolvedValueOnce({ points: [], currentBalance: 0, dailyBurnRate: 0, dailyIncome: 0, minBalance: { date: '', amount: 0 }, dangerDates: [] })

      useForecastStore.getState().setRange(60)

      expect(useForecastStore.getState().selectedRange).toBe(60)
      // setRange triggers generateForecast internally
      expect(mockGenerateForecast).toHaveBeenCalledWith(60, 0)
    })
  })

  describe('setDangerThreshold', () => {
    it('updates the danger threshold', () => {
      useForecastStore.getState().setDangerThreshold(50000)

      expect(useForecastStore.getState().dangerThreshold).toBe(50000)
    })
  })

  describe('getMinBalanceDate', () => {
    it('returns the min balance date from forecast', () => {
      useForecastStore.setState({
        forecast: {
          points: [],
          currentBalance: 500000,
          dailyBurnRate: 20000,
          dailyIncome: 15000,
          minBalance: { date: '2026-04-10', amount: 100000 },
          dangerDates: [],
        },
      })

      const result = useForecastStore.getState().getMinBalanceDate()

      expect(result).toEqual({ date: '2026-04-10', amount: 100000 })
    })

    it('returns null when no forecast', () => {
      expect(useForecastStore.getState().getMinBalanceDate()).toBeNull()
    })
  })

  describe('getDangerDates', () => {
    it('returns dates where balance goes below threshold', () => {
      useForecastStore.setState({
        forecast: {
          points: [],
          currentBalance: 100000,
          dailyBurnRate: 50000,
          dailyIncome: 10000,
          minBalance: { date: '2026-03-20', amount: -50000 },
          dangerDates: ['2026-03-19', '2026-03-20', '2026-03-21'],
        },
      })

      const dates = useForecastStore.getState().getDangerDates()

      expect(dates).toEqual(['2026-03-19', '2026-03-20', '2026-03-21'])
    })

    it('returns empty array when no forecast', () => {
      expect(useForecastStore.getState().getDangerDates()).toEqual([])
    })

    it('returns empty array when no danger dates', () => {
      useForecastStore.setState({
        forecast: {
          points: [],
          currentBalance: 1000000,
          dailyBurnRate: 1000,
          dailyIncome: 5000,
          minBalance: { date: '2026-04-15', amount: 800000 },
          dangerDates: [],
        },
      })

      expect(useForecastStore.getState().getDangerDates()).toEqual([])
    })
  })
})
