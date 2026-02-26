import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import dayjs from 'dayjs'
import isToday from 'dayjs/plugin/isToday'
import isYesterday from 'dayjs/plugin/isYesterday'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { TransactionWithDetails } from '@/stores/transaction-store'
import { formatMoney } from '@/lib/money'

dayjs.extend(isToday)
dayjs.extend(isYesterday)

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

function formatDateHeader(date: string): string {
  const d = dayjs(date)
  if (d.isToday()) return 'Today'
  if (d.isYesterday()) return 'Yesterday'
  return d.format('ddd, MMM D')
}

export function Transactions() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const { openTransactionDialog } = useUIStore()
  const { transactions, isLoading, fetch, remove } = useTransactionStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    fetch()
  }, [fetch])

  const groupedByDate = useMemo(() => {
    const groups = new Map<string, TransactionWithDetails[]>()
    for (const tx of transactions) {
      const date = tx.date
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(tx)
    }
    return groups
  }, [transactions])

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

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openTransactionDialog()}>
          <Plus size={16} />
          {t('addTransaction')}
        </Button>
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center py-16">
          <p className="text-muted-foreground">{tCommon('status.loading')}</p>
        </div>
      ) : transactions.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <ArrowLeftRight size={32} className="text-muted-foreground mb-4" />
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openTransactionDialog()}>
            <Plus size={16} />
            {t('addTransaction')}
          </Button>
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
      {tx.category_color && (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: tx.category_color }}
        />
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
