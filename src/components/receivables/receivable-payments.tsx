import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  changeReceivablePayment,
  readReceivablePayments,
  type ReceivablePaymentInput,
  type ReceivablePaymentPreview,
  type ReceivablePaymentView,
} from '@/lib/receivable-payment-service'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'

export function ReceivablePayments({
  receivableId,
  onClose,
  onChanged,
}: {
  receivableId: string
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const { t } = useTranslation('receivables')
  const { t: common } = useTranslation('common')
  const [view, setView] = useState<ReceivablePaymentView | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [pending, setPending] = useState<ReceivablePaymentInput | null>(null)
  const [preview, setPreview] = useState<ReceivablePaymentPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void readReceivablePayments(receivableId)
      .then((result) => {
        if (active) setView(result)
      })
      .catch((failure: unknown) => {
        if (active) setError(getErrorMessage(failure))
      })
    return () => {
      active = false
    }
  }, [receivableId])

  const prepare = async (input: ReceivablePaymentInput) => {
    setBusy(true)
    setError(null)
    setPreview(null)
    try {
      const result = await changeReceivablePayment(input)
      setPending(input)
      setPreview(result)
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!preview || !pending) return
    setBusy(true)
    setError(null)
    try {
      await changeReceivablePayment({ ...pending, apply: true, expectedToken: preview.token })
      setPreview(null)
      setPending(null)
      setSelectedId('')
      setView(await readReceivablePayments(receivableId))
      await onChanged()
    } catch (failure) {
      setError(getErrorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t('payments.title')}
            {view ? ` · ${view.receivable.payer}` : ''}
          </DialogTitle>
          <DialogDescription>{t('payments.description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {!view && !error && <p role="status">{common('status.loading')}</p>}
        {view && (
          <div className="space-y-5">
            <p className="text-sm tabular-nums">
              {t('payments.received')}:{' '}
              {formatMoney(view.summary.receivedAmount, view.receivable.currency)}
              {' · '}
              {t('payments.remaining')}:{' '}
              {formatMoney(view.summary.remainingAmount, view.receivable.currency)}
            </p>
            {view.summary.unattributedReceivedAmount > 0 && (
              <p className="text-muted-foreground text-xs">
                {t('payments.legacy')}:{' '}
                {formatMoney(view.summary.unattributedReceivedAmount, view.receivable.currency)}
              </p>
            )}
            {(view.receivable.status === 'open' || view.receivable.status === 'partial') && (
              <div className="space-y-2">
                <Label htmlFor="receivable-bank-payment">{t('payments.select')}</Label>
                {view.candidates.length ? (
                  <>
                    <Select
                      value={selectedId}
                      onValueChange={(value) => {
                        setSelectedId(value)
                        setPreview(null)
                        setPending(null)
                      }}
                      disabled={busy}
                    >
                      <SelectTrigger id="receivable-bank-payment">
                        <SelectValue placeholder={t('payments.select')} />
                      </SelectTrigger>
                      <SelectContent>
                        {view.candidates.map((income) => (
                          <SelectItem key={income.id} value={income.id}>
                            {income.date} · {income.description} ·{' '}
                            {formatMoney(income.amount, income.currency!)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={busy || !selectedId}
                      onClick={() =>
                        void prepare({ receivableId, action: 'match', transactionId: selectedId })
                      }
                    >
                      {t('payments.preview')}
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-sm">{t('payments.noCandidates')}</p>
                )}
              </div>
            )}
            {preview && pending && (
              <div className="border-border rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {pending.action === 'match'
                    ? t('payments.linkPreview')
                    : t('payments.reversePreview')}
                </p>
                <p className="mt-2 tabular-nums">
                  {t('payments.received')}:{' '}
                  {formatMoney(preview.after.receivedAmount, view.receivable.currency)}
                </p>
                <p className="tabular-nums">
                  {t('payments.remaining')}:{' '}
                  {formatMoney(preview.after.remainingAmount, view.receivable.currency)}
                </p>
                <Button className="mt-3" disabled={busy} onClick={() => void apply()}>
                  {t('payments.apply')}
                </Button>
              </div>
            )}
            <section className="space-y-2">
              <h3 className="text-sm font-medium">{t('payments.history')}</h3>
              {!view.payments.length && (
                <p className="text-muted-foreground text-sm">{t('payments.noHistory')}</p>
              )}
              {view.payments.map((payment) => (
                <div
                  key={payment.id}
                  className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
                >
                  <div className={payment.reversed_at ? 'text-muted-foreground' : ''}>
                    <p className="text-sm tabular-nums">
                      {payment.transaction_date} · {formatMoney(payment.amount, payment.currency)}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {payment.reversed_at ? t('payments.reversed') : t('payments.linked')}
                    </p>
                  </div>
                  {!payment.reversed_at && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void prepare({ receivableId, action: 'reverse', paymentId: payment.id })
                      }
                    >
                      {t('payments.reverse')}
                    </Button>
                  )}
                </div>
              ))}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
