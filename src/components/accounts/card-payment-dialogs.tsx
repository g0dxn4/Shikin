import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, ArrowRight, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney, fromCentavos, toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import {
  linkCardPayment,
  listCardPaymentSources,
  listEligibleCardPayments,
  previewLinkCardPayment,
  previewRecordCardPayment,
  recordCardPayment,
  type CardPaymentSource,
  type CardStatement,
  type EligibleCardPayment,
  type LinkPaymentInput,
  type MutationPreview,
  type RecordCardPaymentInput,
  type RecordCardPaymentPreview,
} from '@/lib/card-payment-service'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import type { Account } from '@/types/database'

interface ControlledPaymentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  account: Account
  statement: CardStatement
  onCompleted: () => void | Promise<void>
}

function ErrorMessage({ message }: { message: string | null }) {
  return message ? (
    <div
      className="border-destructive/30 bg-destructive/10 text-destructive flex gap-2 rounded-lg border p-3 text-sm"
      role="alert"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{message}</span>
    </div>
  ) : null
}

export function LinkCardPaymentDialog({
  open,
  onOpenChange,
  account,
  statement,
  onCompleted,
}: ControlledPaymentDialogProps) {
  const { t } = useTranslation('cardPayments')
  const [payments, setPayments] = useState<EligibleCardPayment[]>([])
  const [transactionId, setTransactionId] = useState('')
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<'apply_to_unpaid' | 'attribute_existing'>('apply_to_unpaid')
  const [confirmed, setConfirmed] = useState(false)
  const [preview, setPreview] = useState<MutationPreview<CardStatement> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  useEffect(() => {
    const request = ++requestSequence.current
    setPreview(null)
    setSaved(false)
    setError(null)
    setLoading(false)
    if (!open) return
    setLoading(true)
    void listEligibleCardPayments(account.id)
      .then((rows) => {
        if (request !== requestSequence.current) return
        setPayments(rows)
        setTransactionId(rows[0]?.transactionId ?? '')
        setAmount(
          rows[0]
            ? fromCentavos(
                Math.min(
                  rows[0].remainingCapacity,
                  statement.statementBalance - statement.linkedPaidAmount
                )
              ).toFixed(2)
            : ''
        )
      })
      .catch((reason) => {
        if (request === requestSequence.current) setError(getErrorMessage(reason))
      })
      .finally(() => {
        if (request === requestSequence.current) setLoading(false)
      })
  }, [account.id, open, statement.id, statement.linkedPaidAmount, statement.statementBalance])

  const selected = useMemo(
    () => payments.find((payment) => payment.transactionId === transactionId) ?? null,
    [payments, transactionId]
  )

  const input = (): LinkPaymentInput => ({
    statementId: statement.id,
    transactionId,
    amount: toCentavos(Number(amount)),
    mode,
    explicitRepaymentConfirmation: confirmed,
    source: 'frontend-card-statements',
    note: t('audit.linkNote'),
  })

  const invalidateReview = () => {
    requestSequence.current += 1
    setPreview(null)
    setLoading(false)
  }

  const review = async (event: FormEvent) => {
    event.preventDefault()
    const request = ++requestSequence.current
    const requestedInput = input()
    setError(null)
    setLoading(true)
    try {
      const reviewed = await previewLinkCardPayment(requestedInput)
      if (request === requestSequence.current) setPreview(reviewed)
    } catch (reason) {
      if (request === requestSequence.current) setError(getErrorMessage(reason))
    } finally {
      if (request === requestSequence.current) setLoading(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    const request = ++requestSequence.current
    const requestedInput = input()
    const token = preview.token
    setError(null)
    setLoading(true)
    try {
      await linkCardPayment(requestedInput, token)
    } catch (reason) {
      if (request === requestSequence.current) {
        setPreview(null)
        setError(getErrorMessage(reason, t('stale')))
        setLoading(false)
      }
      return
    }
    try {
      await onCompleted()
    } catch {
      if (request === requestSequence.current) {
        setPreview(null)
        setSaved(true)
        setError(t('savedRefreshFailed'))
        setLoading(false)
      }
      return
    }
    if (request === requestSequence.current) {
      setLoading(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('link.title')}</DialogTitle>
          <DialogDescription>{t('link.description')}</DialogDescription>
        </DialogHeader>
        <ErrorMessage message={error} />
        {payments.length === 0 && !loading ? (
          <div className="border-border bg-muted/40 rounded-lg border p-4 text-sm">
            <p className="font-medium">{t('link.empty')}</p>
            <p className="text-muted-foreground mt-1">{t('link.emptyDescription')}</p>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={saved ? (event) => event.preventDefault() : review}>
            <div className="space-y-2">
              <Label htmlFor="card-payment-evidence">{t('link.source')}</Label>
              <select
                id="card-payment-evidence"
                className="border-input bg-surface h-11 w-full rounded-lg border px-3 text-sm"
                value={transactionId}
                onChange={(event) => {
                  setTransactionId(event.target.value)
                  setConfirmed(false)
                  invalidateReview()
                }}
              >
                {payments.map((payment) => (
                  <option key={payment.transactionId} value={payment.transactionId}>
                    {payment.date} · {payment.description} ·{' '}
                    {formatMoney(payment.remainingCapacity, payment.currency)}
                  </option>
                ))}
              </select>
            </div>
            {selected ? (
              <div className="border-border grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">{t('link.evidence')}</p>
                  <p className="font-medium">{t(`evidence.${selected.shape}`)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">{t('link.available')}</p>
                  <p className="font-medium tabular-nums">
                    {formatMoney(selected.remainingCapacity, selected.currency)}
                  </p>
                </div>
              </div>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="link-payment-amount">{t('fields.amount')}</Label>
                <Input
                  id="link-payment-amount"
                  className="h-11"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value)
                    invalidateReview()
                  }}
                  required
                />
                <p className="text-muted-foreground text-xs">{account.currency}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="link-payment-mode">{t('link.mode')}</Label>
                <select
                  id="link-payment-mode"
                  className="border-input bg-surface h-11 w-full rounded-lg border px-3 text-sm"
                  value={mode}
                  onChange={(event) => {
                    setMode(event.target.value as typeof mode)
                    invalidateReview()
                  }}
                >
                  <option value="apply_to_unpaid">{t('link.apply')}</option>
                  <option value="attribute_existing">{t('link.attribute')}</option>
                </select>
              </div>
            </div>
            {selected?.requiresExplicitConfirmation ? (
              <label className="border-border flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm">
                <input
                  className="mt-1 size-4"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => {
                    setConfirmed(event.target.checked)
                    invalidateReview()
                  }}
                />
                <span>{t('link.confirmRepayment', { card: account.name })}</span>
              </label>
            ) : null}
            {preview?.after ? (
              <div
                className="border-primary/30 bg-accent-muted rounded-lg border p-4"
                aria-label={t('review.title')}
              >
                <p className="text-sm font-semibold">{t('review.title')}</p>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm tabular-nums">
                  <span>{formatMoney(statement.paidAmount, statement.currency)}</span>
                  <ArrowRight className="text-muted-foreground size-4" />
                  <span className="font-semibold">
                    {formatMoney(preview.after.paidAmount, statement.currency)}
                  </span>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">{t('review.noBalanceImpact')}</p>
              </div>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => onOpenChange(false)}
                disabled={loading}
              >
                {t('actions.cancel')}
              </Button>
              {saved ? (
                <Button type="button" className="min-h-11" onClick={() => onOpenChange(false)}>
                  {t('actions.close')}
                </Button>
              ) : preview ? (
                <Button type="button" className="min-h-11" onClick={apply} disabled={loading}>
                  {loading ? t('actions.saving') : t('actions.confirm')}
                </Button>
              ) : (
                <Button type="submit" className="min-h-11" disabled={loading || !selected}>
                  {loading ? t('actions.loading') : t('actions.review')}
                </Button>
              )}
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RecordCardPaymentDialog({
  open,
  onOpenChange,
  account,
  statement,
  onCompleted,
}: ControlledPaymentDialogProps) {
  const { t } = useTranslation('cardPayments')
  const [sources, setSources] = useState<CardPaymentSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [amount, setAmount] = useState('')
  const [statementOnly, setStatementOnly] = useState(false)
  const [preview, setPreview] = useState<MutationPreview<RecordCardPaymentPreview> | null>(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  useEffect(() => {
    const request = ++requestSequence.current
    setPreview(null)
    setSaved(false)
    setError(null)
    setLoading(false)
    if (!open) return
    setLoading(true)
    void listCardPaymentSources(account.id)
      .then((rows) => {
        if (request !== requestSequence.current) return
        setSources(rows)
        setSourceId(rows[0]?.id ?? '')
        const unpaid = Math.max(statement.statementBalance - statement.paidAmount, 0)
        setAmount(unpaid ? fromCentavos(unpaid).toFixed(2) : '')
      })
      .catch((reason) => {
        if (request === requestSequence.current) setError(getErrorMessage(reason))
      })
      .finally(() => {
        if (request === requestSequence.current) setLoading(false)
      })
  }, [account.id, open, statement.id, statement.paidAmount, statement.statementBalance])

  const input = (): RecordCardPaymentInput => ({
    cardAccountId: account.id,
    fromAccountId: statementOnly ? undefined : sourceId,
    statementId: statement.id,
    amount: toCentavos(Number(amount)),
    source: 'frontend-card-statements',
    note: statementOnly ? t('audit.baselineNote') : t('audit.paymentNote'),
    statementOnly,
  })

  const invalidateReview = () => {
    requestSequence.current += 1
    setPreview(null)
    setLoading(false)
  }

  const review = async (event: FormEvent) => {
    event.preventDefault()
    const request = ++requestSequence.current
    const requestedInput = input()
    setError(null)
    setLoading(true)
    try {
      const reviewed = await previewRecordCardPayment(requestedInput)
      if (request === requestSequence.current) setPreview(reviewed)
    } catch (reason) {
      if (request === requestSequence.current) setError(getErrorMessage(reason))
    } finally {
      if (request === requestSequence.current) setLoading(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    const request = ++requestSequence.current
    const requestedInput = input()
    const token = preview.token
    setError(null)
    setLoading(true)
    try {
      await recordCardPayment(requestedInput, token)
    } catch (reason) {
      if (request === requestSequence.current) {
        setPreview(null)
        setError(getErrorMessage(reason, t('stale')))
        setLoading(false)
      }
      return
    }

    if (!requestedInput.statementOnly) invalidateTransactionPage('add')
    try {
      await onCompleted()
    } catch {
      if (request === requestSequence.current) {
        setPreview(null)
        setSaved(true)
        setError(t('savedRefreshFailed'))
        setLoading(false)
      }
      return
    }
    if (request === requestSequence.current) {
      setLoading(false)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !loading && onOpenChange(next)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('payment.title')}</DialogTitle>
          <DialogDescription>{t('payment.description')}</DialogDescription>
        </DialogHeader>
        <ErrorMessage message={error} />
        <form className="space-y-4" onSubmit={saved ? (event) => event.preventDefault() : review}>
          <label className="border-border flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm">
            <input
              className="mt-1 size-4"
              type="checkbox"
              checked={statementOnly}
              onChange={(event) => {
                setStatementOnly(event.target.checked)
                invalidateReview()
              }}
            />
            <span>
              <strong>{t('payment.statementOnly')}</strong>
              <span className="text-muted-foreground mt-1 block text-xs">
                {t('payment.statementOnlyDescription')}
              </span>
            </span>
          </label>
          {!statementOnly ? (
            <div className="space-y-2">
              <Label htmlFor="payment-source-account">{t('payment.from')}</Label>
              <select
                id="payment-source-account"
                className="border-input bg-surface h-11 w-full rounded-lg border px-3 text-sm"
                value={sourceId}
                onChange={(event) => {
                  setSourceId(event.target.value)
                  invalidateReview()
                }}
                required
              >
                <option value="">{t('payment.selectSource')}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.name} · {formatMoney(source.balance, source.currency)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="record-payment-amount">{t('fields.amount')}</Label>
            <Input
              id="record-payment-amount"
              className="h-11"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value)
                invalidateReview()
              }}
              required
            />
            <p className="text-muted-foreground text-xs">{account.currency}</p>
          </div>
          {preview?.after ? (
            <div
              className="border-primary/30 bg-accent-muted rounded-lg border p-4"
              aria-label={t('review.title')}
            >
              <p className="text-sm font-semibold">{t('review.title')}</p>
              <p className="mt-2 text-sm">
                {statementOnly ? t('review.baselineEvidence') : t('review.realTransfer')}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {statementOnly ? t('review.noTransaction') : t('review.atomicTransfer')}
              </p>
              {!statementOnly && preview.after.sourceBalance !== null ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm tabular-nums">
                  <span className="text-muted-foreground">{t('review.resultingSource')}</span>
                  <span className="text-right font-semibold">
                    {formatMoney(preview.after.sourceBalance, preview.after.currency)}
                  </span>
                  <span className="text-muted-foreground">{t('review.resultingCard')}</span>
                  <span className="text-right font-semibold">
                    {formatMoney(preview.after.cardBalance, preview.after.currency)}
                  </span>
                </div>
              ) : null}
              {!statementOnly &&
              preview.after.sourceBalance !== null &&
              preview.after.sourceBalance < 0 ? (
                <p className="text-warning mt-2 text-xs">{t('review.negativeFundsWarning')}</p>
              ) : null}
              {!statementOnly && preview.after.cardBalance > 0 ? (
                <p className="text-warning mt-2 text-xs">{t('review.cardCreditWarning')}</p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              {t('actions.cancel')}
            </Button>
            {saved ? (
              <Button type="button" className="min-h-11" onClick={() => onOpenChange(false)}>
                {t('actions.close')}
              </Button>
            ) : preview ? (
              <Button type="button" className="min-h-11" onClick={apply} disabled={loading}>
                {loading ? t('actions.saving') : t('actions.confirm')}
              </Button>
            ) : (
              <Button
                type="submit"
                className="min-h-11"
                disabled={loading || (!statementOnly && !sourceId)}
              >
                {loading ? t('actions.loading') : t('actions.review')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function PaymentEvidenceIcon() {
  return <Link2 aria-hidden="true" />
}
