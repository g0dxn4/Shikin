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
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'

export function AccountDialog() {
  const { t } = useTranslation('accounts')
  const [isLoading, setIsLoading] = useState(false)
  const { accountDialogOpen, editingAccountId, closeAccountDialog } = useUIStore()
  const { add, update, getById } = useAccountStore()

  const account = editingAccountId ? getById(editingAccountId) : undefined
  const isEditing = !!editingAccountId

  const handleSubmit = async (data: AccountFormValues) => {
    setIsLoading(true)
    try {
      if (isEditing && editingAccountId) {
        await update(editingAccountId, data)
        toast.success(t('toast.updated'))
      } else {
        await add(data)
        toast.success(t('toast.created'))
      }
      closeAccountDialog()
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog
      open={accountDialogOpen}
      onOpenChange={(open) => !open && !isLoading && closeAccountDialog()}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('editAccount') : t('addAccount')}</DialogTitle>
          <DialogDescription>{isEditing ? t('editAccount') : t('addAccount')}</DialogDescription>
        </DialogHeader>
        <AccountForm
          key={editingAccountId || 'new'}
          account={account}
          onSubmit={handleSubmit}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}
