import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Investment } from '@/types/database'

const { settingsStore } = vi.hoisted(() => ({ settingsStore: new Map<string, string>() }))
vi.mock('@/lib/storage', () => ({
  load: vi.fn(async () => ({ get: vi.fn(async (key: string) => settingsStore.get(key)) })),
}))
vi.mock('@/lib/database', () => ({ execute: vi.fn() }))
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn(() => 'price-id') }))

import { execute } from '@/lib/database'
import { fetchAllCurrentPrices, fetchVerifiedPrice, savePricesToDB } from '../price-service'

const investment: Investment = {
  id: 'inv-1',
  account_id: null,
  symbol: 'DUP',
  name: 'Listing',
  type: 'stock',
  shares: 1,
  avg_cost_basis: 10000,
  currency: 'MXN',
  notes: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
}

describe('identity-verified price service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsStore.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('requires one exact Alpha Vantage listing and uses metadata currency', async () => {
    settingsStore.set('alpha_vantage_key', 'secret')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            bestMatches: [
              {
                '1. symbol': 'DUP',
                '3. type': 'Equity',
                '4. region': 'Mexico',
                '8. currency': 'MXN',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            'Global Quote': {
              '01. symbol': 'DUP',
              '05. price': '0.0049',
              '07. latest trading day': '2024-01-05',
            },
          }),
        })
    )

    const quote = await fetchVerifiedPrice(investment, {
      provider: 'alpha_vantage',
      instrumentId: 'DUP',
      exchange: 'Mexico',
      quoteCurrency: 'MXN',
    })
    expect(quote).toMatchObject({
      provider: 'alpha_vantage',
      quoteCurrency: 'MXN',
      unitPriceDecimal: '0.0049',
      quoteDate: '2024-01-05',
    })
  })

  it('fails ambiguous Alpha Vantage listings instead of ticker guessing', async () => {
    settingsStore.set('alpha_vantage_key', 'secret')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          bestMatches: [
            { '1. symbol': 'DUP', '3. type': 'Equity', '4. region': 'US', '8. currency': 'USD' },
            { '1. symbol': 'DUP', '3. type': 'Equity', '4. region': 'US', '8. currency': 'USD' },
          ],
        }),
      })
    )
    await expect(
      fetchVerifiedPrice(investment, {
        provider: 'alpha_vantage',
        instrumentId: 'DUP',
        exchange: 'US',
        quoteCurrency: 'USD',
      })
    ).rejects.toThrow('ambiguous')
  })

  it('uses Finnhub stock-symbol price currency and rejects zero quotes', async () => {
    settingsStore.set('finnhub_key', 'secret')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ symbol: 'DUP', type: 'Common Stock', currency: 'CHF' }],
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ c: 0 }) })
    )
    await expect(
      fetchVerifiedPrice(investment, {
        provider: 'finnhub',
        instrumentId: 'DUP',
        exchange: 'SW',
        quoteCurrency: 'CHF',
      })
    ).rejects.toThrow('zero')
  })

  it('keeps Finnhub tiny prices and derives the quote date from its Unix timestamp', async () => {
    settingsStore.set('finnhub_key', 'secret')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [{ symbol: 'DUP', type: 'Common Stock', currency: 'CHF' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ c: 0.0000001, t: 1704501000 }),
        })
    )

    const quote = await fetchVerifiedPrice(investment, {
      provider: 'finnhub',
      instrumentId: 'DUP',
      exchange: 'SW',
      quoteCurrency: 'CHF',
    })

    expect(quote).toMatchObject({
      unitPriceDecimal: '0.0000001',
      quoteDate: '2024-01-06',
    })
  })

  it('rejects an impossible Alpha Vantage latest trading day', async () => {
    settingsStore.set('alpha_vantage_key', 'secret')
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            bestMatches: [
              {
                '1. symbol': 'DUP',
                '3. type': 'Equity',
                '4. region': 'Mexico',
                '8. currency': 'MXN',
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            'Global Quote': {
              '01. symbol': 'DUP',
              '05. price': '1.25',
              '07. latest trading day': '2024-02-30',
            },
          }),
        })
    )

    await expect(
      fetchVerifiedPrice(investment, {
        provider: 'alpha_vantage',
        instrumentId: 'DUP',
        exchange: 'Mexico',
        quoteCurrency: 'MXN',
      })
    ).rejects.toThrow('valid source date')
  })

  it('requires a unique CoinGecko ID and precision=full', async () => {
    const crypto = { ...investment, type: 'crypto' as const, symbol: 'ABC' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ['usd'] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'alpha', symbol: 'abc', name: 'Alpha' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ alpha: { usd: 0.0000001, last_updated_at: 1704412800 } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const quote = await fetchVerifiedPrice(crypto, {
      provider: 'coingecko',
      instrumentId: 'alpha',
      exchange: '',
      quoteCurrency: 'USD',
    })
    expect(quote).toMatchObject({
      instrumentId: 'alpha',
      unitPriceDecimal: '0.0000001',
      quoteDate: '2024-01-05',
    })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('precision=full')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('include_last_updated_at=true')
  })

  it('reports missing or malformed source metadata without replacing accepted state', async () => {
    settingsStore.set('alpha_vantage_key', 'secret')
    settingsStore.set('finnhub_key', 'secret')
    const crypto = {
      ...investment,
      id: 'inv-crypto',
      type: 'crypto' as const,
      symbol: 'ABC',
    }
    const finnhubInvestment = { ...investment, id: 'inv-finnhub' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.includes('function=SYMBOL_SEARCH')) {
          return {
            ok: true,
            json: async () => ({
              bestMatches: [
                {
                  '1. symbol': 'DUP',
                  '3. type': 'Equity',
                  '4. region': 'Mexico',
                  '8. currency': 'MXN',
                },
              ],
            }),
          }
        }
        if (url.includes('function=GLOBAL_QUOTE')) {
          return {
            ok: true,
            json: async () => ({
              'Global Quote': { '01. symbol': 'DUP', '05. price': '1.25' },
            }),
          }
        }
        if (url.includes('/stock/symbol')) {
          return {
            ok: true,
            json: async () => [{ symbol: 'DUP', type: 'Common Stock', currency: 'CHF' }],
          }
        }
        if (url.includes('/quote?')) {
          return { ok: true, json: async () => ({ c: 1.25, t: '1704412800' }) }
        }
        if (url.includes('supported_vs_currencies')) {
          return { ok: true, json: async () => ['usd'] }
        }
        if (url.endsWith('/coins/list')) {
          return { ok: true, json: async () => [{ id: 'alpha' }] }
        }
        return { ok: true, json: async () => ({ alpha: { usd: 0.0000001 } }) }
      })
    )
    const selections = new Map([
      [
        investment.id,
        {
          provider: 'alpha_vantage' as const,
          instrumentId: 'DUP',
          exchange: 'Mexico',
          quoteCurrency: 'MXN',
        },
      ],
      [
        finnhubInvestment.id,
        {
          provider: 'finnhub' as const,
          instrumentId: 'DUP',
          exchange: 'SW',
          quoteCurrency: 'CHF',
        },
      ],
      [
        crypto.id,
        {
          provider: 'coingecko' as const,
          instrumentId: 'alpha',
          exchange: '',
          quoteCurrency: 'USD',
        },
      ],
    ])

    const result = await fetchAllCurrentPrices([investment, finnhubInvestment, crypto], selections)

    expect(result.quotes.size).toBe(0)
    expect(result.failures).toEqual([
      expect.objectContaining({ investmentId: 'inv-1', reason: expect.stringContaining('date') }),
      expect.objectContaining({
        investmentId: 'inv-finnhub',
        reason: expect.stringContaining('timestamp'),
      }),
      expect.objectContaining({
        investmentId: 'inv-crypto',
        reason: expect.stringContaining('timestamp'),
      }),
    ])
    await savePricesToDB(result.quotes)
    expect(execute).not.toHaveBeenCalled()
  })

  it('saves only identity-complete quotes in the authoritative table', async () => {
    vi.mocked(execute).mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    const quote = {
      assetType: 'stock' as const,
      provider: 'manual' as const,
      instrumentId: 'DUP',
      exchange: 'XMEX',
      quoteCurrency: 'MXN',
      instrumentKey: 'v1|stock|manual|DUP|XMEX|MXN',
      unitPriceDecimal: '1.2345',
      quoteDate: '2026-04-18',
    }
    await savePricesToDB(new Map([['inv-1', quote]]))
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO instrument_prices'),
      expect.arrayContaining([quote.instrumentKey])
    )
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE investments SET instrument_key'),
      expect.arrayContaining(['inv-1'])
    )
  })
})
