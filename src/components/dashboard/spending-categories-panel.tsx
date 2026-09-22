import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { formatMoney } from '@/lib/money'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_LEGEND_STYLE,
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

  const chartData = categories.months.map((month) => {
    const row: Record<string, number | string> = { key: month.key, label: month.label }
    for (const categoryId of orderedCategoryIds) {
      const fromMap = month.byCategoryId[categoryId]
      if (fromMap !== undefined) {
        row[categoryId] = fromMap
      } else {
        // Aggregate other categories into the Other bucket.
        if (categoryId === categories.otherCategoryId) {
          let otherSum = 0
          for (const [id, amount] of Object.entries(month.byCategoryId)) {
            if (!categories.topCategoryIds.includes(id)) {
              otherSum += amount
            }
          }
          row[categoryId] = otherSum
        }
      }
    }
    return row
  })

  const hasChartData = chartData.some((row) =>
    orderedCategoryIds.some((id) => (row[id] as number) > 0)
  )

  return (
    <div className="space-y-4">
      {notice && (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {notice}
        </div>
      )}

      {categories.splitIntegrityNotices.length > 0 && (
        <div
          className="border-warning/30 bg-warning/10 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {t('analytics.splitIntegrityNotice', {
            count: categories.splitIntegrityNotices.length,
          })}
        </div>
      )}

      <div
        className="h-68 min-w-0 sm:h-72"
        role="img"
        aria-label={t('analytics.categoriesChartLabel')}
        aria-describedby="spending-categories-data"
      >
        <SafeChart>
          <BarChart data={chartData} margin={{ top: 8, right: 6, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              tickMargin={8}
              minTickGap={14}
              height={28}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              tickMargin={6}
              tickFormatter={(v) => formatCompactChartMoney(Number(v), displayCurrency, locale)}
              width={62}
            />
            <Tooltip
              contentStyle={{
                ...CHART_TOOLTIP_STYLE,
                maxWidth: 'min(260px, calc(100vw - 32px))',
                overflowWrap: 'anywhere',
                whiteSpace: 'normal',
              }}
              itemStyle={{ ...CHART_ITEM_STYLE, whiteSpace: 'normal' }}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => {
                const key = String(name ?? '')
                const label = categories.categoryMeta[key]?.name ?? key
                return [formatMoney(Number(value), displayCurrency, locale), label]
              }}
            />
            <Legend
              wrapperStyle={{ ...CHART_LEGEND_STYLE, fontSize: 11 }}
              formatter={(value) => {
                const key = String(value ?? '')
                return categories.categoryMeta[key]?.name ?? key
              }}
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
                <th key={categoryId}>{categories.categoryMeta[categoryId]?.name ?? categoryId}</th>
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

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {t('analytics.topCategories')}
        </p>
        {categories.currentMonthBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('analytics.noEligibleData')}</p>
        ) : (
          <div className="space-y-2">
            {categories.currentMonthBreakdown.map((item) => (
              <div
                key={item.categoryId}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,auto)] items-center gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color ?? 'var(--color-muted-foreground)' }}
                  />
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-xs font-semibold [overflow-wrap:anywhere] tabular-nums">
                    {formatMoney(item.amount, displayCurrency, locale)}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-[11px] font-medium tabular-nums">
                    {item.percent}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!hasChartData && (
        <p className="text-muted-foreground text-center text-sm">{t('analytics.noEligibleData')}</p>
      )}
    </div>
  )
}
