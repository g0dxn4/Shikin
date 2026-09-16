import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { CartesianGrid, Legend, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { Account } from '@/types/database'
import type { NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import {
  prepareAccountComparison,
  reconcileComparisonSelection,
  type ComparisonDisplayMode,
  type ConvertToPreferred,
  type PreparedAccountComparison,
} from '@/components/dashboard/overview-account-comparison-helpers'
import { useOverviewAccountComparison } from '@/components/dashboard/use-overview-account-comparison'

const PERIODS: NetWorthPeriod[] = ['3m', '6m', '1y', 'all']

interface OverviewAccountComparisonProps {
  accounts: Account[]
  preferredCurrency: string
  rates: Readonly<Record<string, number>>
  invalidRates: ReadonlyArray<unknown>
  convertToPreferred: ConvertToPreferred
}

const INVALID_COMPARISON: PreparedAccountComparison = {
  complete: false,
  points: [],
  firstStartDate: null,
  secondStartDate: null,
  missingCurrencies: [],
  reason: 'invalid_currency_data',
}

export function OverviewAccountComparison({
  accounts,
  preferredCurrency,
  rates,
  invalidRates,
  convertToPreferred,
}: OverviewAccountComparisonProps) {
  const { t } = useTranslation('dashboard')
  const accountIds = useMemo(() => accounts.map((account) => account.id), [accounts])
  const [selection, setSelection] = useState<[string, string]>(['', ''])
  const [period, setPeriod] = useState<NetWorthPeriod>('6m')
  const [mode, setMode] = useState<ComparisonDisplayMode>('balance')
  const effectiveSelection = reconcileComparisonSelection(accountIds, selection)

  const firstAccount = accounts.find((account) => account.id === effectiveSelection[0])
  const secondAccount = accounts.find((account) => account.id === effectiveSelection[1])
  const { firstHistory, secondHistory, isLoading, error } = useOverviewAccountComparison(
    firstAccount?.id ?? '',
    secondAccount?.id ?? '',
    period
  )

  const comparison = useMemo(() => {
    // The store converter is stable; both its target currency and rates can change.
    void preferredCurrency
    void rates
    if (!firstAccount || !secondAccount) return INVALID_COMPARISON
    if (invalidRates.length > 0) return INVALID_COMPARISON
    return prepareAccountComparison(
      firstHistory,
      secondHistory,
      firstAccount,
      secondAccount,
      mode,
      convertToPreferred
    )
  }, [
    convertToPreferred,
    firstAccount,
    firstHistory,
    invalidRates,
    mode,
    preferredCurrency,
    rates,
    secondAccount,
    secondHistory,
  ])

  if (accounts.length < 2) {
    return (
      <div className="bg-muted flex min-h-52 items-center justify-center rounded-xl px-5 text-center">
        <p className="text-muted-foreground max-w-md text-sm">
          {accounts.length === 0
            ? t('overview.comparison.noAccounts')
            : t('overview.comparison.needTwoAccounts')}
        </p>
      </div>
    )
  }

  if (!firstAccount || !secondAccount) return null

  const firstLatest = findLatestValue(comparison.points, 'first')
  const secondLatest = findLatestValue(comparison.points, 'second')
  const hasNoHistory =
    !isLoading && !error && (firstHistory.length === 0 || secondHistory.length === 0)
  const conversionMessage =
    comparison.reason === 'invalid_currency_data'
      ? t('overview.comparison.invalidConversion')
      : t('overview.comparison.missingRates', {
          currencies: comparison.missingCurrencies.join(', '),
        })

  const selectAccount = (side: 'first' | 'second', accountId: string) => {
    const [first, second] = effectiveSelection
    if (side === 'first') {
      setSelection(accountId === second ? [accountId, first] : [accountId, second])
    } else {
      setSelection(accountId === first ? [second, accountId] : [first, accountId])
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <AccountSelect
          id="overview-compare-first"
          label={t('overview.comparison.firstAccount')}
          value={firstAccount.id}
          accounts={accounts}
          onChange={(value) => selectAccount('first', value)}
        />
        <AccountSelect
          id="overview-compare-second"
          label={t('overview.comparison.secondAccount')}
          value={secondAccount.id}
          accounts={accounts}
          onChange={(value) => selectAccount('second', value)}
        />
        <SegmentedControl
          label={t('overview.comparison.display')}
          value={mode}
          items={[
            { value: 'balance', label: t('overview.comparison.balance') },
            { value: 'change', label: t('overview.comparison.change') },
          ]}
          onChange={(value) => setMode(value as ComparisonDisplayMode)}
        />
        <PeriodControl
          period={period}
          onChange={setPeriod}
          label={t('overview.comparison.period')}
        />
      </div>

      <p className="text-muted-foreground mt-3 text-xs">
        {t('overview.comparison.recordedSnapshots')}
        {firstAccount.currency !== preferredCurrency || secondAccount.currency !== preferredCurrency
          ? ` ${t('overview.comparison.currentFx', { currency: preferredCurrency })}`
          : ''}
      </p>

      {mode === 'change' && comparison.complete ? (
        <p className="text-muted-foreground mt-1 text-xs">
          {t('overview.comparison.baseline', {
            first: firstAccount.name,
            firstDate: formatSnapshotDate(comparison.firstStartDate),
            second: secondAccount.name,
            secondDate: formatSnapshotDate(comparison.secondStartDate),
          })}
        </p>
      ) : null}

      {isLoading ? (
        <div
          className="bg-muted mt-4 flex h-64 items-center justify-center rounded-xl"
          role="status"
        >
          <p className="text-muted-foreground text-sm">{t('overview.comparison.loading')}</p>
        </div>
      ) : error ? (
        <div
          className="border-destructive/30 bg-destructive/10 mt-4 rounded-xl border px-4 py-8 text-center"
          role="alert"
        >
          <p className="text-destructive text-sm font-semibold">
            {t('overview.comparison.loadError')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{error}</p>
        </div>
      ) : !comparison.complete ? (
        <div
          className="border-warning/30 bg-warning/10 mt-4 rounded-xl border px-4 py-8 text-center"
          role="alert"
        >
          <p className="text-warning text-sm font-semibold">
            {t('overview.comparison.unavailable')}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">{conversionMessage}</p>
        </div>
      ) : hasNoHistory ? (
        <div className="bg-muted mt-4 flex h-64 items-center justify-center rounded-xl px-5 text-center">
          <p className="text-muted-foreground text-sm">
            {t('overview.comparison.noHistory', {
              accounts: [
                firstHistory.length === 0 ? firstAccount.name : null,
                secondHistory.length === 0 ? secondAccount.name : null,
              ]
                .filter(Boolean)
                .join(', '),
            })}
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <ComparisonValue
              name={firstAccount.name}
              value={firstLatest}
              currency={preferredCurrency}
              isDebt={
                mode === 'balance' &&
                firstAccount.type === 'credit_card' &&
                firstLatest !== null &&
                firstLatest < 0
              }
              debtLabel={t('overview.comparison.debtBalance')}
            />
            <ComparisonValue
              name={secondAccount.name}
              value={secondLatest}
              currency={preferredCurrency}
              isDebt={
                mode === 'balance' &&
                secondAccount.type === 'credit_card' &&
                secondLatest !== null &&
                secondLatest < 0
              }
              debtLabel={t('overview.comparison.debtBalance')}
            />
          </dl>
          <div
            className="mt-3 h-64 min-w-0 sm:h-72"
            role="img"
            aria-label={t('overview.comparison.chartLabel', {
              first: firstAccount.name,
              second: secondAccount.name,
            })}
          >
            <SafeChart>
              <LineChart data={comparison.points}>
                <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                  tickFormatter={(date) => dayjs(String(date)).format('MMM D')}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                  tickFormatter={(value) => formatMoney(Number(value), preferredCurrency)}
                  width={62}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_ITEM_STYLE}
                  labelStyle={CHART_LABEL_STYLE}
                  labelFormatter={(date) => dayjs(String(date)).format('MMM D, YYYY')}
                  formatter={(value, name) => [
                    value === null || value === undefined
                      ? '—'
                      : formatMoney(Number(value), preferredCurrency),
                    name,
                  ]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="first"
                  name={firstAccount.name}
                  connectNulls
                  isAnimationActive={false}
                  stroke="var(--color-chart-1)"
                  strokeWidth={2.2}
                  dot={{ r: 2.5 }}
                />
                <Line
                  type="monotone"
                  dataKey="second"
                  name={secondAccount.name}
                  connectNulls
                  isAnimationActive={false}
                  stroke="var(--color-chart-2)"
                  strokeWidth={2.2}
                  dot={{ r: 2.5 }}
                />
              </LineChart>
            </SafeChart>
          </div>
          <details className="mt-2">
            <summary className="text-accent cursor-pointer text-xs font-semibold">
              {t('overview.viewChartData')}
            </summary>
            <div className="max-w-full overflow-x-auto">
              <table className="mt-2 w-full min-w-[420px] text-xs">
                <caption className="sr-only">
                  {t('overview.comparison.chartLabel', {
                    first: firstAccount.name,
                    second: secondAccount.name,
                  })}
                </caption>
                <thead>
                  <tr>
                    <th className="py-1 pr-4 text-left font-medium">{t('analytics.day')}</th>
                    <th className="py-1 pr-4 text-left font-medium">{firstAccount.name}</th>
                    <th className="py-1 text-left font-medium">{secondAccount.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.points.map((point) => (
                    <tr key={point.date}>
                      <td className="py-1 pr-4">{dayjs(point.date).format('MMM D, YYYY')}</td>
                      <td className="py-1 pr-4 tabular-nums">
                        {formatOptionalMoney(point.first, preferredCurrency)}
                      </td>
                      <td className="py-1 tabular-nums">
                        {formatOptionalMoney(point.second, preferredCurrency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  )
}

function AccountSelect({
  id,
  label,
  value,
  accounts,
  onChange,
}: {
  id: string
  label: string
  value: string
  accounts: Account[]
  onChange: (value: string) => void
}) {
  return (
    <div className="min-w-0 flex-1 basis-44">
      <label htmlFor={id} className="text-muted-foreground mb-1 block text-xs font-medium">
        {label}
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              {account.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function SegmentedControl({
  label,
  value,
  items,
  onChange,
}: {
  label: string
  value: string
  items: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}) {
  return (
    <div>
      <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
      <div
        className="border-border bg-muted flex min-h-10 rounded-lg border p-0.5"
        role="group"
        aria-label={label}
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              'rounded-md px-3 py-2 text-xs font-semibold',
              value === item.value
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function PeriodControl({
  period,
  onChange,
  label,
}: {
  period: NetWorthPeriod
  onChange: (period: NetWorthPeriod) => void
  label: string
}) {
  const { t } = useTranslation('dashboard')
  return (
    <div>
      <span className="text-muted-foreground mb-1 block text-xs font-medium">{label}</span>
      <div
        className="border-border bg-muted flex min-h-10 rounded-lg border p-0.5"
        role="group"
        aria-label={label}
      >
        {PERIODS.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={period === item}
            onClick={() => onChange(item)}
            className={cn(
              'min-w-10 rounded-md px-2 py-2 text-xs font-semibold',
              period === item
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t(`overview.period.${item}`)}
          </button>
        ))}
      </div>
    </div>
  )
}

function ComparisonValue({
  name,
  value,
  currency,
  isDebt,
  debtLabel,
}: {
  name: string
  value: number | null
  currency: string
  isDebt: boolean
  debtLabel: string
}) {
  return (
    <div className="border-border rounded-lg border px-3 py-2">
      <dt className="text-muted-foreground text-xs">{name}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{formatOptionalMoney(value, currency)}</dd>
      {isDebt ? (
        <span className="text-muted-foreground mt-0.5 block text-[10px]">{debtLabel}</span>
      ) : null}
    </div>
  )
}

function findLatestValue(points: PreparedAccountComparison['points'], key: 'first' | 'second') {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index][key]
    if (value !== null) return value
  }
  return null
}

function formatOptionalMoney(value: number | null, currency: string) {
  return value === null ? '—' : formatMoney(value, currency)
}

function formatSnapshotDate(date: string | null) {
  return date ? dayjs(date).format('MMM D, YYYY') : '—'
}
