import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAccountStore } from '@/stores/account-store'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import {
  importStatementFile,
  previewStatementFile,
  type StatementImportPreview,
} from '@/lib/statement-import'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '@/lib/errors'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { formatMoney, toCentavos } from '@/lib/money'

interface StatementImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportStep = 'select' | 'preview' | 'importing' | 'done'

/** Temporary until statement-import exposes reviewCandidates. */
type StatementImportReviewCandidate = {
  candidateIdentityKey: string
  existingTransactionId: string
  incoming: {
    rowIndex: number
    date: string
    description: string
    type: 'income' | 'expense'
    amountCentavos: number
    currency: string
  }
  existing: {
    id: string
    date: string
    description: string
    type: string
    amountCentavos: number
    currency: string
  }
}

type StatementImportPreviewResult = StatementImportPreview & {
  reviewCandidates?: StatementImportReviewCandidate[]
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

function signedMoney(type: string, centavos: number, currency: string): string {
  return `${type === 'income' ? '+' : '-'}${formatMoney(centavos, currency)}`
}

export function StatementImportDialog({ open, onOpenChange }: StatementImportDialogProps) {
  const { t } = useTranslation('transactions')
  const { accounts, fetch, fetchError } = useAccountStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileRequestIdRef = useRef(0)
  const previewRequestIdRef = useRef(0)
  const importRequestIdRef = useRef(0)
  const selectionRef = useRef({
    open,
    selectedFile: null as File | null,
    accountId: '',
    decisions: [] as ImportReviewDecision[],
  })

  const [step, setStep] = useState<ImportStep>('select')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [accountId, setAccountId] = useState<string>('')
  const [parsedTransactions, setParsedTransactions] = useState<ParsedTransaction[]>([])
  const [parseError, setParseError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  const [previewToken, setPreviewToken] = useState<string | null>(null)
  const [requiredDecisions, setRequiredDecisions] = useState<ImportReviewDecision[]>([])
  const [reviewCandidates, setReviewCandidates] = useState<StatementImportReviewCandidate[]>([])
  const [decisions, setDecisions] = useState<ImportReviewDecision[]>([])
  const [plannedImported, setPlannedImported] = useState(0)
  const [plannedSkipped, setPlannedSkipped] = useState(0)
  const [legacyEvidenceLimitations, setLegacyEvidenceLimitations] = useState<string[]>([])

  selectionRef.current = { open, selectedFile, accountId, decisions }

  const clearPreviewBinding = useCallback(() => {
    setPreviewToken(null)
    setRequiredDecisions([])
    setReviewCandidates([])
    setPlannedImported(0)
    setPlannedSkipped(0)
    setLegacyEvidenceLimitations([])
  }, [])

  const invalidateInFlightPreview = useCallback(() => {
    previewRequestIdRef.current += 1
    setIsImporting(false)
  }, [])

  const resetState = useCallback(() => {
    fileRequestIdRef.current += 1
    previewRequestIdRef.current += 1
    importRequestIdRef.current += 1
    setStep('select')
    setSelectedFile(null)
    setAccountId('')
    setParsedTransactions([])
    setParseError(null)
    setPreviewError(null)
    setIsImporting(false)
    setPreviewToken(null)
    setRequiredDecisions([])
    setReviewCandidates([])
    setDecisions([])
    setPlannedImported(0)
    setPlannedSkipped(0)
    setLegacyEvidenceLimitations([])
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
      setAccountId(value)
      setPreviewError(null)
      setDecisions([])
      clearPreviewBinding()
    },
    [clearPreviewBinding, invalidateInFlightPreview]
  )

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const file = input.files?.[0]
      input.value = ''
      if (!file) return

      const requestId = ++fileRequestIdRef.current
      invalidateInFlightPreview()
      setSelectedFile(file)
      setParseError(null)
      setPreviewError(null)
      setDecisions([])
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

  const canPreview = Boolean(selectedFile && parsedTransactions.length > 0 && accountId)
  const reviewCandidateByKey = new Map(
    reviewCandidates.map((candidate) => [candidateKey(candidate), candidate])
  )
  const actionableReviews = requiredDecisions.flatMap((candidate) => {
    const details = reviewCandidateByKey.get(candidateKey(candidate))
    return details ? [{ candidate, details }] : []
  })
  const candidatesMissingDetails =
    requiredDecisions.length > 0 && actionableReviews.length !== requiredDecisions.length
  const hasUnresolvedDecisions = requiredDecisions.some(
    (candidate) => !decisions.some((decision) => isSameCandidate(decision, candidate))
  )
  const canImport = Boolean(
    canPreview &&
    previewToken &&
    requiredDecisions.length === 0 &&
    !candidatesMissingDetails &&
    !previewError &&
    !isImporting
  )

  const handlePreview = useCallback(async () => {
    if (!selectedFile || !accountId) return
    const requestId = ++previewRequestIdRef.current
    const requestedFile = selectedFile
    const requestedAccountId = accountId
    const requestedDecisions = decisions.map((item) => reviewDecisionPayload(item, item.decision))
    setIsImporting(true)
    setPreviewError(null)
    try {
      const preview = (await previewStatementFile(
        requestedFile,
        requestedAccountId,
        requestedDecisions
      )) as StatementImportPreviewResult
      if (requestId !== previewRequestIdRef.current) return
      if (!selectionRef.current.open) return
      if (selectionRef.current.selectedFile !== requestedFile) return
      if (selectionRef.current.accountId !== requestedAccountId) return
      if (selectionRef.current.decisions !== decisions) return

      if (preview.errors.length) {
        setPreviewError(preview.errors[0])
        setPreviewToken(null)
        return
      }

      setParsedTransactions(preview.parsedTransactions)
      setPreviewToken(preview.success ? preview.previewToken : null)
      setRequiredDecisions(preview.requiredDecisions)
      setReviewCandidates(preview.reviewCandidates ?? [])
      setPlannedImported(preview.imported)
      setPlannedSkipped(preview.skipped)
      setLegacyEvidenceLimitations(preview.legacyEvidenceLimitations ?? [])
      setStep('preview')
    } finally {
      if (requestId === previewRequestIdRef.current) {
        setIsImporting(false)
      }
    }
  }, [selectedFile, accountId, decisions])

  const setCandidateDecision = useCallback(
    (candidate: ImportReviewDecision, decision: ImportReviewDecision['decision']) => {
      invalidateInFlightPreview()
      setDecisions((current) => [
        ...current.filter((item) => !isSameCandidate(item, candidate)),
        reviewDecisionPayload(candidate, decision),
      ])
      setPreviewToken(null)
    },
    [invalidateInFlightPreview]
  )

  const handleImport = useCallback(async () => {
    if (
      !selectedFile ||
      !accountId ||
      !previewToken ||
      requiredDecisions.length > 0 ||
      candidatesMissingDetails
    ) {
      return
    }

    const requestId = ++importRequestIdRef.current
    const requestedFile = selectedFile
    const requestedAccountId = accountId
    const requestedToken = previewToken
    const requestedDecisions = decisions.map((item) => reviewDecisionPayload(item, item.decision))

    setIsImporting(true)
    setStep('importing')
    setPreviewError(null)

    try {
      const result = await importStatementFile(requestedFile, requestedAccountId, {
        previewToken: requestedToken,
        decisions: requestedDecisions,
      })
      if (requestId !== importRequestIdRef.current) return
      if (!selectionRef.current.open) return
      if (selectionRef.current.selectedFile !== requestedFile) return
      if (selectionRef.current.accountId !== requestedAccountId) return

      if (result.imported > 0) invalidateTransactionPage('import')

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
          setPreviewToken(null)
          setPreviewError(t('import.stalePreview'))
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
    previewToken,
    requiredDecisions.length,
    candidatesMissingDetails,
    decisions,
    t,
    handleOpenChange,
  ])

  useEffect(() => {
    if (!open || accounts.length > 0) {
      return
    }

    void fetch().catch(() => {})
  }, [open, accounts.length, fetch])

  const activeAccounts = accounts.filter((a) => !a.is_archived)
  const selectedAccount = activeAccounts.find((account) => account.id === accountId)
  const accountCurrency = selectedAccount?.currency || 'USD'
  const showReviewActions = requiredDecisions.length > 0 && !candidatesMissingDetails

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-surface max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-heading">{t('import.title')}</DialogTitle>
          <DialogDescription>{t('import.description')}</DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="statement-import-account" className="text-sm font-medium">
                {t('import.selectAccount')}
              </label>
              {fetchError && <p className="text-destructive text-sm">{fetchError}</p>}
              {activeAccounts.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('import.noAccounts')}</p>
              ) : (
                <Select value={accountId} onValueChange={handleAccountChange}>
                  <SelectTrigger
                    id="statement-import-account"
                    className="min-h-11"
                    aria-label={t('import.selectAccount')}
                  >
                    <SelectValue placeholder={t('import.selectAccountPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {activeAccounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="statement-import-file" className="text-sm font-medium">
                {t('import.selectFile')}
              </label>
              <input
                id="statement-import-file"
                ref={fileInputRef}
                type="file"
                accept=".ofx,.qfx,.qif"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('import.selectFile')}
                className={cn(
                  'border-border flex min-h-11 w-full cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-8 transition-colors',
                  'hover:border-accent/40 hover:bg-accent/5 focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                  selectedFile && !parseError && 'border-accent/30 bg-accent/5'
                )}
              >
                {selectedFile ? (
                  <>
                    {parseError ? (
                      <AlertCircle size={24} className="text-destructive" />
                    ) : (
                      <FileText size={24} className="text-accent" />
                    )}
                    <span className="text-sm font-medium">{selectedFile.name}</span>
                    {parseError ? (
                      <span className="text-destructive text-xs">{parseError}</span>
                    ) : (
                      <span className="text-muted-foreground text-xs">
                        {t('import.previewCount', { count: parsedTransactions.length })}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Upload size={24} className="text-muted-foreground" />
                    <span className="text-muted-foreground text-sm">{t('import.selectFile')}</span>
                    <span className="text-muted-foreground/60 text-xs">
                      {t('import.fileTypes')}
                    </span>
                  </>
                )}
              </button>
            </div>
            {previewError ? (
              <p role="alert" className="text-destructive text-sm">
                {previewError}
              </p>
            ) : null}
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-3">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <span className="text-muted-foreground text-sm">
                  {t('import.previewCount', { count: parsedTransactions.length })}
                </span>
                <p className="text-muted-foreground text-xs">
                  {t('import.plannedImported', { count: plannedImported })}
                  {' · '}
                  {t('import.plannedSkipped', { count: plannedSkipped })}
                </p>
              </div>
              <div className="text-muted-foreground flex flex-col items-start gap-0.5 text-xs sm:items-end">
                {selectedFile ? <span>{selectedFile.name}</span> : null}
                {selectedAccount ? <span>{selectedAccount.name}</span> : null}
              </div>
            </div>
            {previewError ? (
              <p role="alert" className="text-destructive text-sm">
                {previewError}
              </p>
            ) : null}
            {candidatesMissingDetails ? (
              <p role="alert" className="text-destructive text-sm">
                {t('import.missingCandidateDetails')}
              </p>
            ) : null}
            {legacyEvidenceLimitations.length > 0 && (
              <div className="border-border bg-muted/40 space-y-1 rounded-lg border p-3">
                <p className="text-sm font-medium">{t('import.legacyLimitations')}</p>
                <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
                  {legacyEvidenceLimitations.map((limitation, index) => (
                    <li key={`${limitation}-${index}`}>{limitation}</li>
                  ))}
                </ul>
              </div>
            )}
            {showReviewActions && (
              <div className="border-warning/30 bg-warning/5 space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{t('import.reviewCandidates')}</p>
                <p className="text-muted-foreground text-xs">
                  {t('import.reviewCandidatesDescription')}
                </p>
                <div className="max-h-64 space-y-3 overflow-y-auto">
                  {actionableReviews.map(({ candidate, details }) => {
                    const selected = decisions.find((item) => isSameCandidate(item, candidate))
                    const incomingLabel = t('import.chooseDecisionFor', {
                      number: details.incoming.rowIndex + 1,
                    })
                    return (
                      <div
                        key={candidateKey(candidate)}
                        className="border-border/70 bg-surface/80 space-y-3 rounded-lg border p-3"
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="min-w-0 space-y-1">
                            <p className="text-muted-foreground font-mono text-[10px] uppercase">
                              {t('import.incoming')}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {t('import.rowIndex', { number: details.incoming.rowIndex + 1 })}
                            </p>
                            <p className="truncate text-sm font-medium">
                              {details.incoming.description}
                            </p>
                            <p className="text-muted-foreground font-mono text-xs">
                              {details.incoming.date}
                            </p>
                            <p
                              className={cn(
                                'font-mono text-sm font-medium tabular-nums',
                                details.incoming.type === 'income'
                                  ? 'text-success'
                                  : 'text-destructive'
                              )}
                            >
                              {signedMoney(
                                details.incoming.type,
                                details.incoming.amountCentavos,
                                details.incoming.currency
                              )}
                            </p>
                          </div>
                          <div className="min-w-0 space-y-1">
                            <p className="text-muted-foreground font-mono text-[10px] uppercase">
                              {t('import.existing')}
                            </p>
                            <p className="truncate text-sm font-medium">
                              {details.existing.description}
                            </p>
                            <p className="text-muted-foreground font-mono text-xs">
                              {details.existing.date}
                            </p>
                            <p
                              className={cn(
                                'font-mono text-sm font-medium tabular-nums',
                                details.existing.type === 'income'
                                  ? 'text-success'
                                  : 'text-destructive'
                              )}
                            >
                              {signedMoney(
                                details.existing.type,
                                details.existing.amountCentavos,
                                details.existing.currency
                              )}
                            </p>
                          </div>
                        </div>
                        <Select
                          value={selected?.decision ?? ''}
                          onValueChange={(value) =>
                            setCandidateDecision(
                              candidate,
                              value as ImportReviewDecision['decision']
                            )
                          }
                        >
                          <SelectTrigger className="min-h-11" aria-label={incomingLabel}>
                            <SelectValue placeholder={t('import.chooseDecision')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="keep_existing">
                              {t('import.keepExisting')}
                            </SelectItem>
                            <SelectItem value="distinct">{t('import.importDistinct')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <ScrollArea className="h-[min(20rem,45vh)]">
              <div className="space-y-1">
                <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_auto] gap-3 px-3 py-1.5 md:grid">
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {t('import.date')}
                  </span>
                  <span className="text-muted-foreground font-mono text-[10px] uppercase">
                    {t('import.descriptionCol')}
                  </span>
                  <span className="text-muted-foreground text-right font-mono text-[10px] uppercase">
                    {t('import.amount')}
                  </span>
                </div>
                {parsedTransactions.map((tx, i) => (
                  <div
                    key={i}
                    className="bg-muted/45 grid grid-cols-1 gap-1 rounded-lg px-3 py-2 md:grid-cols-[6.5rem_minmax(0,1fr)_auto] md:items-center md:gap-3"
                  >
                    <span className="text-muted-foreground font-mono text-xs">{tx.date}</span>
                    <span className="min-w-0 truncate text-sm">{tx.description}</span>
                    <div className="flex items-center justify-between gap-2 md:justify-end">
                      <span
                        className={cn(
                          'font-mono text-sm font-medium tabular-nums',
                          tx.type === 'income' ? 'text-success' : 'text-destructive'
                        )}
                      >
                        {signedMoney(tx.type, toCentavos(tx.amount), accountCurrency)}
                      </span>
                      <Badge
                        variant="secondary"
                        className={cn(
                          'text-[10px]',
                          tx.type === 'income'
                            ? 'bg-success/10 text-success'
                            : 'bg-destructive/10 text-destructive'
                        )}
                      >
                        {tx.type}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {step === 'importing' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Loader2 size={32} className="text-accent animate-spin" />
            <span className="text-muted-foreground text-sm">{t('import.importing')}</span>
          </div>
        )}

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="ghost" className="min-h-11" onClick={() => handleOpenChange(false)}>
                {t('import.cancel')}
              </Button>
              <Button
                className="min-h-11"
                onClick={() => void handlePreview()}
                disabled={!canPreview || isImporting}
              >
                <CheckCircle2 size={14} />
                {t('import.preview')}
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="ghost"
                className="min-h-11"
                disabled={isImporting}
                onClick={() => setStep('select')}
              >
                {t('import.cancel')}
              </Button>
              {showReviewActions ? (
                <Button
                  className="min-h-11"
                  onClick={() => void handlePreview()}
                  disabled={isImporting || hasUnresolvedDecisions}
                >
                  <CheckCircle2 size={14} />
                  {t('import.reviewDecisions')}
                </Button>
              ) : canImport ? (
                <Button
                  className="min-h-11"
                  onClick={() => void handleImport()}
                  disabled={!canImport}
                >
                  <Upload size={14} />
                  {t('import.confirm')}
                </Button>
              ) : (
                <Button
                  className="min-h-11"
                  onClick={() => void handlePreview()}
                  disabled={!canPreview || isImporting}
                >
                  <CheckCircle2 size={14} />
                  {t('import.refreshPreview')}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
