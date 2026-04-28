import { useEffect, useState, useMemo, lazy, Suspense, useCallback } from 'react'
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
} from 'lucide-react'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts'
import { SafeChart } from '@/components/ui/safe-chart'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import type { Account } from '@/types/database'
import dayjs from 'dayjs'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

export function Accounts() {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')
  const { openAccountDialog } = useUIStore()
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

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [archiveId, setArchiveId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [settingPrimaryId, setSettingPrimaryId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

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
  const creditAccounts = useMemo(
    () => liquidAccounts.filter((account) => account.type === 'credit_card'),
    [liquidAccounts]
  )
  const totalBalance = useMemo(
    () => liquidAccounts.reduce((sum, account) => sum + account.balance, 0),
    [liquidAccounts]
  )
  const depositBalance = useMemo(
    () => depositAccounts.reduce((sum, account) => sum + account.balance, 0),
    [depositAccounts]
  )
  const creditDebt = useMemo(
    () => creditAccounts.reduce((sum, account) => sum + Math.max(0, -account.balance), 0),
    [creditAccounts]
  )
  const primaryAccount = useMemo(
    () =>
      depositAccounts.find((account) => account.is_primary === 1) ??
      [...depositAccounts].sort((a, b) => b.balance - a.balance)[0] ??
      liquidAccounts[0],
    [depositAccounts, liquidAccounts]
  )

  const accountMix = useMemo(
    () => [
      {
        label: 'Checking',
        value: liquidAccounts
          .filter((account) => account.type === 'checking')
          .reduce((sum, account) => sum + Math.max(0, account.balance), 0),
      },
      {
        label: 'Savings',
        value: liquidAccounts
          .filter((account) => account.type === 'savings')
          .reduce((sum, account) => sum + Math.max(0, account.balance), 0),
      },
      {
        label: 'Credit cards',
        value: creditDebt,
      },
    ],
    [creditDebt, liquidAccounts]
  )

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch {
      toast.error(t('toast.error'))
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
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsArchiving(false)
    }
  }

  const handleRestore = async (id: string) => {
    try {
      await unarchive(id)
      toast.success(t('toast.restored'))
    } catch {
      toast.error(t('toast.error'))
    }
  }

  const handleSetPrimary = async (id: string) => {
    setSettingPrimaryId(id)
    try {
      await setPrimary(id)
      toast.success('Primary account updated')
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setSettingPrimaryId(null)
    }
  }

  const toggleExpand = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id))
  }, [])

  const hasInitialLoadError = !!fetchError && accounts.length === 0

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
            {t('subtitle')}
          </p>
          <h1 className="font-heading mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {t('title')}
          </h1>
        </div>
        <Button onClick={() => openAccountDialog()}>
          <Plus size={16} />
          {t('addAccount')}
        </Button>
      </div>

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
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
            <Landmark size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={() => openAccountDialog()}>
            <Plus size={16} />
            {t('addAccount')}
          </Button>
        </div>
      ) : (
        <>
          {accounts.length > 0 ? (
            <>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
                <div className="liquid-hero p-6 sm:p-7">
                  <div className="flex h-full min-h-64 flex-col justify-between">
                    <div>
                      <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.28em] uppercase">
                        Primary cash account
                      </p>
                      <h2 className="font-heading text-lg font-semibold text-white">
                        {primaryAccount?.name ?? 'No card or cash account'}
                      </h2>
                    </div>
                    <div>
                      <p className="font-mono text-4xl font-bold tracking-tight text-white md:text-5xl">
                        {formatMoney(
                          primaryAccount?.balance ?? totalBalance,
                          primaryAccount?.currency
                        )}
                      </p>
                      <p className="text-muted-foreground mt-4 font-mono text-xs tracking-[0.22em] uppercase">
                        {primaryAccount
                          ? `${t(`types.${primaryAccount.type}`)} · ${primaryAccount.currency}`
                          : 'Bank accounts and credit cards'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="liquid-card p-6 sm:p-7">
                  <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.28em] uppercase">
                    Cards and cash
                  </p>
                  <h2 className="font-heading text-2xl font-bold tracking-tight">Account mix</h2>
                  <div className="mt-7 space-y-4">
                    {accountMix.map((item) => (
                      <div key={item.label}>
                        <div className="mb-2 flex items-center justify-between gap-4">
                          <span className="text-sm font-semibold text-white">{item.label}</span>
                          <span className="font-mono text-sm font-semibold text-white">
                            {formatMoney(item.value)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-[#7C5CFF]"
                            style={{
                              width: `${Math.max(
                                item.value > 0 ? 8 : 0,
                                Math.min(
                                  100,
                                  Math.round(
                                    (item.value / Math.max(1, depositBalance + creditDebt)) * 100
                                  )
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="soft-divider mt-7 grid grid-cols-2 gap-3 border-t pt-5">
                    <div>
                      <p className="text-muted-foreground text-xs">Spendable</p>
                      <p className="font-mono text-lg font-bold">{formatMoney(depositBalance)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Card debt</p>
                      <p className="text-warning font-mono text-lg font-bold">
                        {formatMoney(creditDebt)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="liquid-card overflow-hidden p-1">
                <div className="flex flex-col gap-1 px-5 pt-5 pb-4 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h2 className="font-heading text-xl font-bold tracking-tight">All accounts</h2>
                    <p className="text-muted-foreground text-sm">
                      Bank accounts, debit balances, cash, and credit cards.
                    </p>
                  </div>
                  <p className="font-mono text-xs tracking-[0.22em] text-[#BFA4FF] uppercase">
                    {liquidAccounts.length} active
                  </p>
                </div>
                {liquidAccounts.length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 p-2 xl:grid-cols-2">
                    {liquidAccounts.map((account) => (
                      <AccountCard
                        key={account.id}
                        account={account}
                        isExpanded={expandedId === account.id}
                        onToggleExpand={() => toggleExpand(account.id)}
                        onEdit={() => openAccountDialog(account.id)}
                        onSetPrimary={() => handleSetPrimary(account.id)}
                        isSettingPrimary={settingPrimaryId === account.id}
                        onArchive={() => setArchiveId(account.id)}
                        onDelete={() => setDeleteId(account.id)}
                        t={t}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="px-5 pb-5">
                    <div className="rounded-[22px] border border-dashed border-white/[0.12] p-5">
                      <h3 className="font-heading text-base font-semibold">
                        No card or cash accounts
                      </h3>
                      <p className="text-muted-foreground mt-1 text-sm">
                        Add a checking, savings, cash, or credit-card account for everyday tracking.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {separatedInvestmentAccountCount > 0 && (
                <div className="liquid-card border-dashed p-5">
                  <h2 className="font-heading text-base font-semibold">
                    Investments stay separate
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {separatedInvestmentAccountCount} investment or crypto account
                    {separatedInvestmentAccountCount === 1 ? '' : 's'} should be managed from the
                    Investments area, not mixed with bank and card balances.
                  </p>
                </div>
              )}
            </>
          ) : (
            <div className="liquid-card border-dashed p-5">
              <h2 className="font-heading text-base font-semibold">{t('noActive.title')}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{t('noActive.description')}</p>
            </div>
          )}

          {archivedLiquidAccounts.length > 0 && (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-heading text-lg font-semibold">{t('archived.title')}</h2>
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
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
            </div>
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
    </div>
  )
}

// ── Account Card with Balance History ─────────────────────────────────────

function AccountCard({
  account,
  isExpanded,
  onToggleExpand,
  onEdit,
  onSetPrimary,
  isSettingPrimary = false,
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
  onArchive: () => void
  onDelete: () => void
  archiveLabel?: string
  archiveIcon?: React.ReactNode
  archived?: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  t: any
}) {
  const { loadBalanceHistory, balanceHistory } = useAccountStore()
  const [historyLoading, setHistoryLoading] = useState(
    isExpanded && !balanceHistory.get(account.id)
  )

  const accentColor = account.color || '#7C5CFF'
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
    <div
      className={`liquid-card group relative overflow-hidden transition-all duration-200 hover:translate-y-[-2px] motion-reduce:transition-none ${archived ? 'border-dashed border-white/[0.08]' : ''}`}
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="p-5">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="font-heading text-base font-semibold">{account.name}</h3>
            <Badge variant="secondary" className="mt-1 text-[10px]">
              {t(`types.${account.type}`)}
            </Badge>
            {isPrimary && (
              <Badge
                variant="outline"
                className="mt-1 ml-1 border-[#BFA4FF]/40 text-[10px] text-[#BFA4FF]"
              >
                Primary
              </Badge>
            )}
            {archived && (
              <Badge variant="outline" className="mt-1 ml-1 border-white/10 text-[10px]">
                {t('archived.badge')}
              </Badge>
            )}
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
                <Star size={12} className={isPrimary ? 'fill-[#BFA4FF] text-[#BFA4FF]' : ''} />
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
        <p className="font-heading text-3xl font-bold tracking-tight">
          {formatMoney(account.balance, account.currency)}
        </p>
        <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-wider">
          {account.currency}
        </p>

        {isCreditCard && creditLimit !== null && (
          <div className="mt-4 grid grid-cols-3 gap-2 rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3">
            <div>
              <p className="text-muted-foreground text-[9px] tracking-wider uppercase">
                {t('credit.limit')}
              </p>
              <p className="mt-1 font-mono text-xs font-semibold">
                {formatMoney(creditLimit, account.currency)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[9px] tracking-wider uppercase">
                {t('credit.available')}
              </p>
              <p
                className={`mt-1 font-mono text-xs font-semibold ${availableCredit !== null && availableCredit < 0 ? 'text-destructive' : 'text-success'}`}
              >
                {formatMoney(availableCredit ?? 0, account.currency)}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-[9px] tracking-wider uppercase">
                {t('credit.dates')}
              </p>
              <p className="mt-1 font-mono text-xs font-semibold">
                {account.statement_closing_day ? `C ${account.statement_closing_day}` : 'C --'} /{' '}
                {account.payment_due_day ? `D ${account.payment_due_day}` : 'D --'}
              </p>
            </div>
          </div>
        )}

        {/* Credit card utilization bar */}
        {utilization !== null && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-muted-foreground text-[10px]">{t('utilization.label')}</span>
              <span className="flex items-center gap-1.5">
                <span
                  className={`font-mono text-[10px] font-medium ${
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
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium tracking-wider uppercase ${
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
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${utilization}%`,
                  backgroundColor:
                    utilization > 75
                      ? 'var(--color-destructive)'
                      : utilization > 50
                        ? 'var(--color-warning)'
                        : 'var(--color-success)',
                }}
              />
            </div>
          </div>
        )}

        {/* Expand toggle */}
        <button
          onClick={onToggleExpand}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 mt-3 flex w-full items-center justify-center gap-1 rounded-md py-2 text-[10px] transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <TrendingUp size={10} />
          {isExpanded ? t('history.hide') : t('history.show')}
          {isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
        </button>
      </div>

      {/* Expanded balance history chart */}
      {isExpanded && (
        <div className="soft-divider border-t px-5 pt-3 pb-5">
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
                      <stop offset="5%" stopColor={accentColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={accentColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#A9A9B4', fontSize: 11 }}
                    tickFormatter={(d) => dayjs(d).format('M/D')}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#A9A9B4', fontSize: 11 }}
                    tickFormatter={(v) => (v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`)}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#0a0a0a',
                      border: '1px solid rgba(255,255,255,0.06)',
                      borderRadius: '8px',
                      fontSize: '11px',
                    }}
                    labelFormatter={(d) => dayjs(d).format('MMM D, YYYY')}
                    formatter={(value) => [`$${Number(value).toLocaleString()}`, 'Balance']}
                  />
                  <Area
                    type="monotone"
                    dataKey="balance"
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
    </div>
  )
}

function AccountsSkeleton() {
  return (
    <>
      <div className="liquid-card space-y-2 p-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="liquid-card space-y-3 p-5">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </>
  )
}
