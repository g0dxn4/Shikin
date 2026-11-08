import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { instrumentIdentityKey } from '@shikin/finance-core/valuation'
import type * as PriceService from '@/lib/price-service'

vi.mock('@/lib/price-service', () => ({ savePricesToDB: vi.fn() }))
vi.mock('@/lib/database', () => ({ execute: vi.fn() }))
vi.mock('@/lib/ulid', () => ({ generateId: vi.fn(() => 'quote-id') }))
vi.mock('@/stores/investment-store', () => ({
  useInvestmentStore: { getState: vi.fn() },
}))

import { execute } from '@/lib/database'
import { savePricesToDB, type PriceQuote, type PriceRefreshResult } from '@/lib/price-service'
import { useInvestmentStore } from '@/stores/investment-store'
import { publishInvestmentPriceRefresh } from '../investment-price-publication'

const identity = {
  assetType: 'stock' as const,
  provider: 'finnhub' as const,
  instrumentId: 'S',
  exchange: '',
  quoteCurrency: 'USD',
}
const quote: PriceQuote = {
  ...identity,
  instrumentKey: instrumentIdentityKey(identity),
  unitPriceDecimal: '1',
  quoteDate: '2026-11-06',
}

function refreshResult(): PriceRefreshResult {
  return {
    quotes: new Map([['i', quote]]),
    failures: [{ investmentId: 'failed', symbol: 'F', reason: 'missing' }],
  }
}

describe('investment price publication', () => {
  const timestamp = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'))
    timestamp.mockReset()
    vi.mocked(savePricesToDB).mockReset().mockResolvedValue(undefined)
    vi.mocked(execute).mockReset().mockResolvedValue({ rowsAffected: 1, lastInsertId: 1 })
    vi.mocked(useInvestmentStore.getState)
      .mockReset()
      .mockReturnValue({ setLastPriceFetch: timestamp } as never)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('publishes failures, saves the original quote map, then timestamps and refreshes', async () => {
    const trace: unknown[] = []
    const result = refreshResult()
    vi.mocked(savePricesToDB).mockImplementation(async (quotes) => {
      expect(quotes).toBe(result.quotes)
      trace.push(['save', [...quotes.keys()]])
    })
    timestamp.mockImplementation((value) => trace.push(['timestamp', value]))

    await expect(
      publishInvestmentPriceRefresh(
        result,
        (failures) => trace.push(['failures', failures]),
        async () => {
          trace.push('fetch')
        }
      )
    ).resolves.toBe(true)

    expect(trace).toEqual([
      ['failures', { failed: 'missing' }],
      ['save', ['i']],
      ['timestamp', '2026-11-08T12:00:00.000Z'],
      'fetch',
    ])
  })

  it('publishes an empty failure map for zero quotes without saving, timestamping or refreshing', async () => {
    const report = vi.fn()
    const fetch = vi.fn()

    await expect(
      publishInvestmentPriceRefresh({ quotes: new Map(), failures: [] }, report, fetch)
    ).resolves.toBe(false)

    expect(report).toHaveBeenCalledExactlyOnceWith({})
    expect(savePricesToDB).not.toHaveBeenCalled()
    expect(useInvestmentStore.getState).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('publishes zero-quote failures without saving or changing the last timestamp', async () => {
    const report = vi.fn()
    const fetch = vi.fn()
    const result = { ...refreshResult(), quotes: new Map<string, PriceQuote>() }

    await expect(publishInvestmentPriceRefresh(result, report, fetch)).resolves.toBe(false)

    expect(report).toHaveBeenCalledExactlyOnceWith({ failed: 'missing' })
    expect(savePricesToDB).not.toHaveBeenCalled()
    expect(timestamp).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps quote order and last-write failure reasons for a partial result', async () => {
    const result: PriceRefreshResult = {
      quotes: new Map([
        ['second', quote],
        ['first', quote],
      ]),
      failures: [
        { investmentId: 'failed', symbol: 'F', reason: 'first reason' },
        { investmentId: 'other', symbol: 'O', reason: 'other reason' },
        { investmentId: 'failed', symbol: 'F', reason: 'last reason' },
      ],
    }
    const report = vi.fn()

    await publishInvestmentPriceRefresh(result, report, vi.fn().mockResolvedValue(undefined))

    expect(report).toHaveBeenCalledExactlyOnceWith({
      failed: 'last reason',
      other: 'other reason',
    })
    expect(vi.mocked(savePricesToDB).mock.calls[0][0]).toBe(result.quotes)
    expect([...vi.mocked(savePricesToDB).mock.calls[0][0].keys()]).toEqual(['second', 'first'])
  })

  it('leaves failures published but no timestamp or holdings read when saving rejects', async () => {
    const error = new Error('save-failed')
    vi.mocked(savePricesToDB).mockRejectedValue(error)
    const report = vi.fn()
    const fetch = vi.fn()

    await expect(publishInvestmentPriceRefresh(refreshResult(), report, fetch)).rejects.toBe(error)

    expect(report).toHaveBeenCalledExactlyOnceWith({ failed: 'missing' })
    expect(timestamp).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains the timestamp when the holdings read rejects', async () => {
    const error = new Error('refresh-failed')

    await expect(
      publishInvestmentPriceRefresh(refreshResult(), vi.fn(), vi.fn().mockRejectedValue(error))
    ).rejects.toBe(error)

    expect(timestamp).toHaveBeenCalledExactlyOnceWith('2026-11-08T12:00:00.000Z')
    expect(savePricesToDB).toHaveBeenCalledTimes(1)
  })

  it('resolves the timestamp setter and current time only after saving completes', async () => {
    // The project's ES2023 library does not expose Promise.withResolvers.
    let finishSave!: () => void
    const saved = new Promise<void>((resolve) => {
      finishSave = resolve
    })
    vi.mocked(savePricesToDB).mockReturnValue(saved)
    const report = vi.fn()
    const fetch = vi.fn().mockResolvedValue(undefined)
    const publication = publishInvestmentPriceRefresh(refreshResult(), report, fetch)
    expect(report).toHaveBeenCalledExactlyOnceWith({ failed: 'missing' })
    expect(useInvestmentStore.getState).not.toHaveBeenCalled()
    const replacement = vi.fn()
    vi.mocked(useInvestmentStore.getState).mockReturnValue({
      setLastPriceFetch: replacement,
    } as never)
    vi.setSystemTime(new Date('2026-11-08T12:01:00.000Z'))

    finishSave()
    await expect(publication).resolves.toBe(true)

    expect(timestamp).not.toHaveBeenCalled()
    expect(replacement).toHaveBeenCalledExactlyOnceWith('2026-11-08T12:01:00.000Z')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not persist when reporting failures throws', async () => {
    const error = new Error('failures-failed')
    const fetch = vi.fn()

    await expect(
      publishInvestmentPriceRefresh(
        refreshResult(),
        () => {
          throw error
        },
        fetch
      )
    ).rejects.toBe(error)

    expect(savePricesToDB).not.toHaveBeenCalled()
    expect(timestamp).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not read holdings when the timestamp setter throws after saving', async () => {
    const error = new Error('timestamp-failed')
    timestamp.mockImplementation(() => {
      throw error
    })
    const fetch = vi.fn()

    await expect(publishInvestmentPriceRefresh(refreshResult(), vi.fn(), fetch)).rejects.toBe(error)

    expect(savePricesToDB).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('retains sequential non-atomic quote writes when a later persistence operation fails', async () => {
    const original = await vi.importActual<typeof PriceService>('@/lib/price-service')
    vi.mocked(savePricesToDB).mockImplementation(original.savePricesToDB)
    const error = new Error('second quote write failed')
    vi.mocked(execute)
      .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1, lastInsertId: 1 })
      .mockRejectedValueOnce(error)
    const result: PriceRefreshResult = {
      quotes: new Map([
        ['second', quote],
        ['first', quote],
      ]),
      failures: [],
    }
    const fetch = vi.fn()

    await expect(publishInvestmentPriceRefresh(result, vi.fn(), fetch)).rejects.toBe(error)

    expect(execute).toHaveBeenCalledTimes(3)
    expect(vi.mocked(execute).mock.calls[0][0]).toContain('INSERT INTO instrument_prices')
    expect(vi.mocked(execute).mock.calls[1]).toEqual([
      'UPDATE investments SET instrument_key = ?, updated_at = ? WHERE id = ?',
      [quote.instrumentKey, '2026-11-08T12:00:00.000Z', 'second'],
    ])
    expect(vi.mocked(execute).mock.calls[2][0]).toContain('INSERT INTO instrument_prices')
    expect(timestamp).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
