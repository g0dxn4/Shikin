import { useCallback, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Check, X, Split, Plus } from 'lucide-react'
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
import { useCategoryStore } from '@/stores/category-store'
import { useCategorizationStore } from '@/stores/categorization-store'
import { fromCentavos, toCentavos } from '@/lib/money'
import type { CategorySuggestion } from '@/lib/auto-categorize'
import type { TransactionWithDetails } from '@/stores/transaction-store'

const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const

const transactionSchema = z
  .object({
    amount: z.number().positive(),
    type: z.enum(TRANSACTION_TYPES),
    description: z.string().min(1),
    categoryId: z.string().nullable(),
    accountId: z.string().min(1),
    transferToAccountId: z.string().nullable(),
    currency: z.string().min(1),
    date: z.string().min(1),
    notes: z.string().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'transfer') {
      if (!data.transferToAccountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transferToAccountId'],
          message: 'Destination account is required for transfers',
        })
      }
      if (data.transferToAccountId && data.transferToAccountId === data.accountId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['transferToAccountId'],
          message: 'Source and destination accounts must be different',
        })
      }
    }
  })

export type TransactionFormValues = z.infer<typeof transactionSchema>

export interface SplitRowData {
  categoryId: string
  amount: string // string for input control
  notes: string
}

interface TransactionFormProps {
  transaction?: TransactionWithDetails
  onSubmit: (data: TransactionFormValues, splits?: SplitRowData[]) => void
  isLoading?: boolean
}

export function TransactionForm({ transaction, onSubmit, isLoading }: TransactionFormProps) {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { accounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()
  const { suggestCategory } = useCategorizationStore()

  const [suggestion, setSuggestion] = useState<CategorySuggestion | null>(null)
  const [suggestionDismissed, setSuggestionDismissed] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [isSplitMode, setIsSplitMode] = useState(false)
  const [splitRows, setSplitRows] = useState<SplitRowData[]>([
    { categoryId: '', amount: '', notes: '' },
    { categoryId: '', amount: '', notes: '' },
  ])

  useEffect(() => {
    fetchAccounts()
    fetchCategories()
  }, [fetchAccounts, fetchCategories])

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TransactionFormValues>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      amount: transaction ? fromCentavos(transaction.amount) : undefined,
      type: transaction?.type ?? 'expense',
      description: transaction?.description ?? '',
      categoryId: transaction?.category_id ?? null,
      accountId: transaction?.account_id ?? '',
      transferToAccountId: transaction?.transfer_to_account_id ?? null,
      currency: transaction?.currency ?? 'USD',
      date: transaction?.date ?? dayjs().format('YYYY-MM-DD'),
      notes: transaction?.notes ?? null,
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch is inherently mutable
  const typeValue = watch('type')
  const accountIdValue = watch('accountId')
  const transferToAccountIdValue = watch('transferToAccountId')
  const categoryIdValue = watch('categoryId')
  const descriptionValue = watch('description')
  const amountValue = watch('amount')

  const filteredCategories = categories.filter((c) => c.type === typeValue)

  // Auto-set currency from selected account
  const selectedAccount = accounts.find((a) => a.id === accountIdValue)
  useEffect(() => {
    if (selectedAccount) {
      setValue('currency', selectedAccount.currency)
    }
  }, [selectedAccount, setValue])

  // Debounced auto-categorization suggestion
  const fetchSuggestion = useCallback(
    async (desc: string) => {
      if (!desc || desc.length < 2) {
        setSuggestion(null)
        return
      }
      try {
        const result = await suggestCategory(desc)
        setSuggestion(result)
        setSuggestionDismissed(false)
      } catch {
        setSuggestion(null)
      }
    },
    [suggestCategory]
  )

  useEffect(() => {
    // Don't suggest when editing an existing transaction
    if (transaction) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchSuggestion(descriptionValue)
    }, 300)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [descriptionValue, fetchSuggestion, transaction])

  // Find suggested category name for display
  const suggestedCategory =
    suggestion && !suggestionDismissed
      ? categories.find((c) => c.id === suggestion.category_id)
      : null

  // Don't show suggestion if category is already set to the suggested one
  const showSuggestion = suggestedCategory && categoryIdValue !== suggestion?.category_id

  const handleAcceptSuggestion = () => {
    if (!suggestion) return
    setValue('categoryId', suggestion.category_id)
    setSuggestion(null)
  }

  const handleDismissSuggestion = () => {
    setSuggestionDismissed(true)
  }

  // Split calculations
  const totalCentavos = amountValue ? toCentavos(amountValue) : 0
  const splitTotalCentavos = splitRows.reduce((sum, row) => {
    const val = parseFloat(row.amount)
    return sum + (isNaN(val) ? 0 : toCentavos(val))
  }, 0)
  const remainingCentavos = totalCentavos - splitTotalCentavos

  const updateSplitRow = useCallback(
    (index: number, field: keyof SplitRowData, value: string) => {
      setSplitRows((prev) => {
        const next = [...prev]
        next[index] = { ...next[index], [field]: value }
        return next
      })
    },
    []
  )

  const addSplitRow = useCallback(() => {
    setSplitRows((prev) => [...prev, { categoryId: '', amount: '', notes: '' }])
  }, [])

  const removeSplitRow = useCallback((index: number) => {
    setSplitRows((prev) => {
      if (prev.length <= 2) return prev
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleFormSubmit = (data: TransactionFormValues) => {
    if (isSplitMode) {
      // Validate splits
      const validSplits = splitRows.filter((r) => r.categoryId && r.amount)
      if (validSplits.length < 2) return
      if (remainingCentavos !== 0) return
      onSubmit(data, validSplits)
    } else {
      onSubmit(data)
    }
  }

  const splitsValid =
    !isSplitMode ||
    (splitRows.filter((r) => r.categoryId && r.amount).length >= 2 && remainingCentavos === 0)


  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <div className="space-y-1.5">
        <Label>{t('form.type')}</Label>
        <Select
          value={typeValue}
          onValueChange={(val) => {
            setValue('type', val as TransactionFormValues['type'])
            setValue('categoryId', null)
            if (val !== 'transfer') {
              setValue('transferToAccountId', null)
            }
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSACTION_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`types.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="amount">{t('form.amount')}</Label>
        <Input
          id="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder={t('form.amountPlaceholder')}
          className="font-heading text-2xl font-semibold"
          autoFocus
          {...register('amount', { valueAsNumber: true })}
        />
        {errors.amount && <p className="text-destructive text-xs">{errors.amount.message}</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="description">{t('form.description')}</Label>
        <Input
          id="description"
          placeholder={t('form.descriptionPlaceholder')}
          {...register('description')}
        />
        {errors.description && (
          <p className="text-destructive text-xs">{errors.description.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>{t('form.account')}</Label>
          <Select value={accountIdValue} onValueChange={(val) => setValue('accountId', val)}>
            <SelectTrigger>
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
            <p className="text-destructive text-xs">{errors.accountId.message}</p>
          )}
        </div>

        {!isSplitMode && (
          <div className="space-y-1.5">
            <Label>{t('form.category')}</Label>
            <Select
              value={categoryIdValue ?? '__none__'}
              onValueChange={(val) => setValue('categoryId', val === '__none__' ? null : val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">{t('form.categoryNone')}</SelectItem>
                {filteredCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-2">
                      {cat.color && (
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: cat.color }}
                        />
                      )}
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Auto-categorization suggestion chip */}
            {showSuggestion && (
              <div className="animate-fade-in flex items-center gap-1.5 pt-1">
                <span className="text-muted-foreground text-[11px]">
                  {t('form.suggested')}:
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.04] px-2.5 py-0.5 text-[11px]">
                  {suggestedCategory.color && (
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: suggestedCategory.color }}
                    />
                  )}
                  <span className="text-foreground">{suggestedCategory.name}</span>
                  <button
                    type="button"
                    onClick={handleAcceptSuggestion}
                    className="text-success hover:text-success/80 ml-0.5 transition-colors"
                    title={t('form.acceptSuggestion')}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={handleDismissSuggestion}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={t('form.dismissSuggestion')}
                  >
                    <X size={12} />
                  </button>
                </span>
              </div>
            )}
          </div>
        )}

        {isSplitMode && (
          <div className="flex items-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setIsSplitMode(false)
                setSplitRows([
                  { categoryId: '', amount: '', notes: '' },
                  { categoryId: '', amount: '', notes: '' },
                ])
              }}
              className="text-muted-foreground text-xs"
            >
              <X size={12} />
              {t('form.category')}
            </Button>
          </div>
        )}
      </div>

      {typeValue === 'transfer' && (
        <div className="space-y-1.5">
          <Label>{t('form.transferToAccount')}</Label>
          <Select
            value={transferToAccountIdValue ?? '__none__'}
            onValueChange={(val) =>
              setValue('transferToAccountId', val === '__none__' ? null : val)
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t('form.transferToAccountPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{t('form.transferToAccountPlaceholder')}</SelectItem>
              {accounts
                .filter((account) => account.id !== accountIdValue)
                .map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {errors.transferToAccountId && (
            <p className="text-destructive text-xs">{errors.transferToAccountId.message}</p>
          )}
        </div>
      )}

      {/* Split toggle */}
      {!isSplitMode && (
        <button
          type="button"
          onClick={() => setIsSplitMode(true)}
          className="text-muted-foreground hover:text-accent flex items-center gap-1.5 text-xs transition-colors"
        >
          <Split size={12} />
          {t('split.toggle')}
        </button>
      )}

      {/* Split rows */}
      {isSplitMode && (
        <div className="border-border/40 space-y-3 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5 font-mono text-[11px]">
              <Split size={11} />
              {t('split.breakdown')}
            </span>
            {remainingCentavos === 0 && totalCentavos > 0 ? (
              <span className="text-success font-mono text-[11px]">{t('split.allocated')}</span>
            ) : remainingCentavos < 0 ? (
              <span className="text-destructive font-mono text-[11px]">
                {t('split.overAllocated')} ${(Math.abs(remainingCentavos) / 100).toFixed(2)}
              </span>
            ) : totalCentavos > 0 ? (
              <span className="text-muted-foreground font-mono text-[11px]">
                {t('split.remaining')}: ${(remainingCentavos / 100).toFixed(2)}
              </span>
            ) : null}
          </div>

          {splitRows.map((row, index) => (
            <div key={index} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <Select
                  value={row.categoryId || '__none__'}
                  onValueChange={(val) =>
                    updateSplitRow(index, 'categoryId', val === '__none__' ? '' : val)
                  }
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder={t('split.category')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('split.category')}</SelectItem>
                    {filteredCategories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        <span className="flex items-center gap-1.5">
                          {cat.color && (
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: cat.color }}
                            />
                          )}
                          {cat.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={row.amount}
                onChange={(e) => updateSplitRow(index, 'amount', e.target.value)}
                className="h-8 w-24 font-mono text-xs"
              />
              {splitRows.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                  onClick={() => removeSplitRow(index)}
                >
                  <X size={12} />
                </Button>
              )}
            </div>
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={addSplitRow}
            className="text-muted-foreground h-7 text-xs"
          >
            <Plus size={12} />
            {t('split.addRow')}
          </Button>
        </div>
      )}


      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="date">{t('form.date')}</Label>
          <Input id="date" type="date" {...register('date')} />
          {errors.date && <p className="text-destructive text-xs">{errors.date.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="notes">{t('form.notes')}</Label>
          <Input id="notes" placeholder={t('form.notesPlaceholder')} {...register('notes')} />
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading || !splitsValid}>
        {isLoading ? '...' : tCommon('actions.save')}
      </Button>
    </form>
  )
}
