export interface CurrencyAmount {
  currency: string
  amountCentavos: number
}

export interface CurrencyTotal {
  currency: string
  amountCentavos: number
}

export interface ConversionRate {
  fromCurrency: string
  toCurrency: string
  rate: number
}

export interface ConvertedCurrencyTotal extends CurrencyTotal {
  targetCurrency: string
  rate: number
  convertedAmountCentavos: number
}

export type CurrencyConversionResult =
  | {
      complete: true
      targetCurrency: string
      totalCentavos: number
      missingCurrencies: readonly []
      converted: ReadonlyArray<ConvertedCurrencyTotal>
    }
  | {
      complete: false
      targetCurrency: string
      totalCentavos: null
      missingCurrencies: ReadonlyArray<string>
      converted: ReadonlyArray<ConvertedCurrencyTotal>
    }

/** Aggregate integer centavos before any exchange-rate conversion. */
export function aggregateCentavosByCurrency(
  amounts: ReadonlyArray<CurrencyAmount>
): ReadonlyArray<CurrencyTotal> {
  const totals = new Map<string, number>()
  for (const amount of amounts) {
    const currency = normalizeCurrency(amount.currency)
    assertCentavos(amount.amountCentavos)
    const total = (totals.get(currency) ?? 0) + amount.amountCentavos
    if (!Number.isSafeInteger(total)) {
      throw new RangeError(`Centavo total for ${currency} exceeds the safe integer range`)
    }
    totals.set(currency, total)
  }

  return [...totals.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([currency, amountCentavos]) => ({ currency, amountCentavos }))
}

/**
 * Convert already-aggregated currency totals. Missing rates produce an incomplete
 * result; they are never interpreted as a 1:1 conversion.
 */
export function convertCurrencyTotals(
  totals: ReadonlyArray<CurrencyTotal>,
  targetCurrency: string,
  rates: ReadonlyArray<ConversionRate>
): CurrencyConversionResult {
  const target = normalizeCurrency(targetCurrency)
  const rateBySource = new Map<string, number>()
  for (const rate of rates) {
    const from = normalizeCurrency(rate.fromCurrency)
    const to = normalizeCurrency(rate.toCurrency)
    if (!Number.isFinite(rate.rate) || rate.rate <= 0) {
      throw new RangeError(`Conversion rate for ${from} -> ${to} must be positive and finite`)
    }
    if (to === target) rateBySource.set(from, rate.rate)
  }

  const normalizedTotals = aggregateCentavosByCurrency(totals)
  const missingCurrencies: string[] = []
  const converted: ConvertedCurrencyTotal[] = []

  for (const total of normalizedTotals) {
    const rate = total.currency === target ? 1 : rateBySource.get(total.currency)
    if (rate === undefined) {
      missingCurrencies.push(total.currency)
      continue
    }
    const convertedAmountCentavos = Math.round(total.amountCentavos * rate)
    if (!Number.isSafeInteger(convertedAmountCentavos)) {
      throw new RangeError(
        `Converted centavo total for ${total.currency} exceeds the safe integer range`
      )
    }
    converted.push({
      ...total,
      targetCurrency: target,
      rate,
      convertedAmountCentavos,
    })
  }

  if (missingCurrencies.length > 0) {
    return {
      complete: false,
      targetCurrency: target,
      totalCentavos: null,
      missingCurrencies,
      converted,
    }
  }

  const totalCentavos = converted.reduce((sum, item) => {
    const next = sum + item.convertedAmountCentavos
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`Converted total for ${target} exceeds the safe integer range`)
    }
    return next
  }, 0)

  return {
    complete: true,
    targetCurrency: target,
    totalCentavos,
    missingCurrencies: [],
    converted,
  }
}

function normalizeCurrency(value: string): string {
  const normalized = value.trim().toUpperCase()
  if (!normalized) throw new TypeError('currency must not be empty')
  return normalized
}

function assertCentavos(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('amountCentavos must be a safe integer')
  }
}
