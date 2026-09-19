import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Fingerprint, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'
import {
  bindLegacyImportIdentity,
  previewLegacyImportIdentity,
  readLegacyImportIdentityTransaction,
  type LegacyImportIdentityPreview,
  type LegacyImportIdentityTransaction,
} from '@/lib/import-identity-service'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'

export function ExportLegacyImportIdentityAction({
  transactionId,
  onChanged,
}: {
  transactionId: string
  onChanged?: () => void
}) {
  const { t } = useTranslation('accountHistory')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Fingerprint aria-hidden="true" />
        {t('identity.action')}
      </Button>
      <LegacyImportIdentityDialog
        transactionId={transactionId}
        open={open}
        onOpenChange={setOpen}
        onChanged={onChanged}
      />
    </>
  )
}

function LegacyImportIdentityDialog({
  transactionId,
  open,
  onOpenChange,
  onChanged,
}: {
  transactionId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}) {
  const { t, i18n } = useTranslation('accountHistory')
  const requestRef = useRef(0)
  const contextRef = useRef({ open, transactionId })
  contextRef.current = { open, transactionId }

  const [transaction, setTransaction] = useState<LegacyImportIdentityTransaction | null>(null)
  const [sourceNamespace, setSourceNamespace] = useState('')
  const [externalId, setExternalId] = useState('')
  const [auditSource, setAuditSource] = useState('')
  const [auditNote, setAuditNote] = useState('')
  const [verified, setVerified] = useState(false)
  const [preview, setPreview] = useState<LegacyImportIdentityPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const isCurrent = (requestId: number, requestedTransactionId: string) =>
    requestId === requestRef.current &&
    contextRef.current.open &&
    contextRef.current.transactionId === requestedTransactionId

  const resetReview = () => {
    requestRef.current += 1
    setPreview(null)
    setError(null)
    setBusy(false)
  }

  useEffect(() => {
    requestRef.current += 1
    const requestId = requestRef.current
    if (!open) {
      setBusy(false)
      return
    }
    setTransaction(null)
    setSourceNamespace('')
    setExternalId('')
    setAuditSource('')
    setAuditNote('')
    setVerified(false)
    setPreview(null)
    setError(null)
    setBusy(true)
    void readLegacyImportIdentityTransaction(transactionId)
      .then((row) => {
        if (isCurrent(requestId, transactionId)) setTransaction(row)
      })
      .catch((reason) => {
        if (isCurrent(requestId, transactionId))
          setError(getErrorMessage(reason, t('identity.errors.load')))
      })
      .finally(() => {
        if (isCurrent(requestId, transactionId)) setBusy(false)
      })
    // `t` is not request identity and changes only when locale changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transactionId])

  const input = () => ({
    transactionId,
    sourceNamespace,
    externalId,
    source: auditSource || undefined,
    note: auditNote || undefined,
  })

  const review = async () => {
    if (!verified) return
    const requestId = ++requestRef.current
    const requestedTransactionId = transactionId
    const requestedInput = input()
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const result = await previewLegacyImportIdentity(requestedInput)
      if (isCurrent(requestId, requestedTransactionId)) setPreview(result)
    } catch (reason) {
      if (isCurrent(requestId, requestedTransactionId))
        setError(getErrorMessage(reason, t('identity.errors.preview')))
    } finally {
      if (isCurrent(requestId, requestedTransactionId)) setBusy(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    const requestId = ++requestRef.current
    const requestedTransactionId = transactionId
    const requestedInput = input()
    const previewToken = preview.previewToken
    setBusy(true)
    setError(null)
    try {
      const result = await bindLegacyImportIdentity({ ...requestedInput, previewToken })
      // These are post-commit effects and must run even if the dialog closed meanwhile.
      invalidateTransactionPage('import')
      onChanged?.()
      if (!isCurrent(requestId, requestedTransactionId)) return
      setPreview(null)
      if (result.refreshIncomplete) {
        setError(t('identity.savedRefreshFailed'))
      } else {
        onOpenChange(false)
      }
    } catch (reason) {
      if (!isCurrent(requestId, requestedTransactionId)) return
      setPreview(null)
      setError(getErrorMessage(reason, t('identity.errors.apply')))
    } finally {
      if (isCurrent(requestId, requestedTransactionId)) setBusy(false)
    }
  }

  const changeInput = (setter: (value: string) => void) => (value: string) => {
    resetReview()
    setter(value)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) requestRef.current += 1
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('identity.title')}</DialogTitle>
          <DialogDescription>{t('identity.description')}</DialogDescription>
        </DialogHeader>

        <ErrorBanner message={error} />
        {!transaction && busy ? (
          <div className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm">
            <Loader2 className="animate-spin" aria-hidden="true" /> {t('identity.loading')}
          </div>
        ) : null}

        {transaction ? (
          <div className="space-y-4">
            <div className="border-border bg-muted/30 rounded-xl border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{transaction.description}</p>
                  <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                    {transaction.date} · {transaction.status}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium tabular-nums">
                    {formatMoney(transaction.amount, transaction.currency, i18n.language)}
                  </p>
                  <Badge variant="outline">{transaction.currency}</Badge>
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`identity-source-${transactionId}`}>
                  {t('identity.sourceNamespace')}
                </Label>
                <Input
                  id={`identity-source-${transactionId}`}
                  value={sourceNamespace}
                  onChange={(event) => changeInput(setSourceNamespace)(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`identity-external-${transactionId}`}>
                  {t('identity.externalId')}
                </Label>
                <Input
                  id={`identity-external-${transactionId}`}
                  value={externalId}
                  onChange={(event) => changeInput(setExternalId)(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`identity-audit-source-${transactionId}`}>
                  {t('identity.auditSource')}
                </Label>
                <Input
                  id={`identity-audit-source-${transactionId}`}
                  value={auditSource}
                  onChange={(event) => changeInput(setAuditSource)(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`identity-audit-note-${transactionId}`}>
                  {t('identity.auditNote')}
                </Label>
                <Input
                  id={`identity-audit-note-${transactionId}`}
                  value={auditNote}
                  onChange={(event) => changeInput(setAuditNote)(event.target.value)}
                />
              </div>
            </div>

            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={verified}
                onChange={(event) => {
                  resetReview()
                  setVerified(event.target.checked)
                }}
              />
              <span>{t('identity.verifiedConfirmation')}</span>
            </label>

            {preview ? (
              <div
                role="status"
                className="border-border bg-muted/40 rounded-lg border p-3 text-sm"
              >
                <p>
                  <strong>{preview.binding.importSource}</strong> ·{' '}
                  <span className="font-mono">{preview.binding.importExternalId}</span>
                </p>
                <p className="text-muted-foreground mt-2 text-xs">{t('identity.unknownContent')}</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          {preview ? (
            <Button type="button" disabled={busy} onClick={() => void apply()}>
              {t('identity.confirm')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={
                busy || !transaction || !verified || !sourceNamespace.trim() || !externalId.trim()
              }
              onClick={() => void review()}
            >
              {t('identity.review')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
