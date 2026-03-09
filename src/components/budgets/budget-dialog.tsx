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

export function BudgetDialog() {
  const { t } = useTranslation('budgets')
  const [isLoading, setIsLoading] = useState(false)
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
          categoryId: data.categoryId || null,
        })
        toast.success(t('toast.updated'))
      } else {
        await add({
          ...data,
          categoryId: data.categoryId || null,
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

  return (
    <Dialog open={budgetDialogOpen} onOpenChange={(open) => !open && closeBudgetDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editBudget') : t('addBudget')}</DialogTitle>
          <DialogDescription>{isEditing ? t('editBudget') : t('addBudget')}</DialogDescription>
        </DialogHeader>
        <BudgetForm
          key={editingBudgetId || 'new'}
          budget={budget}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
