import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TransactionForm, type TransactionFormValues, type SplitRowData } from './transaction-form'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { toCentavos } from '@/lib/money'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

export function TransactionDialog() {
  const { t } = useTranslation('transactions')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const { transactionDialogOpen, editingTransactionId, closeTransactionDialog } = useUIStore()
  const { add, addWithSplits, update, getById } = useTransactionStore()

  const transaction = editingTransactionId ? getById(editingTransactionId) : undefined
  const isEditing = !!editingTransactionId

  const handleSubmit = async (data: TransactionFormValues, splits?: SplitRowData[]) => {
    setIsLoading(true)
    try {
      if (isEditing && editingTransactionId) {
        await update(editingTransactionId, data)
        toast.success(t('toast.updated'))
      } else if (splits && splits.length >= 2) {
        const splitInputs = splits.map((s) => ({
          categoryId: s.categoryId,
          amount: toCentavos(parseFloat(s.amount)),
          notes: s.notes || null,
        }))
        await addWithSplits(data, splitInputs)
        toast.success(t('toast.created'))
      } else {
        await add(data)
        toast.success(t('toast.created'))
      }
      closeTransactionDialog()
    } catch {
      toast.error(t('toast.error'))
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

  return (
    <>
      <Dialog open={transactionDialogOpen} onOpenChange={(open) => !open && handleRequestClose()}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? t('editTransaction') : t('addTransaction')}</DialogTitle>
            <DialogDescription>
              {isEditing ? t('editTransaction') : t('addTransaction')}
            </DialogDescription>
          </DialogHeader>
          <TransactionForm
            key={editingTransactionId || 'new'}
            transaction={transaction}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscardOpen}
        onOpenChange={setConfirmDiscardOpen}
        title="Discard changes?"
        description="You have unsaved changes. Close this form without saving?"
        confirmLabel="Discard"
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
