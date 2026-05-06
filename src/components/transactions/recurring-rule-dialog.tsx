import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import dayjs from 'dayjs'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUIStore } from '@/stores/ui-store'
import { useRecurringStore, type RecurringRuleFormData } from '@/stores/recurring-store'
import { useAccountStore } from '@/stores/account-store'
import { useCategoryStore } from '@/stores/category-store'
import { fromCentavos } from '@/lib/money'
import type { RecurringFrequency, TransactionType } from '@/types/common'

const RECURRING_TYPES = ['expense', 'income'] as const
const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const

const recurringRuleSchema = z.object({
  type: z.enum(RECURRING_TYPES),
  amount: z.number().positive(),
  description: z.string().min(1),
  accountId: z.string().min(1),
  categoryId: z.string().nullable(),
  frequency: z.enum(FREQUENCIES),
  nextDate: z.string().min(1),
  endDate: z.string().nullable(),
  tags: z.string(),
  notes: z.string().nullable(),
})

type RecurringRuleValues = z.infer<typeof recurringRuleSchema>

function toFormData(values: RecurringRuleValues): RecurringRuleFormData {
  return {
    ...values,
    toAccountId: null,
    subcategoryId: null,
  }
}

export function RecurringRuleDialog() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { recurringDialogOpen, editingRecurringId, closeRecurringDialog } = useUIStore()
  const { create, update, getById, fetch: fetchRecurring } = useRecurringStore()
  const { accounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()
  const [isLoading, setIsLoading] = useState(false)

  const rule = editingRecurringId ? getById(editingRecurringId) : undefined
  const isEditing = !!editingRecurringId

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<RecurringRuleValues>({
    resolver: zodResolver(recurringRuleSchema),
    defaultValues: {
      type: 'expense',
      amount: undefined,
      description: '',
      accountId: '',
      categoryId: null,
      frequency: 'monthly',
      nextDate: dayjs().format('YYYY-MM-DD'),
      endDate: null,
      tags: '',
      notes: null,
    },
  })

  const typeValue = watch('type')
  const accountValue = watch('accountId')
  const categoryValue = watch('categoryId')
  const frequencyValue = watch('frequency')

  const filteredCategories = useMemo(
    () => categories.filter((category) => category.type === typeValue),
    [categories, typeValue]
  )

  useEffect(() => {
    if (!recurringDialogOpen) return

    void fetchAccounts().catch(() => {})
    void fetchCategories().catch(() => {})
    void fetchRecurring().catch(() => {})
  }, [fetchAccounts, fetchCategories, fetchRecurring, recurringDialogOpen])

  useEffect(() => {
    if (!recurringDialogOpen) return

    reset({
      type:
        rule && rule.type !== 'transfer' ? (rule.type as TransactionType & 'expense') : 'expense',
      amount: rule ? fromCentavos(rule.amount) : undefined,
      description: rule?.description ?? '',
      accountId: rule?.account_id ?? '',
      categoryId: rule?.category_id ?? null,
      frequency: (rule?.frequency as RecurringFrequency | undefined) ?? 'monthly',
      nextDate: rule?.next_date ?? dayjs().format('YYYY-MM-DD'),
      endDate: rule?.end_date ?? null,
      tags: rule?.tags ?? '',
      notes: rule?.notes ?? null,
    })
  }, [recurringDialogOpen, reset, rule])

  const onSubmit = async (values: RecurringRuleValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingRecurringId) {
        await update(editingRecurringId, toFormData(values))
        toast.success(t('recurring.toast.updated'))
      } else {
        await create(toFormData(values))
        toast.success(t('recurring.toast.created'))
      }
      closeRecurringDialog()
    } catch {
      toast.error(t('recurring.toast.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={recurringDialogOpen} onOpenChange={(open) => !open && closeRecurringDialog()}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('recurring.editRule') : t('recurring.addRule')}</DialogTitle>
          <DialogDescription>{t('recurring.empty.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="rec-type">{t('form.type')}</Label>
            <Select
              value={typeValue}
              onValueChange={(value) => {
                setValue('type', value as RecurringRuleValues['type'], { shouldDirty: true })
                setValue('categoryId', null, { shouldDirty: true })
              }}
            >
              <SelectTrigger id="rec-type" aria-invalid={!!errors.type}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRING_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`types.${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-amount">{t('recurring.form.amount')}</Label>
            <Input
              id="rec-amount"
              type="number"
              step="0.01"
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? 'rec-amount-error' : undefined}
              {...register('amount', { valueAsNumber: true })}
            />
            {errors.amount && (
              <p id="rec-amount-error" className="text-destructive text-xs" role="alert">
                {errors.amount.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-description">{t('recurring.form.description')}</Label>
            <Input
              id="rec-description"
              placeholder={t('recurring.form.descriptionPlaceholder')}
              aria-invalid={!!errors.description}
              aria-describedby={errors.description ? 'rec-description-error' : undefined}
              {...register('description')}
            />
            {errors.description && (
              <p id="rec-description-error" className="text-destructive text-xs" role="alert">
                {errors.description.message}
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-account">{t('form.account')}</Label>
              <Select
                value={accountValue}
                onValueChange={(value) =>
                  setValue('accountId', value, { shouldDirty: true, shouldValidate: true })
                }
              >
                <SelectTrigger
                  id="rec-account"
                  aria-invalid={!!errors.accountId}
                  aria-describedby={errors.accountId ? 'rec-account-error' : undefined}
                >
                  <SelectValue placeholder={t('form.accountPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.accountId && (
                <p id="rec-account-error" className="text-destructive text-xs" role="alert">
                  {errors.accountId.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-category">{t('form.category')}</Label>
              <Select
                value={categoryValue ?? 'none'}
                onValueChange={(value) =>
                  setValue('categoryId', value === 'none' ? null : value, { shouldDirty: true })
                }
              >
                <SelectTrigger id="rec-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t('form.categoryNone')}</SelectItem>
                  {filteredCategories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="rec-frequency">{t('recurring.form.frequency')}</Label>
              <Select
                value={frequencyValue}
                onValueChange={(value) =>
                  setValue('frequency', value as RecurringRuleValues['frequency'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="rec-frequency" aria-invalid={!!errors.frequency}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((frequency) => (
                    <SelectItem key={frequency} value={frequency}>
                      {t(`recurring.frequencies.${frequency}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-next-date">{t('recurring.form.nextDate')}</Label>
              <Input
                id="rec-next-date"
                type="date"
                aria-invalid={!!errors.nextDate}
                aria-describedby={errors.nextDate ? 'rec-next-date-error' : undefined}
                {...register('nextDate')}
              />
              {errors.nextDate && (
                <p id="rec-next-date-error" className="text-destructive text-xs" role="alert">
                  {errors.nextDate.message}
                </p>
              )}
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? '...' : tCommon('actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
