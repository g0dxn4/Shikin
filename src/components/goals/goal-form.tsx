import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
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
const GOAL_COLORS = [
  '#7C5CFF',
  '#22c55e',
  '#3b82f6',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#06b6d4',
  '#8b5cf6',
] as const

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
  onDirtyChange?: (isDirty: boolean) => void
}

export function GoalForm({ goal, onSubmit, isLoading, onDirtyChange }: GoalFormProps) {
  const { t } = useTranslation('goals')
  const { t: tCommon } = useTranslation('common')
  const {
    accounts,
    isLoading: accountsLoading,
    fetchError: accountsFetchError,
    fetch: fetchAccounts,
  } = useAccountStore()

  useEffect(() => {
    void fetchAccounts().catch(() => {})
  }, [fetchAccounts])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<GoalFormValues>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      name: goal?.name ?? '',
      targetAmount: goal ? fromCentavos(goal.target_amount) : 0,
      currentAmount: goal ? fromCentavos(goal.current_amount) : 0,
      deadline: goal?.deadline ?? '',
      accountId: goal?.account_id ?? '',
      icon: goal?.icon ?? '🎯',
      color: goal?.color ?? '#7C5CFF',
      notes: goal?.notes ?? '',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const iconValue = watch('icon')
  const colorValue = watch('color')
  const accountValue = watch('accountId')
  const isAccountSelectDisabled = accountsLoading || !!accountsFetchError

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const focusGoalOption = (
    values: readonly string[],
    nextIndex: number,
    setter: (value: string) => void,
    prefix: string
  ) => {
    const normalizedIndex = (nextIndex + values.length) % values.length
    const nextValue = values[normalizedIndex]
    setter(nextValue)
    setTimeout(() => {
      document.getElementById(`${prefix}-${normalizedIndex}`)?.focus()
    }, 0)
  }

  const handleGoalOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    values: readonly string[],
    currentValue: string,
    setter: (value: string) => void,
    prefix: string
  ) => {
    const currentIndex = values.indexOf(currentValue)
    if (currentIndex === -1) return

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        focusGoalOption(values, currentIndex + 1, setter, prefix)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        focusGoalOption(values, currentIndex - 1, setter, prefix)
        break
      case ' ':
      case 'Enter':
        event.preventDefault()
        setter(currentValue)
        break
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <ErrorBanner title={t('form.accountsError')} message={accountsFetchError} />

      <div className="space-y-1.5">
        <Label htmlFor="goal-name">{t('form.name')}</Label>
        <Input
          id="goal-name"
          placeholder={t('form.namePlaceholder')}
          autoFocus
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'goal-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="goal-name-error" className="text-destructive text-xs" role="alert">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="goal-target-amount">{t('form.targetAmount')}</Label>
          <Input
            id="goal-target-amount"
            type="number"
            step="0.01"
            aria-invalid={!!errors.targetAmount}
            aria-describedby={errors.targetAmount ? 'goal-target-error' : undefined}
            {...register('targetAmount', { valueAsNumber: true })}
          />
          {errors.targetAmount && (
            <p id="goal-target-error" className="text-destructive text-xs" role="alert">
              {errors.targetAmount.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="goal-current-amount">{t('form.currentAmount')}</Label>
          <Input
            id="goal-current-amount"
            type="number"
            step="0.01"
            aria-invalid={!!errors.currentAmount}
            aria-describedby={errors.currentAmount ? 'goal-current-error' : undefined}
            {...register('currentAmount', { valueAsNumber: true })}
          />
          {errors.currentAmount && (
            <p id="goal-current-error" className="text-destructive text-xs" role="alert">
              {errors.currentAmount.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deadline">{t('form.deadline')}</Label>
        <Input id="deadline" type="date" {...register('deadline')} />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="goal-account">{t('form.account')}</Label>
        <Select
          value={accountValue || ''}
          onValueChange={(val) => setValue('accountId', val === '__none__' ? '' : val)}
          disabled={isAccountSelectDisabled}
        >
          <SelectTrigger id="goal-account">
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
          <Label id="goal-icon-label">{t('form.icon')}</Label>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby="goal-icon-label"
          >
            {GOAL_ICONS.map((ic) => (
              <button
                key={ic}
                id={`goal-icon-${GOAL_ICONS.indexOf(ic)}`}
                type="button"
                onClick={() => setValue('icon', ic)}
                onKeyDown={(event) =>
                  handleGoalOptionKeyDown(
                    event,
                    GOAL_ICONS,
                    iconValue,
                    (value) => setValue('icon', value),
                    'goal-icon'
                  )
                }
                role="radio"
                aria-label={t('form.selectIcon', { icon: ic })}
                aria-checked={iconValue === ic}
                tabIndex={iconValue === ic ? 0 : -1}
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-base transition-colors ${
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
          <Label id="goal-color-label">{t('form.color')}</Label>
          <div
            className="flex flex-wrap gap-1.5"
            role="radiogroup"
            aria-labelledby="goal-color-label"
          >
            {GOAL_COLORS.map((c) => (
              <button
                key={c}
                id={`goal-color-${GOAL_COLORS.indexOf(c)}`}
                type="button"
                onClick={() => setValue('color', c)}
                onKeyDown={(event) =>
                  handleGoalOptionKeyDown(
                    event,
                    GOAL_COLORS,
                    colorValue,
                    (value) => setValue('color', value),
                    'goal-color'
                  )
                }
                role="radio"
                aria-label={t('form.selectColor', { color: c })}
                aria-checked={colorValue === c}
                tabIndex={colorValue === c ? 0 : -1}
                className={`h-10 w-10 rounded-lg transition-transform ${
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
        <Input id="notes" placeholder={t('form.notesPlaceholder')} {...register('notes')} />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading} aria-busy={isLoading}>
        {isLoading ? (
          <>
            <span className="sr-only">{tCommon('actions.saving')}</span>
            ...
          </>
        ) : (
          tCommon('actions.save')
        )}
      </Button>
    </form>
  )
}
