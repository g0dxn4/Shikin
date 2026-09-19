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
import { AccountForm, type AccountFormValues } from './account-form'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { fromCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'

export function AccountDialog() {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')
  const [isLoading, setIsLoading] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false)
  const { accountDialogOpen, editingAccountId, closeAccountDialog } = useUIStore()
  const { add, update, getById } = useAccountStore()

  const account = editingAccountId ? getById(editingAccountId) : undefined
  const isEditing = !!editingAccountId

  const handleSubmit = async (data: AccountFormValues) => {
    setIsLoading(true)
    try {
      let reconciliation
      if (isEditing && editingAccountId) {
        reconciliation = await update(editingAccountId, data)
        toast.success(t('toast.updated'))
      } else {
        reconciliation = await add(data)
        toast.success(t('toast.created'))
      }
      if (reconciliation) {
        toast.info(
          t('toast.reconciliation', {
            balance: fromCentavos(reconciliation.currentBalanceAfter),
            later: fromCentavos(reconciliation.laterActivityRetained),
            discrepancy: fromCentavos(reconciliation.storedVsLedgerDiscrepancy),
          })
        )
      }
      closeAccountDialog()
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
    closeAccountDialog()
  }

  return (
    <>
      <Dialog open={accountDialogOpen} onOpenChange={(open) => !open && handleRequestClose()}>
        <DialogContent className="max-h-[90dvh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? t('editAccount') : t('addAccount')}</DialogTitle>
            <DialogDescription>{isEditing ? t('editAccount') : t('addAccount')}</DialogDescription>
          </DialogHeader>
          <AccountForm
            key={editingAccountId || 'new'}
            account={account}
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
          closeAccountDialog()
        }}
      />
    </>
  )
}
