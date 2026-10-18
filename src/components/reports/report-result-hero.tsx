import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import type {
  ReportWindow,
  ScopedReportAmounts,
  ScopedReportGroupBy,
  ScopedReportResult,
  ScopedRecurringEstimateResult,
} from '@shikin/finance-core'
import { ScopeSummary } from '@/components/budgets/scoped-result'
import { MoneyChartTable } from '@/components/insights/money-chart-table'
import { SafeChart } from '@/components/ui/safe-chart'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatMoney } from '@/lib/money'
import type { ScopedReferences } from '@/lib/scoped-report-read'

type ActualField = keyof ScopedReportAmounts

const grossFields = ['expenseCentavos', 'incomeCentavos'] as const satisfies readonly ActualField[]
const netFields = [
  'consumptionCentavos',
  'earnedIncomeCentavos',
  'otherIncomeCentavos',
  'principalRecoveryCentavos',
  'assetAcquisitionCentavos',
] as const satisfies readonly ActualField[]

const fieldLabelKey = {
  expenseCentavos: 'expense',
  incomeCentavos: 'income',
  consumptionCentavos: 'consumption',
  earnedIncomeCentavos: 'earnedIncome',
  otherIncomeCentavos: 'otherIncome',
  principalRecoveryCentavos: 'principalRecovery',
  assetAcquisitionCentavos: 'assetAcquisition',
} as const

interface ChartRow {
  key: string
  label: string
  amount: number
}

function moneyOrDash(amount: number | null, currency: string) {
  return amount === null || !Number.isSafeInteger(amount) ? '—' : formatMoney(amount, currency)
}

function groupName(
  groupBy: ScopedReportGroupBy,
  key: string | null,
  accounts: ScopedReferences['accounts'],
  categories: ScopedReferences['categories'],
  labels: { uncategorized: string; allGroups: string }
) {
  if (groupBy === 'category') {
    if (key === null) return labels.uncategorized
    return categories.find((category) => category.id === key)?.name ?? key
  }
  if (groupBy === 'account') {
    if (key === null) return '—'
    return accounts.find((account) => account.id === key)?.name ?? key
  }
  if (groupBy === 'month') return key ?? '—'
  return key ?? labels.allGroups
}

function MeasureBars({
  rows,
  currency,
  horizontal,
  label,
  amountLabel,
  groupLabel,
  fill,
}: {
  rows: ChartRow[]
  currency: string
  horizontal: boolean
  label: string
  amountLabel: string
  groupLabel: string
  fill: string
}) {
  const describedBy = useId()
  const height = horizontal ? Math.min(420, Math.max(168, rows.length * 36 + 24)) : 224
  return (
    <div className="mt-4 min-w-0">
      <div
        className="min-w-0 overflow-hidden"
        role="img"
        aria-label={label}
        aria-describedby={describedBy}
        style={{ height }}
      >
        <SafeChart>
          <BarChart
            data={rows}
            layout={horizontal ? 'vertical' : 'horizontal'}
            margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              vertical={horizontal}
              horizontal={!horizontal}
              strokeDasharray="2 4"
              stroke={CHART_GRID_COLOR}
            />
            {horizontal ? (
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                tickFormatter={(value) => formatCompactChartMoney(Number(value), currency)}
              />
            ) : (
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                interval="preserveStartEnd"
              />
            )}
            {horizontal ? (
              <YAxis
                type="category"
                dataKey="label"
                axisLine={false}
                tickLine={false}
                width={84}
                interval={0}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                tickFormatter={(value: string) =>
                  value.length > 14 ? `${value.slice(0, 13)}…` : value
                }
              />
            ) : (
              <YAxis
                axisLine={false}
                tickLine={false}
                width={52}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                tickFormatter={(value) => formatCompactChartMoney(Number(value), currency)}
              />
            )}
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              itemStyle={CHART_ITEM_STYLE}
              labelStyle={CHART_LABEL_STYLE}
              cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.35 }}
              formatter={(value) => [formatMoney(Number(value), currency), amountLabel]}
            />
            <Bar
              dataKey="amount"
              fill={fill}
              maxBarSize={14}
              radius={horizontal ? [0, 2, 2, 0] : [2, 2, 0, 0]}
              isAnimationActive={false}
            />
          </BarChart>
        </SafeChart>
      </div>
      <MoneyChartTable
        id={describedBy}
        caption={label}
        columns={[groupLabel, amountLabel]}
        rows={rows.map((row) => ({
          key: row.key,
          cells: [row.label, formatMoney(row.amount, currency)],
        }))}
      />
    </div>
  )
}

function AmountList({
  fields,
  values,
  currency,
  labelFor,
}: {
  fields: readonly ActualField[]
  values: ScopedReportAmounts
  currency: string
  labelFor: (field: ActualField) => string
}) {
  return (
    <dl className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field} className="flex min-w-0 items-baseline justify-between gap-3">
          <dt className="text-muted-foreground text-xs">{labelFor(field)}</dt>
          <dd className="max-w-full overflow-x-auto text-sm font-medium whitespace-nowrap tabular-nums">
            {moneyOrDash(values[field], currency)}
          </dd>
        </div>
      ))}
    </dl>
  )
}

function ActualHero({
  result,
  accounts,
  categories,
}: ScopedReferences & { result: ScopedReportResult }) {
  const { t } = useTranslation('analytics')
  const measure = result.budgetUsage.measure
  const labels = {
    uncategorized: t('reportHero.uncategorized'),
    allGroups: t('reportHero.allGroups'),
  }
  const labelFor = (field: ActualField) => t(`reportHero.${fieldLabelKey[field]}`)
  const fields = result.basis === 'gross_cashflow' ? grossFields : netFields
  let chartRows: ChartRow[] | null = null
  if (result.complete && result.groupBy !== 'none' && result.groups.length > 0) {
    const rows: ChartRow[] = []
    let chartable = true
    for (const group of result.groups) {
      const amount = group.totals[measure]
      if (amount === null || !Number.isSafeInteger(amount)) {
        chartable = false
        break
      }
      rows.push({
        key: group.key ?? '__none',
        label: groupName(result.groupBy, group.key, accounts, categories, labels),
        amount,
      })
    }
    chartRows = chartable ? rows : null
  }
  const coverage = !result.coverage.required
    ? t('reportHero.coverageNotRequired')
    : t(result.coverage.complete ? 'reportHero.complete' : 'reportHero.incomplete')
  const classification =
    result.classificationComplete === null
      ? t('reportHero.classificationNotRequired')
      : t(result.classificationComplete ? 'reportHero.complete' : 'reportHero.incomplete')

  return (
    <div className="border-border mb-5 min-w-0 border-b pb-5">
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
            {t('reportHero.activeMeasure')}
          </p>
          <h2 className="mt-1 text-sm font-semibold">{labelFor(measure)}</h2>
          <p className="mt-1 text-3xl font-medium tracking-tight tabular-nums">
            {moneyOrDash(result.totals[measure], result.currency)}
          </p>
        </div>
        <dl className="grid min-w-0 gap-1 text-xs sm:text-right">
          <div>
            <dt className="text-muted-foreground">{t('reportHero.window')}</dt>
            <dd className="tabular-nums">
              {result.window.start} – {result.window.end}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('reportHero.timeZone')}</dt>
            <dd>
              {result.window.timeZone} · {result.currency}
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-4 min-w-0">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          {t('reportHero.scope')}
        </p>
        <ScopeSummary result={result} accounts={accounts} categories={categories} />
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {t('reportHero.coverage')}: {coverage}
        {' · '}
        {t('reportHero.classification')}: {classification}
      </p>
      {result.basis === 'net_consumption' ? (
        <AmountList
          fields={netFields}
          values={result.totals}
          currency={result.currency}
          labelFor={labelFor}
        />
      ) : null}
      {result.groupBy === 'none' ? (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">{t('reportHero.basisMetrics')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">{t('reportHero.basisMetricsHelp')}</p>
          <AmountList
            fields={fields}
            values={result.totals}
            currency={result.currency}
            labelFor={labelFor}
          />
        </div>
      ) : chartRows ? (
        <MeasureBars
          rows={chartRows}
          currency={result.currency}
          horizontal={result.groupBy !== 'month'}
          label={t('reportHero.chartLabel')}
          amountLabel={labelFor(measure)}
          groupLabel={t('reportHero.group')}
          fill="var(--color-chart-3)"
        />
      ) : (
        <p className="text-muted-foreground mt-4 text-sm">
          {result.complete ? t('reportHero.noGroups') : t('reportHero.noChart')}
        </p>
      )}
    </div>
  )
}

function EstimateSourcePanel({
  title,
  chartLabel,
  source,
  groupBy,
  currency,
  accounts,
  categories,
}: {
  title: string
  chartLabel: string
  source: ScopedRecurringEstimateResult['recurringRules']
  groupBy: ScopedReportGroupBy
  currency: string
  accounts: ScopedReferences['accounts']
  categories: ScopedReferences['categories']
}) {
  const { t } = useTranslation('analytics')
  const labels = {
    uncategorized: t('reportHero.uncategorized'),
    allGroups: t('reportHero.allGroups'),
  }
  let chartRows: ChartRow[] | null = null
  if (source.complete && groupBy !== 'none' && groupBy !== 'month' && source.groups.length > 0) {
    const rows: ChartRow[] = []
    let chartable = true
    for (const group of source.groups) {
      if (group.monthlyCentavos === null || !Number.isSafeInteger(group.monthlyCentavos)) {
        chartable = false
        break
      }
      rows.push({
        key: group.key ?? '__none',
        label: groupName(groupBy, group.key, accounts, categories, labels),
        amount: group.monthlyCentavos,
      })
    }
    chartRows = chartable ? rows : null
  }
  const describedBy = useId()

  return (
    <article className="bg-surface min-w-0 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p
        className={
          source.complete ? 'text-muted-foreground mt-1 text-xs' : 'text-warning mt-1 text-xs'
        }
        role="status"
      >
        {source.complete ? t('reportHero.complete') : t('reportHero.incomplete')}
      </p>
      <dl className="mt-3 grid gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground text-xs">{t('reportHero.monthly')}</dt>
          <dd className="overflow-x-auto font-medium whitespace-nowrap tabular-nums">
            {moneyOrDash(source.monthlyCentavos, currency)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground text-xs">{t('reportHero.yearly')}</dt>
          <dd className="overflow-x-auto font-medium whitespace-nowrap tabular-nums">
            {moneyOrDash(source.yearlyCentavos, currency)}
          </dd>
        </div>
      </dl>
      {chartRows ? (
        <div className="mt-3 min-w-0">
          <div
            className="min-w-0 overflow-hidden"
            role="img"
            aria-label={chartLabel}
            aria-describedby={describedBy}
            style={{ height: Math.min(320, Math.max(148, chartRows.length * 36 + 24)) }}
          >
            <SafeChart>
              <BarChart
                data={chartRows}
                layout="vertical"
                margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
              >
                <CartesianGrid vertical strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
                <XAxis
                  type="number"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                  tickFormatter={(value) => formatCompactChartMoney(Number(value), currency)}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  width={84}
                  interval={0}
                  tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_ITEM_STYLE}
                  labelStyle={CHART_LABEL_STYLE}
                  formatter={(value) => [
                    formatMoney(Number(value), currency),
                    t('reportHero.monthly'),
                  ]}
                />
                <Bar
                  dataKey="amount"
                  fill="var(--color-chart-1)"
                  maxBarSize={12}
                  radius={[0, 2, 2, 0]}
                  isAnimationActive={false}
                />
              </BarChart>
            </SafeChart>
          </div>
          <MoneyChartTable
            id={describedBy}
            caption={chartLabel}
            columns={[t('reportHero.group'), t('reportHero.monthly'), t('reportHero.yearly')]}
            rows={source.groups.map((group) => ({
              key: group.key ?? '__none',
              cells: [
                groupName(groupBy, group.key, accounts, categories, labels),
                moneyOrDash(group.monthlyCentavos, currency),
                moneyOrDash(group.yearlyCentavos, currency),
              ],
            }))}
          />
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-xs">
          {source.complete && (groupBy === 'none' || groupBy === 'month')
            ? t('reportHero.notOccurrenceHistory')
            : t('reportHero.notCharted')}
        </p>
      )}
    </article>
  )
}

function EstimateHero({
  result,
  window,
  accounts,
  categories,
}: ScopedReferences & { result: ScopedRecurringEstimateResult; window: ReportWindow }) {
  const { t } = useTranslation('analytics')
  return (
    <div className="border-border mb-5 min-w-0 border-b pb-5">
      <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
        {t('reportHero.asOf')}
      </p>
      <h2 className="mt-1 text-sm font-semibold">{t('reportHero.separateSources')}</h2>
      <p className="text-muted-foreground mt-1 text-xs">{t('reportHero.separateSourcesHelp')}</p>
      <dl className="mt-3 grid gap-1 text-xs">
        <div>
          <dt className="text-muted-foreground">{t('reportHero.window')}</dt>
          <dd className="tabular-nums">
            {window.start} – {window.end}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('reportHero.timeZone')}</dt>
          <dd>{window.timeZone}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('reportHero.asOf')}</dt>
          <dd className="tabular-nums">
            {result.asOf} · {result.currency}
          </dd>
        </div>
      </dl>
      <div className="mt-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          {t('reportHero.scope')}
        </p>
        <ScopeSummary result={result} accounts={accounts} categories={categories} />
      </div>
      <div className="border-border bg-border mt-4 grid min-w-0 gap-px overflow-hidden rounded-lg border lg:grid-cols-2">
        <EstimateSourcePanel
          title={t('reportHero.rulesSource')}
          chartLabel={t('reportHero.rulesChartLabel')}
          source={result.recurringRules}
          groupBy={result.groupBy}
          currency={result.currency}
          accounts={accounts}
          categories={categories}
        />
        <EstimateSourcePanel
          title={t('reportHero.subscriptionsSource')}
          chartLabel={t('reportHero.subscriptionsChartLabel')}
          source={result.subscriptions}
          groupBy={result.groupBy}
          currency={result.currency}
          accounts={accounts}
          categories={categories}
        />
      </div>
    </div>
  )
}

export function ReportResultHero({
  result,
  window,
  accounts,
  categories,
}: ScopedReferences & {
  result: ScopedReportResult | ScopedRecurringEstimateResult
  window: ReportWindow
}) {
  if (result.basis === 'recurring_estimate') {
    return (
      <EstimateHero result={result} window={window} accounts={accounts} categories={categories} />
    )
  }
  return <ActualHero result={result} accounts={accounts} categories={categories} />
}
