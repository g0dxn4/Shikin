import { useTranslation } from 'react-i18next'
import { PiggyBank } from 'lucide-react'

export function Budgets() {
  const { t } = useTranslation()

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('nav.budgets')}</h1>
      <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
        <PiggyBank size={32} className="text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{t('status.empty')}</p>
      </div>
    </div>
  )
}
