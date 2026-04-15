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
import { SUPPORTED_CURRENCIES } from '@/lib/constants'
import { fromCentavos } from '@/lib/money'
import { useAccountStore } from '@/stores/account-store'
import type { InvestmentWithPrice } from '@/stores/investment-store'

const INVESTMENT_TYPES = ['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other'] as const

const investmentSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .transform((s) => s.toUpperCase()),
  name: z.string().min(1),
  type: z.enum(INVESTMENT_TYPES),
  shares: z.number().min(0),
  avgCost: z.number().min(0),
  currency: z.string().min(1),
  accountId: z.string().optional(),
  notes: z.string().optional(),
})

export type InvestmentFormValues = z.infer<typeof investmentSchema>

interface InvestmentFormProps {
  investment?: InvestmentWithPrice
  onSubmit: (data: InvestmentFormValues) => void
  isLoading?: boolean
}

export function InvestmentForm({ investment, onSubmit, isLoading }: InvestmentFormProps) {
  const { t } = useTranslation('investments')
  const { t: tCommon } = useTranslation('common')
  const { accounts, isLoading: accountsLoading, fetchError: accountsFetchError } = useAccountStore()

  const investmentAccounts = accounts.filter((a) => a.type === 'investment' || a.type === 'crypto')
  const isAccountSelectDisabled = accountsLoading || !!accountsFetchError

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<InvestmentFormValues>({
    resolver: zodResolver(investmentSchema),
    defaultValues: {
      symbol: investment?.symbol ?? '',
      name: investment?.name ?? '',
      type: investment?.type ?? 'stock',
      shares: investment?.shares ?? 0,
      avgCost: investment ? fromCentavos(investment.avg_cost_basis) : 0,
      currency: investment?.currency ?? 'USD',
      accountId: investment?.account_id ?? undefined,
      notes: investment?.notes ?? '',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const typeValue = watch('type')
  const currencyValue = watch('currency')
  const accountValue = watch('accountId')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-symbol">{t('form.symbol')}</Label>
          <Input
            id="inv-symbol"
            placeholder="AAPL"
            autoFocus
            className="uppercase"
            aria-invalid={!!errors.symbol}
            aria-describedby={errors.symbol ? 'inv-symbol-error' : undefined}
            {...register('symbol')}
          />
          {errors.symbol && (
            <p id="inv-symbol-error" className="text-destructive text-xs" role="alert">
              {errors.symbol.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inv-name">{t('form.name')}</Label>
          <Input
            id="inv-name"
            placeholder="Apple Inc."
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'inv-name-error' : undefined}
            {...register('name')}
          />
          {errors.name && (
            <p id="inv-name-error" className="text-destructive text-xs" role="alert">
              {errors.name.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="inv-type">{t('form.type')}</Label>
        <Select
          value={typeValue}
          onValueChange={(val) => setValue('type', val as InvestmentFormValues['type'])}
        >
          <SelectTrigger id="inv-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INVESTMENT_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-shares">{t('form.shares')}</Label>
          <Input
            id="inv-shares"
            type="number"
            step="any"
            aria-invalid={!!errors.shares}
            aria-describedby={errors.shares ? 'inv-shares-error' : undefined}
            {...register('shares', { valueAsNumber: true })}
          />
          {errors.shares && (
            <p id="inv-shares-error" className="text-destructive text-xs" role="alert">
              {errors.shares.message}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="inv-avg-cost">{t('form.avgCost')}</Label>
          <Input
            id="inv-avg-cost"
            type="number"
            step="0.01"
            aria-invalid={!!errors.avgCost}
            aria-describedby={errors.avgCost ? 'inv-avg-cost-error' : undefined}
            {...register('avgCost', { valueAsNumber: true })}
          />
          {errors.avgCost && (
            <p id="inv-avg-cost-error" className="text-destructive text-xs" role="alert">
              {errors.avgCost.message}
            </p>
          )}
        </div>
      </div>

      <ErrorBanner title="Accounts couldn\'t be loaded" message={accountsFetchError} />

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="inv-currency">{t('form.currency')}</Label>
          <Select value={currencyValue} onValueChange={(val) => setValue('currency', val)}>
            <SelectTrigger id="inv-currency">
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
          <Label htmlFor="inv-account">{t('form.account')}</Label>
          {accountsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <Select
              value={accountValue ?? 'none'}
              onValueChange={(val) => setValue('accountId', val === 'none' ? undefined : val)}
              disabled={isAccountSelectDisabled}
            >
              <SelectTrigger id="inv-account">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('form.noAccount')}</SelectItem>
                {investmentAccounts.map((acc) => (
                  <SelectItem key={acc.id} value={acc.id}>
                    {acc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="notes">{t('form.notes')}</Label>
        <textarea
          id="notes"
          placeholder={t('form.notesPlaceholder')}
          className="glass-input text-foreground min-h-[80px] w-full resize-none px-3 py-2 text-sm"
          {...register('notes')}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
