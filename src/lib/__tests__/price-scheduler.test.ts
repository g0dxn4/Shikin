import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/database', () => ({ query: vi.fn() }))
vi.mock('@/lib/price-service', () => ({
  fetchAllCurrentPrices: vi.fn(async () => ({ quotes: new Map(), failures: [] })),
  savePricesToDB: vi.fn(),
}))
vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: { getState: vi.fn() },
}))

import { query } from '@/lib/database'
import { fetchAllCurrentPrices, savePricesToDB, type PriceQuote } from '../price-service'
import { useInvestmentStore } from '@/stores/investment-store'
import { initPriceScheduler, isInvestmentPriceStale, stopPriceScheduler } from '../price-scheduler'

const publicationQuote: PriceQuote = {
  instrumentKey: 'owned',
  assetType: 'stock',
  provider: 'finnhub',
  instrumentId: 'S',
  exchange: '',
  quoteCurrency: 'USD',
  unitPriceDecimal: '1',
  quoteDate: '2026-11-06',
}

function scheduledHolding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i',
    symbol: 'S',
    type: 'stock',
    price_provider: 'finnhub',
    price_instrument_id: 'S',
    price_exchange: null,
    price_quote_currency: 'USD',
    quote_date: '2026-11-06',
    price_retrieved_at: null,
    ...overrides,
  }
}

describe('price-scheduler', () => {
  beforeEach(() => {
    vi.mocked(query).mockReset()
    vi.mocked(fetchAllCurrentPrices)
      .mockReset()
      .mockResolvedValue({ quotes: new Map(), failures: [] })
    vi.mocked(savePricesToDB).mockReset().mockResolvedValue(undefined)
    vi.mocked(useInvestmentStore.getState)
      .mockReset()
      .mockReturnValue({
        setRefreshFailures: vi.fn(),
        setLastPriceFetch: vi.fn(),
        fetch: vi.fn().mockResolvedValue(undefined),
      } as never)
  })

  afterEach(() => {
    stopPriceScheduler()
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('uses retrieval time for refresh cadence while retaining the older source quote date', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-10T12:00:00Z'))
    vi.mocked(query).mockResolvedValue([
      {
        id: 'inv-1',
        type: 'stock',
        quote_date: '2024-01-05',
        price_retrieved_at: '2024-01-10T11:00:00.000Z',
      },
    ])

    await initPriceScheduler()

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('ip.created_at AS price_retrieved_at')
    )
    expect(fetchAllCurrentPrices).not.toHaveBeenCalled()
  })

  describe('scheduled quote publication', () => {
    it.each(['success', 'zero', 'save-error', 'fetch-error', 'replace-fetch'])(
      'preserves the literal initial publication trace for %s',
      async (scenario) => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
        const trace: unknown[] = []
        const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
        vi.mocked(query).mockResolvedValue([scheduledHolding()])
        const quotes = new Map(scenario === 'zero' ? [] : [['i', publicationQuote]])
        vi.mocked(fetchAllCurrentPrices).mockImplementation(async () => {
          trace.push('prices')
          return {
            quotes,
            failures: [{ investmentId: 'failed', symbol: 'F', reason: 'missing' }],
          }
        })
        const state = useInvestmentStore.getState()
        state.setRefreshFailures = vi.fn((failures) => {
          trace.push(['failures', failures])
        })
        state.setLastPriceFetch = vi.fn((timestamp) => {
          trace.push(['timestamp', timestamp])
        })
        state.fetch = vi.fn(async () => {
          trace.push('fetch:original')
          if (scenario === 'fetch-error') throw new Error('refresh-failed')
        })
        vi.mocked(savePricesToDB).mockImplementation(async (saved) => {
          trace.push(['save', [...saved.keys()]])
          if (scenario === 'save-error') throw new Error('save-failed')
          if (scenario === 'replace-fetch') {
            state.fetch = vi.fn(async () => {
              trace.push('fetch:replacement')
            })
          }
        })

        await initPriceScheduler()

        const expected: unknown[] = ['prices', ['failures', { failed: 'missing' }]]
        if (scenario !== 'zero') expected.push(['save', ['i']])
        if (scenario !== 'zero' && scenario !== 'save-error') {
          expected.push(
            ['timestamp', '2026-11-08T12:00:00.000Z'],
            scenario === 'replace-fetch' ? 'fetch:replacement' : 'fetch:original'
          )
        }
        expect(trace).toEqual(expected)
        expect(fetchAllCurrentPrices).toHaveBeenCalledTimes(1)
        expect(vi.getTimerCount()).toBe(2)
        if (scenario === 'save-error' || scenario === 'fetch-error') {
          expect(warning).toHaveBeenCalledExactlyOnceWith(
            '[PriceScheduler] Initial fetch failed:',
            new Error(scenario === 'save-error' ? 'save-failed' : 'refresh-failed')
          )
        } else {
          expect(warning).not.toHaveBeenCalled()
        }
        if (scenario === 'zero') expect(savePricesToDB).not.toHaveBeenCalled()
        else expect(savePricesToDB).toHaveBeenCalledWith(quotes)
      }
    )

    it('keeps stale subsets, snake_case selections, quote order and last duplicate failure', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
      const stale = [
        scheduledHolding({ id: 'second', price_exchange: 'XNAS', priceProvider: 'manual' }),
        scheduledHolding({ id: 'first' }),
        scheduledHolding({ id: 'manual', price_provider: 'manual' }),
        scheduledHolding({ id: 'missing-id', price_instrument_id: null }),
        scheduledHolding({ id: 'missing-currency', price_quote_currency: null }),
      ]
      vi.mocked(query).mockResolvedValue([
        ...stale,
        scheduledHolding({ id: 'fresh', price_retrieved_at: '2026-11-08T11:00:00.000Z' }),
      ])
      const quotes = new Map([
        ['second', publicationQuote],
        ['first', publicationQuote],
      ])
      vi.mocked(fetchAllCurrentPrices).mockResolvedValue({
        quotes,
        failures: [
          { investmentId: 'failed', symbol: 'F', reason: 'first reason' },
          { investmentId: 'other', symbol: 'O', reason: 'other reason' },
          { investmentId: 'failed', symbol: 'F', reason: 'last reason' },
        ],
      })

      await initPriceScheduler()

      expect(fetchAllCurrentPrices).toHaveBeenCalledExactlyOnceWith(
        stale,
        new Map([
          [
            'second',
            { provider: 'finnhub', instrumentId: 'S', exchange: 'XNAS', quoteCurrency: 'USD' },
          ],
          ['first', { provider: 'finnhub', instrumentId: 'S', exchange: '', quoteCurrency: 'USD' }],
        ])
      )
      expect(savePricesToDB).toHaveBeenCalledExactlyOnceWith(quotes)
      expect([...vi.mocked(savePricesToDB).mock.calls[0][0].keys()]).toEqual(['second', 'first'])
      expect(useInvestmentStore.getState().setRefreshFailures).toHaveBeenCalledExactlyOnceWith({
        failed: 'last reason',
        other: 'other reason',
      })
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining(
          'ORDER BY candidate.quote_date DESC, candidate.created_at DESC, candidate.id DESC'
        )
      )
    })
  })

  describe('isInvestmentPriceStale', () => {
    it('returns true when lastDate is null', () => {
      expect(isInvestmentPriceStale(null, 'stock')).toBe(true)
      expect(isInvestmentPriceStale(null, 'crypto')).toBe(true)
    })

    it('considers crypto stale after >6 hours', () => {
      const now = new Date('2024-01-10T12:00:00Z')
      vi.setSystemTime(now)

      const fiveHoursAgo = new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString()
      const sevenHoursAgo = new Date(now.getTime() - 7 * 60 * 60 * 1000).toISOString()

      expect(isInvestmentPriceStale(fiveHoursAgo, 'crypto')).toBe(false)
      expect(isInvestmentPriceStale(sevenHoursAgo, 'crypto')).toBe(true)
    })

    it('considers stocks stale after >1.5 days on weekdays', () => {
      const now = new Date('2024-01-10T12:00:00Z') // Wednesday
      vi.setSystemTime(now)

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString()

      expect(isInvestmentPriceStale(oneDayAgo, 'stock')).toBe(false)
      expect(isInvestmentPriceStale(twoDaysAgo, 'stock')).toBe(true)
    })

    it('extends stock staleness across weekends', () => {
      const mondayMorning = new Date('2024-01-08T10:00:00Z')
      vi.setSystemTime(mondayMorning)

      const friday = new Date('2024-01-05T12:00:00Z')
      expect(isInvestmentPriceStale(friday.toISOString(), 'stock')).toBe(false)

      const mondayEvening = new Date('2024-01-08T20:00:00Z')
      vi.setSystemTime(mondayEvening)
      expect(isInvestmentPriceStale(friday.toISOString(), 'stock')).toBe(true)
    })
  })
})
