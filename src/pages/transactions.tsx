import { useTranslation } from 'react-i18next'
import { ArrowLeftRight } from 'lucide-react'

export function Transactions() {
  const { t } = useTranslation()

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('nav.transactions')}</h1>
      <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
        <ArrowLeftRight size={32} className="mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">{t('status.empty')}</p>
      </div>
    </div>
  )
}
