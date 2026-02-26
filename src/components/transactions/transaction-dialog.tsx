import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { TransactionForm, type TransactionFormValues } from './transaction-form'
import { useUIStore } from '@/stores/ui-store'
import { useTransactionStore } from '@/stores/transaction-store'

export function TransactionDialog() {
  const { t } = useTranslation('transactions')
  const [isLoading, setIsLoading] = useState(false)
  const { transactionDialogOpen, editingTransactionId, closeTransactionDialog } = useUIStore()
  const { add, update, getById } = useTransactionStore()

  const transaction = editingTransactionId ? getById(editingTransactionId) : undefined
  const isEditing = !!editingTransactionId

  const handleSubmit = async (data: TransactionFormValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingTransactionId) {
        await update(editingTransactionId, data)
        toast.success(t('toast.updated'))
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

  return (
    <Sheet open={transactionDialogOpen} onOpenChange={(open) => !open && closeTransactionDialog()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEditing ? t('editTransaction') : t('addTransaction')}</SheetTitle>
          <SheetDescription>
            {isEditing ? t('editTransaction') : t('addTransaction')}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <TransactionForm
            key={editingTransactionId || 'new'}
            transaction={transaction}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
