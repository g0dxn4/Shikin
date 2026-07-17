import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Search,
  Split,
  Trash2,
} from 'lucide-react'
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
import type { TransactionWithDetails, ReviewFieldUpdate } from '@/stores/transaction-store'
import { useAccountStore } from '@/stores/account-store'
import { useCategoryStore } from '@/stores/category-store'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
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

const TRANSACTIONS_PAGE_SIZE = 100
const TRANSACTION_VIEW_STORAGE_KEY = 'shikin.transactions.view'
const EMPTY_FILTER_VALUE = 'all'
const EMPTY_CATEGORY_VALUE = '__none__'

const transactionViews = ['timeline', 'ledger', 'review'] as const
const dateRanges = ['all', 'month', '30-days', '90-days', 'custom'] as const
const reviewFilters = ['all', 'needs-category', 'pending', 'placeholder', 'staged'] as const

type TransactionView = (typeof transactionViews)[number]
type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'
type DateRange = (typeof dateRanges)[number]
type StatusFilter = 'all' | 'posted' | 'pending' | 'cleared'
type TransactionStatusFilter = Exclude<StatusFilter, 'all'>
type ReviewFilter = (typeof reviewFilters)[number]
type LedgerSortField = 'date' | 'description' | 'amount'
type SortDirection = 'asc' | 'desc'
type ReviewReason = Exclude<ReviewFilter, 'all'>
type ReviewProtectionKey =
  | 'review.protected.split'
  | 'review.protected.receivable'
  | 'review.protected.reconciliation'
  | 'review.protected.finalized'
  | 'review.protected.linked'
  | 'review.protected.workflow'
  | 'review.protected.transfer'
  | 'review.protected.placeholderLifecycle'

function formatDateHeader(date: string): string {
  const d = dayjs(date)
  if (d.isToday()) return 'Today'
  if (d.isYesterday()) return 'Yesterday'
  return d.format('ddd, MMM D')
}

function getStoredTransactionView(): TransactionView {
  if (typeof window === 'undefined') return 'timeline'

  try {
    const storedView = window.localStorage.getItem(TRANSACTION_VIEW_STORAGE_KEY)
    return transactionViews.includes(storedView as TransactionView)
      ? (storedView as TransactionView)
      : 'timeline'
  } catch {
    return 'timeline'
  }
}

function getTransactionStatus(transaction: TransactionWithDetails): TransactionStatusFilter {
  return transaction.status ?? 'posted'
}

function getTransactionSource(transaction: TransactionWithDetails): string {
  return transaction.source ?? transaction.import_source ?? 'manual'
}

function getLedgerAccountLabel(transaction: TransactionWithDetails): string {
  const source = transaction.account_name ?? '—'
  if (transaction.type !== 'transfer') return source
  return `${source} → ${transaction.transfer_to_account_name ?? '—'}`
}

function getReviewReasons(transaction: TransactionWithDetails, hasSplits: boolean): ReviewReason[] {
  const reasons: ReviewReason[] = []
  if (
    (transaction.type === 'expense' || transaction.type === 'income') &&
    transaction.category_id === null &&
    !hasSplits
  ) {
    reasons.push('needs-category')
  }
  if (getTransactionStatus(transaction) === 'pending') reasons.push('pending')
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') === 'unresolved'
  ) {
    reasons.push('placeholder')
  }
  if (transaction.ledger_treatment === 'staged_no_balance_impact') reasons.push('staged')
  return reasons
}

function getReviewProtectionKey(
  transaction: TransactionWithDetails,
  hasSplits: boolean
): ReviewProtectionKey | null {
  if (hasSplits) return 'review.protected.split'
  if (transaction.is_receivable_payment) return 'review.protected.receivable'
  if (transaction.is_reconciliation_adjustment) return 'review.protected.reconciliation'
  if (transaction.is_finalized_statement) return 'review.protected.finalized'
  if (transaction.matched_transaction_id) return 'review.protected.linked'
  if ((transaction.transaction_kind ?? 'standard') !== 'standard')
    return 'review.protected.workflow'
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') !== 'unresolved'
  ) {
    return 'review.protected.placeholderLifecycle'
  }
  if (transaction.type === 'transfer') return 'review.protected.transfer'
  return null
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA'
  )
}

function statusBadgeClass(status: TransactionStatusFilter): string {
  if (status === 'pending') return 'border-amber-400/30 bg-amber-400/10 text-amber-300'
  if (status === 'cleared') return 'border-success/30 bg-success/10 text-success'
  return 'border-white/[0.12] bg-white/[0.06] text-muted-foreground'
}

function sourceLabel(source: string): string {
  return source.replace(/[_-]+/g, ' ')
}

function sortLedgerTransactions(
  transactions: TransactionWithDetails[],
  field: LedgerSortField,
  direction: SortDirection
): TransactionWithDetails[] {
  const multiplier = direction === 'asc' ? 1 : -1
  return [...transactions].sort((a, b) => {
    if (field === 'date') return a.date.localeCompare(b.date) * multiplier
    if (field === 'description') return a.description.localeCompare(b.description) * multiplier
    return (a.amount - b.amount) * multiplier
  })
}

export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog, openRecurringDialog } = useUIStore()
  const {
    transactions,
    isLoading,
    fetchError: transactionFetchError,
    fetch,
    remove,
    isSplit,
    updateReviewFields,
    splitCategoryIdsByTransaction,
  } = useTransactionStore()
  const { accounts, archivedAccounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [view, setView] = useState<TransactionView>(getStoredTransactionView)
  const [searchQuery, setSearchQuery] = useState('')
  const deferredSearchQuery = useDeferredValue(searchQuery)
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [dateRange, setDateRange] = useState<DateRange>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [accountFilter, setAccountFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [currencyFilter, setCurrencyFilter] = useState('all')
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>('all')
  const [visibleCount, setVisibleCount] = useState(TRANSACTIONS_PAGE_SIZE)
  const [statementImportOpen, setStatementImportOpen] = useState(false)
  const [ledgerSort, setLedgerSort] = useState<{
    field: LedgerSortField
    direction: SortDirection
  }>({
    field: 'date',
    direction: 'desc',
  })
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null)
  const [reviewAnnouncement, setReviewAnnouncement] = useState('')
  const reviewRowRefs = useRef(new Map<string, HTMLDivElement>())
  const pendingReviewFocusId = useRef<string | null>(null)

  useEffect(() => {
    void Promise.allSettled([fetch(), fetchAccounts(), fetchCategories()])
  }, [fetch, fetchAccounts, fetchCategories])

  useEffect(() => {
    try {
      window.localStorage.setItem(TRANSACTION_VIEW_STORAGE_KEY, view)
    } catch {
      // Local storage is optional and may be disabled by the device or browser.
    }
  }, [view])

  const allAccounts = useMemo(
    () => [...accounts, ...archivedAccounts],
    [accounts, archivedAccounts]
  )
  const currencies = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.currency))].sort(),
    [transactions]
  )

  const filteredTransactions = useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase()
    const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const currentMonthEnd = dayjs().endOf('month').format('YYYY-MM-DD')
    const last30DaysStart = dayjs().subtract(29, 'day').format('YYYY-MM-DD')
    const last90DaysStart = dayjs().subtract(89, 'day').format('YYYY-MM-DD')

    return transactions.filter((transaction) => {
      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false
      if (
        accountFilter !== 'all' &&
        transaction.account_id !== accountFilter &&
        transaction.transfer_to_account_id !== accountFilter
      ) {
        return false
      }
      if (categoryFilter !== 'all') {
        const splitCategoryIds = splitCategoryIdsByTransaction.get(transaction.id)
        const matchesCategory = splitCategoryIds
          ? splitCategoryIds.has(categoryFilter)
          : transaction.category_id === categoryFilter
        if (!matchesCategory) return false
      }
      if (statusFilter !== 'all' && getTransactionStatus(transaction) !== statusFilter) return false
      if (currencyFilter !== 'all' && transaction.currency !== currencyFilter) return false

      if (dateRange === 'month') {
        if (transaction.date < currentMonthStart || transaction.date > currentMonthEnd) return false
      } else if (dateRange === '30-days') {
        if (transaction.date < last30DaysStart) return false
      } else if (dateRange === '90-days') {
        if (transaction.date < last90DaysStart) return false
      } else if (dateRange === 'custom') {
        if (customFrom && transaction.date < customFrom) return false
        if (customTo && transaction.date > customTo) return false
      }

      if (!query) return true
      return (
        transaction.description.toLowerCase().includes(query) ||
        transaction.category_name?.toLowerCase().includes(query) ||
        transaction.account_name?.toLowerCase().includes(query) ||
        transaction.transfer_to_account_name?.toLowerCase().includes(query) ||
        getTransactionSource(transaction).toLowerCase().includes(query)
      )
    })
  }, [
    accountFilter,
    categoryFilter,
    currencyFilter,
    customFrom,
    customTo,
    dateRange,
    deferredSearchQuery,
    splitCategoryIdsByTransaction,
    statusFilter,
    transactions,
    typeFilter,
  ])

  const reviewTransactions = useMemo(
    () =>
      filteredTransactions.filter(
        (transaction) => getReviewReasons(transaction, isSplit(transaction.id)).length > 0
      ),
    [filteredTransactions, isSplit]
  )
  const filteredReviewTransactions = useMemo(
    () =>
      reviewFilter === 'all'
        ? reviewTransactions
        : reviewTransactions.filter((transaction) =>
            getReviewReasons(transaction, isSplit(transaction.id)).includes(reviewFilter)
          ),
    [isSplit, reviewFilter, reviewTransactions]
  )
  const reviewCounts = useMemo(
    () => ({
      all: reviewTransactions.length,
      'needs-category': reviewTransactions.filter((transaction) =>
        getReviewReasons(transaction, isSplit(transaction.id)).includes('needs-category')
      ).length,
      pending: reviewTransactions.filter((transaction) =>
        getReviewReasons(transaction, isSplit(transaction.id)).includes('pending')
      ).length,
      placeholder: reviewTransactions.filter((transaction) =>
        getReviewReasons(transaction, isSplit(transaction.id)).includes('placeholder')
      ).length,
      staged: reviewTransactions.filter((transaction) =>
        getReviewReasons(transaction, isSplit(transaction.id)).includes('staged')
      ).length,
    }),
    [isSplit, reviewTransactions]
  )

  const orderedTransactions = useMemo(() => {
    if (view === 'ledger') {
      return sortLedgerTransactions(filteredTransactions, ledgerSort.field, ledgerSort.direction)
    }
    if (view === 'review') return filteredReviewTransactions
    return filteredTransactions
  }, [filteredReviewTransactions, filteredTransactions, ledgerSort, view])

  useEffect(() => {
    setVisibleCount(TRANSACTIONS_PAGE_SIZE)
  }, [
    accountFilter,
    categoryFilter,
    currencyFilter,
    customFrom,
    customTo,
    dateRange,
    deferredSearchQuery,
    reviewFilter,
    statusFilter,
    typeFilter,
  ])

  const visibleTransactions = useMemo(
    () => orderedTransactions.slice(0, visibleCount),
    [orderedTransactions, visibleCount]
  )
  const hasMoreTransactions = visibleTransactions.length < orderedTransactions.length

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, TransactionWithDetails[]>()
    for (const transaction of visibleTransactions) {
      if (!groups.has(transaction.date)) groups.set(transaction.date, [])
      groups.get(transaction.date)!.push(transaction)
    }
    return groups
  }, [visibleTransactions])

  const hasTransactionLoadError = !!transactionFetchError && transactions.length === 0
  const activeErrors = hasTransactionLoadError ? [] : [transactionFetchError]
  const hasActiveFilters =
    searchQuery.length > 0 ||
    typeFilter !== 'all' ||
    dateRange !== 'all' ||
    customFrom.length > 0 ||
    customTo.length > 0 ||
    accountFilter !== 'all' ||
    categoryFilter !== 'all' ||
    statusFilter !== 'all' ||
    currencyFilter !== 'all'

  const clearFilters = () => {
    setSearchQuery('')
    setTypeFilter('all')
    setDateRange('all')
    setCustomFrom('')
    setCustomTo('')
    setAccountFilter('all')
    setCategoryFilter('all')
    setStatusFilter('all')
    setCurrencyFilter('all')
  }

  const handleLedgerSort = (field: LedgerSortField) => {
    setLedgerSort((current) =>
      current.field === field
        ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: field === 'date' ? 'desc' : 'asc' }
    )
  }

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

  const reviewIndex = activeReviewId
    ? filteredReviewTransactions.findIndex((transaction) => transaction.id === activeReviewId)
    : -1

  const moveReviewFocus = useCallback(
    (direction: -1 | 1) => {
      if (filteredReviewTransactions.length === 0) return
      const initialIndex = direction === 1 ? -1 : filteredReviewTransactions.length
      const nextIndex = Math.max(
        0,
        Math.min(
          filteredReviewTransactions.length - 1,
          (reviewIndex === -1 ? initialIndex : reviewIndex) + direction
        )
      )
      const nextId = filteredReviewTransactions[nextIndex].id
      if (nextIndex >= visibleCount) setVisibleCount((count) => count + TRANSACTIONS_PAGE_SIZE)
      pendingReviewFocusId.current = nextId
      setActiveReviewId(nextId)
    },
    [filteredReviewTransactions, reviewIndex, visibleCount]
  )

  useEffect(() => {
    if (view !== 'review') return
    if (
      filteredReviewTransactions.length > 0 &&
      !filteredReviewTransactions.some((transaction) => transaction.id === activeReviewId)
    ) {
      setActiveReviewId(filteredReviewTransactions[0].id)
    }
  }, [activeReviewId, filteredReviewTransactions, view])

  useEffect(() => {
    const pendingId = pendingReviewFocusId.current
    if (!pendingId) return
    const row = reviewRowRefs.current.get(pendingId)
    if (row) {
      row.focus()
      pendingReviewFocusId.current = null
    }
  }, [activeReviewId, visibleTransactions])

  useEffect(() => {
    if (view !== 'review') return

    const handleReviewKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditingTarget(event.target)) return
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        moveReviewFocus(1)
      }
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        moveReviewFocus(-1)
      }
    }

    document.addEventListener('keydown', handleReviewKeyDown)
    return () => document.removeEventListener('keydown', handleReviewKeyDown)
  }, [moveReviewFocus, view])

  const handleReviewUpdate = async (
    transaction: TransactionWithDetails,
    fields: ReviewFieldUpdate
  ) => {
    setReviewMutationId(transaction.id)
    try {
      await updateReviewFields(transaction.id, fields)
      const message = t('review.updated', { description: transaction.description })
      setReviewAnnouncement(message)
      toast.success(message)
    } catch (error) {
      const message = getErrorMessage(error, t('toast.error'))
      setReviewAnnouncement(message)
      toast.error(message)
    } finally {
      setReviewMutationId(null)
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
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setStatementImportOpen(true)}>
            <Plus size={16} />
            {t('import.button')}
          </Button>
          <Button variant="outline" onClick={() => openRecurringDialog()}>
            <Plus size={16} />
            {t('recurring.addRule')}
          </Button>
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            {t('addTransaction')}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex rounded-xl border border-white/[0.1] bg-white/[0.03] p-1"
          role="tablist"
          aria-label={t('views.label')}
        >
          {transactionViews.map((transactionView) => (
            <button
              key={transactionView}
              id={`transactions-${transactionView}-tab`}
              type="button"
              role="tab"
              aria-selected={view === transactionView}
              aria-controls={`transactions-${transactionView}-panel`}
              onClick={() => setView(transactionView)}
              className={cn(
                'rounded-lg px-3 py-1.5 font-mono text-[11px] transition-colors sm:px-4',
                view === transactionView
                  ? 'text-accent-hover bg-white/[0.12] shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t(`views.${transactionView}`)}
            </button>
          ))}
        </div>
        {view === 'review' && (
          <div className="flex items-center gap-2" aria-label={t('review.navigation.label')}>
            <span className="text-muted-foreground font-mono text-[10px]" aria-live="polite">
              {filteredReviewTransactions.length > 0
                ? t('review.navigation.position', {
                    current: Math.max(1, reviewIndex + 1),
                    total: filteredReviewTransactions.length,
                  })
                : t('review.navigation.empty')}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => moveReviewFocus(-1)}
              disabled={reviewIndex <= 0}
            >
              <ChevronLeft size={14} />
              {t('review.navigation.previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => moveReviewFocus(1)}
              disabled={
                filteredReviewTransactions.length === 0 ||
                reviewIndex === filteredReviewTransactions.length - 1
              }
            >
              {t('review.navigation.next')}
              <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>

      <ErrorBanner
        title="Couldn’t load transactions"
        messages={activeErrors}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      <TransactionFilters
        t={t}
        tCommon={tCommon}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        customFrom={customFrom}
        onCustomFromChange={setCustomFrom}
        customTo={customTo}
        onCustomToChange={setCustomTo}
        accountFilter={accountFilter}
        onAccountFilterChange={setAccountFilter}
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        currencyFilter={currencyFilter}
        onCurrencyFilterChange={setCurrencyFilter}
        accounts={allAccounts}
        categories={categories}
        currencies={currencies}
        hasActiveFilters={hasActiveFilters}
        onClearFilters={clearFilters}
      />

      {view === 'review' && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('review.queueLabel')}>
          {reviewFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={reviewFilter === filter}
              onClick={() => setReviewFilter(filter)}
              className={cn(
                'rounded-full border px-3 py-1 font-mono text-[11px] transition-colors',
                reviewFilter === filter
                  ? 'border-accent/40 bg-accent/15 text-accent-hover'
                  : 'text-muted-foreground hover:text-foreground border-white/[0.1] hover:border-white/[0.2]'
              )}
            >
              {t(`review.filters.${filter}`)} ({reviewCounts[filter]})
            </button>
          ))}
        </div>
      )}

      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {reviewAnnouncement}
      </p>

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
      ) : orderedTransactions.length === 0 ? (
        <div className="liquid-card flex flex-col items-center justify-center py-12 text-center">
          <Search size={24} className="text-muted-foreground mb-3" />
          <p className="text-muted-foreground text-sm">
            {view === 'review' ? t('review.empty') : t('noMatching')}
          </p>
        </div>
      ) : (
        <div
          id={`transactions-${view}-panel`}
          role="tabpanel"
          aria-labelledby={`transactions-${view}-tab`}
        >
          {view === 'timeline' && (
            <div className="space-y-5">
              {Array.from(groupedByDate.entries()).map(([date, transactionGroup]) => (
                <div key={date}>
                  <h2 className="text-muted-foreground mb-2 font-mono text-xs tracking-[0.24em] uppercase">
                    {formatDateHeader(date)}
                  </h2>
                  <div className="liquid-card divide-y divide-white/[0.08] overflow-hidden p-1">
                    {transactionGroup.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        hasSplits={isSplit(transaction.id)}
                        onEdit={() => openTransactionDialog(transaction.id)}
                        onDelete={() => setDeleteId(transaction.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {view === 'ledger' && (
            <LedgerView
              transactions={visibleTransactions}
              sort={ledgerSort}
              isSplit={isSplit}
              onSort={handleLedgerSort}
              onEdit={(id) => openTransactionDialog(id)}
              onDelete={setDeleteId}
            />
          )}

          {view === 'review' && (
            <ReviewView
              transactions={visibleTransactions}
              accounts={allAccounts}
              categories={categories}
              activeReviewId={activeReviewId}
              reviewMutationId={reviewMutationId}
              rowRefs={reviewRowRefs}
              isSplit={isSplit}
              onActiveReviewChange={setActiveReviewId}
              onEdit={(id) => openTransactionDialog(id)}
              onDelete={setDeleteId}
              onUpdate={handleReviewUpdate}
            />
          )}

          {hasMoreTransactions && (
            <div className="liquid-card mt-5 flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:justify-between sm:text-left">
              <p className="text-muted-foreground text-xs">
                {t('pagination.summary', {
                  shown: visibleTransactions.length,
                  total: orderedTransactions.length,
                })}
              </p>
              <Button
                variant="outline"
                onClick={() => setVisibleCount((count) => count + TRANSACTIONS_PAGE_SIZE)}
              >
                {t('pagination.showMore', { count: TRANSACTIONS_PAGE_SIZE })}
              </Button>
            </div>
          )}
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

interface TransactionFiltersProps {
  t: TFunction<'transactions'>
  tCommon: TFunction<'common'>
  searchQuery: string
  onSearchQueryChange: (value: string) => void
  typeFilter: TypeFilter
  onTypeFilterChange: (value: TypeFilter) => void
  dateRange: DateRange
  onDateRangeChange: (value: DateRange) => void
  customFrom: string
  onCustomFromChange: (value: string) => void
  customTo: string
  onCustomToChange: (value: string) => void
  accountFilter: string
  onAccountFilterChange: (value: string) => void
  categoryFilter: string
  onCategoryFilterChange: (value: string) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (value: StatusFilter) => void
  currencyFilter: string
  onCurrencyFilterChange: (value: string) => void
  accounts: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  currencies: string[]
  hasActiveFilters: boolean
  onClearFilters: () => void
}

function TransactionFilters({
  t,
  tCommon,
  searchQuery,
  onSearchQueryChange,
  typeFilter,
  onTypeFilterChange,
  dateRange,
  onDateRangeChange,
  customFrom,
  onCustomFromChange,
  customTo,
  onCustomToChange,
  accountFilter,
  onAccountFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  statusFilter,
  onStatusFilterChange,
  currencyFilter,
  onCurrencyFilterChange,
  accounts,
  categories,
  currencies,
  hasActiveFilters,
  onClearFilters,
}: TransactionFiltersProps) {
  return (
    <div className="liquid-card flex flex-wrap items-center gap-2 p-3">
      <div className="relative basis-full md:min-w-[220px] md:flex-1">
        <Search
          size={14}
          className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
        />
        <Input
          aria-label={t('filters.search')}
          placeholder={`${tCommon('actions.search')}...`}
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={t('filters.type')}>
        {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => onTypeFilterChange(type)}
            aria-pressed={typeFilter === type}
            className={cn(
              'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
              typeFilter === type
                ? 'text-accent-hover bg-white/[0.1]'
                : 'text-muted-foreground hover:text-foreground hover:bg-white/[0.08]'
            )}
          >
            {type === 'all' ? t('types.all') : t(`types.${type}`)}
          </button>
        ))}
      </div>
      <label className="sr-only" htmlFor="transaction-date-range">
        {t('filters.dateRange')}
      </label>
      <select
        id="transaction-date-range"
        aria-label={t('filters.dateRange')}
        value={dateRange}
        onChange={(event) => onDateRangeChange(event.target.value as DateRange)}
        className="border-input bg-background h-9 rounded-md border px-2 text-xs"
      >
        {dateRanges.map((range) => (
          <option key={range} value={range}>
            {t(`filters.dates.${range}`)}
          </option>
        ))}
      </select>
      {dateRange === 'custom' && (
        <>
          <label className="sr-only" htmlFor="transaction-date-from">
            {t('filters.from')}
          </label>
          <Input
            id="transaction-date-from"
            aria-label={t('filters.from')}
            type="date"
            value={customFrom}
            onChange={(event) => onCustomFromChange(event.target.value)}
            className="h-9 w-[145px] text-xs"
          />
          <label className="sr-only" htmlFor="transaction-date-to">
            {t('filters.to')}
          </label>
          <Input
            id="transaction-date-to"
            aria-label={t('filters.to')}
            type="date"
            value={customTo}
            onChange={(event) => onCustomToChange(event.target.value)}
            className="h-9 w-[145px] text-xs"
          />
        </>
      )}
      <FilterSelect
        id="transaction-account-filter"
        label={t('filters.account')}
        value={accountFilter}
        onChange={onAccountFilterChange}
        options={accounts.map((account) => ({ value: account.id, label: account.name }))}
      />
      <FilterSelect
        id="transaction-category-filter"
        label={t('filters.category')}
        value={categoryFilter}
        onChange={onCategoryFilterChange}
        options={categories.map((category) => ({ value: category.id, label: category.name }))}
      />
      <FilterSelect
        id="transaction-status-filter"
        label={t('filters.status')}
        value={statusFilter}
        onChange={(value) => onStatusFilterChange(value as StatusFilter)}
        options={(['posted', 'pending', 'cleared'] as const).map((status) => ({
          value: status,
          label: t(`status.${status}`),
        }))}
      />
      <FilterSelect
        id="transaction-currency-filter"
        label={t('filters.currency')}
        value={currencyFilter}
        onChange={onCurrencyFilterChange}
        options={currencies.map((currency) => ({ value: currency, label: currency }))}
      />
      {hasActiveFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
          {t('filters.clear')}
        </Button>
      )}
    </div>
  )
}

function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background h-9 max-w-36 rounded-md border px-2 text-xs"
      >
        <option value={EMPTY_FILTER_VALUE}>{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  )
}

function LedgerView({
  transactions,
  sort,
  isSplit,
  onSort,
  onEdit,
  onDelete,
}: {
  transactions: TransactionWithDetails[]
  sort: { field: LedgerSortField; direction: SortDirection }
  isSplit: (id: string) => boolean
  onSort: (field: LedgerSortField) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation('transactions')

  return (
    <>
      <div className="liquid-card hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-background/95 text-muted-foreground sticky top-0 z-10 backdrop-blur">
            <tr className="border-b border-white/[0.1] font-mono text-[10px] tracking-[0.12em] uppercase">
              <SortableLedgerHeader
                label={t('ledger.date')}
                field="date"
                sort={sort}
                onSort={onSort}
              />
              <SortableLedgerHeader
                label={t('ledger.description')}
                field="description"
                sort={sort}
                onSort={onSort}
              />
              <th className="px-3 py-3 font-medium">{t('ledger.account')}</th>
              <th className="px-3 py-3 font-medium">{t('ledger.category')}</th>
              <th className="px-3 py-3 font-medium">{t('ledger.status')}</th>
              <th className="px-3 py-3 font-medium">{t('ledger.source')}</th>
              <th className="px-3 py-3 text-right font-medium">{t('ledger.debit')}</th>
              <th className="px-4 py-3 text-right font-medium">{t('ledger.credit')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.08]">
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="hover:bg-white/[0.03]">
                <td className="px-3 py-3 text-xs whitespace-nowrap">
                  {dayjs(transaction.date).format('MMM D, YYYY')}
                </td>
                <td className="min-w-52 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{transaction.description}</span>
                    <TransactionActions
                      transaction={transaction}
                      onEdit={() => onEdit(transaction.id)}
                      onDelete={() => onDelete(transaction.id)}
                      canEdit={!isSplit(transaction.id)}
                      compact
                    />
                  </div>
                </td>
                <td className="px-3 py-3 text-xs">{getLedgerAccountLabel(transaction)}</td>
                <td className="px-3 py-3 text-xs">{transaction.category_name ?? '—'}</td>
                <td className="px-3 py-3">
                  <StatusBadge transaction={transaction} />
                </td>
                <td className="max-w-28 px-3 py-3">
                  <SourceBadge transaction={transaction} />
                </td>
                <td className="text-destructive px-3 py-3 text-right font-mono text-xs whitespace-nowrap">
                  {transaction.type === 'expense' || transaction.type === 'transfer'
                    ? formatMoney(transaction.amount, transaction.currency)
                    : '—'}
                </td>
                <td className="text-success px-4 py-3 text-right font-mono text-xs whitespace-nowrap">
                  {transaction.type === 'income' || transaction.type === 'transfer'
                    ? formatMoney(transaction.amount, transaction.currency)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 md:hidden">
        {transactions.map((transaction) => (
          <div key={transaction.id} className="liquid-card space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{transaction.description}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {dayjs(transaction.date).format('MMM D, YYYY')} ·{' '}
                  {getLedgerAccountLabel(transaction)}
                </p>
              </div>
              <TransactionActions
                transaction={transaction}
                onEdit={() => onEdit(transaction.id)}
                onDelete={() => onDelete(transaction.id)}
                canEdit={!isSplit(transaction.id)}
              />
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <LedgerDetail label={t('ledger.category')} value={transaction.category_name ?? '—'} />
              <LedgerDetail
                label={t('ledger.status')}
                value={<StatusBadge transaction={transaction} />}
              />
              <LedgerDetail
                label={t('ledger.source')}
                value={<SourceBadge transaction={transaction} />}
              />
              <LedgerDetail
                label={t('ledger.debit')}
                value={
                  transaction.type === 'expense' || transaction.type === 'transfer'
                    ? formatMoney(transaction.amount, transaction.currency)
                    : '—'
                }
              />
              <LedgerDetail
                label={t('ledger.credit')}
                value={
                  transaction.type === 'income' || transaction.type === 'transfer'
                    ? formatMoney(transaction.amount, transaction.currency)
                    : '—'
                }
              />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function SortableLedgerHeader({
  label,
  field,
  sort,
  onSort,
}: {
  label: string
  field: LedgerSortField
  sort: { field: LedgerSortField; direction: SortDirection }
  onSort: (field: LedgerSortField) => void
}) {
  const isActive = sort.field === field
  return (
    <th
      className="px-3 py-3 font-medium"
      aria-sort={isActive ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="hover:text-foreground inline-flex items-center gap-1 transition-colors"
      >
        {label}
        {isActive && (sort.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  )
}

function LedgerDetail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
        {label}
      </p>
      <div className="text-foreground mt-0.5 truncate">{value}</div>
    </div>
  )
}

function ReviewView({
  transactions,
  accounts,
  categories,
  activeReviewId,
  reviewMutationId,
  rowRefs,
  isSplit,
  onActiveReviewChange,
  onEdit,
  onDelete,
  onUpdate,
}: {
  transactions: TransactionWithDetails[]
  accounts: {
    id: string
    name: string
    currency: string
    is_archived: number
    account_mode?: string
  }[]
  categories: { id: string; name: string; type: string }[]
  activeReviewId: string | null
  reviewMutationId: string | null
  rowRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  isSplit: (id: string) => boolean
  onActiveReviewChange: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onUpdate: (transaction: TransactionWithDetails, fields: ReviewFieldUpdate) => Promise<void>
}) {
  const { t } = useTranslation('transactions')

  return (
    <div className="space-y-3">
      {transactions.map((transaction) => {
        const hasSplits = isSplit(transaction.id)
        const protectionKey = getReviewProtectionKey(transaction, hasSplits)
        const categoriesForType = categories.filter(
          (category) => category.type === transaction.type
        )
        const accountsForCurrency = accounts.filter(
          (account) =>
            account.is_archived === 0 &&
            (account.account_mode ?? 'transactional') === 'transactional' &&
            account.currency === transaction.currency
        )
        const isMutable = !protectionKey
        const isUpdating = reviewMutationId === transaction.id

        return (
          <div
            key={transaction.id}
            ref={(element) => {
              if (element) rowRefs.current.set(transaction.id, element)
              else rowRefs.current.delete(transaction.id)
            }}
            tabIndex={activeReviewId === transaction.id ? 0 : -1}
            onFocus={() => onActiveReviewChange(transaction.id)}
            className={cn(
              'liquid-card focus-visible:ring-accent rounded-2xl p-4 transition-shadow outline-none focus-visible:ring-2',
              activeReviewId === transaction.id && 'ring-accent/30 ring-1'
            )}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{transaction.description}</p>
                  <StatusBadge transaction={transaction} />
                  <SourceBadge transaction={transaction} />
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  {dayjs(transaction.date).format('MMM D, YYYY')} ·{' '}
                  {transaction.account_name ?? '—'} · {transaction.type === 'income' ? '+' : '-'}
                  {formatMoney(transaction.amount, transaction.currency)}
                </p>
              </div>
              {isMutable && (
                <TransactionActions
                  transaction={transaction}
                  onEdit={() => onEdit(transaction.id)}
                  onDelete={() => onDelete(transaction.id)}
                />
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              {getReviewReasons(transaction, hasSplits).map((reason) => (
                <Badge key={reason} variant="secondary" className="text-[10px]">
                  {t(`review.reasons.${reason}`)}
                </Badge>
              ))}
            </div>

            {isMutable ? (
              <div className="mt-4 grid gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 sm:grid-cols-2">
                <InlineReviewSelect
                  id={`review-category-${transaction.id}`}
                  label={t('review.category')}
                  value={transaction.category_id ?? EMPTY_CATEGORY_VALUE}
                  placeholder={t('form.categoryNone')}
                  options={categoriesForType}
                  disabled={isUpdating}
                  onChange={(value) =>
                    onUpdate(transaction, {
                      categoryId: value === EMPTY_CATEGORY_VALUE ? null : value,
                    })
                  }
                />
                <InlineReviewSelect
                  id={`review-account-${transaction.id}`}
                  label={t('review.account')}
                  value={transaction.account_id}
                  options={accountsForCurrency}
                  disabled={isUpdating || accountsForCurrency.length === 0}
                  onChange={(value) => onUpdate(transaction, { accountId: value })}
                />
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3">
                <p className="text-xs text-amber-200">{t(protectionKey)}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(transaction.id)}
                >
                  {hasSplits ? t('review.reviewSplit') : t('editTransaction')}
                </Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function InlineReviewSelect({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onChange,
}: {
  id: string
  label: string
  value: string
  placeholder?: string
  options: { id: string; name: string }[]
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-background mt-1 h-9 w-full rounded-md border px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
      >
        {placeholder && <option value={EMPTY_CATEGORY_VALUE}>{placeholder}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </div>
  )
}

function TransactionsSkeleton() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }).map((_, groupIndex) => (
        <div key={groupIndex}>
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="liquid-card flex items-center gap-3 px-4 py-3">
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
  transaction,
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
      const data = await getSplits(transaction.id)
      setSplits(data)
      setExpanded(true)
    } finally {
      setLoadingSplits(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-[22px]">
      <div className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]">
        {transaction.category_color ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: transaction.category_color }}
          />
        ) : (
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{transaction.description}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {transaction.category_name && <span>{transaction.category_name}</span>}
            {transaction.account_name && (
              <Badge variant="secondary" className="text-[10px]">
                {transaction.account_name}
              </Badge>
            )}
            <StatusBadge transaction={transaction} />
            <SourceBadge transaction={transaction} />
            {hasSplits && (
              <button
                type="button"
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
          className={cn(
            'font-heading text-sm font-semibold',
            transaction.type === 'income' ? 'text-success' : 'text-destructive'
          )}
        >
          {transaction.type === 'income' ? '+' : '-'}
          {formatMoney(transaction.amount, transaction.currency)}
        </span>
        <span className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          {dayjs(transaction.date).format('MMM D')}
        </span>
        <TransactionActions
          transaction={transaction}
          onEdit={onEdit}
          onDelete={onDelete}
          canEdit={!hasSplits}
        />
      </div>

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
                    {formatMoney(split.amount, transaction.currency)}
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

function TransactionActions({
  transaction,
  onEdit,
  onDelete,
  canEdit = true,
  compact = false,
}: {
  transaction: TransactionWithDetails
  onEdit: () => void
  onDelete: () => void
  canEdit?: boolean
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100',
        compact && 'md:opacity-100'
      )}
    >
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onEdit}
          aria-label={`Edit ${transaction.description}`}
        >
          <Pencil size={12} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive h-7 w-7"
        onClick={onDelete}
        aria-label={`Delete ${transaction.description}`}
      >
        <Trash2 size={12} />
      </Button>
    </div>
  )
}

function StatusBadge({ transaction }: { transaction: TransactionWithDetails }) {
  const { t } = useTranslation('transactions')
  const status = getTransactionStatus(transaction)
  return (
    <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusBadgeClass(status))}>
      {t(`status.${status}`)}
    </Badge>
  )
}

function SourceBadge({ transaction }: { transaction: TransactionWithDetails }) {
  const { t } = useTranslation('transactions')
  const source = getTransactionSource(transaction)
  return (
    <Badge
      variant="outline"
      className="text-muted-foreground max-w-28 shrink-0 truncate text-[10px]"
    >
      {source === 'manual' ? t('source.manual') : sourceLabel(source)}
    </Badge>
  )
}
