import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, Eye, EyeOff, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUPPORTED_LANGUAGES, AI_PROVIDERS, PROVIDER_CATEGORIES } from '@/lib/constants'
import type { ProviderInfo } from '@/lib/constants'
import { useAIStore } from '@/stores/ai-store'
import { fetchModels, isKeylessProvider, isStaticModelList, type ModelInfo } from '@/ai/models'
import type { AIProvider } from '@/ai/agent'
import { cn } from '@/lib/utils'
import { load } from '@tauri-apps/plugin-store'

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
  const [modelSearch, setModelSearch] = useState('')
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'failed' | null>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)

  const [alphaVantageKey, setAlphaVantageKey] = useState('')
  const [finnhubKey, setFinnhubKey] = useState('')
  const [isSavingDataKeys, setIsSavingDataKeys] = useState(false)

  useEffect(() => {
    loadSettings()
    // Load data API keys
    load('settings.json')
      .then(async (store) => {
        setAlphaVantageKey(((await store.get('alpha_vantage_key')) as string) || '')
        setFinnhubKey(((await store.get('finnhub_key')) as string) || '')
      })
      .catch(() => {})
  }, [loadSettings])

  useEffect(() => {
    setLocalProvider(provider)
    setLocalApiKey(apiKey)
    setLocalModel(model)
  }, [provider, apiKey, model])

  const loadModels = useCallback(async (prov: string, key: string) => {
    setIsLoadingModels(true)
    try {
      const result = await fetchModels(prov as AIProvider, key)
      setModels(result)
    } catch {
      setModels([])
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  useEffect(() => {
    const keyless = isKeylessProvider(localProvider)
    const staticList = isStaticModelList(localProvider)
    if (!keyless && !staticList && !localApiKey) {
      setModels([])
      return
    }
    loadModels(localProvider, localApiKey)
  }, [localProvider, localApiKey, loadModels])

  useEffect(() => {
    if (models.length > 0 && !models.some((m) => m.id === localModel)) {
      setLocalModel(models[0].id)
    }
  }, [models, localModel])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setIsModelDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filteredModels = useMemo(
    () =>
      modelSearch
        ? models.filter(
            (m) =>
              m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
              m.id.toLowerCase().includes(modelSearch.toLowerCase())
          )
        : models,
    [models, modelSearch]
  )

  const selectedModelName = models.find((m) => m.id === localModel)?.name || localModel

  const handleSelectProvider = (p: ProviderInfo) => {
    setLocalProvider(p.id)
    setTestResult(null)
    setShowApiKey(false)
  }

  const handleTestConnection = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const result = await fetchModels(localProvider as AIProvider, localApiKey)
      setTestResult(result.length > 0 ? 'success' : 'failed')
    } catch {
      setTestResult('failed')
    } finally {
      setIsTesting(false)
    }
  }

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

  const currentProviderInfo = AI_PROVIDERS.find((p) => p.id === localProvider)
  const needsKey = !isKeylessProvider(localProvider)

  return (
    <div className="animate-fade-in-up page-content">
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

      {/* AI Provider Section */}
      <section className="space-y-4">
        <h2 className="font-heading text-lg font-semibold">{t('sections.ai')}</h2>

        {/* Provider Grid */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {AI_PROVIDERS.map((p) => {
            const isSelected = localProvider === p.id
            const isActive = provider === p.id
            const cat = PROVIDER_CATEGORIES[p.category]
            const isConfiguredProvider =
              isActive && (apiKey || isKeylessProvider(p.id))

            return (
              <button
                key={p.id}
                onClick={() => handleSelectProvider(p)}
                className={cn(
                  'glass-card relative flex flex-col items-start p-4 text-left transition-all duration-150',
                  isSelected
                    ? 'border-accent ring-accent/20 ring-2'
                    : 'hover:border-border-hover',
                )}
              >
                <div className="mb-2 flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
                      style={{
                        background: `${cat.color}20`,
                        color: cat.color,
                      }}
                    >
                      {p.name[0]}
                    </div>
                    <h3 className="font-heading text-sm font-semibold">{p.name}</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                      style={{
                        background: `${cat.color}15`,
                        color: cat.color,
                      }}
                    >
                      {t(`ai.categories.${p.category}`)}
                    </span>
                    {isConfiguredProvider && (
                      <span className="h-2 w-2 rounded-full bg-success" />
                    )}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {p.description}
                </p>
              </button>
            )
          })}
        </div>

        {/* Config Panel */}
        {currentProviderInfo && (
          <div className="glass-card animate-fade-in space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-accent" />
              <h3 className="font-heading text-sm font-semibold">
                {currentProviderInfo.name}
              </h3>
            </div>

            {/* API Key */}
            {needsKey && (
              <div className="space-y-2">
                <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                  {t('ai.apiKey')}
                </Label>
                <div className="flex gap-2">
                  <div className="relative max-w-md flex-1">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      placeholder={t('ai.apiKeyPlaceholder')}
                      value={localApiKey}
                      onChange={(e) => {
                        setLocalApiKey(e.target.value)
                        setTestResult(null)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
                    >
                      {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={isTesting || !localApiKey}
                    className="shrink-0"
                  >
                    {isTesting ? (
                      <>
                        <Loader2 size={14} className="animate-spin" />
                        {t('ai.testing')}
                      </>
                    ) : testResult === 'success' ? (
                      <>
                        <Check size={14} className="text-success" />
                        {t('ai.testSuccess')}
                      </>
                    ) : testResult === 'failed' ? (
                      <span className="text-destructive">{t('ai.testFailed')}</span>
                    ) : (
                      t('ai.testConnection')
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!needsKey && (
              <p className="text-muted-foreground text-xs">{t('ai.noKeyNeeded')}</p>
            )}

            {/* Model Selector */}
            <div className="space-y-2">
              <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                {t('ai.model')}
              </Label>
              {isLoadingModels ? (
                <p className="text-muted-foreground text-sm">{t('ai.loadingModels')}</p>
              ) : models.length > 0 ? (
                <div className="relative max-w-xs" ref={modelDropdownRef}>
                  <Input
                    placeholder={t('ai.searchModels')}
                    value={isModelDropdownOpen ? modelSearch : selectedModelName}
                    onChange={(e) => {
                      setModelSearch(e.target.value)
                      setIsModelDropdownOpen(true)
                    }}
                    onFocus={() => {
                      setIsModelDropdownOpen(true)
                      setModelSearch('')
                    }}
                  />
                  {isModelDropdownOpen && (
                    <div className="border-border bg-popover absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-md border shadow-lg">
                      {filteredModels.length === 0 ? (
                        <p className="text-muted-foreground p-3 text-sm">{t('ai.noModels')}</p>
                      ) : (
                        filteredModels.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            className={cn(
                              'hover:bg-accent/20 w-full px-3 py-2 text-left text-sm',
                              m.id === localModel && 'bg-accent/10 text-accent'
                            )}
                            onClick={() => {
                              setLocalModel(m.id)
                              setModelSearch('')
                              setIsModelDropdownOpen(false)
                            }}
                          >
                            {m.name}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <Input
                  placeholder={t('ai.enterModelId')}
                  value={localModel}
                  onChange={(e) => setLocalModel(e.target.value)}
                  className="max-w-xs"
                />
              )}
            </div>

            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : null}
              {isSaving ? '...' : tCommon('actions.save')}
            </Button>
          </div>
        )}
      </section>

      {/* Data API Keys */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.dataApis')}</h2>
        <p className="text-muted-foreground text-xs">
          {t('dataApis.description')}
        </p>

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            Alpha Vantage
          </Label>
          <p className="text-muted-foreground text-[10px]">
            {t('dataApis.alphaVantageHint')}
          </p>
          <Input
            type="password"
            placeholder="Alpha Vantage API key"
            value={alphaVantageKey}
            onChange={(e) => setAlphaVantageKey(e.target.value)}
            className="max-w-md"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            Finnhub
          </Label>
          <p className="text-muted-foreground text-[10px]">
            {t('dataApis.finnhubHint')}
          </p>
          <Input
            type="password"
            placeholder="Finnhub API key"
            value={finnhubKey}
            onChange={(e) => setFinnhubKey(e.target.value)}
            className="max-w-md"
          />
        </div>

        <Button
          onClick={async () => {
            setIsSavingDataKeys(true)
            try {
              const store = await load('settings.json')
              await store.set('alpha_vantage_key', alphaVantageKey)
              await store.set('finnhub_key', finnhubKey)
              await store.save()
              toast.success(tCommon('status.success'))
            } catch {
              toast.error(tCommon('status.error'))
            } finally {
              setIsSavingDataKeys(false)
            }
          }}
          disabled={isSavingDataKeys}
        >
          {isSavingDataKeys ? '...' : tCommon('actions.save')}
        </Button>
      </section>
    </div>
  )
}
