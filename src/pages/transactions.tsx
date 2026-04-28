import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Plus, Pencil, Trash2, Search, Split, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isYesterday from 'dayjs/plugin/isYesterday'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { TransactionSplitWithCategory } from '@/types/database'
import { StatementImportDialog } from '@/components/transactions/statement-import-dialog'

dayjs.extend(isToday)
dayjs.extend(isYesterday)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'
type ReviewFilter = 'all' | 'uncategorized'

function formatDateHeader(date: string): string {
  const d = dayjs(date)
  if (d.isToday()) return 'Today'
  if (d.isYesterday()) return 'Yesterday'
  return d.format('ddd, MMM D')
}
export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog } = useUIStore()
  const {
    transactions,
    isLoading,
    fetchError: transactionFetchError,
    fetch,
    remove,
    isSplit,
  } = useTransactionStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [statementImportOpen, setStatementImportOpen] = useState(false)

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const hasTransactionLoadError = !!transactionFetchError && transactions.length === 0
  const activeErrors = hasTransactionLoadError ? [] : [transactionFetchError]

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false
      if (reviewFilter === 'uncategorized' && tx.category_id !== null) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          tx.description.toLowerCase().includes(q) ||
          tx.category_name?.toLowerCase().includes(q) ||
          tx.account_name?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [transactions, typeFilter, reviewFilter, searchQuery])

  const uncategorizedCount = useMemo(
    () => transactions.filter((tx) => tx.category_id === null && tx.type !== 'transfer').length,
    [transactions]
  )

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, TransactionWithDetails[]>()
    for (const tx of filteredTransactions) {
      const date = tx.date
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(tx)
    }
    return groups
  }, [filteredTransactions])

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

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header p-5">
        <div>
          <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
            Activity ledger
          </p>
          <h1 className="font-heading mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {t('title')}
          </h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStatementImportOpen(true)}>
            <Plus size={16} />
            {t('import.button')}
          </Button>
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            {t('addTransaction')}
          </Button>
        </div>
      </div>

      <ErrorBanner
        title="Couldn’t load transactions"
        messages={activeErrors}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      <div className="liquid-card flex flex-wrap items-center gap-3 p-3">
        <div className="relative min-w-[220px] flex-1">
          <Search
            size={14}
            className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            placeholder={`${tCommon('actions.search')}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setTypeFilter(type)}
              className={cn(
                'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
                typeFilter === type
                  ? 'text-accent-hover bg-white/[0.1]'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.08]'
              )}
            >
              {type === 'all' ? 'All' : t(`types.${type}`)}
            </button>
          ))}
        </div>
        <button
          onClick={() =>
            setReviewFilter(reviewFilter === 'uncategorized' ? 'all' : 'uncategorized')
          }
          className={cn(
            'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
            reviewFilter === 'uncategorized'
              ? 'text-accent-hover bg-white/[0.1]'
              : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.08]'
          )}
        >
          {t('form.categoryNone')} ({uncategorizedCount})
        </button>
      </div>

      {isLoading ? (
        <TransactionsSkeleton />
      ) : hasTransactionLoadError ? (
        <ErrorState
          title="Couldn’t load your transactions"
          description={transactionFetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : transactions.length === 0 ? (
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
            <ArrowLeftRight size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            {t('addTransaction')}
          </Button>
        </div>
      ) : filteredTransactions.length === 0 ? (
        <div className="liquid-card flex flex-col items-center justify-center py-12 text-center">
          <Search size={24} className="text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">{t('noMatching')}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(groupedByDate.entries()).map(([date, txns]) => (
            <div key={date}>
              <h2 className="text-muted-foreground mb-2 font-mono text-xs tracking-[0.24em] uppercase">
                {formatDateHeader(date)}
              </h2>
              <div className="liquid-card divide-y divide-white/[0.08] overflow-hidden p-1">
                {txns.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    hasSplits={isSplit(tx.id)}
                    onEdit={() => openTransactionDialog(tx.id)}
                    onDelete={() => setDeleteId(tx.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <StatementImportDialog open={statementImportOpen} onOpenChange={setStatementImportOpen} />

      <Suspense>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteTransaction')}
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

// --- Skeletons ---

function TransactionsSkeleton() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="liquid-card flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function TransactionRow({
  transaction: tx,
  hasSplits,
  onEdit,
  onDelete,
}: {
  transaction: TransactionWithDetails
  hasSplits: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('transactions')
  const { getSplits } = useTransactionStore()
  const [expanded, setExpanded] = useState(false)
  const [splits, setSplits] = useState<TransactionSplitWithCategory[]>([])
  const [loadingSplits, setLoadingSplits] = useState(false)

  const handleToggleSplits = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setLoadingSplits(true)
    try {
      const data = await getSplits(tx.id)
      setSplits(data)
      setExpanded(true)
    } finally {
      setLoadingSplits(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[22px]">
      <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]">
        {tx.category_color ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tx.category_color }}
          />
        ) : (
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tx.description}</p>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {tx.category_name && <span>{tx.category_name}</span>}
            {tx.account_name && (
              <Badge variant="secondary" className="text-[10px]">
                {tx.account_name}
              </Badge>
            )}
            {hasSplits && (
              <button
                onClick={handleToggleSplits}
                className="text-accent/70 hover:text-accent inline-flex items-center gap-0.5 transition-colors"
              >
                <Split size={10} />
                <span className="font-mono text-[10px]">{t('split.badge')}</span>
                <ChevronDown
                  size={10}
                  className={cn('transition-transform', expanded && 'rotate-180')}
                />
              </button>
            )}
          </div>
        </div>
        <span
          className={`font-heading text-sm font-semibold ${
            tx.type === 'income' ? 'text-success' : 'text-destructive'
          }`}
        >
          {tx.type === 'income' ? '+' : '-'}
          {formatMoney(tx.amount, tx.currency)}
        </span>
        <span className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          {dayjs(tx.date).format('MMM D')}
        </span>
        <div className="flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label={`Edit ${tx.description}`}
          >
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
            aria-label={`Delete ${tx.description}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Split breakdown */}
      {expanded && (
        <div className="animate-slide-up border-t border-white/[0.08] px-4 py-3">
          {loadingSplits ? (
            <div className="space-y-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : (
            <div className="space-y-1">
              {splits.map((split) => (
                <div key={split.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    {split.category_color && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: split.category_color }}
                      />
                    )}
                    <span className="text-muted-foreground">{split.category_name}</span>
                    {split.notes && (
                      <span className="text-muted-foreground/60 max-w-32 truncate">
                        — {split.notes}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground font-mono">
                    {formatMoney(split.amount, tx.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
