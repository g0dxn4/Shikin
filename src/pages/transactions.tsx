import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { ReviewFieldUpdate } from '@/stores/transaction-store'
import { useAccountStore } from '@/stores/account-store'
import { useCategoryStore } from '@/stores/category-store'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import type { TransactionSplitWithCategory } from '@/types/database'
import { StatementImportDialog } from '@/components/transactions/statement-import-dialog'
import { useTransactionPageQuery } from '@/hooks/use-transaction-page-query'
import {
  TRANSACTION_PAGE_SIZES,
  type TransactionPageRequest,
  type TransactionPageRow,
  type TransactionPageSize,
  type TransactionQueryStatus,
  type TransactionQueryType,
  type TransactionReviewReason,
  type TransactionSort,
  type TransactionSortDirection,
} from '@/lib/transaction-query'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((module) => ({
    default: module.ConfirmDialog,
  }))
)

const TRANSACTION_VIEW_STORAGE_KEY = 'shikin.transactions.view'
const EMPTY_FILTER_VALUE = 'all'
const EMPTY_CATEGORY_VALUE = '__none__'
const transactionViews = ['timeline', 'ledger', 'review'] as const
const reviewFilters: TransactionReviewReason[] = [
  'all',
  'needs-category',
  'pending',
  'placeholder',
  'staged',
]
const sortableFields: TransactionSort[] = ['date', 'description', 'amount']

type TransactionView = (typeof transactionViews)[number]
type DatePreset = 'all' | 'month' | '30-days' | '90-days' | 'custom'
type ReviewProtectionKey =
  | 'review.protected.split'
  | 'review.protected.receivable'
  | 'review.protected.reconciliation'
  | 'review.protected.finalized'
  | 'review.protected.linked'
  | 'review.protected.workflow'
  | 'review.protected.transfer'
  | 'review.protected.placeholderLifecycle'

interface TransactionUrlState {
  search: string
  type: TransactionQueryType
  account: string
  category: string
  dateFrom: string
  dateTo: string
  status: TransactionQueryStatus
  currency: string
  view: TransactionView
  page: number
  pageSize: TransactionPageSize
  sort: TransactionSort
  direction: TransactionSortDirection
  reviewReason: TransactionReviewReason
}

function getStoredTransactionView(): TransactionView {
  if (typeof window === 'undefined') return 'timeline'
  try {
    const stored = window.localStorage.getItem(TRANSACTION_VIEW_STORAGE_KEY)
    return transactionViews.includes(stored as TransactionView)
      ? (stored as TransactionView)
      : 'timeline'
  } catch {
    return 'timeline'
  }
}

function enumParam<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function readUrlState(): TransactionUrlState {
  const params = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search)
  return {
    search: params.get('search') ?? '',
    type: enumParam(params.get('type'), ['all', 'expense', 'income', 'transfer'], 'all'),
    account: params.get('account') || 'all',
    category: params.get('category') || 'all',
    dateFrom: params.get('dateFrom') ?? '',
    dateTo: params.get('dateTo') ?? '',
    status: enumParam(params.get('status'), ['all', 'posted', 'pending', 'cleared'], 'all'),
    currency: params.get('currency') || 'all',
    view: enumParam(
      params.get('view'),
      transactionViews,
      params.has('reviewReason') ? 'review' : getStoredTransactionView()
    ),
    page: positiveInt(params.get('page'), 1),
    pageSize: Number(
      enumParam(params.get('pageSize'), TRANSACTION_PAGE_SIZES.map(String), '50')
    ) as TransactionPageSize,
    sort: enumParam(
      params.get('sort'),
      ['date', 'description', 'amount', 'account', 'category', 'type', 'status', 'source'],
      'date'
    ),
    direction: enumParam(params.get('direction'), ['asc', 'desc'], 'desc'),
    reviewReason: enumParam(params.get('reviewReason'), reviewFilters, 'all'),
  }
}

function serializeUrlState(state: TransactionUrlState): string {
  const params = new URLSearchParams()
  if (state.search) params.set('search', state.search)
  if (state.type !== 'all') params.set('type', state.type)
  if (state.account !== 'all') params.set('account', state.account)
  if (state.category !== 'all') params.set('category', state.category)
  if (state.dateFrom) params.set('dateFrom', state.dateFrom)
  if (state.dateTo) params.set('dateTo', state.dateTo)
  if (state.status !== 'all') params.set('status', state.status)
  if (state.currency !== 'all') params.set('currency', state.currency)
  if (state.view !== 'timeline') params.set('view', state.view)
  if (state.page !== 1) params.set('page', String(state.page))
  if (state.pageSize !== 50) params.set('pageSize', String(state.pageSize))
  if (state.sort !== 'date') params.set('sort', state.sort)
  if (state.direction !== 'desc') params.set('direction', state.direction)
  if (state.reviewReason !== 'all') params.set('reviewReason', state.reviewReason)
  const queryString = params.toString()
  return `${window.location.pathname}${queryString ? `?${queryString}` : ''}${window.location.hash}`
}

function getDatePreset(dateFrom: string, dateTo: string): DatePreset {
  if (!dateFrom && !dateTo) return 'all'
  const today = dayjs().format('YYYY-MM-DD')
  if (
    dateFrom === dayjs().startOf('month').format('YYYY-MM-DD') &&
    dateTo === dayjs().endOf('month').format('YYYY-MM-DD')
  )
    return 'month'
  if (dateFrom === dayjs().subtract(29, 'day').format('YYYY-MM-DD') && dateTo === today)
    return '30-days'
  if (dateFrom === dayjs().subtract(89, 'day').format('YYYY-MM-DD') && dateTo === today)
    return '90-days'
  return 'custom'
}

function getTransactionStatus(
  transaction: TransactionPageRow
): Exclude<TransactionQueryStatus, 'all'> {
  const status = transaction.status?.trim()
  return status === 'pending' || status === 'cleared' ? status : 'posted'
}

function getTransactionSource(transaction: TransactionPageRow): string {
  return transaction.source ?? transaction.import_source ?? 'manual'
}

function getLedgerAccountLabel(transaction: TransactionPageRow): string {
  const source = transaction.account_name ?? '—'
  return transaction.type === 'transfer'
    ? `${source} → ${transaction.transfer_to_account_name ?? '—'}`
    : source
}

function getReviewReasons(
  transaction: TransactionPageRow
): Exclude<TransactionReviewReason, 'all'>[] {
  const reasons: Exclude<TransactionReviewReason, 'all'>[] = []
  if (
    (transaction.type === 'expense' || transaction.type === 'income') &&
    transaction.category_id === null &&
    !transaction.has_splits
  )
    reasons.push('needs-category')
  if (getTransactionStatus(transaction) === 'pending') reasons.push('pending')
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') === 'unresolved'
  )
    reasons.push('placeholder')
  if (transaction.ledger_treatment === 'staged_no_balance_impact') reasons.push('staged')
  return reasons
}

function getReviewProtectionKey(transaction: TransactionPageRow): ReviewProtectionKey | null {
  if (transaction.has_splits) return 'review.protected.split'
  if (transaction.is_receivable_payment) return 'review.protected.receivable'
  if (transaction.is_reconciliation_adjustment) return 'review.protected.reconciliation'
  if (transaction.is_finalized_statement) return 'review.protected.finalized'
  if (transaction.matched_transaction_id) return 'review.protected.linked'
  if ((transaction.transaction_kind ?? 'standard') !== 'standard')
    return 'review.protected.workflow'
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') !== 'unresolved'
  )
    return 'review.protected.placeholderLifecycle'
  if (transaction.type === 'transfer') return 'review.protected.transfer'
  return null
}

function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'SELECT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'BUTTON'
  )
}

function pageNumbers(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  const candidates = new Set([1, total, current - 1, current, current + 1])
  const ordered = [...candidates]
    .filter((value) => value >= 1 && value <= total)
    .sort((a, b) => a - b)
  const result: Array<number | 'ellipsis'> = []
  ordered.forEach((value, index) => {
    if (index > 0 && value - ordered[index - 1] > 1) result.push('ellipsis')
    result.push(value)
  })
  return result
}

export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog, openRecurringDialog } = useUIStore()
  const { remove, getSplits, updateReviewFields } = useTransactionStore()
  const { accounts, archivedAccounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()
  const [urlState, setUrlState] = useState(readUrlState)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [statementImportOpen, setStatementImportOpen] = useState(false)
  const [detailTransaction, setDetailTransaction] = useState<TransactionPageRow | null>(null)
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null)
  const [reviewAnnouncement, setReviewAnnouncement] = useState('')
  const reviewRowRefs = useRef(new Map<string, HTMLDivElement>())
  const deferredSearch = useDeferredValue(urlState.search)

  useEffect(() => {
    void Promise.allSettled([fetchAccounts(), fetchCategories()])
  }, [fetchAccounts, fetchCategories])

  useEffect(() => {
    const handlePopState = () => setUrlState(readUrlState())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(TRANSACTION_VIEW_STORAGE_KEY, urlState.view)
    } catch {
      // The URL remains authoritative when device storage is unavailable.
    }
  }, [urlState.view])

  const updateUrlState = useCallback(
    (
      patch: Partial<TransactionUrlState>,
      options: { resetPage?: boolean; replace?: boolean } = {}
    ) => {
      setUrlState((current) => {
        const next = { ...current, ...patch }
        if (options.resetPage !== false) next.page = 1
        const nextUrl = serializeUrlState(next)
        if (options.replace) window.history.replaceState(null, '', nextUrl)
        else window.history.pushState(null, '', nextUrl)
        return next
      })
    },
    []
  )

  const request = useMemo<TransactionPageRequest>(
    () => ({
      search: deferredSearch,
      type: urlState.type,
      account: urlState.account,
      category: urlState.category,
      dateFrom: urlState.dateFrom,
      dateTo: urlState.dateTo,
      status: urlState.status,
      currency: urlState.currency,
      reviewReason: urlState.view === 'review' ? urlState.reviewReason : undefined,
      sort: urlState.view === 'ledger' ? urlState.sort : 'date',
      direction: urlState.view === 'ledger' ? urlState.direction : 'desc',
      page: urlState.page,
      pageSize: urlState.pageSize,
    }),
    [deferredSearch, urlState]
  )
  const pageQuery = useTransactionPageQuery(request)
  const totalPages = Math.max(1, Math.ceil(pageQuery.total / urlState.pageSize))
  const firstVisible = pageQuery.total === 0 ? 0 : (urlState.page - 1) * urlState.pageSize + 1
  const lastVisible = Math.min(urlState.page * urlState.pageSize, pageQuery.total)
  const allAccounts = useMemo(
    () => [...accounts, ...archivedAccounts],
    [accounts, archivedAccounts]
  )
  const datePreset = getDatePreset(urlState.dateFrom, urlState.dateTo)
  const hasActiveFilters =
    !!urlState.search ||
    urlState.type !== 'all' ||
    urlState.account !== 'all' ||
    urlState.category !== 'all' ||
    !!urlState.dateFrom ||
    !!urlState.dateTo ||
    urlState.status !== 'all' ||
    urlState.currency !== 'all'

  useEffect(() => {
    if (!pageQuery.isLoading && urlState.page > totalPages) {
      updateUrlState({ page: totalPages }, { resetPage: false, replace: true })
    }
  }, [pageQuery.isLoading, totalPages, updateUrlState, urlState.page])

  useEffect(() => {
    if (detailTransaction && !pageQuery.rows.some((row) => row.id === detailTransaction.id)) {
      setDetailTransaction(null)
    }
  }, [detailTransaction, pageQuery.rows])

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, TransactionPageRow[]>()
    pageQuery.rows.forEach((transaction) => {
      const current = groups.get(transaction.date) ?? []
      current.push(transaction)
      groups.set(transaction.date, current)
    })
    return groups
  }, [pageQuery.rows])

  const clearFilters = () =>
    updateUrlState({
      search: '',
      type: 'all',
      account: 'all',
      category: 'all',
      dateFrom: '',
      dateTo: '',
      status: 'all',
      currency: 'all',
    })

  const handleDatePreset = (preset: DatePreset) => {
    const today = dayjs().format('YYYY-MM-DD')
    if (preset === 'all') return updateUrlState({ dateFrom: '', dateTo: '' })
    if (preset === 'month')
      return updateUrlState({
        dateFrom: dayjs().startOf('month').format('YYYY-MM-DD'),
        dateTo: dayjs().endOf('month').format('YYYY-MM-DD'),
      })
    if (preset === '30-days')
      return updateUrlState({
        dateFrom: dayjs().subtract(29, 'day').format('YYYY-MM-DD'),
        dateTo: today,
      })
    if (preset === '90-days')
      return updateUrlState({
        dateFrom: dayjs().subtract(89, 'day').format('YYYY-MM-DD'),
        dateTo: today,
      })
    updateUrlState({ dateFrom: urlState.dateFrom, dateTo: urlState.dateTo })
  }

  const handleViewChange = (view: TransactionView) => updateUrlState({ view })
  const handleSort = (field: TransactionSort) => {
    if (!sortableFields.includes(field)) return
    updateUrlState({
      sort: field,
      direction:
        urlState.sort === field
          ? urlState.direction === 'asc'
            ? 'desc'
            : 'asc'
          : field === 'date'
            ? 'desc'
            : 'asc',
    })
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      invalidateTransactionPage('delete')
      toast.success(t('toast.deleted'))
      setDeleteId(null)
      setDetailTransaction(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleReviewUpdate = async (transaction: TransactionPageRow, fields: ReviewFieldUpdate) => {
    setReviewMutationId(transaction.id)
    try {
      await updateReviewFields(transaction.id, fields)
      invalidateTransactionPage('review')
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

  const reviewIndex = activeReviewId
    ? pageQuery.rows.findIndex((transaction) => transaction.id === activeReviewId)
    : -1
  const moveReviewFocus = useCallback(
    (direction: -1 | 1) => {
      if (pageQuery.rows.length === 0) return
      const initial = direction === 1 ? -1 : pageQuery.rows.length
      const nextIndex = Math.max(
        0,
        Math.min(
          pageQuery.rows.length - 1,
          (reviewIndex === -1 ? initial : reviewIndex) + direction
        )
      )
      const nextId = pageQuery.rows[nextIndex]?.id
      if (!nextId) return
      setActiveReviewId(nextId)
      requestAnimationFrame(() => reviewRowRefs.current.get(nextId)?.focus())
    },
    [pageQuery.rows, reviewIndex]
  )

  useEffect(() => {
    if (urlState.view !== 'review') return
    if (pageQuery.rows.length > 0 && !pageQuery.rows.some((row) => row.id === activeReviewId))
      setActiveReviewId(pageQuery.rows[0].id)
  }, [activeReviewId, pageQuery.rows, urlState.view])

  useEffect(() => {
    if (urlState.view !== 'review') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditingTarget(event.target)) return
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        moveReviewFocus(1)
      } else if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        moveReviewFocus(-1)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [moveReviewFocus, urlState.view])

  return (
    <div className="page-content animate-fade-in-up space-y-4">
      <PageToolbar
        leading={
          <div
            className="bg-muted flex rounded-lg p-0.5"
            role="tablist"
            aria-label={t('views.label')}
          >
            {transactionViews.map((view) => (
              <button
                key={view}
                id={`transactions-${view}-tab`}
                type="button"
                role="tab"
                aria-selected={urlState.view === view}
                aria-controls={`transactions-${view}-panel`}
                onClick={() => handleViewChange(view)}
                className={cn(
                  'filter-pill min-h-9',
                  urlState.view === view && 'filter-pill-active'
                )}
              >
                {t(`views.${view}`)}
              </button>
            ))}
          </div>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setStatementImportOpen(true)}>
              {t('import.button')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openRecurringDialog()}>
              {t('recurring.addRule')}
            </Button>
            <Button size="sm" onClick={() => openTransactionDialog()}>
              <Plus size={15} />
              {t('addTransaction')}
            </Button>
          </>
        }
      />

      <MetricStrip aria-label={t('summary.label')}>
        <MetricItem
          label={t('summary.results')}
          value={pageQuery.total}
          detail={t('summary.resultsDetail')}
        />
        <MetricItem
          label={t('summary.review')}
          value={pageQuery.reviewCounts.all}
          detail={t('summary.reviewDetail')}
        />
        <MetricItem
          label={t('summary.currencies')}
          value={pageQuery.currencies.length}
          detail={t('summary.currenciesDetail')}
        />
      </MetricStrip>

      <TransactionFilters
        t={t}
        tCommon={tCommon}
        state={urlState}
        datePreset={datePreset}
        accounts={allAccounts}
        categories={categories}
        currencies={pageQuery.currencies}
        hasActiveFilters={hasActiveFilters}
        onPatch={(patch) => updateUrlState(patch)}
        onSearch={(search) => updateUrlState({ search }, { replace: true })}
        onDatePreset={handleDatePreset}
        onClear={clearFilters}
      />

      {urlState.view === 'review' && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label={t('review.queueLabel')}
        >
          {reviewFilters.map((filter) => (
            <button
              key={filter}
              type="button"
              aria-pressed={urlState.reviewReason === filter}
              onClick={() => updateUrlState({ reviewReason: filter })}
              className="filter-pill border-border border"
            >
              {t(`review.filters.${filter}`)} ({pageQuery.reviewCounts[filter]})
            </button>
          ))}
        </div>
      )}

      <ErrorBanner
        title={t('loadError.title')}
        message={pageQuery.rows.length > 0 ? pageQuery.error : null}
        onRetry={() => invalidateTransactionPage('review')}
      />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {reviewAnnouncement}
      </p>

      {pageQuery.isLoading && pageQuery.rows.length === 0 ? (
        <TransactionsSkeleton />
      ) : pageQuery.error && pageQuery.rows.length === 0 ? (
        <ErrorState
          title={t('loadError.title')}
          description={pageQuery.error}
          onRetry={() => invalidateTransactionPage('review')}
        />
      ) : pageQuery.total === 0 && !hasActiveFilters && urlState.view !== 'review' ? (
        <NativePanel className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="bg-accent-muted text-accent mb-4 grid h-12 w-12 place-items-center rounded-xl">
            <ArrowLeftRight size={23} />
          </span>
          <h2 className="text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mt-1 max-w-sm text-sm">{t('empty.description')}</p>
          <Button className="mt-4" onClick={() => openTransactionDialog()}>
            <Plus size={16} /> {t('addTransaction')}
          </Button>
        </NativePanel>
      ) : pageQuery.rows.length === 0 ? (
        <NativePanel className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <Search size={22} className="text-muted-foreground" />
          <h2 className="mt-3 text-base font-semibold">
            {urlState.view === 'review' ? t('review.empty') : t('noMatching')}
          </h2>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
              {t('filters.clear')}
            </Button>
          )}
        </NativePanel>
      ) : (
        <div
          id={`transactions-${urlState.view}-panel`}
          role="tabpanel"
          aria-labelledby={`transactions-${urlState.view}-tab`}
        >
          {urlState.view === 'timeline' && (
            <div className="space-y-5">
              {[...groupedByDate.entries()].map(([date, group]) => (
                <section key={date} aria-labelledby={`date-${date}`}>
                  <h2
                    id={`date-${date}`}
                    className="text-muted-foreground mb-2 text-xs font-semibold"
                  >
                    {date === dayjs().format('YYYY-MM-DD')
                      ? t('dateHeaders.today')
                      : date === dayjs().subtract(1, 'day').format('YYYY-MM-DD')
                        ? t('dateHeaders.yesterday')
                        : dayjs(date).format('ddd, MMM D')}
                  </h2>
                  <NativePanel className="divide-border divide-y overflow-hidden">
                    {group.map((transaction) => (
                      <TransactionRow
                        key={transaction.id}
                        transaction={transaction}
                        getSplits={getSplits}
                        onDetails={() => setDetailTransaction(transaction)}
                        onEdit={() => openTransactionDialog(transaction.id)}
                        onDelete={() => setDeleteId(transaction.id)}
                      />
                    ))}
                  </NativePanel>
                </section>
              ))}
            </div>
          )}
          {urlState.view === 'ledger' && (
            <LedgerView
              transactions={pageQuery.rows}
              sort={{ field: urlState.sort, direction: urlState.direction }}
              onSort={handleSort}
              onDetails={setDetailTransaction}
              onEdit={(id) => openTransactionDialog(id)}
              onDelete={setDeleteId}
            />
          )}
          {urlState.view === 'review' && (
            <ReviewView
              transactions={pageQuery.rows}
              accounts={allAccounts}
              categories={categories}
              activeReviewId={activeReviewId}
              reviewMutationId={reviewMutationId}
              rowRefs={reviewRowRefs}
              onActiveReviewChange={setActiveReviewId}
              onEdit={(id) => openTransactionDialog(id)}
              onDelete={setDeleteId}
              onUpdate={handleReviewUpdate}
            />
          )}
          <Pagination
            currentPage={urlState.page}
            totalPages={totalPages}
            pageSize={urlState.pageSize}
            firstVisible={firstVisible}
            lastVisible={lastVisible}
            total={pageQuery.total}
            t={t}
            onPage={(page) => updateUrlState({ page }, { resetPage: false })}
            onPageSize={(pageSize) => updateUrlState({ pageSize })}
          />
        </div>
      )}

      <TransactionDetail
        transaction={detailTransaction}
        open={!!detailTransaction}
        onOpenChange={(open) => !open && setDetailTransaction(null)}
        onEdit={(id) => {
          setDetailTransaction(null)
          openTransactionDialog(id)
        }}
        onDelete={(id) => setDeleteId(id)}
      />
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

function TransactionFilters({
  t,
  tCommon,
  state,
  datePreset,
  accounts,
  categories,
  currencies,
  hasActiveFilters,
  onPatch,
  onSearch,
  onDatePreset,
  onClear,
}: {
  t: TFunction<'transactions'>
  tCommon: TFunction<'common'>
  state: TransactionUrlState
  datePreset: DatePreset
  accounts: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  currencies: string[]
  hasActiveFilters: boolean
  onPatch: (patch: Partial<TransactionUrlState>) => void
  onSearch: (value: string) => void
  onDatePreset: (preset: DatePreset) => void
  onClear: () => void
}) {
  return (
    <NativePanel as="div" className="p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] flex-1">
          <span className="sr-only">{t('filters.search')}</span>
          <Search
            size={15}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <Input
            type="search"
            value={state.search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('filters.searchPlaceholder') || `${tCommon('actions.search')}...`}
            className="pl-9"
          />
        </label>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('filters.type')}>
          {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="filter-pill"
              aria-pressed={state.type === type}
              onClick={() => onPatch({ type })}
            >
              {t(`types.${type}`)}
            </button>
          ))}
        </div>
        <FilterSelect
          label={t('filters.dateRange')}
          value={datePreset}
          onChange={(value) => onDatePreset(value as DatePreset)}
          options={(['all', 'month', '30-days', '90-days', 'custom'] as const).map((value) => ({
            value,
            label: t(`filters.dates.${value}`),
          }))}
        />
        <FilterSelect
          label={t('filters.account')}
          value={state.account}
          onChange={(account) => onPatch({ account })}
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
        />
        <FilterSelect
          label={t('filters.category')}
          value={state.category}
          onChange={(category) => onPatch({ category })}
          options={categories.map((category) => ({ value: category.id, label: category.name }))}
        />
        <FilterSelect
          label={t('filters.status')}
          value={state.status}
          onChange={(status) => onPatch({ status: status as TransactionQueryStatus })}
          options={(['posted', 'pending', 'cleared'] as const).map((status) => ({
            value: status,
            label: t(`status.${status}`),
          }))}
        />
        <FilterSelect
          label={t('filters.currency')}
          value={state.currency}
          onChange={(currency) => onPatch({ currency })}
          options={currencies.map((currency) => ({ value: currency, label: currency }))}
        />
        {hasActiveFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X size={14} />
            {t('filters.clear')}
          </Button>
        )}
      </div>
      {datePreset === 'custom' && (
        <div className="border-border mt-3 flex flex-wrap gap-2 border-t pt-3">
          <label className="text-muted-foreground text-xs">
            {t('filters.from')}
            <Input
              type="date"
              value={state.dateFrom}
              onChange={(event) => onPatch({ dateFrom: event.target.value })}
              className="text-foreground mt-1 w-[160px]"
            />
          </label>
          <label className="text-muted-foreground text-xs">
            {t('filters.to')}
            <Input
              type="date"
              value={state.dateTo}
              onChange={(event) => onPatch({ dateTo: event.target.value })}
              className="text-foreground mt-1 w-[160px]"
            />
          </label>
        </div>
      )}
    </NativePanel>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const hasAllOption = options.some((option) => option.value === EMPTY_FILTER_VALUE)
  return (
    <label>
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="native-select max-w-40 text-xs"
      >
        {!hasAllOption && value !== 'custom' ? (
          <option value={EMPTY_FILTER_VALUE}>{label}</option>
        ) : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function LedgerView({
  transactions,
  sort,
  onSort,
  onDetails,
  onEdit,
  onDelete,
}: {
  transactions: TransactionPageRow[]
  sort: { field: TransactionSort; direction: TransactionSortDirection }
  onSort: (field: TransactionSort) => void
  onDetails: (transaction: TransactionPageRow) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation('transactions')
  return (
    <NativePanel className="overflow-hidden">
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed text-left text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-xs">
            <tr className="border-border border-b">
              <SortableHeader
                label={t('ledger.date')}
                field="date"
                sort={sort}
                onSort={onSort}
                className="w-32"
              />
              <SortableHeader
                label={t('ledger.description')}
                field="description"
                sort={sort}
                onSort={onSort}
              />
              <th className="w-44 px-4 py-3 font-medium">{t('ledger.account')}</th>
              <th className="w-36 px-4 py-3 font-medium">{t('ledger.category')}</th>
              <th className="w-28 px-4 py-3 font-medium">{t('ledger.status')}</th>
              <SortableHeader
                label={t('ledger.amount')}
                field="amount"
                sort={sort}
                onSort={onSort}
                className="w-36 text-right"
              />
              <th className="w-20">
                <span className="sr-only">{t('ledger.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {transactions.map((transaction) => (
              <tr key={transaction.id} className="group hover:bg-muted/45">
                <td className="text-muted-foreground px-4 py-3 text-xs tabular-nums">
                  {dayjs(transaction.date).format('MMM D, YYYY')}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => onDetails(transaction)}
                    className="hover:text-accent focus-visible:ring-ring block w-full truncate rounded text-left font-medium focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {transaction.description}
                  </button>
                </td>
                <td className="truncate px-4 py-3 text-xs">{getLedgerAccountLabel(transaction)}</td>
                <td className="text-muted-foreground truncate px-4 py-3 text-xs">
                  {transaction.has_splits ? t('split.badge') : (transaction.category_name ?? '—')}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge transaction={transaction} />
                </td>
                <td
                  className={cn(
                    'px-4 py-3 text-right font-semibold tabular-nums',
                    transaction.type === 'income'
                      ? 'text-success'
                      : transaction.type === 'transfer'
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                  )}
                >
                  {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
                  {formatMoney(transaction.amount, transaction.currency)}
                </td>
                <td className="px-2 py-2">
                  <TransactionActions
                    transaction={transaction}
                    canEdit={!transaction.has_splits}
                    onEdit={() => onEdit(transaction.id)}
                    onDelete={() => onDelete(transaction.id)}
                    compact
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-border divide-y md:hidden">
        {transactions.map((transaction) => (
          <div key={transaction.id} className="p-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => onDetails(transaction)}
                className="focus-visible:ring-ring min-w-0 flex-1 text-left focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="block truncate text-sm font-semibold">
                  {transaction.description}
                </span>
                <span className="text-muted-foreground mt-1 block truncate text-xs">
                  {dayjs(transaction.date).format('MMM D')} · {getLedgerAccountLabel(transaction)}
                </span>
              </button>
              <span
                className={cn(
                  'shrink-0 text-sm font-semibold tabular-nums',
                  transaction.type === 'income' ? 'text-success' : 'text-foreground'
                )}
              >
                {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
                {formatMoney(transaction.amount, transaction.currency)}
              </span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <StatusBadge transaction={transaction} />
                <SourceBadge transaction={transaction} />
              </div>
              <TransactionActions
                transaction={transaction}
                canEdit={!transaction.has_splits}
                onEdit={() => onEdit(transaction.id)}
                onDelete={() => onDelete(transaction.id)}
              />
            </div>
          </div>
        ))}
      </div>
    </NativePanel>
  )
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string
  field: TransactionSort
  sort: { field: TransactionSort; direction: TransactionSortDirection }
  onSort: (field: TransactionSort) => void
  className?: string
}) {
  const active = sort.field === field
  return (
    <th
      className={cn('px-4 py-3 font-medium', className)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className="hover:text-foreground inline-flex items-center gap-1"
      >
        {label}
        {active && (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  )
}

function TransactionRow({
  transaction,
  getSplits,
  onDetails,
  onEdit,
  onDelete,
}: {
  transaction: TransactionPageRow
  getSplits: (id: string) => Promise<TransactionSplitWithCategory[]>
  onDetails: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('transactions')
  const [expanded, setExpanded] = useState(false)
  const [splits, setSplits] = useState<TransactionSplitWithCategory[]>([])
  const [loadingSplits, setLoadingSplits] = useState(false)
  const toggleSplits = async () => {
    if (expanded) return setExpanded(false)
    setLoadingSplits(true)
    try {
      setSplits(await getSplits(transaction.id))
      setExpanded(true)
    } finally {
      setLoadingSplits(false)
    }
  }
  return (
    <article>
      <div className="group hover:bg-muted/45 flex items-center gap-3 px-4 py-3">
        <span
          className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full"
          style={
            transaction.category_color ? { backgroundColor: transaction.category_color } : undefined
          }
        />
        <button
          type="button"
          onClick={onDetails}
          className="focus-visible:ring-ring min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:outline-none"
        >
          <span className="block truncate text-sm font-medium">{transaction.description}</span>
          <span className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
            <span>
              {transaction.category_name ??
                (transaction.has_splits ? t('split.badge') : t('form.categoryNone'))}
            </span>
            <span>·</span>
            <span>{getLedgerAccountLabel(transaction)}</span>
          </span>
        </button>
        {transaction.has_splits ? (
          <button
            type="button"
            onClick={toggleSplits}
            disabled={loadingSplits}
            className="text-accent hover:bg-accent-muted inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs"
          >
            <Split size={12} />
            {t('split.badge')}
            <ChevronDown size={12} className={cn(expanded && 'rotate-180')} />
          </button>
        ) : (
          <StatusBadge transaction={transaction} />
        )}
        <span
          className={cn(
            'shrink-0 text-sm font-semibold tabular-nums',
            transaction.type === 'income' ? 'text-success' : 'text-foreground'
          )}
        >
          {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
          {formatMoney(transaction.amount, transaction.currency)}
        </span>
        <TransactionActions
          transaction={transaction}
          canEdit={!transaction.has_splits}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
      {expanded && (
        <div className="border-border bg-muted/25 border-t px-5 py-3">
          {loadingSplits ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="space-y-2">
              {splits.map((split) => (
                <div key={split.id} className="flex justify-between gap-3 text-xs">
                  <span className="text-muted-foreground truncate">
                    {split.category_name}
                    {split.notes ? ` — ${split.notes}` : ''}
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(split.amount, transaction.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function ReviewView({
  transactions,
  accounts,
  categories,
  activeReviewId,
  reviewMutationId,
  rowRefs,
  onActiveReviewChange,
  onEdit,
  onDelete,
  onUpdate,
}: {
  transactions: TransactionPageRow[]
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
  onActiveReviewChange: (id: string) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onUpdate: (transaction: TransactionPageRow, fields: ReviewFieldUpdate) => Promise<void>
}) {
  const { t } = useTranslation('transactions')
  return (
    <div className="space-y-3">
      {transactions.map((transaction) => {
        const protectionKey = getReviewProtectionKey(transaction)
        const isMutable = !protectionKey
        const compatibleAccounts = accounts.filter(
          (account) =>
            account.is_archived === 0 &&
            (account.account_mode ?? 'transactional') === 'transactional' &&
            account.currency === transaction.currency
        )
        return (
          <article
            key={transaction.id}
            ref={(element) => {
              if (element) rowRefs.current.set(transaction.id, element as HTMLDivElement)
              else rowRefs.current.delete(transaction.id)
            }}
            tabIndex={activeReviewId === transaction.id ? 0 : -1}
            onFocus={() => onActiveReviewChange(transaction.id)}
            className={cn(
              'native-panel focus-visible:ring-ring p-4 outline-none focus-visible:ring-2',
              activeReviewId === transaction.id && 'border-[var(--color-border-accent)]'
            )}
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate text-sm font-semibold">{transaction.description}</h2>
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
                  compact
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {getReviewReasons(transaction).map((reason) => (
                <Badge key={reason} variant="secondary" className="text-[10px]">
                  {t(`review.reasons.${reason}`)}
                </Badge>
              ))}
            </div>
            {isMutable ? (
              <div className="border-border bg-muted/35 mt-4 grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
                <InlineReviewSelect
                  id={`review-category-${transaction.id}`}
                  label={t('review.category')}
                  value={transaction.category_id ?? EMPTY_CATEGORY_VALUE}
                  placeholder={t('form.categoryNone')}
                  options={categories.filter((category) => category.type === transaction.type)}
                  disabled={reviewMutationId === transaction.id}
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
                  options={compatibleAccounts}
                  disabled={reviewMutationId === transaction.id || compatibleAccounts.length === 0}
                  onChange={(value) => onUpdate(transaction, { accountId: value })}
                />
              </div>
            ) : (
              <div className="border-warning/30 bg-warning/10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <p className="text-foreground text-xs">{t(protectionKey)}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(transaction.id)}
                >
                  {transaction.has_splits ? t('review.reviewSplit') : t('editTransaction')}
                </Button>
              </div>
            )}
          </article>
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
    <label htmlFor={id} className="text-muted-foreground text-xs">
      {label}
      <select
        id={id}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="native-select text-foreground mt-1 w-full disabled:opacity-50"
      >
        {placeholder && <option value={EMPTY_CATEGORY_VALUE}>{placeholder}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Pagination({
  currentPage,
  totalPages,
  pageSize,
  firstVisible,
  lastVisible,
  total,
  t,
  onPage,
  onPageSize,
}: {
  currentPage: number
  totalPages: number
  pageSize: TransactionPageSize
  firstVisible: number
  lastVisible: number
  total: number
  t: TFunction<'transactions'>
  onPage: (page: number) => void
  onPageSize: (size: TransactionPageSize) => void
}) {
  return (
    <NativePanel
      as="div"
      className="mt-3 flex flex-col items-center justify-between gap-3 px-3 py-2 sm:flex-row"
    >
      <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
        {t('pagination.range', { from: firstVisible, to: lastVisible, total })}
      </p>
      <nav className="flex items-center gap-1" aria-label={t('pagination.label')}>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          disabled={currentPage <= 1}
          onClick={() => onPage(currentPage - 1)}
          aria-label={t('pagination.previous')}
        >
          <ChevronLeft size={16} />
        </Button>
        {pageNumbers(currentPage, totalPages).map((page, index) =>
          page === 'ellipsis' ? (
            <span
              key={`ellipsis-${index}`}
              className="text-muted-foreground px-1"
              aria-hidden="true"
            >
              …
            </span>
          ) : (
            <Button
              key={page}
              variant={page === currentPage ? 'secondary' : 'ghost'}
              size="icon"
              className="h-9 w-9 tabular-nums"
              aria-current={page === currentPage ? 'page' : undefined}
              aria-label={t('pagination.page', { page })}
              onClick={() => onPage(page)}
            >
              {page}
            </Button>
          )
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          disabled={currentPage >= totalPages}
          onClick={() => onPage(currentPage + 1)}
          aria-label={t('pagination.next')}
        >
          <ChevronRight size={16} />
        </Button>
      </nav>
      <label className="text-muted-foreground flex items-center gap-2 text-xs">
        {t('pagination.rows')}
        <select
          aria-label={t('pagination.rows')}
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value) as TransactionPageSize)}
          className="native-select text-foreground h-9"
        >
          {TRANSACTION_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </NativePanel>
  )
}

function TransactionDetail({
  transaction,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  transaction: TransactionPageRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  const { t } = useTranslation('transactions')
  if (!transaction) return null
  const protection = getReviewProtectionKey(transaction)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            {t(`types.${transaction.type}`)}
          </p>
          <SheetTitle>{transaction.description}</SheetTitle>
          <SheetDescription>{dayjs(transaction.date).format('MMMM D, YYYY')}</SheetDescription>
        </SheetHeader>
        <p
          className={cn(
            'mt-7 text-3xl font-semibold tabular-nums',
            transaction.type === 'income' ? 'text-success' : 'text-foreground'
          )}
        >
          {transaction.type === 'income' ? '+' : transaction.type === 'expense' ? '-' : ''}
          {formatMoney(transaction.amount, transaction.currency)}
        </p>
        <dl className="divide-border border-border mt-7 divide-y border-y text-sm">
          <DetailItem label={t('ledger.account')} value={getLedgerAccountLabel(transaction)} />
          <DetailItem
            label={t('ledger.category')}
            value={transaction.has_splits ? t('split.badge') : (transaction.category_name ?? '—')}
          />
          <DetailItem
            label={t('ledger.status')}
            value={t(`status.${getTransactionStatus(transaction)}`)}
          />
          <DetailItem label={t('ledger.source')} value={getTransactionSource(transaction)} />
          <DetailItem
            label={t('detail.notes')}
            value={transaction.notes ?? transaction.note ?? '—'}
          />
          <DetailItem label={t('detail.reference')} value={transaction.id} />
        </dl>
        {protection && (
          <p className="border-warning/30 bg-warning/10 mt-5 rounded-lg border p-3 text-xs">
            {t(protection)}
          </p>
        )}
        <div className="mt-6 flex gap-2">
          {!transaction.has_splits && (
            <Button className="flex-1" onClick={() => onEdit(transaction.id)}>
              <Pencil size={15} />
              {t('editTransaction')}
            </Button>
          )}
          <Button
            variant="outline"
            className="text-destructive flex-1"
            onClick={() => onDelete(transaction.id)}
          >
            <Trash2 size={15} />
            {t('deleteTransaction')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right break-words">{value}</dd>
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
  transaction: TransactionPageRow
  onEdit: () => void
  onDelete: () => void
  canEdit?: boolean
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex shrink-0 gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100',
        compact && 'md:opacity-100'
      )}
    >
      {canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
          aria-label={`Edit ${transaction.description}`}
        >
          <Pencil size={13} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive h-8 w-8"
        onClick={onDelete}
        aria-label={`Delete ${transaction.description}`}
      >
        <Trash2 size={13} />
      </Button>
    </div>
  )
}

function StatusBadge({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  const status = getTransactionStatus(transaction)
  return (
    <Badge
      variant="outline"
      className={cn(
        'shrink-0 text-[10px]',
        status === 'pending'
          ? 'border-warning/35 bg-warning/10 text-foreground'
          : status === 'cleared'
            ? 'border-success/35 bg-success/10 text-success'
            : 'border-border text-muted-foreground'
      )}
    >
      {t(`status.${status}`)}
    </Badge>
  )
}

function SourceBadge({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  const source = getTransactionSource(transaction)
  return (
    <Badge variant="outline" className="text-muted-foreground max-w-28 truncate text-[10px]">
      {source === 'manual' ? t('source.manual') : source.replace(/[_-]+/g, ' ')}
    </Badge>
  )
}

function TransactionsSkeleton() {
  return (
    <NativePanel className="divide-border divide-y overflow-hidden">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </NativePanel>
  )
}
