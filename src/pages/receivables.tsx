import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Wallet, Plus, Pencil, Ban, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorBanner } from '@/components/ui/error-banner'
import { ErrorState } from '@/components/ui/error-state'
import { FilterPills } from '@/components/ui/filter-pills'
import { ShowMorePagination } from '@/components/shared/show-more-pagination'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MetricItem, MetricStrip, NativePanel, PageToolbar } from '@/components/ui/native-layout'
import { useReceivableStore, type ReceivableWithDetails } from '@/stores/receivable-store'
import { useAccountStore } from '@/stores/account-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import {
  receivableDueLabel,
  storedReceivableProgress,
} from '@/components/receivables/receivable-presentation'
import { getErrorMessage } from '@/lib/errors'
import { SUPPORTED_CURRENCIES } from '@/lib/constants'
import {
  buildReceivablesStatusTotals,
  type ConvertedTotal,
} from '@/lib/accounts-group-converted-totals'
import dayjs from 'dayjs'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const RECEIVABLES_PAGE_SIZE = 20

type StatusFilter = 'all' | 'open' | 'partial' | 'received' | 'cancelled' | 'overdue'

const receivableSchema = z.object({
  payer: z.string().min(1),
  amount: z.number().positive(),
  currency: z.string().min(1),
  dueDate: z.string().min(1),
  accountId: z.string().optional().or(z.literal('')),
  projectReference: z.string().optional().or(z.literal('')),
  invoiceReference: z.string().optional().or(z.literal('')),
  notes: z.string().optional().or(z.literal('')),
})

type ReceivableFormValues = z.infer<typeof receivableSchema>

function formatConverted(total: ConvertedTotal): string {
  if (!total.complete) return '—'
  return formatMoney(total.amountCentavos, total.preferredCurrency)
}

function statusBadgeClass(status: ReceivableWithDetails['status']): string {
  switch (status) {
    case 'open':
      return 'text-muted-foreground'
    case 'partial':
      return 'border-warning/30 bg-warning/10 text-warning'
    case 'received':
      return 'border-success/30 bg-success/10 text-success'
    case 'cancelled':
      return 'text-muted-foreground line-through'
  }
}

function progressColor(percent: number): string {
  if (percent >= 100) return 'var(--color-success)'
  if (percent >= 50) return 'var(--color-warning)'
  return 'var(--color-chart-2)'
}

function ReceivableRow({
  receivable,
  onEdit,
  onCancel,
  onDelete,
}: {
  receivable: ReceivableWithDetails
  onEdit: () => void
  onCancel: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('receivables')
  const { t: tCommon } = useTranslation('common')

  const isCancelled = receivable.status === 'cancelled'
  const isMatched = Boolean(receivable.matched_transaction_id)
  const progress = storedReceivableProgress({
    status: receivable.status,
    amount: receivable.amount,
    receivedAmount: receivable.received_amount,
  })
  const dueLabel = receivableDueLabel(
    { status: receivable.status, dueDate: receivable.due_date },
    dayjs(),
    t
  )
  const dueOverdue = !isCancelled && (receivable.isOverdue || dueLabel === t('card.overdue'))

  return (
    <article
      className={`group border-border min-w-0 rounded-lg border p-4 ${
        receivable.isOverdue ? 'border-warning/40' : ''
      } ${isCancelled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold break-words">{receivable.payer}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge
              variant="secondary"
              className={`shrink-0 text-xs ${statusBadgeClass(receivable.status)}`}
            >
              {t(`filters.${receivable.status}`)}
            </Badge>
            {isMatched ? (
              <Badge variant="outline" className="text-xs">
                {t('card.matched')}
              </Badge>
            ) : null}
            <span
              className={`inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-xs ${
                dueOverdue
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {dueLabel}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-50 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11 md:h-8 md:w-8"
            onClick={onEdit}
            aria-label={`${tCommon('actions.edit')} ${receivable.payer}`}
          >
            <Pencil size={12} />
          </Button>
          {!isCancelled && (
            <Button
              variant="ghost"
              size="icon"
              className="text-warning hover:text-warning h-11 w-11 md:h-8 md:w-8"
              onClick={onCancel}
              aria-label={`${t('cancelReceivable')} ${receivable.payer}`}
            >
              <Ban size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-11 w-11 md:h-8 md:w-8"
            onClick={onDelete}
            aria-label={`${tCommon('actions.delete')} ${receivable.payer}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {progress.shown ? (
        <div
          className="bg-muted mt-3 h-3 w-full overflow-hidden rounded-full"
          role="progressbar"
          aria-label={`${t('card.progressLabel')}: ${progress.percent}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          data-testid="receivable-progress"
        >
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress.percent}%`,
              backgroundColor: progressColor(progress.percent),
            }}
          />
        </div>
      ) : null}

      <p data-receivable-amount="" className="mt-3 text-lg font-semibold break-words tabular-nums">
        {formatMoney(receivable.amount, receivable.currency)}
      </p>
      {!isCancelled ? (
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline justify-between gap-2 text-xs">
          <p className="text-muted-foreground min-w-0 break-words">
            <span className="text-foreground font-medium tabular-nums">
              {formatMoney(receivable.received_amount, receivable.currency)}
            </span>{' '}
            {t('card.of')} {formatMoney(receivable.amount, receivable.currency)}
          </p>
          {receivable.remainingAmount > 0 ? (
            <p className="text-muted-foreground min-w-0 break-words tabular-nums">
              {formatMoney(receivable.remainingAmount, receivable.currency)} {t('card.remaining')}
            </p>
          ) : null}
        </div>
      ) : null}
      {receivable.accountName || receivable.invoice_reference || receivable.project_reference ? (
        <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
          {receivable.accountName ? (
            <span className="border-border max-w-full rounded-full border px-2 py-0.5 text-xs break-words">
              {receivable.accountName}
            </span>
          ) : null}
          {receivable.invoice_reference ? (
            <span className="border-border rounded-full border px-2 py-0.5 text-xs uppercase tabular-nums">
              {receivable.invoice_reference}
            </span>
          ) : null}
          {receivable.project_reference ? (
            <span className="border-border max-w-full rounded-full border px-2 py-0.5 text-xs break-words">
              {receivable.project_reference}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

interface ReceivableFormProps {
  receivable?: ReceivableWithDetails
  onSubmit: (data: ReceivableFormValues) => void
  isLoading?: boolean
  onDirtyChange?: (isDirty: boolean) => void
}

function ReceivableForm({ receivable, onSubmit, isLoading, onDirtyChange }: ReceivableFormProps) {
  const { t } = useTranslation('receivables')
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
  } = useForm<ReceivableFormValues>({
    resolver: zodResolver(receivableSchema),
    defaultValues: {
      payer: receivable?.payer ?? '',
      amount: receivable ? fromCentavos(receivable.amount) : 0,
      currency: receivable?.currency ?? 'USD',
      dueDate: receivable?.due_date ?? dayjs().format('YYYY-MM-DD'),
      accountId: receivable?.account_id ?? '',
      projectReference: receivable?.project_reference ?? '',
      invoiceReference: receivable?.invoice_reference ?? '',
      notes: receivable?.notes ?? '',
    },
  })

  // eslint-disable-next-line react-hooks/incompatible-library -- react-hook-form watch
  const accountValue = watch('accountId')
  const currencyValue = watch('currency')
  const isAccountSelectDisabled = accountsLoading || !!accountsFetchError
  const isMatched = Boolean(receivable?.matched_transaction_id)

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const handleFormSubmit = (data: ReceivableFormValues) => onSubmit(data)

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <ErrorBanner title={t('form.accountsError')} message={accountsFetchError} />
      {isMatched && (
        <p className="text-muted-foreground border-border bg-muted/40 rounded-lg border px-3 py-2 text-xs">
          {t('form.matchedNote')}
        </p>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="receivable-payer">{t('form.payer')}</Label>
        <Input
          id="receivable-payer"
          placeholder={t('form.payerPlaceholder')}
          autoFocus
          aria-invalid={!!errors.payer}
          aria-describedby={errors.payer ? 'receivable-payer-error' : undefined}
          {...register('payer')}
        />
        {errors.payer && (
          <p id="receivable-payer-error" className="text-destructive text-xs" role="alert">
            {errors.payer.message}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="receivable-amount">{t('form.amount')}</Label>
          <Input
            id="receivable-amount"
            type="number"
            step="0.01"
            min="0"
            aria-invalid={!!errors.amount}
            aria-describedby={errors.amount ? 'receivable-amount-error' : undefined}
            {...register('amount', { valueAsNumber: true })}
          />
          {errors.amount && (
            <p id="receivable-amount-error" className="text-destructive text-xs" role="alert">
              {errors.amount.message}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="receivable-currency">{t('form.currency')}</Label>
          <Select value={currencyValue} onValueChange={(val) => setValue('currency', val)}>
            <SelectTrigger id="receivable-currency">
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
          <Label htmlFor="receivable-due-date">{t('form.dueDate')}</Label>
          <Input
            id="receivable-due-date"
            type="date"
            aria-invalid={!!errors.dueDate}
            aria-describedby={errors.dueDate ? 'receivable-due-date-error' : undefined}
            {...register('dueDate')}
          />
          {errors.dueDate && (
            <p id="receivable-due-date-error" className="text-destructive text-xs" role="alert">
              {errors.dueDate.message}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="receivable-account">{t('form.account')}</Label>
        <Select
          value={accountValue || ''}
          onValueChange={(val) => {
            const accountId = val === '__none__' ? '' : val
            setValue('accountId', accountId, { shouldDirty: true })
            const selectedAccount = accounts.find((item) => item.id === accountId)
            if (selectedAccount) {
              setValue('currency', selectedAccount.currency, { shouldDirty: true })
            }
          }}
          disabled={isAccountSelectDisabled}
        >
          <SelectTrigger id="receivable-account">
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
          <Label htmlFor="receivable-project">{t('form.projectReference')}</Label>
          <Input
            id="receivable-project"
            placeholder={t('form.projectPlaceholder')}
            {...register('projectReference')}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="receivable-invoice">{t('form.invoiceReference')}</Label>
          <Input
            id="receivable-invoice"
            placeholder={t('form.invoicePlaceholder')}
            {...register('invoiceReference')}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="receivable-notes">{t('form.notes')}</Label>
        <Input
          id="receivable-notes"
          placeholder={t('form.notesPlaceholder')}
          {...register('notes')}
        />
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

export function Receivables() {
  const { t } = useTranslation('receivables')
  const { t: tCommon } = useTranslation('common')
  const { receivables, isLoading, fetchError, fetch, create, update, cancel, remove, getById } =
    useReceivableStore()
  const convertToPreferred = useCurrencyStore((s) => s.convertCurrentToPreferred)
  const preferredCurrency = useCurrencyStore((s) => s.preferredCurrency)
  const mainCurrency = useCurrencyStore((s) => s.mainCurrency)
  const manualRates = useCurrencyStore((s) => s.manualRates)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [cancelId, setCancelId] = useState<string | null>(null)
  const [isActionLoading, setIsActionLoading] = useState(false)

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [visibleCount, setVisibleCount] = useState(RECEIVABLES_PAGE_SIZE)

  const hasInitialLoadError = !!fetchError && receivables.length === 0

  const summary = useMemo(() => {
    // Currency actions are stable Zustand methods that read current store authority.
    void manualRates
    return buildReceivablesStatusTotals({
      receivables,
      convertToPreferred,
      preferredCurrency,
      mainCurrency,
    })
  }, [receivables, convertToPreferred, preferredCurrency, mainCurrency, manualRates])

  const filterCounts = useMemo(() => {
    return {
      all: receivables.length,
      open: receivables.filter((r) => r.status === 'open').length,
      partial: receivables.filter((r) => r.status === 'partial').length,
      received: receivables.filter((r) => r.status === 'received').length,
      cancelled: receivables.filter((r) => r.status === 'cancelled').length,
      overdue: receivables.filter((r) => r.isOverdue).length,
    }
  }, [receivables])

  const filteredReceivables = useMemo(() => {
    switch (statusFilter) {
      case 'all':
        return receivables
      case 'overdue':
        return receivables.filter((r) => r.isOverdue)
      default:
        return receivables.filter((r) => r.status === statusFilter)
    }
  }, [receivables, statusFilter])

  const visibleReceivables = filteredReceivables.slice(0, visibleCount)

  const filterOptions = useMemo(
    () => [
      { label: t('filters.all'), value: 'all', count: filterCounts.all },
      { label: t('filters.open'), value: 'open', count: filterCounts.open },
      { label: t('filters.partial'), value: 'partial', count: filterCounts.partial },
      { label: t('filters.received'), value: 'received', count: filterCounts.received },
      { label: t('filters.overdue'), value: 'overdue', count: filterCounts.overdue },
      { label: t('filters.cancelled'), value: 'cancelled', count: filterCounts.cancelled },
    ],
    [t, filterCounts]
  )

  const openCreateDialog = () => {
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEditDialog = (id: string) => {
    setEditingId(id)
    setDialogOpen(true)
  }

  const handleDialogClose = () => {
    if (isSubmitting) return
    if (isDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    setDialogOpen(false)
    setEditingId(null)
  }

  const handleSubmit = async (data: ReceivableFormValues) => {
    setIsSubmitting(true)
    try {
      const formData = {
        payer: data.payer,
        amount: data.amount,
        currency: data.currency,
        dueDate: data.dueDate,
        projectReference: data.projectReference || null,
        invoiceReference: data.invoiceReference || null,
        accountId: data.accountId || null,
        notes: data.notes || null,
      }

      if (editingId) {
        await update(editingId, formData)
        toast.success(t('toast.updated'))
      } else {
        await create(formData)
        toast.success(t('toast.created'))
      }
      setDialogOpen(false)
      setEditingId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancel = async () => {
    if (!cancelId) return
    setIsActionLoading(true)
    try {
      await cancel(cancelId)
      toast.success(t('toast.cancelled'))
      setCancelId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setIsActionLoading(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsActionLoading(false)
    }
  }

  useEffect(() => {
    void fetch().catch(() => {})
  }, [fetch])

  const editingReceivable = editingId ? getById(editingId) : undefined

  return (
    <div className="page-content">
      <PageToolbar
        leading={
          receivables.length > 0 ? (
            <FilterPills
              options={filterOptions}
              selected={statusFilter}
              onChange={(val) => {
                setStatusFilter(val as StatusFilter)
                setVisibleCount(RECEIVABLES_PAGE_SIZE)
              }}
              ariaLabel={t('filters.label')}
              className="flex-wrap"
            />
          ) : null
        }
        actions={
          <Button onClick={openCreateDialog}>
            <Plus size={16} />
            {t('addReceivable')}
          </Button>
        }
      />

      <ErrorBanner
        title={t('error.load')}
        message={!hasInitialLoadError ? fetchError : null}
        onRetry={() => {
          void fetch().catch(() => {})
        }}
      />

      {isLoading ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">{tCommon('status.loading')}</span>
          <div className="metric-strip">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="metric-item space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <NativePanel key={i} className="space-y-4 p-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-2 w-full" />
              </NativePanel>
            ))}
          </div>
        </div>
      ) : hasInitialLoadError ? (
        <ErrorState
          title={t('error.loadDetailed')}
          description={fetchError}
          onRetry={() => {
            void fetch().catch(() => {})
          }}
        />
      ) : receivables.length === 0 ? (
        <NativePanel className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-xl">
            <Wallet size={28} className="text-primary" />
          </div>
          <h2 className="mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={openCreateDialog}>
            <Plus size={16} />
            {t('addReceivable')}
          </Button>
        </NativePanel>
      ) : (
        <div className="space-y-4">
          {summary.conversionIssue ? (
            <div
              className="border-warning/30 bg-warning/10 text-warning rounded-lg border px-4 py-3 text-sm"
              role="alert"
            >
              <p className="font-semibold">{t('currency.unavailable')}</p>
              <p className="text-muted-foreground mt-1">
                {summary.conversionIssue.reason === 'main_currency_unconfigured'
                  ? t('currency.setupRequired')
                  : summary.conversionIssue.reason === 'invalid_currency_data'
                    ? t('currency.invalidData')
                    : t('currency.missingRates', {
                        currencies: summary.conversionIssue.missingCurrencies.join(', '),
                      })}
              </p>
              {summary.groupedOutstanding.length > 0 && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('currency.grouped')}:{' '}
                  {summary.groupedOutstanding
                    .map((group) => formatMoney(group.amountCentavos, group.currency))
                    .join(' · ')}
                </p>
              )}
            </div>
          ) : null}

          <div className="space-y-3">
            {visibleReceivables.length === 0 ? (
              <NativePanel className="flex items-center justify-center py-12 text-center">
                <p className="text-muted-foreground text-sm">{tCommon('status.empty')}</p>
              </NativePanel>
            ) : (
              visibleReceivables.map((receivable) => (
                <ReceivableRow
                  key={receivable.id}
                  receivable={receivable}
                  onEdit={() => openEditDialog(receivable.id)}
                  onCancel={() => setCancelId(receivable.id)}
                  onDelete={() => setDeleteId(receivable.id)}
                />
              ))
            )}
          </div>

          <ShowMorePagination
            shown={visibleReceivables.length}
            total={filteredReceivables.length}
            summaryLabel={tCommon('pagination.summary', {
              shown: visibleReceivables.length,
              total: filteredReceivables.length,
            })}
            showMoreLabel={tCommon('pagination.showMore', {
              count: Math.min(
                RECEIVABLES_PAGE_SIZE,
                filteredReceivables.length - visibleReceivables.length
              ),
            })}
            onShowMore={() => setVisibleCount((count) => count + RECEIVABLES_PAGE_SIZE)}
          />

          <MetricStrip>
            <MetricItem
              label={t('summary.outstanding')}
              value={formatConverted(summary.outstanding)}
              detail={
                summary.outstanding.complete
                  ? summary.outstanding.preferredCurrency
                  : t('currency.unavailable')
              }
            />
            <MetricItem
              label={t('summary.overdue')}
              value={<span className="text-warning">{formatConverted(summary.overdue)}</span>}
            />
            <MetricItem
              label={t('summary.received')}
              value={<span className="text-success">{formatConverted(summary.received)}</span>}
            />
          </MetricStrip>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => !open && handleDialogClose()}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? t('editReceivable') : t('addReceivable')}</DialogTitle>
            <DialogDescription>
              {editingId ? t('dialog.editDescription') : t('dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <ReceivableForm
            key={editingId || 'new'}
            receivable={editingReceivable}
            onSubmit={handleSubmit}
            isLoading={isSubmitting}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>

      <Suspense fallback={null}>
        <ConfirmDialog
          open={confirmDiscardOpen}
          onOpenChange={setConfirmDiscardOpen}
          title={t('discard.title')}
          description={t('discard.description')}
          confirmLabel={t('discard.confirm')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          onConfirm={() => {
            setConfirmDiscardOpen(false)
            setDialogOpen(false)
            setEditingId(null)
          }}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!cancelId}
          onOpenChange={(open) => !open && setCancelId(null)}
          title={t('cancelReceivable')}
          description={t('cancelConfirm')}
          confirmLabel={t('cancelReceivable')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isActionLoading}
          onConfirm={handleCancel}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteReceivable')}
          description={t('deleteConfirm')}
          confirmLabel={t('deleteReceivable')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isActionLoading}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}
