import { useCallback, useEffect, useState } from 'react'
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
import { fetchModels, type ModelInfo } from '@/ai/models'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const { provider, apiKey, model, loadSettings, saveSettings } = useAIStore()

  const [localProvider, setLocalProvider] = useState(provider)
  const [localApiKey, setLocalApiKey] = useState(apiKey)
  const [localModel, setLocalModel] = useState(model)
  const [isSaving, setIsSaving] = useState(false)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Sync local state when store loads
  useEffect(() => {
    setLocalProvider(provider)
    setLocalApiKey(apiKey)
    setLocalModel(model)
  }, [provider, apiKey, model])

  const loadModels = useCallback(async (prov: string, key: string) => {
    setIsLoadingModels(true)
    try {
      const result = await fetchModels(prov as Parameters<typeof fetchModels>[0], key)
      setModels(result)
    } catch {
      setModels([])
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  // Fetch models when provider or API key changes
  useEffect(() => {
    // Ollama doesn't need a key, Anthropic is static — always fetch
    const needsKey = localProvider !== 'ollama' && localProvider !== 'anthropic'
    if (needsKey && !localApiKey) {
      setModels([])
      return
    }
    loadModels(localProvider, localApiKey)
  }, [localProvider, localApiKey, loadModels])

  // Reset model selection when available models change
  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === localModel)) {
      setLocalModel(models[0].id)
    }
  }, [models, localModel])

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

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            {t('ai.model')}
          </Label>
          {isLoadingModels ? (
            <p className="text-muted-foreground text-sm">Loading models...</p>
          ) : models.length > 0 ? (
            <Select value={localModel} onValueChange={setLocalModel}>
              <SelectTrigger className="max-w-xs">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              placeholder="Enter model ID"
              value={localModel}
              onChange={(e) => setLocalModel(e.target.value)}
              className="max-w-xs"
            />
          )}
        </div>

        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? '...' : tCommon('actions.save')}
        </Button>
      </section>
    </div>
  )
}
