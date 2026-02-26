import { useTranslation } from 'react-i18next'
import { Wallet, TrendingUp, TrendingDown, PiggyBank } from 'lucide-react'
import { useUIStore } from '@/stores/ui-store'

export function Dashboard() {
  const { t } = useTranslation('dashboard')
  const { setAIPanelOpen } = useUIStore()

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t('cards.totalBalance'), icon: Wallet, value: '$0.00' },
          { label: t('cards.monthlyIncome'), icon: TrendingUp, value: '$0.00' },
          { label: t('cards.monthlyExpenses'), icon: TrendingDown, value: '$0.00' },
          { label: t('cards.savings'), icon: PiggyBank, value: '0%' },
        ].map(({ label, icon: Icon, value }) => (
          <div key={label} className="glass-card p-4">
            <div className="mb-2 flex items-center gap-2 text-muted-foreground">
              <Icon size={16} />
              <span className="font-mono text-xs uppercase tracking-wider">{label}</span>
            </div>
            <p className="font-heading text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      {/* Empty state */}
      <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent-muted">
          <Wallet size={32} className="text-primary" />
        </div>
        <h2 className="mb-2 font-heading text-xl font-semibold">{t('empty.title')}</h2>
        <p className="mb-6 max-w-md text-sm text-muted-foreground">{t('empty.description')}</p>
        <div className="flex gap-3">
          <button className="bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-accent-hover">
            {t('empty.addAccount')}
          </button>
          <button
            onClick={() => setAIPanelOpen(true)}
            className="border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-white/5"
          >
            {t('empty.askAI')}
          </button>
        </div>
      </div>
    </div>
  )
}
