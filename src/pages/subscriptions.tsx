import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Repeat, AlertCircle, CheckCircle, Calendar, DollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  useSubscriptionStore,
  type SubbySubscription,
} from '@/stores/subscription-store'

const STATUS_COLORS: Record<string, string> = {
  trial: '#a855f7',
  active: '#22c55e',
  paused: '#f59e0b',
  pending_cancellation: '#ef4444',
  grace_period: '#f97316',
  cancelled: '#6b7280',
}

function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount)
}

function SubscriptionCard({ sub }: { sub: SubbySubscription }) {
  const { t } = useTranslation('subscriptions')

  const statusColor = STATUS_COLORS[sub.status] ?? '#6b7280'
  const accentColor = sub.color ?? '#bf5af2'

  return (
    <div
      className="glass-card group p-5 transition-transform duration-200 hover:translate-y-[-2px]"
      style={{ borderLeft: `3px solid ${accentColor}` }}
    >
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="font-heading text-base font-semibold">{sub.name}</h3>
          {sub.category_name && (
            <p className="text-muted-foreground mt-0.5 text-xs">{sub.category_name}</p>
          )}
        </div>
        <Badge
          variant="secondary"
          className="text-[10px]"
          style={{
            backgroundColor: `${statusColor}20`,
            color: statusColor,
            borderColor: `${statusColor}40`,
          }}
        >
          {t(`status.${sub.status}` as 'status.active')}
        </Badge>
      </div>

      <p className="font-heading text-2xl font-bold tracking-tight">
        {formatCurrency(sub.amount, sub.currency)}
        <span className="text-muted-foreground ml-1 text-xs font-normal">
          / {t(`cycle.${sub.billing_cycle}` as 'cycle.monthly').toLowerCase()}
        </span>
      </p>

      {sub.next_payment_date && (
        <p className="text-muted-foreground mt-2 flex items-center gap-1 text-xs">
          <Calendar size={12} />
          {new Date(sub.next_payment_date).toLocaleDateString()}
        </p>
      )}

      {sub.card_name && (
        <p className="text-muted-foreground mt-1 font-mono text-[10px] tracking-wider">
          {sub.card_name}
        </p>
      )}
    </div>
  )
}

function ConnectionBanner({ connected }: { connected: boolean }) {
  const { t } = useTranslation('subscriptions')

  return (
    <div
      className="glass-card flex items-center gap-2 px-4 py-2 text-sm"
      style={{
        borderColor: connected ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
        backgroundColor: connected ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
      }}
    >
      {connected ? (
        <>
          <CheckCircle size={14} className="text-success" />
          <span className="text-success">{t('connection.connected')}</span>
        </>
      ) : (
        <>
          <AlertCircle size={14} className="text-destructive" />
          <span className="text-destructive">{t('connection.disconnected')}</span>
          <span className="text-muted-foreground">—</span>
          <span className="text-muted-foreground">{t('connection.configure')}</span>
        </>
      )}
    </div>
  )
}

function SetupGuide() {
  const { t } = useTranslation('subscriptions')

  return (
    <div className="glass-card space-y-4 p-6">
      <h2 className="font-heading text-lg font-semibold">{t('connection.setupTitle')}</h2>
      <p className="text-muted-foreground text-sm">{t('connection.setupDescription')}</p>
      <ol className="text-muted-foreground list-inside list-decimal space-y-2 text-sm">
        <li>{t('connection.step1')}</li>
        <li>{t('connection.step2')}</li>
        <li>{t('connection.step3')}</li>
      </ol>
    </div>
  )
}

export function Subscriptions() {
  const { t } = useTranslation('subscriptions')
  const {
    subscriptions,
    upcomingPayments,
    monthlyTotal,
    isLoading,
    isConnected,
    fetch,
  } = useSubscriptionStore()

  const [tab, setTab] = useState<'active' | 'inactive'>('active')

  useEffect(() => {
    fetch()
  }, [fetch])

  const activeSubs = subscriptions.filter(
    (s) => s.status === 'active' || s.status === 'trial'
  )
  const inactiveSubs = subscriptions.filter(
    (s) => s.status !== 'active' && s.status !== 'trial'
  )
  const displaySubs = tab === 'active' ? activeSubs : inactiveSubs

  return (
    <div className="animate-fade-in-up page-content">
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>
        <ConnectionBanner connected={isConnected} />
      </div>

      {isLoading ? (
        <SubscriptionsSkeleton />
      ) : !isConnected ? (
        <SetupGuide />
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="metric-card">
              <div className="text-muted-foreground mb-2 flex items-center gap-2">
                <span className="text-primary"><DollarSign size={16} /></span>
                <span className="font-mono text-[10px] tracking-wider uppercase">{t('summary.monthlyTotal')}</span>
              </div>
              <p className="font-heading text-2xl font-bold tracking-tight">
                {formatCurrency(monthlyTotal)}
              </p>
            </div>
            <div className="metric-card">
              <div className="text-muted-foreground mb-2 flex items-center gap-2">
                <span className="text-primary"><DollarSign size={16} /></span>
                <span className="font-mono text-[10px] tracking-wider uppercase">{t('summary.yearlyTotal')}</span>
              </div>
              <p className="font-heading text-2xl font-bold tracking-tight">
                {formatCurrency(Math.round(monthlyTotal * 12 * 100) / 100)}
              </p>
            </div>
            <div className="metric-card">
              <div className="text-muted-foreground mb-2 flex items-center gap-2">
                <span className="text-primary"><Repeat size={16} /></span>
                <span className="font-mono text-[10px] tracking-wider uppercase">{t('summary.activeCount')}</span>
              </div>
              <p className="font-heading text-2xl font-bold tracking-tight">{activeSubs.length}</p>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setTab('active')}
              className={`rounded-full px-4 py-1.5 font-mono text-xs font-medium transition-colors ${
                tab === 'active'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {t('tabs.active')} ({activeSubs.length})
            </button>
            <button
              onClick={() => setTab('inactive')}
              className={`rounded-full px-4 py-1.5 font-mono text-xs font-medium transition-colors ${
                tab === 'inactive'
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-white/5'
              }`}
            >
              {t('tabs.inactive')} ({inactiveSubs.length})
            </button>
          </div>

          {/* Subscription grid */}
          {displaySubs.length === 0 ? (
            <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
              <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-full">
                <Repeat size={28} className="text-primary" />
              </div>
              <h2 className="font-heading mb-2 text-lg font-semibold">{t('empty.title')}</h2>
              <p className="text-muted-foreground text-sm">{t('empty.description')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {displaySubs.map((sub) => (
                <SubscriptionCard key={sub.id} sub={sub} />
              ))}
            </div>
          )}

          {/* Upcoming payments */}
          {upcomingPayments.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-heading text-lg font-semibold">{t('upcoming.title')}</h2>
              <p className="text-muted-foreground text-xs">{t('upcoming.next30Days')}</p>
              <div className="space-y-2">
                {upcomingPayments.map((payment, i) => (
                  <div
                    key={`${payment.name}-${i}`}
                    className="glass-card flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: payment.color ?? '#bf5af2' }}
                      />
                      <span className="text-sm font-medium">{payment.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-muted-foreground text-xs">
                        {payment.daysUntil === 0
                          ? 'Today'
                          : payment.daysUntil === 1
                            ? 'Tomorrow'
                            : `${payment.daysUntil}d`}
                      </span>
                      <span className="font-heading text-sm font-semibold">
                        {formatCurrency(payment.amount, payment.currency)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function SubscriptionsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="metric-card space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-32" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card space-y-3 p-5">
            <div className="flex items-start justify-between">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    </>
  )
}
