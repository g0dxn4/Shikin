import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, TrendingDown, Landmark, CreditCard } from 'lucide-react'
import { FX_CURRENCIES } from '@shikin/finance-core/fx'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { MoneyChartTable } from '@/components/insights/money-chart-table'
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import {
  RecordedNetWorthChart,
  RecordedSeriesLegend,
} from '@/components/net-worth/recorded-history-chart'
import {
  isSafeRecordedPoint,
  RECORDED_CHART_STYLES,
  type RecordedChartStyle,
} from '@/components/net-worth/recorded-series'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import dayjs from 'dayjs'

const PERIODS = [
  { value: 'month' },
  { value: '3m' },
  { value: '6m' },
  { value: 'ytd' },
  { value: '1y' },
  { value: 'all' },
] as const

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

function ChartStyleTabs({
  style,
  onChange,
  panelId,
  tabId,
}: {
  style: RecordedChartStyle
  onChange: (style: RecordedChartStyle) => void
  panelId: string
  tabId: (style: RecordedChartStyle) => string
}) {
  const { t } = useTranslation('analytics')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (index + 1) % RECORDED_CHART_STYLES.length
    if (event.key === 'ArrowLeft')
      next = (index - 1 + RECORDED_CHART_STYLES.length) % RECORDED_CHART_STYLES.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = RECORDED_CHART_STYLES.length - 1
    if (next === null) return
    event.preventDefault()
    onChange(RECORDED_CHART_STYLES[next])
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      className="border-border bg-muted flex max-w-full flex-wrap rounded-lg border p-0.5"
      role="tablist"
      aria-label={t('netWorth.chartStyle')}
      aria-orientation="horizontal"
    >
      {RECORDED_CHART_STYLES.map((item, index) => (
        <button
          key={item}
          ref={(element) => {
            tabRefs.current[index] = element
          }}
          id={tabId(item)}
          type="button"
          role="tab"
          aria-selected={style === item}
          aria-controls={panelId}
          tabIndex={style === item ? 0 : -1}
          onClick={() => onChange(item)}
          onKeyDown={(event) => move(event, index)}
          className={cn(
            'focus-visible:ring-ring min-h-11 min-w-11 rounded-md px-2.5 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
            style === item
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t(`netWorth.styles.${item}`)}
        </button>
      ))}
    </div>
  )
}

export function NetWorth() {
  const { t } = useTranslation('analytics')
  const historyTableId = useId()
  const liveContextId = useId()
  const chartPanelId = useId()
  const styleTabBase = useId()
  const periodHintBase = useId()
  const [period, setPeriod] = useState('1y')
  const [chartStyle, setChartStyle] = useState<RecordedChartStyle>('line')
  const [compareRecorded, setCompareRecorded] = useState(false)
  const [showHistoryTable, setShowHistoryTable] = useState(false)
  const styleTabId = (style: RecordedChartStyle) => `${styleTabBase}-${style}`
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
    !historyLoading &&
    mainCurrency !== null &&
    historyAuthorityKey === currentAuthorityKey &&
    historyCurrency === mainCurrency &&
    historyRequestedPeriod === period
  const displayableHistory = historyDisplayable ? history : []
  const historyDisplayCurrency = historyDisplayable ? historyCurrency : null
  const safeHistory =
    historyDisplayable &&
    historyDisplayCurrency !== null &&
    displayableHistory.every(isSafeRecordedPoint)
  const recordedSeriesReady = safeHistory && displayableHistory.length > 1
  const singleRecordedPoint =
    safeHistory && displayableHistory.length === 1 ? displayableHistory[0] : null
  const firstPoint = recordedSeriesReady ? displayableHistory[0] : null
  const lastPoint = recordedSeriesReady ? displayableHistory[displayableHistory.length - 1] : null
  const changeAmount = lastPoint && firstPoint ? lastPoint.netWorth - firstPoint.netWorth : 0
  const changePercent =
    firstPoint && firstPoint.netWorth !== 0
      ? ((changeAmount / Math.abs(firstPoint.netWorth)) * 100).toFixed(1)
      : '0'
  const isPositiveChange = changeAmount >= 0
  const totalAssetsAbs = Math.abs(totalAssets ?? 0)
  const totalLiabilitiesAbs = Math.abs(totalLiabilities ?? 0)
  const hasData = assetBreakdown.length > 0 || liabilityBreakdown.length > 0
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

  const chartPanel = recordedSeriesReady && historyDisplayCurrency && firstPoint && lastPoint && (
    <>
      <RecordedNetWorthChart
        points={displayableHistory}
        currency={historyDisplayCurrency}
        chartStyle={chartStyle}
        compare={compareRecorded}
        title={t('netWorth.chartTitle')}
        describedBy={historyTableId}
      />
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
          {formatMoney(Math.round(changeAmount), historyDisplayCurrency)} · {changePercent}%
        </span>
      </div>
      <RecordedSeriesLegend chartStyle={chartStyle} compare={compareRecorded} />
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
  )

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
                aria-describedby={`${periodHintBase}-${item.value}`}
                onClick={() => setPeriod(item.value)}
                title={t(`netWorth.periodTitle.${item.value}`)}
                className={cn(
                  'focus-visible:ring-ring min-h-11 min-w-11 shrink-0 rounded-md px-2.5 text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
                  period === item.value
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t(`netWorth.periods.${item.value}`)}
              </button>
            ))}
            {PERIODS.map((item) => (
              <span key={item.value} id={`${periodHintBase}-${item.value}`} className="sr-only">
                {t(`netWorth.periodTitle.${item.value}`)}
              </span>
            ))}
          </div>
        }
      />

      <div className="flex max-w-full min-w-0 flex-wrap items-center gap-2">
        <ChartStyleTabs
          style={chartStyle}
          onChange={setChartStyle}
          panelId={chartPanelId}
          tabId={styleTabId}
        />
        <button
          type="button"
          aria-pressed={compareRecorded}
          onClick={() => setCompareRecorded((open) => !open)}
          className={cn(
            'border-border focus-visible:ring-ring inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border px-2.5 text-left text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none',
            compareRecorded
              ? 'bg-surface text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <span aria-hidden="true" className="inline-flex items-center gap-1">
            <span
              className="h-2 w-2 rounded-sm"
              style={{
                backgroundColor: 'var(--color-chart-2)',
                opacity: compareRecorded ? 1 : 0.45,
              }}
            />
            <span
              className="h-2 w-2 rounded-sm"
              style={{
                backgroundColor: 'var(--color-chart-5)',
                opacity: compareRecorded ? 1 : 0.45,
              }}
            />
          </span>
          {t('netWorth.compareRecorded')}
        </button>
      </div>

      {isLoading ? (
        <div id={chartPanelId} role="tabpanel" aria-labelledby={styleTabId(chartStyle)}>
          <div role="status" aria-busy="true">
            <span className="sr-only">Loading</span>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-3 h-64 w-full" />
          </div>
        </div>
      ) : (
        <>
          <NativePanel
            id={chartPanelId}
            role="tabpanel"
            aria-labelledby={styleTabId(chartStyle)}
            className="min-w-0 p-4 sm:p-6"
          >
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
              {singleRecordedPoint && historyDisplayCurrency ? (
                <p className="text-muted-foreground min-w-0 text-xs tabular-nums">
                  <span className="text-foreground font-semibold">{t('netWorth.recorded')}</span>
                  {' · '}
                  {dayjs(singleRecordedPoint.date).format('MMM D, YYYY')}
                  {' · '}
                  <span className="inline-block max-w-full overflow-x-auto align-bottom whitespace-nowrap">
                    {formatMoney(singleRecordedPoint.netWorth, historyDisplayCurrency)}
                  </span>
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

            {chartPanel}
            {historyDisplayable && !recordedSeriesReady ? (
              <p className="text-muted-foreground mt-4 text-sm">
                {!safeHistory
                  ? t('netWorth.unavailable')
                  : displayableHistory.length === 1
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
                  <span className="text-success max-w-full overflow-x-auto text-lg font-medium whitespace-nowrap tabular-nums">
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
                  <span className="text-destructive max-w-full overflow-x-auto text-lg font-medium whitespace-nowrap tabular-nums">
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
