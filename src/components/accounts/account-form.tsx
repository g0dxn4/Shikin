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

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().min(1),
  balance: z.number(),
})

export type AccountFormValues = z.infer<typeof accountSchema>

interface AccountFormProps {
  account?: Account
  onSubmit: (data: AccountFormValues) => void
  isLoading?: boolean
}

export function AccountForm({ account, onSubmit, isLoading }: AccountFormProps) {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? '',
      type: account?.type ?? 'checking',
      currency: account?.currency ?? 'USD',
      balance: account ? fromCentavos(account.balance) : 0,
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch is inherently mutable
  const typeValue = watch('type')
  const currencyValue = watch('currency')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">{t('form.name')}</Label>
        <Input id="name" placeholder={t('form.namePlaceholder')} {...register('name')} />
        {errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>{t('form.type')}</Label>
        <Select
          value={typeValue}
          onValueChange={(val) => setValue('type', val as AccountFormValues['type'])}
        >
          <SelectTrigger>
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

      <div className="space-y-2">
        <Label>{t('form.currency')}</Label>
        <Select value={currencyValue} onValueChange={(val) => setValue('currency', val)}>
          <SelectTrigger>
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

      <div className="space-y-2">
        <Label htmlFor="balance">{t('form.balance')}</Label>
        <Input
          id="balance"
          type="number"
          step="0.01"
          {...register('balance', { valueAsNumber: true })}
        />
        {errors.balance && <p className="text-destructive text-xs">{errors.balance.message}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
