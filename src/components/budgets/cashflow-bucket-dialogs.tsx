import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
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
import {
  allocateCashflow,
  applyCashflowCorrection,
  createCashflowBucket,
  decimalAmountToCentavos,
  previewCashflowCorrection,
  updateCashflowBucket,
  type CashflowBucket,
  type CashflowBucketAllocation,
  type CashflowCorrectionPreview,
  type CashflowIncomeSource,
} from '@/lib/cashflow-bucket-service'
import { formatMoney } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'

const fieldClass = 'grid gap-1.5 text-sm font-medium'
const selectClass =
  'border-input bg-surface text-foreground focus-visible:ring-ring min-h-11 w-full rounded-lg border px-3 text-base focus-visible:ring-2 focus-visible:outline-none md:text-sm'

function ErrorMessage({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="text-destructive text-sm">
      {error}
    </p>
  ) : null
}

export function CashflowBucketEditorDialog({
  open,
  bucket,
  defaultCurrency,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  bucket: CashflowBucket | null
  defaultCurrency: string
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation('budgets')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [currency, setCurrency] = useState(defaultCurrency)
  const [clearTarget, setClearTarget] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(bucket?.name ?? '')
    setDescription(bucket?.description ?? '')
    setTarget(
      bucket?.targetAmountCentavos === null || bucket?.targetAmountCentavos === undefined
        ? ''
        : String(bucket.targetAmountCentavos / 100)
    )
    setCurrency(bucket?.currency ?? defaultCurrency)
    setClearTarget(false)
    setError(null)
  }, [bucket, defaultCurrency, open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (bucket) {
        const targetAmountCentavos = target ? decimalAmountToCentavos(Number(target)) : undefined
        const patch: Parameters<typeof updateCashflowBucket>[1] = {
          ...(name.trim() !== bucket.name ? { name } : {}),
          ...(description.trim() !== (bucket.description ?? '') ? { description } : {}),
          ...(clearTarget
            ? { clearFields: ['targetAmount'] as const }
            : targetAmountCentavos !== undefined &&
                targetAmountCentavos !== bucket.targetAmountCentavos
              ? { targetAmountCentavos }
              : {}),
        }
        if (Object.keys(patch).length > 0) await updateCashflowBucket(bucket.id, patch)
      } else {
        await createCashflowBucket({
          name,
          description,
          currency,
          ...(target ? { targetAmountCentavos: decimalAmountToCentavos(Number(target)) } : {}),
        })
      }
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setError(getErrorMessage(cause, t('buckets.error.save')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(bucket ? 'buckets.dialog.editTitle' : 'buckets.dialog.createTitle')}
          </DialogTitle>
          <DialogDescription>{t('buckets.dialog.editorDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className={fieldClass}>
            {t('buckets.fields.name')}
            <Input
              value={name}
              maxLength={120}
              required
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className={fieldClass}>
            {t('buckets.fields.description')}
            <Input
              value={description}
              maxLength={500}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className={fieldClass}>
            {t('buckets.fields.target')}
            <Input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={target}
              disabled={clearTarget}
              onChange={(event) => setTarget(event.target.value)}
            />
          </label>
          {bucket ? (
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={clearTarget}
                onChange={(event) => setClearTarget(event.target.checked)}
              />
              {t('buckets.fields.clearTarget')}
            </label>
          ) : (
            <label className={fieldClass}>
              {t('buckets.fields.currency')}
              <Input
                value={currency}
                required
                minLength={3}
                maxLength={3}
                className="uppercase"
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            </label>
          )}
          <ErrorMessage error={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('buckets.actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('buckets.actions.saving') : t('buckets.actions.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FundingSelect({
  currency,
  sources,
  value,
  onChange,
}: {
  currency: string
  sources: CashflowIncomeSource[]
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('budgets')
  return (
    <label className={fieldClass}>
      {t('buckets.fields.funding')}
      <select
        className={selectClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="unbound">{t('buckets.funding.unbound')}</option>
        {sources
          .filter(
            (source) =>
              source.currency === currency && (source.remainingCentavos > 0 || source.id === value)
          )
          .map((source) => (
            <option key={source.id} value={source.id}>
              {source.description} · {formatMoney(source.remainingCentavos, source.currency)}
            </option>
          ))}
      </select>
    </label>
  )
}

export function CashflowAllocationDialog({
  open,
  bucket,
  sources,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  bucket: CashflowBucket | null
  sources: CashflowIncomeSource[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation('budgets')
  const [amount, setAmount] = useState('')
  const [sourceId, setSourceId] = useState('unbound')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setAmount('')
    setSourceId('unbound')
    setConfirmed(false)
    setError(null)
  }, [open])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!bucket) return
    if (sourceId === 'unbound' && !confirmed) {
      setError(t('buckets.error.confirmUnbound'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      await allocateCashflow({
        bucketId: bucket.id,
        amountCentavos: decimalAmountToCentavos(Number(amount)),
        transactionId: sourceId === 'unbound' ? null : sourceId,
      })
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setError(getErrorMessage(cause, t('buckets.error.allocate')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('buckets.dialog.allocateTitle', { name: bucket?.name })}</DialogTitle>
          <DialogDescription>{t('buckets.dialog.allocateDescription')}</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className={fieldClass}>
            {t('buckets.fields.amount', { currency: bucket?.currency })}
            <Input
              type="number"
              min="0.01"
              step="0.01"
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <FundingSelect
            currency={bucket?.currency ?? ''}
            sources={sources}
            value={sourceId}
            onChange={(value) => {
              setSourceId(value)
              setConfirmed(false)
            }}
          />
          {sourceId === 'unbound' ? (
            <label className="border-border bg-muted/40 flex min-h-11 items-start gap-3 rounded-lg border p-3 text-sm">
              <input
                className="mt-1"
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              <span>{t('buckets.funding.confirmUnbound')}</span>
            </label>
          ) : null}
          <ErrorMessage error={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('buckets.actions.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? t('buckets.actions.saving') : t('buckets.actions.allocate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CashflowCorrectionDialog({
  open,
  allocation,
  buckets,
  sources,
  onOpenChange,
  onSaved,
}: {
  open: boolean
  allocation: CashflowBucketAllocation | null
  buckets: CashflowBucket[]
  sources: CashflowIncomeSource[]
  onOpenChange: (open: boolean) => void
  onSaved: () => void
}) {
  const { t } = useTranslation('budgets')
  const [bucketId, setBucketId] = useState('')
  const [amount, setAmount] = useState('')
  const [sourceId, setSourceId] = useState('unbound')
  const [preview, setPreview] = useState<CashflowCorrectionPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const target = buckets.find((bucket) => bucket.id === bucketId) ?? null

  useEffect(() => {
    if (!open || !allocation) return
    setBucketId(allocation.bucketId)
    setAmount(String(allocation.amountCentavos / 100))
    setSourceId(allocation.transactionId ?? 'unbound')
    setPreview(null)
    setError(null)
  }, [allocation, open])

  const review = async (event: FormEvent) => {
    event.preventDefault()
    if (!allocation) return
    setSaving(true)
    setError(null)
    try {
      setPreview(
        await previewCashflowCorrection({
          allocationId: allocation.id,
          bucketId,
          amountCentavos: decimalAmountToCentavos(Number(amount)),
          transactionId: sourceId === 'unbound' ? null : sourceId,
        })
      )
    } catch (cause) {
      setError(getErrorMessage(cause, t('buckets.error.preview')))
    } finally {
      setSaving(false)
    }
  }

  const apply = async () => {
    if (!preview) return
    setSaving(true)
    setError(null)
    try {
      await applyCashflowCorrection(preview)
      onSaved()
      onOpenChange(false)
    } catch (cause) {
      setPreview(null)
      setError(getErrorMessage(cause, t('buckets.error.correct')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('buckets.dialog.correctTitle')}</DialogTitle>
          <DialogDescription>{t('buckets.dialog.correctDescription')}</DialogDescription>
        </DialogHeader>
        {preview ? (
          <div className="grid gap-4">
            <div className="border-border bg-muted/40 rounded-lg border p-4 text-sm">
              <p className="font-semibold">{t('buckets.preview.title')}</p>
              <p className="text-muted-foreground mt-2">
                {t('buckets.preview.move', {
                  amount: formatMoney(
                    preview.replacement.amountCentavos,
                    preview.replacement.currency
                  ),
                  name: preview.targetBucket.name,
                })}
              </p>
              <p className="text-muted-foreground mt-1">{t('buckets.preview.atomicHistory')}</p>
            </div>
            <ErrorMessage error={error} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" onClick={() => setPreview(null)}>
                {t('buckets.actions.back')}
              </Button>
              <Button type="button" disabled={saving} onClick={() => void apply()}>
                {saving ? t('buckets.actions.saving') : t('buckets.actions.applyCorrection')}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={review}>
            <label className={fieldClass}>
              {t('buckets.fields.targetBucket')}
              <select
                className={selectClass}
                value={bucketId}
                onChange={(event) => {
                  const nextBucketId = event.target.value
                  const nextCurrency = buckets.find(
                    (bucket) => bucket.id === nextBucketId
                  )?.currency
                  const selectedSource = sources.find((source) => source.id === sourceId)
                  setBucketId(nextBucketId)
                  if (selectedSource && selectedSource.currency !== nextCurrency) {
                    setSourceId('unbound')
                  }
                }}
              >
                {buckets
                  .filter((bucket) => bucket.isActive)
                  .map((bucket) => (
                    <option key={bucket.id} value={bucket.id}>
                      {bucket.name} · {bucket.currency}
                    </option>
                  ))}
              </select>
            </label>
            <label className={fieldClass}>
              {t('buckets.fields.amount', { currency: target?.currency })}
              <Input
                type="number"
                min="0.01"
                step="0.01"
                required
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
            <FundingSelect
              currency={target?.currency ?? ''}
              sources={sources}
              value={sourceId}
              onChange={setSourceId}
            />
            <ErrorMessage error={error} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                {t('buckets.actions.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? t('buckets.actions.saving') : t('buckets.actions.review')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
