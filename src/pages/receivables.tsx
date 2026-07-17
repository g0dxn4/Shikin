import { useEffect, useMemo, useState, lazy, Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Wallet, Plus, Pencil, Ban, Trash2, AlertCircle, CheckCircle2, Clock } from 'lucide-react'
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
import { useReceivableStore, type ReceivableWithDetails } from '@/stores/receivable-store'
import { useAccountStore } from '@/stores/account-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { SUPPORTED_CURRENCIES } from '@/lib/constants'
import dayjs from 'dayjs'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

const RECEIVABLES_PAGE_SIZE = 20

type StatusFilter = 'all' | 'open' | 'partial' | 'received' | 'cancelled' | 'overdue'

type ReceivableDueTextKey = 'card.cancelled' | 'card.overdue' | 'card.dueToday' | 'card.due'

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

function statusBadgeClass(status: ReceivableWithDetails['status']): string {
  switch (status) {
    case 'open':
      return 'border-white/10 bg-white/5 text-white/70'
    case 'partial':
      return 'border-warning/30 bg-warning/10 text-warning'
    case 'received':
      return 'border-success/30 bg-success/10 text-success'
    case 'cancelled':
      return 'border-white/10 bg-white/[0.02] text-white/30 line-through'
  }
}

function getDueText(
  receivable: ReceivableWithDetails,
  t: (key: ReceivableDueTextKey) => string
): string {
  if (receivable.status === 'cancelled') return t('card.cancelled')
  const due = dayjs(receivable.due_date)
  const today = dayjs()
  const diff = due.diff(today, 'day')
  if (diff < 0) return t('card.overdue')
  if (diff === 0) return t('card.dueToday')
  return `${t('card.due')} ${receivable.due_date}`
}

function getProgressColor(percent: number): string {
  if (percent >= 100) return '#34D399'
  if (percent >= 50) return '#F59E0B'
  return '#7C5CFF'
}

// ── Summary Metrics ──────────────────────────────────────────────────────────

function SummaryMetrics({
  outstanding,
  overdue,
  received,
}: {
  outstanding: number
  overdue: number
  received: number
}) {
  const { t } = useTranslation('receivables')

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="liquid-hero p-4">
        <div className="bg-accent/10 mb-2 flex h-8 w-8 items-center justify-center rounded-lg">
          <Wallet size={16} className="text-accent" />
        </div>
        <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
          {t('summary.outstanding')}
        </p>
        <p className="font-heading mt-1 text-xl font-bold">{formatMoney(outstanding)}</p>
      </div>
      <div className="liquid-card p-4">
        <div className="bg-warning/10 mb-2 flex h-8 w-8 items-center justify-center rounded-lg">
          <AlertCircle size={16} className="text-warning" />
        </div>
        <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
          {t('summary.overdue')}
        </p>
        <p className="font-heading text-warning mt-1 text-xl font-bold">{formatMoney(overdue)}</p>
      </div>
      <div className="liquid-card p-4">
        <div className="bg-success/10 mb-2 flex h-8 w-8 items-center justify-center rounded-lg">
          <CheckCircle2 size={16} className="text-success" />
        </div>
        <p className="text-xs font-medium tracking-wider text-white/40 uppercase">
          {t('summary.received')}
        </p>
        <p className="font-heading text-success mt-1 text-xl font-bold">{formatMoney(received)}</p>
      </div>
    </div>
  )
}

// ── Receivable Row ───────────────────────────────────────────────────────────

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
  const progress =
    receivable.amount > 0
      ? Math.min(100, Math.round((receivable.received_amount / receivable.amount) * 100))
      : 0

  return (
    <div
      className={`group rounded-[24px] border border-white/[0.06] bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05] ${
        receivable.isOverdue ? 'border-warning/20' : ''
      } ${isCancelled ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="bg-accent/10 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
            <Wallet size={18} className="text-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="font-heading truncate text-base font-semibold">{receivable.payer}</h3>
              <Badge
                variant="secondary"
                className={`shrink-0 text-[10px] ${statusBadgeClass(receivable.status)}`}
              >
                {t(`filters.${receivable.status}`)}
              </Badge>
            </div>
            <p className="mt-0.5 font-mono text-lg font-bold">
              {formatMoney(receivable.amount, receivable.currency)}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
              <span
                className={`flex items-center gap-1 ${receivable.isOverdue ? 'text-warning' : ''}`}
              >
                <Clock size={11} />
                {getDueText(receivable, t)}
              </span>
              {receivable.accountName && <span className="truncate">{receivable.accountName}</span>}
              {receivable.invoice_reference && (
                <span className="font-mono tracking-wider uppercase">
                  {receivable.invoice_reference}
                </span>
              )}
              {receivable.project_reference && <span>{receivable.project_reference}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 gap-1 opacity-100 transition-opacity motion-reduce:transition-none md:opacity-50 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            aria-label={`${tCommon('actions.edit')} ${receivable.payer}`}
          >
            <Pencil size={12} />
          </Button>
          {!isCancelled && (
            <Button
              variant="ghost"
              size="icon"
              className="text-warning hover:text-warning h-8 w-8"
              onClick={onCancel}
              aria-label={`${t('cancelReceivable')} ${receivable.payer}`}
            >
              <Ban size={12} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-8 w-8"
            onClick={onDelete}
            aria-label={`${tCommon('actions.delete')} ${receivable.payer}`}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {!isCancelled && (
        <>
          <div
            className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/5"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${t('card.progressLabel')}: ${progress}%`}
          >
            <div
              className="h-full rounded-full transition-all duration-500 motion-reduce:transition-none"
              style={{ width: `${progress}%`, backgroundColor: getProgressColor(progress) }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-white/40">
              <span className="text-foreground font-medium">
                {formatMoney(receivable.received_amount, receivable.currency)}
              </span>{' '}
              {t('card.of')} {formatMoney(receivable.amount, receivable.currency)}
            </p>
            {receivable.remainingAmount > 0 && (
              <p className="font-mono text-[10px] tracking-wider text-white/40 uppercase">
                {formatMoney(receivable.remainingAmount, receivable.currency)} {t('card.remaining')}
              </p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── Receivable Form ──────────────────────────────────────────────────────────

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

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  const handleFormSubmit = (data: ReceivableFormValues) => onSubmit(data)

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5">
      <ErrorBanner title={t('form.accountsError')} message={accountsFetchError} />

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

// ── Main Page ────────────────────────────────────────────────────────────────

export function Receivables() {
  const { t } = useTranslation('receivables')
  const { t: tCommon } = useTranslation('common')
  const { receivables, isLoading, fetchError, fetch, create, update, cancel, remove, getById } =
    useReceivableStore()

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
    const active = receivables.filter((r) => r.status !== 'cancelled')
    const outstanding = active.reduce((sum, r) => sum + r.remainingAmount, 0)
    const overdue = active.filter((r) => r.isOverdue).reduce((sum, r) => sum + r.remainingAmount, 0)
    const received = active.reduce((sum, r) => sum + r.received_amount, 0)
    return { outstanding, overdue, received }
  }, [receivables])

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
    <div className="animate-fade-in-up page-content">
      <div className="liquid-card page-header min-h-[72px] p-3 sm:p-4">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-tight md:text-[28px]">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm font-medium">{t('subtitle')}</p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus size={16} />
          {t('addReceivable')}
        </Button>
      </div>

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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="liquid-card space-y-3 p-4">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="liquid-card space-y-4 p-4">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-2 w-full" />
              </div>
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
        <div className="liquid-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Wallet size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={openCreateDialog}>
            <Plus size={16} />
            {t('addReceivable')}
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          <SummaryMetrics
            outstanding={summary.outstanding}
            overdue={summary.overdue}
            received={summary.received}
          />

          <FilterPills
            options={filterOptions}
            selected={statusFilter}
            onChange={(val) => {
              setStatusFilter(val as StatusFilter)
              setVisibleCount(RECEIVABLES_PAGE_SIZE)
            }}
            ariaLabel={t('filters.label')}
          />

          <div className="space-y-3">
            {visibleReceivables.length === 0 ? (
              <div className="liquid-card flex items-center justify-center py-12 text-center">
                <p className="text-muted-foreground text-sm">{tCommon('status.empty')}</p>
              </div>
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
        </div>
      )}

      {/* Create / Edit Dialog */}
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

      {/* Discard confirmation */}
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

      {/* Cancel confirmation */}
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

      {/* Delete confirmation */}
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
