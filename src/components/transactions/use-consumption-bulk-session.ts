import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ClassificationBatchTarget,
  ClassificationCatalogEntry,
  ClassificationTypeRevision,
} from '@shikin/finance-core'
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

export const MAX_TARGETS = 100

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

export function allocationKey(transactionId: string, splitId: string | null): string {
  return JSON.stringify([transactionId, splitId])
}

export function treatmentKey(entry: ClassificationCatalogEntry): string {
  return entry.kind === 'builtin'
    ? `builtin:${entry.id}`
    : `custom:${entry.id}:${entry.revisionId ?? ''}`
}

function copyTargets(targets: readonly ClassificationBatchTarget[]): ClassificationBatchTarget[] {
  return targets.map((target) => ({ ...target }))
}

export function useConsumptionBulkSession({
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
  // The ref guards same-turn actions; applyPending also locks the rendered editor.
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

  const retryContext = (candidate: ConsumptionBulkCandidate) => {
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

  const setAllocationTreatment = (row: SelectedAllocation, value: string) => {
    const next = catalogByKey.get(value)
    setGlobalTreatment('')
    updateSelected(row.key, {
      treatmentKey: value,
      referencedPurchaseId: next?.requiresPurchase ? row.referencedPurchaseId : '',
    })
  }

  const setPurchaseReference = (key: string, value: string) => {
    updateSelected(key, { referencedPurchaseId: value })
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

  return {
    scope,
    expanded,
    contexts,
    contextLoading,
    contextErrors,
    catalog,
    revisions,
    catalogLoading,
    catalogError,
    selected,
    globalTreatment,
    auditNote,
    reviewed,
    confirmed,
    previewPending,
    applyPending,
    actionError,
    receipt,
    catalogByKey,
    selectedRows,
    loadContext,
    retryContext,
    toggleAllocation,
    setAllocationTreatment,
    setPurchaseReference,
    applyGlobalTreatment,
    requestPreview,
    applyReviewed,
    setAuditNoteValue,
    setConfirmed,
    editorLocked,
    handleOpenChange,
  }
}
