import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  Repeat,
  Pause,
  Play,
  Split,
  ChevronDown,
} from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isYesterday from 'dayjs/plugin/isYesterday'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useRecurringStore } from '@/stores/recurring-store'
import type { RecurringRuleWithDetails } from '@/stores/recurring-store'
import { useAccountStore } from '@/stores/account-store'
import { useCategoryStore } from '@/stores/category-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney, fromCentavos } from '@/lib/money'
import { cn } from '@/lib/utils'
import type { TransactionSplitWithCategory } from '@/types/database'

dayjs.extend(isToday)
dayjs.extend(isYesterday)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'
type Tab = 'transactions' | 'recurring'

const FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'] as const
const TRANSACTION_TYPES = ['expense', 'income', 'transfer'] as const

function formatDateHeader(date: string): string {
  const d = dayjs(date)
  if (d.isToday()) return 'Today'
  if (d.isYesterday()) return 'Yesterday'
  return d.format('ddd, MMM D')
}

// --- Recurring Rule Form Schema ---

const recurringFormSchema = z.object({
  description: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(TRANSACTION_TYPES),
  frequency: z.enum(FREQUENCIES),
  nextDate: z.string().min(1),
  endDate: z.string().nullable(),
  accountId: z.string().min(1),
  categoryId: z.string().nullable(),
  notes: z.string().nullable(),
})

type RecurringFormValues = z.infer<typeof recurringFormSchema>

export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog, recurringDialogOpen, editingRecurringId, openRecurringDialog, closeRecurringDialog } =
    useUIStore()
  const { transactions, isLoading, fetch, remove, isSplit } = useTransactionStore()
  const {
    rules,
    isLoading: isLoadingRules,
    fetch: fetchRules,
    create: createRule,
    update: updateRule,
    remove: removeRule,
    toggleActive,
    getById: getRecurringById,
  } = useRecurringStore()

  const [activeTab, setActiveTab] = useState<Tab>('transactions')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  // Recurring delete state
  const [deleteRuleId, setDeleteRuleId] = useState<string | null>(null)
  const [isDeletingRule, setIsDeletingRule] = useState(false)

  useEffect(() => {
    fetch()
    fetchRules()
  }, [fetch, fetchRules])

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (typeFilter !== 'all' && tx.type !== typeFilter) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        return (
          tx.description.toLowerCase().includes(q) ||
          tx.category_name?.toLowerCase().includes(q) ||
          tx.account_name?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [transactions, typeFilter, searchQuery])

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, TransactionWithDetails[]>()
    for (const tx of filteredTransactions) {
      const date = tx.date
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(tx)
    }
    return groups
  }, [filteredTransactions])

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteRule = async () => {
    if (!deleteRuleId) return
    setIsDeletingRule(true)
    try {
      await removeRule(deleteRuleId)
      toast.success(t('recurring.toast.deleted'))
      setDeleteRuleId(null)
    } catch {
      toast.error(t('recurring.toast.error'))
    } finally {
      setIsDeletingRule(false)
    }
  }

  const handleToggleActive = async (id: string) => {
    try {
      await toggleActive(id)
      toast.success(t('recurring.toast.toggled'))
    } catch {
      toast.error(t('recurring.toast.error'))
    }
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <div className="flex gap-2">
          {activeTab === 'transactions' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={cn(showFilters && 'bg-accent/10 text-accent')}
              >
                <Filter size={14} />
                {tCommon('actions.filter')}
              </Button>
              <Button onClick={() => openTransactionDialog()}>
                <Plus size={16} />
                {t('addTransaction')}
              </Button>
            </>
          )}
          {activeTab === 'recurring' && (
            <Button onClick={() => openRecurringDialog()}>
              <Plus size={16} />
              {t('recurring.addRule')}
            </Button>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="mb-4 flex gap-1 border-b border-white/[0.06]">
        {(['transactions', 'recurring'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'relative px-4 py-2.5 font-mono text-xs tracking-wider transition-colors',
              activeTab === tab
                ? 'text-accent'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span className="flex items-center gap-2">
              {tab === 'recurring' && <Repeat size={12} />}
              {t(`tabs.${tab}`)}
              {tab === 'recurring' && rules.length > 0 && (
                <Badge variant="secondary" className="text-[10px]">
                  {rules.length}
                </Badge>
              )}
            </span>
            {activeTab === tab && (
              <span className="bg-accent absolute bottom-0 left-0 h-0.5 w-full" />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'transactions' && (
        <>
          {/* Filter bar */}
          {showFilters && (
            <div className="glass-card animate-slide-up flex flex-wrap items-center gap-3 p-3">
              <div className="relative flex-1">
                <Search
                  size={14}
                  className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
                />
                <Input
                  placeholder={`${tCommon('actions.search')}...`}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex gap-1">
                {(['all', 'expense', 'income', 'transfer'] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setTypeFilter(type)}
                    className={cn(
                      'rounded-full px-3 py-1 font-mono text-[11px] transition-colors',
                      typeFilter === type
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-surface-elevated hover:text-foreground'
                    )}
                  >
                    {type === 'all' ? 'All' : t(`types.${type}`)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isLoading ? (
            <TransactionsSkeleton />
          ) : transactions.length === 0 ? (
            <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
                <ArrowLeftRight size={28} className="text-primary" />
              </div>
              <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
              <p className="text-muted-foreground mb-4 max-w-sm text-sm">
                {t('empty.description')}
              </p>
              <Button onClick={() => openTransactionDialog()}>
                <Plus size={16} />
                {t('addTransaction')}
              </Button>
            </div>
          ) : filteredTransactions.length === 0 ? (
            <div className="glass-card flex flex-col items-center justify-center py-12 text-center">
              <Search size={24} className="text-muted-foreground mb-3" />
              <p className="text-muted-foreground text-sm">No matching transactions</p>
            </div>
          ) : (
            <div className="space-y-5">
              {Array.from(groupedByDate.entries()).map(([date, txns]) => (
                <div key={date}>
                  <h2 className="text-muted-foreground mb-2 font-mono text-xs tracking-wider uppercase">
                    {formatDateHeader(date)}
                  </h2>
                  <div className="space-y-1">
                    {txns.map((tx) => (
                      <TransactionRow
                        key={tx.id}
                        transaction={tx}
                        hasSplits={isSplit(tx.id)}
                        onEdit={() => openTransactionDialog(tx.id)}
                        onDelete={() => setDeleteId(tx.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'recurring' && (
        <>
          {isLoadingRules ? (
            <RecurringSkeleton />
          ) : rules.length === 0 ? (
            <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
                <Repeat size={28} className="text-primary" />
              </div>
              <h2 className="font-heading mb-2 text-lg font-semibold">
                {t('recurring.empty.title')}
              </h2>
              <p className="text-muted-foreground mb-4 max-w-sm text-sm">
                {t('recurring.empty.description')}
              </p>
              <Button onClick={() => openRecurringDialog()}>
                <Plus size={16} />
                {t('recurring.addRule')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {rules.map((rule) => (
                <RecurringRuleCard
                  key={rule.id}
                  rule={rule}
                  onEdit={() => openRecurringDialog(rule.id)}
                  onDelete={() => setDeleteRuleId(rule.id)}
                  onToggle={() => handleToggleActive(rule.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Recurring rule dialog */}
      {recurringDialogOpen && (
        <RecurringRuleDialog
          open={recurringDialogOpen}
          ruleId={editingRecurringId}
          getById={getRecurringById}
          onClose={closeRecurringDialog}
          onCreate={createRule}
          onUpdate={updateRule}
        />
      )}

      <Suspense>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteTransaction')}
          description={t('deleteConfirm')}
          confirmLabel={tCommon('actions.delete')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
        <ConfirmDialog
          open={!!deleteRuleId}
          onOpenChange={(open) => !open && setDeleteRuleId(null)}
          title={t('recurring.deleteRule')}
          description={t('recurring.deleteConfirm')}
          confirmLabel={tCommon('actions.delete')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeletingRule}
          onConfirm={handleDeleteRule}
        />
      </Suspense>
    </div>
  )
}

// --- Recurring Rule Card ---

function RecurringRuleCard({
  rule,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: RecurringRuleWithDetails
  onEdit: () => void
  onDelete: () => void
  onToggle: () => void
}) {
  const { t } = useTranslation('transactions')
  const isActive = !!rule.active

  return (
    <div
      className={cn(
        'glass-card group flex items-center gap-3 px-4 py-3',
        !isActive && 'opacity-50'
      )}
    >
      {rule.category_color ? (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: rule.category_color }}
        />
      ) : (
        <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{rule.description}</p>
          <Badge
            variant="secondary"
            className="text-[10px]"
          >
            {t(`recurring.frequencies.${rule.frequency}`)}
          </Badge>
        </div>
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          {rule.category_name && <span>{rule.category_name}</span>}
          {rule.account_name && (
            <Badge variant="secondary" className="text-[10px]">
              {rule.account_name}
            </Badge>
          )}
          <span>
            {t('recurring.nextOccurrence')}: {dayjs(rule.next_date).format('MMM D, YYYY')}
          </span>
        </div>
      </div>

      <span
        className={cn(
          'font-heading text-sm font-semibold',
          rule.type === 'income' ? 'text-success' : 'text-destructive'
        )}
      >
        {rule.type === 'income' ? '+' : '-'}
        {formatMoney(rule.amount, 'USD')}
      </span>

      <Badge
        variant={isActive ? 'default' : 'secondary'}
        className={cn(
          'cursor-pointer text-[10px]',
          isActive ? 'bg-success/20 text-success' : ''
        )}
        onClick={onToggle}
      >
        {isActive ? (
          <span className="flex items-center gap-1">
            <Play size={8} />
            {t('recurring.active')}
          </span>
        ) : (
          <span className="flex items-center gap-1">
            <Pause size={8} />
            {t('recurring.paused')}
          </span>
        )}
      </Badge>

      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive h-7 w-7"
          onClick={onDelete}
        >
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}

// --- Recurring Rule Dialog ---

function RecurringRuleDialog({
  open,
  ruleId,
  getById,
  onClose,
  onCreate,
  onUpdate,
}: {
  open: boolean
  ruleId: string | null
  getById: (id: string) => RecurringRuleWithDetails | undefined
  onClose: () => void
  onCreate: (data: {
    description: string
    amount: number
    type: 'expense' | 'income' | 'transfer'
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
    nextDate: string
    endDate: string | null
    accountId: string
    toAccountId: string | null
    categoryId: string | null
    subcategoryId: string | null
    tags: string
    notes: string | null
  }) => Promise<void>
  onUpdate: (
    id: string,
    data: {
      description: string
      amount: number
      type: 'expense' | 'income' | 'transfer'
      frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
      nextDate: string
      endDate: string | null
      accountId: string
      toAccountId: string | null
      categoryId: string | null
      subcategoryId: string | null
      tags: string
      notes: string | null
    }
  ) => Promise<void>
}) {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { accounts, fetch: fetchAccounts } = useAccountStore()
  const { categories, fetch: fetchCategories } = useCategoryStore()
  const [isSubmitting, setIsSubmitting] = useState(false)

  const existing = ruleId ? getById(ruleId) : undefined
  const isEditing = !!existing

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
  } = useForm<RecurringFormValues>({
    resolver: zodResolver(recurringFormSchema),
    defaultValues: {
      description: existing?.description ?? '',
      amount: existing ? fromCentavos(existing.amount) : undefined,
      type: existing?.type ?? 'expense',
      frequency: existing?.frequency ?? 'monthly',
      nextDate: existing?.next_date ?? dayjs().format('YYYY-MM-DD'),
      endDate: existing?.end_date ?? null,
      accountId: existing?.account_id ?? '',
      categoryId: existing?.category_id ?? null,
      notes: existing?.notes ?? null,
    },
  })

  const typeValue = watch('type')
  const accountIdValue = watch('accountId')
  const categoryIdValue = watch('categoryId')
  const frequencyValue = watch('frequency')

  const filteredCategories = categories.filter((c) => c.type === typeValue)

  const onSubmit = async (data: RecurringFormValues) => {
    setIsSubmitting(true)
    try {
      const formData = {
        ...data,
        toAccountId: null,
        subcategoryId: null,
        tags: '',
      }

      if (isEditing && ruleId) {
        await onUpdate(ruleId, formData)
        toast.success(t('recurring.toast.updated'))
      } else {
        await onCreate(formData)
        toast.success(t('recurring.toast.created'))
      }
      onClose()
    } catch {
      toast.error(t('recurring.toast.error'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? t('recurring.editRule') : t('recurring.addRule')}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? t('recurring.editRule')
              : t('recurring.empty.description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
          <div className="space-y-1.5">
            <Label>{t('form.type')}</Label>
            <Select
              value={typeValue}
              onValueChange={(val) => {
                setValue('type', val as RecurringFormValues['type'])
                setValue('categoryId', null)
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
            <Label htmlFor="rec-amount">{t('recurring.form.amount')}</Label>
            <Input
              id="rec-amount"
              type="number"
              step="0.01"
              min="0.01"
              placeholder={t('form.amountPlaceholder')}
              className="font-heading text-2xl font-semibold"
              autoFocus
              {...register('amount', { valueAsNumber: true })}
            />
            {errors.amount && (
              <p className="text-destructive text-xs">{errors.amount.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rec-description">{t('recurring.form.description')}</Label>
            <Input
              id="rec-description"
              placeholder={t('recurring.form.descriptionPlaceholder')}
              {...register('description')}
            />
            {errors.description && (
              <p className="text-destructive text-xs">{errors.description.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('form.account')}</Label>
              <Select
                value={accountIdValue}
                onValueChange={(val) => setValue('accountId', val)}
              >
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

            <div className="space-y-1.5">
              <Label>{t('form.category')}</Label>
              <Select
                value={categoryIdValue ?? '__none__'}
                onValueChange={(val) =>
                  setValue('categoryId', val === '__none__' ? null : val)
                }
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
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t('recurring.form.frequency')}</Label>
              <Select
                value={frequencyValue}
                onValueChange={(val) =>
                  setValue('frequency', val as RecurringFormValues['frequency'])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map((freq) => (
                    <SelectItem key={freq} value={freq}>
                      {t(`recurring.frequencies.${freq}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-next-date">{t('recurring.form.nextDate')}</Label>
              <Input id="rec-next-date" type="date" {...register('nextDate')} />
              {errors.nextDate && (
                <p className="text-destructive text-xs">{errors.nextDate.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="rec-end-date">{t('recurring.form.endDate')}</Label>
              <Input
                id="rec-end-date"
                type="date"
                placeholder={t('recurring.form.endDatePlaceholder')}
                {...register('endDate')}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rec-notes">{t('form.notes')}</Label>
              <Input
                id="rec-notes"
                placeholder={t('form.notesPlaceholder')}
                {...register('notes')}
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? '...' : tCommon('actions.save')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Skeletons ---

function TransactionsSkeleton() {
  return (
    <div className="space-y-5">
      {Array.from({ length: 3 }).map((_, gi) => (
        <div key={gi}>
          <Skeleton className="mb-2 h-3 w-20" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="glass-card flex items-center gap-3 px-4 py-3">
                <Skeleton className="h-2.5 w-2.5 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="h-2.5 w-20" />
                </div>
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function RecurringSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="glass-card flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function TransactionRow({
  transaction: tx,
  hasSplits,
  onEdit,
  onDelete,
}: {
  transaction: TransactionWithDetails
  hasSplits: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('transactions')
  const { getSplits } = useTransactionStore()
  const [expanded, setExpanded] = useState(false)
  const [splits, setSplits] = useState<TransactionSplitWithCategory[]>([])
  const [loadingSplits, setLoadingSplits] = useState(false)

  const handleToggleSplits = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setLoadingSplits(true)
    try {
      const data = await getSplits(tx.id)
      setSplits(data)
      setExpanded(true)
    } finally {
      setLoadingSplits(false)
    }
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="group flex items-center gap-3 px-4 py-2.5">
        {tx.category_color ? (
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: tx.category_color }}
          />
        ) : (
          <span className="bg-muted-foreground/30 h-2.5 w-2.5 shrink-0 rounded-full" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{tx.description}</p>
          <div className="text-muted-foreground flex items-center gap-2 text-xs">
            {tx.category_name && <span>{tx.category_name}</span>}
            {tx.account_name && (
              <Badge variant="secondary" className="text-[10px]">
                {tx.account_name}
              </Badge>
            )}
            {hasSplits && (
              <button
                onClick={handleToggleSplits}
                className="text-accent/70 hover:text-accent inline-flex items-center gap-0.5 transition-colors"
              >
                <Split size={10} />
                <span className="font-mono text-[10px]">{t('split.badge')}</span>
                <ChevronDown
                  size={10}
                  className={cn('transition-transform', expanded && 'rotate-180')}
                />
              </button>
            )}
          </div>
        </div>
        <span
          className={`font-heading text-sm font-semibold ${
            tx.type === 'income' ? 'text-success' : 'text-destructive'
          }`}
        >
          {tx.type === 'income' ? '+' : '-'}
          {formatMoney(tx.amount, tx.currency)}
        </span>
        <span className="text-muted-foreground hidden font-mono text-[10px] sm:inline">
          {dayjs(tx.date).format('MMM D')}
        </span>
        <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
            <Pencil size={12} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive h-7 w-7"
            onClick={onDelete}
          >
            <Trash2 size={12} />
          </Button>
        </div>
      </div>

      {/* Split breakdown */}
      {expanded && (
        <div className="border-border/20 animate-slide-up border-t px-4 py-2">
          {loadingSplits ? (
            <div className="space-y-1">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          ) : (
            <div className="space-y-1">
              {splits.map((split) => (
                <div
                  key={split.id}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-1.5">
                    {split.category_color && (
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: split.category_color }}
                      />
                    )}
                    <span className="text-muted-foreground">{split.category_name}</span>
                    {split.notes && (
                      <span className="text-muted-foreground/60 truncate max-w-32">
                        — {split.notes}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground font-mono">
                    {formatMoney(split.amount, tx.currency)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
