import { useEffect, useState, useMemo, lazy, Suspense, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  Plus,
  Pencil,
  Trash2,
  Search,
  Filter,
  Download,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isYesterday from 'dayjs/plugin/isYesterday'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { useAccountStore } from '@/stores/account-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import type { TransactionType } from '@/types/common'
import { formatMoney, fromCentavos } from '@/lib/money'
import { cn } from '@/lib/utils'

dayjs.extend(isToday)
dayjs.extend(isYesterday)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

type TypeFilter = 'all' | 'expense' | 'income' | 'transfer'

interface CsvRecord {
  [key: string]: string
}

function formatDateHeader(date: string, todayLabel: string, yesterdayLabel: string): string {
  const d = dayjs(date)
  if (d.isToday()) return todayLabel
  if (d.isYesterday()) return yesterdayLabel
  return d.format('ddd, MMM D')
}

function parseCsv(text: string): CsvRecord[] {
  const rows: string[][] = []
  let current = ''
  let row: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(current.trim())
      current = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++
      row.push(current.trim())
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      current = ''
      continue
    }

    current += char
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current.trim())
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }

  if (rows.length < 2) return []

  const headers = rows[0].map((h) => h.toLowerCase().trim())
  return rows.slice(1).map((values) => {
    const record: CsvRecord = {}
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]] = values[i] ?? ''
    }
    return record
  })
}

function resolveColumn(record: CsvRecord, aliases: string[]): string {
  for (const key of aliases) {
    if (record[key] !== undefined) return record[key]
  }
  return ''
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog } = useUIStore()
  const { transactions, isLoading, fetch, remove, add } = useTransactionStore()
  const { accounts, fetch: fetchAccounts } = useAccountStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch()
  }, [fetch])

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

  const handleExportCsv = () => {
    if (filteredTransactions.length === 0) {
      toast.error('No transactions to export')
      return
    }

    const headers = [
      'date',
      'type',
      'amount',
      'currency',
      'description',
      'account',
      'to_account',
      'category',
      'notes',
    ]

    const lines = filteredTransactions.map((tx) => {
      const decimalAmount = fromCentavos(tx.amount)
      const amount = tx.type === 'expense' ? `-${decimalAmount}` : `${decimalAmount}`
      return [
        tx.date,
        tx.type,
        amount,
        tx.currency,
        tx.description,
        tx.account_name || '',
        tx.transfer_to_account_name || '',
        tx.category_name || '',
        tx.notes || '',
      ]
        .map((v) => csvEscape(v))
        .join(',')
    })

    const content = [headers.join(','), ...lines].join('\n')
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const stamp = dayjs().format('YYYYMMDD-HHmm')
    a.href = url
    a.download = `valute-transactions-${stamp}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV exported')
  }

  const handleImportCsv = async (file: File) => {
    if (accounts.length === 0) {
      await fetchAccounts()
    }

    const allAccounts = useAccountStore.getState().accounts

    if (allAccounts.length === 0) {
      toast.error('Create an account before importing transactions')
      return
    }

    setIsImporting(true)
    try {
      const text = await file.text()
      const rows = parseCsv(text)

      if (rows.length === 0) {
        toast.error('CSV is empty or invalid')
        return
      }

      const accountByName = new Map(allAccounts.map((a) => [a.name.toLowerCase(), a]))
      const defaultAccount = allAccounts[0]
      let imported = 0
      let skipped = 0

      for (const row of rows) {
        const date =
          resolveColumn(row, ['date', 'transaction date', 'posted date']) ||
          dayjs().format('YYYY-MM-DD')
        const description = resolveColumn(row, ['description', 'memo', 'details', 'name'])
        const rawAmount = resolveColumn(row, ['amount', 'value', 'total'])
        const explicitType = resolveColumn(row, ['type', 'transaction type']).toLowerCase()
        const accountName = resolveColumn(row, ['account', 'account name']).toLowerCase()
        const toAccountName = resolveColumn(row, ['to_account', 'to account']).toLowerCase()
        const notes = resolveColumn(row, ['notes', 'note']) || null
        const currency = (resolveColumn(row, ['currency']) || defaultAccount.currency).toUpperCase()

        const parsedAmount = Number(rawAmount)
        if (!description || Number.isNaN(parsedAmount) || parsedAmount === 0) {
          skipped++
          continue
        }

        const inferredType: TransactionType =
          explicitType === 'income' || explicitType === 'expense' || explicitType === 'transfer'
            ? explicitType
            : parsedAmount < 0
              ? 'expense'
              : 'income'

        const account = accountByName.get(accountName) || defaultAccount
        const transferTo =
          inferredType === 'transfer' ? accountByName.get(toAccountName) || null : null

        if (inferredType === 'transfer' && !transferTo) {
          skipped++
          continue
        }

        await add(
          {
            amount: Math.abs(parsedAmount),
            type: inferredType,
            description,
            categoryId: null,
            accountId: account.id,
            transferToAccountId: transferTo?.id ?? null,
            currency: currency as TransactionWithDetails['currency'],
            date,
            notes,
          },
          { skipRefresh: true }
        )
        imported++
      }

      await fetch()
      await fetchAccounts()

      if (imported === 0) {
        toast.error('No valid rows imported')
      } else if (skipped > 0) {
        toast.success(`Imported ${imported} rows, skipped ${skipped}`)
      } else {
        toast.success(`Imported ${imported} rows`)
      }
    } catch {
      toast.error('Failed to import CSV')
    } finally {
      setIsImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            <Download size={14} />
            {tCommon('actions.export')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isImporting}
          >
            <Upload size={14} />
            {isImporting ? 'Importing...' : tCommon('actions.import')}
          </Button>
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                void handleImportCsv(file)
              }
            }}
          />
        </div>
      </div>

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
                {type === 'all' ? t('types.all') : t(`types.${type}`)}
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
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
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
                {formatDateHeader(date, t('dateHeaders.today'), t('dateHeaders.yesterday'))}
              </h2>
              <div className="space-y-1">
                {txns.map((tx) => (
                  <TransactionRow
                    key={tx.id}
                    transaction={tx}
                    onEdit={() => openTransactionDialog(tx.id)}
                    onDelete={() => setDeleteId(tx.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
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
      </Suspense>
    </div>
  )
}

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

function TransactionRow({
  transaction: tx,
  onEdit,
  onDelete,
}: {
  transaction: TransactionWithDetails
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="glass-card group flex items-center gap-3 px-4 py-2.5">
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
          {tx.type === 'transfer' && tx.transfer_to_account_name && (
            <span className="text-primary">to {tx.transfer_to_account_name}</span>
          )}
          {tx.account_name && (
            <Badge variant="secondary" className="text-[10px]">
              {tx.account_name}
            </Badge>
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
          <span className="sr-only">Edit transaction</span>
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive h-7 w-7"
          onClick={onDelete}
        >
          <span className="sr-only">Delete transaction</span>
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  )
}
