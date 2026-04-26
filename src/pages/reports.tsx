import { useTranslation } from 'react-i18next'
import { BarChart3 } from 'lucide-react'

export function ReportsPage() {
  const { t } = useTranslation('analytics')

  return (
    <div className="page-content animate-fade-in">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <BarChart3 size={24} className="text-accent" aria-hidden="true" />
          <h1 className="font-heading text-2xl font-bold">{t('reports.title')}</h1>
        </div>
      </div>
      <div className="liquid-card flex flex-col items-center justify-center gap-4 py-20">
        <BarChart3 size={40} className="text-muted-foreground" aria-hidden="true" />
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          {t('reports.comingSoon')}
        </p>
      </div>
    </div>
  )
}
