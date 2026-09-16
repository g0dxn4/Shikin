import dayjs, { type Dayjs } from 'dayjs'
import type { NetWorthPeriod } from '@/components/dashboard/overview-net-worth'

export interface AccountBalanceSnapshot {
  date: string
  balance: number
}

export interface ComparisonAccount {
  id: string
  name: string
  currency: string
  type: string
}

export interface PreferredConversionResult {
  complete: boolean
  preferredCurrency: string
  amountCentavos?: number
  missingCurrencies: ReadonlyArray<string>
  reason?: 'missing_exchange_rates' | 'invalid_currency_data'
}

export type ConvertToPreferred = (
  amountCentavos: number,
  fromCurrency: string
) => PreferredConversionResult

export type ComparisonDisplayMode = 'balance' | 'change'

export interface ComparisonChartPoint {
  date: string
  first: number | null
  second: number | null
}

export interface PreparedAccountComparison {
  complete: boolean
  points: ComparisonChartPoint[]
  firstStartDate: string | null
  secondStartDate: string | null
  missingCurrencies: string[]
  reason?: 'missing_exchange_rates' | 'invalid_currency_data'
}

export function getOverviewComparisonDateRange(period: NetWorthPeriod, today: Dayjs = dayjs()) {
  const endDate = today.format('YYYY-MM-DD')
  if (period === 'all') return { startDate: null, endDate }
  const amount = period === '3m' ? 3 : period === '6m' ? 6 : 1
  const unit = period === '1y' ? 'year' : 'month'
  return { startDate: today.subtract(amount, unit).format('YYYY-MM-DD'), endDate }
}

export function reconcileComparisonSelection(
  accountIds: readonly string[],
  selection: readonly [string, string]
): [string, string] {
  if (accountIds.length === 0) return ['', '']
  if (accountIds.length === 1) return [accountIds[0], '']

  const first = accountIds.includes(selection[0]) ? selection[0] : accountIds[0]
  const second =
    accountIds.includes(selection[1]) && selection[1] !== first
      ? selection[1]
      : (accountIds.find((id) => id !== first) ?? '')
  return [first, second]
}

export function prepareAccountComparison(
  firstHistory: readonly AccountBalanceSnapshot[],
  secondHistory: readonly AccountBalanceSnapshot[],
  firstAccount: ComparisonAccount,
  secondAccount: ComparisonAccount,
  mode: ComparisonDisplayMode,
  convertToPreferred: ConvertToPreferred
): PreparedAccountComparison {
  const firstConverted = convertHistory(firstHistory, firstAccount.currency, convertToPreferred)
  const secondConverted = convertHistory(secondHistory, secondAccount.currency, convertToPreferred)
  const missingCurrencies = [
    ...new Set([...firstConverted.missingCurrencies, ...secondConverted.missingCurrencies]),
  ].sort()

  if (!firstConverted.complete || !secondConverted.complete) {
    return {
      complete: false,
      points: [],
      firstStartDate: firstHistory[0]?.date ?? null,
      secondStartDate: secondHistory[0]?.date ?? null,
      missingCurrencies,
      reason:
        firstConverted.reason === 'invalid_currency_data' ||
        secondConverted.reason === 'invalid_currency_data'
          ? 'invalid_currency_data'
          : 'missing_exchange_rates',
    }
  }

  const firstByDate = new Map(firstConverted.points.map((point) => [point.date, point.balance]))
  const secondByDate = new Map(secondConverted.points.map((point) => [point.date, point.balance]))
  const dates = [...new Set([...firstByDate.keys(), ...secondByDate.keys()])].sort()
  const firstBaseline = firstConverted.points[0]?.balance ?? null
  const secondBaseline = secondConverted.points[0]?.balance ?? null

  return {
    complete: true,
    firstStartDate: firstConverted.points[0]?.date ?? null,
    secondStartDate: secondConverted.points[0]?.date ?? null,
    missingCurrencies: [],
    points: dates.map((date) => {
      const first = firstByDate.get(date) ?? null
      const second = secondByDate.get(date) ?? null
      return {
        date,
        first:
          first === null || (mode === 'change' && firstBaseline === null)
            ? null
            : mode === 'change'
              ? first - firstBaseline!
              : first,
        second:
          second === null || (mode === 'change' && secondBaseline === null)
            ? null
            : mode === 'change'
              ? second - secondBaseline!
              : second,
      }
    }),
  }
}

function convertHistory(
  history: readonly AccountBalanceSnapshot[],
  currency: string,
  convertToPreferred: ConvertToPreferred
): {
  complete: boolean
  points: AccountBalanceSnapshot[]
  missingCurrencies: string[]
  reason?: 'missing_exchange_rates' | 'invalid_currency_data'
} {
  const points: AccountBalanceSnapshot[] = []
  const missingCurrencies = new Set<string>()
  let reason: 'missing_exchange_rates' | 'invalid_currency_data' | undefined

  for (const point of history) {
    const converted = convertToPreferred(point.balance, currency)
    if (!converted.complete || converted.amountCentavos === undefined) {
      converted.missingCurrencies.forEach((item) => missingCurrencies.add(item))
      if (converted.reason === 'invalid_currency_data') reason = 'invalid_currency_data'
      else if (!reason) reason = 'missing_exchange_rates'
      continue
    }
    points.push({ date: point.date, balance: converted.amountCentavos })
  }

  return {
    complete: !reason,
    points: reason ? [] : points,
    missingCurrencies: [...missingCurrencies],
    reason,
  }
}
