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
import { useAccountStore } from '@/stores/account-store'
import type { GoalWithProgress } from '@/stores/goal-store'
import { fromCentavos } from '@/lib/money'

const GOAL_ICONS = ['🎯', '🏠', '✈️', '🚗', '🎓', '💰', '🏖️', '💍', '🏥', '📱'] as const
const GOAL_COLORS = ['#bf5af2', '#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#8b5cf6'] as const

const goalSchema = z.object({
  name: z.string().min(1),
  targetAmount: z.number().positive(),
  currentAmount: z.number().min(0),
  deadline: z.string().optional().or(z.literal('')),
  accountId: z.string().optional().or(z.literal('')),
  icon: z.string().min(1),
  color: z.string().min(1),
  notes: z.string().optional().or(z.literal('')),
})

export type GoalFormValues = z.infer<typeof goalSchema>

interface GoalFormProps {
  goal?: GoalWithProgress
  onSubmit: (data: GoalFormValues) => void
  isLoading?: boolean
}

export function GoalForm({ goal, onSubmit, isLoading }: GoalFormProps) {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const { accounts, fetch: fetchAccounts } = useAccountStore()

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: goal?.name ?? '',
      targetAmount: goal ? fromCentavos(goal.target_amount) : 0,
      currentAmount: goal ? fromCentavos(goal.current_amount) : 0,
      deadline: goal?.deadline ?? '',
      accountId: goal?.account_id ?? '',
      icon: goal?.icon ?? '🎯',
      color: goal?.color ?? '#bf5af2',
      notes: goal?.notes ?? '',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const iconValue = watch('icon')
  const colorValue = watch('color')
  const accountValue = watch('accountId')

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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="targetAmount">{t('form.targetAmount')}</Label>
          <Input
            id="targetAmount"
            type="number"
            step="0.01"
            {...register('targetAmount', { valueAsNumber: true })}
          />
          {errors.targetAmount && (
            <p className="text-destructive text-xs">{errors.targetAmount.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currentAmount">{t('form.currentAmount')}</Label>
          <Input
            id="currentAmount"
            type="number"
            step="0.01"
            {...register('currentAmount', { valueAsNumber: true })}
          />
          {errors.currentAmount && (
            <p className="text-destructive text-xs">{errors.currentAmount.message}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deadline">{t('form.deadline')}</Label>
        <Input id="deadline" type="date" {...register('deadline')} />
      </div>

      <div className="space-y-1.5">
        <Label>{t('form.account')}</Label>
        <Select
          value={accountValue || ''}
          onValueChange={(val) => setValue('accountId', val === '__none__' ? '' : val)}
        >
          <SelectTrigger>
            <SelectValue placeholder={t('form.accountPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">—</SelectItem>
            {accounts.map((acc) => (
              <SelectItem key={acc.id} value={acc.id}>
                {acc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t('form.icon')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {GOAL_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                onClick={() => setValue('icon', ic)}
                className={`flex h-8 w-8 items-center justify-center rounded-lg text-base transition-colors ${
                  iconValue === ic
                    ? 'bg-white/10 ring-1 ring-white/20'
                    : 'bg-white/5 hover:bg-white/10'
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>{t('form.color')}</Label>
          <div className="flex flex-wrap gap-1.5">
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setValue('color', c)}
                className={`h-8 w-8 rounded-lg transition-transform ${
                  colorValue === c ? 'scale-110 ring-2 ring-white/30' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">{t('form.notes')}</Label>
        <Input
          id="notes"
          placeholder={t('form.notesPlaceholder')}
          {...register('notes')}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
