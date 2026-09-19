import { useEffect, type BaseSyntheticEvent } from 'react'
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
import { SUPPORTED_CURRENCIES } from '@/lib/constants'
import type { Account } from '@/types/database'
import { accountValuationDeclaration } from '@shikin/finance-core/reconciliation'
import dayjs from 'dayjs'
import { fromCentavos } from '@/lib/money'

const ACCOUNT_TYPES = [
  'checking',
  'savings',
  'credit_card',
  'cash',
  'investment',
  'crypto',
  'other',
] as const
const isAccountFormType = (type: Account['type']): type is (typeof ACCOUNT_TYPES)[number] =>
  ACCOUNT_TYPES.includes(type as (typeof ACCOUNT_TYPES)[number])

const accountSchema = z
  .object({
    name: z.string().min(1),
    type: z.enum(ACCOUNT_TYPES),
    currency: z.string().min(1),
    balance: z.number(),
    accountMode: z.enum(['transactional', 'snapshot_only']).optional(),
    valuationMode: z.enum(['cash_plus_holdings', 'portfolio_snapshot', 'unresolved']).optional(),
    observedDate: z.string().optional(),
    icon: z.string().nullable().optional(),
    color: z.string().nullable().optional(),
    creditLimit: z.number().min(0).nullable().optional(),
    statementClosingDay: z.number().int().min(1).max(31).nullable().optional(),
    paymentDueDay: z.number().int().min(1).max(31).nullable().optional(),
  })
  .refine(
    (data) => !['investment', 'crypto'].includes(data.type) || data.valuationMode !== undefined,
    { path: ['valuationMode'], message: 'Choose balance ownership explicitly.' }
  )

export type AccountFormValues = z.infer<typeof accountSchema>

interface AccountFormProps {
  account?: Account
  onSubmit: (data: AccountFormValues, event?: BaseSyntheticEvent) => void
  isLoading?: boolean
  onDirtyChange?: (isDirty: boolean) => void
}

export function AccountForm({ account, onSubmit, isLoading, onDirtyChange }: AccountFormProps) {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty, dirtyFields },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? '',
      type: account && isAccountFormType(account.type) ? account.type : 'checking',
      currency: account?.currency ?? 'USD',
      balance: account ? fromCentavos(account.balance) : 0,
      accountMode: account?.account_mode ?? 'transactional',
      valuationMode: account
        ? accountValuationDeclaration({
            type: account.type,
            accountMode: account.account_mode,
            valuationMode: account.valuation_mode,
          })
        : undefined,
      observedDate: dayjs().format('YYYY-MM-DD'),
      icon: account?.icon ?? null,
      color: account?.color ?? null,
      creditLimit:
        account?.credit_limit !== null && account?.credit_limit !== undefined
          ? fromCentavos(account.credit_limit)
          : null,
      statementClosingDay: account?.statement_closing_day ?? null,
      paymentDueDay: account?.payment_due_day ?? null,
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch is inherently mutable
  const typeValue = watch('type')
  const currencyValue = watch('currency')
  const valuationMode = watch('valuationMode')
  const accountMode = watch('accountMode')

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  return (
    <form
      onSubmit={handleSubmit((values, event) =>
        onSubmit(
          {
            ...values,
            observedDate:
              !account || dirtyFields.balance || dirtyFields.observedDate
                ? values.observedDate
                : undefined,
          },
          event
        )
      )}
      className="space-y-5"
    >
      <div className="space-y-1.5">
        <Label htmlFor="name">{t('form.name')}</Label>
        <Input
          id="name"
          placeholder={t('form.namePlaceholder')}
          autoFocus
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? 'name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="name-error" className="text-destructive text-xs" role="alert">
            {errors.name.message}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-type">{t('form.type')}</Label>
        <Select
          value={typeValue}
          onValueChange={(val) =>
            setValue('type', val as AccountFormValues['type'], { shouldDirty: true })
          }
        >
          <SelectTrigger id="account-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCOUNT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="account-currency">{t('form.currency')}</Label>
          <Select value={currencyValue} onValueChange={(val) => setValue('currency', val)}>
            <SelectTrigger id="account-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((cur) => (
                <SelectItem key={cur} value={cur}>
                  {cur}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="balance">{t('form.balance')}</Label>
          <Input
            id="balance"
            type="number"
            step="0.01"
            aria-invalid={!!errors.balance}
            aria-describedby={errors.balance ? 'balance-error' : undefined}
            {...register('balance', { valueAsNumber: true })}
          />
          {errors.balance && (
            <p id="balance-error" className="text-destructive text-xs" role="alert">
              {errors.balance.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="account-mode">{t('form.accountMode')}</Label>
        <Select
          value={accountMode}
          onValueChange={(value) =>
            setValue('accountMode', value as AccountFormValues['accountMode'], {
              shouldDirty: true,
            })
          }
        >
          <SelectTrigger id="account-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="transactional">{t('form.transactional')}</SelectItem>
            <SelectItem value="snapshot_only">{t('form.snapshotOnly')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="valuation-mode">{t('form.valuationMode')}</Label>
        <Select
          value={valuationMode ?? ''}
          onValueChange={(value) =>
            setValue('valuationMode', value as AccountFormValues['valuationMode'], {
              shouldDirty: true,
              shouldValidate: true,
            })
          }
        >
          <SelectTrigger
            id="valuation-mode"
            aria-describedby="valuation-help"
            aria-invalid={!!errors.valuationMode}
          >
            <SelectValue placeholder={t('form.chooseValuationMode')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash_plus_holdings">{t('form.cashPlusHoldings')}</SelectItem>
            <SelectItem value="portfolio_snapshot">{t('form.portfolioSnapshot')}</SelectItem>
            <SelectItem value="unresolved">{t('form.unresolved')}</SelectItem>
          </SelectContent>
        </Select>
        <p id="valuation-help" className="text-muted-foreground text-xs">
          {t('form.valuationHelp')}
        </p>
        {errors.valuationMode && (
          <p className="text-destructive text-xs" role="alert">
            {t('form.chooseValuationMode')}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="observed-date">{t('form.observedDate')}</Label>
        <Input
          id="observed-date"
          type="date"
          max={dayjs().format('YYYY-MM-DD')}
          aria-describedby="observed-date-help"
          {...register('observedDate')}
        />
        <p id="observed-date-help" className="text-muted-foreground text-xs">
          {t('form.observedDateHelp')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="account-icon">{t('form.icon')}</Label>
          <Input
            id="account-icon"
            {...register('icon', { setValueAs: (value) => (value === '' ? null : value) })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="account-color">{t('form.color')}</Label>
          <Input
            id="account-color"
            {...register('color', { setValueAs: (value) => (value === '' ? null : value) })}
          />
        </div>
      </div>

      {typeValue === 'credit_card' && (
        <div className="border-border bg-muted/40 rounded-lg border p-4">
          <div className="mb-3">
            <p className="text-sm font-semibold">{t('form.creditDetails')}</p>
            <p className="text-muted-foreground text-xs">{t('form.creditDetailsDescription')}</p>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="credit-limit">{t('form.creditLimit')}</Label>
              <Input
                id="credit-limit"
                type="number"
                step="0.01"
                min="0"
                aria-invalid={!!errors.creditLimit}
                aria-describedby={errors.creditLimit ? 'credit-limit-error' : undefined}
                {...register('creditLimit', {
                  setValueAs: (value) => (value === '' ? null : Number(value)),
                })}
              />
              {errors.creditLimit && (
                <p id="credit-limit-error" className="text-destructive text-xs" role="alert">
                  {errors.creditLimit.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="statement-closing-day">{t('form.statementClosingDay')}</Label>
                <Input
                  id="statement-closing-day"
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  aria-invalid={!!errors.statementClosingDay}
                  aria-describedby={
                    errors.statementClosingDay ? 'statement-closing-day-error' : undefined
                  }
                  {...register('statementClosingDay', {
                    setValueAs: (value) => (value === '' ? null : Number(value)),
                  })}
                />
                {errors.statementClosingDay && (
                  <p
                    id="statement-closing-day-error"
                    className="text-destructive text-xs"
                    role="alert"
                  >
                    {errors.statementClosingDay.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="payment-due-day">{t('form.paymentDueDay')}</Label>
                <Input
                  id="payment-due-day"
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  aria-invalid={!!errors.paymentDueDay}
                  aria-describedby={errors.paymentDueDay ? 'payment-due-day-error' : undefined}
                  {...register('paymentDueDay', {
                    setValueAs: (value) => (value === '' ? null : Number(value)),
                  })}
                />
                {errors.paymentDueDay && (
                  <p id="payment-due-day-error" className="text-destructive text-xs" role="alert">
                    {errors.paymentDueDay.message}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
