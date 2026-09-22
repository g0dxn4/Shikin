import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import type { CategoriesResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'
import { formatCompactChartMoney } from './chart-money'

interface SpendingCategoriesPanelProps {
  categories: CategoriesResult
  displayCurrency: string
  notice: string | null
}

export function SpendingCategoriesPanel({
  categories,
  displayCurrency,
  notice,
}: SpendingCategoriesPanelProps) {
  const { t, i18n } = useTranslation('dashboard')
  const locale = i18n?.resolvedLanguage ?? i18n?.language

  const orderedCategoryIds = [
    ...categories.topCategoryIds,
    ...(categories.topCategoryIds.length < Object.keys(categories.categoryMeta).length
      ? [categories.otherCategoryId]
      : []),
  ]
  const categoryLabel = (categoryId: string) => {
    if (categoryId === categories.otherCategoryId) return t('analytics.other')
    if (categoryId === 'uncategorized') return t('analytics.uncategorized')
    return categories.categoryMeta[categoryId]?.name ?? categoryId
  }

  const chartData = categories.months.map((month) => {
    const row: Record<string, number | string> = { key: month.key, label: month.label }
    for (const categoryId of orderedCategoryIds) {
      const fromMap = month.byCategoryId[categoryId]
      if (fromMap !== undefined) {
        row[categoryId] = fromMap
      } else if (categoryId === categories.otherCategoryId) {
        let otherSum = 0
        for (const [id, amount] of Object.entries(month.byCategoryId)) {
          if (!categories.topCategoryIds.includes(id)) otherSum += amount
        }
        row[categoryId] = otherSum
      }
    }
    return row
  })

  const hasChartData = chartData.some((row) =>
    orderedCategoryIds.some((id) => (row[id] as number) > 0)
  )
  const visibleBreakdown = categories.currentMonthBreakdown.slice(0, 5)
  const remainingBreakdown = categories.currentMonthBreakdown.slice(5)
  if (remainingBreakdown.length > 0) {
    visibleBreakdown.push({
      categoryId: categories.otherCategoryId,
      name: t('analytics.other'),
      color:
        categories.categoryMeta[categories.otherCategoryId]?.color ??
        'var(--color-muted-foreground)',
      amount: remainingBreakdown.reduce((sum, item) => sum + item.amount, 0),
      percent:
        Math.round(remainingBreakdown.reduce((sum, item) => sum + item.percent, 0) * 10) / 10,
    })
  }

  return (
    <div className="space-y-3">
      {notice ? <Notice>{notice}</Notice> : null}

      {categories.splitIntegrityNotices.length > 0 ? (
        <Notice>
          {t('analytics.splitIntegrityNotice', {
            count: categories.splitIntegrityNotices.length,
          })}
        </Notice>
      ) : null}

      <div className="border-border border-b py-2.5">
        <p className="text-muted-foreground mb-2 text-[10px] font-semibold tracking-wider uppercase">
          {t('analytics.topCategories')}
        </p>
        {visibleBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('analytics.noEligibleData')}</p>
        ) : (
          <dl className="grid min-w-0 grid-cols-1 gap-x-5 gap-y-2 min-[480px]:grid-cols-2">
            {visibleBreakdown.map((item) => (
              <div
                key={item.categoryId}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2"
              >
                <dt className="flex min-w-0 items-start gap-2 text-xs leading-tight font-semibold">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color ?? 'var(--color-muted-foreground)' }}
                  />
                  <span className="[overflow-wrap:anywhere]">
                    {item.categoryId === categories.otherCategoryId
                      ? t('analytics.other')
                      : item.name}
                  </span>
                </dt>
                <dd className="min-w-0 text-right">
                  <span className="block text-xs leading-tight font-semibold [overflow-wrap:anywhere] tabular-nums">
                    {formatMoney(item.amount, displayCurrency, locale)}
                  </span>
                  <span className="text-muted-foreground mt-0.5 block text-[10px] tabular-nums">
                    {item.percent}%
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-label={t('analytics.legend')}>
        {orderedCategoryIds.map((categoryId) => (
          <li
            key={categoryId}
            className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{
                backgroundColor:
                  categories.categoryMeta[categoryId]?.color ?? 'var(--color-muted-foreground)',
              }}
            />
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              {categoryLabel(categoryId)}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="h-56 min-w-0 sm:h-60"
        role="img"
        aria-label={t('analytics.categoriesChartLabel')}
        aria-describedby="spending-categories-data"
      >
        <SafeChart>
          <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -4 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={8}
              minTickGap={14}
              height={28}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
              tickMargin={4}
              tickFormatter={(value) =>
                formatCompactChartMoney(Number(value), displayCurrency, locale)
              }
              width={58}
            />
            <Tooltip
              contentStyle={{
                ...CHART_TOOLTIP_STYLE,
                maxWidth: 'min(260px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
              itemStyle={{
                ...CHART_ITEM_STYLE,
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                flexWrap: 'wrap',
                whiteSpace: 'normal',
              }}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => [
                formatMoney(Number(value), displayCurrency, locale),
                categoryLabel(String(name ?? '')),
              ]}
            />
            {orderedCategoryIds.map((categoryId) => (
              <Bar
                key={categoryId}
                dataKey={categoryId}
                name={categoryId}
                stackId="total"
                fill={categories.categoryMeta[categoryId]?.color ?? 'var(--color-muted-foreground)'}
                radius={[0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </SafeChart>
      </div>

      <div className="sr-only">
        <table id="spending-categories-data">
          <caption>{t('analytics.categoriesChartLabel')}</caption>
          <thead>
            <tr>
              <th>{t('analytics.month')}</th>
              {orderedCategoryIds.map((categoryId) => (
                <th key={categoryId}>{categoryLabel(categoryId)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chartData.map((month) => (
              <tr key={String(month.key)}>
                <th>{month.label}</th>
                {orderedCategoryIds.map((categoryId) => (
                  <td key={categoryId}>
                    {formatMoney(Number(month[categoryId] ?? 0), displayCurrency, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!hasChartData ? (
        <p className="text-muted-foreground text-center text-sm">{t('analytics.noEligibleData')}</p>
      ) : null}
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-3 py-2 text-xs font-semibold"
      role="status"
    >
      {children}
    </div>
  )
}
