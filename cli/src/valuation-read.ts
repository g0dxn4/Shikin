import dayjs from 'dayjs'
import { selectValuationRatesAsOf, selectEffectiveRate } from '@shikin/finance-core/fx'
import { getCurrencySettings, listExchangeRates } from './fx-service.js'
import {
  calculateOwnershipValuation,
  decimalFromCentavos,
  decimalFromNumber,
  valueHolding,
  type HoldingValuationInput,
  type OwnershipValuationResult,
  type ValuationRate,
  type VerifiedInstrumentPrice,
} from '@shikin/finance-core/valuation'
import { query } from './database.js'

export type InvestmentValuationRow = {
  id: string
  account_id: string | null
  symbol: string
  name: string
  type: HoldingValuationInput['assetType']
  shares: number
  quantity_decimal: string | null
  avg_cost_basis: number
  avg_cost_basis_decimal: string | null
  cost_basis_known: number
  instrument_key: string | null
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
  account_name?: string | null
  price_instrument_key: string | null
  price_asset_type: HoldingValuationInput['assetType'] | null
  price_provider: VerifiedInstrumentPrice['provider'] | null
  price_instrument_id: string | null
  price_exchange: string | null
  price_quote_currency: string | null
  unit_price_decimal: string | null
  quote_date: string | null
}

type AccountValuationRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
  account_mode: string | null
  valuation_mode: string | null
}

export function readInvestmentValuationRows(whereClause = '', params: unknown[] = []) {
  return query<InvestmentValuationRow>(
    `SELECT i.id, i.account_id, i.symbol, i.name, i.type, i.shares,
            i.quantity_decimal, i.avg_cost_basis, i.avg_cost_basis_decimal,
            i.cost_basis_known, i.instrument_key, i.currency, i.notes,
            i.created_at, i.updated_at, a.name AS account_name,
            ip.instrument_key AS price_instrument_key,
            ip.asset_type AS price_asset_type,
            ip.provider AS price_provider,
            ip.instrument_id AS price_instrument_id,
            ip.exchange AS price_exchange,
            ip.quote_currency AS price_quote_currency,
            ip.unit_price_decimal,
            ip.quote_date
     FROM investments i
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN instrument_prices ip ON ip.id = (
       SELECT candidate.id FROM instrument_prices candidate
       WHERE candidate.instrument_key = i.instrument_key
       ORDER BY candidate.quote_date DESC, candidate.created_at DESC, candidate.id DESC
       LIMIT 1
     )
     ${whereClause}`,
    params
  )
}

export function rowToHoldingInput(row: InvestmentValuationRow): HoldingValuationInput {
  const quantityDecimal = row.quantity_decimal?.trim() || decimalFromNumber(row.shares)
  const costBasisKnown = row.cost_basis_known === 1
  const avgCostBasisDecimal = costBasisKnown
    ? row.avg_cost_basis_decimal?.trim() || decimalFromCentavos(row.avg_cost_basis)
    : null
  const price: VerifiedInstrumentPrice | null =
    row.price_instrument_key &&
    row.price_asset_type &&
    row.price_provider &&
    row.price_instrument_id &&
    row.price_quote_currency &&
    row.unit_price_decimal &&
    row.quote_date
      ? {
          instrumentKey: row.price_instrument_key,
          assetType: row.price_asset_type,
          provider: row.price_provider,
          instrumentId: row.price_instrument_id,
          exchange: row.price_exchange ?? '',
          quoteCurrency: row.price_quote_currency,
          unitPriceDecimal: row.unit_price_decimal,
          quoteDate: row.quote_date,
        }
      : null

  return {
    id: row.id,
    accountId: row.account_id,
    assetType: row.type,
    quantityDecimal,
    costCurrency: row.currency,
    costBasisKnown,
    avgCostBasisDecimal,
    instrumentKey: row.instrument_key,
    price,
  }
}

export function readValuationRates(
  targetCurrency: string,
  asOfDate = dayjs().format('YYYY-MM-DD')
): ValuationRate[] {
  return selectValuationRatesAsOf(listExchangeRates(), targetCurrency, asOfDate)
}

function accountValuationMode(account: AccountValuationRow) {
  if (
    account.valuation_mode === 'cash_plus_holdings' ||
    account.valuation_mode === 'portfolio_snapshot' ||
    account.valuation_mode === 'unresolved'
  ) {
    return account.valuation_mode
  }
  return account.account_mode === 'snapshot_only'
    ? ('portfolio_snapshot' as const)
    : ('unresolved' as const)
}

export function readOwnershipValuation(
  targetCurrency: string,
  asOfDate = dayjs().format('YYYY-MM-DD')
): OwnershipValuationResult {
  const accounts = query<AccountValuationRow>(
    `SELECT id, name, type, currency, balance, account_mode, valuation_mode
     FROM accounts WHERE is_archived = 0 ORDER BY type, name, id`
  )
  const investments = readInvestmentValuationRows('ORDER BY i.name, i.id')
  return calculateOwnershipValuation({
    targetCurrency,
    rates: readValuationRates(targetCurrency, asOfDate),
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balanceCentavos: account.balance,
      valuationMode: accountValuationMode(account),
    })),
    holdings: investments.map(rowToHoldingInput),
  })
}

export function valueInvestmentRows(rows: InvestmentValuationRow[], targetCurrency: string) {
  const rates = readValuationRates(targetCurrency)
  return rows.map((row) => ({
    row,
    valuation: valueHolding(rowToHoldingInput(row), targetCurrency, rates),
  }))
}

/** Native ownership evidence remains readable before setup; no target is asserted. */
export function readMainOwnershipValuation() {
  const { mainCurrency } = getCurrencySettings()
  const asOfDate = dayjs().format('YYYY-MM-DD')
  const provenance = readValuationProvenance(mainCurrency, asOfDate)
  if (mainCurrency !== null)
    return {
      ...readOwnershipValuation(mainCurrency, asOfDate),
      asOfDate,
      provenance,
      reason: null,
      policy: 'current_ownership_today' as const,
    }
  // The core's native ownership components do not depend on its target. Use an
  // actual source denomination solely to obtain those components, then discard
  // every target-derived result. Empty portfolios require no probe currency.
  const nativeCurrency = query<{ currency: string }>(
    `SELECT currency FROM accounts WHERE is_archived = 0
     UNION SELECT currency FROM investments ORDER BY currency LIMIT 1`
  )[0]?.currency
  const native: OwnershipValuationResult = nativeCurrency
    ? readOwnershipValuation(nativeCurrency, asOfDate)
    : {
        complete: false,
        targetCurrency: '',
        totalAssetsCentavos: null,
        totalLiabilitiesCentavos: null,
        totalInvestmentsCentavos: null,
        netWorthCentavos: null,
        nativeTotals: [],
        missingCurrencies: [],
        unresolvedAccountIds: [],
        incompleteHoldingIds: [],
        accounts: [],
        holdings: [],
      }
  return {
    ...native,
    complete: false,
    targetCurrency: null,
    totalAssetsCentavos: null,
    totalLiabilitiesCentavos: null,
    totalInvestmentsCentavos: null,
    netWorthCentavos: null,
    holdings: native.holdings.map((holding) => ({
      ...holding,
      complete: false,
      convertedValueCentavos: null,
      convertedCostBasisCentavos: null,
      gainLossCentavos: null,
      reasons: [
        ...holding.reasons.filter((reason) => !reason.startsWith('missing_fx:')),
        'main_currency_unconfigured',
      ],
    })),
    missingCurrencies: [],
    asOfDate,
    provenance,
    reason: 'main_currency_unconfigured' as const,
    policy: 'current_ownership_today' as const,
  }
}

export function readValuationProvenance(
  targetCurrency: string | null,
  asOfDate = dayjs().format('YYYY-MM-DD')
) {
  const history = listExchangeRates()
  return targetCurrency === null
    ? []
    : [...new Set(history.map((row) => row.fromCurrency))].sort().flatMap((from) => {
        const rate = selectEffectiveRate(history, from, targetCurrency, asOfDate)
        return rate ? [{ ...rate, direction: `${from}->${targetCurrency}`, asOfDate }] : []
      })
}
