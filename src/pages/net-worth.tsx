import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Landmark, CreditCard } from 'lucide-react'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { FX_CURRENCIES } from '@shikin/finance-core/fx'
import { SafeChart } from '@/components/ui/safe-chart'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { MoneyChartTable } from '@/components/insights/money-chart-table'
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

const PERIODS = [{ value: '3m' }, { value: '6m' }, { value: '1y' }, { value: 'all' }] as const

function describeIncompleteNetWorth(reasons: Array<string | false | undefined>, fallback: string) {
  const parts = reasons.filter((reason): reason is string => Boolean(reason))
  return parts.length > 0 ? parts.join(' ') : fallback
}

function formatNativeSnapshotEvidence(snapshot: {
  date: string
  currency: string
  amountCentavos: number
}) {
  const currency = snapshot.currency.trim().toUpperCase()
  const amount = (FX_CURRENCIES as readonly string[]).includes(currency)
    ? formatMoney(snapshot.amountCentavos, currency)
    : '—'
  return `${dayjs(snapshot.date).format('MMM D, YYYY')}: ${amount}`
}

export function NetWorth() {
  const { t } = useTranslation('analytics')
  const historyTableId = useId()
  const liveContextId = useId()
  const [period, setPeriod] = useState('1y')
  const [showHistoryTable, setShowHistoryTable] = useState(false)
  const {
    totalAssets,
    totalLiabilities,
    totalInvestments,
    netWorth,
    totalsComplete,
    preferredCurrency = 'USD',
    missingCurrencies,
    incompleteHoldingIds,
    unresolvedAccountIds,
    assetBreakdown,
    liabilityBreakdown,
    history,
    historyComplete = false,
    historyAuthorityKey = null,
    historyCurrency = null,
    historyRequestedPeriod = null,
    historyLoading = false,
    historyError = null,
    historyMissingCurrencies = [],
    historyNativeSnapshots = [],
    isLoading,
    refresh,
  } = useNetWorthStore()
  const { mainCurrency, manualRates } = useCurrencyStore()
  const currentAuthorityKey = currencyAuthorityKey({ mainCurrency, manualRates })

  useEffect(() => {
    void refresh(period).catch(() => {})
  }, [period, refresh])

  const historyDisplayable =
    historyComplete &&
    mainCurrency !== null &&
    historyAuthorityKey === currentAuthorityKey &&
    historyCurrency === mainCurrency &&
    historyRequestedPeriod === period
  const displayableHistory = historyDisplayable ? history : []
  const historyDisplayCurrency = historyDisplayable ? historyCurrency : null
  const firstPoint = displayableHistory.length > 0 ? displayableHistory[0] : null
  const lastPoint =
    displayableHistory.length > 1 ? displayableHistory[displayableHistory.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const changePercent =
    firstPoint && firstPoint.netWorth !== 0
      ? ((changeAmount / Math.abs(firstPoint.netWorth)) * 100).toFixed(1)
      : '0'
  const isPositiveChange = changeAmount >= 0
  const totalAssetsAbs = Math.abs(totalAssets ?? 0)
  const totalLiabilitiesAbs = Math.abs(totalLiabilities ?? 0)
  const hasData = assetBreakdown.length > 0 || liabilityBreakdown.length > 0
  const recordedSeriesReady =
    historyDisplayable &&
    historyDisplayCurrency !== null &&
    displayableHistory.length > 1 &&
    displayableHistory.every(
      (point) => Number.isSafeInteger(point.assets) && Number.isSafeInteger(point.liabilities)
    )
  const currentValue =
    totalsComplete && netWorth !== null && preferredCurrency
      ? formatMoney(netWorth, preferredCurrency)
      : '—'
  const assetTotal =
    totalsComplete && totalAssets !== null && preferredCurrency
      ? formatMoney(totalAssets, preferredCurrency)
      : '—'
  const liabilityTotal =
    totalsComplete && totalLiabilities !== null && preferredCurrency
      ? formatMoney(totalLiabilities, preferredCurrency)
      : '—'

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        actions={
          <div
            className="border-border bg-muted flex max-w-full flex-wrap rounded-lg border p-0.5"
            role="group"
            aria-label={t('netWorth.historyPeriod')}
          >
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={period === item.value}
                onClick={() => setPeriod(item.value)}
                className={cn(
                  'focus-visible:ring-ring min-h-11 min-w-11 rounded-md px-2.5 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
                  period === item.value
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`netWorth.periods.${item.value}`)}
              </button>
            ))}
          </div>
        }
      />

      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="mt-3 h-64 w-full" />
        </div>
      ) : (
        <>
          <NativePanel className="min-w-0 p-4 sm:p-6">
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-3">
              <div className="min-w-0" aria-describedby={liveContextId}>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="border-border text-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase">
                    {t('netWorth.live')}
                  </span>
                  <span className="sr-only">{t('netWorth.currentNetWorth')}</span>
                  {totalsComplete && preferredCurrency ? (
                    <span className="border-border text-muted-foreground inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide">
                      {preferredCurrency}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 max-w-full overflow-x-auto text-3xl font-medium tracking-tight whitespace-nowrap tabular-nums">
                  {currentValue}
                </p>
                <p id={liveContextId} className="sr-only">
                  {t('netWorth.currentContext')}
                </p>
              </div>
              {!recordedSeriesReady && firstPoint && historyDisplayCurrency ? (
                <p className="text-muted-foreground min-w-0 text-xs tabular-nums">
                  <span className="text-foreground font-semibold">{t('netWorth.recorded')}</span>
                  {' · '}
                  {dayjs(firstPoint.date).format('MMM D, YYYY')}
                  {' · '}
                  {formatMoney(firstPoint.netWorth, historyDisplayCurrency)}
                </p>
              ) : null}
            </div>

            {!totalsComplete ? (
              <div className="border-warning/30 bg-warning/10 text-warning mt-4 rounded-lg border px-3 py-2 text-sm">
                {describeIncompleteNetWorth(
                  [
                    missingCurrencies.length > 0 &&
                      t('netWorth.incompleteTotals', { currencies: missingCurrencies.join(', ') }),
                    incompleteHoldingIds.length > 0 &&
                      t('netWorth.incompleteHoldings', { count: incompleteHoldingIds.length }),
                    unresolvedAccountIds.length > 0 &&
                      t('netWorth.unresolvedOwnership', { count: unresolvedAccountIds.length }),
                  ],
                  t('netWorth.unavailable')
                )}
              </div>
            ) : null}

            {!historyDisplayable ? (
              <div
                className="border-warning/30 bg-warning/10 text-warning mt-4 rounded-lg border px-3 py-2 text-sm"
                role={historyLoading ? 'status' : 'alert'}
              >
                {historyLoading ? t('netWorth.historyLoading') : t('netWorth.unavailable')}
                {historyError ? ` · ${historyError}` : ''}
                {historyMissingCurrencies.length > 0
                  ? ` · ${historyMissingCurrencies.join(', ')}`
                  : ''}
                {historyNativeSnapshots.length > 0 ? (
                  <span className="text-muted-foreground mt-1 block text-xs">
                    {historyNativeSnapshots
                      .map((snapshot) => formatNativeSnapshotEvidence(snapshot))
                      .join(' · ')}
                  </span>
                ) : null}
              </div>
            ) : null}

            {recordedSeriesReady && historyDisplayCurrency && firstPoint && lastPoint ? (
              <>
                <div
                  className="mt-5 h-64 min-w-0 sm:h-72"
                  role="img"
                  aria-label={t('netWorth.chartTitle')}
                  aria-describedby={historyTableId}
                >
                  <SafeChart>
                    <LineChart
                      data={displayableHistory}
                      margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid
                        vertical={false}
                        strokeDasharray="2 4"
                        stroke={CHART_GRID_COLOR}
                      />
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                        tickFormatter={(value) => dayjs(value).format('MMM D')}
                        minTickGap={16}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        width={52}
                        tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                        tickFormatter={(value) =>
                          formatCompactChartMoney(Number(value), historyDisplayCurrency)
                        }
                      />
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        itemStyle={CHART_ITEM_STYLE}
                        labelStyle={CHART_LABEL_STYLE}
                        labelFormatter={(value) => dayjs(value).format('MMM D, YYYY')}
                        formatter={(value, name) => [
                          formatMoney(Number(value), historyDisplayCurrency),
                          name === 'assets'
                            ? t('netWorth.recordedAssets')
                            : name === 'liabilities'
                              ? t('netWorth.recordedLiabilities')
                              : t('netWorth.title'),
                        ]}
                      />
                      <Line
                        type="linear"
                        dataKey="assets"
                        name="assets"
                        stroke="var(--color-chart-3)"
                        strokeWidth={1}
                        strokeOpacity={0.45}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="liabilities"
                        name="liabilities"
                        stroke="var(--color-chart-3)"
                        strokeWidth={1}
                        strokeOpacity={0.28}
                        strokeDasharray="3 3"
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                      <Line
                        type="linear"
                        dataKey="netWorth"
                        name="netWorth"
                        stroke="var(--color-chart-1)"
                        strokeWidth={2}
                        dot={(props) => {
                          const last = displayableHistory.length - 1
                          if (
                            typeof props.cx !== 'number' ||
                            typeof props.cy !== 'number' ||
                            (props.index !== 0 && props.index !== last)
                          ) {
                            return <g />
                          }
                          return (
                            <circle
                              cx={props.cx}
                              cy={props.cy}
                              r={2.5}
                              fill="var(--color-chart-1)"
                            />
                          )
                        }}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </SafeChart>
                </div>
                <div
                  className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tabular-nums"
                  aria-label={t('netWorth.recordedChange')}
                >
                  <span className="text-foreground font-semibold">{t('netWorth.recorded')}</span>
                  <span className="min-w-0 overflow-x-auto whitespace-nowrap">
                    {dayjs(firstPoint.date).format('MMM D')} ·{' '}
                    {formatMoney(firstPoint.netWorth, historyDisplayCurrency)}
                  </span>
                  <span aria-hidden="true" className="bg-border h-px min-w-4 flex-1" />
                  <span className="min-w-0 overflow-x-auto whitespace-nowrap">
                    {dayjs(lastPoint.date).format('MMM D')} ·{' '}
                    {formatMoney(lastPoint.netWorth, historyDisplayCurrency)}
                  </span>
                  <span
                    className={cn(
                      'max-w-full overflow-x-auto font-medium whitespace-nowrap',
                      changeAmount > 0
                        ? 'text-success'
                        : changeAmount < 0
                          ? 'text-destructive'
                          : 'text-muted-foreground'
                    )}
                  >
                    {changeAmount > 0 ? (
                      <TrendingUp size={12} className="mr-1 inline" aria-hidden="true" />
                    ) : changeAmount < 0 ? (
                      <TrendingDown size={12} className="mr-1 inline" aria-hidden="true" />
                    ) : null}
                    {isPositiveChange ? '+' : ''}
                    {formatMoney(Math.round(changeAmount), historyDisplayCurrency)} ·{' '}
                    {changePercent}%
                  </span>
                </div>
                <ul className="text-muted-foreground mt-3 flex flex-wrap gap-4 text-[11px]">
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-0.5 w-4"
                      style={{ backgroundColor: 'var(--color-chart-1)' }}
                    />
                    {t('netWorth.title')}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-px w-4 opacity-60"
                      style={{ backgroundColor: 'var(--color-chart-3)' }}
                    />
                    {t('netWorth.recordedAssets')}
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden="true"
                      className="h-px w-4 border-t border-dashed opacity-50"
                      style={{ borderColor: 'var(--color-chart-3)' }}
                    />
                    {t('netWorth.recordedLiabilities')}
                  </li>
                </ul>
                <button
                  type="button"
                  className="text-accent focus-visible:ring-ring mt-1 min-h-11 rounded-md text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none"
                  aria-expanded={showHistoryTable}
                  aria-controls={historyTableId}
                  onClick={() => setShowHistoryTable((open) => !open)}
                >
                  {t('netWorth.viewChartData')}
                </button>
                <MoneyChartTable
                  id={historyTableId}
                  caption={t('netWorth.chartTableCaption')}
                  visible={showHistoryTable}
                  columns={[
                    t('netWorth.date'),
                    t('netWorth.title'),
                    t('netWorth.recordedAssets'),
                    t('netWorth.recordedLiabilities'),
                  ]}
                  rows={displayableHistory.map((point) => ({
                    key: point.date,
                    cells: [
                      dayjs(point.date).format('MMM D, YYYY'),
                      formatMoney(point.netWorth, historyDisplayCurrency),
                      formatMoney(point.assets, historyDisplayCurrency),
                      formatMoney(point.liabilities, historyDisplayCurrency),
                    ],
                  }))}
                />
              </>
            ) : historyDisplayable ? (
              <p className="text-muted-foreground mt-4 text-sm">
                {displayableHistory.length === 1
                  ? t('netWorth.firstSnapshot')
                  : t('netWorth.noHistory')}
              </p>
            ) : null}
          </NativePanel>

          {hasData ? (
            <NativePanel className="divide-border min-w-0 divide-y p-0">
              {totalsComplete &&
              totalAssets !== null &&
              totalLiabilities !== null &&
              totalAssetsAbs + totalLiabilitiesAbs > 0 ? (
                <div className="space-y-2 p-4 sm:px-5 sm:pt-5">
                  <div
                    className="bg-muted flex h-3 overflow-hidden rounded-full"
                    role="img"
                    aria-label={`${t('netWorth.assets')} ${assetTotal}. ${t('netWorth.liabilities')} ${liabilityTotal}`}
                  >
                    <span
                      className="h-full"
                      style={{
                        width: `${(totalAssetsAbs / (totalAssetsAbs + totalLiabilitiesAbs)) * 100}%`,
                        backgroundColor: 'var(--color-success)',
                      }}
                    />
                    <span
                      className="h-full"
                      style={{
                        width: `${(totalLiabilitiesAbs / (totalAssetsAbs + totalLiabilitiesAbs)) * 100}%`,
                        backgroundColor: 'var(--color-destructive)',
                      }}
                    />
                  </div>
                  <ul className="text-muted-foreground flex flex-wrap gap-3 text-[11px]">
                    <li className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: 'var(--color-success)' }}
                      />
                      {t('netWorth.assets')}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-sm"
                        style={{ backgroundColor: 'var(--color-destructive)' }}
                      />
                      {t('netWorth.liabilities')}
                    </li>
                  </ul>
                </div>
              ) : null}
              <section className="space-y-4 p-4 sm:p-5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Landmark size={16} className="text-success" aria-hidden="true" />
                    <h3 className="text-sm font-semibold">{t('netWorth.assets')}</h3>
                  </div>
                  <span className="text-success overflow-x-auto text-lg font-medium tabular-nums">
                    {assetTotal}
                  </span>
                </div>
                {totalsComplete &&
                (totalInvestments ?? 0) > 0 &&
                totalInvestments !== null &&
                preferredCurrency ? (
                  <div className="text-muted-foreground text-xs">
                    {t('netWorth.includesInvestments', {
                      amount: formatMoney(totalInvestments, preferredCurrency),
                    })}
                  </div>
                ) : null}
                <div className="space-y-3">
                  {assetBreakdown.map((asset) => {
                    const showAllocation =
                      totalsComplete && totalAssetsAbs > 0 && asset.convertedBalance !== null
                    const percent = showAllocation
                      ? (asset.convertedBalance! / totalAssetsAbs) * 100
                      : 0
                    return (
                      <div key={asset.id} className="space-y-1">
                        <StatRow
                          label={asset.name}
                          value={formatMoney(asset.balance, asset.currency)}
                          valueColor="text-success"
                        />
                        {showAllocation ? (
                          <ProgressBar
                            value={percent}
                            color="success"
                            size="sm"
                            ariaLabel={`${asset.name} allocation`}
                          />
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="space-y-4 p-4 sm:p-5">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CreditCard size={16} className="text-destructive" aria-hidden="true" />
                    <h3 className="text-sm font-semibold">{t('netWorth.liabilities')}</h3>
                  </div>
                  <span className="text-destructive overflow-x-auto text-lg font-medium tabular-nums">
                    {liabilityTotal}
                  </span>
                </div>
                <div className="space-y-3">
                  {liabilityBreakdown.length > 0 ? (
                    liabilityBreakdown.map((liability) => {
                      const showAllocation =
                        totalsComplete &&
                        totalLiabilitiesAbs > 0 &&
                        liability.convertedBalance !== null
                      const percent = showAllocation
                        ? (liability.convertedBalance! / totalLiabilitiesAbs) * 100
                        : 0
                      return (
                        <div key={liability.id} className="space-y-1">
                          <StatRow
                            label={liability.name}
                            value={formatMoney(Math.abs(liability.balance), liability.currency)}
                            valueColor="text-destructive"
                          />
                          {showAllocation ? (
                            <ProgressBar
                              value={percent}
                              color="destructive"
                              size="sm"
                              ariaLabel={`${liability.name} allocation`}
                            />
                          ) : null}
                        </div>
                      )
                    })
                  ) : (
                    <p className="text-muted-foreground text-sm">{t('netWorth.noLiabilities')}</p>
                  )}
                </div>
              </section>
            </NativePanel>
          ) : (
            <NativePanel className="flex h-32 items-center justify-center p-5">
              <p className="text-muted-foreground text-sm">{t('netWorth.addAccountsPrompt')}</p>
            </NativePanel>
          )}
        </>
      )}
    </div>
  )
}
