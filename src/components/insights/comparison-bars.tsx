import { useId } from 'react'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { MoneyChartTable } from '@/components/insights/money-chart-table'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_ITEM_STYLE,
  CHART_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
} from '@/lib/constants'
import { formatCompactChartMoney } from '@/components/dashboard/chart-money'
import { formatMoney } from '@/lib/money'
import type { SpendingComparison } from '@/stores/spending-insights-store'

interface ComparisonBarsProps {
  comparisons: SpendingComparison[]
  currency: string
  title: string
  caption: string
  currentLabel: string
  previousLabel: string
  categoryLabel: string
}

const MIN_COMPARISON_CHART_HEIGHT = 168
const COMPARISON_SCROLLPORT_MAX_HEIGHT = 520

function finiteAmount(value: number): boolean {
  return Number.isFinite(value)
}

/** Uncapped chart height. 40px per category keeps two bars and their gaps drawable. */
function comparisonChartHeight(rowCount: number): number {
  return Math.max(MIN_COMPARISON_CHART_HEIGHT, rowCount * 40 + 28)
}

export function ComparisonBars({
  comparisons,
  currency,
  title,
  caption,
  currentLabel,
  previousLabel,
  categoryLabel,
}: ComparisonBarsProps) {
  const describedBy = useId()
  if (!currency || comparisons.length === 0) return null
  if (comparisons.some((row) => !finiteAmount(row.current) || !finiteAmount(row.previous))) {
    return null
  }

  const rows = comparisons.map((row) => ({
    key: row.categoryName,
    name: row.categoryName,
    current: row.current,
    previous: row.previous,
  }))
  const chartHeight = comparisonChartHeight(rows.length)

  return (
    <div className="min-w-0">
      <ul className="mb-3 flex flex-wrap gap-4 text-xs" aria-label={title}>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: 'var(--color-chart-1)' }}
          />
          {currentLabel}
        </li>
        <li className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-sm"
            style={{ backgroundColor: 'var(--color-chart-2)' }}
          />
          {previousLabel}
        </li>
      </ul>
      <div
        className="focus-visible:ring-ring min-w-0 overflow-x-auto overflow-y-auto focus-visible:ring-2 focus-visible:outline-none"
        role="img"
        tabIndex={0}
        aria-label={title}
        aria-describedby={describedBy}
        style={{
          maxHeight: COMPARISON_SCROLLPORT_MAX_HEIGHT,
          overflowX: 'auto',
          overflowY: 'auto',
        }}
      >
        <div className="min-w-0" style={{ height: chartHeight }}>
          <SafeChart>
            <BarChart
              layout="vertical"
              data={rows}
              margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
              barGap={2}
              barCategoryGap={10}
            >
              <CartesianGrid horizontal={false} strokeDasharray="2 4" stroke={CHART_GRID_COLOR} />
              <XAxis
                type="number"
                axisLine={false}
                tickLine={false}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 10 }}
                tickFormatter={(value) => formatCompactChartMoney(Number(value), currency)}
                width={48}
              />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                width={88}
                tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                tickFormatter={(value: string) =>
                  value.length > 14 ? `${value.slice(0, 13)}…` : value
                }
                interval={0}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                itemStyle={CHART_ITEM_STYLE}
                labelStyle={CHART_LABEL_STYLE}
                cursor={{ fill: 'var(--color-muted)', fillOpacity: 0.35 }}
                formatter={(value, name) => [
                  formatMoney(Math.round(Number(value)), currency),
                  name === 'current' ? currentLabel : previousLabel,
                ]}
              />
              <Bar
                dataKey="previous"
                name="previous"
                fill="var(--color-chart-2)"
                maxBarSize={8}
                radius={[0, 2, 2, 0]}
                isAnimationActive={false}
              />
              <Bar
                dataKey="current"
                name="current"
                fill="var(--color-chart-1)"
                maxBarSize={8}
                radius={[0, 2, 2, 0]}
                isAnimationActive={false}
              />
            </BarChart>
          </SafeChart>
        </div>
      </div>
      <MoneyChartTable
        id={describedBy}
        caption={caption}
        columns={[categoryLabel, currentLabel, previousLabel]}
        rows={rows.map((row) => ({
          key: row.key,
          cells: [
            row.name,
            formatMoney(Math.round(row.current), currency),
            formatMoney(Math.round(row.previous), currency),
          ],
        }))}
      />
    </div>
  )
}
