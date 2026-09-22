import {
  calculateOwnershipValuation,
  decimalFromCentavos,
  decimalFromNumber,
  type HoldingValuationInput,
  type OwnershipValuationResult,
  type ValuationRate,
  type VerifiedInstrumentPrice,
} from '@shikin/finance-core/valuation'
import { query } from '@/lib/database'
import type { Account, Investment } from '@/types/database'

export type InvestmentValuationRow = Investment & {
  price_instrument_key: string | null
  price_asset_type: Investment['type'] | null
  price_provider: VerifiedInstrumentPrice['provider'] | null
  price_instrument_id: string | null
  price_exchange: string | null
  price_quote_currency: string | null
  unit_price_decimal: string | null
  quote_date: string | null
}

export async function readInvestmentValuationRows(): Promise<InvestmentValuationRow[]> {
  return query<InvestmentValuationRow>(
    `SELECT i.*,
            ip.instrument_key AS price_instrument_key,
            ip.asset_type AS price_asset_type,
            ip.provider AS price_provider,
            ip.instrument_id AS price_instrument_id,
            ip.exchange AS price_exchange,
            ip.quote_currency AS price_quote_currency,
            ip.unit_price_decimal,
            ip.quote_date
     FROM investments i
     LEFT JOIN instrument_prices ip ON ip.id = (
       SELECT candidate.id FROM instrument_prices candidate
       WHERE candidate.instrument_key = i.instrument_key
       ORDER BY candidate.quote_date DESC, candidate.created_at DESC, candidate.id DESC
       LIMIT 1
     )
     ORDER BY i.created_at DESC, i.id DESC`
  )
}

export function rowToHoldingInput(row: InvestmentValuationRow): HoldingValuationInput {
  const costBasisKnown = row.cost_basis_known === 1
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
    quantityDecimal: row.quantity_decimal?.trim() || decimalFromNumber(row.shares),
    costCurrency: row.currency,
    costBasisKnown,
    avgCostBasisDecimal: costBasisKnown
      ? row.avg_cost_basis_decimal?.trim() || decimalFromCentavos(row.avg_cost_basis)
      : null,
    instrumentKey: row.instrument_key ?? null,
    price,
  }
}

function accountValuationMode(account: Account) {
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

/** Current ownership valuation. The caller supplies the exact dated manual-rate selection. */
export type CurrentOwnershipValuation = Omit<
  OwnershipValuationResult,
  | 'complete'
  | 'targetCurrency'
  | 'totalAssetsCentavos'
  | 'totalLiabilitiesCentavos'
  | 'totalInvestmentsCentavos'
  | 'netWorthCentavos'
> & {
  complete: boolean
  targetCurrency: string | null
  totalAssetsCentavos: number | null
  totalLiabilitiesCentavos: number | null
  totalInvestmentsCentavos: number | null
  netWorthCentavos: number | null
  reason?: 'main_currency_unconfigured' | 'valuation_incomplete' | null
}

export async function readOwnershipValuation(input: {
  targetCurrency: string | null
  rates: readonly ValuationRate[]
}): Promise<CurrentOwnershipValuation> {
  const [accounts, investments] = await Promise.all([
    query<Account>('SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name, id'),
    readInvestmentValuationRows(),
  ])
  const holdingInputs = investments.map(rowToHoldingInput)
  // The probe is used only to obtain target-independent native ownership components.
  // It is never returned or presented as configured authority.
  const targetCurrency =
    input.targetCurrency ??
    accounts[0]?.currency ??
    holdingInputs.find((holding) => holding.price)?.price?.quoteCurrency ??
    holdingInputs[0]?.costCurrency ??
    'USD'
  const valuation = calculateOwnershipValuation({
    targetCurrency,
    rates: input.targetCurrency ? input.rates : [],
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: account.currency,
      balanceCentavos: account.balance,
      valuationMode: accountValuationMode(account),
    })),
    holdings: holdingInputs,
  })
  if (!input.targetCurrency) {
    return {
      ...valuation,
      complete: false,
      targetCurrency: null,
      totalAssetsCentavos: null,
      totalLiabilitiesCentavos: null,
      totalInvestmentsCentavos: null,
      netWorthCentavos: null,
      missingCurrencies: [],
      reason: 'main_currency_unconfigured',
    }
  }
  return {
    ...valuation,
    reason: valuation.complete ? null : 'valuation_incomplete',
  }
}
