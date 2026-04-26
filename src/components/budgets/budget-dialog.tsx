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
import { BudgetForm, type BudgetFormValues } from './budget-form'
import { useUIStore } from '@/stores/ui-store'
import { useBudgetStore } from '@/stores/budget-store'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'

export function BudgetDialog() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const { budgetDialogOpen, editingBudgetId, closeBudgetDialog } = useUIStore()
  const { add, update, getById } = useBudgetStore()

  const budget = editingBudgetId ? getById(editingBudgetId) : undefined
  const isEditing = !!editingBudgetId

  const handleSubmit = async (data: BudgetFormValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingBudgetId) {
        await update(editingBudgetId, {
          ...data,
          categoryId: data.categoryId,
        })
        toast.success(t('toast.updated'))
      } else {
        await add({
          ...data,
          categoryId: data.categoryId,
        })
        toast.success(t('toast.created'))
      }
      closeBudgetDialog()
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
    closeBudgetDialog()
  }

  return (
    <>
      <Dialog open={budgetDialogOpen} onOpenChange={(open) => !open && handleRequestClose()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isEditing ? t('editBudget') : t('addBudget')}</DialogTitle>
            <DialogDescription>
              {isEditing ? t('dialog.editDescription') : t('dialog.addDescription')}
            </DialogDescription>
          </DialogHeader>
          <BudgetForm
            key={editingBudgetId || 'new'}
            budget={budget}
            onSubmit={handleSubmit}
            isLoading={isLoading}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>
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
          closeBudgetDialog()
        }}
      />
    </>
  )
}
