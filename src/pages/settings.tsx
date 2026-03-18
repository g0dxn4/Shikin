import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, Loader2, Eye, EyeOff, Zap, LogOut, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUPPORTED_LANGUAGES, AI_PROVIDERS, PROVIDER_CATEGORIES } from '@/lib/constants'
import type { ProviderInfo } from '@/lib/constants'
import { useAIStore } from '@/stores/ai-store'
import { useCategorizationStore } from '@/stores/categorization-store'
import { fetchModels, isKeylessProvider, isStaticModelList, type ModelInfo } from '@/ai/models'
import type { AIProvider } from '@/ai/agent'
import { cn } from '@/lib/utils'
import { load } from '@/lib/storage'
import { exportDatabaseSnapshot, importDatabaseSnapshot } from '@/lib/database'
import { startOAuthFlow, exchangeCodeForToken, loadPkceState } from '@/lib/oauth'
import { createGoogleOAuthConfig, fetchGoogleUserEmail } from '@/lib/oauth-providers/google'
import { createOpenAICodexOAuthConfig, extractAccountId } from '@/lib/oauth-providers/openai-codex'
import { ThemeSettings } from '@/components/ThemeSettings'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const { t: tTransactions } = useTranslation('transactions')
  const {
    provider,
    apiKey,
    model,
    authMode,
    oauthEmail,
    oauthAccessToken,
    oauthClientId,
    loadSettings,
    saveSettings,
    setOAuthTokens,
    setAuthMode,
    setOAuthClientId,
    clearOAuth,
  } = useAIStore()

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

  const { rules, isLoading: isLoadingRules, loadRules, deleteRule } = useCategorizationStore()

  const [alphaVantageKey, setAlphaVantageKey] = useState('')
  const [finnhubKey, setFinnhubKey] = useState('')
  const [isSavingDataKeys, setIsSavingDataKeys] = useState(false)
  const [isExportingData, setIsExportingData] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)
  const importDbInputRef = useRef<HTMLInputElement>(null)

  // OAuth local state
  const [localAuthMode, setLocalAuthMode] = useState<'api_key' | 'oauth'>(authMode)
  const [localOAuthClientId, setLocalOAuthClientId] = useState(oauthClientId)
  const [isOAuthLoading, setIsOAuthLoading] = useState(false)

  useEffect(() => {
    loadSettings()
    loadRules()
    load('settings.json')
      .then(async (store) => {
        setAlphaVantageKey(((await store.get('alpha_vantage_key')) as string) || '')
        setFinnhubKey(((await store.get('finnhub_key')) as string) || '')
      })
      .catch(() => {})

    // Check for same-window OAuth redirect fallback
    const callbackResult = sessionStorage.getItem('oauth_callback_result')
    if (callbackResult) {
      sessionStorage.removeItem('oauth_callback_result')
      try {
        const { code, state } = JSON.parse(callbackResult)
        if (code && state) {
          handleOAuthCallbackResult(code, state)
        }
      } catch {
        // Invalid callback data
      }
    }
  }, [loadSettings])

  useEffect(() => {
    setLocalProvider(provider)
    setLocalApiKey(apiKey)
    setLocalModel(model)
    setLocalAuthMode(authMode)
    setLocalOAuthClientId(oauthClientId)
  }, [provider, apiKey, model, authMode, oauthClientId])

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

  const currentProviderInfo = AI_PROVIDERS.find((p) => p.id === localProvider)
  const needsKey = !isKeylessProvider(localProvider)
  const supportsOAuth = currentProviderInfo?.oauthSupported ?? false

  const handleSelectProvider = (p: ProviderInfo) => {
    setLocalProvider(p.id)
    setTestResult(null)
    setShowApiKey(false)
    // Reset auth mode based on what's saved for this provider
    if (provider === p.id) {
      setLocalAuthMode(authMode)
    } else {
      setLocalAuthMode('api_key')
    }
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
      if (localAuthMode !== authMode) {
        setAuthMode(localAuthMode)
      }
      toast.success(tCommon('status.success'))
    } catch {
      toast.error(tCommon('status.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleExportData = async () => {
    setIsExportingData(true)
    try {
      const bytes = await exportDatabaseSnapshot()
      const blob = new Blob([bytes], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `valute-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('data.exportSuccess'))
    } catch {
      toast.error(t('data.exportError'))
    } finally {
      setIsExportingData(false)
    }
  }

  const handleImportData = async (file: File) => {
    setIsImportingData(true)
    try {
      const buffer = await file.arrayBuffer()
      await importDatabaseSnapshot(new Uint8Array(buffer))
      toast.success(t('data.importSuccess'))
      window.location.reload()
    } catch {
      toast.error(t('data.importError'))
    } finally {
      setIsImportingData(false)
      if (importDbInputRef.current) {
        importDbInputRef.current.value = ''
      }
    }
  }

  const handleOAuthCallbackResult = useCallback(
    async (code: string, state: string) => {
      // Determine which provider and validate state for CSRF protection
      const googlePkce = loadPkceState('google')
      const openaiPkce = loadPkceState('openai')

      let config
      let verifier: string

      if (googlePkce && googlePkce.state === state) {
        config = createGoogleOAuthConfig(localOAuthClientId || oauthClientId)
        verifier = googlePkce.verifier
      } else if (openaiPkce && openaiPkce.state === state) {
        config = createOpenAICodexOAuthConfig()
        verifier = openaiPkce.verifier
      } else {
        toast.error('OAuth state mismatch or session expired — please try again')
        return
      }

      // Clear PKCE state after validation
      sessionStorage.removeItem(`oauth_${config.providerId}`)

      try {
        const tokens = await exchangeCodeForToken(config, code, verifier)

        let email: string | undefined
        let codexAccId: string | undefined

        if (config.providerId === 'google') {
          const userEmail = await fetchGoogleUserEmail(tokens.accessToken)
          if (userEmail) email = userEmail
        } else if (config.providerId === 'openai') {
          const accountId = extractAccountId(tokens.accessToken)
          if (accountId) codexAccId = accountId
        }

        await setOAuthTokens({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresIn: Math.floor((tokens.expiresAt - Date.now()) / 1000),
          email,
          codexAccountId: codexAccId,
        })

        setLocalAuthMode('oauth')
        toast.success('Signed in successfully')
      } catch (err) {
        toast.error(`OAuth failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    },
    [localOAuthClientId, oauthClientId, setOAuthTokens]
  )

  useEffect(() => {
    loadSettings()
    load('settings.json')
      .then(async (store) => {
        setAlphaVantageKey(((await store.get('alpha_vantage_key')) as string) || '')
        setFinnhubKey(((await store.get('finnhub_key')) as string) || '')
      })
      .catch(() => {})

    const callbackResult = sessionStorage.getItem('oauth_callback_result')
    if (callbackResult) {
      sessionStorage.removeItem('oauth_callback_result')
      try {
        const { code, state } = JSON.parse(callbackResult)
        if (code && state) {
          void handleOAuthCallbackResult(code, state)
        }
      } catch {
        // Invalid callback data
      }
    }
  }, [loadSettings, handleOAuthCallbackResult])

  const handleGoogleOAuth = async () => {
    if (!localOAuthClientId) {
      toast.error('Please enter your Google Cloud Client ID first')
      return
    }

    setIsOAuthLoading(true)
    try {
      await setOAuthClientId(localOAuthClientId)
      const config = createGoogleOAuthConfig(localOAuthClientId)
      const { code, verifier } = await startOAuthFlow(config)
      const tokens = await exchangeCodeForToken(config, code, verifier)

      const email = await fetchGoogleUserEmail(tokens.accessToken)

      await setOAuthTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: Math.floor((tokens.expiresAt - Date.now()) / 1000),
        email: email ?? undefined,
      })

      // Also save provider + model
      await saveSettings(localProvider, '', localModel)
      setLocalAuthMode('oauth')
      toast.success(`Signed in as ${email || 'Google user'}`)
    } catch (err) {
      if (err instanceof Error && err.message.includes('popup was closed')) {
        // User cancelled — not an error
      } else {
        toast.error(
          `Google sign-in failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    } finally {
      setIsOAuthLoading(false)
    }
  }

  const handleOpenAIOAuth = async () => {
    setIsOAuthLoading(true)
    try {
      const config = createOpenAICodexOAuthConfig()
      const { code, verifier } = await startOAuthFlow(config)
      const tokens = await exchangeCodeForToken(config, code, verifier)

      const accountId = extractAccountId(tokens.accessToken)

      await setOAuthTokens({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: Math.floor((tokens.expiresAt - Date.now()) / 1000),
        codexAccountId: accountId ?? undefined,
      })

      // Also save provider + model
      await saveSettings(localProvider, '', localModel)
      setLocalAuthMode('oauth')
      toast.success('Signed in with ChatGPT')
    } catch (err) {
      if (err instanceof Error && err.message.includes('popup was closed')) {
        // User cancelled
      } else {
        toast.error(
          `OpenAI sign-in failed: ${err instanceof Error ? err.message : 'Unknown error'}`
        )
      }
    } finally {
      setIsOAuthLoading(false)
    }
  }

  const handleSignOut = async () => {
    await clearOAuth()
    setLocalAuthMode('api_key')
    toast.success('Signed out')
  }

  const isOAuthConnected = authMode === 'oauth' && !!oauthAccessToken && provider === localProvider

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
              isActive &&
              (apiKey || isKeylessProvider(p.id) || (authMode === 'oauth' && oauthAccessToken))

            return (
              <button
                key={p.id}
                onClick={() => handleSelectProvider(p)}
                className={cn(
                  'glass-card relative flex flex-col items-start p-4 text-left transition-all duration-150',
                  isSelected ? 'border-accent ring-accent/20 ring-2' : 'hover:border-border-hover'
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
                    {isActive && authMode === 'oauth' && oauthAccessToken && (
                      <span
                        className="rounded-full px-2 py-0.5 font-mono text-[10px]"
                        style={{
                          background: 'var(--color-accent)',
                          color: '#fff',
                        }}
                      >
                        OAuth
                      </span>
                    )}
                    {isConfiguredProvider && <span className="bg-success h-2 w-2 rounded-full" />}
                  </div>
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{p.description}</p>
              </button>
            )
          })}
        </div>

        {/* Config Panel */}
        {currentProviderInfo && (
          <div className="glass-card animate-fade-in space-y-4 p-6">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-accent" />
              <h3 className="font-heading text-sm font-semibold">{currentProviderInfo.name}</h3>
            </div>

            {/* Auth mode toggle for OAuth-capable providers */}
            {supportsOAuth && (
              <div className="flex gap-0 overflow-hidden rounded-none border border-white/[0.06]">
                <button
                  type="button"
                  className={cn(
                    'flex-1 px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors',
                    localAuthMode === 'api_key'
                      ? 'bg-accent text-white'
                      : 'text-muted-foreground hover:text-foreground bg-[#0a0a0a]'
                  )}
                  onClick={() => setLocalAuthMode('api_key')}
                >
                  API Key
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex-1 px-4 py-2 font-mono text-xs tracking-wider uppercase transition-colors',
                    localAuthMode === 'oauth'
                      ? 'bg-accent text-white'
                      : 'text-muted-foreground hover:text-foreground bg-[#0a0a0a]'
                  )}
                  onClick={() => setLocalAuthMode('oauth')}
                >
                  Sign In
                </button>
              </div>
            )}

            {/* API Key section */}
            {(localAuthMode === 'api_key' || !supportsOAuth) && needsKey && (
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

            {/* OAuth section — Google */}
            {localAuthMode === 'oauth' && supportsOAuth && localProvider === 'google' && (
              <div className="space-y-3">
                {isOAuthConnected ? (
                  <div className="flex items-center gap-3">
                    <span className="text-success text-sm">
                      Connected as {oauthEmail || 'Google user'}
                    </span>
                    <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1">
                      <LogOut size={12} />
                      Sign out
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1">
                      <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                        Google Cloud Client ID
                      </Label>
                      <p className="text-muted-foreground text-[10px]">
                        Create at console.cloud.google.com &rarr; APIs &amp; Services &rarr;
                        Credentials &rarr; OAuth 2.0 Client ID (Web Application). Add{' '}
                        <code className="text-accent font-mono">
                          {window.location.origin}/oauth/callback
                        </code>{' '}
                        as authorized redirect URI.
                      </p>
                      <Input
                        placeholder="123456789-xxxxx.apps.googleusercontent.com"
                        value={localOAuthClientId}
                        onChange={(e) => setLocalOAuthClientId(e.target.value)}
                        className="max-w-md"
                      />
                    </div>
                    <Button
                      onClick={handleGoogleOAuth}
                      disabled={isOAuthLoading || !localOAuthClientId}
                      className="bg-accent font-mono text-xs tracking-wider text-white uppercase"
                    >
                      {isOAuthLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                      Sign in with Google
                    </Button>
                  </>
                )}
              </div>
            )}

            {/* OAuth section — OpenAI */}
            {localAuthMode === 'oauth' && supportsOAuth && localProvider === 'openai' && (
              <div className="space-y-3">
                {isOAuthConnected ? (
                  <div className="flex items-center gap-3">
                    <span className="text-success text-sm">Connected</span>
                    <Button variant="outline" size="sm" onClick={handleSignOut} className="gap-1">
                      <LogOut size={12} />
                      Sign out
                    </Button>
                  </div>
                ) : (
                  <>
                    <p className="text-muted-foreground text-[10px]">
                      Uses your ChatGPT Plus or Pro subscription
                    </p>
                    <Button
                      onClick={handleOpenAIOAuth}
                      disabled={isOAuthLoading}
                      className="bg-accent font-mono text-xs tracking-wider text-white uppercase"
                    >
                      {isOAuthLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                      Sign in with ChatGPT
                    </Button>
                  </>
                )}
              </div>
            )}

            {!needsKey && !supportsOAuth && (
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

      {/* Category Rules */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.categoryRules')}</h2>
        <p className="text-muted-foreground text-xs">
          {tTransactions('rules.description')}
        </p>

        {isLoadingRules ? (
          <div className="flex items-center gap-2 py-4">
            <Loader2 size={14} className="animate-spin" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        ) : rules.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            {tTransactions('rules.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground border-b border-white/[0.06] text-left font-mono text-xs uppercase tracking-wider">
                  <th className="pb-2 pr-4">{tTransactions('rules.pattern')}</th>
                  <th className="pb-2 pr-4">{tTransactions('rules.category')}</th>
                  <th className="pb-2 pr-4">{tTransactions('rules.hits')}</th>
                  <th className="pb-2">{tTransactions('rules.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-b border-white/[0.03]">
                    <td className="py-2 pr-4 font-mono text-xs">{rule.pattern}</td>
                    <td className="py-2 pr-4">
                      <span className="inline-flex items-center gap-1.5">
                        {rule.category_color && (
                          <span
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: rule.category_color }}
                          />
                        )}
                        <span className="text-xs">{rule.category_name ?? rule.category_id}</span>
                      </span>
                    </td>
                    <td className="text-muted-foreground py-2 pr-4 font-mono text-xs">
                      {rule.hit_count}
                    </td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => {
                          deleteRule(rule.id)
                          toast.success(tTransactions('rules.delete'))
                        }}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title={tTransactions('rules.delete')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">
          {t('sections.theme', 'Theme & Appearance')}
        </h2>
        <p className="text-muted-foreground text-xs">
          {t('theme.description', 'Customize the visual appearance of Valute')}
        </p>
        <ThemeSettings />
      </section>

      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.data')}</h2>
        <p className="text-muted-foreground text-xs">{t('data.resetWarning')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={handleExportData}
            disabled={isExportingData || isImportingData}
          >
            {isExportingData ? '...' : t('data.export')}
          </Button>
          <Button
            variant="outline"
            onClick={() => importDbInputRef.current?.click()}
            disabled={isExportingData || isImportingData}
          >
            {isImportingData ? '...' : t('data.import')}
          </Button>
          <input
            ref={importDbInputRef}
            type="file"
            accept=".db,.sqlite,application/octet-stream"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) {
                void handleImportData(file)
              }
            }}
          />
        </div>
      </section>

>>>>>>> Stashed changes
      {/* Data API Keys */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.dataApis')}</h2>
        <p className="text-muted-foreground text-xs">{t('dataApis.description')}</p>

        <div className="space-y-2">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            Alpha Vantage
          </Label>
          <p className="text-muted-foreground text-[10px]">{t('dataApis.alphaVantageHint')}</p>
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
          <p className="text-muted-foreground text-[10px]">{t('dataApis.finnhubHint')}</p>
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
