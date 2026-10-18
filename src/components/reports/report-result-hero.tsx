import { useId, type ReactNode } from 'react'
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
import { cn } from '@/lib/utils'

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

function scopeChip(scope: unknown, allGroups: string, invalidScope: string, counted: string) {
  if (!scope || typeof scope !== 'object') return { label: invalidScope, invalid: true }
  const count = Object.values(scope).reduce<number>(
    (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
    0
  )
  if (count === 0) return { label: allGroups, invalid: false }
  return { label: counted, invalid: false }
}

function Chip({
  children,
  warning = false,
  status = false,
}: {
  children: ReactNode
  warning?: boolean
  status?: boolean
}) {
  return (
    <span
      role={status ? 'status' : undefined}
      className={cn(
        'inline-flex max-w-full items-center overflow-x-auto rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        warning
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border text-muted-foreground'
      )}
    >
      {children}
    </span>
  )
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
    <div className="mt-3 min-w-0">
      <ul className="mb-2 flex flex-wrap gap-3 text-[11px]" aria-label={label}>
        <li className="text-muted-foreground flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: fill }}
          />
          {amountLabel}
        </li>
      </ul>
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
    <dl className="grid min-w-0 gap-2 sm:grid-cols-2">
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
  const { t: tBudgets } = useTranslation('budgets')
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
  const selectedScope = scopeChip(
    result.scope,
    t('reportHero.allGroups'),
    t('reportHero.invalidScope'),
    t('reportHero.scopeCount', {
      count:
        result.scope && typeof result.scope === 'object'
          ? Object.values(result.scope).reduce<number>(
              (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
              0
            )
          : 0,
    })
  )

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip>
          <span className="tabular-nums">
            {result.window.start} – {result.window.end}
          </span>
        </Chip>
        <Chip>
          {result.window.timeZone} · {result.currency}
        </Chip>
        <Chip warning={selectedScope.invalid}>{selectedScope.label}</Chip>
        <Chip warning={!result.complete} status={!result.complete}>
          {result.complete ? t('reportHero.complete') : t('reportHero.incomplete')}
        </Chip>
      </div>
      <div className="mt-4 flex min-w-0 items-end justify-between gap-3">
        <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
          {labelFor(measure)}
        </p>
        <p className="max-w-full overflow-x-auto text-3xl font-medium tracking-tight whitespace-nowrap tabular-nums">
          {moneyOrDash(result.totals[measure], result.currency)}
        </p>
      </div>
      {chartRows ? (
        <MeasureBars
          rows={chartRows}
          currency={result.currency}
          horizontal={result.groupBy !== 'month'}
          label={t('reportHero.chartLabel')}
          amountLabel={labelFor(measure)}
          groupLabel={t('reportHero.group')}
          fill="var(--color-chart-3)"
        />
      ) : result.groupBy === 'none' ? null : (
        <p
          className={cn('mt-4 text-sm', result.complete ? 'text-muted-foreground' : 'text-warning')}
          role="status"
        >
          {result.complete ? t('reportHero.noGroups') : t('reportHero.noChart')}
        </p>
      )}
      {!result.scope ? (
        <p className="text-warning mt-3 text-xs" role="alert">
          {tBudgets('scoped.invalidScope')}
        </p>
      ) : null}
      <details className="mt-2">
        <summary className="text-accent focus-visible:ring-ring flex min-h-11 cursor-pointer items-center text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none">
          {t('reportHero.details')}
        </summary>
        <div className="space-y-3 pb-1">
          <p className="text-muted-foreground text-xs">
            {t('reportHero.coverage')}: {coverage}
            {' · '}
            {t('reportHero.classification')}: {classification}
          </p>
          <ScopeSummary result={result} accounts={accounts} categories={categories} />
          {result.groupBy === 'none' ? (
            <p className="text-muted-foreground text-xs">{t('reportHero.basisMetricsHelp')}</p>
          ) : null}
          <AmountList
            fields={result.basis === 'net_consumption' ? netFields : fields}
            values={result.totals}
            currency={result.currency}
            labelFor={labelFor}
          />
        </div>
      </details>
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
  fill,
}: {
  title: string
  chartLabel: string
  source: ScopedRecurringEstimateResult['recurringRules']
  groupBy: ScopedReportGroupBy
  currency: string
  accounts: ScopedReferences['accounts']
  categories: ScopedReferences['categories']
  fill: string
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
    <article className="border-border min-w-0 border-t pt-4 first:border-t-0 first:pt-0 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-4 lg:first:border-l-0 lg:first:pl-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 text-sm font-semibold">{title}</h3>
        <Chip warning={!source.complete} status>
          {source.complete ? t('reportHero.complete') : t('reportHero.incomplete')}
        </Chip>
      </div>
      <p className="mt-3 max-w-full overflow-x-auto text-2xl font-medium tracking-tight whitespace-nowrap tabular-nums">
        {moneyOrDash(source.monthlyCentavos, currency)}
      </p>
      <p className="text-muted-foreground text-[11px]">{t('reportHero.monthly')}</p>
      <p className="text-muted-foreground mt-2 flex min-w-0 items-baseline justify-between gap-3 text-xs">
        <span>{t('reportHero.yearly')}</span>
        <span className="text-foreground overflow-x-auto font-medium whitespace-nowrap tabular-nums">
          {moneyOrDash(source.yearlyCentavos, currency)}
        </span>
      </p>
      {chartRows ? (
        <div className="mt-3 min-w-0">
          <ul className="mb-2 flex items-center gap-1.5 text-[11px]">
            <li className="text-muted-foreground flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: fill }}
              />
              {t('reportHero.monthly')}
            </li>
          </ul>
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
                  fill={fill}
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
      ) : source.complete ? (
        <p className="text-muted-foreground mt-3 text-xs" role="status">
          {t('reportHero.notCharted')}
        </p>
      ) : null}
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
  const selectedScope = scopeChip(
    result.scope,
    t('reportHero.allGroups'),
    t('reportHero.invalidScope'),
    t('reportHero.scopeCount', {
      count:
        result.scope && typeof result.scope === 'object'
          ? Object.values(result.scope).reduce<number>(
              (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
              0
            )
          : 0,
    })
  )
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Chip>
          <span className="tabular-nums">
            {window.start} – {window.end}
          </span>
        </Chip>
        <Chip>{window.timeZone}</Chip>
        <Chip>
          <span className="tabular-nums">
            {result.asOf} · {result.currency}
          </span>
        </Chip>
        <Chip warning={selectedScope.invalid}>{selectedScope.label}</Chip>
        <Chip warning>{t('reportHero.separateSources')}</Chip>
      </div>
      <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-2">
        <EstimateSourcePanel
          title={t('reportHero.rulesSource')}
          chartLabel={t('reportHero.rulesChartLabel')}
          source={result.recurringRules}
          groupBy={result.groupBy}
          currency={result.currency}
          accounts={accounts}
          categories={categories}
          fill="var(--color-chart-1)"
        />
        <EstimateSourcePanel
          title={t('reportHero.subscriptionsSource')}
          chartLabel={t('reportHero.subscriptionsChartLabel')}
          source={result.subscriptions}
          groupBy={result.groupBy}
          currency={result.currency}
          accounts={accounts}
          categories={categories}
          fill="var(--color-chart-3)"
        />
      </div>
      <details className="mt-2">
        <summary className="text-accent focus-visible:ring-ring flex min-h-11 cursor-pointer items-center text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none">
          {t('reportHero.details')}
        </summary>
        <div className="text-muted-foreground space-y-2 pb-1 text-xs">
          <p>{t('reportHero.separateSourcesHelp')}</p>
          <p>{t('reportHero.notOccurrenceHistory')}</p>
          <ScopeSummary result={result} accounts={accounts} categories={categories} />
        </div>
      </details>
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
