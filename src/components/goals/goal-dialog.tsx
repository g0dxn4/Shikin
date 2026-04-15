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
import { GoalForm, type GoalFormValues } from './goal-form'
import { useUIStore } from '@/stores/ui-store'
import { useGoalStore } from '@/stores/goal-store'

export function GoalDialog() {
  const { t } = useTranslation('goals')
  const [isLoading, setIsLoading] = useState(false)
  const { goalDialogOpen, editingGoalId, closeGoalDialog } = useUIStore()
  const { add, update, getById } = useGoalStore()

  const goal = editingGoalId ? getById(editingGoalId) : undefined
  const isEditing = !!editingGoalId

  const handleSubmit = async (data: GoalFormValues) => {
    setIsLoading(true)
    try {
      const formData = {
        name: data.name,
        targetAmount: data.targetAmount,
        currentAmount: data.currentAmount,
        deadline: data.deadline || null,
        accountId: data.accountId || null,
        icon: data.icon,
        color: data.color,
        notes: data.notes || null,
      }

      if (isEditing && editingGoalId) {
        await update(editingGoalId, formData)
        toast.success(t('toast.updated'))
      } else {
        await add(formData)
        toast.success(t('toast.created'))
      }
      closeGoalDialog()
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={goalDialogOpen} onOpenChange={(open) => !open && !isLoading && closeGoalDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editGoal') : t('addGoal')}</DialogTitle>
          <DialogDescription>{isEditing ? t('editGoal') : t('addGoal')}</DialogDescription>
        </DialogHeader>
        <GoalForm
          key={editingGoalId || 'new'}
          goal={goal}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
