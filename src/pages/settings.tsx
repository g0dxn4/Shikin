import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SUPPORTED_LANGUAGES, AI_PROVIDERS } from '@/lib/constants'
import { useAIStore } from '@/stores/ai-store'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const { provider, apiKey, model, loadSettings, saveSettings } = useAIStore()

  const [localProvider, setLocalProvider] = useState(provider)
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localModel, setLocalModel] = useState(model)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Sync local state when store loads
  useEffect(() => {
    setLocalProvider(provider)
    setLocalApiKey(apiKey)
    setLocalModel(model)
  }, [provider, apiKey, model])

  const selectedProvider = AI_PROVIDERS.find((p) => p.id === localProvider)
  const availableModels = useMemo(() => selectedProvider?.models ?? [], [selectedProvider])

  // Reset model when provider changes and current model isn't available
  useEffect(() => {
    if (availableModels.length > 0 && !availableModels.includes(localModel as never)) {
      setLocalModel(availableModels[0] as string)
    }
  }, [localProvider, availableModels, localModel])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await saveSettings(localProvider, localApiKey, localModel)
      toast.success(tCommon('status.success'))
    } catch {
      toast.error(tCommon('status.error'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <h1 className="font-heading text-2xl font-bold">{t('title')}</h1>

      {/* General Settings */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.general')}</h2>

        <div className="space-y-1">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            {t('language.label')}
          </Label>
          <p className="text-muted-foreground text-xs">{t('language.description')}</p>
          <select
            value={i18n.language}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="glass-input text-foreground mt-1 w-full max-w-xs px-3 py-2 text-sm"
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

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            {t('ai.provider')}
          </Label>
          <Select value={localProvider} onValueChange={setLocalProvider}>
            <SelectTrigger className="max-w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AI_PROVIDERS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            {t('ai.apiKey')}
          </Label>
          <Input
            type="password"
            placeholder={t('ai.apiKeyPlaceholder')}
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            className="max-w-md"
          />
        </div>

        {availableModels.length > 0 && (
          <div className="space-y-2">
            <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
              {t('ai.model')}
            </Label>
            <Select value={localModel} onValueChange={setLocalModel}>
              <SelectTrigger className="max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableModels.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? '...' : tCommon('actions.save')}
        </Button>
      </section>
    </div>
  )
}
