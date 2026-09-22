import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Edit3, Loader2, Plus } from 'lucide-react'
import dayjs from 'dayjs'
import { FX_CURRENCIES, type DatedExchangeRate } from '@shikin/finance-core/fx'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { getErrorMessage } from '@/lib/errors'
import { useCurrencyStore } from '@/stores/currency-store'

function defaultTarget(fromCurrency: string, preferredCurrency: string): string {
  if (preferredCurrency !== fromCurrency) return preferredCurrency
  return FX_CURRENCIES.find((currency) => currency !== fromCurrency) ?? 'EUR'
}

export function CurrencySettings() {
  const { t } = useTranslation('settings')
  const { t: tCommon } = useTranslation('common')
  const {
    mainCurrency,
    preferredCurrency,
    manualRates,
    isLoading,
    error,
    setPreferredCurrency,
    saveExchangeRate,
  } = useCurrencyStore()
  const today = dayjs().format('YYYY-MM-DD')
  const [mainDraft, setMainDraft] = useState(preferredCurrency)
  const [fromCurrency, setFromCurrency] = useState('USD')
  const [toCurrency, setToCurrency] = useState(() =>
    defaultTarget('USD', mainCurrency ?? preferredCurrency)
  )
  const [rateDecimal, setRateDecimal] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(today)
  const [sourceNote, setSourceNote] = useState('')
  const [auditNote, setAuditNote] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [correction, setCorrection] = useState<DatedExchangeRate | null>(null)
  const [isSavingMain, setIsSavingMain] = useState(false)
  const [isSavingRate, setIsSavingRate] = useState(false)

  useEffect(() => setMainDraft(preferredCurrency), [preferredCurrency])

  useEffect(() => {
    if (!correction && mainCurrency && mainCurrency !== fromCurrency) {
      setToCurrency(mainCurrency)
    }
  }, [correction, fromCurrency, mainCurrency])

  const supersededIds = useMemo(
    () =>
      new Set(
        manualRates.flatMap((rate) => (rate.supersedesRateId ? [rate.supersedesRateId] : []))
      ),
    [manualRates]
  )
  const displayedRates = useMemo(
    () =>
      [...manualRates].sort(
        (a, b) =>
          b.effectiveFrom.localeCompare(a.effectiveFrom) ||
          b.createdAt.localeCompare(a.createdAt) ||
          b.id.localeCompare(a.id)
      ),
    [manualRates]
  )
  const historicalChange = Boolean(correction) || effectiveFrom < today

  const resetRateForm = () => {
    const nextFrom = 'USD'
    setCorrection(null)
    setFromCurrency(nextFrom)
    setToCurrency(defaultTarget(nextFrom, mainCurrency ?? preferredCurrency))
    setRateDecimal('')
    setEffectiveFrom(today)
    setSourceNote('')
    setAuditNote('')
    setAcknowledged(false)
  }

  const beginCorrection = (rate: DatedExchangeRate) => {
    setCorrection(rate)
    setFromCurrency(rate.fromCurrency)
    setToCurrency(rate.toCurrency)
    setRateDecimal(rate.rateDecimal)
    setEffectiveFrom(rate.effectiveFrom)
    setSourceNote(rate.sourceNote ?? '')
    setAuditNote('')
    setAcknowledged(false)
    document
      .getElementById('manual-fx-form')
      ?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  const saveMain = async () => {
    setIsSavingMain(true)
    try {
      await setPreferredCurrency(mainDraft)
      toast.success(t('currency.mainSaved', { currency: mainDraft }))
    } catch (saveError) {
      toast.error(getErrorMessage(saveError, tCommon('status.error')))
    } finally {
      setIsSavingMain(false)
    }
  }

  const saveRate = async (event: React.FormEvent) => {
    event.preventDefault()
    setIsSavingRate(true)
    try {
      await saveExchangeRate({
        fromCurrency,
        toCurrency,
        rateDecimal,
        effectiveFrom,
        replacesRateId: correction?.id ?? null,
        sourceNote: sourceNote.trim() || null,
        auditNote: historicalChange ? auditNote.trim() : null,
        acknowledgeHistoricalChange: historicalChange ? acknowledged : false,
      })
      toast.success(t(correction ? 'currency.correctionSaved' : 'currency.rateSaved'))
      resetRateForm()
    } catch (saveError) {
      toast.error(getErrorMessage(saveError, tCommon('status.error')))
    } finally {
      setIsSavingRate(false)
    }
  }

  return (
    <div className="space-y-6">
      {!mainCurrency && (
        <div className="border-warning/30 bg-warning/10 flex items-start gap-3 rounded-xl border p-4">
          <AlertTriangle className="text-warning mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{t('currency.setupRequiredTitle')}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {t('currency.setupRequiredDescription', { currency: preferredCurrency })}
            </p>
          </div>
        </div>
      )}

      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="main-currency" className="font-mono text-xs tracking-wider uppercase">
            {t('currency.mainCurrency')}
          </Label>
          <p className="text-muted-foreground text-xs">{t('currency.mainDescription')}</p>
        </div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end">
          <select
            id="main-currency"
            value={mainDraft}
            onChange={(event) => setMainDraft(event.target.value)}
            className="native-select min-w-0 flex-1"
            disabled={isSavingMain}
          >
            {FX_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
          <Button
            type="button"
            onClick={() => void saveMain()}
            disabled={isSavingMain || mainDraft === mainCurrency}
            className="w-full sm:w-auto"
          >
            {isSavingMain ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2 className="size-4" />
            )}
            {isSavingMain ? tCommon('actions.saving') : t('currency.saveMain')}
          </Button>
        </div>
        <p className="border-border bg-muted/40 text-muted-foreground rounded-lg border px-3 py-2 text-xs leading-relaxed">
          {t('currency.mainChangeWarning')}
        </p>
      </div>

      <form
        id="manual-fx-form"
        className="border-border space-y-4 border-t pt-5"
        onSubmit={saveRate}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">
              {t(correction ? 'currency.correctRate' : 'currency.addRate')}
            </h3>
            <p className="text-muted-foreground mt-1 text-xs">{t('currency.directionHelp')}</p>
          </div>
          {correction && (
            <Button type="button" variant="outline" size="sm" onClick={resetRateForm}>
              {tCommon('actions.cancel')}
            </Button>
          )}
        </div>

        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fx-from">{t('currency.from')}</Label>
            <select
              id="fx-from"
              value={fromCurrency}
              onChange={(event) => {
                const next = event.target.value
                setFromCurrency(next)
                if (next === toCurrency) {
                  setToCurrency(defaultTarget(next, mainCurrency ?? preferredCurrency))
                }
              }}
              className="native-select w-full min-w-0"
              disabled={Boolean(correction)}
            >
              {FX_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fx-to">{t('currency.to')}</Label>
            <select
              id="fx-to"
              value={toCurrency}
              onChange={(event) => setToCurrency(event.target.value)}
              className="native-select w-full min-w-0"
              disabled={Boolean(correction)}
            >
              {FX_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fx-rate">{t('currency.rateDecimal')}</Label>
            <Input
              id="fx-rate"
              value={rateDecimal}
              onChange={(event) => setRateDecimal(event.target.value)}
              inputMode="decimal"
              placeholder="17.25"
              autoComplete="off"
              required
            />
            <p className="text-muted-foreground text-[11px]">
              {t('currency.rateMeaning', { from: fromCurrency, to: toCurrency })}
            </p>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="fx-effective-from">{t('currency.effectiveFrom')}</Label>
            <Input
              id="fx-effective-from"
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
              disabled={Boolean(correction)}
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fx-source-note">{t('currency.sourceNote')}</Label>
          <Input
            id="fx-source-note"
            value={sourceNote}
            onChange={(event) => setSourceNote(event.target.value)}
            maxLength={1000}
            placeholder={t('currency.sourceNotePlaceholder')}
          />
        </div>

        {historicalChange && (
          <div className="border-warning/30 bg-warning/10 space-y-3 rounded-xl border p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p className="text-xs leading-relaxed">{t('currency.historicalWarning')}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fx-audit-note">{t('currency.auditNote')}</Label>
              <Input
                id="fx-audit-note"
                value={auditNote}
                onChange={(event) => setAuditNote(event.target.value)}
                maxLength={1000}
                required
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-0.5 size-4 shrink-0"
                required
              />
              <span>{t('currency.acknowledgeHistorical')}</span>
            </label>
          </div>
        )}

        {fromCurrency === toCurrency && (
          <p role="alert" className="text-destructive text-xs">
            {t('currency.sameCurrencyError')}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-xs break-words">
            {error}
          </p>
        )}

        <Button
          type="submit"
          disabled={
            isSavingRate ||
            isLoading ||
            fromCurrency === toCurrency ||
            (historicalChange && (!auditNote.trim() || !acknowledged))
          }
          className="w-full sm:w-auto"
        >
          {isSavingRate ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          {isSavingRate
            ? tCommon('actions.saving')
            : t(correction ? 'currency.saveCorrection' : 'currency.saveRate')}
        </Button>
      </form>

      <div className="border-border space-y-3 border-t pt-5">
        <div>
          <h3 className="text-sm font-semibold">{t('currency.history')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">{t('currency.historyDescription')}</p>
        </div>
        {displayedRates.length === 0 ? (
          <p className="border-border bg-muted/30 text-muted-foreground rounded-lg border p-4 text-sm">
            {t('currency.emptyHistory')}
          </p>
        ) : (
          <ul className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            {displayedRates.map((rate) => {
              const corrected = supersededIds.has(rate.id)
              return (
                <li key={rate.id} className="border-border min-w-0 rounded-xl border p-4">
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold break-words">
                        {rate.fromCurrency} → {rate.toCurrency}
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        {t('currency.effectiveLabel', { date: rate.effectiveFrom })}
                      </p>
                    </div>
                    <span
                      className={
                        corrected
                          ? 'bg-muted text-muted-foreground rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'
                          : 'bg-success/10 text-success rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide uppercase'
                      }
                    >
                      {t(corrected ? 'currency.statusCorrected' : 'currency.statusCurrent')}
                    </span>
                  </div>
                  <p className="mt-3 font-mono text-base break-all tabular-nums">
                    1 {rate.fromCurrency} = {rate.rateDecimal} {rate.toCurrency}
                  </p>
                  {rate.sourceNote && (
                    <p className="text-muted-foreground mt-2 text-xs break-words">
                      {rate.sourceNote}
                    </p>
                  )}
                  <div className="mt-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
                    <span className="text-muted-foreground min-w-0 font-mono text-[10px] break-all">
                      {rate.id}
                    </span>
                    {!corrected && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => beginCorrection(rate)}
                      >
                        <Edit3 className="size-3.5" />
                        {t('currency.correct')}
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
