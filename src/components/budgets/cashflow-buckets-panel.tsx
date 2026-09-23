import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Archive,
  ArrowLeftRight,
  ChevronRight,
  CircleDollarSign,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { NativePanel } from '@/components/ui/native-layout'
import { Skeleton } from '@/components/ui/skeleton'
import {
  deleteCashflowBucket,
  listCashflowBuckets,
  reverseCashflowAllocation,
  updateCashflowBucket,
  type CashflowBucket,
  type CashflowBucketAllocation,
  type CashflowBucketsView,
} from '@/lib/cashflow-bucket-service'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { useCurrencyStore } from '@/stores/currency-store'
import {
  CashflowAllocationDialog,
  CashflowBucketEditorDialog,
  CashflowCorrectionDialog,
} from './cashflow-bucket-dialogs'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((module) => ({
    default: module.ConfirmDialog,
  }))
)

type ConfirmAction =
  | { kind: 'delete'; bucket: CashflowBucket }
  | { kind: 'reverse'; allocation: CashflowBucketAllocation }
  | null

const EMPTY_VIEW: CashflowBucketsView = { buckets: [], allocations: [], incomeSources: [] }

function hasVirtualBucketsDeepLink() {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const hash = window.location.hash.replace(/^#/, '')
  return (
    params.get('section') === 'buckets' ||
    params.get('buckets') === '1' ||
    params.get('buckets') === 'open' ||
    hash === 'buckets' ||
    hash === 'cashflow-buckets' ||
    hash === 'cashflow-buckets-heading'
  )
}

export function CashflowBucketsPanel() {
  const { t } = useTranslation('budgets')
  const { preferredCurrency } = useCurrencyStore()
  const [view, setView] = useState<CashflowBucketsView>(EMPTY_VIEW)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const userTouchedRef = useRef(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingBucket, setEditingBucket] = useState<CashflowBucket | null>(null)
  const [allocationBucket, setAllocationBucket] = useState<CashflowBucket | null>(null)
  const [correctionAllocation, setCorrectionAllocation] = useState<CashflowBucketAllocation | null>(
    null
  )
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null)
  const [mutating, setMutating] = useState(false)
  const loadSequence = useRef(0)
  const tRef = useRef(t)
  tRef.current = t

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setError(null)
    try {
      const current = await listCashflowBuckets()
      if (sequence === loadSequence.current) setView(current)
    } catch (cause) {
      if (sequence === loadSequence.current) {
        setError(getErrorMessage(cause, tRef.current('buckets.error.load')))
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const deepLink = hasVirtualBucketsDeepLink()

  useEffect(() => {
    if (loading || userTouchedRef.current) return
    if (error || view.buckets.length > 0 || deepLink) {
      setExpanded(true)
    }
  }, [deepLink, error, loading, view.buckets.length])

  const groups = useMemo(() => {
    const grouped = new Map<string, CashflowBucket[]>()
    for (const bucket of view.buckets) {
      const current = grouped.get(bucket.currency) ?? []
      current.push(bucket)
      grouped.set(bucket.currency, current)
    }
    return [...grouped.entries()]
  }, [view.buckets])

  const reversedIds = useMemo(
    () =>
      new Set(
        view.allocations.flatMap((allocation) =>
          allocation.reversesAllocationId ? [allocation.reversesAllocationId] : []
        )
      ),
    [view.allocations]
  )

  const refresh = () => void load()

  const toggleExpanded = () => {
    userTouchedRef.current = true
    setExpanded((open) => !open)
  }

  const toggleActive = async (bucket: CashflowBucket) => {
    setMutating(true)
    setError(null)
    try {
      await updateCashflowBucket(bucket.id, { active: !bucket.isActive })
      await load()
    } catch (cause) {
      setError(getErrorMessage(cause, t('buckets.error.save')))
    } finally {
      setMutating(false)
    }
  }

  const confirm = async () => {
    if (!confirmAction) return
    setMutating(true)
    setError(null)
    try {
      if (confirmAction.kind === 'delete') await deleteCashflowBucket(confirmAction.bucket.id)
      else await reverseCashflowAllocation(confirmAction.allocation.id)
      setConfirmAction(null)
      await load()
    } catch (cause) {
      setError(getErrorMessage(cause, t('buckets.error.mutate')))
    } finally {
      setMutating(false)
    }
  }

  return (
    <NativePanel className="mt-3 p-4 sm:p-5" aria-labelledby="cashflow-buckets-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="cashflow-buckets-heading" className="text-base font-semibold">
              <button
                type="button"
                className="focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded-lg text-left focus-visible:ring-2 focus-visible:outline-none"
                aria-expanded={expanded}
                aria-controls="cashflow-buckets-body"
                onClick={toggleExpanded}
              >
                <ChevronRight
                  size={16}
                  className={`text-muted-foreground shrink-0 transition-transform motion-reduce:transition-none ${
                    expanded ? 'rotate-90' : ''
                  }`}
                  aria-hidden="true"
                />
                <CircleDollarSign className="text-primary h-5 w-5" aria-hidden="true" />
                {t('buckets.title')}
              </button>
            </h2>
            <Badge variant="secondary">{t('buckets.count', { count: view.buckets.length })}</Badge>
          </div>
          <p className="text-warning mt-1 max-w-2xl text-xs font-medium">
            {t('buckets.disclaimer')}
          </p>
        </div>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => {
            setEditingBucket(null)
            setEditorOpen(true)
          }}
        >
          <Plus size={16} />
          {t('buckets.actions.create')}
        </Button>
      </div>

      <div id="cashflow-buckets-body" hidden={!expanded}>
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm">{t('buckets.description')}</p>
        {error ? (
          <div className="border-destructive/30 bg-destructive/5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
            <Button variant="secondary" className="min-h-11" onClick={refresh}>
              {t('buckets.actions.retry')}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-4 grid gap-3" role="status" aria-busy="true">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <div className="border-border bg-muted/30 mt-4 rounded-xl border border-dashed p-6 text-center">
            <p className="font-medium">{t('buckets.empty.title')}</p>
            <p className="text-muted-foreground mt-1 text-sm">{t('buckets.empty.description')}</p>
          </div>
        ) : (
          <div className="mt-5 grid gap-5">
            {groups.map(([currency, buckets]) => (
              <section key={currency} aria-labelledby={`bucket-currency-${currency}`}>
                <div className="mb-2 flex items-center gap-2">
                  <h3 id={`bucket-currency-${currency}`} className="text-sm font-semibold">
                    {currency}
                  </h3>
                  <Badge variant="secondary">{buckets.length}</Badge>
                </div>
                <div className="grid gap-3">
                  {buckets.map((bucket) => {
                    const allocations = view.allocations.filter(
                      (allocation) => allocation.bucketId === bucket.id
                    )
                    return (
                      <article
                        key={bucket.id}
                        className="border-border bg-muted/30 rounded-xl border p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="font-semibold">{bucket.name}</h4>
                              <Badge variant={bucket.isActive ? 'secondary' : 'outline'}>
                                {t(
                                  bucket.isActive
                                    ? 'buckets.status.active'
                                    : 'buckets.status.inactive'
                                )}
                              </Badge>
                            </div>
                            {bucket.description ? (
                              <p className="text-muted-foreground mt-1 text-sm">
                                {bucket.description}
                              </p>
                            ) : null}
                          </div>
                          <div className="text-right tabular-nums">
                            <p className="text-lg font-semibold">
                              {formatMoney(bucket.balanceCentavos, bucket.currency)}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {bucket.targetAmountCentavos === null
                                ? t('buckets.noTarget')
                                : t('buckets.target', {
                                    amount: formatMoney(
                                      bucket.targetAmountCentavos,
                                      bucket.currency
                                    ),
                                  })}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {bucket.isActive ? (
                            <Button
                              size="sm"
                              className="min-h-11"
                              onClick={() => setAllocationBucket(bucket)}
                            >
                              <Plus size={14} /> {t('buckets.actions.allocate')}
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-11"
                            onClick={() => {
                              setEditingBucket(bucket)
                              setEditorOpen(true)
                            }}
                          >
                            <Pencil size={14} /> {t('buckets.actions.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="min-h-11"
                            disabled={mutating}
                            onClick={() => void toggleActive(bucket)}
                          >
                            <Archive size={14} />
                            {t(
                              bucket.isActive
                                ? 'buckets.actions.deactivate'
                                : 'buckets.actions.activate'
                            )}
                          </Button>
                          {bucket.balanceCentavos === 0 && bucket.allocationCount === 0 ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-destructive min-h-11"
                              onClick={() => setConfirmAction({ kind: 'delete', bucket })}
                            >
                              <Trash2 size={14} /> {t('buckets.actions.delete')}
                            </Button>
                          ) : null}
                        </div>

                        {allocations.length > 0 ? (
                          <details className="border-border mt-4 border-t pt-3">
                            <summary className="focus-visible:ring-ring min-h-11 cursor-pointer rounded-md py-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none">
                              {t('buckets.history.title', { count: allocations.length })}
                            </summary>
                            <div className="grid gap-2 pb-1">
                              {allocations.map((allocation) => {
                                const reversible =
                                  allocation.amountCentavos > 0 &&
                                  !allocation.reversesAllocationId &&
                                  !reversedIds.has(allocation.id)
                                return (
                                  <div
                                    key={allocation.id}
                                    className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
                                  >
                                    <div>
                                      <p className="font-medium tabular-nums">
                                        {formatMoney(
                                          allocation.amountCentavos,
                                          allocation.currency
                                        )}
                                      </p>
                                      <p className="text-muted-foreground text-xs">
                                        {allocation.allocationDate} ·{' '}
                                        {allocation.transactionId
                                          ? t('buckets.funding.income')
                                          : t('buckets.funding.virtual')}
                                      </p>
                                    </div>
                                    {reversible ? (
                                      <div className="flex flex-wrap gap-2">
                                        <Button
                                          size="sm"
                                          variant="secondary"
                                          className="min-h-11"
                                          onClick={() => setCorrectionAllocation(allocation)}
                                        >
                                          <ArrowLeftRight size={14} />
                                          {t('buckets.actions.correct')}
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="min-h-11"
                                          onClick={() =>
                                            setConfirmAction({ kind: 'reverse', allocation })
                                          }
                                        >
                                          <RotateCcw size={14} />
                                          {t('buckets.actions.reverse')}
                                        </Button>
                                      </div>
                                    ) : (
                                      <Badge variant="outline">
                                        {t('buckets.history.preserved')}
                                      </Badge>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </details>
                        ) : null}
                      </article>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      <CashflowBucketEditorDialog
        open={editorOpen}
        bucket={editingBucket}
        defaultCurrency={preferredCurrency}
        onOpenChange={setEditorOpen}
        onSaved={refresh}
      />
      <CashflowAllocationDialog
        open={allocationBucket !== null}
        bucket={allocationBucket}
        sources={view.incomeSources}
        onOpenChange={(open) => !open && setAllocationBucket(null)}
        onSaved={refresh}
      />
      <CashflowCorrectionDialog
        open={correctionAllocation !== null}
        allocation={correctionAllocation}
        buckets={view.buckets}
        sources={view.incomeSources}
        onOpenChange={(open) => !open && setCorrectionAllocation(null)}
        onSaved={refresh}
      />
      {confirmAction ? (
        <Suspense>
          <ConfirmDialog
            open
            onOpenChange={(open) => !open && setConfirmAction(null)}
            title={t(
              confirmAction.kind === 'delete'
                ? 'buckets.confirm.deleteTitle'
                : 'buckets.confirm.reverseTitle'
            )}
            description={t(
              confirmAction.kind === 'delete'
                ? 'buckets.confirm.deleteDescription'
                : 'buckets.confirm.reverseDescription'
            )}
            confirmLabel={t(
              confirmAction.kind === 'delete' ? 'buckets.actions.delete' : 'buckets.actions.reverse'
            )}
            cancelLabel={t('buckets.actions.cancel')}
            variant={confirmAction.kind === 'delete' ? 'destructive' : 'default'}
            isLoading={mutating}
            onConfirm={() => void confirm()}
          />
        </Suspense>
      ) : null}
    </NativePanel>
  )
}
