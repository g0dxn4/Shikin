import { useEffect, useState, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Landmark, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

  const totalBalance = useMemo(() => accounts.reduce((sum, a) => sum + a.balance, 0), [accounts])

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
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <Button onClick={() => openAccountDialog()}>
          <Plus size={16} />
          {t('addAccount')}
        </Button>
      </div>

      {isLoading ? (
        <AccountsSkeleton />
      ) : accounts.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
            <Landmark size={28} className="text-primary" />
          </div>
          <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
          <p className="text-muted-foreground mb-4 max-w-sm text-sm">{t('empty.description')}</p>
          <Button onClick={() => openAccountDialog()}>
            <Plus size={16} />
            {t('addAccount')}
          </Button>
        </div>
      ) : (
        <>
          {/* Total balance summary */}
          <div className="glass-card bg-gradient-to-br from-[#BF5AF218] to-transparent p-6">
            <p className="text-muted-foreground mb-1 font-mono text-[10px] tracking-wider uppercase">
              {t('totalBalance')}
            </p>
            <p className="font-heading text-3xl font-bold tracking-tight">
              {formatMoney(totalBalance)}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {accounts.length} {t('accountCount', { count: accounts.length })}
            </p>
          </div>

          {/* Account cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => {
              const accentColor = account.color || '#bf5af2'
              const isCreditCard = account.type === 'credit_card'
              const utilization =
                isCreditCard && account.credit_limit
                  ? Math.min(
                      100,
                      Math.round((Math.abs(account.balance) / account.credit_limit) * 100)
                    )
                  : null

              return (
                <div
                  key={account.id}
                  className="glass-card group relative overflow-hidden p-5 transition-all duration-200 hover:translate-y-[-2px]"
                  style={{ borderLeft: `3px solid ${accentColor}` }}
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
                        aria-label={`Edit ${account.name}`}
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive h-7 w-7"
                        onClick={() => setDeleteId(account.id)}
                        aria-label={`Delete ${account.name}`}
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

                  {/* Credit card utilization bar */}
                  {utilization !== null && (
                    <div className="mt-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-muted-foreground text-[10px]">Utilization</span>
                        <span
                          className={`font-mono text-[10px] font-medium ${
                            utilization > 75
                              ? 'text-destructive'
                              : utilization > 50
                                ? 'text-warning'
                                : 'text-success'
                          }`}
                        >
                          {utilization}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${utilization}%`,
                            backgroundColor:
                              utilization > 75
                                ? 'var(--color-destructive)'
                                : utilization > 50
                                  ? 'var(--color-warning)'
                                  : 'var(--color-success)',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
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

function AccountsSkeleton() {
  return (
    <>
      <div className="glass-card space-y-2 p-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 p-5">
            <div className="space-y-1">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </>
  )
}
