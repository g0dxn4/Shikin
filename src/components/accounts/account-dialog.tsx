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
    <Sheet open={accountDialogOpen} onOpenChange={(open) => !open && closeAccountDialog()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{isEditing ? t('editAccount') : t('addAccount')}</SheetTitle>
          <SheetDescription>{isEditing ? t('editAccount') : t('addAccount')}</SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          <AccountForm
            key={editingAccountId || 'new'}
            account={account}
            onSubmit={handleSubmit}
            isLoading={isLoading}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
