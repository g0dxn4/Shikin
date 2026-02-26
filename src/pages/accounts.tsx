import { useEffect, useState, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useUIStore } from '@/stores/ui-store'
import { useAccountStore } from '@/stores/account-store'
import { formatMoney } from '@/lib/money'

const ConfirmDialog = lazy(() =>
  import('@/components/shared/confirm-dialog').then((m) => ({
    default: m.ConfirmDialog,
  }))
)

export function Accounts() {
  const { t } = useTranslation('accounts')
  const { t: tCommon } = useTranslation('common')
  const { openAccountDialog } = useUIStore()
  const { accounts, isLoading, fetch, remove } = useAccountStore()

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    fetch()
  }, [fetch])

  const handleDelete = async () => {
    if (!deleteId) return
    setIsDeleting(true)
    try {
      await remove(deleteId)
      toast.success(t('toast.deleted'))
      setDeleteId(null)
    } catch {
      toast.error(t('toast.error'))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openAccountDialog()}>
          <Plus size={16} />
          {t('addAccount')}
        </Button>
      </div>

      {isLoading ? (
        <div className="glass-card flex items-center justify-center py-16">
          <p className="text-muted-foreground">{tCommon('status.loading')}</p>
        </div>
      ) : accounts.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <Landmark size={32} className="text-muted-foreground mb-4" />
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 text-sm">{t('empty.description')}</p>
          <Button onClick={() => openAccountDialog()}>
            <Plus size={16} />
            {t('addAccount')}
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="glass-card group p-5 transition-transform duration-200 hover:translate-y-[-2px]"
            >
              <div className="mb-3 flex items-start justify-between">
                <div>
                  <h3 className="font-heading text-base font-semibold">{account.name}</h3>
                  <Badge variant="secondary" className="mt-1 text-[10px]">
                    {t(`types.${account.type}`)}
                  </Badge>
                </div>
                <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openAccountDialog(account.id)}
                  >
                    <Pencil size={12} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive hover:text-destructive h-7 w-7"
                    onClick={() => setDeleteId(account.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
              <p className="font-heading text-3xl font-bold tracking-tight">
                {formatMoney(account.balance, account.currency)}
              </p>
              <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-wider">
                {account.currency}
              </p>
            </div>
          ))}
        </div>
      )}

      <Suspense>
        <ConfirmDialog
          open={!!deleteId}
          onOpenChange={(open) => !open && setDeleteId(null)}
          title={t('deleteAccount')}
          description={t('deleteConfirm')}
          confirmLabel={tCommon('actions.delete')}
          cancelLabel={tCommon('actions.cancel')}
          variant="destructive"
          isLoading={isDeleting}
          onConfirm={handleDelete}
        />
      </Suspense>
    </div>
  )
}
