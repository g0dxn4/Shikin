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
  MoreHorizontal,
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
import { ActionDisclosure } from '@/components/ui/action-disclosure'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { NativePanel } from '@/components/ui/native-layout'
import { TransactionViewTabs } from '@/components/transactions/transaction-view-tabs'
import { transactionAttentionStatus } from '@/components/transactions/transaction-review-summary'
import { TransactionReviewSummary } from '@/components/transactions/transaction-review-summary-panel'
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
import {
  canDeleteTransaction,
  transactionProtection,
  transactionReviewProtection,
} from '@/components/transactions/transaction-inspection-eligibility'
import { ConsumptionBulkDialog } from '@/components/transactions/consumption-bulk-dialog'
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
import {
  getTransactionDatePreset,
  transactionDateBounds,
  type TransactionDatePreset,
} from '@/lib/transaction-date-presets'

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
  'unclassified',
]
const sortableFields: TransactionSort[] = ['date', 'description', 'amount']

type TransactionView = (typeof transactionViews)[number]
type DatePreset = TransactionDatePreset

interface TransactionUrlState {
  search: string
  type: TransactionQueryType
  account: string
  category: string
  dateFrom: string
  dateTo: string
  datePreset: DatePreset | null
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
    datePreset:
      (['this-month', 'three-months', 'six-months', 'this-year'] as const).find(
        (value) => value === params.get('datePreset')
      ) ?? null,
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
  if (state.datePreset) params.set('datePreset', state.datePreset)
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

function currentBrowserUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function countActiveFilters(state: TransactionUrlState): number {
  return (
    Number(!!state.search) +
    Number(state.type !== 'all') +
    Number(state.account !== 'all') +
    Number(state.category !== 'all') +
    Number(!!state.dateFrom || !!state.dateTo) +
    Number(state.status !== 'all') +
    Number(state.currency !== 'all')
  )
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
  if (transaction.is_consumption_unclassified) reasons.push('unclassified')
  return reasons
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
  const { t: tConsumption } = useTranslation('consumption')
  const { openTransactionDialog, openRecurringDialog } = useUIStore()
  const { remove, getSplits, updateReviewFields } = useTransactionStore()
  const { accounts, archivedAccounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()
  const [urlState, setUrlState] = useState(readUrlState)
  const historyIntent = useRef<{ id: number; mode: 'push' | 'replace' | 'pop' }>({
    id: 0,
    mode: 'pop',
  })
  const appliedHistoryId = useRef(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [statementImportOpen, setStatementImportOpen] = useState(false)
  const [bulkClassificationOpen, setBulkClassificationOpen] = useState(false)
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null)
  const [reviewMutationId, setReviewMutationId] = useState<string | null>(null)
  const [reviewAnnouncement, setReviewAnnouncement] = useState('')
  const reviewRowRefs = useRef(new Map<string, HTMLDivElement>())
  const deferredSearch = useDeferredValue(urlState.search)

  useEffect(() => {
    void Promise.allSettled([fetchAccounts(), fetchCategories()])
  }, [fetchAccounts, fetchCategories])

  useEffect(() => {
    const handlePopState = () => {
      historyIntent.current = { id: historyIntent.current.id + 1, mode: 'pop' }
      setUrlState(readUrlState())
    }
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
      historyIntent.current = {
        id: historyIntent.current.id + 1,
        mode: options.replace ? 'replace' : 'push',
      }
      setUrlState((current) => {
        const next = { ...current, ...patch }
        if (options.resetPage !== false) next.page = 1
        return next
      })
    },
    []
  )

  useEffect(() => {
    const intent = historyIntent.current
    if (intent.id === appliedHistoryId.current) return
    appliedHistoryId.current = intent.id
    if (intent.mode === 'pop') return
    const nextUrl = serializeUrlState(urlState)
    if (nextUrl === currentBrowserUrl()) return
    if (intent.mode === 'replace') window.history.replaceState(null, '', nextUrl)
    else window.history.pushState(null, '', nextUrl)
  }, [urlState])

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
  const datePreset =
    urlState.datePreset &&
    (() => {
      const bounds = transactionDateBounds(urlState.datePreset)
      return bounds.dateFrom === urlState.dateFrom && bounds.dateTo === urlState.dateTo
    })()
      ? urlState.datePreset
      : getTransactionDatePreset(urlState.dateFrom, urlState.dateTo)
  const hasActiveFilters = countActiveFilters(urlState) > 0

  useEffect(() => {
    if (!pageQuery.isLoading && urlState.page > totalPages) {
      updateUrlState({ page: totalPages }, { resetPage: false, replace: true })
    }
  }, [pageQuery.isLoading, totalPages, updateUrlState, urlState.page])

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
      datePreset: null,
      status: 'all',
      currency: 'all',
    })

  const handleDatePreset = (preset: DatePreset) => {
    if (preset !== 'custom')
      updateUrlState({
        ...transactionDateBounds(preset),
        datePreset:
          preset === 'this-month' ||
          preset === 'three-months' ||
          preset === 'six-months' ||
          preset === 'this-year'
            ? preset
            : null,
      })
  }

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
      if (useTransactionStore.getState().fetchError) toast.warning(t('toast.savedRefreshFailed'))
      setDeleteId(null)
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
      if (useTransactionStore.getState().fetchError) toast.warning(t('toast.savedRefreshFailed'))
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

  const attentionStatus = transactionAttentionStatus({
    isLoading: pageQuery.isLoading,
    error: pageQuery.error,
    search: urlState.search,
    deferredSearch,
  })

  return (
    <div className="page-content animate-fade-in-up min-w-0" style={{ gap: '0.5rem' }}>
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center">
        <label className="relative order-2 min-w-0 md:order-1 md:flex-1">
          <span className="sr-only">{t('filters.search')}</span>
          <Search
            size={15}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
          />
          <Input
            type="search"
            value={urlState.search}
            onChange={(event) => updateUrlState({ search: event.target.value }, { replace: true })}
            placeholder={t('filters.searchPlaceholder') || `${tCommon('actions.search')}...`}
            className="!h-11 !min-h-11 pl-8 md:!h-8 md:!min-h-8"
          />
        </label>
        <div className="order-1 min-w-0 md:order-2">
          <TransactionViewTabs
            label={t('views.label')}
            value={urlState.view}
            labels={{
              timeline: t('views.timeline'),
              ledger: t('views.ledger'),
              review: t('views.review'),
            }}
            onChange={(view) => updateUrlState({ view })}
          />
        </div>
        <div className="order-3 flex min-w-0 items-center gap-2 md:shrink-0">
          <ActionDisclosure
            className="shrink-0"
            label={t('actions.more')}
            ariaLabel={t('actions.more')}
            trigger={
              <>
                <MoreHorizontal className="md:hidden" aria-hidden="true" />
                <span className="hidden md:inline">{t('actions.more')}</span>
              </>
            }
            triggerClassName="!h-11 !w-11 !min-h-11 !min-w-11 shrink-0 px-0 md:!h-8 md:!w-auto md:!min-h-8 md:!min-w-0 md:px-3"
            actions={[
              {
                label: t('import.button'),
                onSelect: () => setStatementImportOpen(true),
              },
              {
                label: tConsumption('bulk.actions.open'),
                disabled: pageQuery.isLoading || pageQuery.rows.length === 0,
                onSelect: () => setBulkClassificationOpen(true),
              },
              {
                label: t('recurring.addRule'),
                onSelect: () => openRecurringDialog(),
              },
            ]}
          />
          <Button
            className="!h-11 !min-h-11 flex-1 px-3 md:!h-8 md:!min-h-8 md:flex-none"
            onClick={() => openTransactionDialog()}
          >
            <Plus size={15} />
            {t('addTransaction')}
          </Button>
        </div>
      </div>

      <TransactionFilters
        t={t}
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

      <TransactionReviewSummary
        view={urlState.view}
        reviewReasonApplied={urlState.view === 'review'}
        total={pageQuery.total}
        reviewCounts={pageQuery.reviewCounts}
        status={attentionStatus}
        onOpenReview={() => updateUrlState({ view: 'review' })}
      />

      <ErrorBanner
        title={t('loadError.title')}
        message={pageQuery.rows.length > 0 ? pageQuery.error : null}
        onRetry={() => invalidateTransactionPage('review')}
      />
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        {reviewAnnouncement}
      </p>

      <div
        id={`transactions-${urlState.view}-panel`}
        role="tabpanel"
        aria-labelledby={`transactions-${urlState.view}-tab`}
        className="min-w-0"
      >
        {pageQuery.isLoading && pageQuery.rows.length === 0 ? (
          <TransactionsSkeleton />
        ) : pageQuery.error && pageQuery.rows.length === 0 ? (
          <ErrorState
            title={t('loadError.title')}
            description={pageQuery.error}
            onRetry={() => invalidateTransactionPage('review')}
            className="py-8"
          />
        ) : pageQuery.total === 0 && !hasActiveFilters && urlState.view !== 'review' ? (
          <NativePanel className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <span className="bg-muted text-muted-foreground mb-3 grid h-10 w-10 place-items-center rounded-lg">
              <ArrowLeftRight size={18} />
            </span>
            <h2 className="text-base font-semibold">{t('empty.title')}</h2>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm">{t('empty.description')}</p>
            <Button className="mt-3 !h-11 md:!h-8" onClick={() => openTransactionDialog()}>
              <Plus size={16} /> {t('addTransaction')}
            </Button>
          </NativePanel>
        ) : pageQuery.rows.length === 0 ? (
          <NativePanel className="flex flex-col items-center justify-center px-4 py-8 text-center">
            <Search size={18} className="text-muted-foreground" />
            <h2 className="mt-2 text-base font-semibold">
              {urlState.view === 'review' ? t('review.empty') : t('noMatching')}
            </h2>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={clearFilters}>
                {t('filters.clear')}
              </Button>
            )}
          </NativePanel>
        ) : (
          <NativePanel className="min-w-0 overflow-hidden">
            {urlState.view === 'review' && (
              <div
                className="border-border flex min-w-0 flex-wrap items-center gap-1.5 border-b px-2 py-2"
                role="group"
                aria-label={t('review.queueLabel')}
              >
                {reviewFilters.map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    aria-pressed={urlState.reviewReason === filter}
                    onClick={() => updateUrlState({ reviewReason: filter })}
                    className="filter-pill border-border !h-11 border md:!h-8"
                  >
                    {filter === 'unclassified'
                      ? tConsumption('review.filter')
                      : t(`review.filters.${filter}`)}{' '}
                    ({pageQuery.reviewCounts[filter]})
                  </button>
                ))}
              </div>
            )}
            {urlState.view === 'timeline' && (
              <div className="divide-border divide-y">
                {[...groupedByDate.entries()].map(([date, group]) => (
                  <section key={date} aria-labelledby={`date-${date}`}>
                    <h2
                      id={`date-${date}`}
                      className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-medium"
                    >
                      {journalDateLabel(date, t)}
                    </h2>
                    <div className="divide-border divide-y">
                      {group.map((transaction) => (
                        <TransactionRow
                          key={transaction.id}
                          transaction={transaction}
                          getSplits={getSplits}
                          onDetails={() => openTransactionDialog(transaction.id)}
                          onEdit={() => openTransactionDialog(transaction.id)}
                          onDelete={() => setDeleteId(transaction.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            {urlState.view === 'ledger' && (
              <LedgerView
                transactions={pageQuery.rows}
                sort={{ field: urlState.sort, direction: urlState.direction }}
                onSort={handleSort}
                onDetails={(transaction) => openTransactionDialog(transaction.id)}
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
          </NativePanel>
        )}
      </div>

      <ConsumptionBulkDialog
        open={bulkClassificationOpen}
        candidates={pageQuery.rows.map((row) => ({
          id: row.id,
          description: row.description,
          date: row.date,
          currency: row.currency,
          type: row.type,
          amount: row.amount,
        }))}
        onOpenChange={setBulkClassificationOpen}
        onChanged={() => invalidateTransactionPage('review')}
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
  const hasAdvancedFilters =
    state.account !== 'all' ||
    state.category !== 'all' ||
    state.status !== 'all' ||
    state.currency !== 'all'
  const [customRangeRequested, setCustomRangeRequested] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(hasAdvancedFilters)
  const activeFilterCount = countActiveFilters(state)
  const advancedFilterCount =
    Number(state.account !== 'all') +
    Number(state.category !== 'all') +
    Number(state.status !== 'all') +
    Number(state.currency !== 'all')
  const showCustomDates = customRangeRequested || datePreset === 'custom'
  const dateSelectValue = showCustomDates ? 'custom' : datePreset

  const handleDateSelect = (value: DatePreset) => {
    if (value === 'custom') {
      setCustomRangeRequested(true)
      onDatePreset('custom')
      return
    }
    setCustomRangeRequested(false)
    onDatePreset(value)
  }

  const handleClear = () => {
    setCustomRangeRequested(false)
    setAdvancedOpen(false)
    onClear()
  }

  const accountLabel =
    accounts.find((account) => account.id === state.account)?.name ?? state.account
  const categoryLabel =
    categories.find((category) => category.id === state.category)?.name ?? state.category
  const dateChipLabel =
    datePreset === 'custom'
      ? [state.dateFrom, state.dateTo].filter(Boolean).join('–') || t('filters.dates.custom')
      : t(`filters.dates.${datePreset}`)
  const chips = [
    state.search
      ? {
          key: 'search',
          text: `${t('filters.search')}: ${state.search}`,
          clear: () => onSearch(''),
        }
      : null,
    state.type !== 'all'
      ? {
          key: 'type',
          text: `${t('filters.type')}: ${t(`types.${state.type}`)}`,
          clear: () => onPatch({ type: 'all' }),
        }
      : null,
    state.dateFrom || state.dateTo
      ? {
          key: 'dates',
          text: `${t('filters.dateRange')}: ${dateChipLabel}`,
          clear: () => {
            setCustomRangeRequested(false)
            onPatch({ dateFrom: '', dateTo: '', datePreset: null })
          },
        }
      : null,
    state.account !== 'all'
      ? {
          key: 'account',
          text: `${t('filters.account')}: ${accountLabel}`,
          clear: () => onPatch({ account: 'all' }),
        }
      : null,
    state.category !== 'all'
      ? {
          key: 'category',
          text: `${t('filters.category')}: ${categoryLabel}`,
          clear: () => onPatch({ category: 'all' }),
        }
      : null,
    state.status !== 'all'
      ? {
          key: 'status',
          text: `${t('filters.status')}: ${t(`status.${state.status}`)}`,
          clear: () => onPatch({ status: 'all' }),
        }
      : null,
    state.currency !== 'all'
      ? {
          key: 'currency',
          text: `${t('filters.currency')}: ${state.currency}`,
          clear: () => onPatch({ currency: 'all' }),
        }
      : null,
  ].filter((chip): chip is { key: string; text: string; clear: () => void } => chip !== null)
  const advancedName =
    advancedFilterCount > 0
      ? `${advancedOpen ? t('filters.hideAdvanced') : t('filters.showAdvanced')} (${advancedFilterCount})`
      : advancedOpen
        ? t('filters.hideAdvanced')
        : t('filters.showAdvanced')
  const dateOptions = (
    [
      'this-month',
      'three-months',
      'six-months',
      'this-year',
      'all',
      ...(datePreset === 'month' || datePreset === '30-days' || datePreset === '90-days'
        ? [datePreset]
        : []),
      'custom',
    ] as DatePreset[]
  ).map((value) => ({
    value,
    label: t(`filters.dates.${value}`),
  }))

  return (
    <div className="flex min-w-0 flex-col gap-2" role="region" aria-label={t('filters.toolbar')}>
      <div className="flex min-w-0 flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
        <div
          className="grid grid-cols-2 gap-2 md:flex md:flex-wrap md:gap-1"
          role="group"
          aria-label={t('filters.type')}
        >
          {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="filter-pill !h-11 md:!h-8"
              aria-pressed={state.type === type}
              onClick={() => onPatch({ type })}
            >
              {t(`types.${type}`)}
            </button>
          ))}
        </div>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:contents">
          <FilterSelect
            label={t('filters.dateRange')}
            value={dateSelectValue}
            onChange={(value) => handleDateSelect(value as DatePreset)}
            options={dateOptions}
          />
          <Button
            type="button"
            variant="outline"
            className="!h-11 !min-h-11 justify-between px-2 md:hidden"
            aria-expanded={advancedOpen}
            aria-controls="transaction-advanced-filters"
            aria-label={advancedName}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <span className="truncate">
              {t('filters.filtersButton')}
              {advancedFilterCount > 0 ? ` ${advancedFilterCount}` : ''}
            </span>
            <ChevronDown
              aria-hidden="true"
              className={cn('shrink-0 transition-transform', advancedOpen ? 'rotate-180' : '')}
            />
          </Button>
        </div>
        <div
          id="transaction-advanced-filters"
          className={cn(
            'grid min-w-0 grid-cols-2 gap-2 md:contents',
            advancedOpen ? 'grid' : 'hidden md:contents'
          )}
        >
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
        </div>
        {hasActiveFilters ? (
          <Button
            type="button"
            variant="ghost"
            onClick={handleClear}
            aria-label={t('filters.clear')}
            title={t('filters.activeCount', { count: activeFilterCount })}
            className="!h-11 !min-h-11 shrink-0 gap-1 px-2 md:!h-8 md:!min-h-8"
          >
            <span className="text-xs font-medium tabular-nums" aria-hidden="true">
              {activeFilterCount}
            </span>
            <X size={14} />
          </Button>
        ) : null}
      </div>
      {showCustomDates ? (
        <div className="grid w-full min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 md:max-w-md">
          <label className="text-muted-foreground min-w-0 text-xs">
            {t('filters.from')}
            <Input
              type="date"
              value={state.dateFrom}
              onChange={(event) => onPatch({ dateFrom: event.target.value, datePreset: null })}
              className="text-foreground mt-1 !h-11 w-full min-w-0 md:!h-8 md:w-40"
            />
          </label>
          <label className="text-muted-foreground min-w-0 text-xs">
            {t('filters.to')}
            <Input
              type="date"
              value={state.dateTo}
              onChange={(event) => onPatch({ dateTo: event.target.value, datePreset: null })}
              className="text-foreground mt-1 !h-11 w-full min-w-0 md:!h-8 md:w-40"
            />
          </label>
        </div>
      ) : null}
      {chips.length > 0 ? (
        <div
          className="flex min-w-0 flex-wrap gap-1.5"
          aria-label={
            chips.some((chip) => ['account', 'category', 'status', 'currency'].includes(chip.key))
              ? t('filters.activeAdvanced')
              : undefined
          }
        >
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="border-border bg-muted text-foreground focus-visible:ring-ring inline-flex !h-11 max-w-full items-center gap-1 rounded-lg border px-2.5 text-xs focus-visible:ring-2 focus-visible:outline-none md:!h-8"
              aria-label={`${t('filters.remove')} ${chip.text}`}
              onClick={chip.clear}
            >
              <span className="truncate">{chip.text}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
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
  const selectedLabel =
    options.find((option) => option.value === value)?.label ??
    (value === EMPTY_FILTER_VALUE || value === 'custom' ? label : value)
  return (
    <label className="max-w-full min-w-0">
      <span className="sr-only">{label}</span>
      <select
        aria-label={label}
        title={selectedLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="native-select !h-11 w-full max-w-full min-w-0 text-xs md:!h-8 md:w-auto md:max-w-44"
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

const LEDGER_ACTION_CLASS =
  'h-11 w-11 min-h-11 min-w-11 shrink-0 scroll-mb-[calc(4rem+env(safe-area-inset-bottom))] md:h-8 md:w-8 md:min-h-8 md:min-w-8 md:scroll-mb-0'
const LEDGER_FOCUS_SCROLL = 'scroll-mb-[calc(4rem+env(safe-area-inset-bottom))] md:scroll-mb-0'

function storedLedgerDate(date: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(date)
  return match?.[1] ?? date
}

function journalDateLabel(date: string, t: TFunction<'transactions'>): string {
  const iso = storedLedgerDate(date)
  if (iso === dayjs().format('YYYY-MM-DD')) return `${iso} · ${t('dateHeaders.today')}`
  if (iso === dayjs().subtract(1, 'day').format('YYYY-MM-DD'))
    return `${iso} · ${t('dateHeaders.yesterday')}`
  return iso
}

function useDesktopJournal() {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 768px)').matches
      : false
  )
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setDesktop(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return desktop
}

function ledgerNoteText(transaction: TransactionPageRow): string | null {
  for (const value of [transaction.notes, transaction.note]) {
    const trimmed = value?.trim()
    if (trimmed) return trimmed
  }
  return null
}

function ledgerHasSplits(transaction: TransactionPageRow): boolean {
  return Boolean(transaction.has_splits)
}

function ledgerUnresolvedPlaceholder(transaction: TransactionPageRow): boolean {
  return (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') === 'unresolved'
  )
}

function ledgerSourceChip(transaction: TransactionPageRow): { raw: string; label: string } | null {
  const raw = getTransactionSource(transaction)
  if (raw === 'manual') return null
  const label = raw.replace(/[_-]+/g, ' ').trim()
  return label ? { raw, label } : null
}

function ledgerAmountPrefix(type: TransactionPageRow['type']): string {
  if (type === 'income') return '+'
  if (type === 'expense') return '-'
  return ''
}

function LedgerStatusChip({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  const status = getTransactionStatus(transaction)
  return (
    <Badge
      variant="outline"
      data-ledger-status={status}
      className={cn(
        'shrink-0 text-xs font-medium',
        status === 'pending'
          ? 'border-warning/50 text-warning bg-transparent'
          : status === 'cleared'
            ? 'border-success/50 text-success bg-transparent'
            : 'border-border bg-muted/50 text-muted-foreground'
      )}
    >
      {t(`status.${status}`)}
    </Badge>
  )
}

function LedgerCategory({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  if (ledgerHasSplits(transaction)) {
    return (
      <Badge
        variant="outline"
        data-ledger-flag="split"
        className="border-border bg-muted/40 text-foreground max-w-full min-w-0 text-xs font-medium whitespace-normal"
      >
        {t('split.badge')}
      </Badge>
    )
  }
  const name = transaction.category_name?.trim() || '—'
  return (
    <span
      className="flex min-w-0 items-start gap-1.5 text-sm"
      title={transaction.category_name?.trim() || undefined}
    >
      <span
        data-ledger-category-dot=""
        aria-hidden="true"
        className="border-border mt-1 size-2.5 shrink-0 rounded-full border"
        style={{ backgroundColor: transaction.category_color || 'var(--color-muted-foreground)' }}
      />
      <span className="min-w-0 break-words">{name}</span>
    </span>
  )
}

function LedgerNoteDisclosure({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  const note = ledgerNoteText(transaction)
  if (!note) return null
  return (
    <details
      className="max-w-full min-w-0"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <summary
        className={cn(
          'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 cursor-pointer list-none items-center rounded-md text-xs font-medium focus-visible:ring-2 focus-visible:outline-none md:min-h-8 [&::-webkit-details-marker]:hidden',
          LEDGER_FOCUS_SCROLL
        )}
      >
        {t('detail.notes')}
      </summary>
      <p className="text-muted-foreground max-w-full pb-1 text-xs break-words whitespace-pre-wrap">
        {note}
      </p>
    </details>
  )
}

function LedgerExceptionChips({
  transaction,
  className,
}: {
  transaction: TransactionPageRow
  className?: string
}) {
  const { t } = useTranslation('transactions')
  const { t: tConsumption } = useTranslation('consumption')
  const flags: Array<{
    id: string
    label: string
    title?: string
    srLabel?: string
    attention?: boolean
  }> = []
  if (transaction.ledger_treatment === 'staged_no_balance_impact') {
    flags.push({ id: 'staged', label: t('review.reasons.staged'), attention: true })
  }
  if (ledgerUnresolvedPlaceholder(transaction)) {
    flags.push({ id: 'placeholder', label: t('review.reasons.placeholder'), attention: true })
  }
  if (transaction.is_consumption_unclassified) {
    flags.push({
      id: 'unclassified',
      label: t('summary.reasons.unclassified'),
      title: tConsumption('review.reason'),
      srLabel: tConsumption('review.reason'),
      attention: true,
    })
  }
  if (transaction.reporting_treatment === 'exclude_from_cashflow') {
    flags.push({ id: 'excluded', label: t('correction.excluded') })
  }
  if (transaction.type === 'transfer') {
    flags.push({ id: 'transfer', label: t('types.transfer') })
  }
  const source = ledgerSourceChip(transaction)
  if (source) flags.push({ id: 'source', label: source.label, title: source.raw })
  if (flags.length === 0) return null
  return (
    <div className={cn('flex max-w-full min-w-0 flex-wrap items-center gap-1', className)}>
      {flags.map((flag) => (
        <Badge
          key={flag.id}
          variant="outline"
          data-ledger-flag={flag.id}
          title={flag.title}
          className={cn(
            'max-w-full min-w-0 text-xs font-medium whitespace-normal',
            flag.attention
              ? 'border-warning/50 bg-muted/40 text-foreground'
              : 'border-border bg-muted/40 text-muted-foreground'
          )}
        >
          {flag.srLabel ? <span className="sr-only">{flag.srLabel}</span> : null}
          <span className={flag.id === 'source' ? 'line-clamp-2 break-words' : 'break-words'}>
            {flag.label}
          </span>
        </Badge>
      ))}
    </div>
  )
}

function LedgerAmount({ transaction }: { transaction: TransactionPageRow }) {
  const { t } = useTranslation('transactions')
  const prefix = ledgerAmountPrefix(transaction.type)
  const formatted = formatMoney(transaction.amount, transaction.currency)
  const figureClass =
    transaction.type === 'income'
      ? 'text-success'
      : transaction.type === 'transfer'
        ? 'text-muted-foreground'
        : 'text-foreground'
  return (
    <div
      data-ledger-amount=""
      tabIndex={0}
      role="group"
      aria-label={`${t('ledger.amount')} ${prefix}${formatted} ${transaction.currency}`}
      className={cn(
        'focus-visible:ring-ring w-full max-w-full min-w-0 touch-pan-x overflow-x-auto overscroll-x-contain rounded-sm focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
        LEDGER_FOCUS_SCROLL
      )}
    >
      <div className="flex w-max min-w-full shrink-0 justify-end">
        <span
          data-ledger-money=""
          className="inline-flex w-max shrink-0 items-baseline text-base font-semibold whitespace-nowrap tabular-nums md:text-sm"
        >
          <span data-ledger-figure="" className={figureClass}>
            {`${prefix}${formatted}`}
          </span>
          <span className="text-muted-foreground text-xs font-medium">{` ${transaction.currency}`}</span>
        </span>
      </div>
    </div>
  )
}

function LedgerActions({
  transaction,
  onEdit,
  onDelete,
}: {
  transaction: TransactionPageRow
  onEdit: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <div
      className="flex shrink-0 justify-end"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <TransactionActions
        transaction={transaction}
        canEdit={!transactionProtection(transaction)}
        onEdit={() => onEdit(transaction.id)}
        onDelete={() => onDelete(transaction.id)}
        compact
        buttonClassName={LEDGER_ACTION_CLASS}
      />
    </div>
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
    <div className="max-w-full min-w-0">
      <div className="hidden max-w-full min-w-0 overflow-x-auto overscroll-x-contain md:block">
        <table className="w-full min-w-[40rem] table-fixed text-left text-sm">
          <thead className="bg-muted/60 text-muted-foreground text-xs">
            <tr className="border-border border-b">
              <SortableHeader
                label={t('ledger.date')}
                field="date"
                sort={sort}
                onSort={onSort}
                className="w-[7.25rem]"
              />
              <SortableHeader
                label={t('ledger.description')}
                field="description"
                sort={sort}
                onSort={onSort}
              />
              <th scope="col" className="w-[18%] px-3 py-2 align-bottom font-medium">
                {t('ledger.account')}
              </th>
              <th scope="col" className="w-[16%] px-3 py-2 align-bottom font-medium">
                {t('ledger.category')}
              </th>
              <th scope="col" className="w-[6.75rem] px-3 py-2 align-bottom font-medium">
                {t('ledger.status')}
              </th>
              <SortableHeader
                label={t('ledger.amount')}
                field="amount"
                sort={sort}
                onSort={onSort}
                align="end"
                className="w-[10.75rem]"
              />
              <th scope="col" className="w-20">
                <span className="sr-only">{t('ledger.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {transactions.map((transaction) => {
              const accountLabel = getLedgerAccountLabel(transaction)
              return (
                <tr
                  key={transaction.id}
                  data-ledger-row={transaction.id}
                  data-ledger-mount="desktop"
                  className="group hover:bg-muted/45 focus-within:bg-muted/40"
                >
                  <td className="text-muted-foreground px-3 py-2 align-top text-sm whitespace-nowrap tabular-nums">
                    {storedLedgerDate(transaction.date)}
                  </td>
                  <td className="min-w-0 px-3 py-2 align-top">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <button
                        type="button"
                        onClick={() => onDetails(transaction)}
                        title={transaction.description}
                        className="hover:text-foreground focus-visible:ring-ring inline-flex max-w-full min-w-0 rounded text-left text-sm font-medium focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <span className="line-clamp-2 leading-5 break-words">
                          {transaction.description}
                        </span>
                      </button>
                      <LedgerNoteDisclosure transaction={transaction} />
                    </div>
                    <LedgerExceptionChips transaction={transaction} />
                  </td>
                  <td className="min-w-0 px-3 py-2 align-top text-sm">
                    <span className="line-clamp-2 leading-5 break-words" title={accountLabel}>
                      {accountLabel}
                    </span>
                  </td>
                  <td className="min-w-0 px-3 py-2 align-top">
                    <LedgerCategory transaction={transaction} />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <LedgerStatusChip transaction={transaction} />
                  </td>
                  <td className="min-w-0 px-3 py-2 align-top">
                    <LedgerAmount transaction={transaction} />
                  </td>
                  <td className="px-1.5 py-1.5 align-top whitespace-nowrap">
                    <LedgerActions transaction={transaction} onEdit={onEdit} onDelete={onDelete} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div
        data-ledger-list="mobile"
        className="divide-border max-w-full min-w-0 divide-y pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {transactions.map((transaction) => {
          const accountLabel = getLedgerAccountLabel(transaction)
          return (
            <div
              key={transaction.id}
              data-ledger-row={transaction.id}
              data-ledger-mount="mobile"
              className="hover:bg-muted/45 focus-within:bg-muted/40 max-w-full min-w-0 px-3 py-3"
            >
              <button
                type="button"
                onClick={() => onDetails(transaction)}
                title={transaction.description}
                className={cn(
                  'hover:text-foreground focus-visible:ring-ring flex min-h-11 w-full min-w-0 flex-col justify-center rounded text-left focus-visible:ring-2 focus-visible:outline-none',
                  LEDGER_FOCUS_SCROLL
                )}
              >
                <span className="line-clamp-2 text-sm leading-5 font-semibold break-words">
                  {transaction.description}
                </span>
                <span className="text-muted-foreground mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 text-xs leading-4">
                  <span className="tabular-nums">{storedLedgerDate(transaction.date)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="line-clamp-2 break-words" title={accountLabel}>
                    {accountLabel}
                  </span>
                </span>
              </button>
              <div className="mt-1 flex max-w-full min-w-0 flex-wrap items-center gap-1">
                <LedgerCategory transaction={transaction} />
                <LedgerNoteDisclosure transaction={transaction} />
              </div>
              <div className="mt-1.5 max-w-full min-w-0">
                <LedgerAmount transaction={transaction} />
              </div>
              <div className="mt-2 flex max-w-full min-w-0 flex-wrap items-center gap-1.5">
                <LedgerStatusChip transaction={transaction} />
                <LedgerExceptionChips transaction={transaction} />
              </div>
              <div className="mt-2">
                <LedgerActions transaction={transaction} onEdit={onEdit} onDelete={onDelete} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SortableHeader({
  label,
  field,
  sort,
  onSort,
  className,
  align = 'start',
}: {
  label: string
  field: TransactionSort
  sort: { field: TransactionSort; direction: TransactionSortDirection }
  onSort: (field: TransactionSort) => void
  className?: string
  align?: 'start' | 'end'
}) {
  const active = sort.field === field
  return (
    <th
      scope="col"
      className={cn('px-3 py-2 align-bottom text-xs font-medium', className)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'hover:text-foreground focus-visible:ring-ring inline-flex min-h-8 items-center gap-1 rounded-md focus-visible:ring-2 focus-visible:outline-none',
          align === 'end' && 'w-full justify-end'
        )}
      >
        {label}
        {active ? (
          sort.direction === 'asc' ? (
            <ArrowUp size={12} aria-hidden="true" />
          ) : (
            <ArrowDown size={12} aria-hidden="true" />
          )
        ) : null}
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
  const categoryLabel = transaction.has_splits
    ? t('split.badge')
    : transaction.category_name?.trim() || t('form.categoryNone')
  return (
    <article className="group hover:bg-muted/45 focus-within:bg-muted/40">
      <div className="grid grid-cols-[0.5rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-3 py-1.5 md:grid-cols-[0.5rem_minmax(0,1fr)_auto_auto] md:py-1">
        <span
          className="border-border col-start-1 row-start-1 size-2 justify-self-center rounded-full border"
          style={{
            backgroundColor: transaction.category_color || 'var(--color-muted-foreground)',
          }}
        />
        <div className="col-start-2 row-start-1 min-w-0">
          <button
            type="button"
            onClick={onDetails}
            title={transaction.description}
            className={cn(
              'focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center rounded text-left focus-visible:ring-2 focus-visible:outline-none md:min-h-8',
              LEDGER_FOCUS_SCROLL
            )}
          >
            <span className="line-clamp-2 text-sm leading-5 font-medium break-words">
              {transaction.description}
            </span>
          </button>
          <div className="text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs leading-4">
            <span className="min-w-0 break-words">{categoryLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 break-words">{getLedgerAccountLabel(transaction)}</span>
            <LedgerStatusChip transaction={transaction} />
            <LedgerExceptionChips transaction={transaction} />
            <LedgerNoteDisclosure transaction={transaction} />
            {transaction.has_splits ? (
              <button
                type="button"
                onClick={toggleSplits}
                disabled={loadingSplits}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none md:min-h-8"
              >
                <Split size={12} aria-hidden="true" />
                {t('split.breakdown')}
                <ChevronDown
                  size={12}
                  className={cn(expanded && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
            ) : null}
          </div>
        </div>
        <div className="col-span-2 col-start-2 row-start-2 min-w-0 md:col-span-1 md:col-start-3 md:row-start-1">
          <LedgerAmount transaction={transaction} />
        </div>
        <div className="col-start-3 row-start-1 md:col-start-4">
          <TransactionActions
            transaction={transaction}
            canEdit={!transactionProtection(transaction)}
            onEdit={onEdit}
            onDelete={onDelete}
            compact
            buttonClassName={LEDGER_ACTION_CLASS}
          />
        </div>
      </div>
      {expanded && (
        <div className="border-border bg-muted/25 border-t px-3 py-2">
          {loadingSplits ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <div className="space-y-1">
              {splits.map((split) => (
                <div key={split.id} className="flex justify-between gap-3 text-xs">
                  <span className="text-muted-foreground min-w-0 break-words">
                    {split.category_name}
                    {split.notes ? ` — ${split.notes}` : ''}
                  </span>
                  <span className="shrink-0 tabular-nums">
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
  const desktop = useDesktopJournal()
  const active = transactions.find((transaction) => transaction.id === activeReviewId) ?? null
  return (
    <div className="md:grid md:grid-cols-[20rem_minmax(0,1fr)] md:items-start">
      <div className="divide-border divide-y md:col-start-1 md:max-h-[calc(100dvh-12rem)] md:overflow-y-auto">
        {transactions.map((transaction) => {
          const selected = transaction.id === activeReviewId
          return (
            <div key={transaction.id}>
              <div
                ref={(element) => {
                  if (element) rowRefs.current.set(transaction.id, element)
                  else rowRefs.current.delete(transaction.id)
                }}
                tabIndex={selected ? 0 : -1}
                data-review-row={transaction.id}
                aria-current={selected ? 'true' : undefined}
                onFocus={() => onActiveReviewChange(transaction.id)}
                onClick={() => onActiveReviewChange(transaction.id)}
                className={cn(
                  'hover:bg-muted/45 focus-visible:ring-ring cursor-pointer px-3 py-2 outline-none focus-visible:ring-2',
                  selected && 'bg-muted/50'
                )}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{transaction.description}</p>
                    <div className="text-muted-foreground mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs leading-4">
                      <span className="tabular-nums">{storedLedgerDate(transaction.date)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 break-words">
                        {getLedgerAccountLabel(transaction)}
                      </span>
                      <LedgerStatusChip transaction={transaction} />
                      <LedgerExceptionChips transaction={transaction} />
                      <LedgerNoteDisclosure transaction={transaction} />
                    </div>
                  </div>
                  <div className="max-w-[46%] min-w-0 shrink-0">
                    <LedgerAmount transaction={transaction} />
                  </div>
                </div>
              </div>
              {!desktop && selected ? (
                <ReviewInspector
                  transaction={transaction}
                  accounts={accounts}
                  categories={categories}
                  reviewMutationId={reviewMutationId}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onUpdate={onUpdate}
                />
              ) : null}
            </div>
          )
        })}
      </div>
      {desktop && active ? (
        <div className="border-border md:sticky md:top-0 md:col-start-2 md:row-start-1 md:border-l">
          <ReviewInspector
            transaction={active}
            accounts={accounts}
            categories={categories}
            reviewMutationId={reviewMutationId}
            onEdit={onEdit}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        </div>
      ) : null}
    </div>
  )
}

function ReviewInspector({
  transaction,
  accounts,
  categories,
  reviewMutationId,
  onEdit,
  onDelete,
  onUpdate,
}: {
  transaction: TransactionPageRow
  accounts: {
    id: string
    name: string
    currency: string
    is_archived: number
    account_mode?: string
  }[]
  categories: { id: string; name: string; type: string }[]
  reviewMutationId: string | null
  onEdit: (id: string) => void
  onDelete: (id: string) => void
  onUpdate: (transaction: TransactionPageRow, fields: ReviewFieldUpdate) => Promise<void>
}) {
  const { t } = useTranslation('transactions')
  const { t: tConsumption } = useTranslation('consumption')
  const protectionKey = transactionReviewProtection(transaction)
  const isMutable = !protectionKey
  const source = ledgerSourceChip(transaction)
  const compatibleAccounts = accounts.filter(
    (account) =>
      account.is_archived === 0 &&
      (account.account_mode ?? 'transactional') === 'transactional' &&
      account.currency === transaction.currency
  )
  return (
    <div data-review-inspector="" className="min-w-0 px-3 py-3">
      <p className="text-sm font-medium break-words">{transaction.description}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <LedgerStatusChip transaction={transaction} />
        {source ? (
          <Badge
            variant="outline"
            data-ledger-flag="source"
            title={source.raw}
            className="border-border bg-muted/40 text-muted-foreground max-w-full text-xs font-medium"
          >
            <span className="line-clamp-2 break-words">{source.label}</span>
          </Badge>
        ) : null}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        <span className="tabular-nums">{storedLedgerDate(transaction.date)}</span>
        <span aria-hidden="true"> · </span>
        {getLedgerAccountLabel(transaction)}
      </p>
      <div className="mt-1">
        <LedgerAmount transaction={transaction} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {getReviewReasons(transaction).map((reason) => (
          <Badge
            key={reason}
            variant="outline"
            title={reason === 'unclassified' ? tConsumption('review.reason') : undefined}
            className="border-border bg-muted/40 text-foreground text-xs font-medium"
          >
            {reason === 'unclassified' ? (
              <>
                <span className="sr-only">{tConsumption('review.reason')}</span>
                {t('summary.reasons.unclassified')}
              </>
            ) : (
              t(`review.reasons.${reason}`)
            )}
          </Badge>
        ))}
      </div>
      {isMutable ? (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          <div className="mt-3">
            <TransactionActions
              transaction={transaction}
              canEdit={!transactionProtection(transaction)}
              onEdit={() => onEdit(transaction.id)}
              onDelete={() => onDelete(transaction.id)}
              compact
              buttonClassName={LEDGER_ACTION_CLASS}
            />
          </div>
        </>
      ) : (
        <div className="border-warning/30 bg-warning/10 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-foreground text-xs">{t(protectionKey)}</p>
          <Button
            type="button"
            variant="outline"
            className="!h-11 md:!h-8"
            onClick={() => onEdit(transaction.id)}
          >
            {transaction.has_splits ? t('review.reviewSplit') : t('editTransaction')}
          </Button>
        </div>
      )}
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
        className="native-select text-foreground mt-1 !h-11 w-full disabled:opacity-50 md:!h-8"
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
  const controlClass =
    'scroll-mb-[calc(4rem+env(safe-area-inset-bottom))] !h-11 !w-11 !min-h-11 !min-w-11 md:scroll-mb-0 md:!h-8 md:!w-8 md:!min-h-8 md:!min-w-8'
  return (
    <div className="border-border flex flex-col items-stretch justify-between gap-2 border-t px-3 py-2 sm:flex-row sm:items-center">
      <p className="text-muted-foreground text-xs tabular-nums" aria-live="polite">
        {t('pagination.range', { from: firstVisible, to: lastVisible, total })}
      </p>
      <nav className="flex flex-wrap items-center gap-1" aria-label={t('pagination.label')}>
        <Button
          variant="ghost"
          size="icon"
          className={controlClass}
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
              className={cn(controlClass, 'tabular-nums')}
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
          className={controlClass}
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
          className="native-select text-foreground !h-11 md:!h-8"
        >
          {TRANSACTION_PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function TransactionActions({
  transaction,
  onEdit,
  onDelete,
  canEdit = true,
  compact = false,
  buttonClassName,
}: {
  transaction: TransactionPageRow
  onEdit: () => void
  onDelete: () => void
  canEdit?: boolean
  compact?: boolean
  buttonClassName?: string
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
          className={cn('h-8 w-8', buttonClassName)}
          onClick={(event) => {
            event.stopPropagation()
            onEdit()
          }}
          aria-label={`Edit ${transaction.description}`}
        >
          <Pencil size={13} />
        </Button>
      )}
      {canDeleteTransaction(transaction) && (
        <Button
          variant="ghost"
          size="icon"
          className={cn('text-destructive hover:text-destructive h-8 w-8', buttonClassName)}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
          aria-label={`Delete ${transaction.description}`}
        >
          <Trash2 size={13} />
        </Button>
      )}
    </div>
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
