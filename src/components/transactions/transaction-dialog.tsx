import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { TransactionForm, type TransactionFormValues, type SplitRowData } from './transaction-form'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { getSplits } from '@/lib/split-service'
import { toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { getTransactionById, type TransactionPageRow } from '@/lib/transaction-query'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

type EditLoadState = 'idle' | 'loading' | 'ready' | 'not-found' | 'error'

export function TransactionDialog() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const [editLoadState, setEditLoadState] = useState<EditLoadState>('idle')
  const [editLoadError, setEditLoadError] = useState<string | null>(null)
  const [loadedTransaction, setLoadedTransaction] = useState<TransactionPageRow | null>(null)
  const [loadedSplits, setLoadedSplits] = useState<SplitRowData[]>([])
  const lookupSequence = useRef(0)
  const { transactionDialogOpen, editingTransactionId, closeTransactionDialog } = useUIStore()
  const { add, addWithSplits, update, correctMetadata } = useTransactionStore()
  const isEditing = !!editingTransactionId

  const loadEditingTransaction = useCallback(async (id: string) => {
    const sequence = ++lookupSequence.current
    setEditLoadState('loading')
    setEditLoadError(null)
    setLoadedTransaction(null)
    setLoadedSplits([])
    try {
      const transaction = await getTransactionById(id)
      if (sequence !== lookupSequence.current) return
      if (!transaction) {
        setEditLoadState('not-found')
        return
      }
      const splits = transaction.has_splits ? await getSplits(id) : []
      if (sequence !== lookupSequence.current) return
      setLoadedSplits(
        splits.map((split) => ({
          categoryId: split.category_id ?? '',
          subcategoryId: split.subcategory_id,
          amount: (split.amount / 100).toFixed(2),
          notes: split.notes ?? '',
        }))
      )
      setLoadedTransaction(transaction)
      setEditLoadState('ready')
    } catch (error) {
      if (sequence !== lookupSequence.current) return
      setEditLoadError(getErrorMessage(error))
      setEditLoadState('error')
    }
  }, [])

  useEffect(() => {
    if (!transactionDialogOpen || !editingTransactionId) {
      lookupSequence.current += 1
      setLoadedTransaction(null)
      setEditLoadError(null)
      setEditLoadState('idle')
      return
    }
    void loadEditingTransaction(editingTransactionId)
  }, [editingTransactionId, loadEditingTransaction, transactionDialogOpen])

  const handleSubmit = async (data: TransactionFormValues, splits?: SplitRowData[]) => {
    if (isEditing && (!editingTransactionId || editLoadState !== 'ready' || !loadedTransaction))
      return

    setIsLoading(true)
    try {
      if (isEditing && editingTransactionId) {
        const replacement = splits?.map((split) => ({
          categoryId: split.categoryId,
          subcategoryId: split.subcategoryId,
          amount: toCentavos(Number(split.amount)),
          notes: split.notes || null,
        }))
        const splitsChanged =
          splits !== undefined && JSON.stringify(splits) !== JSON.stringify(loadedSplits)
        if (
          splitsChanged ||
          loadedTransaction?.has_splits ||
          loadedTransaction?.is_finalized_statement ||
          loadedTransaction?.finalization_id
        ) {
          if (
            !loadedTransaction ||
            toCentavos(data.amount) !== loadedTransaction.amount ||
            data.type !== loadedTransaction.type ||
            data.accountId !== loadedTransaction.account_id ||
            data.currency !== loadedTransaction.currency ||
            data.date !== loadedTransaction.date ||
            data.transferToAccountId !== loadedTransaction.transfer_to_account_id
          )
            throw new Error(t('correction.financialLocked'))
          await correctMetadata(
            editingTransactionId,
            {
              description: data.description,
              category_id: data.categoryId,
              subcategory_id: data.subcategoryId,
              notes: data.notes,
              reporting_treatment: data.reportingTreatment,
            },
            splitsChanged ? replacement : undefined
          )
        } else {
          await update(editingTransactionId, data)
        }
        invalidateTransactionPage('edit')
        toast.success(t('toast.updated'))
      } else if (splits && splits.length >= 2) {
        await addWithSplits(
          data,
          splits.map((split) => ({
            categoryId: split.categoryId,
            amount: toCentavos(parseFloat(split.amount)),
            notes: split.notes || null,
          }))
        )
        invalidateTransactionPage('add')
        toast.success(t('toast.created'))
      } else {
        await add(data)
        invalidateTransactionPage('add')
        toast.success(t('toast.created'))
      }
      setIsDirty(false)
      closeTransactionDialog()
    } catch (error) {
      toast.error(getErrorMessage(error, t('toast.error')))
    } finally {
      setIsLoading(false)
    }
  }

  const handleRequestClose = () => {
    if (isLoading) return
    if (isDirty) {
      setConfirmDiscardOpen(true)
      return
    }
    closeTransactionDialog()
  }

  const canRenderEditForm =
    !isEditing || (editLoadState === 'ready' && loadedTransaction?.id === editingTransactionId)

  return (
    <>
      <Dialog open={transactionDialogOpen} onOpenChange={(open) => !open && handleRequestClose()}>
        <DialogContent className="border-border bg-surface max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? t('editTransaction') : t('addTransaction')}</DialogTitle>
            <DialogDescription>
              {isEditing ? t('dialog.editDescription') : t('dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>

          {isEditing && editLoadState === 'loading' && (
            <div className="space-y-4 py-2" aria-label={t('dialog.loading')}>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
          {isEditing && editLoadState === 'not-found' && (
            <div className="border-border bg-muted/40 rounded-lg border p-5 text-center">
              <p className="font-medium">{t('dialog.notFound')}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {t('dialog.notFoundDescription')}
              </p>
            </div>
          )}
          {isEditing && editLoadState === 'error' && editingTransactionId && (
            <div className="border-destructive/30 bg-destructive/5 rounded-lg border p-5 text-center">
              <p className="font-medium">{t('dialog.loadError')}</p>
              <p className="text-muted-foreground mt-1 text-sm">{editLoadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void loadEditingTransaction(editingTransactionId)}
              >
                {t('dialog.retry')}
              </Button>
            </div>
          )}
          {canRenderEditForm && (
            <TransactionForm
              key={editingTransactionId || 'new'}
              transaction={loadedTransaction ?? undefined}
              initialSplits={loadedSplits}
              metadataOnly={
                !!(
                  loadedTransaction?.has_splits ||
                  loadedTransaction?.is_finalized_statement ||
                  loadedTransaction?.finalization_id
                )
              }
              onSubmit={handleSubmit}
              isLoading={isLoading}
              onDirtyChange={setIsDirty}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title={t('dialog.discardTitle')}
        description={t('dialog.discardDescription')}
        confirmLabel={t('dialog.discard')}
        cancelLabel={tCommon('actions.cancel')}
        variant="destructive"
        onConfirm={() => {
          setConfirmDiscardOpen(false)
          closeTransactionDialog()
        }}
      />
    </>
  )
}
