import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ConsumptionRole } from '@shikin/finance-core/corrections'
import { AlertCircle, Check, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import {
  clearConsumptionClassification,
  readConsumptionClassificationContext,
  setConsumptionClassification,
  type ConsumptionAllocationView,
  type ConsumptionClassificationContext,
} from '@/lib/consumption-service'
import { getErrorMessage } from '@/lib/errors'
import { formatMoney } from '@/lib/money'

const EXPENSE_ROLES: ConsumptionRole[] = ['purchase', 'fee', 'principal', 'cash_withdrawal']
const INCOME_ROLES: ConsumptionRole[] = ['earned_income', 'refund', 'internal_inflow']

interface DraftClassification {
  role: ConsumptionRole
  referencedPurchaseId: string
}

export interface ConsumptionClassificationDialogProps {
  transactionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged?: () => void
}

function allocationKey(allocation: ConsumptionAllocationView): string {
  return allocation.splitId ?? '__parent__'
}

function draftsFromContext(context: ConsumptionClassificationContext) {
  return Object.fromEntries(
    context.allocations.map((allocation) => [
      allocationKey(allocation),
      {
        role:
          allocation.classification?.role ??
          (context.transaction.type === 'expense' ? 'purchase' : 'earned_income'),
        referencedPurchaseId: allocation.classification?.referenced_purchase_id ?? '',
      },
    ])
  ) as Record<string, DraftClassification>
}

export function ConsumptionClassificationDialog({
  transactionId,
  open,
  onOpenChange,
  onChanged,
}: ConsumptionClassificationDialogProps) {
  const { t } = useTranslation('consumption')
  const [context, setContext] = useState<ConsumptionClassificationContext | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DraftClassification>>({})
  const [loading, setLoading] = useState(false)
  const [mutationKey, setMutationKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const requestSequence = useRef(0)

  const load = useCallback(async () => {
    if (!transactionId) return
    const sequence = ++requestSequence.current
    setLoading(true)
    setError(null)
    try {
      const next = await readConsumptionClassificationContext(transactionId)
      if (sequence !== requestSequence.current) return
      setContext(next)
      setDrafts(draftsFromContext(next))
    } catch (loadError) {
      if (sequence === requestSequence.current) setError(getErrorMessage(loadError))
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [transactionId])

  useEffect(() => {
    if (open && transactionId) void load()
    else {
      requestSequence.current += 1
      setContext(null)
      setDrafts({})
      setError(null)
    }
  }, [load, open, transactionId])

  const updateDraft = (key: string, patch: Partial<DraftClassification>) => {
    setDrafts((current) => ({
      ...current,
      [key]: { ...current[key], ...patch },
    }))
  }

  const save = async (allocation: ConsumptionAllocationView) => {
    if (!context) return
    const key = allocationKey(allocation)
    const draft = drafts[key]
    if (!draft) return
    const needsPurchase = draft.role === 'refund' || draft.role === 'principal'
    if (needsPurchase && !draft.referencedPurchaseId) {
      setError(t('errors.purchaseRequired'))
      return
    }
    setMutationKey(key)
    setError(null)
    try {
      await setConsumptionClassification({
        transactionId: context.transaction.id,
        splitId: allocation.splitId,
        role: draft.role,
        referencedPurchaseId: needsPurchase ? draft.referencedPurchaseId : null,
      })
      await load()
      onChanged?.()
    } catch (mutationError) {
      setError(getErrorMessage(mutationError))
    } finally {
      setMutationKey(null)
    }
  }

  const clear = async (allocation: ConsumptionAllocationView) => {
    if (!allocation.classification) return
    const key = allocationKey(allocation)
    setMutationKey(key)
    setError(null)
    try {
      await clearConsumptionClassification(allocation.classification.id)
      await load()
      onChanged?.()
    } catch (mutationError) {
      setError(getErrorMessage(mutationError))
    } finally {
      setMutationKey(null)
    }
  }

  const roles = context?.transaction.type === 'income' ? INCOME_ROLES : EXPENSE_ROLES

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] min-w-0 grid-cols-[minmax(0,1fr)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="pr-8 break-words">{t('dialog.title')}</DialogTitle>
          <DialogDescription className="break-words">{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        {error ? (
          <div
            className="border-destructive/30 bg-destructive/10 text-foreground flex gap-2 rounded-lg border p-3 text-sm"
            role="alert"
          >
            <AlertCircle className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p>{error}</p>
              {error.toLowerCase().includes('referenc') ? (
                <p className="text-muted-foreground mt-1 text-xs">{t('errors.clearDependents')}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {loading && !context ? (
          <div className="space-y-3" aria-label={t('dialog.loading')}>
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : context ? (
          <div className="min-w-0 space-y-3">
            <div className="text-muted-foreground flex min-w-0 flex-col gap-1 text-xs sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <span className="min-w-0 break-words">{context.transaction.description}</span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatMoney(context.transaction.amount, context.transaction.currency || 'USD')}
              </span>
            </div>
            {context.allocations.map((allocation, index) => {
              const key = allocationKey(allocation)
              const draft = drafts[key]
              if (!draft) return null
              const needsPurchase = draft.role === 'refund' || draft.role === 'principal'
              const options = context.purchaseOptions.filter(
                (option) => option.currency === context.transaction.currency?.trim().toUpperCase()
              )
              const busy = mutationKey === key
              return (
                <section
                  key={key}
                  className="border-border bg-muted/25 min-w-0 rounded-xl border p-3 sm:p-4"
                  aria-labelledby={`consumption-allocation-${key}`}
                >
                  <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <h3
                        id={`consumption-allocation-${key}`}
                        className="text-sm font-semibold break-words"
                      >
                        {context.allocations.length > 1
                          ? t('allocation.split', { number: index + 1 })
                          : t('allocation.parent')}
                      </h3>
                      <p className="text-muted-foreground mt-0.5 text-xs break-words">
                        {allocation.categoryName ?? t('allocation.uncategorized')}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">
                      {formatMoney(
                        allocation.amountCentavos,
                        context.transaction.currency || 'USD'
                      )}
                    </span>
                  </div>
                  <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
                    <label className="text-muted-foreground min-w-0 text-xs">
                      {t('fields.role')}
                      <select
                        className="native-select text-foreground mt-1 block min-h-11 w-full max-w-full min-w-0"
                        value={draft.role}
                        disabled={busy}
                        onChange={(event) => {
                          const role = event.target.value as ConsumptionRole
                          updateDraft(key, {
                            role,
                            referencedPurchaseId:
                              role === 'refund' || role === 'principal'
                                ? draft.referencedPurchaseId
                                : '',
                          })
                        }}
                      >
                        {roles.map((role) => (
                          <option key={role} value={role}>
                            {t(`roles.${role}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {needsPurchase ? (
                      <label className="text-muted-foreground min-w-0 text-xs">
                        {t('fields.purchase')}
                        <select
                          className="native-select text-foreground mt-1 block min-h-11 w-full max-w-full min-w-0"
                          value={draft.referencedPurchaseId}
                          disabled={busy}
                          onChange={(event) =>
                            updateDraft(key, { referencedPurchaseId: event.target.value })
                          }
                        >
                          <option value="">{t('fields.selectPurchase')}</option>
                          {options.map((option) => (
                            <option key={option.classificationId} value={option.classificationId}>
                              {option.date} · {option.description} ·{' '}
                              {formatMoney(option.amountCentavos, option.currency)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                  <div className="mt-3 flex min-w-0 flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                    {allocation.classification ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="min-h-11 max-w-full min-w-0"
                        disabled={busy}
                        onClick={() => void clear(allocation)}
                      >
                        <RotateCcw size={15} />
                        {t('actions.clear')}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      className="min-h-11 max-w-full min-w-0"
                      disabled={busy}
                      onClick={() => void save(allocation)}
                    >
                      <Check size={15} />
                      {busy ? t('actions.saving') : t('actions.save')}
                    </Button>
                  </div>
                </section>
              )
            })}
          </div>
        ) : !loading ? (
          <Button type="button" variant="outline" onClick={() => void load()}>
            {t('actions.retry')}
          </Button>
        ) : null}

        <DialogFooter className="min-w-0">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 max-w-full min-w-0"
            onClick={() => onOpenChange(false)}
          >
            {t('actions.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
