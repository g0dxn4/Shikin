import { useState, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import {
  previewStatementFile,
  type StatementImportPreview,
  type StatementImportTreatment,
  type StatementImportTreatmentOptions,
} from '@/lib/statement-import'
import { importStatementFile } from '@/lib/statement-import-actions'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
import { getErrorMessage } from '@/lib/errors'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'

type ImportStep = 'select' | 'preview' | 'importing' | 'done'

interface StatementImportSelection {
  readonly selectedFile: File | null
  readonly accountId: string
  readonly decisions: ImportReviewDecision[]
  readonly treatment: StatementImportTreatment
  readonly stagingBatchId: string
  readonly acknowledgePending: boolean
}

interface BoundStatementImportPreview {
  readonly selection: StatementImportSelection
  readonly token: string
}

interface StatementImportPreviewState {
  binding: BoundStatementImportPreview | null
  requiredDecisions: ImportReviewDecision[]
  reviewCandidates: StatementImportPreview['reviewCandidates']
  plannedImported: number
  plannedSkipped: number
  limitations: string[]
  resolvedTreatment: StatementImportTreatment
  resolvedStagingBatchId: string | null
  plannedStaged: number
  plannedPending: number
  balanceImpactCentavos: number
  previewCurrency: string | null
}

function emptySelection(): StatementImportSelection {
  return {
    selectedFile: null,
    accountId: '',
    decisions: [],
    treatment: 'posted',
    stagingBatchId: '',
    acknowledgePending: false,
  }
}

function emptyPreview(): StatementImportPreviewState {
  return {
    binding: null,
    requiredDecisions: [],
    reviewCandidates: [],
    plannedImported: 0,
    plannedSkipped: 0,
    limitations: [],
    resolvedTreatment: 'posted',
    resolvedStagingBatchId: null,
    plannedStaged: 0,
    plannedPending: 0,
    balanceImpactCentavos: 0,
    previewCurrency: null,
  }
}

function uniqueStrings(...groups: Array<readonly string[] | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const group of groups) {
    if (!group) continue
    for (const value of group) {
      if (seen.has(value)) continue
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

function candidateKey(
  candidate: Pick<ImportReviewDecision, 'candidateIdentityKey' | 'existingTransactionId'>
): string {
  return `${candidate.candidateIdentityKey}:${candidate.existingTransactionId}`
}

function isSameCandidate(
  left: Pick<ImportReviewDecision, 'candidateIdentityKey' | 'existingTransactionId'>,
  right: Pick<ImportReviewDecision, 'candidateIdentityKey' | 'existingTransactionId'>
): boolean {
  return candidateKey(left) === candidateKey(right)
}

function reviewDecisionPayload(
  candidate: ImportReviewDecision,
  decision: ImportReviewDecision['decision']
): ImportReviewDecision {
  return {
    candidateIdentityKey: candidate.candidateIdentityKey,
    candidateContentFingerprint: candidate.candidateContentFingerprint,
    existingTransactionId: candidate.existingTransactionId,
    existingEvidenceFingerprint: candidate.existingEvidenceFingerprint,
    decision,
  }
}

function isStalePreviewError(errors: readonly string[]): boolean {
  return errors.some((error) => /stale/i.test(error))
}

function isStaleDecisionBindingError(errors: readonly string[]): boolean {
  return errors.some((error) =>
    /duplicate decisions are stale|stale binding|do not belong to this statement plan/i.test(error)
  )
}

export function useStatementImportSession({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('transactions')
  const fileRequestIdRef = useRef(0)
  const previewRequestIdRef = useRef(0)
  const importRequestIdRef = useRef(0)
  const [selection, setSelection] = useState(emptySelection)
  const selectionRef = useRef({ open, ...selection })
  const [preview, setPreview] = useState(emptyPreview)
  const [step, setStep] = useState<ImportStep>('select')
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const { selectedFile, accountId, decisions, treatment, stagingBatchId, acknowledgePending } =
    selection

  selectionRef.current = { open, ...selection }

  const clearPreviewBinding = useCallback(() => {
    setPreview(emptyPreview())
  }, [])

  const invalidateInFlightPreview = useCallback(() => {
    previewRequestIdRef.current += 1
    importRequestIdRef.current += 1
    setIsImporting(false)
  }, [])

  const resetState = useCallback(() => {
    fileRequestIdRef.current += 1
    previewRequestIdRef.current += 1
    importRequestIdRef.current += 1
    setStep('select')
    setSelection(emptySelection())
    setParsedTransactions([])
    setParseError(null)
    setPreviewError(null)
    setIsImporting(false)
    setPreview(emptyPreview())
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) resetState()
      onOpenChange(nextOpen)
    },
    [onOpenChange, resetState]
  )

  const handleAccountChange = useCallback(
    (value: string) => {
      invalidateInFlightPreview()
      setSelection((current) => ({ ...current, accountId: value, decisions: [] }))
      setPreviewError(null)
      clearPreviewBinding()
    },
    [clearPreviewBinding, invalidateInFlightPreview]
  )

  const clearTreatmentPreview = useCallback(() => {
    invalidateInFlightPreview()
    setPreviewError(null)
    setSelection((current) => ({ ...current, decisions: [] }))
    clearPreviewBinding()
  }, [clearPreviewBinding, invalidateInFlightPreview])

  const handleTreatmentChange = useCallback(
    (value: string) => {
      clearTreatmentPreview()
      setSelection((current) => ({
        ...current,
        treatment: value as StatementImportTreatment,
        acknowledgePending: false,
        stagingBatchId: value === 'posted' ? '' : current.stagingBatchId,
      }))
    },
    [clearTreatmentPreview]
  )

  const handleBatchChange = useCallback(
    (value: string) => {
      clearTreatmentPreview()
      setSelection((current) => ({ ...current, stagingBatchId: value }))
    },
    [clearTreatmentPreview]
  )

  const handlePendingAcknowledgement = useCallback(
    (checked: boolean) => {
      clearTreatmentPreview()
      setSelection((current) => ({ ...current, acknowledgePending: checked }))
    },
    [clearTreatmentPreview]
  )

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const file = input.files?.[0]
      input.value = ''
      if (!file) return

      const requestId = ++fileRequestIdRef.current
      invalidateInFlightPreview()
      setSelection((current) => ({ ...current, selectedFile: file, decisions: [] }))
      setParseError(null)
      setPreviewError(null)
      setParsedTransactions([])
      clearPreviewBinding()

      try {
        const content = await file.text()
        if (requestId !== fileRequestIdRef.current) return
        if (!selectionRef.current.open) return
        if (selectionRef.current.selectedFile !== file) return
        const parsed = parseStatement(content, file.name)
        if (requestId !== fileRequestIdRef.current) return
        if (!selectionRef.current.open) return
        if (selectionRef.current.selectedFile !== file) return
        setParsedTransactions(parsed)
        if (parsed.length === 0) {
          setParseError('No transactions found in file.')
        }
      } catch (err) {
        if (requestId !== fileRequestIdRef.current) return
        if (!selectionRef.current.open) return
        if (selectionRef.current.selectedFile !== file) return
        setParseError(err instanceof Error ? err.message : 'Failed to parse file')
        setParsedTransactions([])
      }
    },
    [clearPreviewBinding, invalidateInFlightPreview]
  )

  const canPreview = Boolean(
    selectedFile &&
    parsedTransactions.length > 0 &&
    accountId &&
    (treatment !== 'staged_pending' || acknowledgePending)
  )
  const reviewCandidateByKey = new Map(
    preview.reviewCandidates.map((candidate) => [candidateKey(candidate), candidate])
  )
  const actionableReviews = preview.requiredDecisions.flatMap((candidate) => {
    const key = candidateKey(candidate)
    const details = reviewCandidateByKey.get(key)
    return details
      ? [
          {
            key,
            candidate,
            details,
            decision: decisions.find((item) => isSameCandidate(item, candidate))?.decision,
          },
        ]
      : []
  })
  const candidatesMissingDetails =
    preview.requiredDecisions.length > 0 &&
    actionableReviews.length !== preview.requiredDecisions.length
  const hasUnresolvedDecisions = preview.requiredDecisions.some(
    (candidate) => !decisions.some((decision) => isSameCandidate(decision, candidate))
  )
  const canImport = Boolean(
    canPreview &&
    preview.binding &&
    preview.requiredDecisions.length === 0 &&
    !candidatesMissingDetails &&
    !previewError &&
    !isImporting
  )

  const handlePreview = useCallback(async () => {
    if (!selectedFile || !accountId) return
    const requestId = ++previewRequestIdRef.current
    const requestedSelection = selection
    const requestedFile = selectedFile
    const requestedAccountId = accountId
    const requestedDecisions = decisions.map((item) => reviewDecisionPayload(item, item.decision))
    const requestedTreatment = treatment
    const requestedStagingBatchId = stagingBatchId
    const requestedAcknowledgePending = acknowledgePending
    const treatmentOptions: StatementImportTreatmentOptions = {
      treatment: requestedTreatment,
      stagingBatchId: requestedStagingBatchId.trim() || undefined,
      acknowledgePending: requestedAcknowledgePending,
    }
    setIsImporting(true)
    setPreviewError(null)
    try {
      const result =
        requestedTreatment === 'posted'
          ? await previewStatementFile(requestedFile, requestedAccountId, requestedDecisions)
          : await previewStatementFile(
              requestedFile,
              requestedAccountId,
              requestedDecisions,
              treatmentOptions
            )
      if (requestId !== previewRequestIdRef.current) return
      if (!selectionRef.current.open) return
      if (selectionRef.current.selectedFile !== requestedFile) return
      if (selectionRef.current.accountId !== requestedAccountId) return
      if (selectionRef.current.decisions !== decisions) return
      if (selectionRef.current.treatment !== requestedTreatment) return
      if (selectionRef.current.stagingBatchId !== requestedStagingBatchId) return
      if (selectionRef.current.acknowledgePending !== requestedAcknowledgePending) return

      if (result.errors.length) {
        const staleDecisions = isStaleDecisionBindingError(result.errors)
        setPreviewError(result.errors[0])
        setPreview((current) => ({
          ...current,
          binding: null,
          ...(staleDecisions ? { requiredDecisions: [], reviewCandidates: [] } : {}),
        }))
        if (staleDecisions) {
          setSelection((current) => ({ ...current, decisions: [] }))
        }
        return
      }

      setParsedTransactions(result.parsedTransactions)
      setPreview({
        binding:
          result.success && result.previewToken
            ? { selection: requestedSelection, token: result.previewToken }
            : null,
        requiredDecisions: result.requiredDecisions,
        reviewCandidates: result.reviewCandidates,
        plannedImported: result.imported,
        plannedSkipped: result.skipped,
        limitations: uniqueStrings(result.limitations, result.legacyEvidenceLimitations),
        resolvedTreatment: result.treatment,
        resolvedStagingBatchId: result.stagingBatchId,
        plannedStaged: result.stagedCount,
        plannedPending: result.pendingCount,
        balanceImpactCentavos: result.balanceImpactCentavos,
        previewCurrency: result.accountCurrency,
      })
      setStep('preview')
    } finally {
      if (requestId === previewRequestIdRef.current) {
        setIsImporting(false)
      }
    }
  }, [selection, selectedFile, accountId, decisions, treatment, stagingBatchId, acknowledgePending])

  const setCandidateDecision = useCallback(
    (candidate: ImportReviewDecision, decision: ImportReviewDecision['decision']) => {
      invalidateInFlightPreview()
      setSelection((current) => ({
        ...current,
        decisions: [
          ...current.decisions.filter((item) => !isSameCandidate(item, candidate)),
          reviewDecisionPayload(candidate, decision),
        ],
      }))
      setPreview((current) => ({ ...current, binding: null }))
    },
    [invalidateInFlightPreview]
  )

  const handleImport = useCallback(async () => {
    if (
      !selectedFile ||
      !accountId ||
      !preview.binding ||
      preview.requiredDecisions.length > 0 ||
      candidatesMissingDetails
    ) {
      return
    }

    const requestId = ++importRequestIdRef.current
    const reviewedSelection = preview.binding.selection
    const requestedFile = reviewedSelection.selectedFile!
    const requestedAccountId = reviewedSelection.accountId
    const requestedToken = preview.binding.token
    const requestedDecisions = decisions.map((item) => reviewDecisionPayload(item, item.decision))
    const requestedTreatment = reviewedSelection.treatment
    const requestedStagingBatchId = reviewedSelection.stagingBatchId
    const requestedAcknowledgePending = reviewedSelection.acknowledgePending

    setIsImporting(true)
    setStep('importing')
    setPreviewError(null)

    try {
      const result = await importStatementFile(requestedFile, requestedAccountId, {
        previewToken: requestedToken,
        decisions: requestedDecisions,
        ...(requestedTreatment === 'posted'
          ? {}
          : {
              treatment: requestedTreatment,
              stagingBatchId: requestedStagingBatchId.trim() || undefined,
              acknowledgePending: requestedAcknowledgePending,
            }),
      })

      if (result.imported > 0) invalidateTransactionPage('import')

      const isStaleResult =
        requestId !== importRequestIdRef.current ||
        !selectionRef.current.open ||
        selectionRef.current.selectedFile !== requestedFile ||
        selectionRef.current.accountId !== requestedAccountId ||
        selectionRef.current.treatment !== requestedTreatment ||
        selectionRef.current.stagingBatchId !== requestedStagingBatchId ||
        selectionRef.current.acknowledgePending !== requestedAcknowledgePending
      if (isStaleResult) return

      if (result.errors.length > 0) {
        if (result.imported === 0) {
          toast.error(t('import.error'), {
            description: result.errors[0],
          })
        } else {
          toast.warning(
            t('import.partialError', {
              imported: result.imported,
              errorCount: result.errors.length,
            })
          )
        }
        if (isStalePreviewError(result.errors)) {
          setPreview((current) => ({ ...current, binding: null }))
          setPreviewError(t('import.stalePreview'))
        }
        if (isStaleDecisionBindingError(result.errors)) {
          setSelection((current) => ({ ...current, decisions: [] }))
          setPreview((current) => ({ ...current, requiredDecisions: [], reviewCandidates: [] }))
        }
        setStep('preview')
        return
      }

      if (result.skipped > 0) {
        toast.success(
          t('import.success', {
            imported: result.imported,
            skipped: result.skipped,
          })
        )
      } else {
        toast.success(
          t('import.successNoSkip', {
            imported: result.imported,
          })
        )
      }

      handleOpenChange(false)
    } catch (error) {
      if (requestId !== importRequestIdRef.current) return
      if (!selectionRef.current.open) return
      toast.error(getErrorMessage(error, t('import.error')))
      setPreviewError(getErrorMessage(error, t('import.error')))
      setStep('preview')
    } finally {
      if (requestId === importRequestIdRef.current) {
        setIsImporting(false)
      }
    }
  }, [
    selectedFile,
    accountId,
    preview.binding,
    preview.requiredDecisions.length,
    candidatesMissingDetails,
    decisions,
    t,
    handleOpenChange,
  ])

  const handleBackToSelection = useCallback(() => setStep('select'), [])

  return {
    selection,
    preview,
    step,
    parsedTransactions,
    parseError,
    previewError,
    isImporting,
    canPreview,
    canImport,
    actionableReviews,
    candidatesMissingDetails,
    hasUnresolvedDecisions,
    showReviewActions: preview.requiredDecisions.length > 0 && !candidatesMissingDetails,
    handleOpenChange,
    handleAccountChange,
    handleTreatmentChange,
    handleBatchChange,
    handlePendingAcknowledgement,
    handleFileSelect,
    handlePreview,
    setCandidateDecision,
    handleImport,
    handleBackToSelection,
  }
}
