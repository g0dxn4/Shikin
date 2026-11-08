export interface CurrencyAmount {
  currency: string
  amountCentavos: number
}

export interface CurrencyTotal {
  currency: string
  amountCentavos: number
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
