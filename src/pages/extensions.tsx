import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'

export function ExtensionsPage() {
  const { t } = useTranslation()

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <Puzzle size={24} className="text-extension" />
          <h1 className="font-heading text-2xl font-bold">{t('nav.extensions', 'Extensions')}</h1>
        </div>
      </div>
      <div className="liquid-card flex flex-col items-center justify-center py-20 text-center">
        <div className="bg-accent-muted mb-4 flex h-14 w-14 items-center justify-center rounded-3xl">
          <Puzzle size={28} className="text-primary" />
        </div>
        <h2 className="font-heading mb-2 text-lg font-semibold">
          {t('nav.extensions', 'Extensions')}
        </h2>
        <p className="text-muted-foreground text-sm">{t('status.empty', 'No data yet')}</p>
      </div>
    </div>
  )
}
