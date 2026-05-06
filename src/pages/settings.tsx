import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  BadgeDollarSign,
  CheckCircle2,
  Database,
  Download,
  Globe2,
  KeyRound,
  Loader2,
  MonitorUp,
  Palette,
  RefreshCw,
  RotateCcw,
  Settings,
  Tags,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUPPORTED_LANGUAGES } from '@/lib/constants'
import { useCategorizationStore } from '@/stores/categorization-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useAccountStore } from '@/stores/account-store'
import { COMMON_CURRENCIES } from '@/lib/exchange-rate-service'
import { getErrorMessage } from '@/lib/errors'
import { load } from '@/lib/storage'
import { exportDatabaseSnapshot, importDatabaseSnapshot } from '@/lib/database'
import { ThemeSettings } from '@/components/ThemeSettings'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ErrorBanner } from '@/components/ui/error-banner'
import {
  getAvailableUpdate,
  getCurrentAppVersion,
  installUpdate,
  relaunchToApplyUpdate,
} from '@/lib/updater'
import { isTauri } from '@/lib/runtime'
import type { AvailableUpdate } from '@/lib/updater'

export function SettingsPage() {
  const { t, i18n } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const { t: tTransactions } = useTranslation('transactions')

  const { rules, isLoading: isLoadingRules, loadRules, deleteRule } = useCategorizationStore()

  const [alphaVantageKey, setAlphaVantageKey] = useState('')
  const [finnhubKey, setFinnhubKey] = useState('')
  const [isSavingDataKeys, setIsSavingDataKeys] = useState(false)
  const [isExportingData, setIsExportingData] = useState(false)
  const [isImportingData, setIsImportingData] = useState(false)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [preImportBackupBytes, setPreImportBackupBytes] = useState<Uint8Array | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [readyUpdateVersion, setReadyUpdateVersion] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)
  const [isRestartingForUpdate, setIsRestartingForUpdate] = useState(false)
  const [updateCheckedAt, setUpdateCheckedAt] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [downloadedBytes, setDownloadedBytes] = useState(0)
  const [downloadTotalBytes, setDownloadTotalBytes] = useState<number | null>(null)
  const [lastUpdateAction, setLastUpdateAction] = useState<'check' | 'install' | 'restart' | null>(
    null
  )
  const [lastCheckResult, setLastCheckResult] = useState<'available' | 'none' | null>(null)
  const importDbInputRef = useRef<HTMLInputElement>(null)

  // Currency state
  const {
    preferredCurrency,
    lastFetched: ratesLastFetched,
    isLoading: ratesLoading,
    rates,
    loadRates,
    refreshRates: doRefreshRates,
    setPreferredCurrency,
  } = useCurrencyStore()
  const { accounts, fetch: fetchAccounts } = useAccountStore()

  useEffect(() => {
    loadRules()
    void loadRates().catch(() => {})
    void fetchAccounts().catch(() => {})
    if (isTauri) {
      void getCurrentAppVersion()
        .then((version) => setCurrentVersion(version))
        .catch(() => {})
    }
    load('settings.json')
      .then(async (store) => {
        setAlphaVantageKey(((await store.get('alpha_vantage_key')) as string) || '')
        setFinnhubKey(((await store.get('finnhub_key')) as string) || '')
      })
      .catch(() => {})
  }, [loadRules, loadRates, fetchAccounts])

  const handleCheckForUpdates = async () => {
    setIsCheckingUpdates(true)
    setUpdateError(null)
    setDownloadedBytes(0)
    setDownloadTotalBytes(null)
    setLastUpdateAction('check')

    try {
      const update = await getAvailableUpdate()
      setAvailableUpdate(update)
      setUpdateCheckedAt(new Date().toISOString())
      setLastCheckResult(update ? 'available' : 'none')

      if (update) {
        toast.success(t('updates.availableToast', { version: update.version }))
      } else {
        toast.success(t('updates.noneToast'))
      }
    } catch (error) {
      const message = getErrorMessage(error)
      setUpdateError(message)
      setLastCheckResult(null)
      toast.error(t('updates.errorToast'))
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  const handleInstallUpdate = async () => {
    if (!availableUpdate) return

    setIsInstallingUpdate(true)
    setUpdateError(null)
    setDownloadedBytes(0)
    setDownloadTotalBytes(null)
    setLastUpdateAction('install')

    try {
      const version = availableUpdate.version
      await installUpdate(availableUpdate, (progress) => {
        if (progress.event === 'Started') {
          setDownloadTotalBytes(progress.data.contentLength ?? null)
          setDownloadedBytes(0)
          return
        }

        if (progress.event === 'Progress') {
          setDownloadedBytes((current) => current + progress.data.chunkLength)
        }
      })
      setAvailableUpdate(null)
      setReadyUpdateVersion(version)
      toast.success(t('updates.installedToast', { version }))
    } catch (error) {
      const message = getErrorMessage(error)
      setUpdateError(message)
      toast.error(t('updates.installErrorToast'))
    } finally {
      setIsInstallingUpdate(false)
    }
  }

  const handleRestartToApplyUpdate = async () => {
    setIsRestartingForUpdate(true)
    setUpdateError(null)
    setLastUpdateAction('restart')

    try {
      await relaunchToApplyUpdate()
    } catch (error) {
      const message = getErrorMessage(error)
      setUpdateError(message)
      setIsRestartingForUpdate(false)
      toast.error(t('updates.restartErrorToast'))
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
      a.download = `shikin-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(t('data.exportSuccess'))
    } catch {
      toast.error(t('data.exportError'))
    } finally {
      setIsExportingData(false)
    }
  }

  const handleImportClick = async (file: File) => {
    // Create pre-import backup before showing confirmation
    try {
      const backupBytes = await exportDatabaseSnapshot()
      setPreImportBackupBytes(backupBytes)
    } catch {
      // Continue even if backup fails - user can still proceed
      setPreImportBackupBytes(null)
    }

    setPendingImportFile(file)
    setImportConfirmOpen(true)
  }

  const handleConfirmImport = async () => {
    if (!pendingImportFile) return

    setIsImportingData(true)
    try {
      const buffer = await pendingImportFile.arrayBuffer()
      await importDatabaseSnapshot(new Uint8Array(buffer))
      toast.success(t('data.importSuccess'))
      window.location.reload()
    } catch {
      toast.error(t('data.importError'))
    } finally {
      setIsImportingData(false)
      setImportConfirmOpen(false)
      setPendingImportFile(null)
      setPreImportBackupBytes(null)
      if (importDbInputRef.current) {
        importDbInputRef.current.value = ''
      }
    }
  }

  return (
    <div className="animate-fade-in-up page-content">
      <div className="liquid-hero relative overflow-hidden p-6 sm:p-8">
        <Settings
          size={260}
          className="pointer-events-none absolute -right-16 -bottom-24 text-white/[0.035]"
          aria-hidden="true"
        />
        <div className="relative z-10 grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr] xl:items-end">
          <div>
            <span className="text-accent mb-3 inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
              <Settings size={14} aria-hidden="true" />
              {t('title')}
            </span>
            <h1 className="font-heading text-4xl font-bold tracking-tight sm:text-5xl">
              {t('title')}
            </h1>
            <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
              {t(
                'settingsDescription',
                'Language, currency, updates, backups, and local app controls.'
              )}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 xl:grid-cols-1">
            <SettingsStatusTile
              icon={<Globe2 size={15} />}
              label={t('language.label')}
              value={
                SUPPORTED_LANGUAGES.find((lang) => lang.code === i18n.language)?.name ??
                i18n.language
              }
              tone="accent"
            />
            <SettingsStatusTile
              icon={<BadgeDollarSign size={15} />}
              label={t('currency.preferred')}
              value={preferredCurrency}
              tone="success"
            />
            <SettingsStatusTile
              icon={<MonitorUp size={15} />}
              label={t('updates.status')}
              value={readyUpdateVersion ? t('updates.readyShort') : t('updates.idle')}
              tone="muted"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.85fr_1.15fr]">
        <section className="liquid-card space-y-4 p-5 sm:p-6">
          <SectionTitle icon={<Globe2 size={18} />} title={t('sections.general')} />

          <div className="space-y-1">
            <Label
              htmlFor="language-select"
              className="text-muted-foreground font-mono text-xs tracking-wider uppercase"
            >
              {t('language.label')}
            </Label>
            <p className="text-muted-foreground text-xs">{t('language.description')}</p>
            <select
              id="language-select"
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              className="glass-input text-foreground mt-2 w-full px-3 py-2 text-sm"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="liquid-card space-y-4 p-5 sm:p-6">
          <SectionTitle
            icon={<MonitorUp size={18} />}
            title={t('sections.updates')}
            description={t('updates.description')}
          />

          {isTauri ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.035] px-4 py-3">
                  <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                    {t('updates.currentVersion')}
                  </p>
                  <p className="font-heading mt-1 text-base font-semibold">
                    {currentVersion ?? t('updates.loadingVersion')}
                  </p>
                </div>
                <div className="rounded-[18px] border border-white/[0.06] bg-white/[0.035] px-4 py-3">
                  <p className="text-muted-foreground font-mono text-[10px] tracking-wider uppercase">
                    {t('updates.status')}
                  </p>
                  <p className="font-heading mt-1 text-base font-semibold">
                    {readyUpdateVersion
                      ? t('updates.readyShort')
                      : availableUpdate
                        ? t('updates.available', { version: availableUpdate.version })
                        : t('updates.idle')}
                  </p>
                  {updateCheckedAt && (
                    <p className="text-muted-foreground mt-1 text-[11px]">
                      {t('updates.lastChecked', {
                        timestamp: new Date(updateCheckedAt).toLocaleString(),
                      })}
                    </p>
                  )}
                </div>
              </div>

              {/* Live status announcements for screen readers */}
              <div aria-live="polite" aria-atomic="true" className="sr-only">
                {isCheckingUpdates && t('updates.checking')}
                {!isCheckingUpdates &&
                  lastCheckResult === 'available' &&
                  availableUpdate &&
                  t('updates.availableToast', { version: availableUpdate.version })}
                {!isCheckingUpdates && lastCheckResult === 'none' && t('updates.noneToast')}
                {isInstallingUpdate &&
                  downloadTotalBytes &&
                  t('updates.downloadProgress', {
                    downloaded: formatBytes(downloadedBytes),
                    total: formatBytes(downloadTotalBytes),
                  })}
                {readyUpdateVersion && t('updates.readyTitle', { version: readyUpdateVersion })}
                {updateError && t('updates.errorTitle')}
              </div>

              {downloadTotalBytes && isInstallingUpdate && (
                <div className="space-y-2">
                  <ProgressBar
                    value={(downloadedBytes / downloadTotalBytes) * 100}
                    color="accent"
                    showLabel
                    size="md"
                    ariaLabel={t('updates.downloadProgressAria')}
                  />
                  <p className="text-muted-foreground text-xs">
                    {t('updates.downloadProgress', {
                      downloaded: formatBytes(downloadedBytes),
                      total: formatBytes(downloadTotalBytes),
                    })}
                  </p>
                </div>
              )}

              {updateError && (
                <ErrorBanner
                  title={t('updates.errorTitle')}
                  message={updateError}
                  retryLabel={t('updates.retry')}
                  onRetry={() => {
                    // Retry the explicitly tracked last action
                    if (lastUpdateAction === 'install') {
                      void handleInstallUpdate()
                    } else if (lastUpdateAction === 'restart') {
                      void handleRestartToApplyUpdate()
                    } else {
                      void handleCheckForUpdates()
                    }
                  }}
                />
              )}

              {readyUpdateVersion && !updateError && (
                <div className="border-success/20 bg-success/10 flex items-start gap-3 rounded-xl border px-4 py-3">
                  <CheckCircle2 size={18} className="text-success mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {t('updates.readyTitle', { version: readyUpdateVersion })}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t('updates.readyDescription')}
                    </p>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    void handleCheckForUpdates()
                  }}
                  disabled={isCheckingUpdates || isInstallingUpdate || isRestartingForUpdate}
                >
                  {isCheckingUpdates ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                  {isCheckingUpdates ? t('updates.checking') : t('updates.check')}
                </Button>

                {availableUpdate && (
                  <Button
                    onClick={() => {
                      void handleInstallUpdate()
                    }}
                    disabled={isInstallingUpdate || isRestartingForUpdate}
                  >
                    {isInstallingUpdate ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    {isInstallingUpdate ? t('updates.installing') : t('updates.install')}
                  </Button>
                )}

                {readyUpdateVersion && (
                  <Button
                    onClick={() => {
                      void handleRestartToApplyUpdate()
                    }}
                    disabled={isRestartingForUpdate}
                  >
                    {isRestartingForUpdate ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    {isRestartingForUpdate ? t('updates.restarting') : t('updates.restart')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">{t('updates.desktopOnly')}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
        <section className="liquid-card space-y-4 p-5 sm:p-6">
          <SectionTitle icon={<BadgeDollarSign size={18} />} title={t('sections.currency')} />

          <div className="space-y-1">
            <Label
              htmlFor="currency-select"
              className="text-muted-foreground font-mono text-xs tracking-wider uppercase"
            >
              {t('currency.preferred')}
            </Label>
            <p className="text-muted-foreground text-xs">{t('currency.preferredDescription')}</p>
            <select
              id="currency-select"
              value={preferredCurrency}
              onChange={(e) => {
                setPreferredCurrency(e.target.value)
                toast.success(tCommon('status.success'))
              }}
              className="glass-input text-foreground mt-2 w-full px-3 py-2 text-sm"
            >
              {COMMON_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await doRefreshRates()
                  toast.success(tCommon('status.success'))
                } catch {
                  toast.error(tCommon('status.error'))
                }
              }}
              disabled={ratesLoading}
            >
              {ratesLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              {ratesLoading ? t('currency.refreshing') : t('currency.refreshRates')}
            </Button>
            <span className="text-muted-foreground font-mono text-[10px]">
              {t('currency.lastUpdated')}: {ratesLastFetched || t('currency.never')}
            </span>
          </div>

          {/* Show rates for user's account currencies */}
          {(() => {
            const accountCurrencies = [...new Set(accounts.map((a) => a.currency))]
            const relevantRates = accountCurrencies
              .filter((c) => c !== preferredCurrency)
              .map((c) => {
                const key = `${c}:${preferredCurrency}`
                return { from: c, rate: rates[key] }
              })
              .filter((r) => r.rate !== null && r.rate !== undefined)

            if (relevantRates.length === 0) return null

            return (
              <div className="space-y-2">
                <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
                  {t('currency.currentRates')}
                </Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {relevantRates.map(({ from, rate }) => (
                    <div
                      key={from}
                      className="flex items-center justify-between rounded-[16px] border border-white/[0.06] bg-white/[0.035] px-3 py-2"
                    >
                      <span className="font-mono text-xs">1 {from}</span>
                      <span className="font-heading text-primary text-sm font-semibold">
                        {rate!.toFixed(4)} {preferredCurrency}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </section>
        <section className="liquid-card space-y-4 p-5 sm:p-6">
          <SectionTitle
            icon={<Tags size={18} />}
            title={t('sections.categoryRules')}
            description={tTransactions('rules.description')}
          />

          {isLoadingRules ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 size={14} className="animate-spin" />
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          ) : rules.length === 0 ? (
            <p className="text-muted-foreground py-4 text-sm">{tTransactions('rules.empty')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b border-white/[0.06] text-left font-mono text-xs tracking-wider uppercase">
                    <th scope="col" className="pr-4 pb-2">
                      {tTransactions('rules.pattern')}
                    </th>
                    <th scope="col" className="pr-4 pb-2">
                      {tTransactions('rules.category')}
                    </th>
                    <th scope="col" className="pr-4 pb-2">
                      {tTransactions('rules.hits')}
                    </th>
                    <th scope="col" className="pb-2">
                      {tTransactions('rules.actions')}
                    </th>
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
                              aria-hidden="true"
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
                          aria-label={`${tTransactions('rules.delete')}: ${rule.pattern}`}
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
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="liquid-card space-y-4 p-5 sm:p-6">
          <SectionTitle
            icon={<Palette size={18} />}
            title={t('sections.theme', 'Theme & Appearance')}
            description={t('theme.description', 'Customize the visual appearance of Shikin')}
          />
          <ThemeSettings />
        </section>

        <div className="space-y-3">
          <section className="liquid-card space-y-4 p-5 sm:p-6">
            <SectionTitle
              icon={<Database size={18} />}
              title={t('sections.data')}
              description={t('data.resetWarning')}
            />
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
                    void handleImportClick(file)
                  }
                }}
              />
            </div>
          </section>

          <section className="liquid-card space-y-4 p-5 sm:p-6">
            <SectionTitle
              icon={<KeyRound size={18} />}
              title={t('sections.dataApis')}
              description={t('dataApis.description')}
            />

            <div className="space-y-2">
              <Label
                htmlFor="alpha-vantage-key"
                className="text-muted-foreground font-mono text-xs tracking-wider uppercase"
              >
                Alpha Vantage
              </Label>
              <p className="text-muted-foreground text-[10px]">{t('dataApis.alphaVantageHint')}</p>
              <Input
                id="alpha-vantage-key"
                type="password"
                placeholder="Alpha Vantage API key"
                value={alphaVantageKey}
                onChange={(e) => setAlphaVantageKey(e.target.value)}
                className="max-w-md"
              />
            </div>

            <div className="space-y-2">
              <Label
                htmlFor="finnhub-key"
                className="text-muted-foreground font-mono text-xs tracking-wider uppercase"
              >
                Finnhub
              </Label>
              <p className="text-muted-foreground text-[10px]">{t('dataApis.finnhubHint')}</p>
              <Input
                id="finnhub-key"
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
      </div>

      <ConfirmDialog
        open={importConfirmOpen}
        onOpenChange={(open) => {
          if (!open) {
            // Dialog closing without confirmation - download backup if available
            if (preImportBackupBytes) {
              const blob = new Blob([preImportBackupBytes], { type: 'application/octet-stream' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `shikin-pre-import-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.db`
              a.click()
              URL.revokeObjectURL(url)
              toast.success('Pre-import backup downloaded')
            }
            setPendingImportFile(null)
            setPreImportBackupBytes(null)
            if (importDbInputRef.current) {
              importDbInputRef.current.value = ''
            }
          }
          setImportConfirmOpen(open)
        }}
        title="Destructive Import Confirmation"
        description="Importing a database will completely replace all current data including accounts, transactions, and settings. This action cannot be undone. A backup of your current data has been prepared and will be downloaded if you cancel."
        confirmLabel="Yes, Replace All Data"
        cancelLabel="Cancel and Keep Current Data"
        variant="destructive"
        isLoading={isImportingData}
        onConfirm={handleConfirmImport}
      />
    </div>
  )
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function SectionTitle({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode
  title: string
  description?: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="border-accent/20 bg-accent/10 text-accent flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border">
        {icon}
      </div>
      <div className="min-w-0">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {description && <p className="text-muted-foreground mt-1 text-xs">{description}</p>}
      </div>
    </div>
  )
}

function SettingsStatusTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'accent' | 'success' | 'muted'
}) {
  const toneClass = {
    accent: 'text-accent',
    success: 'text-success',
    muted: 'text-muted-foreground',
  }[tone]

  return (
    <div className="rounded-[18px] border border-white/[0.06] bg-black/20 p-4 backdrop-blur-xl">
      <div className="text-muted-foreground mb-2 flex items-center gap-2">
        <span className={toneClass}>{icon}</span>
        <span className="font-mono text-[10px] tracking-wider uppercase">{label}</span>
      </div>
      <p className="font-heading truncate text-lg font-bold">{value}</p>
    </div>
  )
}
