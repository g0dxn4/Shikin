import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
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
}

export function BudgetForm({ budget, onSubmit, isLoading }: BudgetFormProps) {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const { categories, fetch: fetchCategories } = useCategoryStore()

  useEffect(() => {
    fetchCategories()
  }, [fetchCategories])

  const expenseCategories = categories.filter((c) => c.type === 'expense')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
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

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="name">{t('form.name')}</Label>
        <Input
          id="name"
          placeholder={t('form.namePlaceholder')}
          autoFocus
          {...register('name')}
        />
        {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label>{t('form.category')}</Label>
        <Select
          value={categoryValue}
          onValueChange={(val) => setValue('categoryId', val)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('form.categoryPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {expenseCategories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>
                {cat.icon ? `${cat.icon} ` : ''}{cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.categoryId && (
          <p className="text-destructive text-xs">{errors.categoryId.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="amount">{t('form.amount')}</Label>
          <Input
            id="amount"
            type="number"
            step="0.01"
            {...register('amount', { valueAsNumber: true })}
          />
          {errors.amount && (
            <p className="text-destructive text-xs">{errors.amount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label>{t('form.period')}</Label>
          <Select
            value={periodValue}
            onValueChange={(val) => setValue('period', val as BudgetFormValues['period'])}
          >
            <SelectTrigger>
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

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
