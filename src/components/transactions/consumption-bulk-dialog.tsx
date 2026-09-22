import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ClassificationBatchPlan,
  ClassificationBatchTarget,
  ClassificationCatalogEntry,
  ClassificationTypeRevision,
} from '@shikin/finance-core'
import { CheckCircle2, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorBanner } from '@/components/ui/error-banner'
import {
  applyConsumptionClassifications,
  listClassificationTypes,
  previewConsumptionClassifications,
  type ConsumptionClassificationBatchPreview,
} from '@/lib/classification-type-service'
import {
  readConsumptionClassificationContext,
  type ConsumptionAllocationView,
  type ConsumptionClassificationContext,
  type ConsumptionPurchaseOption,
} from '@/lib/consumption-service'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import { cn } from '@/lib/utils'

const MAX_TARGETS = 100

export interface ConsumptionBulkCandidate {
  id: string
  description: string
  date: string
  currency: string
  type: string
  amount: number
}

export interface ConsumptionBulkDialogProps {
  open: boolean
  candidates: readonly ConsumptionBulkCandidate[]
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

interface SelectedAllocation {
  key: string
  candidateId: string
  transaction: ConsumptionClassificationContext['transaction']
  allocation: ConsumptionAllocationView
  purchaseOptions: ConsumptionPurchaseOption[]
  treatmentKey: string
  referencedPurchaseId: string
}

interface ReviewedPreview {
  targets: readonly ClassificationBatchTarget[]
  result: ConsumptionClassificationBatchPreview
}

type AppliedReceipt = Awaited<ReturnType<typeof applyConsumptionClassifications>>

function allocationKey(transactionId: string, splitId: string | null): string {
  return JSON.stringify([transactionId, splitId])
}

function treatmentKey(entry: ClassificationCatalogEntry): string {
  return entry.kind === 'builtin'
    ? `builtin:${entry.id}`
    : `custom:${entry.id}:${entry.revisionId ?? ''}`
}

const currencyMetadata = Intl as typeof Intl & {
  supportedValuesOf?: (key: 'currency') => string[]
  DisplayNames?: new (
    locales: string[],
    options: { type: 'currency' }
  ) => { of: (currency: string) => string | undefined }
}
const supportedCurrencies = currencyMetadata.supportedValuesOf
  ? new Set(currencyMetadata.supportedValuesOf('currency'))
  : null
const currencyDisplayNames =
  !supportedCurrencies && currencyMetadata.DisplayNames
    ? new currencyMetadata.DisplayNames(['en'], { type: 'currency' })
    : null

function normalizeNativeCurrency(currency: string | null): string | null {
  const normalized = currency?.trim().toUpperCase()
  if (!normalized || !/^[A-Z]{3}$/.test(normalized)) return null
  if (supportedCurrencies) {
    if (!supportedCurrencies.has(normalized)) return null
  } else {
    const currencyName = currencyDisplayNames?.of(normalized)
    if (!currencyName || currencyName.toUpperCase() === normalized) return null
  }
  return normalized
}

function displayCurrency(currency: string | null): string {
  return normalizeNativeCurrency(currency) ?? '—'
}

function displayMoney(amount: number | null, currency: string | null): string {
  if (amount === null) return '—'
  const normalizedCurrency = normalizeNativeCurrency(currency)
  if (!normalizedCurrency) return '—'
  try {
    return formatMoney(amount, normalizedCurrency)
  } catch {
    return '—'
  }
}

function copyTargets(targets: readonly ClassificationBatchTarget[]): ClassificationBatchTarget[] {
  return targets.map((target) => ({ ...target }))
}

function PreviewItem({
  item,
  revisions,
}: {
  item: ClassificationBatchPlan['items'][number]
  revisions: readonly ClassificationTypeRevision[]
}) {
  const { t } = useTranslation('consumption')
  const source = item.source
  const currency = source?.currency ?? null
  const beforeRevision = item.before?.type_revision_id
    ? revisions.find((revision) => revision.id === item.before?.type_revision_id)
    : null
  const beforeLabel = !item.before
    ? t('bulk.preview.unclassified')
    : item.before.type_revision_id
      ? beforeRevision
        ? t('bulk.preview.customVersion', {
            name: beforeRevision.name,
            version: beforeRevision.version,
          })
        : t('bulk.preview.unavailable')
      : t(`bulk.roles.${item.before.role}`)
  const afterLabel = item.resolved
    ? item.resolved.typeId
      ? t('bulk.preview.customVersion', {
          name: item.resolved.name,
          version: item.resolved.version,
        })
      : t(`bulk.roles.${item.resolved.role}`)
    : t('bulk.preview.unavailable')
  const contribution = item.resolved?.contribution

  return (
    <article className="border-border bg-surface min-w-0 rounded-lg border p-3">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold break-words">
            {source?.transaction.description || t('bulk.preview.unknownTransaction')}
          </h4>
          <p className="text-muted-foreground mt-0.5 text-xs break-words">
            {source?.transaction.date || '—'} · {displayCurrency(currency)}
            {source?.split ? ` · ${t('bulk.preview.split')}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold break-all tabular-nums">
          {displayMoney(item.amountCentavos, currency)}
        </span>
      </div>

      <dl className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
        <div className="bg-muted/40 min-w-0 rounded-md p-2">
          <dt className="text-muted-foreground">{t('bulk.preview.before')}</dt>
          <dd className="mt-0.5 break-words">{beforeLabel}</dd>
          {item.before?.type_revision_id ? (
            <dd className="text-muted-foreground mt-1 font-mono text-[10px] break-all">
              {item.before.type_revision_id}
            </dd>
          ) : null}
        </div>
        <div className="bg-muted/40 min-w-0 rounded-md p-2">
          <dt className="text-muted-foreground">{t('bulk.preview.after')}</dt>
          <dd className="mt-0.5 break-words">{afterLabel}</dd>
          {item.resolved?.revisionId ? (
            <dd className="text-muted-foreground mt-1 font-mono text-[10px] break-all">
              {item.resolved.revisionId}
            </dd>
          ) : null}
        </div>
      </dl>

      {contribution ? (
        <dl className="mt-3 grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs sm:grid-cols-5">
          {(
            [
              ['consumptionCentavos', 'bulk.effects.consumption'],
              ['earnedIncomeCentavos', 'bulk.effects.earnedIncome'],
              ['otherIncomeCentavos', 'bulk.effects.otherIncome'],
              ['principalRecoveryCentavos', 'bulk.effects.principalRecovery'],
              ['assetAcquisitionCentavos', 'bulk.effects.assetAcquisition'],
            ] as const
          ).map(([field, label]) => (
            <div key={field} className="min-w-0">
              <dt className="text-muted-foreground break-words">{t(label)}</dt>
              <dd className="mt-0.5 font-medium break-all tabular-nums">
                {displayMoney(contribution[field], currency)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <p className="text-muted-foreground mt-3 font-mono text-[10px] break-all">
        {item.target.transactionId}
        {item.target.splitId ? ` / ${item.target.splitId}` : ''}
      </p>
      {item.errors.length > 0 ? (
        <ul className="text-destructive mt-3 list-disc space-y-1 pl-4 text-xs" role="alert">
          {item.errors.map((error) => (
            <li key={error} className="break-words">
              {error}
            </li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}

export function ConsumptionBulkDialog({
  open,
  candidates,
  onOpenChange,
  onChanged,
}: ConsumptionBulkDialogProps) {
  const { t } = useTranslation('consumption')
  const candidateRef = useRef(candidates)
  candidateRef.current = candidates
  const sessionRef = useRef(0)
  const inputVersionRef = useRef(0)
  const previewRequestRef = useRef(0)
  const applyPendingRef = useRef(false)
  const [scope, setScope] = useState<ConsumptionBulkCandidate[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [contexts, setContexts] = useState<Record<string, ConsumptionClassificationContext>>({})
  const [contextLoading, setContextLoading] = useState<Set<string>>(() => new Set())
  const [contextErrors, setContextErrors] = useState<Record<string, string>>({})
  const [catalog, setCatalog] = useState<ClassificationCatalogEntry[]>([])
  const [revisions, setRevisions] = useState<ClassificationTypeRevision[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, SelectedAllocation>>({})
  const [globalTreatment, setGlobalTreatment] = useState('')
  const [auditNote, setAuditNote] = useState('')
  const [reviewed, setReviewed] = useState<ReviewedPreview | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [previewPending, setPreviewPending] = useState(false)
  const [applyPending, setApplyPending] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<AppliedReceipt | null>(null)

  useEffect(() => {
    const session = ++sessionRef.current
    previewRequestRef.current += 1
    inputVersionRef.current += 1
    setScope(open ? candidateRef.current.map((candidate) => ({ ...candidate })) : [])
    setExpanded(new Set())
    setContexts({})
    setContextLoading(new Set())
    setContextErrors({})
    setCatalog([])
    setRevisions([])
    setCatalogError(null)
    setSelected({})
    setGlobalTreatment('')
    setAuditNote('')
    setReviewed(null)
    setConfirmed(false)
    setPreviewPending(false)
    applyPendingRef.current = false
    setApplyPending(false)
    setActionError(null)
    setReceipt(null)
    if (!open) return

    setCatalogLoading(true)
    void listClassificationTypes()
      .then((result) => {
        if (session !== sessionRef.current) return
        setCatalog(result.definitions)
        setRevisions(result.revisions)
      })
      .catch((error) => {
        if (session === sessionRef.current) setCatalogError(getErrorMessage(error))
      })
      .finally(() => {
        if (session === sessionRef.current) setCatalogLoading(false)
      })
  }, [open])

  const catalogByKey = useMemo(
    () => new Map(catalog.map((entry) => [treatmentKey(entry), entry])),
    [catalog]
  )
  const selectedRows = useMemo(() => Object.values(selected), [selected])

  const invalidatePreview = () => {
    inputVersionRef.current += 1
    previewRequestRef.current += 1
    setReviewed(null)
    setConfirmed(false)
    setPreviewPending(false)
    setActionError(null)
  }

  const loadContext = async (candidate: ConsumptionBulkCandidate) => {
    if (applyPendingRef.current || receipt) return
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(candidate.id)) next.delete(candidate.id)
      else next.add(candidate.id)
      return next
    })
    if (contexts[candidate.id] || contextLoading.has(candidate.id)) return
    const session = sessionRef.current
    setContextLoading((current) => new Set(current).add(candidate.id))
    setContextErrors((current) => {
      const next = { ...current }
      delete next[candidate.id]
      return next
    })
    try {
      const context = await readConsumptionClassificationContext(candidate.id)
      if (session !== sessionRef.current) return
      setContexts((current) => ({ ...current, [candidate.id]: context }))
    } catch (error) {
      if (session === sessionRef.current)
        setContextErrors((current) => ({ ...current, [candidate.id]: getErrorMessage(error) }))
    } finally {
      if (session === sessionRef.current)
        setContextLoading((current) => {
          const next = new Set(current)
          next.delete(candidate.id)
          return next
        })
    }
  }

  const toggleAllocation = (
    candidate: ConsumptionBulkCandidate,
    context: ConsumptionClassificationContext,
    allocation: ConsumptionAllocationView
  ) => {
    if (applyPendingRef.current || receipt) return
    const key = allocationKey(candidate.id, allocation.splitId)
    invalidatePreview()
    setGlobalTreatment('')
    setSelected((current) => {
      if (current[key]) {
        const next = { ...current }
        delete next[key]
        return next
      }
      if (Object.keys(current).length >= MAX_TARGETS) return current
      return {
        ...current,
        [key]: {
          key,
          candidateId: candidate.id,
          transaction: { ...context.transaction },
          allocation,
          purchaseOptions: context.purchaseOptions,
          treatmentKey: '',
          referencedPurchaseId: '',
        },
      }
    })
  }

  const updateSelected = (key: string, patch: Partial<SelectedAllocation>) => {
    if (applyPendingRef.current || receipt) return
    invalidatePreview()
    setSelected((current) => ({
      ...current,
      [key]: { ...current[key]!, ...patch },
    }))
  }

  const applyGlobalTreatment = (value: string) => {
    if (applyPendingRef.current || receipt) return
    invalidatePreview()
    setGlobalTreatment(value)
    if (!value) return
    const definition = catalogByKey.get(value)
    setSelected((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key, allocation]) => [
          key,
          {
            ...allocation,
            treatmentKey: value,
            referencedPurchaseId: definition?.requiresPurchase
              ? allocation.referencedPurchaseId
              : '',
          },
        ])
      )
    )
  }

  const buildTargets = (): ClassificationBatchTarget[] | null => {
    const targets: ClassificationBatchTarget[] = []
    for (const row of selectedRows) {
      const definition = catalogByKey.get(row.treatmentKey)
      if (!definition) {
        setActionError(t('bulk.errors.treatmentRequired'))
        return null
      }
      if (definition.requiresPurchase && !row.referencedPurchaseId) {
        setActionError(t('bulk.errors.purchaseRequired'))
        return null
      }
      const owner = {
        transactionId: row.candidateId,
        splitId: row.allocation.splitId,
        referencedPurchaseId: definition.requiresPurchase ? row.referencedPurchaseId : null,
      }
      targets.push(
        definition.kind === 'builtin'
          ? { ...owner, builtinRole: definition.role }
          : {
              ...owner,
              customTypeId: definition.id,
              expectedRevisionId: definition.revisionId!,
            }
      )
    }
    return targets
  }

  const requestPreview = async () => {
    if (applyPendingRef.current || receipt) return
    if (selectedRows.length === 0) {
      setActionError(t('bulk.errors.selectionRequired'))
      return
    }
    const targets = buildTargets()
    if (!targets) return
    const request = ++previewRequestRef.current
    const session = sessionRef.current
    const inputVersion = inputVersionRef.current
    setActionError(null)
    setReviewed(null)
    setConfirmed(false)
    setPreviewPending(true)
    try {
      const result = await previewConsumptionClassifications(targets)
      if (
        request !== previewRequestRef.current ||
        session !== sessionRef.current ||
        inputVersion !== inputVersionRef.current
      )
        return
      setReviewed({ targets: copyTargets(targets), result })
    } catch (error) {
      if (
        request === previewRequestRef.current &&
        session === sessionRef.current &&
        inputVersion === inputVersionRef.current
      )
        setActionError(getErrorMessage(error))
    } finally {
      if (request === previewRequestRef.current && session === sessionRef.current)
        setPreviewPending(false)
    }
  }

  const applyReviewed = async () => {
    if (
      !reviewed ||
      !reviewed.result.applicable ||
      !reviewed.result.changed ||
      !confirmed ||
      applyPendingRef.current ||
      receipt
    )
      return
    applyPendingRef.current = true
    const reviewedSnapshot = reviewed
    const note = auditNote.trim()
    const session = sessionRef.current
    setApplyPending(true)
    setActionError(null)
    try {
      const result = await applyConsumptionClassifications({
        targets: reviewedSnapshot.targets,
        previewToken: reviewedSnapshot.result.previewToken,
        ...(note ? { auditNote: note } : {}),
      })
      if (session !== sessionRef.current) return
      setReceipt(result)
      setConfirmed(false)
      if (result.batchId) onChanged?.()
    } catch (error) {
      if (session !== sessionRef.current) return
      setActionError(getErrorMessage(error))
      setReviewed(null)
      setConfirmed(false)
      inputVersionRef.current += 1
      previewRequestRef.current += 1
    } finally {
      if (session === sessionRef.current) {
        applyPendingRef.current = false
        setApplyPending(false)
      }
    }
  }

  const setAuditNoteValue = (value: string) => {
    if (applyPendingRef.current || receipt) return
    invalidatePreview()
    setAuditNote(value)
  }

  const editorLocked = applyPending || Boolean(receipt)
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && applyPendingRef.current) return
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-busy={applyPending}
        className="max-h-[calc(100dvh-1rem)] min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-4 sm:max-w-4xl sm:p-5"
      >
        <DialogHeader className="min-w-0 pr-7 text-left">
          <DialogTitle className="break-words">{t('bulk.title')}</DialogTitle>
          <DialogDescription className="break-words">
            {t('bulk.description', { count: scope.length })}
          </DialogDescription>
          <p className="sr-only" role="status" aria-live="polite">
            {applyPending ? t('bulk.actions.applying') : ''}
          </p>
        </DialogHeader>

        <fieldset
          disabled={editorLocked}
          className="m-0 min-h-0 min-w-0 space-y-4 overflow-y-auto overscroll-contain border-0 p-0 pr-1"
        >
          <section aria-labelledby="bulk-picker-heading" className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
              <div className="min-w-0">
                <h3 id="bulk-picker-heading" className="text-sm font-semibold">
                  {t('bulk.candidates.title')}
                </h3>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {t('bulk.candidates.scope', { count: scope.length })}
                </p>
              </div>
              <span className="text-muted-foreground text-xs font-medium tabular-nums">
                {t('bulk.selection.count', { count: selectedRows.length, max: MAX_TARGETS })}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              {scope.map((candidate) => {
                const context = contexts[candidate.id]
                const source = context?.transaction ?? candidate
                const sourceCurrency = normalizeNativeCurrency(source.currency)
                const isExpanded = expanded.has(candidate.id)
                const isLoading = contextLoading.has(candidate.id)
                return (
                  <article key={candidate.id} className="border-border min-w-0 rounded-lg border">
                    <button
                      type="button"
                      className="hover:bg-muted/45 focus-visible:ring-ring flex min-h-11 w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left focus-visible:ring-2 focus-visible:outline-none"
                      aria-expanded={isExpanded}
                      onClick={() => void loadContext(candidate)}
                    >
                      {isLoading ? (
                        <Loader2 className="text-muted-foreground h-4 w-4 shrink-0 animate-spin" />
                      ) : isExpanded ? (
                        <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
                      ) : (
                        <ChevronRight className="text-muted-foreground h-4 w-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium break-words">
                          {source.description}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs break-words">
                          {source.date} · {sourceCurrency ?? '—'} · {source.type}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold break-all tabular-nums">
                        {displayMoney(source.amount, sourceCurrency)}
                      </span>
                    </button>

                    {isExpanded ? (
                      <div className="border-border bg-muted/25 min-w-0 space-y-2 border-t p-3">
                        {contextErrors[candidate.id] ? (
                          <ErrorBanner
                            title={t('bulk.errors.contextTitle')}
                            message={contextErrors[candidate.id]}
                            retryLabel={t('bulk.actions.retry')}
                            onRetry={() => {
                              setExpanded((current) => {
                                const next = new Set(current)
                                next.delete(candidate.id)
                                return next
                              })
                              setContextErrors((current) => {
                                const next = { ...current }
                                delete next[candidate.id]
                                return next
                              })
                              void loadContext(candidate)
                            }}
                          />
                        ) : context ? (
                          context.allocations.map((allocation, index) => {
                            const key = allocationKey(candidate.id, allocation.splitId)
                            const checked = Boolean(selected[key])
                            const capped = selectedRows.length >= MAX_TARGETS && !checked
                            return (
                              <label
                                key={key}
                                className={cn(
                                  'bg-surface flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-md border p-2.5',
                                  checked ? 'border-[var(--color-border-accent)]' : 'border-border',
                                  capped && 'cursor-not-allowed opacity-60'
                                )}
                              >
                                <input
                                  type="checkbox"
                                  className="accent-primary mt-0.5 h-4 w-4 shrink-0"
                                  checked={checked}
                                  disabled={capped}
                                  onChange={() => toggleAllocation(candidate, context, allocation)}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-xs font-medium break-words">
                                    {allocation.splitId
                                      ? t('bulk.candidates.split', { number: index + 1 })
                                      : t('bulk.candidates.parent')}
                                    {allocation.categoryName ? ` · ${allocation.categoryName}` : ''}
                                  </span>
                                  <span className="text-muted-foreground mt-0.5 block text-[11px] break-words">
                                    {allocation.classification?.type_revision_id &&
                                    allocation.classificationDisplay
                                      ? t('bulk.candidates.currentCustom', {
                                          name: allocation.classificationDisplay.name,
                                          version: allocation.classificationDisplay.version,
                                        })
                                      : allocation.classification
                                        ? t('bulk.candidates.currentBuiltin', {
                                            name: t(`bulk.roles.${allocation.classification.role}`),
                                          })
                                        : t('bulk.candidates.unclassified')}
                                  </span>
                                  {allocation.splitId ? (
                                    <span className="text-muted-foreground mt-0.5 block font-mono text-[10px] break-all">
                                      {allocation.splitId}
                                    </span>
                                  ) : null}
                                </span>
                                <span className="shrink-0 text-xs font-semibold break-all tabular-nums">
                                  {displayMoney(allocation.amountCentavos, sourceCurrency)}
                                </span>
                              </label>
                            )
                          })
                        ) : (
                          <p className="text-muted-foreground py-2 text-center text-xs">
                            {t('bulk.candidates.loading')}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </article>
                )
              })}
              {scope.length === 0 ? (
                <p className="border-border text-muted-foreground rounded-lg border border-dashed p-4 text-center text-sm">
                  {t('bulk.candidates.empty')}
                </p>
              ) : null}
            </div>
          </section>

          {selectedRows.length > 0 ? (
            <section aria-labelledby="bulk-treatment-heading" className="min-w-0">
              <h3 id="bulk-treatment-heading" className="text-sm font-semibold">
                {t('bulk.treatment.title')}
              </h3>
              <label className="text-muted-foreground mt-2 block min-w-0 text-xs">
                {t('bulk.treatment.setAll')}
                <select
                  className="native-select text-foreground mt-1 block min-h-11 w-full min-w-0"
                  value={globalTreatment}
                  disabled={catalogLoading || Boolean(catalogError)}
                  onChange={(event) => applyGlobalTreatment(event.target.value)}
                >
                  <option value="">{t('bulk.treatment.chooseForAll')}</option>
                  <TreatmentOptions catalog={catalog} />
                </select>
              </label>
              {catalogLoading ? (
                <p className="text-muted-foreground mt-2 text-xs">{t('bulk.treatment.loading')}</p>
              ) : null}
              <ErrorBanner title={t('bulk.errors.catalogTitle')} message={catalogError} />

              <div className="mt-3 space-y-3">
                {selectedRows.map((row) => {
                  const definition = catalogByKey.get(row.treatmentKey)
                  return (
                    <article
                      key={row.key}
                      className="border-border bg-muted/25 min-w-0 rounded-lg border p-3"
                    >
                      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <h4 className="text-sm font-medium break-words">
                            {row.transaction.description}
                          </h4>
                          <p className="text-muted-foreground text-xs break-words">
                            {row.transaction.date} · {displayCurrency(row.transaction.currency)} ·{' '}
                            {row.allocation.splitId
                              ? t('bulk.candidates.splitId', { id: row.allocation.splitId })
                              : t('bulk.candidates.parent')}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs font-semibold break-all tabular-nums">
                          {displayMoney(row.allocation.amountCentavos, row.transaction.currency)}
                        </span>
                      </div>
                      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                        <label className="text-muted-foreground min-w-0 text-xs">
                          {t('bulk.treatment.override')}
                          <select
                            className="native-select text-foreground mt-1 block min-h-11 w-full min-w-0"
                            value={row.treatmentKey}
                            disabled={catalogLoading || Boolean(catalogError)}
                            onChange={(event) => {
                              const next = catalogByKey.get(event.target.value)
                              setGlobalTreatment('')
                              updateSelected(row.key, {
                                treatmentKey: event.target.value,
                                referencedPurchaseId: next?.requiresPurchase
                                  ? row.referencedPurchaseId
                                  : '',
                              })
                            }}
                          >
                            <option value="">{t('bulk.treatment.choose')}</option>
                            <TreatmentOptions catalog={catalog} />
                          </select>
                        </label>
                        {definition?.requiresPurchase ? (
                          <label className="text-muted-foreground min-w-0 text-xs">
                            {t('bulk.treatment.purchase')}
                            <select
                              className="native-select text-foreground mt-1 block min-h-11 w-full min-w-0"
                              value={row.referencedPurchaseId}
                              onChange={(event) =>
                                updateSelected(row.key, {
                                  referencedPurchaseId: event.target.value,
                                })
                              }
                            >
                              <option value="">{t('bulk.treatment.choosePurchase')}</option>
                              {row.purchaseOptions.map((option) => (
                                <option
                                  key={option.classificationId}
                                  value={option.classificationId}
                                >
                                  {option.date} · {option.description} ·{' '}
                                  {displayMoney(option.amountCentavos, option.currency)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                      </div>
                      {definition ? (
                        <p className="text-muted-foreground mt-2 text-xs break-words">
                          {t(`bulk.direction.${definition.direction}`)} ·{' '}
                          {t(`guidance.${definition.role}`)}
                          {definition.kind === 'custom'
                            ? ` · ${t('bulk.treatment.version', { version: definition.version })}`
                            : ''}
                        </p>
                      ) : null}
                    </article>
                  )
                })}
              </div>

              <label className="text-muted-foreground mt-3 block min-w-0 text-xs">
                {t('bulk.auditNote.label')}
                <textarea
                  value={auditNote}
                  onChange={(event) => setAuditNoteValue(event.target.value)}
                  rows={2}
                  className="border-input bg-surface text-foreground focus-visible:ring-ring mt-1 block w-full min-w-0 rounded-lg border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  placeholder={t('bulk.auditNote.placeholder')}
                />
              </label>
              <Button
                type="button"
                variant="outline"
                className="mt-3 min-h-11 w-full sm:w-auto"
                disabled={previewPending || catalogLoading || Boolean(catalogError)}
                onClick={() => void requestPreview()}
              >
                {previewPending ? <Loader2 className="animate-spin" /> : null}
                {previewPending ? t('bulk.actions.previewing') : t('bulk.actions.preview')}
              </Button>
            </section>
          ) : null}

          <ErrorBanner title={t('bulk.errors.actionTitle')} message={actionError} />

          {reviewed ? (
            <section aria-labelledby="bulk-preview-heading" className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="bulk-preview-heading" className="text-sm font-semibold">
                    {t('bulk.preview.title')}
                  </h3>
                  <p className="text-muted-foreground mt-0.5 text-xs break-words">
                    {t('bulk.preview.guidance')}
                  </p>
                </div>
                <span
                  className={cn(
                    'rounded-full px-2 py-1 text-xs font-medium',
                    reviewed.result.applicable
                      ? 'bg-success/10 text-success'
                      : 'bg-destructive/10 text-destructive'
                  )}
                >
                  {reviewed.result.applicable
                    ? t('bulk.preview.applicable')
                    : t('bulk.preview.invalid')}
                </span>
              </div>
              <ErrorBanner
                title={t('bulk.preview.globalErrors')}
                messages={reviewed.result.errors}
                className="mt-3"
              />
              {!reviewed.result.changed && reviewed.result.applicable ? (
                <div className="border-border bg-muted/35 mt-3 rounded-lg border p-3 text-sm">
                  {t('bulk.preview.noChanges')}
                </div>
              ) : null}
              <div className="mt-3 space-y-2">
                {reviewed.result.items.map((item) => (
                  <PreviewItem
                    key={allocationKey(item.target.transactionId, item.target.splitId)}
                    item={item}
                    revisions={revisions}
                  />
                ))}
              </div>
              <div className="border-border bg-muted/35 mt-3 rounded-lg border p-3 text-xs leading-relaxed">
                <p className="font-medium">{t('bulk.effects.title')}</p>
                <p className="text-muted-foreground mt-1">{t('bulk.effects.statement')}</p>
              </div>
              {reviewed.result.applicable && reviewed.result.changed ? (
                <label className="border-border mt-3 flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 h-4 w-4 shrink-0"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span className="break-words">{t('bulk.preview.confirm')}</span>
                </label>
              ) : null}
            </section>
          ) : null}

          {receipt ? (
            <section
              className="border-success/30 bg-success/8 min-w-0 rounded-lg border p-3"
              aria-labelledby="bulk-receipt-heading"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="text-success mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <h3 id="bulk-receipt-heading" className="text-sm font-semibold">
                    {t('bulk.receipt.title')}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t('bulk.receipt.applied', {
                      count: receipt.items.filter((item) => item.changed).length,
                    })}
                  </p>
                  <ul className="text-muted-foreground mt-2 space-y-1 font-mono text-[10px]">
                    {receipt.items
                      .filter((item) => item.changed && item.after)
                      .map((item) => (
                        <li
                          key={allocationKey(item.target.transactionId, item.target.splitId)}
                          className="break-all"
                        >
                          {item.after!.id}
                        </li>
                      ))}
                  </ul>
                </div>
              </div>
            </section>
          ) : null}
        </fieldset>

        <DialogFooter className="border-border min-w-0 gap-2 border-t pt-3 sm:space-x-0">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full min-w-0 sm:w-auto"
            disabled={applyPending}
            onClick={() => handleOpenChange(false)}
          >
            {receipt ? t('bulk.actions.done') : t('bulk.actions.cancel')}
          </Button>
          {!receipt ? (
            <Button
              type="button"
              className="min-h-11 w-full min-w-0 sm:w-auto"
              disabled={
                !reviewed ||
                !reviewed.result.applicable ||
                !reviewed.result.changed ||
                !confirmed ||
                applyPending
              }
              onClick={() => void applyReviewed()}
            >
              {applyPending ? <Loader2 className="animate-spin" /> : null}
              {applyPending ? t('bulk.actions.applying') : t('bulk.actions.apply')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TreatmentOptions({ catalog }: { catalog: readonly ClassificationCatalogEntry[] }) {
  const { t } = useTranslation('consumption')
  const builtins = catalog.filter((entry) => entry.kind === 'builtin')
  const custom = catalog.filter((entry) => entry.kind === 'custom')
  return (
    <>
      <optgroup label={t('bulk.treatment.builtins')}>
        {builtins.map((entry) => (
          <option key={treatmentKey(entry)} value={treatmentKey(entry)}>
            {t(`bulk.roles.${entry.role}`)} · {t(`bulk.direction.${entry.direction}`)}
          </option>
        ))}
      </optgroup>
      {custom.length > 0 ? (
        <optgroup label={t('bulk.treatment.custom')}>
          {custom.map((entry) => (
            <option key={treatmentKey(entry)} value={treatmentKey(entry)}>
              {entry.name} · {t('bulk.treatment.version', { version: entry.version })} ·{' '}
              {t(`bulk.direction.${entry.direction}`)}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  )
}
