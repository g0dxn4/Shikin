import { getCurrencySettings } from '../fx-service.js'
import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  assetCode,
  resolveAccountId,
  normalizeCurrencyCode,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  canonicalDecimal,
  decimalFromCentavos,
  instrumentIdentityKey,
  valueHolding,
  type InstrumentIdentity,
  type PriceProvider,
} from '@shikin/finance-core/valuation'
import {
  readInvestmentValuationRows,
  readValuationRates,
  readValuationProvenance,
  rowToHoldingInput,
  type InvestmentValuationRow,
} from '../valuation-read.js'
import { assertSingleRowUpdated } from './shared.js'

const INVESTMENT_TYPES = [
  'stock',
  'etf',
  'crypto',
  'bond',
  'mutual_fund',
  'cetes',
  'other',
] as const

type InvestmentType = (typeof INVESTMENT_TYPES)[number]

type InvestmentWithPriceRow = InvestmentValuationRow

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function normalizeInvestmentSymbol(value: string): string {
  return value.trim().toUpperCase()
}

function nonNegativeDecimal(value: string, label: string): string {
  const decimal = canonicalDecimal(value)
  if (decimal.startsWith('-')) throw new RangeError(`${label} must be non-negative`)
  return decimal
}

function redactInvestmentText(value: string | null, redacted: boolean): string | null {
  if (!redacted) return value
  return value === null ? null : '[REDACTED]'
}

function resolveOptionalInvestmentAccount(accountId?: string, account?: string) {
  const normalizedAccountId = normalizeOptionalText(accountId)
  const normalizedAccount = normalizeOptionalText(account)

  if (!normalizedAccountId && !normalizedAccount) {
    return { success: true as const, id: null, currency: null, name: null }
  }

  const resolved = resolveAccountId(
    normalizedAccountId ?? undefined,
    normalizedAccount ?? undefined
  )
  if (!resolved.success) return resolved

  const accountRow = query<{ name: string | null }>(
    'SELECT name FROM accounts WHERE id = $1 LIMIT 1',
    [resolved.id]
  )[0]

  return {
    success: true as const,
    id: resolved.id,
    currency: resolved.currency,
    name: accountRow?.name ?? null,
  }
}

function investmentSnapshot(
  investment: InvestmentWithPriceRow,
  options: { redacted?: boolean } = {}
) {
  const redacted = options.redacted ?? false
  const input = rowToHoldingInput(investment)
  const targetCurrency = investment.price_quote_currency ?? investment.currency
  const valuation = valueHolding(input, targetCurrency, readValuationRates(targetCurrency))
  const currentPriceDecimal = valuation.price?.unitPriceDecimal ?? null
  const currentPriceCentavos =
    currentPriceDecimal === null
      ? null
      : valueHolding(
          { ...input, quantityDecimal: '1' },
          targetCurrency,
          readValuationRates(targetCurrency)
        ).valueCentavos
  const costBasisCentavos = valuation.costBasisCentavos
  const convertedCostBasisCentavos = valuation.convertedCostBasisCentavos
  const marketValueCentavos = valuation.valueCentavos
  const gainLossCentavos = valuation.gainLossCentavos
  const gainLossPercent =
    gainLossCentavos === null ||
    convertedCostBasisCentavos === null ||
    convertedCostBasisCentavos === 0
      ? null
      : Math.round((gainLossCentavos / Math.abs(convertedCostBasisCentavos)) * 10000) / 100

  return {
    id: investment.id,
    accountId: investment.account_id,
    accountName: redactInvestmentText(investment.account_name ?? null, redacted),
    symbol: investment.symbol,
    name: redactInvestmentText(investment.name, redacted),
    type: investment.type,
    shares: investment.shares,
    quantityDecimal: input.quantityDecimal,
    quantityPrecision: investment.quantity_decimal ? 'exact_decimal' : 'legacy_number',
    avgCost: input.avgCostBasisDecimal === null ? null : Number(input.avgCostBasisDecimal),
    avgCostDecimal: input.avgCostBasisDecimal,
    avgCostCentavos: investment.cost_basis_known === 1 ? investment.avg_cost_basis : null,
    costBasisKnown: input.costBasisKnown,
    costBasis: costBasisCentavos === null ? null : fromCentavos(costBasisCentavos),
    costBasisCentavos,
    costBasisCurrency: valuation.costCurrency,
    convertedCostBasis:
      convertedCostBasisCentavos === null ? null : fromCentavos(convertedCostBasisCentavos),
    convertedCostBasisCentavos,
    currency: investment.currency,
    notes: redactInvestmentText(investment.notes, redacted),
    createdAt: investment.created_at,
    updatedAt: investment.updated_at,
    instrumentKey: investment.instrument_key,
    currentPrice: currentPriceCentavos === null ? null : fromCentavos(currentPriceCentavos),
    currentPriceDecimal,
    currentPriceCentavos,
    priceCurrency: valuation.valueCurrency,
    priceProvider: valuation.price?.provider ?? null,
    priceInstrumentId: valuation.price?.instrumentId ?? null,
    priceExchange: valuation.price?.exchange ?? null,
    priceDate: valuation.price?.quoteDate ?? null,
    lastPriceDate: valuation.price?.quoteDate ?? null,
    marketValue: marketValueCentavos === null ? null : fromCentavos(marketValueCentavos),
    marketValueCentavos,
    gainLoss: gainLossCentavos === null ? null : fromCentavos(gainLossCentavos),
    gainLossCentavos,
    gainLossCurrency: gainLossCentavos === null ? null : valuation.valueCurrency,
    gainLossPercent,
    valuationComplete: valuation.complete,
    valuationReasons: valuation.reasons,
  }
}

function getInvestment(investmentId: string): InvestmentWithPriceRow | null {
  return readInvestmentValuationRows('WHERE i.id = $1 LIMIT 1', [investmentId])[0] ?? null
}

function manualPriceIdentity(input: {
  type: InvestmentType
  symbol: string
  provider?: PriceProvider
  instrumentId?: string
  exchange?: string
  quoteCurrency: string
}): InstrumentIdentity {
  return {
    assetType: input.type,
    provider: input.provider ?? 'manual',
    instrumentId: normalizeOptionalText(input.instrumentId) ?? input.symbol,
    exchange: normalizeOptionalText(input.exchange) ?? '',
    quoteCurrency: normalizeCurrencyCode(input.quoteCurrency),
  }
}

export const manageInvestment: ToolDefinition = {
  name: 'manage-investment',
  description:
    'Add, update, or delete an investment holding. Use this to track US/MX stocks, ETFs, crypto, bonds, CETES, mutual funds, and other investments.',
  schema: z.object({
    action: z.enum(['add', 'update', 'delete']).describe('The action to perform'),
    investmentId: boundedText(
      'Investment ID',
      'Required for update/delete. The investment ID.',
      128
    ).optional(),
    name: boundedText('Investment name', 'Investment name (e.g. "Apple Inc.")', 200).optional(),
    symbol: assetCode('Ticker symbol (e.g. "AAPL")').optional(),
    type: z
      .enum(INVESTMENT_TYPES)
      .optional()
      .describe('Investment type, including CETES for Mexican treasury holdings'),
    shares: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe('Legacy-compatible number of shares/units'),
    quantityDecimal: z.string().trim().min(1).max(82).optional().describe('Exact decimal quantity'),
    avgCost: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe('Legacy-compatible average cost per unit'),
    avgCostDecimal: z
      .string()
      .trim()
      .min(1)
      .max(82)
      .optional()
      .describe('Exact average cost per unit'),
    costBasisKnown: z
      .boolean()
      .optional()
      .describe('Whether cost basis is known; known zero is explicit'),
    currentPrice: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe('Legacy-compatible manually verified unit price'),
    currentPriceDecimal: z
      .string()
      .trim()
      .min(1)
      .max(82)
      .optional()
      .describe('Exact manually verified unit price'),
    priceProvider: z.enum(['manual', 'alpha_vantage', 'finnhub', 'coingecko']).optional(),
    instrumentId: boundedText(
      'Instrument ID',
      'Provider instrument ID, never a guessed ticker',
      200
    ).optional(),
    exchange: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Exact listing exchange/region, or empty when not applicable'),
    quoteCurrency: assetCode('Actual quote currency').optional(),
    currency: assetCode('Cost basis currency code').optional(),
    accountId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('Link to an account by ID. Pass an empty string on update to clear.'),
    account: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('Account alias, exact account ID, or exact account name'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Notes about the investment. Pass an empty string on update to clear.'),
    source: boundedText(
      'Source',
      'Automation source or origin label for audit provenance',
      120
    ).optional(),
    note: boundedText('Note', 'Workflow changelog note for audit provenance', 500).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the investment change without writing it'),
  }),
  execute: async ({
    action,
    investmentId,
    name,
    symbol,
    type,
    shares,
    quantityDecimal,
    avgCost,
    avgCostDecimal,
    costBasisKnown,
    currentPrice,
    currentPriceDecimal,
    priceProvider,
    instrumentId,
    exchange,
    quoteCurrency,
    currency,
    accountId,
    account,
    notes,
    source,
    note,
    dryRun,
  }) => {
    if (action === 'add') {
      if (!name || !symbol) {
        return {
          success: false,
          reason: 'missing_required_fields',
          message: 'Name and symbol are required when adding an investment.',
        }
      }

      const id = generateId()
      const normalizedSymbol = normalizeInvestmentSymbol(symbol)
      const resolvedType = type ?? 'stock'
      const resolvedCurrency = normalizeCurrencyCode(currency) || 'USD'
      const exactQuantity = nonNegativeDecimal(quantityDecimal ?? String(shares ?? 0), 'Quantity')
      const legacyShares = shares ?? Number(exactQuantity)
      if (!Number.isFinite(legacyShares) || legacyShares < 0) {
        return {
          success: false,
          reason: 'invalid_quantity',
          message: 'Quantity must be non-negative.',
        }
      }
      const hasCost = avgCostDecimal !== undefined || avgCost !== undefined
      const resolvedCostKnown = costBasisKnown ?? hasCost
      const exactAvgCost = resolvedCostKnown
        ? nonNegativeDecimal(avgCostDecimal ?? String(avgCost ?? 0), 'Average cost')
        : null
      const avgCostCentavos = exactAvgCost === null ? 0 : toCentavos(Number(exactAvgCost))
      const hasManualPrice = currentPriceDecimal !== undefined || currentPrice !== undefined
      if (hasManualPrice && priceProvider && priceProvider !== 'manual') {
        return {
          success: false,
          reason: 'provider_quote_not_verified',
          message:
            'CLI-entered prices must use provider manual. Provider identities activate only after a validated provider response.',
        }
      }
      const identityFieldsRequested =
        priceProvider !== undefined ||
        instrumentId !== undefined ||
        exchange !== undefined ||
        quoteCurrency !== undefined
      if (identityFieldsRequested && !hasManualPrice) {
        return {
          success: false,
          reason: 'identity_not_validated',
          message:
            'A provider identity was not activated. Supply a manually verified price, or refresh through a provider adapter.',
        }
      }
      const exactPrice = hasManualPrice
        ? nonNegativeDecimal(currentPriceDecimal ?? String(currentPrice), 'Current price')
        : null
      const identity = exactPrice
        ? manualPriceIdentity({
            type: resolvedType,
            symbol: normalizedSymbol,
            provider: 'manual',
            instrumentId,
            exchange,
            quoteCurrency: quoteCurrency ?? resolvedCurrency,
          })
        : null
      const acceptedInstrumentKey = identity ? instrumentIdentityKey(identity) : null
      const resolvedAccount = resolveOptionalInvestmentAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      const now = dayjs().toISOString()
      const today = dayjs().format('YYYY-MM-DD')
      const investment: InvestmentWithPriceRow = {
        id,
        account_id: resolvedAccount.id,
        account_name: resolvedAccount.name,
        symbol: normalizedSymbol,
        name,
        type: resolvedType,
        shares: legacyShares,
        quantity_decimal: exactQuantity,
        avg_cost_basis: avgCostCentavos,
        avg_cost_basis_decimal: exactAvgCost,
        cost_basis_known: resolvedCostKnown ? 1 : 0,
        instrument_key: acceptedInstrumentKey,
        currency: resolvedCurrency,
        notes: normalizeOptionalText(notes),
        created_at: now,
        updated_at: now,
        price_instrument_key: acceptedInstrumentKey,
        price_asset_type: identity?.assetType ?? null,
        price_provider: identity?.provider ?? null,
        price_instrument_id: identity?.instrumentId ?? null,
        price_exchange: identity?.exchange ?? null,
        price_quote_currency: identity?.quoteCurrency ?? null,
        unit_price_decimal: exactPrice,
        quote_date: exactPrice === null ? null : today,
      }
      const snapshot = investmentSnapshot(investment)

      if (dryRun) {
        return {
          success: true,
          action: 'added' as const,
          dryRun: true,
          wouldCreate: snapshot,
          message: `Dry run: investment ${name} (${normalizedSymbol}) would be added.`,
        }
      }

      transaction(() => {
        execute(
          `INSERT INTO investments (id, account_id, symbol, name, type, shares, quantity_decimal, avg_cost_basis, avg_cost_basis_decimal, cost_basis_known, instrument_key, currency, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
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
            investment.created_at,
            investment.updated_at,
          ]
        )

        if (identity && exactPrice && acceptedInstrumentKey) {
          execute(
            `INSERT INTO instrument_prices (id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              generateId(),
              acceptedInstrumentKey,
              identity.assetType,
              identity.provider,
              identity.instrumentId,
              identity.exchange,
              identity.quoteCurrency,
              exactPrice,
              today,
              now,
            ]
          )
        }

        writeAuditLog({
          entity: 'investment',
          entityId: id,
          action: 'add',
          before: null,
          after: { investment: snapshot },
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'added' as const,
        dryRun: false,
        investment: snapshot,
        message: `Added investment: ${name} (${normalizedSymbol}) — ${exactQuantity} units.`,
      }
    }

    if (action === 'update') {
      if (!investmentId) {
        return {
          success: false,
          reason: 'investment_id_required',
          message: 'investmentId is required for update.',
        }
      }

      const existing = getInvestment(investmentId)
      if (!existing) {
        return {
          success: false,
          reason: 'investment_not_found',
          message: `Investment ${investmentId} not found.`,
        }
      }

      const accountWasProvided = accountId !== undefined || account !== undefined
      const resolvedAccount = accountWasProvided
        ? resolveOptionalInvestmentAccount(accountId, account)
        : null
      if (resolvedAccount && !resolvedAccount.success) return resolvedAccount

      const normalizedSymbol =
        symbol !== undefined ? normalizeInvestmentSymbol(symbol) : existing.symbol
      const resolvedType = type ?? existing.type
      const resolvedCurrency =
        currency !== undefined ? normalizeCurrencyCode(currency) : existing.currency
      const exactQuantity =
        quantityDecimal !== undefined
          ? nonNegativeDecimal(quantityDecimal, 'Quantity')
          : shares !== undefined
            ? nonNegativeDecimal(String(shares), 'Quantity')
            : existing.quantity_decimal?.trim() || String(existing.shares)
      const legacyShares =
        shares ?? (quantityDecimal !== undefined ? Number(exactQuantity) : existing.shares)
      if (!Number.isFinite(legacyShares) || legacyShares < 0) {
        return {
          success: false,
          reason: 'invalid_quantity',
          message: 'Quantity must be non-negative.',
        }
      }
      const costWasProvided = avgCostDecimal !== undefined || avgCost !== undefined
      const resolvedCostKnown =
        costBasisKnown ?? (costWasProvided ? true : existing.cost_basis_known === 1)
      const exactAvgCost = resolvedCostKnown
        ? nonNegativeDecimal(
            avgCostDecimal ??
              (avgCost !== undefined
                ? String(avgCost)
                : existing.avg_cost_basis_decimal?.trim() ||
                  decimalFromCentavos(existing.avg_cost_basis)),
            'Average cost'
          )
        : null
      const avgCostCentavos = exactAvgCost === null ? 0 : toCentavos(Number(exactAvgCost))
      const hasManualPrice = currentPriceDecimal !== undefined || currentPrice !== undefined
      if (hasManualPrice && priceProvider && priceProvider !== 'manual') {
        return {
          success: false,
          reason: 'provider_quote_not_verified',
          message:
            'CLI-entered prices must use provider manual. Provider identities activate only after a validated provider response.',
        }
      }
      const exactPrice = hasManualPrice
        ? nonNegativeDecimal(currentPriceDecimal ?? String(currentPrice), 'Current price')
        : null
      const replacementIdentity = exactPrice
        ? manualPriceIdentity({
            type: resolvedType,
            symbol: normalizedSymbol,
            provider: 'manual',
            instrumentId,
            exchange,
            quoteCurrency: quoteCurrency ?? resolvedCurrency,
          })
        : null
      const replacementInstrumentKey = replacementIdentity
        ? instrumentIdentityKey(replacementIdentity)
        : null
      const identityFieldsRequested =
        priceProvider !== undefined ||
        instrumentId !== undefined ||
        exchange !== undefined ||
        quoteCurrency !== undefined
      if (identityFieldsRequested && !exactPrice) {
        return {
          success: false,
          reason: 'identity_not_validated',
          message:
            'A replacement identity was not activated. Supply a manually verified price, or refresh through a provider adapter; the prior verified binding is preserved.',
        }
      }
      const investmentFieldsChanged =
        name !== undefined ||
        symbol !== undefined ||
        type !== undefined ||
        shares !== undefined ||
        quantityDecimal !== undefined ||
        avgCost !== undefined ||
        avgCostDecimal !== undefined ||
        costBasisKnown !== undefined ||
        currency !== undefined ||
        accountWasProvided ||
        notes !== undefined ||
        exactPrice !== null

      if (!investmentFieldsChanged) {
        return {
          success: false,
          reason: 'no_investment_changes',
          message: 'No fields to update.',
        }
      }

      const now = dayjs().toISOString()
      const today = dayjs().format('YYYY-MM-DD')
      const updated: InvestmentWithPriceRow = {
        ...existing,
        account_id:
          resolvedAccount && resolvedAccount.success ? resolvedAccount.id : existing.account_id,
        account_name:
          resolvedAccount && resolvedAccount.success ? resolvedAccount.name : existing.account_name,
        symbol: normalizedSymbol,
        name: name ?? existing.name,
        type: resolvedType,
        shares: legacyShares,
        quantity_decimal: exactQuantity,
        avg_cost_basis: avgCostCentavos,
        avg_cost_basis_decimal: exactAvgCost,
        cost_basis_known: resolvedCostKnown ? 1 : 0,
        instrument_key: replacementInstrumentKey ?? existing.instrument_key,
        currency: resolvedCurrency,
        notes: notes !== undefined ? normalizeOptionalText(notes) : existing.notes,
        updated_at: now,
        price_instrument_key: replacementInstrumentKey ?? existing.price_instrument_key,
        price_asset_type: replacementIdentity?.assetType ?? existing.price_asset_type,
        price_provider: replacementIdentity?.provider ?? existing.price_provider,
        price_instrument_id: replacementIdentity?.instrumentId ?? existing.price_instrument_id,
        price_exchange: replacementIdentity?.exchange ?? existing.price_exchange,
        price_quote_currency: replacementIdentity?.quoteCurrency ?? existing.price_quote_currency,
        unit_price_decimal: exactPrice ?? existing.unit_price_decimal,
        quote_date: exactPrice === null ? existing.quote_date : today,
      }
      const beforeSnapshot = investmentSnapshot(existing)
      const afterSnapshot = investmentSnapshot(updated)
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1
      const addSet = (column: string, value: unknown) => {
        setClauses.push(`${column} = $${paramIdx++}`)
        params.push(value)
      }

      if (name !== undefined) addSet('name', updated.name)
      if (symbol !== undefined) addSet('symbol', updated.symbol)
      if (type !== undefined) addSet('type', updated.type)
      if (shares !== undefined || quantityDecimal !== undefined) {
        addSet('shares', updated.shares)
        addSet('quantity_decimal', updated.quantity_decimal)
      }
      if (costWasProvided || costBasisKnown !== undefined) {
        addSet('avg_cost_basis', updated.avg_cost_basis)
        addSet('avg_cost_basis_decimal', updated.avg_cost_basis_decimal)
        addSet('cost_basis_known', updated.cost_basis_known)
      }
      if (replacementInstrumentKey) addSet('instrument_key', replacementInstrumentKey)
      if (currency !== undefined) addSet('currency', updated.currency)
      if (accountWasProvided) addSet('account_id', updated.account_id)
      if (notes !== undefined) addSet('notes', updated.notes)

      if (dryRun) {
        return {
          success: true,
          action: 'updated' as const,
          dryRun: true,
          wouldUpdate: {
            investmentId,
            before: beforeSnapshot,
            after: afterSnapshot,
          },
          message: `Dry run: investment "${updated.name}" would be updated.`,
        }
      }

      transaction(() => {
        if (setClauses.length > 0) {
          addSet('updated_at', updated.updated_at)
          params.push(investmentId)
          const updateResult = execute(
            `UPDATE investments SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
          )
          assertSingleRowUpdated(
            updateResult,
            `Investment ${investmentId} could not be updated safely.`
          )
        }

        if (replacementIdentity && replacementInstrumentKey && exactPrice) {
          execute(
            `INSERT INTO instrument_prices (id, instrument_key, asset_type, provider, instrument_id, exchange, quote_currency, unit_price_decimal, quote_date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT(instrument_key, quote_date) DO UPDATE SET
               unit_price_decimal = excluded.unit_price_decimal,
               created_at = excluded.created_at`,
            [
              generateId(),
              replacementInstrumentKey,
              replacementIdentity.assetType,
              replacementIdentity.provider,
              replacementIdentity.instrumentId,
              replacementIdentity.exchange,
              replacementIdentity.quoteCurrency,
              exactPrice,
              today,
              now,
            ]
          )
        }

        writeAuditLog({
          entity: 'investment',
          entityId: investmentId,
          action: 'update',
          before: { investment: beforeSnapshot },
          after: { investment: afterSnapshot },
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'updated' as const,
        dryRun: false,
        investment: afterSnapshot,
        message: `Updated investment "${updated.name}".`,
      }
    }

    if (action === 'delete') {
      if (!investmentId) {
        return {
          success: false,
          reason: 'investment_id_required',
          message: 'investmentId is required for delete.',
        }
      }

      const existing = getInvestment(investmentId)
      if (!existing) {
        return {
          success: false,
          reason: 'investment_not_found',
          message: `Investment ${investmentId} not found.`,
        }
      }
      const beforeSnapshot = investmentSnapshot(existing)

      if (dryRun) {
        return {
          success: true,
          action: 'deleted' as const,
          dryRun: true,
          wouldDelete: beforeSnapshot,
          message: `Dry run: investment "${existing.name}" (${existing.symbol}) would be deleted.`,
        }
      }

      transaction(() => {
        const deleteResult = execute('DELETE FROM investments WHERE id = $1', [investmentId])
        assertSingleRowUpdated(
          deleteResult,
          `Investment ${investmentId} could not be deleted safely.`
        )
        writeAuditLog({
          entity: 'investment',
          entityId: investmentId,
          action: 'delete',
          before: { investment: beforeSnapshot },
          after: null,
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'deleted' as const,
        dryRun: false,
        investment: beforeSnapshot,
        message: `Deleted investment "${existing.name}" (${existing.symbol}).`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

export const listInvestments: ToolDefinition = {
  name: 'list-investments',
  description:
    'List investment holdings with optional type, account, symbol, and text filters. Returns stable holding snapshots for CLI and MCP automation.',
  schema: z.object({
    type: z.enum(INVESTMENT_TYPES).optional().describe('Filter by investment type'),
    accountId: boundedText('Account ID', 'Filter by linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Filter by account alias, exact account ID, or exact account name',
      128
    ).optional(),
    symbol: assetCode('Filter by exact ticker symbol').optional(),
    search: boundedText('Search term', 'Search symbol, investment name, or notes', 200).optional(),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact investment names, account names, and notes in output'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  execute: async ({ type, accountId, account, symbol, search, redacted, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    let resolvedAccountId: string | null = null

    if (type) {
      conditions.push(`i.type = $${paramIdx++}`)
      params.push(type)
    }

    if (accountId || account) {
      const resolvedAccount = resolveOptionalInvestmentAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      resolvedAccountId = resolvedAccount.id
      conditions.push(`i.account_id = $${paramIdx++}`)
      params.push(resolvedAccount.id)
    }

    if (symbol) {
      conditions.push(`i.symbol = $${paramIdx++}`)
      params.push(normalizeInvestmentSymbol(symbol))
    }

    if (search) {
      const searchPattern = `%${search}%`
      conditions.push(
        `(LOWER(i.symbol) LIKE LOWER($${paramIdx}) OR LOWER(i.name) LIKE LOWER($${paramIdx}) OR LOWER(COALESCE(i.notes, '')) LIKE LOWER($${paramIdx}))`
      )
      params.push(searchPattern, searchPattern, searchPattern)
      paramIdx++
    }

    params.push(limit)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const investments = readInvestmentValuationRows(
      `${whereClause} ORDER BY i.symbol ASC, i.id ASC LIMIT $${paramIdx}`,
      params
    )

    const snapshots = investments.map((investment) => investmentSnapshot(investment, { redacted }))
    const { mainCurrency } = getCurrencySettings()
    const asOfDate = dayjs().format('YYYY-MM-DD')
    const mainHoldings =
      mainCurrency === null
        ? null
        : investments.map((row) =>
            valueHolding(
              rowToHoldingInput(row),
              mainCurrency,
              readValuationRates(mainCurrency, asOfDate)
            )
          )
    return {
      success: true,
      mainConversion: {
        complete: mainHoldings !== null && mainHoldings.every((holding) => holding.complete),
        toCurrency: mainCurrency,
        asOfDate,
        provenance: readValuationProvenance(mainCurrency, asOfDate),
        policy: 'current_holdings_today',
        reason: mainCurrency === null ? 'main_currency_unconfigured' : null,
        holdings: mainHoldings,
      },
      investments: snapshots,
      count: snapshots.length,
      redacted,
      filters: {
        type: type ?? null,
        accountId: resolvedAccountId,
        symbol: symbol ? normalizeInvestmentSymbol(symbol) : null,
        search: search ?? null,
      },
      message:
        snapshots.length === 0
          ? 'No investments found.'
          : `Found ${snapshots.length} investment${snapshots.length === 1 ? '' : 's'}.`,
    }
  },
}
