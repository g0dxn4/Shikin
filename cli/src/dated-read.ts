import dayjs from 'dayjs'
import { convertDatedAmounts, type DatedAmount } from '@shikin/finance-core/fx'
import { getCurrencySettings, listExchangeRates } from './fx-service.js'

export const mainCurrencySetupNeeded = {
  success: false as const,
  complete: false as const,
  reason: 'main_currency_unconfigured' as const,
  message: 'Configure the database main currency before creating a denominated plan.',
}

export function sumCentavos(amounts: readonly number[]): number {
  const total = amounts.reduce((sum, amount) => {
    if (!Number.isSafeInteger(amount)) throw new RangeError('Unsafe centavo amount')
    return sum + BigInt(amount)
  }, 0n)
  const result = Number(total)
  if (!Number.isSafeInteger(result)) throw new RangeError('Unsafe centavo total')
  return result
}

/** Never converts a currency aggregate. Callers supply individual source amounts and dates. */
export function readDatedAmounts(
  rows: readonly DatedAmount[],
  targetCurrency: string | null = getCurrencySettings().mainCurrency
) {
  if (targetCurrency !== null) {
    const result = convertDatedAmounts(rows, targetCurrency, listExchangeRates())
    return {
      ...result,
      reason: result.complete ? null : 'missing_direct_rate',
    }
  }
  const currencies = [...new Set(rows.map((row) => row.currency))].sort()
  return {
    complete: false as const,
    reason: 'main_currency_unconfigured' as const,
    toCurrency: null,
    totalCentavos: null,
    knownTotalCentavos: null,
    nativeTotals: currencies.map((currency) => ({
      currency,
      amountCentavos: sumCentavos(
        rows.filter((row) => row.currency === currency).map((row) => row.amountCentavos)
      ),
    })),
    unresolvedIds: rows.map((row) => row.id).sort(),
    converted: [],
  }
}

/** Today's rate is a current valuation/planning estimate, not a future occurrence rate. */
export function readCurrentAmounts(
  rows: readonly Omit<DatedAmount, 'date'>[],
  targetCurrency: string | null = getCurrencySettings().mainCurrency
) {
  const asOfDate = dayjs().format('YYYY-MM-DD')
  return {
    ...readDatedAmounts(
      rows.map((row) => ({ ...row, date: asOfDate })),
      targetCurrency
    ),
    asOfDate,
    policy: 'current_value_today' as const,
  }
}
