import {
  useEffect,
  useState,
  useMemo,
  useRef,
  lazy,
  Suspense,
  useCallback,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Landmark, Plus, EllipsisVertical } from 'lucide-react'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { ActionDisclosure, type ActionDisclosureItem } from '@/components/ui/action-disclosure'
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
import { AccountMaintenanceDialog } from '@/components/accounts/account-maintenance-dialog'
import { AccountSparkline } from '@/components/accounts/account-sparkline'
import { buildLiquidComposition } from '@/components/accounts/account-composition'
import {
  canDrawHistory,
  type AccountHistoryPoint,
} from '@/components/accounts/account-history-batch'
import { CardStatementsDialog } from '@/components/accounts/card-statements-dialog'
import { LiquidCompositionPanel } from '@/components/accounts/liquid-composition-panel'
import { useAccountHistoryBatch } from '@/components/accounts/use-account-history-batch'
import {
  ACCOUNT_RAIL_WIDTH_PX,
  ACCOUNT_TYPE_ICONS,
  accountIconAccentStyle,
  accountRailColor,
} from '@/components/accounts/account-visuals'
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

function isInvestmentLike(account: Pick<Account, 'type'>): boolean {
  return account.type === 'investment' || account.type === 'crypto'
}

function findExactAccount(
  accountId: string,
  groups: {
    liquid: Account[]
    archivedLiquid: Account[]
    investments: Account[]
    archivedInvestments: Account[]
  }
): {
  account: Account
  group: 'liquid' | 'archivedLiquid' | 'investment' | 'archivedInvestment'
} | null {
  const liquid = groups.liquid.find((account) => account.id === accountId)
  if (liquid) return { account: liquid, group: 'liquid' }
  const archivedLiquid = groups.archivedLiquid.find((account) => account.id === accountId)
  if (archivedLiquid) return { account: archivedLiquid, group: 'archivedLiquid' }
  const investment = groups.investments.find((account) => account.id === accountId)
  if (investment) return { account: investment, group: 'investment' }
  const archivedInvestment = groups.archivedInvestments.find((account) => account.id === accountId)
  if (archivedInvestment) return { account: archivedInvestment, group: 'archivedInvestment' }
  return null
}

export function Accounts() {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')
  const [searchParams] = useSearchParams()
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
  const convertToPreferred = useCurrencyStore((s) => s.convertCurrentToPreferred)
  const getTotalBalanceInPreferred = useCurrencyStore((s) => s.getTotalBalanceInPreferred)
  const preferredCurrency = useCurrencyStore((s) => s.preferredCurrency)
  const mainCurrency = useCurrencyStore((s) => s.mainCurrency)
  const manualRates = useCurrencyStore((s) => s.manualRates)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [showInvestments, setShowInvestments] = useState(false)
  const [accountsReady, setAccountsReady] = useState(false)
  const [accountLinkStatus, setAccountLinkStatus] = useState<'idle' | 'found' | 'missing'>('idle')
  const focusedLinkId = useRef<string | null>(null)
  const [paymentCard, setPaymentCard] = useState<Account | null>(null)
  const [paymentSourceId, setPaymentSourceId] = useState('')
  const [paymentAmount, setPaymentAmount] = useState('')
  const [isPayingCard, setIsPayingCard] = useState(false)
  const requestedAccountId = searchParams.get('account')?.trim() || null
  const requestedAccountIdRef = useRef(requestedAccountId)
  requestedAccountIdRef.current = requestedAccountId

  useEffect(() => {
    let cancelled = false
    void fetch()
      .catch(() => {})
      .finally(() => {
        if (!cancelled && requestedAccountIdRef.current) setAccountsReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [fetch])

  const liquidAccounts = useMemo(
    () => accounts.filter((account) => !isInvestmentLike(account)),
    [accounts]
  )
  const archivedLiquidAccounts = useMemo(
    () => archivedAccounts.filter((account) => !isInvestmentLike(account)),
    [archivedAccounts]
  )
  const investmentLikeAccounts = useMemo(
    () => accounts.filter((account) => isInvestmentLike(account)),
    [accounts]
  )
  const archivedInvestmentLikeAccounts = useMemo(
    () => archivedAccounts.filter((account) => isInvestmentLike(account)),
    [archivedAccounts]
  )

  useEffect(() => {
    if (archivedLiquidAccounts.length > 0 && liquidAccounts.length === 0) {
      setShowArchived(true)
    }
  }, [archivedLiquidAccounts.length, liquidAccounts.length])

  useEffect(() => {
    if (
      investmentLikeAccounts.length + archivedInvestmentLikeAccounts.length > 0 &&
      liquidAccounts.length === 0 &&
      archivedLiquidAccounts.length === 0
    ) {
      setShowInvestments(true)
    }
  }, [
    archivedInvestmentLikeAccounts.length,
    archivedLiquidAccounts.length,
    investmentLikeAccounts.length,
    liquidAccounts.length,
  ])

  useEffect(() => {
    if (!requestedAccountId) {
      focusedLinkId.current = null
      setAccountLinkStatus('idle')
      return
    }
    if (!accountsReady) return

    const match = findExactAccount(requestedAccountId, {
      liquid: liquidAccounts,
      archivedLiquid: archivedLiquidAccounts,
      investments: investmentLikeAccounts,
      archivedInvestments: archivedInvestmentLikeAccounts,
    })
    if (!match) {
      setAccountLinkStatus('missing')
      return
    }
    setAccountLinkStatus('found')
    if (match.group === 'archivedLiquid') setShowArchived(true)
    if (match.group === 'investment' || match.group === 'archivedInvestment') {
      setShowInvestments(true)
    }
  }, [
    accountsReady,
    archivedInvestmentLikeAccounts,
    archivedLiquidAccounts,
    investmentLikeAccounts,
    liquidAccounts,
    requestedAccountId,
  ])

  useEffect(() => {
    if (accountLinkStatus !== 'found' || !requestedAccountId) return
    if (focusedLinkId.current === requestedAccountId) return
    const element = document.getElementById(`account-${requestedAccountId}`)
    if (!element) return
    element.scrollIntoView?.({ block: 'nearest' })
    element.focus()
    focusedLinkId.current = requestedAccountId
  }, [accountLinkStatus, requestedAccountId, showArchived, showInvestments])

  const separatedInvestmentAccountCount =
    investmentLikeAccounts.length + archivedInvestmentLikeAccounts.length
  const depositAccounts = useMemo(
    () => liquidAccounts.filter((account) => account.type !== 'credit_card'),
    [liquidAccounts]
  )
  const pageTotals = useMemo(() => {
    // Currency actions are stable Zustand methods that read current store authority.
    void manualRates
    return buildAccountsLiquidTotals({
      liquidAccounts,
      convertToPreferred,
      getTotalBalanceInPreferred: (accounts) => getTotalBalanceInPreferred(accounts as Account[]),
      preferredCurrency,
      mainCurrency,
    })
  }, [
    liquidAccounts,
    convertToPreferred,
    getTotalBalanceInPreferred,
    preferredCurrency,
    mainCurrency,
    manualRates,
  ])
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

  const composition = useMemo(
    () =>
      buildLiquidComposition({
        accounts: liquidAccounts.map((account) => ({
          id: account.id,
          type: account.type,
          currency: account.currency,
          balance: account.balance,
        })),
        convertToPreferred,
        authorityNet: pageTotals.net,
        groupedNet: pageTotals.groupedNet,
      }),
    [convertToPreferred, liquidAccounts, pageTotals.groupedNet, pageTotals.net]
  )
  const historyAccountIds = useMemo(() => {
    const ids = liquidAccounts.map((account) => account.id)
    if (showArchived) ids.push(...archivedLiquidAccounts.map((account) => account.id))
    if (showInvestments) {
      ids.push(
        ...investmentLikeAccounts.map((account) => account.id),
        ...archivedInvestmentLikeAccounts.map((account) => account.id)
      )
    }
    return ids
  }, [
    archivedInvestmentLikeAccounts,
    archivedLiquidAccounts,
    investmentLikeAccounts,
    liquidAccounts,
    showArchived,
    showInvestments,
  ])
  const historyRefreshKey = useMemo(
    () =>
      [
        ...liquidAccounts,
        ...(showArchived ? archivedLiquidAccounts : []),
        ...(showInvestments ? investmentLikeAccounts : []),
        ...(showInvestments ? archivedInvestmentLikeAccounts : []),
      ]
        .map((account) => `${account.id}:${account.balance}`)
        .join('|'),
    [
      archivedInvestmentLikeAccounts,
      archivedLiquidAccounts,
      investmentLikeAccounts,
      liquidAccounts,
      showArchived,
      showInvestments,
    ]
  )
  const historyBatch = useAccountHistoryBatch(historyAccountIds, historyRefreshKey)

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
      toast.success(t('toast.primaryUpdated'))
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

      {accountLinkStatus === 'missing' ? (
        <div className="border-border bg-muted/40 rounded-lg border px-4 py-3 text-sm" role="alert">
          {t('link.unknown')}
        </div>
      ) : null}

      {isLoading && accounts.length === 0 && archivedAccounts.length === 0 ? (
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
            <Landmark size={28} className="text-accent" />
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
                    {pageTotals.conversionIssue.reason === 'main_currency_unconfigured'
                      ? t('currency.setupRequired')
                      : pageTotals.conversionIssue.reason === 'invalid_currency_data'
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
                      ? t('metrics.netDetail', {
                          currency: pageTotals.net.preferredCurrency,
                        })
                      : t('currency.unavailable')
                  }
                />
                <MetricItem
                  label={t('metrics.assets')}
                  value={formatConverted(pageTotals.assets)}
                  detail={
                    pageTotals.assets.complete
                      ? t('metrics.assetsDetail', {
                          currency: pageTotals.assets.preferredCurrency,
                        })
                      : t('currency.unavailable')
                  }
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

              <div className="flex min-w-0 flex-col gap-3">
                <section className="min-w-0" aria-labelledby="accounts-collection-heading">
                  <h2 id="accounts-collection-heading" className="sr-only">
                    {t('list.title')}
                  </h2>
                  {liquidAccounts.length > 0 ? (
                    <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                      {liquidAccounts.map((account) => (
                        <AccountCard
                          key={account.id}
                          account={account}
                          linked={requestedAccountId === account.id}
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
                          historyPoints={historyBatch.series.get(account.id)}
                          historyStatus={historyBatch.status}
                          t={t}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="px-1 py-2">
                      <h3 className="text-sm font-semibold">{t('list.empty')}</h3>
                      <p className="text-muted-foreground mt-1 text-sm">
                        {t('list.emptyDescription')}
                      </p>
                    </div>
                  )}
                </section>
                <LiquidCompositionPanel model={composition} t={t} />
              </div>
            </>
          ) : (
            <NativePanel className="p-5">
              <h2 className="text-base font-semibold">{t('noActive.title')}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{t('noActive.description')}</p>
            </NativePanel>
          )}

          {separatedInvestmentAccountCount > 0 && (
            <NativePanel className="space-y-4 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold">{t('list.investmentsSeparate')}</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t('list.investmentsSeparateDescription', {
                      count: separatedInvestmentAccountCount,
                    })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-11 w-full justify-between sm:w-auto sm:min-w-44"
                  onClick={() => setShowInvestments((prev) => !prev)}
                  aria-expanded={showInvestments}
                >
                  <span>
                    {showInvestments ? t('list.investmentsHide') : t('list.investmentsShow')}
                  </span>
                  <span className="text-muted-foreground ml-2 text-xs">
                    {separatedInvestmentAccountCount}
                  </span>
                </Button>
              </div>
              {showInvestments ? (
                <div className="space-y-3">
                  {investmentLikeAccounts.length > 0 ? (
                    <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                      {investmentLikeAccounts.map((account) => (
                        <AccountCard
                          key={account.id}
                          account={account}
                          linked={requestedAccountId === account.id}
                          isExpanded={expandedId === account.id}
                          onToggleExpand={() => toggleExpand(account.id)}
                          onEdit={() => openAccountDialog(account.id)}
                          onSetPrimary={() => handleSetPrimary(account.id)}
                          isSettingPrimary={settingPrimaryId === account.id}
                          onArchive={() => setArchiveId(account.id)}
                          onDelete={() => setDeleteId(account.id)}
                          historyPoints={historyBatch.series.get(account.id)}
                          historyStatus={historyBatch.status}
                          t={t}
                        />
                      ))}
                    </div>
                  ) : null}
                  {archivedInvestmentLikeAccounts.length > 0 ? (
                    <div className="space-y-2">
                      <h3 className="text-sm font-semibold">{t('list.investmentsArchived')}</h3>
                      <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                        {archivedInvestmentLikeAccounts.map((account) => (
                          <AccountCard
                            key={account.id}
                            account={account}
                            linked={requestedAccountId === account.id}
                            isExpanded={expandedId === account.id}
                            onToggleExpand={() => toggleExpand(account.id)}
                            onEdit={() => openAccountDialog(account.id)}
                            onSetPrimary={() => handleSetPrimary(account.id)}
                            isSettingPrimary={settingPrimaryId === account.id}
                            onArchive={() => handleRestore(account.id)}
                            onDelete={() => setDeleteId(account.id)}
                            archiveLabel={t('unarchiveAccount')}
                            archived
                            historyPoints={historyBatch.series.get(account.id)}
                            historyStatus={historyBatch.status}
                            t={t}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
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
                <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
                  {archivedLiquidAccounts.map((account) => (
                    <AccountCard
                      key={account.id}
                      account={account}
                      linked={requestedAccountId === account.id}
                      isExpanded={expandedId === account.id}
                      onToggleExpand={() => toggleExpand(account.id)}
                      onEdit={() => openAccountDialog(account.id)}
                      onSetPrimary={() => handleSetPrimary(account.id)}
                      isSettingPrimary={settingPrimaryId === account.id}
                      onArchive={() => handleRestore(account.id)}
                      onDelete={() => setDeleteId(account.id)}
                      archiveLabel={t('unarchiveAccount')}
                      archived
                      historyPoints={historyBatch.series.get(account.id)}
                      historyStatus={historyBatch.status}
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

const EMPTY_HISTORY: readonly AccountHistoryPoint[] = []

function utilizationTone(utilization: number): 'destructive' | 'warning' | 'success' {
  if (utilization > 75) return 'destructive'
  if (utilization > 50) return 'warning'
  return 'success'
}

function AccountCard({
  account,
  linked = false,
  isExpanded,
  onToggleExpand,
  onEdit,
  onSetPrimary,
  isSettingPrimary = false,
  onPayCreditCard,
  onArchive,
  onDelete,
  archiveLabel,
  archived = false,
  historyPoints,
  historyStatus,
  t,
}: {
  account: Account
  linked?: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onEdit: () => void
  onSetPrimary?: () => void
  isSettingPrimary?: boolean
  onPayCreditCard?: () => void
  onArchive: () => void
  onDelete: () => void
  archiveLabel?: string
  archived?: boolean
  historyPoints?: readonly AccountHistoryPoint[]
  historyStatus: 'loading' | 'ready' | 'error'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}) {
  const navigate = useNavigate()
  const { t: tHistory, i18n } = useTranslation('accountHistory')
  const { t: tStatements } = useTranslation('cardPayments')
  const refreshAccounts = useAccountStore((state) => state.fetch)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [statementsOpen, setStatementsOpen] = useState(false)
  const [showCreditDetails, setShowCreditDetails] = useState(false)

  const railColor = accountRailColor(account.color)
  const seriesColor = railColor ?? 'var(--color-chart-1)'
  const iconStyle = accountIconAccentStyle(account.color)
  const TypeIcon = ACCOUNT_TYPE_ICONS[account.type] ?? Landmark
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
  const utilizationColor = utilization === null ? 'success' : utilizationTone(utilization)

  const points = historyPoints ?? EMPTY_HISTORY
  const showLine = canDrawHistory(points)

  const chartData = useMemo(() => {
    if (points.length === 0) return []
    return points.map((p) => ({
      date: p.date,
      balance: fromCentavos(p.balance),
    }))
  }, [points])

  const nameId = `account-${account.id}-name`
  const locatedId = `account-${account.id}-located`
  const cardActions: ActionDisclosureItem[] = [
    {
      label: t('viewTransactions'),
      onSelect: () => navigate(`/transactions?account=${encodeURIComponent(account.id)}`),
    },
  ]
  if (isCreditCard) {
    if (onPayCreditCard) cardActions.push({ label: t('credit.pay'), onSelect: onPayCreditCard })
    cardActions.push({ label: tStatements('action'), onSelect: () => setStatementsOpen(true) })
  }
  cardActions.push({
    label: isExpanded ? t('history.hide') : t('history.show'),
    onSelect: onToggleExpand,
    expanded: isExpanded,
  })
  if (isCreditCard && creditLimit !== null) {
    cardActions.push({
      label: showCreditDetails ? t('credit.hideDetails') : t('credit.showDetails'),
      onSelect: () => setShowCreditDetails((current) => !current),
      expanded: showCreditDetails,
    })
  }
  cardActions.push({ label: t('actions.edit'), onSelect: onEdit })
  if (account.account_mode !== 'snapshot_only') {
    cardActions.push({ label: tHistory('action'), onSelect: () => setMaintenanceOpen(true) })
  }
  if (canSetPrimary && onSetPrimary) {
    cardActions.push({
      label: isPrimary ? t('actions.primary') : t('actions.setPrimary'),
      onSelect: onSetPrimary,
      disabled: isPrimary || isSettingPrimary,
    })
  }
  cardActions.push(
    {
      label: archiveLabel ?? t('archiveAccount'),
      onSelect: onArchive,
    },
    {
      label: t('actions.delete'),
      onSelect: onDelete,
      destructive: true,
    }
  )

  let leadingVisual: ReactNode = null
  let historyNote: string | null = null
  if (showLine) {
    leadingVisual = (
      <AccountSparkline
        points={points}
        color={seriesColor}
        currency={account.currency}
        locale={i18n.language}
        label={`${t('history.sparkline')} ${account.name}`}
      />
    )
  } else if (historyStatus === 'loading') {
    leadingVisual = (
      <div className="account-visual-slot bg-muted/50 h-12 min-w-0 rounded-md" aria-hidden="true" />
    )
  } else if (historyStatus === 'error') {
    historyNote = t('history.slotUnavailable')
  } else if (isCreditCard && creditLimit !== null && utilization !== null) {
    leadingVisual = (
      <div className="account-visual-slot flex h-12 min-w-0 items-center gap-3">
        <ProgressBar
          value={utilization}
          size="sm"
          color={utilizationColor}
          ariaLabel={t('utilization.label')}
          className="min-w-0 flex-1"
        />
        <span
          className={`shrink-0 text-xs font-medium tabular-nums ${
            utilizationColor === 'destructive'
              ? 'text-destructive'
              : utilizationColor === 'warning'
                ? 'text-warning'
                : 'text-success'
          }`}
        >
          {utilization}%
        </span>
      </div>
    )
  } else {
    historyNote = t('history.slotEmpty')
  }

  return (
    <article
      id={`account-${account.id}`}
      tabIndex={-1}
      aria-labelledby={nameId}
      aria-describedby={linked ? locatedId : undefined}
      aria-current={linked ? 'true' : undefined}
      className={`group border-border bg-surface focus-visible:ring-ring relative flex h-full min-w-0 flex-col rounded-[var(--radius-xl)] border px-4 py-4 outline-none focus-visible:ring-2 sm:px-5 ${linked ? 'ring-ring ring-2' : ''}`}
    >
      {railColor ? (
        <span
          data-account-rail=""
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-[3px]"
          style={{ width: ACCOUNT_RAIL_WIDTH_PX, backgroundColor: railColor }}
        />
      ) : null}
      {linked ? (
        <span id={locatedId} className="sr-only">
          {t('link.located')}
        </span>
      ) : null}
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`account-type-mark mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconStyle ? '' : 'bg-accent-muted text-accent'}`}
          style={iconStyle}
          aria-hidden="true"
        >
          <TypeIcon size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <h3
                id={nameId}
                className="text-foreground min-w-0 text-base font-semibold break-words"
              >
                {account.name}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {t(`types.${account.type}`)}
                </Badge>
                {isPrimary && (
                  <Badge variant="outline" className="text-accent border-accent/40 text-xs">
                    {t('actions.primaryBadge')}
                  </Badge>
                )}
                {archived && (
                  <Badge variant="outline" className="text-xs">
                    {t('archived.badge')}
                  </Badge>
                )}
              </div>
            </div>
            <ActionDisclosure
              label={t('actions.more')}
              ariaLabel={`${t('actions.more')} — ${account.name}`}
              trigger={<EllipsisVertical aria-hidden="true" />}
              actions={cardActions}
              className="shrink-0"
              triggerClassName="min-h-11 min-w-11 px-2"
            />
          </div>
          {leadingVisual ? <div className="mt-3 min-w-0">{leadingVisual}</div> : null}
          <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <p
              data-account-balance=""
              className="text-foreground max-w-full min-w-0 shrink-0 text-xl font-medium tracking-tight break-words tabular-nums min-[380px]:text-2xl"
            >
              {formatMoney(account.balance, account.currency)}
            </p>
            <p className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {account.currency}
            </p>
          </div>
          {historyNote ? <p className="text-muted-foreground mt-1 text-xs">{historyNote}</p> : null}
        </div>
      </div>

      {isCreditCard && creditLimit !== null && (
        <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-1">
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">{t('credit.limit')}</p>
            <p className="text-foreground mt-1 max-w-full min-w-0 text-sm font-medium break-words tabular-nums">
              {formatMoney(creditLimit, account.currency)}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-muted-foreground text-xs">{t('credit.available')}</p>
            <p
              className={`mt-1 max-w-full min-w-0 text-sm font-medium break-words tabular-nums ${availableCredit !== null && availableCredit < 0 ? 'text-destructive' : 'text-success'}`}
            >
              {formatMoney(availableCredit ?? 0, account.currency)}
            </p>
          </div>
        </div>
      )}

      {showCreditDetails && isCreditCard && creditLimit !== null && (
        <div className="mt-3 min-w-0">
          <p className="text-muted-foreground text-xs">{t('credit.dates')}</p>
          <p className="mt-1 text-xs font-semibold tabular-nums">
            {account.statement_closing_day ? `C ${account.statement_closing_day}` : 'C --'} /{' '}
            {account.payment_due_day ? `D ${account.payment_due_day}` : 'D --'}
          </p>
        </div>
      )}

      {showCreditDetails && utilization !== null && (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-muted-foreground text-xs">{t('utilization.label')}</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`text-xs font-medium tabular-nums ${
                  utilizationColor === 'destructive'
                    ? 'text-destructive'
                    : utilizationColor === 'warning'
                      ? 'text-warning'
                      : 'text-success'
                }`}
              >
                {utilization}%
              </span>
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                  utilizationColor === 'destructive'
                    ? 'bg-destructive/10 text-destructive'
                    : utilizationColor === 'warning'
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
            color={utilizationColor}
            ariaLabel={t('utilization.label')}
          />
        </div>
      )}

      {isExpanded && (
        <div className="border-border mt-3 min-w-0 border-t pt-3 pb-1">
          {historyStatus === 'loading' && points.length === 0 ? (
            <Skeleton className="h-32 w-full" />
          ) : historyStatus === 'error' && points.length < 2 ? (
            <div className="flex h-32 items-center justify-center">
              <p className="text-muted-foreground text-xs">{t('history.slotUnavailable')}</p>
            </div>
          ) : chartData.length > 1 ? (
            <div
              className="h-32 min-w-0"
              role="img"
              aria-label={`${t('history.show')} for ${account.name}`}
            >
              <span className="sr-only">
                {points
                  .map(
                    (p) =>
                      `${dayjs(p.date).format('MMM D')}: ${formatMoney(p.balance, account.currency)}`
                  )
                  .join(', ')}
              </span>
              <SafeChart>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id={`grad-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={seriesColor} stopOpacity={0.28} />
                      <stop offset="95%" stopColor={seriesColor} stopOpacity={0} />
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
                    type="linear"
                    dataKey="balance"
                    isAnimationActive={false}
                    stroke={seriesColor}
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
      {account.account_mode !== 'snapshot_only' && (
        <AccountMaintenanceDialog
          account={account}
          open={maintenanceOpen}
          onOpenChange={setMaintenanceOpen}
        />
      )}
      {isCreditCard && (
        <CardStatementsDialog
          account={account}
          open={statementsOpen}
          onOpenChange={setStatementsOpen}
          onChanged={() => refreshAccounts()}
        />
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
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="border-border bg-surface space-y-3 rounded-[var(--radius-xl)] border p-4"
          >
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="account-visual-slot h-12 w-full" />
          </div>
        ))}
      </div>
    </>
  )
}
