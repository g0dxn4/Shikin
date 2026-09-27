import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
  normalizeReportScope,
  inspectReportScope,
  type NormalizedReportScope,
} from '@shikin/finance-core'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { CurrencyControl, ScopeControls, scopedSelectClass } from './scoped-controls'
import {
  readScopedSnapshot,
  storedBudgetScope,
  type ScopedSnapshot,
} from '@/lib/scoped-report-read'
import { useCurrencyStore } from '@/stores/currency-store'
import type { BudgetWithStatus, BudgetFormData } from '@/stores/budget-store'
import { fromCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'

const budgetSchema = z.object({
  name: z.string().trim().min(1),
  amount: z.number().positive(),
  period: z.enum(['weekly', 'monthly', 'yearly']),
  currency: z.string().min(1),
  basis: z.enum(['gross_cashflow', 'net_consumption']),
  isActive: z.boolean(),
})
type Fields = z.infer<typeof budgetSchema>
export type BudgetFormValues = Omit<BudgetFormData, 'amount'> & { amount?: number }
interface BudgetFormProps {
  budget?: BudgetWithStatus
  onSubmit: (data: BudgetFormValues) => void
  isLoading?: boolean
  onDirtyChange?: (isDirty: boolean) => void
}
export function BudgetForm({ budget, onSubmit, isLoading, onDirtyChange }: BudgetFormProps) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const authorityMain = useCurrencyStore((state) => state.mainCurrency)
  const [initialAuthority] = useState(authorityMain)
  const [snapshot, setSnapshot] = useState<ScopedSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const [explicitCurrency, setExplicitCurrency] = useState(Boolean(budget))
  const [scope, setScope] = useState<NormalizedReportScope | null>(() => {
    try {
      return normalizeReportScope(budget ? storedBudgetScope(budget) : undefined)
    } catch {
      return null
    }
  })
  const [scopeDirty, setScopeDirty] = useState(false)
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<Fields>({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      name: budget?.name ?? '',
      amount: budget ? fromCentavos(budget.amount) : 0,
      period: budget?.period ?? 'monthly',
      currency: budget?.currency ?? '',
      basis: budget?.basis ?? 'gross_cashflow',
      isActive: budget ? budget.is_active === 1 : true,
    },
  })
  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const currency = watch('currency')
  const basis = watch('basis')
  const period = watch('period')
  useEffect(() => {
    let cancelled = false
    void readScopedSnapshot()
      .then((data) => {
        if (cancelled) return
        setSnapshot(data)
        setLoadError(null)
        if (!budget) setValue('currency', data.mainCurrency ?? '')
      })
      .catch((error) => {
        if (!cancelled) setLoadError(getErrorMessage(error))
      })
    return () => {
      cancelled = true
    }
  }, [budget, retry, setValue])
  useEffect(() => {
    onDirtyChange?.(isDirty || scopeDirty || (explicitCurrency && !budget))
  }, [isDirty, scopeDirty, explicitCurrency, budget, onDirtyChange])
  const mismatch =
    !budget &&
    !explicitCurrency &&
    snapshot?.mainCurrency &&
    authorityMain !== initialAuthority &&
    snapshot.mainCurrency !== authorityMain
  const scopeIssues = scope && snapshot ? inspectReportScope(scope, snapshot).issues : []
  const changeScope = (next: NormalizedReportScope) => {
    setScope(next)
    setScopeDirty(true)
  }
  const categoryValue =
    scope?.categoryIds.length === 1
      ? (scope.categoryIds[0] ?? '__uncategorized')
      : scope?.categoryIds.length
        ? '__multiple'
        : '__all'
  return (
    <form
      className="min-w-0 space-y-5"
      onSubmit={handleSubmit((data) => {
        if (!scope || !snapshot || mismatch) return
        onSubmit({
          ...data,
          // Preserve the exact persisted cents when the amount was not edited.
          amount:
            budget && !dirtyFields.amount && data.currency === budget.currency
              ? undefined
              : data.amount,
          scope: normalizeReportScope(scope),
          ...(!budget && !explicitCurrency && snapshot.mainCurrency
            ? { expectedMainCurrency: snapshot.mainCurrency }
            : {}),
        })
      })}
    >
      {!snapshot && !loadError && <p role="status">{t('scoped.loading')}</p>}
      {loadError && (
        <div role="alert">
          <p>{loadError}</p>
          <Button type="button" variant="outline" onClick={() => setRetry((n) => n + 1)}>
            {t('scoped.refresh')}
          </Button>
        </div>
      )}
      {mismatch && (
        <p role="alert" className="text-warning text-sm">
          {t('currency.changedWhileOpen')}
        </p>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="budget-name">{t('form.name')}</Label>
        <Input
          autoFocus
          id="budget-name"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'budget-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="budget-name-error" role="alert" className="text-destructive text-xs">
            {t('scoped.nameRequired')}
          </p>
        )}
      </div>
      <label className="grid gap-1.5 text-sm">
        {t('form.category')}
        <select
          className={scopedSelectClass}
          value={categoryValue}
          disabled={!scope || !snapshot}
          onChange={(e) => {
            if (scope)
              changeScope({
                ...scope,
                categoryIds:
                  e.target.value === '__all'
                    ? []
                    : [e.target.value === '__uncategorized' ? null : e.target.value],
              })
          }}
        >
          <option value="__all">{t('scoped.allCategories')}</option>
          <option value="__uncategorized">{t('scoped.uncategorized')}</option>
          {categoryValue === '__multiple' && (
            <option value="__multiple">{t('scoped.multipleCategories')}</option>
          )}
          {scope?.categoryIds
            .filter((id) => id !== null && !snapshot?.categories.some((c) => c.id === id))
            .map((id) => (
              <option key={id!} value={id!}>
                {t('scoped.missingReference')}: {id}
              </option>
            ))}
          {snapshot?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="budget-amount">
            {t('form.amountWithCurrency', { currency: currency || '—' })}
          </Label>
          <Input
            id="budget-amount"
            type="number"
            step="0.01"
            aria-invalid={!!errors.amount}
            aria-describedby="budget-amount-help"
            {...register('amount', { valueAsNumber: true })}
          />
          <p id="budget-amount-help" className="text-muted-foreground text-xs">
            {t('scoped.currencyReentry')}
          </p>
          {errors.amount && (
            <p role="alert" className="text-destructive text-xs">
              {t('scoped.amountRequired')}
            </p>
          )}
        </div>
        <label className="grid content-start gap-1.5 text-sm">
          {t('form.period')}
          <select
            className={scopedSelectClass}
            value={period}
            onChange={(e) =>
              setValue('period', e.target.value as Fields['period'], { shouldDirty: true })
            }
          >
            {(['weekly', 'monthly', 'yearly'] as const).map((p) => (
              <option key={p} value={p}>
                {t(`periods.${p}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="border-border min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t('scoped.definition')}
        </summary>
        <div className="space-y-3">
          <CurrencyControl
            value={currency}
            onChange={(value) => {
              setExplicitCurrency(true)
              if (value !== currency) {
                setValue('currency', value, { shouldDirty: true })
                setValue('amount', '' as unknown as number, { shouldDirty: true })
              }
            }}
          />
          <label className="grid gap-1 text-sm">
            {t('scoped.basis')}
            <select
              className={scopedSelectClass}
              value={basis}
              onChange={(e) =>
                setValue('basis', e.target.value as Fields['basis'], { shouldDirty: true })
              }
            >
              {(['gross_cashflow', 'net_consumption'] as const).map((b) => (
                <option key={b} value={b}>
                  {t(`scoped.${b}`)}
                </option>
              ))}
            </select>
          </label>
          {budget && (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" {...register('isActive')} />
              {t('scoped.active')}
            </label>
          )}
        </div>
      </details>
      {scope && snapshot ? (
        <ScopeControls
          scope={scope}
          onChange={changeScope}
          accounts={snapshot.accounts}
          categories={snapshot.categories}
        />
      ) : !scope ? (
        <div role="alert">
          <p className="text-warning text-sm">{t('scoped.invalidScope')}</p>
          <Button
            type="button"
            variant="outline"
            onClick={() => changeScope(normalizeReportScope())}
          >
            {t('scoped.clearScope')}
          </Button>
        </div>
      ) : null}
      {scopeIssues.length > 0 && (
        <p role="alert" className="text-warning text-xs [overflow-wrap:anywhere]">
          {t('scoped.resolveReferences')}: {scopeIssues.map((i) => i.id).join(', ')}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={
          isLoading || !snapshot || !currency || !scope || !!mismatch || scopeIssues.length > 0
        }
        aria-busy={isLoading}
      >
        {isLoading ? tCommon('actions.saving') : tCommon('actions.save')}
      </Button>
    </form>
  )
}
