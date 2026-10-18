import { Input } from '@/components/ui/input'
import { PageToolbar, MetricStrip, MetricItem, NativePanel } from '@/components/ui/native-layout'
import { ErrorBanner } from '@/components/ui/error-banner'
import { DebtTrajectoryChart } from '@/components/planning-scenarios/debt-trajectory-chart'
import { useAccountStore } from '@/stores/account-store'
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Target, Plus, Trash2, Zap, Snowflake, ChevronDown, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebtStore, type DebtStrategy } from '@/stores/debt-store'
import { formatMoney, toCentavos, fromCentavos } from '@/lib/money'
import { cn } from '@/lib/utils'
import {
  calculatePayoffPlan,
  compareStrategies,
  type Debt,
  type PayoffPlan,
  type StrategyComparison,
} from '@/lib/debt-service'
import dayjs from 'dayjs'

const EXTRA_PAYMENT_ERROR_ID = 'extra-payment-error'

const FIELD_CLASS =
  'h-11 min-h-11 w-full rounded-lg border border-border bg-muted/50 px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

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

function debtFreeLabel(plan: PayoffPlan, notRepaid: string): string {
  return plan.schedule[plan.schedule.length - 1]?.totalBalance
    ? notRepaid
    : dayjs().add(plan.months, 'month').format('MMM YYYY')
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
    <div className="min-w-0">
      <h3 className="text-muted-foreground mb-1.5 text-[11px] font-semibold tracking-wide uppercase">
        {t('strategy.title')}
      </h3>
      <div className="flex min-w-0 flex-row gap-2" role="group" aria-label={t('strategy.title')}>
        <button
          type="button"
          onClick={() => onToggle('avalanche')}
          aria-pressed={strategy === 'avalanche'}
          className={cn(
            'focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center focus-visible:ring-2 focus-visible:outline-none',
            strategy === 'avalanche'
              ? 'border-chart-1 bg-muted text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          <Zap
            size={16}
            aria-hidden="true"
            className={
              strategy === 'avalanche' ? 'text-chart-1 shrink-0' : 'text-muted-foreground shrink-0'
            }
          />
          <span
            className={cn(
              'min-w-0 text-sm leading-tight font-semibold',
              strategy === 'avalanche' ? 'text-chart-1' : 'text-muted-foreground'
            )}
          >
            {t('strategy.avalanche')}
          </span>
        </button>
        <button
          type="button"
          onClick={() => onToggle('snowball')}
          aria-pressed={strategy === 'snowball'}
          className={cn(
            'focus-visible:ring-ring flex min-h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-center focus-visible:ring-2 focus-visible:outline-none',
            strategy === 'snowball'
              ? 'border-chart-3 bg-muted text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          <Snowflake
            size={16}
            aria-hidden="true"
            className={
              strategy === 'snowball' ? 'text-chart-3 shrink-0' : 'text-muted-foreground shrink-0'
            }
          />
          <span
            className={cn(
              'min-w-0 text-sm leading-tight font-semibold',
              strategy === 'snowball' ? 'text-chart-3' : 'text-muted-foreground'
            )}
          >
            {t('strategy.snowball')}
          </span>
        </button>
      </div>
    </div>
  )
}

function DebtMethod() {
  const { t } = useTranslation('debtPayoff')
  return (
    <details className="min-w-0">
      <summary className="focus-visible:ring-ring text-accent inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md text-xs font-semibold focus-visible:ring-2 focus-visible:outline-none">
        <Info size={14} aria-hidden="true" />
        {t('method.summary')}
      </summary>
      <div className="text-muted-foreground space-y-1.5 pb-1 text-xs break-words">
        <p>{t('hero.disclaimer')}</p>
        <p>
          <span className="text-foreground font-medium">{t('strategy.avalanche')}: </span>
          {t('strategy.avalancheDesc')}
        </p>
        <p>
          <span className="text-foreground font-medium">{t('strategy.snowball')}: </span>
          {t('strategy.snowballDesc')}
        </p>
        <p>
          <span className="text-foreground font-medium">{t('extraPayment.title')}: </span>
          {t('extraPayment.description')}
        </p>
        <p>{t('scope.manual')}</p>
      </div>
    </details>
  )
}

function ComparisonStrip({
  comparison,
  currency,
}: {
  comparison: StrategyComparison
  currency: string
}) {
  const { t } = useTranslation('debtPayoff')
  const notRepaid = t('summary.notRepaid')
  const { snowball, avalanche, interestSaved, monthsDifference } = comparison

  return (
    <MetricStrip className="min-w-0">
      <MetricItem
        label={t('comparison.avalancheMonths')}
        value={
          <span className="text-chart-1 break-all">
            {avalanche.months} {t('comparison.months')}
          </span>
        }
        detail={
          <span className="break-words tabular-nums">
            {formatMoney(avalanche.totalInterestPaid, currency)}
            {' · '}
            {debtFreeLabel(avalanche, notRepaid)}
          </span>
        }
      />
      <MetricItem
        label={t('comparison.snowballMonths')}
        value={
          <span className="text-chart-3 break-all">
            {snowball.months} {t('comparison.months')}
          </span>
        }
        detail={
          <span className="break-words tabular-nums">
            {formatMoney(snowball.totalInterestPaid, currency)}
            {' · '}
            {debtFreeLabel(snowball, notRepaid)}
          </span>
        }
      />
      <MetricItem
        label={t('comparison.interestSaved')}
        value={
          <span className="text-success break-all">
            {formatMoney(Math.abs(interestSaved), currency)}
          </span>
        }
        detail={
          monthsDifference !== 0
            ? `${Math.abs(monthsDifference)} ${t('comparison.fewerMonths')}`
            : t('comparison.sameTimeline')
        }
      />
    </MetricStrip>
  )
}

function DebtSupport({
  debts,
  payoffPlan,
  currency,
  manualIds,
  showOrder,
  onRemove,
}: {
  debts: Debt[]
  payoffPlan: PayoffPlan | null
  currency: string
  manualIds: Set<string>
  showOrder: boolean
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation('debtPayoff')
  const { t: tCommon } = useTranslation('common')

  return (
    <NativePanel className="min-w-0 p-4 sm:p-5" aria-labelledby="debt-support-heading">
      {showOrder && payoffPlan && payoffPlan.debtPayoffOrder.length > 0 ? (
        <div className="mb-5">
          <h2 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {t('payoffOrder.title')}
          </h2>
          <ol className="mt-2">
            {payoffPlan.debtPayoffOrder.map((item, index) => (
              <li
                key={item.id}
                className="border-border flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b py-2.5 last:border-b-0"
              >
                <span className="text-muted-foreground w-5 text-xs tabular-nums">{index + 1}</span>
                <span className="min-w-0 flex-1 text-sm font-medium break-words">{item.name}</span>
                <span className="text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                  {dayjs().add(item.paidOffMonth, 'month').format('MMM YYYY')}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <h2
        id="debt-support-heading"
        className="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
      >
        {t('debtList.title')}
      </h2>
      <ul className="mt-2">
        {debts.map((debt) => {
          const isManual = manualIds.has(debt.id)
          return (
            <li
              key={debt.id}
              className="border-border flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b py-3 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium break-words">{debt.name}</p>
                <p className="text-muted-foreground mt-0.5 text-xs break-words">
                  {t('debtCard.apr')}: {debt.apr.toFixed(1)}%{' · '}
                  {t('debtCard.minPayment')}: {formatMoney(debt.minPayment, currency)}
                </p>
              </div>
              <p className="text-sm font-medium whitespace-nowrap tabular-nums">
                {formatMoney(debt.balance, currency)}
              </p>
              {isManual ? (
                <Badge variant="secondary" className="text-[10px]">
                  {t('debtCard.manual')}
                </Badge>
              ) : null}
              {isManual ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive h-11 w-11 shrink-0"
                  onClick={() => onRemove(debt.id)}
                  aria-label={tCommon('actions.delete')}
                >
                  <Trash2 size={14} />
                </Button>
              ) : null}
            </li>
          )
        })}
      </ul>
    </NativePanel>
  )
}

function AddDebtForm({
  onAdd,
}: {
  onAdd: (debt: { name: string; balance: number; apr: number; minPayment: number }) => void
}) {
  const { t } = useTranslation('debtPayoff')
  const { t: tCommon } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [balance, setBalance] = useState('')
  const [apr, setApr] = useState('')
  const [minPayment, setMinPayment] = useState('')

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
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
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="min-h-11 w-full border-dashed"
      >
        <Plus size={16} />
        {t('addDebt.button')}
      </Button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="native-panel min-w-0 space-y-3 p-4">
      <p className="text-muted-foreground text-xs">{t('scope.manual')}</p>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t('addDebt.title')}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-11 w-11 shrink-0"
          onClick={() => setOpen(false)}
          aria-label={tCommon('actions.cancel')}
        >
          <ChevronDown size={16} />
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="add-debt-name" className="text-muted-foreground mb-1 block text-xs">
            {t('addDebt.name')}
          </label>
          <Input
            id="add-debt-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('addDebt.namePlaceholder')}
            className={FIELD_CLASS}
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
            onChange={(event) => setBalance(event.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="5000.00"
            className={FIELD_CLASS}
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
            onChange={(event) => setApr(event.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="24.99"
            className={FIELD_CLASS}
          />
        </div>
        <div className="sm:col-span-2">
          <label
            htmlFor="add-debt-min-payment"
            className="text-muted-foreground mb-1 block text-xs"
          >
            {t('addDebt.minPayment')}
          </label>
          <Input
            id="add-debt-min-payment"
            value={minPayment}
            onChange={(event) => setMinPayment(event.target.value)}
            type="number"
            step="0.01"
            min="0"
            placeholder="25.00"
            className={FIELD_CLASS}
          />
        </div>
      </div>
      <Button type="submit" className="min-h-11 w-full">
        <Plus size={14} />
        {t('addDebt.submit')}
      </Button>
    </form>
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
    <div className="min-w-0">
      <h3 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
        {t('extraPayment.title')}
      </h3>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          className="text-foreground placeholder:text-muted-foreground h-11 min-h-11 w-full min-w-32 flex-1 text-base font-medium tabular-nums sm:w-auto"
        />
        <span className="text-muted-foreground text-sm">{t('extraPayment.perMonth')}</span>
      </div>
      {invalid ? (
        <p id={EXTRA_PAYMENT_ERROR_ID} className="text-destructive mt-2 text-xs" role="alert">
          {t('extraPayment.invalid')}
        </p>
      ) : null}
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
  const payoffPlan = canCalculate ? calculatePayoffPlan(allDebts, strategy, extraPayment) : null
  const comparison = canCalculate ? compareStrategies(allDebts, extraPayment) : null
  const selectedTotal = allDebts.reduce((sum, debt) => sum + debt.balance, 0)
  const selectedMinimum = allDebts.reduce((sum, debt) => sum + debt.minPayment, 0)
  const notRepaidLabel = t('summary.notRepaid')
  const notRepaid = Boolean(payoffPlan?.schedule[payoffPlan.schedule.length - 1]?.totalBalance)
  const manualIds = new Set(manualDebts.map((debt) => debt.id))

  return (
    <div className="page-content min-w-0">
      <PageToolbar
        leading={
          <label className="text-muted-foreground flex w-full min-w-0 flex-col gap-1 text-xs sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <span>{t('scope.currency')}</span>
            <select
              className="border-input bg-surface text-foreground focus-visible:ring-ring min-h-11 w-full min-w-0 rounded-lg border px-3 focus-visible:ring-2 focus-visible:outline-none sm:w-auto"
              value={currency}
              onChange={(event) => setSelectedCurrency(event.target.value)}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
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
        <p role="status" className="text-warning text-xs break-words">
          {t('scope.unknown')}{' '}
          {debts
            .filter((debt) => !currencyFor(debt))
            .map((debt) => debt.name)
            .join(', ')}
        </p>
      )}

      {isLoading || accountsLoading ? (
        <div className="space-y-3" role="status" aria-busy="true">
          <span className="sr-only">{tCommon('status.loading')}</span>
          <NativePanel className="space-y-4 p-4 sm:p-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-10 w-48 max-w-full" />
            <Skeleton className="h-56 w-full" />
            <div className="flex flex-col gap-2 sm:flex-row">
              <Skeleton className="h-11 flex-1" />
              <Skeleton className="h-11 flex-1" />
            </div>
          </NativePanel>
        </div>
      ) : !hasDebts ? (
        <div className="space-y-4">
          <NativePanel className="flex flex-col items-center justify-center px-4 py-16 text-center">
            <div
              className="bg-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl"
              aria-hidden="true"
            >
              <Target size={28} className="text-accent" />
            </div>
            <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground max-w-md text-sm break-words">
              {t('empty.description')}
            </p>
          </NativePanel>
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
        <div className="space-y-3">
          <NativePanel data-testid="debt-scenario" className="min-w-0 p-3 sm:p-5">
            <ul className="mb-2 flex min-w-0 flex-wrap gap-1.5" aria-label={t('chips.label')}>
              <li className="border-border bg-muted text-foreground inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium break-words">
                {t('scope.description')}
              </li>
              <li className="border-border bg-muted text-foreground inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium">
                <span className="sr-only">{t('scope.currency')} </span>
                {currency}
              </li>
              <li className="border-warning/40 text-warning inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium">
                {t('chips.notGuaranteed')}
              </li>
              {canCalculate && payoffPlan ? (
                <li className="border-border bg-muted inline-flex max-w-full items-center rounded-md border px-2 py-0.5 text-[11px] font-medium">
                  {t(`strategy.${strategy}`)}
                </li>
              ) : null}
            </ul>

            {canCalculate && payoffPlan ? (
              <DebtTrajectoryChart
                payoffPlan={payoffPlan}
                debts={allDebts}
                currency={currency}
                strategy={strategy}
              />
            ) : null}

            {canCalculate && payoffPlan ? (
              <div className="mt-3 flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t('summary.debtFreeDate')}
                  </p>
                  <p
                    className={cn(
                      'font-medium tracking-tight tabular-nums',
                      notRepaid
                        ? 'text-warning text-lg break-words'
                        : 'max-w-full overflow-x-auto text-2xl whitespace-nowrap'
                    )}
                  >
                    {debtFreeLabel(payoffPlan, notRepaidLabel)}
                  </p>
                </div>
                <div className="min-w-0">
                  <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                    {t('summary.totalDebt')}
                  </span>
                  <strong className="mt-0.5 block max-w-full overflow-x-auto text-lg font-medium whitespace-nowrap tabular-nums">
                    {formatMoney(selectedTotal, currency)}
                  </strong>
                </div>
              </div>
            ) : null}
            {canCalculate && payoffPlan ? (
              <p className="text-muted-foreground mt-1 text-xs break-words tabular-nums">
                {t(`strategy.${strategy}`)}
                {notRepaid ? '' : ` · ${payoffPlan.months} ${t('comparison.months')}`}
                {' · '}
                {t('summary.totalInterest')}: {formatMoney(payoffPlan.totalInterestPaid, currency)}
                {' · '}
                {t('summary.monthlyMin')}: {formatMoney(selectedMinimum, currency)}
              </p>
            ) : null}

            <div
              className={cn(
                'grid min-w-0 gap-3',
                canCalculate && payoffPlan ? 'border-border mt-3 border-t pt-3' : '',
                'lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]'
              )}
            >
              <StrategyToggle strategy={strategy} onToggle={setStrategy} />
              <ExtraPaymentInput
                extraPayment={extraPayment}
                currency={currency}
                onAccept={setExtraPayment}
              />
            </div>
            <div className="mt-2">
              <DebtMethod />
            </div>
          </NativePanel>

          {canCalculate && comparison ? (
            <ComparisonStrip comparison={comparison} currency={currency} />
          ) : null}

          <DebtSupport
            debts={allDebts}
            payoffPlan={payoffPlan}
            currency={currency}
            manualIds={manualIds}
            showOrder={canCalculate}
            onRemove={removeDebt}
          />

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
