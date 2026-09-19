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
          json: async () => ({ 'Global Quote': { '01. symbol': 'DUP', '05. price': '0.0049' } }),
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

  it('requires a unique CoinGecko ID and precision=full', async () => {
    const crypto = { ...investment, type: 'crypto' as const, symbol: 'ABC' }
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ['usd'] })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: 'alpha', symbol: 'abc', name: 'Alpha' }],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ alpha: { usd: 0.0000001 } }) })
    vi.stubGlobal('fetch', fetchMock)
    const quote = await fetchVerifiedPrice(crypto, {
      provider: 'coingecko',
      instrumentId: 'alpha',
      exchange: '',
      quoteCurrency: 'USD',
    })
    expect(quote.instrumentId).toBe('alpha')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('precision=full')
  })

  it('reports per-holding failures and preserves prior bindings by writing no replacement', async () => {
    const result = await fetchAllCurrentPrices([investment], new Map())
    expect(result.quotes.size).toBe(0)
    expect(result.failures[0]).toMatchObject({ investmentId: 'inv-1' })
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
