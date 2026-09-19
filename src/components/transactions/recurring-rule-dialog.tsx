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
import { getErrorMessage } from '@/lib/errors'
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
  anchorKind: z.enum(['fixed_day', 'end_of_month']),
  nextDate: z.string().min(1),
  endDate: z.string(),
  tags: z.string(),
  notes: z.string(),
})

type RecurringRuleValues = z.infer<typeof recurringRuleSchema>

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// eslint-disable-next-line react-refresh/only-export-components -- form mapping covered by dialog tests
export function toRecurringRuleFormData(
  values: RecurringRuleValues,
  existing?: { category_id: string | null; subcategory_id: string | null } | null
): RecurringRuleFormData {
  const categoryId = values.categoryId
  const subcategoryId =
    !categoryId || !existing || categoryId !== existing.category_id
      ? null
      : (existing.subcategory_id ?? null)
  return {
    ...values,
    endDate: emptyToNull(values.endDate),
    notes: emptyToNull(values.notes),
    toAccountId: null,
    subcategoryId,
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
      anchorKind: 'fixed_day',
      nextDate: dayjs().format('YYYY-MM-DD'),
      endDate: '',
      tags: '',
      notes: '',
    },
  })

  const typeValue = watch('type')
  const accountValue = watch('accountId')
  const categoryValue = watch('categoryId')
  const frequencyValue = watch('frequency')
  const anchorKindValue = watch('anchorKind')

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
      anchorKind: rule?.anchor_kind ?? 'fixed_day',
      nextDate: rule?.next_date ?? dayjs().format('YYYY-MM-DD'),
      endDate: rule?.end_date ?? '',
      tags: rule?.tags ?? '',
      notes: rule?.notes ?? '',
    })
  }, [recurringDialogOpen, reset, rule])

  const onSubmit = async (values: RecurringRuleValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingRecurringId) {
        await update(editingRecurringId, toRecurringRuleFormData(values, rule))
        toast.success(t('recurring.toast.updated'))
      } else {
        await create(toRecurringRuleFormData(values))
        toast.success(t('recurring.toast.created'))
      }
      closeRecurringDialog()
    } catch (error) {
      toast.error(getErrorMessage(error, t('recurring.toast.error')))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={recurringDialogOpen} onOpenChange={(open) => !open && closeRecurringDialog()}>
      <DialogContent className="border-border bg-surface max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('recurring.editRule') : t('recurring.addRule')}</DialogTitle>
          <DialogDescription>{t('recurring.empty.description')}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
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

          {['monthly', 'quarterly', 'yearly'].includes(frequencyValue) && (
            <div className="space-y-1.5">
              <Label htmlFor="rec-anchor-kind">{t('recurring.form.scheduleDay')}</Label>
              <Select
                value={anchorKindValue}
                onValueChange={(value) =>
                  setValue('anchorKind', value as RecurringRuleValues['anchorKind'], {
                    shouldDirty: true,
                  })
                }
              >
                <SelectTrigger id="rec-anchor-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed_day">{t('recurring.form.sameDayOfMonth')}</SelectItem>
                  <SelectItem value="end_of_month">{t('recurring.form.lastDayOfMonth')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="rec-end-date">{t('recurring.form.endDate')}</Label>
            <Input
              id="rec-end-date"
              type="date"
              placeholder={t('recurring.form.endDatePlaceholder')}
              aria-invalid={!!errors.endDate}
              aria-describedby={errors.endDate ? 'rec-end-date-error' : undefined}
              {...register('endDate')}
            />
            {errors.endDate && (
              <p id="rec-end-date-error" className="text-destructive text-xs" role="alert">
                {errors.endDate.message}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-notes">{t('form.notes')}</Label>
            <Input
              id="rec-notes"
              placeholder={t('form.notesPlaceholder')}
              aria-invalid={!!errors.notes}
              aria-describedby={errors.notes ? 'rec-notes-error' : undefined}
              {...register('notes')}
            />
            {errors.notes && (
              <p id="rec-notes-error" className="text-destructive text-xs" role="alert">
                {errors.notes.message}
              </p>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? '...' : tCommon('actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
