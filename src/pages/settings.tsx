import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, AI_PROVIDERS } from '@/lib/constants'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* General Settings */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.general')}</h2>

        <div className="space-y-1">
          <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t('language.label')}
          </label>
          <p className="text-xs text-muted-foreground">{t('language.description')}</p>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="glass-input mt-1 w-full max-w-xs px-3 py-2 text-sm text-foreground"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* AI Settings */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.ai')}</h2>

        <div className="space-y-1">
          <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t('ai.provider')}
          </label>
          <select className="glass-input mt-1 w-full max-w-xs px-3 py-2 text-sm text-foreground">
            {AI_PROVIDERS.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {t('ai.apiKey')}
          </label>
          <input
            type="password"
            placeholder={t('ai.apiKeyPlaceholder')}
            className="glass-input mt-1 w-full max-w-md px-3 py-2 text-sm"
          />
        </div>
      </section>
    </div>
  )
}
