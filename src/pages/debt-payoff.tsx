import { Input } from '@/components/ui/input'
import { PageToolbar, MetricStrip, MetricItem } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { useAccountStore } from '@/stores/account-store'
import {
  CHART_AXIS_COLOR,
  CHART_GRID_COLOR,
  CHART_TOOLTIP_STYLE,
  CHART_LEGEND_STYLE,
} from '@/lib/constants'
import { useEffect, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Plus, Trash2, Zap, Snowflake, ChevronDown } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebtStore, type DebtStrategy } from '@/stores/debt-store'
import { formatMoney, toCentavos, fromCentavos } from '@/lib/money'
import {
  calculatePayoffPlan,
  compareStrategies,
  type MonthlySnapshot,
  type Debt,
  type PayoffPlan,
  type StrategyComparison,
} from '@/lib/debt-service'
import dayjs from 'dayjs'

const DEBT_COLORS = [
  'var(--color-chart-1)',
  'var(--color-chart-2)',
  'var(--color-chart-3)',
  'var(--color-chart-4)',
  'var(--color-chart-5)',
]

const DEBT_INPUT_CLASS =
  'h-9 w-full rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent/50 focus:outline-none'

const EXTRA_PAYMENT_ERROR_ID = 'extra-payment-error'

function extraPaymentDraftFromCentavos(centavos: number): string {
  return centavos === 0 ? '' : String(fromCentavos(centavos))
}

function parseExtraPaymentCentavos(value: string, valueAsNumber: number): number | null {
  if (value === '') return 0
  if (!Number.isFinite(valueAsNumber) || valueAsNumber < 0) return null
  const centavos = toCentavos(valueAsNumber)
  if (!Number.isSafeInteger(centavos) || centavos < 0) return null
  return centavos
}

function StrategyToggle({
  strategy,
  onToggle,
}: {
  strategy: DebtStrategy
  onToggle: (s: DebtStrategy) => void
}) {
  const { t } = useTranslation('debtPayoff')

  return (
    <div className="native-panel p-4">
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        {t('strategy.title')}
      </h3>
      <div
        className="flex flex-col gap-2 sm:flex-row"
        role="group"
        aria-label={t('strategy.title')}
      >
        <button
          onClick={() => onToggle('avalanche')}
          aria-pressed={strategy === 'avalanche'}
          className={`focus:ring-accent/50 flex flex-1 items-center gap-2 rounded-lg px-4 py-3 text-left transition-all focus:ring-2 focus:outline-none ${
            strategy === 'avalanche'
              ? 'bg-accent/20 ring-accent/50 ring-1'
              : 'bg-muted/50 hover:bg-muted/50'
          }`}
        >
          <Zap
            size={18}
            className={strategy === 'avalanche' ? 'text-accent' : 'text-muted-foreground'}
          />
          <div>
            <p
              className={`text-sm font-semibold ${strategy === 'avalanche' ? 'text-accent' : 'text-muted-foreground'}`}
            >
              {t('strategy.avalanche')}
            </p>
            <p className="text-muted-foreground text-xs">{t('strategy.avalancheDesc')}</p>
          </div>
        </button>
        <button
          onClick={() => onToggle('snowball')}
          aria-pressed={strategy === 'snowball'}
          className={`focus:ring-chart-3/50 flex flex-1 items-center gap-2 rounded-lg px-4 py-3 text-left transition-all focus:ring-2 focus:outline-none ${
            strategy === 'snowball'
              ? 'bg-chart-3/20 ring-chart-3/50 ring-1'
              : 'bg-muted/50 hover:bg-muted/50'
          }`}
        >
          <Snowflake
            size={18}
            className={strategy === 'snowball' ? 'text-chart-3' : 'text-muted-foreground'}
          />
          <div>
            <p
              className={`text-sm font-semibold ${strategy === 'snowball' ? 'text-chart-3' : 'text-muted-foreground'}`}
            >
              {t('strategy.snowball')}
            </p>
            <p className="text-muted-foreground text-xs">{t('strategy.snowballDesc')}</p>
          </div>
        </button>
      </div>
    </div>
  )
}

function ComparisonCards({
  comparison,
  currency,
}: {
  comparison: StrategyComparison
  currency: string
}) {
  const { t } = useTranslation('debtPayoff')

  if (!comparison) return null

  const { snowball, avalanche, interestSaved, monthsDifference } = comparison

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="native-panel p-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t('comparison.avalancheMonths')}
        </p>
        <p className="text-accent mt-1 text-2xl font-bold">
          {avalanche.months}
          <span className="text-muted-foreground text-sm font-normal">
            {' '}
            {t('comparison.months')}
          </span>
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('comparison.totalInterest')}: {formatMoney(avalanche.totalInterestPaid, currency)}
        </p>
      </div>
      <div className="native-panel p-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t('comparison.snowballMonths')}
        </p>
        <p className="text-chart-3 mt-1 text-2xl font-bold">
          {snowball.months}
          <span className="text-muted-foreground text-sm font-normal">
            {' '}
            {t('comparison.months')}
          </span>
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {t('comparison.totalInterest')}: {formatMoney(snowball.totalInterestPaid, currency)}
        </p>
      </div>
      <div className="native-panel p-4">
        <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {t('comparison.interestSaved')}
        </p>
        <p className="text-success mt-1 text-2xl font-bold">
          {formatMoney(Math.abs(interestSaved), currency)}
        </p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {monthsDifference !== 0
            ? `${Math.abs(monthsDifference)} ${t('comparison.fewerMonths')}`
            : t('comparison.sameTimeline')}
        </p>
      </div>
    </div>
  )
}

function DebtChart({
  payoffPlan,
  allDebts,
  currency,
}: {
  payoffPlan: PayoffPlan
  allDebts: Debt[]
  currency: string
}) {
  const { t } = useTranslation('debtPayoff')

  if (!payoffPlan || payoffPlan.schedule.length === 0) return null

  // Sample schedule for chart (every month for small plans, every N months for large)
  const schedule = payoffPlan.schedule
  const step = Math.max(1, Math.floor(schedule.length / 60))
  const sampled = schedule.filter((_, i) => i % step === 0 || i === schedule.length - 1)

  const chartData = sampled.map((snap: MonthlySnapshot) => {
    const row: Record<string, number | string> = {
      month: dayjs().add(snap.month, 'month').format('MMM YY'),
    }
    for (const d of allDebts) {
      row[d.id] = snap.balances[d.id] ?? 0
    }
    row.total = snap.totalBalance
    return row
  })

  return (
    <div className="native-panel p-5">
      <h3 className="text-muted-foreground mb-4 text-sm font-semibold tracking-wider uppercase">
        {t('chart.title')}
      </h3>
      <div aria-label={t('chart.title')}>
        <SafeChart height={300}>
          <AreaChart data={chartData}>
            <CartesianGrid stroke={CHART_GRID_COLOR} vertical={false} />
            <Legend wrapperStyle={CHART_LEGEND_STYLE} />
            <XAxis
              dataKey="month"
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID_COLOR }}
              tickLine={false}
              tickFormatter={(v: number) => formatMoney(v, currency)}
            />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(value) => formatMoney(Number(value), currency)}
            />
            {allDebts.map((d, i) => (
              <Area
                key={d.id}
                type="monotone"
                dataKey={d.id}
                name={d.name}
                isAnimationActive={false}
                fill={DEBT_COLORS[i % DEBT_COLORS.length]}
                fillOpacity={0.3}
                stroke={DEBT_COLORS[i % DEBT_COLORS.length]}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        </SafeChart>
      </div>
      <details className="mt-4">
        <summary className="text-primary cursor-pointer text-xs">{t('chart.data')}</summary>
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t('chart.title')}</caption>
            <thead>
              <tr>
                <th scope="col" className="p-2">
                  {t('chart.month')}
                </th>
                {allDebts.map((debt) => (
                  <th scope="col" key={debt.id} className="p-2">
                    {debt.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.map((snapshot) => (
                <tr key={snapshot.month}>
                  <th scope="row" className="p-2 font-normal">
                    {dayjs().add(snapshot.month, 'month').format('MMM YYYY')}
                  </th>
                  {allDebts.map((debt) => (
                    <td key={debt.id} className="p-2 tabular-nums">
                      {formatMoney(snapshot.balances[debt.id] ?? 0, currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}

function DebtCard({
  debt,
  color,
  currency,
  isManual,
  onRemove,
}: {
  debt: { id: string; name: string; balance: number; apr: number; minPayment: number }
  color: string
  currency: string
  isManual: boolean
  onRemove?: () => void
}) {
  const { t } = useTranslation('debtPayoff')

  return (
    <div className="native-panel group relative overflow-hidden p-4">
      <div className="absolute top-0 left-0 h-full w-1" style={{ backgroundColor: color }} />
      <div className="flex items-start justify-between">
        <div className="pl-3">
          <h4 className="text-sm font-semibold">{debt.name}</h4>
          <p className="mt-1 text-xl font-bold">{formatMoney(debt.balance, currency)}</p>
          <div className="mt-2 flex gap-3">
            <span className="text-muted-foreground text-xs">
              {t('debtCard.apr')}: {debt.apr.toFixed(1)}%
            </span>
            <span className="text-muted-foreground text-xs">
              {t('debtCard.minPayment')}: {formatMoney(debt.minPayment, currency)}
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
              className="text-destructive hover:text-destructive h-11 w-11 opacity-100 transition-opacity sm:h-10 sm:w-10 md:opacity-60 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
              onClick={onRemove}
              aria-label={t('actions.delete', { ns: 'common', defaultValue: 'Delete' })}
            >
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function AddDebtForm({
  onAdd,
}: {
  onAdd: (debt: { name: string; balance: number; apr: number; minPayment: number }) => void
}) {
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
    <form onSubmit={handleSubmit} className="native-panel space-y-3 p-4">
      <p className="text-muted-foreground text-xs">{t('scope.manual')}</p>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t('addDebt.title')}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setOpen(false)}
          aria-label={t('actions.cancel', { ns: 'common', defaultValue: 'Cancel' })}
        >
          <ChevronDown size={14} />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label htmlFor="add-debt-name" className="text-muted-foreground mb-1 block text-xs">
            {t('addDebt.name')}
          </label>
          <Input
            id="add-debt-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('addDebt.namePlaceholder')}
            className={DEBT_INPUT_CLASS}
            required
          />
        </div>
        <div>
          <label htmlFor="add-debt-balance" className="text-muted-foreground mb-1 block text-xs">
            {t('addDebt.balance')}
          </label>
          <Input
            id="add-debt-balance"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="5000.00"
            className={DEBT_INPUT_CLASS}
            required
          />
        </div>
        <div>
          <label htmlFor="add-debt-apr" className="text-muted-foreground mb-1 block text-xs">
            {t('addDebt.apr')}
          </label>
          <Input
            id="add-debt-apr"
            value={apr}
            onChange={(e) => setApr(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="24.99"
            className={DEBT_INPUT_CLASS}
          />
        </div>
        <div className="col-span-2">
          <label
            htmlFor="add-debt-min-payment"
            className="text-muted-foreground mb-1 block text-xs"
          >
            {t('addDebt.minPayment')}
          </label>
          <Input
            id="add-debt-min-payment"
            value={minPayment}
            onChange={(e) => setMinPayment(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="25.00"
            className={DEBT_INPUT_CLASS}
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

function SummaryMetrics({
  debts,
  payoffPlan,
  currency,
}: {
  debts: Debt[]
  payoffPlan: PayoffPlan
  currency: string
}) {
  const { t } = useTranslation('debtPayoff')
  return (
    <MetricStrip>
      <MetricItem
        label={t('summary.totalDebt')}
        value={formatMoney(
          debts.reduce((sum, debt) => sum + debt.balance, 0),
          currency
        )}
      />
      <MetricItem
        label={t('summary.monthlyMin')}
        value={formatMoney(
          debts.reduce((sum, debt) => sum + debt.minPayment, 0),
          currency
        )}
      />
      <MetricItem
        label={t('summary.debtFreeDate')}
        value={
          payoffPlan.schedule[payoffPlan.schedule.length - 1]?.totalBalance
            ? t('summary.notRepaid')
            : dayjs().add(payoffPlan.months, 'month').format('MMM YYYY')
        }
      />
      <MetricItem
        label={t('summary.totalInterest')}
        value={formatMoney(payoffPlan.totalInterestPaid, currency)}
      />
    </MetricStrip>
  )
}

function ExtraPaymentInput({
  extraPayment,
  currency,
  onAccept,
}: {
  extraPayment: number
  currency: string
  onAccept: (centavos: number) => void
}) {
  const { t } = useTranslation('debtPayoff')
  const [draft, setDraft] = useState(() => extraPaymentDraftFromCentavos(extraPayment))
  const [invalid, setInvalid] = useState(false)
  const [prevExtraPayment, setPrevExtraPayment] = useState(extraPayment)

  if (extraPayment !== prevExtraPayment) {
    setPrevExtraPayment(extraPayment)
    if (!invalid) {
      const acceptedFromDraft = parseExtraPaymentCentavos(
        draft,
        draft === '' ? 0 : Number.parseFloat(draft)
      )
      if (acceptedFromDraft !== extraPayment) {
        setDraft(extraPaymentDraftFromCentavos(extraPayment))
      }
    }
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget
    if (input.validity.badInput) {
      setInvalid(true)
      return
    }

    const { value } = input
    setDraft(value)
    const centavos = parseExtraPaymentCentavos(value, input.valueAsNumber)
    if (centavos === null || input.validity.stepMismatch) {
      setInvalid(true)
      return
    }

    setInvalid(false)
    onAccept(centavos)
  }

  return (
    <div className="native-panel p-4">
      <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
        {t('extraPayment.title')}
      </h3>
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">{currency}</span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={draft}
          onChange={handleChange}
          placeholder="0.00"
          aria-label={t('extraPayment.title')}
          aria-invalid={invalid}
          aria-describedby={invalid ? EXTRA_PAYMENT_ERROR_ID : undefined}
          className="text-foreground placeholder:text-muted-foreground h-10 w-full text-lg font-semibold"
        />
        <span className="text-muted-foreground text-sm">{t('extraPayment.perMonth')}</span>
      </div>
      {invalid ? (
        <p id={EXTRA_PAYMENT_ERROR_ID} className="text-destructive mt-2 text-xs" role="alert">
          {t('extraPayment.invalid')}
        </p>
      ) : null}
      <p className="text-muted-foreground mt-2 text-xs">{t('extraPayment.description')}</p>
    </div>
  )
}

export function DebtPayoff() {
  const { t } = useTranslation('debtPayoff')
  const { t: tCommon } = useTranslation('common')
  const {
    debts,
    manualDebts,
    strategy,
    extraPayment,
    error,
    isLoading,
    loadDebts,
    addManualDebt,
    removeDebt,
    setStrategy,
    setExtraPayment,
  } = useDebtStore()

  const {
    accounts,
    fetch: fetchAccounts,
    fetchError: accountsError,
    isLoading: accountsLoading,
  } = useAccountStore()
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null)
  useEffect(() => {
    void loadDebts()
    void fetchAccounts().catch(() => {})
  }, [loadDebts, fetchAccounts])

  const currencyFor = (debt: Debt) =>
    manualDebts.some((manual) => manual.id === debt.id)
      ? 'USD'
      : accounts.find((account) => account.id === debt.id)?.currency
  const currencies = [
    ...new Set([
      ...debts.map(currencyFor).filter((currency): currency is string => Boolean(currency)),
      'USD',
    ]),
  ]
  const currency =
    selectedCurrency && currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0]
  const allDebts = [...debts, ...manualDebts].filter((debt) => currencyFor(debt) === currency)
  const hasDebts = debts.length + manualDebts.length > 0
  const unknownCurrency = debts.some((debt) => !currencyFor(debt))
  const canCalculate = !unknownCurrency && !accountsError && !error
  const payoffPlan = calculatePayoffPlan(allDebts, strategy, extraPayment)
  const comparison = compareStrategies(allDebts, extraPayment)

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex items-center gap-2 text-xs">
            {t('scope.currency')}
            <select
              className="bg-background text-foreground border-border min-h-10 rounded-lg border px-3"
              value={currency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <span>{t('scope.description')}</span>
          </label>
        }
      />
      <ErrorBanner
        title={t('error.load')}
        message={error || accountsError}
        onRetry={() => {
          void loadDebts()
          void fetchAccounts().catch(() => {})
        }}
      />
      {unknownCurrency && (
        <p role="status" className="text-warning text-xs">
          {t('scope.unknown')}{' '}
          {debts
            .filter((debt) => !currencyFor(debt))
            .map((debt) => debt.name)
            .join(', ')}
        </p>
      )}

      {isLoading || accountsLoading ? (
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">{tCommon('status.loading')}</span>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="native-panel space-y-3 p-4">
                <Skeleton className="h-11 w-11 sm:h-10 sm:w-10" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
        </div>
      ) : !hasDebts ? (
        <div className="space-y-4">
          <div className="native-panel flex flex-col items-center justify-center py-16 text-center">
            <div
              className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
              aria-hidden="true"
            >
              <Target size={28} className="text-primary" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground mb-4 max-w-md text-sm">{t('empty.description')}</p>
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
          {canCalculate && (
            <SummaryMetrics debts={allDebts} payoffPlan={payoffPlan} currency={currency} />
          )}

          {/* Strategy toggle + Extra payment */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <StrategyToggle strategy={strategy} onToggle={setStrategy} />
            </div>
            <ExtraPaymentInput
              extraPayment={extraPayment}
              currency={currency}
              onAccept={setExtraPayment}
            />
          </div>

          {/* Strategy comparison */}
          {canCalculate && <ComparisonCards comparison={comparison} currency={currency} />}

          {/* Chart */}
          {canCalculate && (
            <DebtChart payoffPlan={payoffPlan} allDebts={allDebts} currency={currency} />
          )}

          {/* Payoff order */}
          {canCalculate && payoffPlan.debtPayoffOrder.length > 0 && (
            <div className="native-panel p-5">
              <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
                {t('payoffOrder.title')}
              </h3>
              <div className="space-y-2">
                {payoffPlan.debtPayoffOrder.map((item, i) => (
                  <div
                    key={item.id}
                    className="soft-divider flex items-center gap-3 border-b px-4 py-2 last:border-b-0"
                  >
                    <span className="bg-accent/20 text-accent flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold">
                      {i + 1}
                    </span>
                    <span className="flex-1 text-sm font-medium">{item.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {dayjs().add(item.paidOffMonth, 'month').format('MMM YYYY')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Debt list */}
          <div>
            <h3 className="text-muted-foreground mb-3 text-sm font-semibold tracking-wider uppercase">
              {t('debtList.title')}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {allDebts.map((d, i) => (
                <DebtCard
                  key={d.id}
                  debt={d}
                  currency={currency}
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
