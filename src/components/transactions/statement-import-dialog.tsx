import { useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'
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
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
import { cn } from '@/lib/utils'
import { formatMoney, toCentavos } from '@/lib/money'
import { useStatementImportSession } from './use-statement-import-session'

interface StatementImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function signedMoney(type: string, centavos: number, currency: string): string {
  return `${type === 'income' ? '+' : '-'}${formatMoney(centavos, currency)}`
}

export function StatementImportDialog({ open, onOpenChange }: StatementImportDialogProps) {
  const { t } = useTranslation('transactions')
  const { accounts, fetch, fetchError } = useAccountStore()

  const fileInputRef = useRef<HTMLInputElement>(null)
  const {
    selection: { selectedFile, accountId, treatment, stagingBatchId, acknowledgePending },
    preview: {
      plannedImported,
      plannedSkipped,
      limitations,
      resolvedTreatment,
      resolvedStagingBatchId,
      plannedStaged,
      plannedPending,
      balanceImpactCentavos,
      previewCurrency,
    },
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
    showReviewActions,
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
  } = useStatementImportSession({ open, onOpenChange })

  useEffect(() => {
    if (!open || accounts.length > 0) {
      return
    }

    void fetch().catch(() => {})
  }, [open, accounts.length, fetch])

  const activeAccounts = accounts.filter((a) => !a.is_archived)
  const selectedAccount = activeAccounts.find((account) => account.id === accountId)
  const accountCurrency = selectedAccount?.currency || 'USD'

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="border-border bg-surface max-h-[90vh] max-w-2xl overflow-y-auto">
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
              <label htmlFor="statement-import-treatment" className="text-sm font-medium">
                {t('import.treatment')}
              </label>
              <Select value={treatment} onValueChange={handleTreatmentChange}>
                <SelectTrigger
                  id="statement-import-treatment"
                  className="min-h-11"
                  aria-label={t('import.treatment')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="posted">{t('import.treatments.posted')}</SelectItem>
                  <SelectItem value="staged_posted">
                    {t('import.treatments.stagedPosted')}
                  </SelectItem>
                  <SelectItem value="staged_pending">
                    {t('import.treatments.stagedPending')}
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {t(`import.treatmentDescriptions.${treatment}`)}
              </p>
            </div>

            {treatment !== 'posted' ? (
              <div className="space-y-2">
                <label htmlFor="statement-import-batch" className="text-sm font-medium">
                  {t('import.stagingBatch')}
                </label>
                <input
                  id="statement-import-batch"
                  value={stagingBatchId}
                  maxLength={200}
                  onChange={(event) => handleBatchChange(event.currentTarget.value)}
                  placeholder={t('import.stagingBatchPlaceholder')}
                  className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 min-h-11 w-full rounded-md border px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
                />
                <p className="text-muted-foreground text-xs">{t('import.stagingBatchHint')}</p>
              </div>
            ) : null}

            {treatment === 'staged_pending' ? (
              <label className="border-warning/30 bg-warning/5 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={acknowledgePending}
                  onChange={(event) => handlePendingAcknowledgement(event.currentTarget.checked)}
                  className="size-4 shrink-0"
                />
                <span>{t('import.pendingAcknowledgement')}</span>
              </label>
            ) : null}

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
                        {t('import.previewCount', {
                          count: parsedTransactions.length,
                        })}
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
                  {t('import.previewCount', {
                    count: parsedTransactions.length,
                  })}
                </span>
                <p className="text-muted-foreground text-xs">
                  {t('import.plannedImported', { count: plannedImported })}
                  {' · '}
                  {t('import.plannedSkipped', { count: plannedSkipped })}
                </p>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <Badge variant="secondary">
                    {t(
                      `import.treatments.${resolvedTreatment === 'staged_posted' ? 'stagedPosted' : resolvedTreatment === 'staged_pending' ? 'stagedPending' : 'posted'}`
                    )}
                  </Badge>
                  <Badge variant="secondary">
                    {t('import.plannedStaged', { count: plannedStaged })}
                  </Badge>
                  <Badge variant="secondary">
                    {t('import.plannedPending', { count: plannedPending })}
                  </Badge>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t('import.balanceImpact', {
                    amount: formatMoney(balanceImpactCentavos, previewCurrency ?? accountCurrency),
                  })}
                </p>
                {resolvedStagingBatchId ? (
                  <p className="text-muted-foreground font-mono text-[11px] break-all">
                    {t('import.resolvedBatch', {
                      batch: resolvedStagingBatchId,
                    })}
                  </p>
                ) : null}
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
            {limitations.length > 0 && (
              <div className="border-border bg-muted/40 space-y-1 rounded-lg border p-3">
                <p className="text-sm font-medium">{t('import.legacyLimitations')}</p>
                <ul className="text-muted-foreground list-disc space-y-1 pl-4 text-xs">
                  {limitations.map((limitation, index) => (
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
                  {actionableReviews.map(({ key, candidate, details, decision }) => {
                    const incomingLabel = t('import.chooseDecisionFor', {
                      number: details.incoming.rowIndex + 1,
                    })
                    return (
                      <div
                        key={key}
                        className="border-border/70 bg-surface/80 space-y-3 rounded-lg border p-3"
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="min-w-0 space-y-1">
                            <p className="text-muted-foreground font-mono text-[10px] uppercase">
                              {t('import.incoming')}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {t('import.rowIndex', {
                                number: details.incoming.rowIndex + 1,
                              })}
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
                          value={decision ?? ''}
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
                onClick={handleBackToSelection}
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
