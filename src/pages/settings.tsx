import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SUPPORTED_LANGUAGES } from '@/lib/constants'
import { useCategorizationStore } from '@/stores/categorization-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useAccountStore } from '@/stores/account-store'
import { COMMON_CURRENCIES } from '@/lib/exchange-rate-service'
import { load } from '@/lib/storage'
import { exportDatabaseSnapshot, importDatabaseSnapshot } from '@/lib/database'
import { ThemeSettings } from '@/components/ThemeSettings'

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
    loadRates()
    fetchAccounts()
    load('settings.json')
      .then(async (store) => {
        setAlphaVantageKey(((await store.get('alpha_vantage_key')) as string) || '')
        setFinnhubKey(((await store.get('finnhub_key')) as string) || '')
      })
      .catch(() => {})
  }, [loadRules, loadRates, fetchAccounts])

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

      {/* Currency Settings */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.currency')}</h2>

        <div className="space-y-1">
          <Label className="text-muted-foreground font-mono text-xs tracking-wider uppercase">
            {t('currency.preferred')}
          </Label>
          <p className="text-muted-foreground text-xs">{t('currency.preferredDescription')}</p>
          <select
            value={preferredCurrency}
            onChange={(e) => {
              setPreferredCurrency(e.target.value)
              toast.success(tCommon('status.success'))
            }}
            className="glass-input text-foreground mt-1 w-full max-w-xs px-3 py-2 text-sm"
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
                    className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#0a0a0a] px-3 py-2"
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
      {/* Category Rules */}
      <section className="glass-card space-y-4 p-6">
        <h2 className="font-heading text-lg font-semibold">{t('sections.categoryRules')}</h2>
        <p className="text-muted-foreground text-xs">{tTransactions('rules.description')}</p>

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
                  <th className="pr-4 pb-2">{tTransactions('rules.pattern')}</th>
                  <th className="pr-4 pb-2">{tTransactions('rules.category')}</th>
                  <th className="pr-4 pb-2">{tTransactions('rules.hits')}</th>
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
          {t('theme.description', 'Customize the visual appearance of Shikin')}
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
