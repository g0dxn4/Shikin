import { useEffect, useState } from 'react'
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
import { readScopedSnapshot, projectBudget } from '@/lib/scoped-report-read'
import { useBudgetStore, type BudgetWithStatus } from '@/stores/budget-store'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { getErrorMessage } from '@/lib/errors'

export function BudgetDialog() {
  const { t } = useTranslation('budgets')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const { budgetDialogOpen, editingBudgetId, closeBudgetDialog } = useUIStore()
  const { add, update } = useBudgetStore()
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
        if (data.amount === undefined) throw new Error(t('scoped.amountRequired'))
        await add({
          ...data,
          amount: data.amount,
          categoryId: data.categoryId,
        })
        toast.success(t('toast.created'))
      }
      closeBudgetDialog()
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
          {budgetDialogOpen && (
            <BudgetDialogForm
              key={editingBudgetId || 'new'}
              id={editingBudgetId}
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

function BudgetDialogForm({
  id,
  onSubmit,
  isLoading,
  onDirtyChange,
}: {
  id: string | null
  onSubmit: (data: BudgetFormValues) => void
  isLoading: boolean
  onDirtyChange: (dirty: boolean) => void
}) {
  const { t } = useTranslation('budgets')
  const [inspection, setInspection] = useState<{
    budget?: BudgetWithStatus
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!id) return
    let cancelled = false
    void readScopedSnapshot()
      .then((snapshot) => {
        const row = snapshot.budgets.find((b) => b.id === id)
        if (!row) throw new Error(t('scoped.budgetNotFound'))
        if (!cancelled) setInspection({ budget: projectBudget(snapshot, row) })
      })
      .catch((error) => {
        if (!cancelled) setInspection({ error: getErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [id, t])
  if (id && !inspection?.budget)
    return (
      <p role={inspection?.error ? 'alert' : 'status'}>
        {inspection?.error ?? t('scoped.loading')}
      </p>
    )
  return (
    <BudgetForm
      budget={inspection?.budget}
      onSubmit={onSubmit}
      isLoading={isLoading}
      onDirtyChange={onDirtyChange}
    />
  )
}
