import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { formatMoney } from '@/lib/money'
import { CHART_TOOLTIP_STYLE, CHART_ITEM_STYLE, CHART_LABEL_STYLE } from '@/lib/constants'
import type { CategoriesResult } from '@/lib/dashboard-analytics'
import { SafeChart } from '@/components/ui/safe-chart'

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
  const { t } = useTranslation('dashboard')

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
          className="border-warning/30 bg-warning/8 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {notice}
        </div>
      )}

      {categories.splitIntegrityNotices.length > 0 && (
        <div
          className="border-warning/30 bg-warning/8 text-warning rounded-xl border px-3 py-2 text-xs font-semibold"
          role="status"
        >
          {t('analytics.splitIntegrityNotice', {
            count: categories.splitIntegrityNotices.length,
          })}
        </div>
      )}

      <div
        className="h-72"
        role="img"
        aria-label={t('analytics.categoriesChartLabel')}
        aria-describedby="spending-categories-data"
      >
        <SafeChart>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#A9A9B4', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#A9A9B4', fontSize: 11 }}
              tickFormatter={(v) => formatMoney(Number(v), displayCurrency)}
              width={64}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              itemStyle={CHART_ITEM_STYLE}
              labelStyle={CHART_LABEL_STYLE}
              formatter={(value, name) => {
                const key = String(name ?? '')
                const label = categories.categoryMeta[key]?.name ?? key
                return [formatMoney(Number(value), displayCurrency), label]
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: '#A9A9B4' }}
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
                fill={categories.categoryMeta[categoryId]?.color ?? '#9CA3AF'}
                radius={[0, 0, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </SafeChart>
      </div>

      <table id="spending-categories-data" className="sr-only">
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
                  {formatMoney(Number(month[categoryId] ?? 0), displayCurrency)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-3">
        <p className="text-muted-foreground text-xs font-bold tracking-wider uppercase">
          {t('analytics.topCategories')}
        </p>
        {categories.currentMonthBreakdown.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('analytics.noEligibleData')}</p>
        ) : (
          <div className="space-y-2">
            {categories.currentMonthBreakdown.map((item) => (
              <div
                key={item.categoryId}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color ?? '#9CA3AF' }}
                  />
                  <span className="truncate text-sm font-semibold">{item.name}</span>
                </div>
                <span className="font-mono text-xs font-bold">
                  {formatMoney(item.amount, displayCurrency)}
                </span>
                <span className="text-muted-foreground w-12 text-right font-mono text-xs font-bold">
                  {item.percent}%
                </span>
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
