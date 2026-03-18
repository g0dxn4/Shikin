import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Plus, Pencil, Trash2, Search, Filter, Split, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isYesterday from 'dayjs/plugin/isYesterday'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { TransactionSplitWithCategory } from '@/types/database'

dayjs.extend(isToday)
dayjs.extend(isYesterday)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'

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
  const { transactions, isLoading, fetch, remove, isSplit } = useTransactionStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    fetch()
  }, [fetch])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false
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
  }, [transactions, typeFilter, searchQuery])

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
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(showFilters && 'bg-accent/10 text-accent')}
          >
            <Filter size={14} />
            {tCommon('actions.filter')}
          </Button>
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            {t('addTransaction')}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <div className="glass-card animate-slide-up flex flex-wrap items-center gap-3 p-3">
          <div className="relative flex-1">
            <Search size={14} className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2" />
            <Input
              placeholder={`${tCommon('actions.search')}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                className={cn(
                  'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
                  typeFilter === type
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-surface-elevated hover:text-foreground'
                )}
              >
                {type === 'all' ? 'All' : t(`types.${type}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <TransactionsSkeleton />
      ) : transactions.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
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
        <div className="glass-card flex flex-col items-center justify-center py-12 text-center">
          <Search size={24} className="text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">No matching transactions</p>
        </div>
      ) : (
        <div className="space-y-5">
          {Array.from(groupedByDate.entries()).map(([date, txns]) => (
            <div key={date}>
              <h2 className="text-muted-foreground mb-2 font-mono text-xs tracking-wider uppercase">
                {formatDateHeader(date)}
              </h2>
              <div className="space-y-1">
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

function TransactionsSkeleton() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card flex items-center gap-3 px-4 py-3">
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
    <div className="glass-card overflow-hidden">
      <div className="group flex items-center gap-3 px-4 py-2.5">
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
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Split breakdown */}
      {expanded && (
        <div className="border-border/20 animate-slide-up border-t px-4 py-2">
          {loadingSplits ? (
            <div className="space-y-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : (
            <div className="space-y-1">
              {splits.map((split) => (
                <div
                  key={split.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    {split.category_color && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: split.category_color }}
                      />
                    )}
                    <span className="text-muted-foreground">{split.category_name}</span>
                    {split.notes && (
                      <span className="text-muted-foreground/60 truncate max-w-32">
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
