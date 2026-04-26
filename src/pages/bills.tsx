import { useTranslation } from 'react-i18next'
import { Receipt } from 'lucide-react'

export function BillsPage() {
  const { t } = useTranslation()

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <Receipt size={24} className="text-accent" />
          <h1 className="font-heading text-2xl font-bold">{t('nav.bills', 'Bills')}</h1>
        </div>
      </div>
      <div className="liquid-card flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
          <Receipt size={28} className="text-primary" />
        </div>
        <h2 className="font-heading mb-2 text-lg font-semibold">{t('nav.bills', 'Bills')}</h2>
        <p className="text-muted-foreground text-sm">{t('status.empty', 'No data yet')}</p>
      </div>
    </div>
  )
}
