import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/ui/error-banner'
import {
  listBudgetHistory,
  recordBudgetHistory,
  type AppBudgetHistoryRequest,
  type BudgetHistoryEntry,
} from '@/lib/budget-history'
import { formatMoney, toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { TRANSACTION_PAGE_INVALIDATION_EVENT } from '@/lib/transaction-query-events'
import { ScopeSummary } from '@/components/budgets/scoped-result'
import { useBudgetStore } from '@/stores/budget-store'

function currentMonth() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

export function BudgetHistoryPanel({ initialBudgetId }: { initialBudgetId?: string }) {
  const { t } = useTranslation('budgets')
  const references = useBudgetStore((state) => state.references)
  const [budgetId, setBudgetId] = useState(initialBudgetId ?? '')
  const [month, setMonth] = useState(currentMonth)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')
  const [view, setView] = useState<Awaited<ReturnType<typeof listBudgetHistory>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{
    request: AppBudgetHistoryRequest
    history: BudgetHistoryEntry
  } | null>(null)
  const sequence = useRef(0)
  const invalidateRead = useCallback(() => {
    sequence.current += 1
  }, [])
  const load = useCallback(async () => {
    const owned = ++sequence.current
    setLoading(true)
    try {
      const next = await listBudgetHistory(budgetId || undefined)
      if (owned === sequence.current) {
        setView(next)
        setError(null)
      }
    } catch (cause) {
      if (owned === sequence.current) setError(getErrorMessage(cause))
    } finally {
      if (owned === sequence.current) setLoading(false)
    }
  }, [budgetId])
  useEffect(() => {
    void load()
    const refresh = () => {
      setPreview(null)
      void load()
    }
    window.addEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
    return () => {
      invalidateRead()
      window.removeEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
    }
  }, [load, invalidateRead])
  const choices = useMemo(() => {
    const result = new Map(view?.budgets.map((row) => [row.id, row.name]) ?? [])
    for (const row of view?.history ?? [])
      if (!result.has(row.budgetId)) result.set(row.budgetId, row.configuration.name)
    return [...result].sort((a, b) => a[1].localeCompare(b[1]))
  }, [view])
  const latest = view?.history.find((row) => row.budgetId === budgetId && row.month === month)
  const liveBudget = view?.budgets.find((row) => row.id === budgetId)
  const selectedCurrency = latest?.configuration.currency ?? liveBudget?.currency ?? '—'
  const clearPreview = () => setPreview(null)

  const prepare = async () => {
    if (!budgetId || !reason.trim() || !month) return
    setBusy(true)
    setError(null)
    try {
      const correctionAmount = amount.trim() ? toCentavos(Number(amount)) : undefined
      const request: AppBudgetHistoryRequest = {
        budgetId,
        month,
        expectedRevision: latest?.revision ?? 0,
        idempotencyKey: generateId(),
        reason: reason.trim(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        ...(correctionAmount === undefined
          ? {}
          : { correction: { amountCentavos: correctionAmount } }),
      }
      const result = await recordBudgetHistory(request, true)
      setPreview({
        request: {
          ...request,
          expectedDataRevision: result.history.sourceState.dataRevision,
          expectedToken: result.previewToken,
        },
        history: result.history,
      })
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      await recordBudgetHistory(preview.request)
      setPreview(null)
      setReason('')
      setAmount('')
      await load()
    } catch (cause) {
      setError(getErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const money = (value: number | null, currency: string) =>
    value === null ? t('history.unknown') : formatMoney(value, currency)
  const selectedMeasure =
    preview?.history.configuration.basis === 'net_consumption'
      ? preview.history.net
      : preview?.history.gross

  return (
    <section className="native-panel space-y-4 p-5 sm:p-6" aria-labelledby="budget-history-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold" id="budget-history-heading">
          {t('history.title')}
        </h2>
        <Button
          variant="outline"
          disabled={busy || loading}
          onClick={() => {
            clearPreview()
            void load()
          }}
        >
          {t('scoped.refresh')}
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">{t('history.description')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{t('history.budget')}</span>
          <select
            className="bg-background border-border block min-h-11 w-full rounded-lg border px-3"
            value={budgetId}
            disabled={busy}
            onChange={(event) => {
              setBudgetId(event.target.value)
              clearPreview()
            }}
          >
            <option value="">{t('history.allBudgets')}</option>
            {choices.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>{t('history.month')}</span>
          <input
            type="month"
            className="bg-background border-border block min-h-11 w-full rounded-lg border px-3"
            value={month}
            max={currentMonth()}
            disabled={busy}
            onChange={(event) => {
              setMonth(event.target.value)
              clearPreview()
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{t('history.limitCorrection', { currency: selectedCurrency })}</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className="bg-background border-border block min-h-11 w-full rounded-lg border px-3"
            value={amount}
            disabled={busy}
            placeholder={
              latest
                ? String(latest.configuration.amountCentavos / 100)
                : liveBudget
                  ? String(liveBudget.amount / 100)
                  : ''
            }
            onChange={(event) => {
              setAmount(event.target.value)
              clearPreview()
            }}
          />
        </label>
        <label className="space-y-1 text-sm">
          <span>{t('history.reason')}</span>
          <input
            className="bg-background border-border block min-h-11 w-full rounded-lg border px-3"
            value={reason}
            maxLength={1000}
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value)
              clearPreview()
            }}
          />
        </label>
      </div>
      <p className="text-muted-foreground text-xs">{t('history.reconstructionHelp')}</p>
      <Button
        variant="secondary"
        disabled={!budgetId || !reason.trim() || !month || busy || loading}
        onClick={() => void prepare()}
      >
        {latest ? t('history.previewCorrection') : t('history.previewCapture')}
      </Button>
      <ErrorBanner title={t('history.error')} message={error} />
      {preview && (
        <div className="border-border space-y-2 rounded-lg border p-4" role="status">
          <h3 className="font-medium">
            {t('history.previewTitle', {
              month: preview.history.month,
              revision: preview.history.revision,
            })}
          </h3>
          <p className="text-sm">
            {preview.history.configuration.name} ·{' '}
            {money(
              preview.history.configuration.amountCentavos,
              preview.history.configuration.currency
            )}{' '}
            · {t(`scoped.${preview.history.configuration.basis}`)}
          </p>
          <p className="text-muted-foreground text-xs">
            {preview.history.window.start} – {preview.history.window.end} ·{' '}
            {preview.history.window.timeZone}
          </p>
          <ScopeSummary result={{ scope: preview.history.configuration.scope }} {...references} />
          <p className="text-sm">
            {t('history.gross')}:{' '}
            {money(preview.history.gross.amountCentavos, preview.history.configuration.currency)} ·{' '}
            {t('history.net')}:{' '}
            {money(preview.history.net.amountCentavos, preview.history.configuration.currency)} ·{' '}
            {t('card.remaining')}:{' '}
            {money(
              selectedMeasure?.remainingCentavos ?? null,
              preview.history.configuration.currency
            )}
          </p>
          {(preview.history.retrospective ||
            preview.history.kind === 'retrospective_reconstruction') && (
            <p className="text-warning text-sm">{t('history.retrospective')}</p>
          )}
          {!preview.history.net.complete && (
            <p className="text-muted-foreground text-sm">{t('history.incompleteNet')}</p>
          )}
          <p className="text-muted-foreground text-xs">{t('history.appendHelp')}</p>
          <Button disabled={busy} onClick={() => void save()}>
            {t('history.save')}
          </Button>
        </div>
      )}
      {loading ? (
        <p role="status">{t('scoped.loading')}</p>
      ) : !view?.history.length ? (
        <p className="text-muted-foreground text-sm">{t('history.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-border border-b">
                <th className="p-2">{t('history.month')}</th>
                <th className="p-2">{t('history.budget')}</th>
                <th className="p-2">{t('history.limit')}</th>
                <th className="p-2">{t('history.gross')}</th>
                <th className="p-2">{t('history.net')}</th>
                <th className="p-2">{t('card.remaining')}</th>
                <th className="p-2">{t('history.revision')}</th>
              </tr>
            </thead>
            <tbody>
              {view.history.map((entry) => (
                <tr className="border-border border-b align-top" key={entry.id}>
                  <td className="p-2">
                    <button
                      className="text-primary underline"
                      disabled={busy}
                      onClick={() => {
                        setMonth(entry.month)
                        setBudgetId(entry.budgetId)
                        clearPreview()
                      }}
                    >
                      {entry.month}
                    </button>
                  </td>
                  <td className="p-2">
                    <div>{entry.configuration.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {t(`periods.${entry.configuration.period}`)} ·{' '}
                      {entry.retrospective
                        ? t('history.retrospectiveShort')
                        : t('history.captured')}
                    </div>
                    <div className="text-muted-foreground max-w-72 text-xs">{entry.reason}</div>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {money(entry.configuration.amountCentavos, entry.configuration.currency)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {money(entry.gross.amountCentavos, entry.configuration.currency)}
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {money(entry.net.amountCentavos, entry.configuration.currency)}
                    {!entry.net.complete && (
                      <div className="text-muted-foreground max-w-48 text-xs whitespace-normal">
                        {t('history.incompleteNet')}
                      </div>
                    )}
                  </td>
                  <td className="p-2">
                    {money(
                      (entry.configuration.basis === 'net_consumption' ? entry.net : entry.gross)
                        .remainingCentavos,
                      entry.configuration.currency
                    )}
                  </td>
                  <td className="p-2">
                    {entry.revision}
                    {entry.revision === 1 && (
                      <div className="text-muted-foreground text-xs">
                        {t('history.originalCapture')}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.truncated && (
            <p className="text-muted-foreground mt-2 text-xs">{t('history.truncated')}</p>
          )}
        </div>
      )}
    </section>
  )
}
