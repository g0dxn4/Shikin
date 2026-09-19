import {
  useEffect,
  useState,
  useMemo,
  lazy,
  Suspense,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  ChevronDown,
  ChevronUp,
  ArchiveRestore,
  Archive,
  Star,
  CreditCard,
  Receipt,
} from 'lucide-react'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { ProgressBar } from '@/components/ui/progress-bar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { AccountMaintenanceAction } from '@/components/accounts/account-maintenance-dialog'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney, fromCentavos, toCentavos } from '@/lib/money'
import { CHART_AXIS_COLOR, CHART_TOOLTIP_STYLE } from '@/lib/constants'
import {
  buildAccountsLiquidTotals,
  type ConvertedTotal,
} from '@/lib/accounts-group-converted-totals'
import type { Account } from '@/types/database'
import dayjs from 'dayjs'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

function formatConverted(total: ConvertedTotal): string {
  if (!total.complete) return '—'
  return formatMoney(total.amountCentavos, total.preferredCurrency)
}

export function Accounts() {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')
  const { openAccountDialog } = useUIStore()
  const addTransaction = useTransactionStore((s) => s.add)
  const {
    accounts,
    archivedAccounts,
    isLoading,
    fetchError,
    fetch,
    remove,
    archive,
    unarchive,
    setPrimary,
  } = useAccountStore()
  const convertToPreferred = useCurrencyStore((s) => s.convertToPreferred)
  const getTotalBalanceInPreferred = useCurrencyStore((s) => s.getTotalBalanceInPreferred)
  const preferredCurrency = useCurrencyStore((s) => s.preferredCurrency)
  const rates = useCurrencyStore((s) => s.rates)
  const invalidRates = useCurrencyStore((s) => s.invalidRates)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [paymentCard, setPaymentCard] = useState<Account | null>(null)
  const [paymentSourceId, setPaymentSourceId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [isPayingCard, setIsPayingCard] = useState(false)

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const liquidAccounts = useMemo(
    () => accounts.filter((account) => account.type !== 'investment' && account.type !== 'crypto'),
    [accounts]
  )
  const archivedLiquidAccounts = useMemo(
    () =>
      archivedAccounts.filter(
        (account) => account.type !== 'investment' && account.type !== 'crypto'
      ),
    [archivedAccounts]
  )
  const investmentLikeAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'investment' || account.type === 'crypto'),
    [accounts]
  )
  const archivedInvestmentLikeAccounts = useMemo(
    () =>
      archivedAccounts.filter(
        (account) => account.type === 'investment' || account.type === 'crypto'
      ),
    [archivedAccounts]
  )

  useEffect(() => {
    if (archivedLiquidAccounts.length > 0 && liquidAccounts.length === 0) {
      setShowArchived(true)
    }
  }, [archivedLiquidAccounts.length, liquidAccounts.length])

  const separatedInvestmentAccountCount =
    investmentLikeAccounts.length + archivedInvestmentLikeAccounts.length
  const depositAccounts = useMemo(
    () => liquidAccounts.filter((account) => account.type !== 'credit_card'),
    [liquidAccounts]
  )
  const pageTotals = useMemo(() => {
    // Currency actions are stable Zustand methods that read these mutable store fields.
    void rates
    void invalidRates
    return buildAccountsLiquidTotals({
      liquidAccounts,
      convertToPreferred,
      getTotalBalanceInPreferred: (accounts) => getTotalBalanceInPreferred(accounts as Account[]),
      preferredCurrency,
    })
  }, [
    liquidAccounts,
    convertToPreferred,
    getTotalBalanceInPreferred,
    preferredCurrency,
    rates,
    invalidRates,
  ])
  const primaryAccount = useMemo(
    () =>
      depositAccounts.find((account) => account.is_primary === 1) ??
      [...depositAccounts].sort((a, b) => b.balance - a.balance)[0] ??
      liquidAccounts[0],
    [depositAccounts, liquidAccounts]
  )
  const paymentSourceAccounts = useMemo(() => {
    if (!paymentCard) return []
    return depositAccounts.filter(
      (account) => account.currency === paymentCard.currency && account.balance > 0
    )
  }, [depositAccounts, paymentCard])
  const selectedPaymentSource = useMemo(
    () => paymentSourceAccounts.find((account) => account.id === paymentSourceId) ?? null,
    [paymentSourceAccounts, paymentSourceId]
  )

  const mixItems = useMemo(
    () => [
      { key: 'checking' as const, label: t('mix.checking'), total: pageTotals.mix.checking },
      { key: 'savings' as const, label: t('mix.savings'), total: pageTotals.mix.savings },
      { key: 'credit' as const, label: t('mix.credit'), total: pageTotals.mix.credit },
    ],
    [pageTotals.mix.checking, pageTotals.mix.credit, pageTotals.mix.savings, t]
  )
  const mixMax =
    pageTotals.mix.checking.complete &&
    pageTotals.mix.savings.complete &&
    pageTotals.mix.credit.complete
      ? Math.max(
          1,
          pageTotals.mix.checking.amountCentavos +
            pageTotals.mix.savings.amountCentavos +
            pageTotals.mix.credit.amountCentavos
        )
      : null

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleArchive = async () => {
    if (!archiveId) return
    setIsArchiving(true)
    try {
      await archive(archiveId)
      toast.success(t('toast.archived'))
      setArchiveId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      await unarchive(id)
      toast.success(t('toast.restored'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    }
  }

  const handleSetPrimary = async (id: string) => {
    setSettingPrimaryId(id)
    try {
      await setPrimary(id)
      toast.success('Primary account updated')
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setSettingPrimaryId(null)
    }
  }

  const closePaymentDialog = useCallback(() => {
    setPaymentCard(null)
    setPaymentSourceId('')
    setPaymentAmount('')
    setIsPayingCard(false)
  }, [])

  const openPaymentDialog = useCallback(
    (card: Account) => {
      const sources = depositAccounts.filter(
        (account) => account.currency === card.currency && account.balance > 0
      )
      const defaultSource =
        sources.find((account) => account.is_primary === 1) ??
        [...sources].sort((a, b) => b.balance - a.balance)[0]
      const debt = Math.max(0, -card.balance)
      const defaultAmount = defaultSource ? Math.min(debt, defaultSource.balance) : debt

      setPaymentCard(card)
      setPaymentSourceId(defaultSource?.id ?? '')
      setPaymentAmount(defaultAmount > 0 ? fromCentavos(defaultAmount).toFixed(2) : '')
    },
    [depositAccounts]
  )

  const handleCardPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!paymentCard) return

    const amount = Number(paymentAmount)
    const amountCentavos = Number.isFinite(amount) ? toCentavos(amount) : 0
    const cardDebt = Math.max(0, -paymentCard.balance)

    if (!selectedPaymentSource) {
      toast.error(t('credit.noSource'))
      return
    }

    if (selectedPaymentSource.currency !== paymentCard.currency) {
      toast.error(t('credit.paymentCurrencyMismatch'))
      return
    }

    if (amountCentavos <= 0 || amountCentavos > cardDebt) {
      toast.error(t('credit.paymentValidation'))
      return
    }

    if (amountCentavos > selectedPaymentSource.balance) {
      toast.error(t('credit.paymentInsufficientFunds'))
      return
    }

    setIsPayingCard(true)
    try {
      await addTransaction({
        amount,
        type: 'transfer',
        description: `${t('credit.paymentDescriptionPrefix')} ${paymentCard.name}`,
        categoryId: null,
        accountId: selectedPaymentSource.id,
        transferToAccountId: paymentCard.id,
        currency: paymentCard.currency,
        date: dayjs().format('YYYY-MM-DD'),
        notes: null,
      })
      toast.success(t('credit.paymentSuccess'))
      closePaymentDialog()
    } catch (error) {
      toast.error(getErrorMessage(error, t('credit.paymentError')))
    } finally {
      setIsPayingCard(false)
    }
  }

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const hasInitialLoadError = !!fetchError && accounts.length === 0

  return (
    <div className="page-content">
      <PageToolbar
        actions={
          <Button onClick={() => openAccountDialog()}>
            <Plus size={16} />
            {t('addAccount')}
          </Button>
        }
      />

      <ErrorBanner
        title="Couldn’t load account data"
        message={!hasInitialLoadError ? fetchError : null}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <AccountsSkeleton />
      ) : hasInitialLoadError ? (
        <ErrorState
          title="Couldn’t load your accounts"
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : accounts.length === 0 && archivedAccounts.length === 0 ? (
        <NativePanel className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl">
            <Landmark size={28} className="text-primary" />
          </div>
          <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={() => openAccountDialog()}>
            <Plus size={16} />
            {t('addAccount')}
          </Button>
        </NativePanel>
      ) : (
        <>
          {accounts.length > 0 ? (
            <>
              {pageTotals.conversionIssue ? (
                <div
                  className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-4 py-3 text-sm"
                  role="alert"
                >
                  <p className="font-semibold">{t('currency.unavailable')}</p>
                  <p className="text-muted-foreground mt-1">
                    {pageTotals.conversionIssue.reason === 'invalid_currency_data'
                      ? t('currency.invalidData')
                      : t('currency.missingRates', {
                          currencies: pageTotals.conversionIssue.missingCurrencies.join(', '),
                        })}
                  </p>
                  {pageTotals.groupedNet.length > 0 && (
                    <p className="text-muted-foreground mt-2 text-xs">
                      {t('currency.grouped')}:{' '}
                      {pageTotals.groupedNet
                        .map((group) => `${formatMoney(group.amountCentavos, group.currency)}`)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              ) : null}

              <MetricStrip>
                <MetricItem
                  label={t('metrics.net')}
                  value={formatConverted(pageTotals.net)}
                  detail={
                    pageTotals.net.complete
                      ? pageTotals.net.preferredCurrency
                      : t('currency.unavailable')
                  }
                />
                <MetricItem
                  label={t('metrics.assets')}
                  value={formatConverted(pageTotals.assets)}
                  detail={primaryAccount?.name}
                />
                <MetricItem
                  label={t('metrics.liabilities')}
                  value={formatConverted(pageTotals.liabilities)}
                  detail={t('mix.credit')}
                />
                <MetricItem
                  label={t('metrics.count')}
                  value={String(pageTotals.accountCount)}
                  detail={t('metrics.active', { count: liquidAccounts.length })}
                />
              </MetricStrip>

              <div className="flex flex-col gap-3">
                <NativePanel className="overflow-hidden p-0">
                  <div className="border-border flex flex-col gap-1 border-b px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{t('list.title')}</h2>
                      <p className="text-muted-foreground text-sm">{t('list.subtitle')}</p>
                    </div>
                    <p className="text-muted-foreground text-xs tabular-nums">
                      {t('metrics.active', { count: liquidAccounts.length })}
                    </p>
                  </div>
                  {liquidAccounts.length > 0 ? (
                    <div className="divide-border divide-y">
                      {liquidAccounts.map((account) => (
                        <AccountCard
                          key={account.id}
                          account={account}
                          isExpanded={expandedId === account.id}
                          onToggleExpand={() => toggleExpand(account.id)}
                          onEdit={() => openAccountDialog(account.id)}
                          onSetPrimary={() => handleSetPrimary(account.id)}
                          isSettingPrimary={settingPrimaryId === account.id}
                          onPayCreditCard={
                            account.type === 'credit_card' && account.balance < 0
                              ? () => openPaymentDialog(account)
                              : undefined
                          }
                          onArchive={() => setArchiveId(account.id)}
                          onDelete={() => setDeleteId(account.id)}
                          t={t}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-5 py-6">
                      <h3 className="text-sm font-semibold">{t('list.empty')}</h3>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('list.emptyDescription')}
                      </p>
                    </div>
                  )}
                </NativePanel>

                <NativePanel className="p-4 sm:px-5 sm:py-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-base font-semibold">{t('mix.title')}</h2>
                      <p className="text-muted-foreground mt-1 text-sm">{t('mix.subtitle')}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:text-right">
                      <div>
                        <p className="text-muted-foreground text-xs">{t('mix.spendable')}</p>
                        <p className="mt-0.5 text-sm font-semibold tabular-nums">
                          {formatConverted(pageTotals.assets)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground text-xs">{t('mix.cardDebt')}</p>
                        <p className="text-warning mt-0.5 text-sm font-semibold tabular-nums">
                          {formatConverted(pageTotals.liabilities)}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {mixItems.map((item) => (
                      <div key={item.key}>
                        <div className="mb-2 flex items-center justify-between gap-4">
                          <span className="text-sm font-medium">{item.label}</span>
                          <span className="text-sm font-semibold tabular-nums">
                            {formatConverted(item.total)}
                          </span>
                        </div>
                        <div className="bg-muted h-2 overflow-hidden rounded-full">
                          <div
                            className="bg-accent h-full rounded-full"
                            style={{
                              width: `${
                                mixMax && item.total.complete
                                  ? Math.max(
                                      item.total.amountCentavos > 0 ? 8 : 0,
                                      Math.min(
                                        100,
                                        Math.round((item.total.amountCentavos / mixMax) * 100)
                                      )
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </NativePanel>
              </div>

              {separatedInvestmentAccountCount > 0 && (
                <NativePanel className="p-5">
                  <h2 className="text-base font-semibold">{t('list.investmentsSeparate')}</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t('list.investmentsSeparateDescription', {
                      count: separatedInvestmentAccountCount,
                    })}
                  </p>
                </NativePanel>
              )}
            </>
          ) : (
            <NativePanel className="p-5">
              <h2 className="text-base font-semibold">{t('noActive.title')}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{t('noActive.description')}</p>
            </NativePanel>
          )}

          {archivedLiquidAccounts.length > 0 && (
            <NativePanel className="space-y-4 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t('archived.title')}</h2>
                  <p className="text-muted-foreground text-sm">{t('archived.description')}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between sm:w-auto sm:min-w-44"
                  onClick={() => setShowArchived((prev) => !prev)}
                  aria-expanded={showArchived}
                >
                  <span>{showArchived ? t('archived.hide') : t('archived.show')}</span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {archivedLiquidAccounts.length}
                  </span>
                </Button>
              </div>
              {showArchived && (
                <div className="divide-border border-border divide-y rounded-lg border">
                  {archivedLiquidAccounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      isExpanded={expandedId === account.id}
                      onToggleExpand={() => toggleExpand(account.id)}
                      onEdit={() => openAccountDialog(account.id)}
                      onSetPrimary={() => handleSetPrimary(account.id)}
                      isSettingPrimary={settingPrimaryId === account.id}
                      onArchive={() => handleRestore(account.id)}
                      onDelete={() => setDeleteId(account.id)}
                      archiveLabel={t('unarchiveAccount')}
                      archiveIcon={<ArchiveRestore size={12} />}
                      archived
                      t={t}
                    />
                  ))}
                </div>
              )}
            </NativePanel>
          )}
        </>
      )}

      <Suspense>
        <ConfirmDialog
          open={!!archiveId}
          onOpenChange={(open) => !open && setArchiveId(null)}
          title={t('archiveAccount')}
          description={t('archiveConfirm')}
          confirmLabel={t('archiveAccount')}
          cancelLabel={tCommon('actions.cancel')}
          isLoading={isArchiving}
          onConfirm={handleArchive}
        />
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteAccount')}
          description={t('deleteConfirm')}
          confirmLabel={tCommon('actions.delete')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>

      <Dialog
        open={!!paymentCard}
        onOpenChange={(open) => {
          if (!open) closePaymentDialog()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('credit.paymentTitle')}</DialogTitle>
            <DialogDescription>
              {paymentCard
                ? t('credit.paymentDescription', { card: paymentCard.name })
                : t('credit.paymentDescriptionEmpty')}
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleCardPayment}>
            <div className="space-y-2">
              <Label htmlFor="credit-payment-source">{t('credit.sourceAccount')}</Label>
              <Select
                value={paymentSourceId}
                onValueChange={setPaymentSourceId}
                disabled={paymentSourceAccounts.length === 0 || isPayingCard}
              >
                <SelectTrigger id="credit-payment-source">
                  <SelectValue placeholder={t('credit.sourceAccountPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {paymentSourceAccounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name} · {formatMoney(account.balance, account.currency)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {paymentSourceAccounts.length === 0 && (
                <p className="text-muted-foreground text-xs">{t('credit.noSource')}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="credit-payment-amount">{t('credit.amount')}</Label>
              <Input
                id="credit-payment-amount"
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={paymentAmount}
                onChange={(event) => setPaymentAmount(event.target.value)}
                disabled={isPayingCard || paymentSourceAccounts.length === 0}
              />
              {paymentCard && (
                <p className="text-muted-foreground text-xs">
                  {t('credit.paymentMax', {
                    amount: formatMoney(Math.max(0, -paymentCard.balance), paymentCard.currency),
                  })}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={closePaymentDialog}
                disabled={isPayingCard}
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button type="submit" disabled={isPayingCard || paymentSourceAccounts.length === 0}>
                {isPayingCard ? t('credit.paymentSaving') : t('credit.confirmPayment')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function AccountCard({
  account,
  isExpanded,
  onToggleExpand,
  onEdit,
  onSetPrimary,
  isSettingPrimary = false,
  onPayCreditCard,
  onArchive,
  onDelete,
  archiveLabel,
  archiveIcon,
  archived = false,
  t,
}: {
  account: Account
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onSetPrimary?: () => void
  isSettingPrimary?: boolean
  onPayCreditCard?: () => void
  onArchive: () => void
  onDelete: () => void
  archiveLabel?: string
  archiveIcon?: ReactNode
  archived?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}) {
  const { loadBalanceHistory, balanceHistory } = useAccountStore()
  const [historyLoading, setHistoryLoading] = useState(
    isExpanded && !balanceHistory.get(account.id)
  )

  const accentColor = account.color || 'var(--color-accent)'
  const isCreditCard = account.type === 'credit_card'
  const canSetPrimary =
    !archived && !isCreditCard && account.type !== 'investment' && account.type !== 'crypto'
  const isPrimary = account.is_primary === 1
  const creditLimit = isCreditCard && account.credit_limit ? account.credit_limit : null
  const availableCredit = creditLimit === null ? null : creditLimit - Math.abs(account.balance)
  const utilization =
    creditLimit !== null
      ? Math.min(100, Math.round((Math.abs(account.balance) / creditLimit) * 100))
      : null

  const history = balanceHistory.get(account.id)

  useEffect(() => {
    if (!isExpanded || history) return
    loadBalanceHistory(account.id, 6)
      .catch(() => {})
      .finally(() => setHistoryLoading(false))
  }, [isExpanded, history, account.id, loadBalanceHistory])

  const chartData = useMemo(() => {
    if (!history || history.length === 0) return []
    return history.map((p) => ({
      date: p.date,
      balance: fromCentavos(p.balance),
    }))
  }, [history])

  return (
    <article
      className={`group relative px-5 py-4 ${archived ? 'bg-muted/30' : ''}`}
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{account.name}</h3>
            <Badge variant="secondary" className="text-xs">
              {t(`types.${account.type}`)}
            </Badge>
            {isPrimary && (
              <Badge variant="outline" className="text-accent border-accent/40 text-xs">
                Primary
              </Badge>
            )}
            {archived && (
              <Badge variant="outline" className="text-xs">
                {t('archived.badge')}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-end sm:gap-4">
          <div className="sm:text-right">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">
              {formatMoney(account.balance, account.currency)}
            </p>
            <p className="text-muted-foreground mt-1 text-xs tabular-nums">{account.currency}</p>
          </div>
          <div className="flex gap-1 opacity-100 transition-opacity md:opacity-40 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            {canSetPrimary && onSetPrimary && (
              <Button
                variant="ghost"
                size="icon"
                onClick={onSetPrimary}
                disabled={isPrimary || isSettingPrimary}
                aria-label={
                  isPrimary ? `${account.name} is primary` : `Set ${account.name} as primary`
                }
              >
                <Star size={12} className={isPrimary ? 'fill-accent text-accent' : ''} />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={onArchive}
              aria-label={`${archiveLabel ?? t('archiveAccount')} ${account.name}`}
            >
              {archiveIcon ?? <Archive size={12} />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={onEdit}
              aria-label={`Edit ${account.name}`}
            >
              <Pencil size={12} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label={`Delete ${account.name}`}
            >
              <Trash2 size={12} />
            </Button>
          </div>
        </div>
      </div>

      {isCreditCard && creditLimit !== null && (
        <div className="bg-muted/40 border-border mt-4 grid grid-cols-3 gap-2 rounded-lg border p-3">
          <div>
            <p className="text-muted-foreground text-xs">{t('credit.limit')}</p>
            <p className="mt-1 text-xs font-semibold tabular-nums">
              {formatMoney(creditLimit, account.currency)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('credit.available')}</p>
            <p
              className={`mt-1 text-xs font-semibold tabular-nums ${availableCredit !== null && availableCredit < 0 ? 'text-destructive' : 'text-success'}`}
            >
              {formatMoney(availableCredit ?? 0, account.currency)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('credit.dates')}</p>
            <p className="mt-1 text-xs font-semibold tabular-nums">
              {account.statement_closing_day ? `C ${account.statement_closing_day}` : 'C --'} /{' '}
              {account.payment_due_day ? `D ${account.payment_due_day}` : 'D --'}
            </p>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="min-h-11" asChild>
          <Link to={`/transactions?account=${account.id}`}>
            <Receipt size={14} />
            {t('viewTransactions')}
          </Link>
        </Button>
        <AccountMaintenanceAction account={account} />
        {isCreditCard && onPayCreditCard && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11"
            onClick={onPayCreditCard}
            aria-label={`Pay ${account.name}`}
          >
            <CreditCard size={14} />
            {t('credit.pay')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-11"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
        >
          <TrendingUp size={14} />
          {isExpanded ? t('history.hide') : t('history.show')}
          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </Button>
      </div>

      {utilization !== null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground text-xs">{t('utilization.label')}</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`text-xs font-medium tabular-nums ${
                  utilization > 75
                    ? 'text-destructive'
                    : utilization > 50
                      ? 'text-warning'
                      : 'text-success'
                }`}
              >
                {utilization}%
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                  utilization > 75
                    ? 'bg-destructive/10 text-destructive'
                    : utilization > 50
                      ? 'bg-warning/10 text-warning'
                      : 'bg-success/10 text-success'
                }`}
              >
                {utilization > 75
                  ? t('utilization.high')
                  : utilization > 50
                    ? t('utilization.moderate')
                    : t('utilization.low')}
              </span>
            </span>
          </div>
          <ProgressBar
            value={utilization}
            size="sm"
            color={utilization > 75 ? 'destructive' : utilization > 50 ? 'warning' : 'success'}
            ariaLabel={t('utilization.label')}
          />
        </div>
      )}

      {isExpanded && (
        <div className="border-border mt-3 border-t pt-3 pb-1">
          {historyLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : chartData.length > 1 ? (
            <div
              className="h-32"
              role="img"
              aria-label={`${t('history.show')} for ${account.name}`}
            >
              <span className="sr-only">
                {chartData
                  .map((d) => `${dayjs(d.date).format('MMM D')}: ${formatMoney(d.balance)}`)
                  .join(', ')}
              </span>
              <SafeChart>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id={`grad-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={accentColor} stopOpacity={0.28} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                    tickFormatter={(d) => dayjs(d).format('M/D')}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: CHART_AXIS_COLOR, fontSize: 11 }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`)}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={CHART_TOOLTIP_STYLE}
                    labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                    formatter={(value) => [
                      formatMoney(toCentavos(Number(value)), account.currency),
                      t('history.show'),
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
                    isAnimationActive={false}
                    stroke={accentColor}
                    strokeWidth={2}
                    fill={`url(#grad-${account.id})`}
                  />
                </AreaChart>
              </SafeChart>
            </div>
          ) : (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground text-xs">
                {chartData.length === 1 ? t('history.empty') : t('history.none')}
              </p>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function AccountsSkeleton() {
  return (
    <>
      <div className="metric-strip">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric-item space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <NativePanel className="space-y-3 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-8 w-32" />
            </div>
          ))}
        </NativePanel>
        <NativePanel className="space-y-3 p-4 sm:px-5 sm:py-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </NativePanel>
      </div>
    </>
  )
}
