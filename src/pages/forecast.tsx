import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, TrendingDown, TrendingUp, Flame, DollarSign, Calendar } from 'lucide-react'
import dayjs from 'dayjs'
import { AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useForecastStore } from '@/stores/forecast-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import { CHART_ITEM_STYLE, CHART_LABEL_STYLE, CHART_TOOLTIP_STYLE } from '@/lib/constants'

interface SubscriptionDisplay {
  name: string
  amount: number
  billing_cycle: string
  next_billing_date: string
}

export function Forecast() {
  const { t } = useTranslation('forecast')
  const { forecast, isLoading, selectedRange, setRange, generateForecast } = useForecastStore()

  useEffect(() => {
    generateForecast()
  }, [generateForecast])

  const chartData = useMemo(() => {
    if (!forecast) return []
    return forecast.points.map((p) => ({
      date: dayjs(p.date).format('MMM D'),
      fullDate: p.date,
      projected: fromCentavos(p.projected),
      optimistic: fromCentavos(p.optimistic),
      pessimistic: fromCentavos(p.pessimistic),
    }))
  }, [forecast])

  if (isLoading && !forecast) {
    return <ForecastSkeleton />
  }

  const ranges = [30, 60, 90] as const
  const endPoint = forecast?.points[forecast.points.length - 1]

  return (
    <div className="animate-fade-in-up page-content">
      {/* Page Header */}
      <div className="liquid-card page-header p-5">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t('description')}</p>
        </div>
        <div className="flex gap-1" role="group" aria-label={t('range.label')}>
          {ranges.map((r) => (
            <Button
              key={r}
              variant={selectedRange === r ? 'default' : 'outline'}
              size="sm"
              onClick={() => setRange(r)}
              aria-pressed={selectedRange === r}
            >
              {t(`range.${r}`)}
            </Button>
          ))}
        </div>
      </div>

      {/* Key Metrics */}
      {forecast && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricCard
            icon={<DollarSign size={16} />}
            iconColor="text-primary"
            label={t('metrics.currentBalance')}
            value={formatMoney(forecast.currentBalance)}
          />
          <MetricCard
            icon={<TrendingDown size={16} />}
            iconColor="text-destructive"
            label={t('metrics.lowestProjected')}
            value={formatMoney(forecast.minBalance.amount)}
            valueColor={forecast.minBalance.amount < 0 ? 'text-destructive' : ''}
          />
          <MetricCard
            icon={<Calendar size={16} />}
            iconColor="text-muted-foreground"
            label={t('metrics.lowestDate')}
            value={dayjs(forecast.minBalance.date).format('MMM D, YYYY')}
          />
          <MetricCard
            icon={<Flame size={16} />}
            iconColor="text-warning"
            label={t('metrics.dailyBurn')}
            value={formatMoney(forecast.dailyBurnRate)}
          />
          <MetricCard
            icon={<TrendingUp size={16} />}
            iconColor="text-success"
            label={t('metrics.dailyIncome')}
            value={formatMoney(forecast.dailyIncome)}
          />
          <MetricCard
            icon={<DollarSign size={16} />}
            iconColor="text-primary"
            label={t('metrics.projectedEnd')}
            value={formatMoney(endPoint?.projected ?? 0)}
            valueColor={(endPoint?.projected ?? 0) < 0 ? 'text-destructive' : ''}
          />
        </div>
      )}

      {/* Danger Warnings */}
      {forecast && forecast.dangerDates.length > 0 && (
        <div className="liquid-card border-destructive/30 bg-destructive/5 border p-4" role="alert">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle size={16} className="text-destructive" aria-hidden="true" />
            <h3 className="font-heading text-destructive text-sm font-semibold">
              {t('danger.title')}
            </h3>
          </div>
          <div className="space-y-1">
            <p className="text-sm">
              {t('danger.balanceBelowZero', {
                date: dayjs(forecast.dangerDates[0]).format('MMM D, YYYY'),
              })}
            </p>
            <p className="text-muted-foreground text-sm">
              {t('danger.lowestPoint', {
                amount: formatMoney(forecast.minBalance.amount),
                date: dayjs(forecast.minBalance.date).format('MMM D, YYYY'),
              })}
            </p>
          </div>
        </div>
      )}

      {forecast && forecast.dangerDates.length === 0 && (
        <div className="liquid-card border-success/30 bg-success/5 border p-4" role="status">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-success" aria-hidden="true" />
            <p className="text-success text-sm">{t('danger.noDanger')}</p>
          </div>
        </div>
      )}

      {/* Main Chart */}
      {forecast && chartData.length > 0 && (
        <div className="liquid-card p-5">
          <h3 className="font-heading mb-4 text-sm font-semibold">{t('chart.title')}</h3>
          <div className="h-80" role="img" aria-label={t('chart.title')}>
            <SafeChart>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="forecastProjectedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C5CFF" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#7C5CFF" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#A9A9B4', fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: '#A9A9B4', fontSize: 11 }}
                  tickFormatter={(v) => `$${(v / 1).toLocaleString()}`}
                />
                <Tooltip
                  contentStyle={CHART_TOOLTIP_STYLE}
                  itemStyle={CHART_ITEM_STYLE}
                  labelStyle={CHART_LABEL_STYLE}
                  formatter={(value) =>
                    `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  }
                />
                <Legend wrapperStyle={{ fontSize: 11, color: '#A9A9B4' }} />
                <Area
                  type="monotone"
                  dataKey="optimistic"
                  name={t('chart.optimistic')}
                  stroke="#34D399"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  fill="none"
                />
                <Area
                  type="monotone"
                  dataKey="projected"
                  name={t('chart.projected')}
                  stroke="#7C5CFF"
                  strokeWidth={2}
                  fill="url(#forecastProjectedGrad)"
                />
                <Area
                  type="monotone"
                  dataKey="pessimistic"
                  name={t('chart.pessimistic')}
                  stroke="#EF4444"
                  strokeWidth={1.5}
                  strokeDasharray="6 3"
                  fill="none"
                />
              </AreaChart>
            </SafeChart>
          </div>
        </div>
      )}

      {/* Subscriptions Table */}
      <SubscriptionsTable />
    </div>
  )
}

function SubscriptionsTable() {
  const { t } = useTranslation('forecast')

  const { subscriptions, isLoading } = useSubscriptions()

  if (isLoading) {
    return (
      <div className="liquid-card p-5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    )
  }

  return (
    <div className="liquid-card p-5">
      <h3 className="font-heading mb-4 text-sm font-semibold">{t('table.title')}</h3>
      {subscriptions.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('table.noSubscriptions')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-muted-foreground border-b border-white/5 text-left text-xs">
                <th scope="col" className="pb-2 font-medium">
                  {t('table.name')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.amount')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.frequency')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('table.nextDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.map((sub, i) => (
                <tr key={i} className="border-b border-white/5 last:border-0">
                  <td className="py-2.5 font-medium">{sub.name}</td>
                  <td className="py-2.5">{formatMoney(sub.amount)}</td>
                  <td className="py-2.5">
                    <Badge variant="secondary" className="text-[10px]">
                      {sub.billing_cycle}
                    </Badge>
                  </td>
                  <td className="text-muted-foreground py-2.5 font-mono text-xs">
                    {dayjs(sub.next_billing_date).format('MMM D, YYYY')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function useSubscriptions() {
  const [subscriptions, setSubscriptions] = useState<SubscriptionDisplay[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const rows = await query<SubscriptionDisplay>(
          `SELECT name, amount, billing_cycle, next_billing_date
           FROM subscriptions
           WHERE is_active = 1
           ORDER BY next_billing_date ASC`
        )
        setSubscriptions(rows)
      } catch {
        setSubscriptions([])
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  return { subscriptions, isLoading }
}

function MetricCard({
  icon,
  iconColor,
  label,
  value,
  valueColor,
}: {
  icon: React.ReactNode
  iconColor: string
  label: string
  value: string
  valueColor?: string
}) {
  return (
    <div className="liquid-card p-5">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={iconColor}>{icon}</span>
        <span className="font-mono text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      <p className={`font-heading text-lg font-bold tracking-tight ${valueColor || ''}`}>{value}</p>
    </div>
  )
}

function ForecastSkeleton() {
  return (
    <div className="page-content">
      <Skeleton className="h-20 w-full" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="liquid-card space-y-3 p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
      <div className="liquid-card p-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-80 w-full" />
      </div>
    </div>
  )
}
