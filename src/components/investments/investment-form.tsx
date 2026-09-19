import { useEffect, type ReactNode } from 'react'
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
import { useAccountStore } from '@/stores/account-store'
import type { InvestmentWithPrice } from '@/stores/investment-store'

const INVESTMENT_TYPES = [
  'stock',
  'etf',
  'crypto',
  'bond',
  'mutual_fund',
  'cetes',
  'other',
] as const
const PRICE_PROVIDERS = ['manual', 'alpha_vantage', 'finnhub', 'coingecko'] as const
const NON_NEGATIVE_DECIMAL = /^\d+(?:\.\d+)?$/

const investmentSchema = z
  .object({
    symbol: z
      .string()
      .min(1)
      .transform((value) => value.toUpperCase()),
    name: z.string().min(1),
    type: z.enum(INVESTMENT_TYPES),
    quantityDecimal: z.string().trim().regex(NON_NEGATIVE_DECIMAL),
    costBasisKnown: z.boolean(),
    avgCostDecimal: z.string().trim(),
    currency: z.string().min(1),
    accountId: z.string().optional(),
    notes: z.string().optional(),
    priceProvider: z.enum(PRICE_PROVIDERS).optional(),
    instrumentId: z.string().trim().optional(),
    exchange: z.string().trim().optional(),
    quoteCurrency: z.string().optional(),
    manualPriceDecimal: z.string().trim().optional(),
  })
  .superRefine((value, context) => {
    if (value.costBasisKnown && !NON_NEGATIVE_DECIMAL.test(value.avgCostDecimal)) {
      context.addIssue({
        code: 'custom',
        path: ['avgCostDecimal'],
        message: 'Enter a non-negative decimal',
      })
    }
    if (value.priceProvider && !value.instrumentId?.trim()) {
      context.addIssue({
        code: 'custom',
        path: ['instrumentId'],
        message: 'Instrument ID is required',
      })
    }
    if (
      value.priceProvider === 'manual' &&
      !NON_NEGATIVE_DECIMAL.test(value.manualPriceDecimal ?? '')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['manualPriceDecimal'],
        message: 'Enter a verified non-negative price',
      })
    }
    if (
      value.priceProvider &&
      value.priceProvider !== 'manual' &&
      !value.exchange?.trim() &&
      value.priceProvider !== 'coingecko'
    ) {
      context.addIssue({
        code: 'custom',
        path: ['exchange'],
        message: 'Exchange or region is required',
      })
    }
  })

export type InvestmentFormValues = z.infer<typeof investmentSchema>

interface InvestmentFormProps {
  investment?: InvestmentWithPrice
  onSubmit: (data: InvestmentFormValues) => void
  isLoading?: boolean
  onDirtyChange?: (isDirty: boolean) => void
}

export function InvestmentForm({
  investment,
  onSubmit,
  isLoading,
  onDirtyChange,
}: InvestmentFormProps) {
  const { t } = useTranslation('investments')
  const { t: tCommon } = useTranslation('common')
  const { accounts, isLoading: accountsLoading, fetchError: accountsFetchError } = useAccountStore()
  const investmentAccounts = accounts.filter(
    (account) => account.type === 'investment' || account.type === 'crypto'
  )
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isDirty },
  } = useForm<InvestmentFormValues>({
    resolver: zodResolver(investmentSchema),
    defaultValues: {
      symbol: investment?.symbol ?? '',
      name: investment?.name ?? '',
      type: investment?.type ?? 'stock',
      quantityDecimal: investment?.quantityDecimal ?? '0',
      costBasisKnown: investment?.costBasisKnown ?? false,
      avgCostDecimal: investment?.avgCostBasisDecimal ?? '0',
      currency: investment?.currency ?? 'USD',
      accountId: investment?.account_id ?? undefined,
      notes: investment?.notes ?? '',
      priceProvider: investment?.priceProvider ?? undefined,
      instrumentId: investment?.priceInstrumentId ?? investment?.symbol ?? '',
      exchange: investment?.priceExchange ?? '',
      quoteCurrency: investment?.currentPriceCurrency ?? investment?.currency ?? 'USD',
      manualPriceDecimal:
        investment?.priceProvider === 'manual' ? (investment.currentPriceDecimal ?? '') : '',
    },
  })
  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const typeValue = watch('type')
  const currencyValue = watch('currency')
  const accountValue = watch('accountId')
  const costBasisKnown = watch('costBasisKnown')
  const provider = watch('priceProvider')
  const quoteCurrency = watch('quoteCurrency')

  useEffect(() => onDirtyChange?.(isDirty), [isDirty, onDirtyChange])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label={t('form.symbol')} error={errors.symbol?.message} id="inv-symbol">
          <Input
            id="inv-symbol"
            autoFocus
            className="uppercase"
            aria-invalid={!!errors.symbol}
            aria-describedby={errors.symbol ? 'inv-symbol-error' : undefined}
            {...register('symbol')}
          />
        </Field>
        <Field label={t('form.name')} error={errors.name?.message} id="inv-name">
          <Input
            id="inv-name"
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'inv-name-error' : undefined}
            {...register('name')}
          />
        </Field>
      </div>

      <Field label={t('form.type')} id="inv-type">
        <Select
          value={typeValue}
          onValueChange={(value) =>
            setValue('type', value as InvestmentFormValues['type'], { shouldDirty: true })
          }
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
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t('form.shares')} error={errors.quantityDecimal?.message} id="inv-shares">
          <Input
            id="inv-shares"
            inputMode="decimal"
            aria-invalid={!!errors.quantityDecimal}
            aria-describedby={errors.quantityDecimal ? 'inv-shares-error' : undefined}
            {...register('quantityDecimal')}
          />
        </Field>
        <Field label={t('form.currency')} id="inv-currency">
          <Select
            value={currencyValue}
            onValueChange={(value) => setValue('currency', value, { shouldDirty: true })}
          >
            <SelectTrigger id="inv-currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_CURRENCIES.map((currency) => (
                <SelectItem key={currency} value={currency}>
                  {currency}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" {...register('costBasisKnown')} />
        {t('form.costBasisKnown')}
      </label>
      <Field label={t('form.avgCost')} error={errors.avgCostDecimal?.message} id="inv-avg-cost">
        <Input
          id="inv-avg-cost"
          inputMode="decimal"
          disabled={!costBasisKnown}
          aria-invalid={!!errors.avgCostDecimal}
          aria-describedby={errors.avgCostDecimal ? 'inv-avg-cost-error' : undefined}
          {...register('avgCostDecimal')}
        />
      </Field>

      <ErrorBanner title="Accounts couldn’t be loaded" message={accountsFetchError} />
      <Field label={t('form.account')} id="inv-account">
        {accountsLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <Select
            value={accountValue ?? 'none'}
            onValueChange={(value) =>
              setValue('accountId', value === 'none' ? undefined : value, { shouldDirty: true })
            }
            disabled={!!accountsFetchError}
          >
            <SelectTrigger id="inv-account">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('form.noAccount')}</SelectItem>
              {investmentAccounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </Field>

      <div className="border-border space-y-4 rounded-lg border p-4">
        <div>
          <p className="text-sm font-semibold">{t('form.valuationIdentity')}</p>
          <p className="text-muted-foreground text-xs">{t('form.valuationIdentityHelp')}</p>
        </div>
        <Field label={t('form.priceProvider')} id="inv-provider">
          <Select
            value={provider ?? 'none'}
            onValueChange={(value) =>
              setValue(
                'priceProvider',
                value === 'none' ? undefined : (value as InvestmentFormValues['priceProvider']),
                { shouldDirty: true }
              )
            }
          >
            <SelectTrigger id="inv-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('form.noPrice')}</SelectItem>
              {PRICE_PROVIDERS.map((item) => (
                <SelectItem key={item} value={item}>
                  {t(`providers.${item}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {provider ? (
          <>
            <Field
              label={t('form.instrumentId')}
              error={errors.instrumentId?.message}
              id="inv-instrument-id"
            >
              <Input id="inv-instrument-id" {...register('instrumentId')} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t('form.exchange')} error={errors.exchange?.message} id="inv-exchange">
                <Input id="inv-exchange" {...register('exchange')} />
              </Field>
              <Field label={t('form.quoteCurrency')} id="inv-quote-currency">
                <Select
                  value={quoteCurrency}
                  onValueChange={(value) => setValue('quoteCurrency', value, { shouldDirty: true })}
                >
                  <SelectTrigger id="inv-quote-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((currency) => (
                      <SelectItem key={currency} value={currency}>
                        {currency}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            {provider === 'manual' ? (
              <Field
                label={t('form.manualPrice')}
                error={errors.manualPriceDecimal?.message}
                id="inv-manual-price"
              >
                <Input
                  id="inv-manual-price"
                  inputMode="decimal"
                  {...register('manualPriceDecimal')}
                />
              </Field>
            ) : null}
          </>
        ) : null}
      </div>

      <Field label={t('form.notes')} id="notes">
        <textarea
          id="notes"
          className="border-input bg-surface min-h-[80px] w-full resize-none rounded-lg border px-3 py-2 text-sm"
          {...register('notes')}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}

function Field({
  label,
  error,
  id,
  children,
}: {
  label: string
  error?: string
  id: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
