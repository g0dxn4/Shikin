import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import {
  canonicalDecimal,
  instrumentIdentityKey,
  valueHolding,
  type InstrumentIdentity,
  type PriceProvider,
  type VerifiedInstrumentPrice,
} from '@shikin/finance-core/valuation'
import {
  readInvestmentValuationRows,
  ratesForTarget,
  rowToHoldingInput,
} from '@/lib/valuation-read'
import { fetchVerifiedPrice, type PriceIdentitySelection } from '@/lib/price-service'
import { useCurrencyStore } from './currency-store'
import type { Investment } from '@/types/database'
import type { InvestmentType, CurrencyCode } from '@/types/common'

export interface InvestmentFormData {
  symbol: string
  name: string
  type: InvestmentType
  shares?: number
  quantityDecimal?: string
  avgCost?: number
  avgCostDecimal?: string
  costBasisKnown?: boolean
  currency: CurrencyCode
  accountId?: string
  notes?: string
  priceProvider?: PriceProvider
  instrumentId?: string
  exchange?: string
  quoteCurrency?: string
  manualPriceDecimal?: string
}

export interface InvestmentWithPrice extends Investment {
  quantityDecimal: string
  quantityPrecision: 'exact_decimal' | 'legacy_number'
  avgCostBasisDecimal: string | null
  costBasisKnown: boolean
  currentPrice: number | null
  currentPriceDecimal: string | null
  currentPriceCurrency: string | null
  priceProvider: PriceProvider | null
  priceInstrumentId: string | null
  priceExchange: string | null
  marketValue: number | null
  convertedMarketValue: number | null
  costBasis: number | null
  convertedCostBasis: number | null
  gainLoss: number | null
  gainLossPercent: number | null
  lastPriceDate: string | null
  valuationComplete: boolean
  valuationReasons: string[]
}

interface CurrencyBreakdown {
  marketValue: number
  costBasis: number | null
  gainLoss: number | null
  count: number
}

interface PortfolioSummary {
  totalMarketValue: number | null
  totalCostBasis: number | null
  totalGainLoss: number | null
  totalGainLossPercent: number | null
  byType: Record<string, { marketValue: number; gainLoss: number | null; count: number }>
  byCurrency: Record<string, CurrencyBreakdown>
  currencies: string[]
  isMixedCurrency: boolean
  totalsComplete: boolean
  gainsComplete?: boolean
  incompleteHoldingIds?: string[]
  preferredCurrency?: string
}

interface PricePoint {
  date: string
  unitPriceDecimal: string
}

interface InvestmentState {
  investments: InvestmentWithPrice[]
  portfolioSummary: PortfolioSummary
  priceHistory: Map<string, PricePoint[]>
  isLoading: boolean
  fetchError: string | null
  error: string | null
  lastPriceFetch: string | null
  refreshFailures: Record<string, string>

  fetch: () => Promise<void>
  add: (data: InvestmentFormData) => Promise<void>
  update: (id: string, data: InvestmentFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => InvestmentWithPrice | undefined
  fetchPriceHistory: (instrumentKey: string, days?: number) => Promise<PricePoint[]>
  calculatePortfolioSummary: () => void
  setLastPriceFetch: (date: string) => void
  setRefreshFailures: (failures: Record<string, string>) => void
}

const EMPTY_SUMMARY: PortfolioSummary = {
  totalMarketValue: 0,
  totalCostBasis: 0,
  totalGainLoss: 0,
  totalGainLossPercent: 0,
  byType: {},
  byCurrency: {},
  currencies: [],
  isMixedCurrency: false,
  totalsComplete: true,
  gainsComplete: true,
  incompleteHoldingIds: [],
  preferredCurrency: 'USD',
}

function addCentavos(left: number, right: number, label: string) {
  const total = left + right
  if (!Number.isSafeInteger(total)) throw new RangeError(`${label} exceeds the safe integer range`)
  return total
}

function nonNegativeDecimal(value: string, label: string) {
  const decimal = canonicalDecimal(value)
  if (decimal.startsWith('-')) throw new Error(`${label} must be non-negative`)
  return decimal
}

function exactFormValues(data: InvestmentFormData) {
  const quantityDecimal = nonNegativeDecimal(
    data.quantityDecimal ?? String(data.shares ?? 0),
    'Quantity'
  )
  const shares = data.shares ?? Number(quantityDecimal)
  if (!Number.isFinite(shares) || shares < 0) throw new Error('Quantity must be non-negative')
  const hasCost = data.avgCostDecimal !== undefined || data.avgCost !== undefined
  const costBasisKnown = data.costBasisKnown ?? hasCost
  const avgCostBasisDecimal = costBasisKnown
    ? nonNegativeDecimal(data.avgCostDecimal ?? String(data.avgCost ?? 0), 'Average cost')
    : null
  return {
    quantityDecimal,
    shares,
    costBasisKnown,
    avgCostBasisDecimal,
    avgCostBasisCentavos:
      avgCostBasisDecimal === null ? 0 : toCentavos(Number(avgCostBasisDecimal)),
  }
}

function manualQuote(data: InvestmentFormData, quoteDate: string): VerifiedInstrumentPrice | null {
  if (data.priceProvider !== 'manual' || data.manualPriceDecimal === undefined) return null
  const identity: InstrumentIdentity = {
    assetType: data.type,
    provider: 'manual',
    instrumentId: data.instrumentId?.trim() || data.symbol.trim().toUpperCase(),
    exchange: data.exchange?.trim() || '',
    quoteCurrency: (data.quoteCurrency || data.currency).trim().toUpperCase(),
  }
  return {
    ...identity,
    instrumentKey: instrumentIdentityKey(identity),
    unitPriceDecimal: nonNegativeDecimal(data.manualPriceDecimal, 'Manual price'),
    quoteDate,
  }
}

async function resolvedQuote(
  data: InvestmentFormData,
  investment: Investment,
  quoteDate: string
): Promise<VerifiedInstrumentPrice | null> {
  if (!data.priceProvider) return null
  if (data.priceProvider === 'manual') return manualQuote(data, quoteDate)
  const selection: PriceIdentitySelection = {
    provider: data.priceProvider,
    instrumentId: data.instrumentId?.trim() || '',
    exchange: data.exchange?.trim() || '',
    quoteCurrency: (data.quoteCurrency || data.currency).trim().toUpperCase(),
  }
  return fetchVerifiedPrice(investment, selection)
}

async function persistQuoteEvidence(quote: VerifiedInstrumentPrice) {
  await execute(
    `INSERT INTO instrument_prices
     (id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(instrument_key, quote_date) DO UPDATE SET
       unit_price_decimal = excluded.unit_price_decimal,
       created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [
      generateId(),
      quote.instrumentKey,
      quote.assetType,
      quote.provider,
      quote.instrumentId,
      quote.exchange,
      quote.quoteCurrency,
      quote.unitPriceDecimal,
      quote.quoteDate,
    ]
  )
}

export const useInvestmentStore = create<InvestmentState>((set, get) => ({
  investments: [],
  portfolioSummary: EMPTY_SUMMARY,
  priceHistory: new Map(),
  isLoading: false,
  fetchError: null,
  error: null,
  lastPriceFetch: null,
  refreshFailures: {},

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const rows = await readInvestmentValuationRows()
      await useCurrencyStore
        .getState()
        .loadRates()
        .catch(() => {})
      const currencyState = useCurrencyStore.getState()
      const targetCurrency = currencyState.preferredCurrency
      const rates = ratesForTarget(currencyState.rates, targetCurrency)
      const investments: InvestmentWithPrice[] = rows.map((row) => {
        const input = rowToHoldingInput(row)
        const valuation = valueHolding(input, targetCurrency, rates)
        const currentPriceDecimal = valuation.price?.unitPriceDecimal ?? null
        const currentPrice =
          currentPriceDecimal === null
            ? null
            : valueHolding({ ...input, quantityDecimal: '1' }, targetCurrency, rates).valueCentavos
        const costBasis = valuation.costBasisCentavos
        const gainLoss = valuation.gainLossCentavos
        const gainLossPercent =
          gainLoss !== null &&
          valuation.convertedCostBasisCentavos !== null &&
          valuation.convertedCostBasisCentavos !== 0
            ? Math.round((gainLoss / Math.abs(valuation.convertedCostBasisCentavos)) * 10000) / 100
            : null
        return {
          ...row,
          quantityDecimal: input.quantityDecimal,
          quantityPrecision: row.quantity_decimal ? 'exact_decimal' : 'legacy_number',
          avgCostBasisDecimal: input.avgCostBasisDecimal,
          costBasisKnown: input.costBasisKnown,
          currentPrice,
          currentPriceDecimal,
          currentPriceCurrency: valuation.valueCurrency,
          priceProvider: valuation.price?.provider ?? null,
          priceInstrumentId: valuation.price?.instrumentId ?? null,
          priceExchange: valuation.price?.exchange ?? null,
          marketValue: valuation.valueCentavos,
          convertedMarketValue: valuation.convertedValueCentavos,
          costBasis,
          convertedCostBasis: valuation.convertedCostBasisCentavos,
          gainLoss,
          gainLossPercent,
          lastPriceDate: valuation.price?.quoteDate ?? null,
          valuationComplete: valuation.complete,
          valuationReasons: valuation.reasons,
        }
      })

      set({ investments, fetchError: null, error: null })
      get().calculatePortfolioSummary()
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const today = now.split('T')[0]
      const exact = exactFormValues(data)
      const investment: Investment = {
        id,
        account_id: data.accountId ?? null,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        type: data.type,
        shares: exact.shares,
        quantity_decimal: exact.quantityDecimal,
        avg_cost_basis: exact.avgCostBasisCentavos,
        avg_cost_basis_decimal: exact.avgCostBasisDecimal,
        cost_basis_known: exact.costBasisKnown ? 1 : 0,
        instrument_key: null,
        currency: data.currency,
        notes: data.notes ?? null,
        created_at: now,
        updated_at: now,
      }
      // Validate and fetch a replacement quote before activating its identity.
      const quote = await resolvedQuote(data, investment, today)
      investment.instrument_key = quote?.instrumentKey ?? null
      if (quote) await persistQuoteEvidence(quote)
      await execute(
        `INSERT INTO investments
         (id, account_id, symbol, name, type, shares, quantity_decimal, avg_cost_basis, avg_cost_basis_decimal, cost_basis_known, instrument_key, currency, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          investment.account_id,
          investment.symbol,
          investment.name,
          investment.type,
          investment.shares,
          investment.quantity_decimal,
          investment.avg_cost_basis,
          investment.avg_cost_basis_decimal,
          investment.cost_basis_known,
          investment.instrument_key,
          investment.currency,
          investment.notes,
          now,
          now,
        ]
      )
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; expose refresh errors separately.
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const existing = get().getById(id)
      if (!existing) throw new Error(`Investment ${id} not found`)
      const now = new Date().toISOString()
      const exact = exactFormValues(data)
      const candidate: Investment = {
        ...existing,
        account_id: data.accountId ?? null,
        symbol: data.symbol.toUpperCase(),
        name: data.name,
        type: data.type,
        shares: exact.shares,
        quantity_decimal: exact.quantityDecimal,
        avg_cost_basis: exact.avgCostBasisCentavos,
        avg_cost_basis_decimal: exact.avgCostBasisDecimal,
        cost_basis_known: exact.costBasisKnown ? 1 : 0,
        currency: data.currency,
        notes: data.notes ?? null,
        updated_at: now,
      }
      // A failed provider refresh throws before this UPDATE, preserving the accepted binding/quote.
      const quote = await resolvedQuote(data, candidate, now.split('T')[0])
      const nextInstrumentKey = quote?.instrumentKey ?? existing.instrument_key ?? null
      if (quote) await persistQuoteEvidence(quote)
      await execute(
        `UPDATE investments SET account_id = ?, symbol = ?, name = ?, type = ?, shares = ?, quantity_decimal = ?, avg_cost_basis = ?, avg_cost_basis_decimal = ?, cost_basis_known = ?, instrument_key = ?, currency = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          candidate.account_id,
          candidate.symbol,
          candidate.name,
          candidate.type,
          candidate.shares,
          candidate.quantity_decimal,
          candidate.avg_cost_basis,
          candidate.avg_cost_basis_decimal,
          candidate.cost_basis_known,
          nextInstrumentKey,
          candidate.currency,
          candidate.notes,
          now,
          id,
        ]
      )
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; expose refresh errors separately.
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await execute('DELETE FROM investments WHERE id = ?', [id])
      try {
        await get().fetch()
      } catch {
        // The durable mutation succeeded; quote evidence remains intentionally retained.
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  getById: (id) => get().investments.find((investment) => investment.id === id),

  fetchPriceHistory: async (instrumentKey, days = 90) => {
    set({ error: null })
    try {
      if (!instrumentKey) return []
      const rows = await query<{ quote_date: string; unit_price_decimal: string }>(
        `SELECT quote_date, unit_price_decimal FROM instrument_prices
         WHERE instrument_key = ? ORDER BY quote_date DESC, created_at DESC LIMIT ?`,
        [instrumentKey, days]
      )
      const points = rows
        .map((row) => ({
          date: row.quote_date,
          unitPriceDecimal: row.unit_price_decimal,
        }))
        .reverse()
      set((state) => {
        const next = new Map(state.priceHistory)
        next.set(instrumentKey, points)
        return { priceHistory: next }
      })
      return points
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  calculatePortfolioSummary: () => {
    const { investments } = get()
    const currencyState = useCurrencyStore.getState()
    const byType: PortfolioSummary['byType'] = {}
    const byCurrency: PortfolioSummary['byCurrency'] = {}
    const currencies = new Set<string>()
    const incompleteHoldingIds: string[] = []
    let totalMarketValue = 0
    let totalCostBasis = 0
    let totalsComplete = true
    let gainsComplete = true

    for (const investment of investments) {
      const hasNativeValue =
        investment.marketValue !== null && investment.currentPriceCurrency !== null
      if (hasNativeValue) {
        const native = (byCurrency[investment.currentPriceCurrency!] ??= {
          marketValue: 0,
          costBasis: 0,
          gainLoss: 0,
          count: 0,
        })
        native.marketValue = addCentavos(
          native.marketValue,
          investment.marketValue!,
          'Native market value'
        )
        native.count += 1
        currencies.add(investment.currentPriceCurrency!)
        if (
          native.costBasis !== null &&
          native.gainLoss !== null &&
          investment.costBasis !== null &&
          investment.currentPriceCurrency!.trim().toUpperCase() ===
            investment.currency.trim().toUpperCase()
        ) {
          native.costBasis = addCentavos(
            native.costBasis,
            investment.costBasis,
            'Native cost basis'
          )
          native.gainLoss = addCentavos(
            native.gainLoss,
            investment.marketValue! - investment.costBasis,
            'Native gain/loss'
          )
        } else {
          native.costBasis = null
          native.gainLoss = null
        }
      }

      if (!investment.valuationComplete || investment.convertedMarketValue === null) {
        totalsComplete = false
        incompleteHoldingIds.push(investment.id)
      } else {
        totalMarketValue = addCentavos(
          totalMarketValue,
          investment.convertedMarketValue,
          'Portfolio market value'
        )
        const type = (byType[investment.type] ??= { marketValue: 0, gainLoss: 0, count: 0 })
        type.marketValue = addCentavos(
          type.marketValue,
          investment.convertedMarketValue,
          'Asset-type market value'
        )
        type.count += 1
      }

      if (investment.convertedCostBasis === null || investment.gainLoss === null) {
        gainsComplete = false
        if (byType[investment.type]) byType[investment.type].gainLoss = null
      } else {
        totalCostBasis = addCentavos(
          totalCostBasis,
          investment.convertedCostBasis,
          'Portfolio cost basis'
        )
        const type = byType[investment.type]
        if (type?.gainLoss !== null) {
          type.gainLoss = addCentavos(type.gainLoss, investment.gainLoss, 'Asset-type gain/loss')
        }
      }
    }

    const totalGainLoss =
      totalsComplete && gainsComplete
        ? addCentavos(totalMarketValue, -totalCostBasis, 'Portfolio gain/loss')
        : null
    set({
      portfolioSummary: {
        totalMarketValue: totalsComplete ? totalMarketValue : null,
        totalCostBasis: totalsComplete && gainsComplete ? totalCostBasis : null,
        totalGainLoss,
        totalGainLossPercent:
          totalGainLoss !== null && totalCostBasis !== 0
            ? Math.round((totalGainLoss / Math.abs(totalCostBasis)) * 10000) / 100
            : totalGainLoss === 0
              ? 0
              : null,
        byType,
        byCurrency,
        currencies: [...currencies].sort(),
        isMixedCurrency: currencies.size > 1,
        totalsComplete,
        gainsComplete,
        incompleteHoldingIds,
        preferredCurrency: currencyState.preferredCurrency,
      },
    })
  },

  setLastPriceFetch: (date) => set({ lastPriceFetch: date }),
  setRefreshFailures: (failures) => set({ refreshFailures: failures }),
}))
