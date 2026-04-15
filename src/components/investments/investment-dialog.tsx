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
import { InvestmentForm, type InvestmentFormValues } from './investment-form'
import { useUIStore } from '@/stores/ui-store'
import { useInvestmentStore } from '@/stores/investment-store'

export function InvestmentDialog() {
  const { t } = useTranslation('investments')
  const [isLoading, setIsLoading] = useState(false)
  const { investmentDialogOpen, editingInvestmentId, closeInvestmentDialog } = useUIStore()
  const { add, update, getById } = useInvestmentStore()

  const investment = editingInvestmentId ? getById(editingInvestmentId) : undefined
  const isEditing = !!editingInvestmentId

  const handleSubmit = async (data: InvestmentFormValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingInvestmentId) {
        await update(editingInvestmentId, data)
        toast.success(t('toast.updated'))
      } else {
        await add(data)
        toast.success(t('toast.created'))
      }
      closeInvestmentDialog()
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog
      open={investmentDialogOpen}
      onOpenChange={(open) => !open && !isLoading && closeInvestmentDialog()}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editInvestment') : t('addInvestment')}</DialogTitle>
          <DialogDescription>
            {isEditing ? t('editInvestment') : t('addInvestment')}
          </DialogDescription>
        </DialogHeader>
        <InvestmentForm
          key={editingInvestmentId || 'new'}
          investment={investment}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
