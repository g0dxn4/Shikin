import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorBanner } from '@/components/ui/error-banner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCategoryStore } from '@/stores/category-store'
import type { BudgetWithStatus } from '@/stores/budget-store'
import { fromCentavos } from '@/lib/money'

const BUDGET_PERIODS = ['weekly', 'monthly', 'yearly'] as const

const budgetSchema = z.object({
  name: z.string().min(1),
  categoryId: z.string().min(1),
  amount: z.number().positive(),
  period: z.enum(BUDGET_PERIODS),
})

export type BudgetFormValues = z.infer<typeof budgetSchema>

interface BudgetFormProps {
  budget?: BudgetWithStatus
  onSubmit: (data: BudgetFormValues) => void
  isLoading?: boolean
  onDirtyChange?: (isDirty: boolean) => void
}

export function BudgetForm({ budget, onSubmit, isLoading, onDirtyChange }: BudgetFormProps) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const {
    categories,
    isLoading: categoriesLoading,
    fetchError: categoriesFetchError,
    fetch: fetchCategories,
  } = useCategoryStore()

  useEffect(() => {
    void fetchCategories().catch(() => {})
  }, [fetchCategories])

  const expenseCategories = categories.filter((c) => c.type === 'expense')
  const isCategorySelectDisabled = categoriesLoading || !!categoriesFetchError
  const isSubmitDisabled = isLoading || categoriesLoading || !!categoriesFetchError

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<BudgetFormValues>({
    resolver: zodResolver(budgetSchema),
    defaultValues: {
      name: budget?.name ?? '',
      categoryId: budget?.category_id ?? '',
      amount: budget ? fromCentavos(budget.amount) : 0,
      period: budget?.period ?? 'monthly',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const categoryValue = watch('categoryId')
  const periodValue = watch('period')

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <ErrorBanner
        title="Categories couldn\'t be loaded"
        message={categoriesFetchError}
        onRetry={() => {
          void fetchCategories().catch(() => {})
        }}
      />

      <div className="space-y-1.5">
        <Label htmlFor="budget-name">{t('form.name')}</Label>
        <Input
          id="budget-name"
          placeholder={t('form.namePlaceholder')}
          autoFocus
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'budget-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="budget-name-error" className="text-destructive text-xs" role="alert">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="budget-category">{t('form.category')}</Label>
        {categoriesLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Select
            value={categoryValue || ''}
            onValueChange={(val) => setValue('categoryId', val)}
            disabled={isCategorySelectDisabled}
          >
            <SelectTrigger
              id="budget-category"
              aria-invalid={!!errors.categoryId}
              aria-describedby={errors.categoryId ? 'budget-category-error' : undefined}
            >
              <SelectValue placeholder={t('form.categoryPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {expenseCategories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.icon ? `${cat.icon} ` : ''}
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {errors.categoryId && (
          <p id="budget-category-error" className="text-destructive text-xs" role="alert">
            {errors.categoryId.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="budget-amount">{t('form.amount')}</Label>
          <Input
            id="budget-amount"
            type="number"
            step="0.01"
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? 'budget-amount-error' : undefined}
            {...register('amount', { valueAsNumber: true })}
          />
          {errors.amount && (
            <p id="budget-amount-error" className="text-destructive text-xs" role="alert">
              {errors.amount.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="budget-period">{t('form.period')}</Label>
          <Select
            value={periodValue}
            onValueChange={(val) => setValue('period', val as BudgetFormValues['period'])}
          >
            <SelectTrigger id="budget-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUDGET_PERIODS.map((period) => (
                <SelectItem key={period} value={period}>
                  {t(`periods.${period}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitDisabled}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
