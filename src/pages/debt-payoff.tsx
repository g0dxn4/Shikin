import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Target,
  Plus,
  Trash2,
  TrendingDown,
  Calendar,
  DollarSign,
  Zap,
  Snowflake,
  ChevronDown,
} from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebtStore, type DebtStrategy } from '@/stores/debt-store'
import { formatMoney, toCentavos, fromCentavos } from '@/lib/money'
import type { MonthlySnapshot } from '@/lib/debt-service'
import dayjs from 'dayjs'

const DEBT_COLORS = [
  '#bf5af2',
  '#3b82f6',
  '#f97316',
  '#22c55e',
  '#ef4444',
  '#ec4899',
  '#f59e0b',
  '#06b6d4',
  '#8b5cf6',
  '#14b8a6',
]

function StrategyToggle({
  strategy,
  onToggle,
}: {
  strategy: DebtStrategy
  onToggle: (s: DebtStrategy) => void
}) {
  const { t } = useTranslation('debtPayoff')

  return (
    <div className="glass-card p-4">
      <h3 className="font-heading mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
        {t('strategy.title')}
      </h3>
      <div className="flex gap-2">
        <button
          onClick={() => onToggle('avalanche')}
          className={`flex flex-1 items-center gap-2 rounded-lg px-4 py-3 text-left transition-all ${
            strategy === 'avalanche'
              ? 'bg-[#bf5af2]/20 ring-1 ring-[#bf5af2]/50'
              : 'bg-white/5 hover:bg-white/8'
          }`}
        >
          <Zap
            size={18}
            className={strategy === 'avalanche' ? 'text-[#bf5af2]' : 'text-white/40'}
          />
          <div>
            <p
              className={`text-sm font-semibold ${strategy === 'avalanche' ? 'text-[#bf5af2]' : 'text-white/70'}`}
            >
              {t('strategy.avalanche')}
            </p>
            <p className="text-xs text-white/40">{t('strategy.avalancheDesc')}</p>
          </div>
        </button>
        <button
          onClick={() => onToggle('snowball')}
          className={`flex flex-1 items-center gap-2 rounded-lg px-4 py-3 text-left transition-all ${
            strategy === 'snowball'
              ? 'bg-[#3b82f6]/20 ring-1 ring-[#3b82f6]/50'
              : 'bg-white/5 hover:bg-white/8'
          }`}
        >
          <Snowflake
            size={18}
            className={strategy === 'snowball' ? 'text-[#3b82f6]' : 'text-white/40'}
          />
          <div>
            <p
              className={`text-sm font-semibold ${strategy === 'snowball' ? 'text-[#3b82f6]' : 'text-white/70'}`}
            >
              {t('strategy.snowball')}
            </p>
            <p className="text-xs text-white/40">{t('strategy.snowballDesc')}</p>
          </div>
        </button>
      </div>
    </div>
  )
}

function ComparisonCards() {
  const { t } = useTranslation('debtPayoff')
  const { comparison } = useDebtStore()

  if (!comparison) return null

  const { snowball, avalanche, interestSaved, monthsDifference } = comparison

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="glass-card p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('comparison.avalancheMonths')}
        </p>
        <p className="font-heading mt-1 text-2xl font-bold text-[#bf5af2]">
          {avalanche.months}
          <span className="text-sm font-normal text-white/40"> {t('comparison.months')}</span>
        </p>
        <p className="mt-0.5 text-xs text-white/40">
          {t('comparison.totalInterest')}: {formatMoney(avalanche.totalInterestPaid)}
        </p>
      </div>
      <div className="glass-card p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('comparison.snowballMonths')}
        </p>
        <p className="font-heading mt-1 text-2xl font-bold text-[#3b82f6]">
          {snowball.months}
          <span className="text-sm font-normal text-white/40"> {t('comparison.months')}</span>
        </p>
        <p className="mt-0.5 text-xs text-white/40">
          {t('comparison.totalInterest')}: {formatMoney(snowball.totalInterestPaid)}
        </p>
      </div>
      <div className="glass-card p-4">
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('comparison.interestSaved')}
        </p>
        <p className="font-heading mt-1 text-2xl font-bold text-[#22c55e]">
          {formatMoney(Math.abs(interestSaved))}
        </p>
        <p className="mt-0.5 text-xs text-white/40">
          {monthsDifference !== 0
            ? `${Math.abs(monthsDifference)} ${t('comparison.fewerMonths')}`
            : t('comparison.sameTimeline')}
        </p>
      </div>
    </div>
  )
}

function DebtChart() {
  const { t } = useTranslation('debtPayoff')
  const { payoffPlan, debts, manualDebts } = useDebtStore()

  if (!payoffPlan || payoffPlan.schedule.length === 0) return null

  const allDebts = [...debts, ...manualDebts]

  // Sample schedule for chart (every month for small plans, every N months for large)
  const schedule = payoffPlan.schedule
  const step = Math.max(1, Math.floor(schedule.length / 60))
  const sampled = schedule.filter((_, i) => i % step === 0 || i === schedule.length - 1)

  const chartData = sampled.map((snap: MonthlySnapshot) => {
    const row: Record<string, number | string> = {
      month: dayjs()
        .add(snap.month, 'month')
        .format('MMM YY'),
    }
    for (const d of allDebts) {
      row[d.name] = fromCentavos(snap.balances[d.id] ?? 0)
    }
    row.total = fromCentavos(snap.totalBalance)
    return row
  })

  return (
    <div className="glass-card p-5">
      <h3 className="font-heading mb-4 text-sm font-semibold uppercase tracking-wider text-white/60">
        {t('chart.title')}
      </h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={chartData}>
          <XAxis
            dataKey="month"
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
            tickLine={false}
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{
              background: '#0a0a0a',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              color: '#f0f0f0',
              fontSize: 12,
            }}
            formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(2)}`]}
          />
          {allDebts.map((d, i) => (
            <Area
              key={d.id}
              type="monotone"
              dataKey={d.name}
              stackId="1"
              fill={DEBT_COLORS[i % DEBT_COLORS.length]}
              fillOpacity={0.3}
              stroke={DEBT_COLORS[i % DEBT_COLORS.length]}
              strokeWidth={1.5}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function DebtCard({
  debt,
  color,
  isManual,
  onRemove,
}: {
  debt: { id: string; name: string; balance: number; apr: number; minPayment: number }
  color: string
  isManual: boolean
  onRemove?: () => void
}) {
  const { t } = useTranslation('debtPayoff')

  return (
    <div className="glass-card group relative overflow-hidden p-4">
      <div
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: color }}
      />
      <div className="flex items-start justify-between">
        <div className="pl-3">
          <h4 className="font-heading text-sm font-semibold">{debt.name}</h4>
          <p className="font-heading mt-1 text-xl font-bold">{formatMoney(debt.balance)}</p>
          <div className="mt-2 flex gap-3">
            <span className="text-xs text-white/40">
              {t('debtCard.apr')}: {debt.apr.toFixed(1)}%
            </span>
            <span className="text-xs text-white/40">
              {t('debtCard.minPayment')}: {formatMoney(debt.minPayment)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {isManual && (
            <Badge variant="secondary" className="text-[10px]">
              {t('debtCard.manual')}
            </Badge>
          )}
          {isManual && onRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100"
              onClick={onRemove}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddDebtForm({ onAdd }: { onAdd: (debt: { name: string; balance: number; apr: number; minPayment: number }) => void }) {
  const { t } = useTranslation('debtPayoff')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [apr, setApr] = useState('')
  const [minPayment, setMinPayment] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !balance) return
    onAdd({
      name,
      balance: toCentavos(parseFloat(balance) || 0),
      apr: parseFloat(apr) || 0,
      minPayment: toCentavos(parseFloat(minPayment) || 25),
    })
    setName('')
    setBalance('')
    setApr('')
    setMinPayment('')
    setOpen(false)
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="w-full border-dashed">
        <Plus size={16} />
        {t('addDebt.button')}
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="glass-card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-heading text-sm font-semibold">{t('addDebt.title')}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setOpen(false)}
        >
          <ChevronDown size={14} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-white/40">{t('addDebt.name')}</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('addDebt.namePlaceholder')}
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-[#bf5af2]/50 focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/40">{t('addDebt.balance')}</label>
          <input
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="5000.00"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-[#bf5af2]/50 focus:outline-none"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/40">{t('addDebt.apr')}</label>
          <input
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="24.99"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-[#bf5af2]/50 focus:outline-none"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-xs text-white/40">{t('addDebt.minPayment')}</label>
          <input
            value={minPayment}
            onChange={(e) => setMinPayment(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="25.00"
            className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 focus:border-[#bf5af2]/50 focus:outline-none"
          />
        </div>
      </div>
      <Button type="submit" className="w-full">
        <Plus size={14} />
        {t('addDebt.submit')}
      </Button>
    </form>
  )
}

function SummaryMetrics() {
  const { t } = useTranslation('debtPayoff')
  const { totalDebt, totalMinPayment, payoffPlan } = useDebtStore()

  const payoffDate = payoffPlan
    ? dayjs().add(payoffPlan.months, 'month').format('MMM YYYY')
    : '--'

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="glass-card p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#ef4444]/10">
          <DollarSign size={16} className="text-[#ef4444]" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('summary.totalDebt')}
        </p>
        <p className="font-heading mt-1 text-xl font-bold">{formatMoney(totalDebt)}</p>
      </div>
      <div className="glass-card p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#f59e0b]/10">
          <TrendingDown size={16} className="text-[#f59e0b]" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('summary.monthlyMin')}
        </p>
        <p className="font-heading mt-1 text-xl font-bold">{formatMoney(totalMinPayment)}</p>
      </div>
      <div className="glass-card p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#22c55e]/10">
          <Calendar size={16} className="text-[#22c55e]" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('summary.debtFreeDate')}
        </p>
        <p className="font-heading mt-1 text-xl font-bold">{payoffDate}</p>
      </div>
      <div className="glass-card p-4">
        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[#bf5af2]/10">
          <Target size={16} className="text-[#bf5af2]" />
        </div>
        <p className="text-xs font-medium uppercase tracking-wider text-white/40">
          {t('summary.totalInterest')}
        </p>
        <p className="font-heading mt-1 text-xl font-bold">
          {payoffPlan ? formatMoney(payoffPlan.totalInterestPaid) : '$0.00'}
        </p>
      </div>
    </div>
  )
}

export function DebtPayoff() {
  const { t } = useTranslation('debtPayoff')
  const {
    debts,
    manualDebts,
    strategy,
    extraPayment,
    isLoading,
    loadDebts,
    addManualDebt,
    removeDebt,
    setStrategy,
    setExtraPayment,
  } = useDebtStore()

  useEffect(() => {
    loadDebts()
  }, [loadDebts])

  const allDebts = [...debts, ...manualDebts]
  const hasDebts = allDebts.length > 0

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card space-y-3 p-4">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : !hasDebts ? (
        <div className="space-y-4">
          <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
            <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
              <Target size={28} className="text-primary" />
            </div>
            <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground mb-4 max-w-md text-sm">
              {t('empty.description')}
            </p>
          </div>
          <AddDebtForm
            onAdd={(debt) =>
              addManualDebt({
                name: debt.name,
                balance: debt.balance,
                apr: debt.apr,
                minPayment: debt.minPayment,
              })
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Summary metrics */}
          <SummaryMetrics />

          {/* Strategy toggle + Extra payment */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StrategyToggle strategy={strategy} onToggle={setStrategy} />
            </div>
            <div className="glass-card p-4">
              <h3 className="font-heading mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
                {t('extraPayment.title')}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-lg text-white/40">$</span>
                <input
                  type="number"
                  step="1"
                  min="0"
                  value={fromCentavos(extraPayment) || ''}
                  onChange={(e) => setExtraPayment(toCentavos(parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className="h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-lg font-semibold text-white placeholder:text-white/30 focus:border-[#bf5af2]/50 focus:outline-none"
                />
                <span className="text-sm text-white/40">{t('extraPayment.perMonth')}</span>
              </div>
              <p className="mt-2 text-xs text-white/30">{t('extraPayment.description')}</p>
            </div>
          </div>

          {/* Strategy comparison */}
          <ComparisonCards />

          {/* Chart */}
          <DebtChart />

          {/* Payoff order */}
          {useDebtStore.getState().payoffPlan &&
            useDebtStore.getState().payoffPlan!.debtPayoffOrder.length > 0 && (
              <div className="glass-card p-5">
                <h3 className="font-heading mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
                  {t('payoffOrder.title')}
                </h3>
                <div className="space-y-2">
                  {useDebtStore.getState().payoffPlan!.debtPayoffOrder.map((item, i) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 rounded-lg bg-white/5 px-4 py-2"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#bf5af2]/20 text-xs font-bold text-[#bf5af2]">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-sm font-medium">{item.name}</span>
                      <span className="text-xs text-white/40">
                        {dayjs()
                          .add(item.paidOffMonth, 'month')
                          .format('MMM YYYY')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

          {/* Debt list */}
          <div>
            <h3 className="font-heading mb-3 text-sm font-semibold uppercase tracking-wider text-white/60">
              {t('debtList.title')}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {allDebts.map((d, i) => (
                <DebtCard
                  key={d.id}
                  debt={d}
                  color={DEBT_COLORS[i % DEBT_COLORS.length]}
                  isManual={manualDebts.some((m) => m.id === d.id)}
                  onRemove={() => removeDebt(d.id)}
                />
              ))}
            </div>
          </div>

          {/* Add manual debt */}
          <AddDebtForm
            onAdd={(debt) =>
              addManualDebt({
                name: debt.name,
                balance: debt.balance,
                apr: debt.apr,
                minPayment: debt.minPayment,
              })
            }
          />
        </div>
      )}
    </div>
  )
}
