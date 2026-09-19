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

type RateRow = { from_currency: string; to_currency: string; rate: number }

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

export function readValuationRates(targetCurrency: string): ValuationRate[] {
  const target = targetCurrency.trim().toUpperCase()
  const rows = query<RateRow>(
    `SELECT er.from_currency, er.to_currency, er.rate
     FROM exchange_rates er
     WHERE UPPER(TRIM(er.to_currency)) = $1
       AND er.id = (
         SELECT candidate.id FROM exchange_rates candidate
         WHERE UPPER(TRIM(candidate.from_currency)) = UPPER(TRIM(er.from_currency))
           AND UPPER(TRIM(candidate.to_currency)) = UPPER(TRIM(er.to_currency))
         ORDER BY candidate.date DESC, candidate.created_at DESC, candidate.id DESC
         LIMIT 1
       )`,
    [target]
  )
  return rows.flatMap((row) =>
    Number.isFinite(row.rate) && row.rate > 0
      ? [
          {
            fromCurrency: row.from_currency,
            toCurrency: row.to_currency,
            rateDecimal: decimalFromNumber(row.rate),
          },
        ]
      : []
  )
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

export function readOwnershipValuation(targetCurrency: string): OwnershipValuationResult {
  const accounts = query<AccountValuationRow>(
    `SELECT id, name, type, currency, balance, account_mode, valuation_mode
     FROM accounts WHERE is_archived = 0 ORDER BY type, name, id`
  )
  const investments = readInvestmentValuationRows('ORDER BY i.name, i.id')
  return calculateOwnershipValuation({
    targetCurrency,
    rates: readValuationRates(targetCurrency),
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
