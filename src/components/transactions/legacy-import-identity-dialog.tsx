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

export function LegacyImportIdentityAction({
  transactionId,
  onChanged,
  disabled,
  onClosed,
  onActionOpenChange,
}: {
  transactionId: string
  onChanged?: () => void
  disabled?: boolean
  onClosed?: () => void
  onActionOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation('accountHistory')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        disabled={disabled}
        onClick={() => {
          setOpen(true)
          onActionOpenChange?.(true)
        }}
      >
        <Fingerprint aria-hidden="true" />
        {t('identity.action')}
      </Button>
      <LegacyImportIdentityDialog
        transactionId={transactionId}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          onActionOpenChange?.(next)
          if (!next) onClosed?.()
        }}
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
      // The service already invalidated page reads after commit. Keep the callback even if closed.
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
        if (!next && busy) return
        if (!next) requestRef.current += 1
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto">
        <DialogHeader className="min-w-0">
          <DialogTitle className="pr-8 break-words">{t('identity.title')}</DialogTitle>
          <DialogDescription className="break-words">{t('identity.description')}</DialogDescription>
        </DialogHeader>

        <ErrorBanner message={error} />
        {!transaction && busy ? (
          <div className="text-muted-foreground flex min-h-24 items-center justify-center gap-2 text-sm">
            <Loader2 className="animate-spin" aria-hidden="true" /> {t('identity.loading')}
          </div>
        ) : null}

        {transaction ? (
          <div className="min-w-0 space-y-4">
            <div className="border-border bg-muted/30 min-w-0 rounded-xl border p-3">
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words">{transaction.description}</p>
                  <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                    {transaction.date} · {transaction.status}
                  </p>
                </div>
                <div className="shrink-0 sm:text-right">
                  <p className="font-medium tabular-nums">
                    {formatMoney(transaction.amount, transaction.currency, i18n.language)}
                  </p>
                  <Badge variant="outline">{transaction.currency}</Badge>
                </div>
              </div>
            </div>

            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <Label htmlFor={`identity-source-${transactionId}`}>
                  {t('identity.sourceNamespace')}
                </Label>
                <Input
                  id={`identity-source-${transactionId}`}
                  className="max-w-full min-w-0"
                  value={sourceNamespace}
                  onChange={(event) => changeInput(setSourceNamespace)(event.target.value)}
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`identity-external-${transactionId}`}>
                  {t('identity.externalId')}
                </Label>
                <Input
                  id={`identity-external-${transactionId}`}
                  className="max-w-full min-w-0"
                  value={externalId}
                  onChange={(event) => changeInput(setExternalId)(event.target.value)}
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`identity-audit-source-${transactionId}`}>
                  {t('identity.auditSource')}
                </Label>
                <Input
                  id={`identity-audit-source-${transactionId}`}
                  className="max-w-full min-w-0"
                  value={auditSource}
                  onChange={(event) => changeInput(setAuditSource)(event.target.value)}
                />
              </div>
              <div className="min-w-0">
                <Label htmlFor={`identity-audit-note-${transactionId}`}>
                  {t('identity.auditNote')}
                </Label>
                <Input
                  id={`identity-audit-note-${transactionId}`}
                  className="max-w-full min-w-0"
                  value={auditNote}
                  onChange={(event) => changeInput(setAuditNote)(event.target.value)}
                />
              </div>
            </div>

            <label className="flex min-h-11 min-w-0 items-start gap-3 text-sm">
              <input
                className="mt-1 shrink-0"
                type="checkbox"
                checked={verified}
                onChange={(event) => {
                  resetReview()
                  setVerified(event.target.checked)
                }}
              />
              <span className="min-w-0 break-words">{t('identity.verifiedConfirmation')}</span>
            </label>

            {preview ? (
              <div
                role="status"
                className="border-border bg-muted/40 min-w-0 rounded-lg border p-3 text-sm"
              >
                <p className="min-w-0 break-words">
                  <strong className="break-words">{preview.binding.importSource}</strong> ·{' '}
                  <span className="font-mono break-all">{preview.binding.importExternalId}</span>
                </p>
                <p className="text-muted-foreground mt-2 text-xs break-words">
                  {t('identity.unknownContent')}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter className="min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            className="max-w-full min-w-0"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {t('cancel')}
          </Button>
          {preview ? (
            <Button
              type="button"
              className="max-w-full min-w-0"
              disabled={busy}
              onClick={() => void apply()}
            >
              {t('identity.confirm')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="max-w-full min-w-0"
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
