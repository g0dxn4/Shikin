export type ValuationMode = 'cash_plus_holdings' | 'portfolio_snapshot' | 'unresolved'

export type ValuationAssetType =
  | 'stock'
  | 'etf'
  | 'crypto'
  | 'bond'
  | 'mutual_fund'
  | 'cetes'
  | 'other'

export type PriceProvider = 'manual' | 'alpha_vantage' | 'finnhub' | 'coingecko'

export interface InstrumentIdentity {
  assetType: ValuationAssetType
  provider: PriceProvider
  instrumentId: string
  exchange: string
  quoteCurrency: string
}

export interface VerifiedInstrumentPrice extends InstrumentIdentity {
  instrumentKey: string
  unitPriceDecimal: string
  quoteDate: string
}

export interface ValuationRate {
  fromCurrency: string
  toCurrency: string
  rateDecimal: string
}

export interface HoldingValuationInput {
  id: string
  accountId: string | null
  assetType: ValuationAssetType
  quantityDecimal: string
  costCurrency: string
  costBasisKnown: boolean
  avgCostBasisDecimal: string | null
  instrumentKey: string | null
  price: VerifiedInstrumentPrice | null
}

export interface HoldingValuation {
  id: string
  accountId: string | null
  quantityDecimal: string
  instrumentKey: string | null
  price: VerifiedInstrumentPrice | null
  valueCurrency: string | null
  valueCentavos: number | null
  convertedValueCentavos: number | null
  costCurrency: string
  costBasisKnown: boolean
  costBasisCentavos: number | null
  convertedCostBasisCentavos: number | null
  gainLossCentavos: number | null
  complete: boolean
  reasons: string[]
}

export interface ValuationAccountInput {
  id: string
  name: string
  type: string
  currency: string
  balanceCentavos: number
  valuationMode: ValuationMode
}

export interface NativeValuationTotal {
  currency: string
  assetsCentavos: number
  liabilitiesCentavos: number
  netWorthCentavos: number
  investmentsCentavos: number
}

export interface AccountValuationComponent {
  id: string
  name: string
  type: string
  currency: string
  rawBalanceCentavos: number
  assetCentavos: number
  liabilityCentavos: number
  valuationMode: ValuationMode
  linkedHoldingIds: string[]
  included: boolean
  reason: string | null
}

export interface OwnershipValuationResult {
  complete: boolean
  targetCurrency: string
  totalAssetsCentavos: number | null
  totalLiabilitiesCentavos: number | null
  totalInvestmentsCentavos: number | null
  netWorthCentavos: number | null
  nativeTotals: NativeValuationTotal[]
  missingCurrencies: string[]
  unresolvedAccountIds: string[]
  incompleteHoldingIds: string[]
  accounts: AccountValuationComponent[]
  holdings: Array<HoldingValuation & { included: boolean; comparisonOnly: boolean }>
}

type ParsedDecimal = { coefficient: bigint; scale: number }

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d+))?$/
const MAX_DECIMAL_DIGITS = 80
const MAX_DECIMAL_SCALE = 40
const MAX_MULTIPLICATION_FACTORS = 16
const MAX_MULTIPLICATION_DIGITS = 240

function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!normalized) throw new TypeError('currency must not be empty')
  return normalized
}

function normalizeIdentityPart(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${label} must not be empty`)
  return normalized
}

function parseDecimal(value: string): ParsedDecimal {
  const normalized = value.trim()
  const match = DECIMAL_PATTERN.exec(normalized)
  if (!match) throw new TypeError(`Invalid decimal: ${value}`)
  const integer = match[2]!
  const fraction = match[3] ?? ''
  if (
    integer.length + fraction.length > MAX_DECIMAL_DIGITS ||
    fraction.length > MAX_DECIMAL_SCALE
  ) {
    throw new RangeError('Decimal exceeds supported precision')
  }
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '')
  const coefficient = BigInt(`${match[1]}${digits}`)
  return { coefficient, scale: fraction.length }
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent)
}

function roundRatio(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  const negative = numerator < 0n
  const absolute = negative ? -numerator : numerator
  const quotient = absolute / denominator
  const remainder = absolute % denominator
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient
  return negative ? -rounded : rounded
}

function safeNumber(value: bigint, label: string): number {
  const number = Number(value)
  if (!Number.isSafeInteger(number)) throw new RangeError(`${label} exceeds the safe integer range`)
  return number
}

/** Multiply decimal factors and round once, at the final position/reporting centavo. */
export function multiplyDecimalsToCentavos(factors: readonly string[]): number {
  if (factors.length > MAX_MULTIPLICATION_FACTORS) {
    throw new RangeError('Too many decimal factors')
  }
  let coefficient = 100n
  let scale = 0
  let digits = 0
  for (const factor of factors) {
    const parsed = parseDecimal(factor)
    digits += (parsed.coefficient < 0n ? -parsed.coefficient : parsed.coefficient).toString().length
    if (digits > MAX_MULTIPLICATION_DIGITS) {
      throw new RangeError('Decimal multiplication exceeds supported precision')
    }
    coefficient *= parsed.coefficient
    scale += parsed.scale
  }
  return safeNumber(roundRatio(coefficient, pow10(scale)), 'Decimal amount')
}

export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value)) throw new TypeError('Decimal number must be finite')
  const rendered = String(value)
  if (!/[eE]/.test(rendered)) return canonicalDecimal(rendered)

  const match = /^([+-]?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(rendered)
  if (!match) throw new TypeError(`Invalid decimal number: ${rendered}`)
  const sign = match[1] ?? ''
  const integer = match[2]!
  const fraction = match[3] ?? ''
  const exponent = Number(match[4])
  if (!Number.isSafeInteger(exponent)) throw new RangeError('Decimal exponent is out of range')

  const digits = `${integer}${fraction}`
  const decimalPosition = integer.length + exponent
  const expanded =
    decimalPosition <= 0
      ? `0.${'0'.repeat(-decimalPosition)}${digits}`
      : decimalPosition >= digits.length
        ? `${digits}${'0'.repeat(decimalPosition - digits.length)}`
        : `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`
  return canonicalDecimal(`${sign}${expanded}`)
}

export function canonicalDecimal(value: string): string {
  const parsed = parseDecimal(value)
  const negative = parsed.coefficient < 0n
  const absolute = negative ? -parsed.coefficient : parsed.coefficient
  const digits = absolute.toString().padStart(parsed.scale + 1, '0')
  const integer = parsed.scale === 0 ? digits : digits.slice(0, -parsed.scale)
  const fraction = parsed.scale === 0 ? '' : digits.slice(-parsed.scale).replace(/0+$/, '')
  const rendered = fraction ? `${integer}.${fraction}` : integer
  return `${negative && absolute !== 0n ? '-' : ''}${rendered}`
}

export function decimalFromCentavos(value: number): string {
  if (!Number.isSafeInteger(value)) throw new RangeError('centavos must be a safe integer')
  const negative = value < 0
  const absolute = BigInt(Math.abs(value))
  const integer = absolute / 100n
  const fraction = (absolute % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${integer}.${fraction}`
}

export function instrumentIdentityKey(identity: InstrumentIdentity): string {
  const values = [
    identity.assetType,
    identity.provider,
    normalizeIdentityPart(identity.instrumentId, 'instrumentId'),
    identity.exchange.trim(),
    normalizeCurrency(identity.quoteCurrency),
  ]
  return `v1|${values.map((value) => encodeURIComponent(value)).join('|')}`
}

export function isVerifiedInstrumentPrice(price: VerifiedInstrumentPrice): boolean {
  try {
    return (
      price.instrumentKey === instrumentIdentityKey(price) &&
      canonicalDecimal(price.unitPriceDecimal) === price.unitPriceDecimal.trim() &&
      parseDecimal(price.unitPriceDecimal).coefficient >= 0n &&
      Boolean(price.quoteDate.trim())
    )
  } catch {
    return false
  }
}

function findRate(
  fromCurrency: string,
  toCurrency: string,
  rates: readonly ValuationRate[]
): string | null {
  const from = normalizeCurrency(fromCurrency)
  const to = normalizeCurrency(toCurrency)
  if (from === to) return '1'
  for (const rate of rates) {
    if (
      normalizeCurrency(rate.fromCurrency) === from &&
      normalizeCurrency(rate.toCurrency) === to
    ) {
      const parsed = parseDecimal(rate.rateDecimal)
      if (parsed.coefficient > 0n) return canonicalDecimal(rate.rateDecimal)
    }
  }
  return null
}

export function valueHolding(
  holding: HoldingValuationInput,
  targetCurrency: string,
  rates: readonly ValuationRate[] = []
): HoldingValuation {
  const target = normalizeCurrency(targetCurrency)
  const costCurrency = normalizeCurrency(holding.costCurrency)
  const quantity = canonicalDecimal(holding.quantityDecimal)
  if (parseDecimal(quantity).coefficient < 0n) throw new RangeError('quantity must be non-negative')
  const reasons: string[] = []
  let price = holding.price

  if (
    !price ||
    !holding.instrumentKey ||
    price.instrumentKey !== holding.instrumentKey ||
    price.assetType !== holding.assetType ||
    !isVerifiedInstrumentPrice(price)
  ) {
    price = null
    reasons.push('verified_price_missing')
  }

  let valueCentavos: number | null = null
  let convertedValueCentavos: number | null = null
  let valueCurrency: string | null = null
  if (price) {
    valueCurrency = normalizeCurrency(price.quoteCurrency)
    valueCentavos = multiplyDecimalsToCentavos([quantity, price.unitPriceDecimal])
    const valueRate = findRate(valueCurrency, target, rates)
    if (valueRate) {
      // Preserve sub-cent native value through conversion and round only in target currency.
      convertedValueCentavos = multiplyDecimalsToCentavos([
        quantity,
        price.unitPriceDecimal,
        valueRate,
      ])
    } else {
      reasons.push(`missing_fx:${valueCurrency}:${target}`)
    }
  }

  let costBasisCentavos: number | null = null
  let convertedCostBasisCentavos: number | null = null
  if (holding.costBasisKnown) {
    if (holding.avgCostBasisDecimal === null) {
      reasons.push('known_cost_basis_missing')
    } else {
      const avgCost = canonicalDecimal(holding.avgCostBasisDecimal)
      if (parseDecimal(avgCost).coefficient < 0n) {
        throw new RangeError('average cost basis must be non-negative')
      }
      costBasisCentavos = multiplyDecimalsToCentavos([quantity, avgCost])
      const costRate = findRate(costCurrency, target, rates)
      if (costRate) {
        convertedCostBasisCentavos = multiplyDecimalsToCentavos([quantity, avgCost, costRate])
      } else {
        reasons.push(`missing_cost_fx:${costCurrency}:${target}`)
      }
    }
  }

  let gainLossCentavos: number | null = null
  if (convertedValueCentavos !== null && convertedCostBasisCentavos !== null) {
    const gain = convertedValueCentavos - convertedCostBasisCentavos
    if (!Number.isSafeInteger(gain))
      throw new RangeError('Gain/loss exceeds the safe integer range')
    gainLossCentavos = gain
  }

  return {
    id: holding.id,
    accountId: holding.accountId,
    quantityDecimal: quantity,
    instrumentKey: holding.instrumentKey,
    price,
    valueCurrency,
    valueCentavos,
    convertedValueCentavos,
    costCurrency,
    costBasisKnown: holding.costBasisKnown,
    costBasisCentavos,
    convertedCostBasisCentavos,
    gainLossCentavos,
    complete: price !== null && convertedValueCentavos !== null,
    reasons,
  }
}

function addSafe(left: number, right: number, label: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range`)
  return result
}

function convertCentavos(
  amountCentavos: number,
  fromCurrency: string,
  targetCurrency: string,
  rates: readonly ValuationRate[]
): number | null {
  if (!Number.isSafeInteger(amountCentavos)) throw new RangeError('balance must be a safe integer')
  const rate = findRate(fromCurrency, targetCurrency, rates)
  return rate ? multiplyDecimalsToCentavos([decimalFromCentavos(amountCentavos), rate]) : null
}

export function calculateOwnershipValuation(input: {
  accounts: readonly ValuationAccountInput[]
  holdings: readonly HoldingValuationInput[]
  targetCurrency: string
  rates?: readonly ValuationRate[]
}): OwnershipValuationResult {
  const targetCurrency = normalizeCurrency(input.targetCurrency)
  const rates = input.rates ?? []
  const holdings = input.holdings.map((holding) => valueHolding(holding, targetCurrency, rates))
  const holdingsByAccount = new Map<string, HoldingValuation[]>()
  for (const holding of holdings) {
    if (!holding.accountId) continue
    const linked = holdingsByAccount.get(holding.accountId) ?? []
    linked.push(holding)
    holdingsByAccount.set(holding.accountId, linked)
  }

  const native = new Map<string, NativeValuationTotal>()
  const ensureNative = (currencyValue: string) => {
    const currency = normalizeCurrency(currencyValue)
    let total = native.get(currency)
    if (!total) {
      total = {
        currency,
        assetsCentavos: 0,
        liabilitiesCentavos: 0,
        netWorthCentavos: 0,
        investmentsCentavos: 0,
      }
      native.set(currency, total)
    }
    return total
  }

  let convertedAssets = 0
  let convertedLiabilities = 0
  let convertedInvestments = 0
  const missingCurrencies = new Set<string>()
  const unresolvedAccountIds: string[] = []
  const incompleteHoldingIds: string[] = []
  const includedHoldingIds = new Set<string>()
  const comparisonOnlyHoldingIds = new Set<string>()
  const accountComponents: AccountValuationComponent[] = []

  for (const account of input.accounts) {
    if (!Number.isSafeInteger(account.balanceCentavos)) {
      throw new RangeError(`Account ${account.id} balance must be a safe integer`)
    }
    const linked = holdingsByAccount.get(account.id) ?? []
    const unresolvedOverlap = account.valuationMode === 'unresolved' && linked.length > 0
    const included = !unresolvedOverlap
    const assetCentavos = Math.max(account.balanceCentavos, 0)
    const liabilityCentavos = Math.max(-account.balanceCentavos, 0)
    accountComponents.push({
      id: account.id,
      name: account.name,
      type: account.type,
      currency: normalizeCurrency(account.currency),
      rawBalanceCentavos: account.balanceCentavos,
      assetCentavos,
      liabilityCentavos,
      valuationMode: account.valuationMode,
      linkedHoldingIds: linked.map((holding) => holding.id),
      included,
      reason: unresolvedOverlap ? 'ownership_overlap_unresolved' : null,
    })

    if (unresolvedOverlap) {
      unresolvedAccountIds.push(account.id)
      continue
    }

    const nativeTotal = ensureNative(account.currency)
    nativeTotal.assetsCentavos = addSafe(nativeTotal.assetsCentavos, assetCentavos, 'Native assets')
    nativeTotal.liabilitiesCentavos = addSafe(
      nativeTotal.liabilitiesCentavos,
      liabilityCentavos,
      'Native liabilities'
    )
    nativeTotal.netWorthCentavos = addSafe(
      nativeTotal.netWorthCentavos,
      account.balanceCentavos,
      'Native net worth'
    )

    const convertedAsset = convertCentavos(assetCentavos, account.currency, targetCurrency, rates)
    const convertedLiability = convertCentavos(
      liabilityCentavos,
      account.currency,
      targetCurrency,
      rates
    )
    if (convertedAsset === null || convertedLiability === null) {
      missingCurrencies.add(normalizeCurrency(account.currency))
    } else {
      convertedAssets = addSafe(convertedAssets, convertedAsset, 'Converted assets')
      convertedLiabilities = addSafe(
        convertedLiabilities,
        convertedLiability,
        'Converted liabilities'
      )
    }

    if (account.valuationMode === 'portfolio_snapshot') {
      for (const holding of linked) comparisonOnlyHoldingIds.add(holding.id)
    } else {
      for (const holding of linked) includedHoldingIds.add(holding.id)
    }
  }

  for (const holding of holdings) {
    if (!holding.accountId) includedHoldingIds.add(holding.id)
    if (!includedHoldingIds.has(holding.id)) continue

    if (holding.valueCentavos !== null && holding.valueCurrency !== null) {
      const nativeTotal = ensureNative(holding.valueCurrency)
      nativeTotal.assetsCentavos = addSafe(
        nativeTotal.assetsCentavos,
        holding.valueCentavos,
        'Native assets'
      )
      nativeTotal.investmentsCentavos = addSafe(
        nativeTotal.investmentsCentavos,
        holding.valueCentavos,
        'Native investments'
      )
      nativeTotal.netWorthCentavos = addSafe(
        nativeTotal.netWorthCentavos,
        holding.valueCentavos,
        'Native net worth'
      )
    }

    if (!holding.complete) {
      incompleteHoldingIds.push(holding.id)
      for (const reason of holding.reasons) {
        if (reason.startsWith('missing_fx:')) {
          const currency = reason.split(':')[1]
          if (currency) missingCurrencies.add(currency)
        }
      }
    }

    if (holding.convertedValueCentavos === null) {
      if (holding.valueCurrency !== null) missingCurrencies.add(holding.valueCurrency)
    } else {
      convertedAssets = addSafe(convertedAssets, holding.convertedValueCentavos, 'Converted assets')
      convertedInvestments = addSafe(
        convertedInvestments,
        holding.convertedValueCentavos,
        'Converted investments'
      )
    }
  }

  const nativeTotals = [...native.values()]
    .map((total) => ({ ...total }))
    .sort((left, right) => left.currency.localeCompare(right.currency))
  const complete =
    unresolvedAccountIds.length === 0 &&
    incompleteHoldingIds.length === 0 &&
    missingCurrencies.size === 0
  const netWorth = convertedAssets - convertedLiabilities
  if (!Number.isSafeInteger(netWorth)) throw new RangeError('Net worth exceeds safe integer range')

  return {
    complete,
    targetCurrency,
    totalAssetsCentavos: complete ? convertedAssets : null,
    totalLiabilitiesCentavos: complete ? convertedLiabilities : null,
    totalInvestmentsCentavos: complete ? convertedInvestments : null,
    netWorthCentavos: complete ? netWorth : null,
    nativeTotals,
    missingCurrencies: [...missingCurrencies].sort(),
    unresolvedAccountIds: unresolvedAccountIds.sort(),
    incompleteHoldingIds: incompleteHoldingIds.sort(),
    accounts: accountComponents,
    holdings: holdings.map((holding) => ({
      ...holding,
      included: includedHoldingIds.has(holding.id),
      comparisonOnly: comparisonOnlyHoldingIds.has(holding.id),
    })),
  }
}
