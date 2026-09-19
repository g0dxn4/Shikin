import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ErrorBanner } from '@/components/ui/error-banner'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatMoney, toCentavos } from '@/lib/money'
import { getErrorMessage } from '@/lib/errors'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { LegacyImportIdentityAction } from '@/components/transactions/legacy-import-identity-dialog'
import type { Account } from '@/types/database'
import {
  finalizeAccountStatementHistory,
  previewAccountBridgeSupersession,
  previewAccountStatementFinalization,
  readAccountMaintenance,
  setAccountSourceCoverage,
  settleAccountStagedTransactions,
  supersedeAccountReconciliationBridge,
  type AccountMaintenanceHistory,
  type FinalizationInput,
  type SupersessionInput,
} from '@/lib/account-reconciliation-service'

type FinalizationPreview = Awaited<ReturnType<typeof previewAccountStatementFinalization>>
type SupersessionPreview = Awaited<ReturnType<typeof previewAccountBridgeSupersession>>

function localDate(): string {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

function signedAmount(type: string, amount: number): number {
  return type === 'income' ? amount : -amount
}

export function AccountMaintenanceAction({ account }: { account: Account }) {
  const { t } = useTranslation('accountHistory')
  const [open, setOpen] = useState(false)
  if (account.account_mode === 'snapshot_only') return null
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="min-h-11 sm:min-h-9"
        onClick={() => setOpen(true)}
      >
        <History aria-hidden="true" />
        {t('action')}
      </Button>
      <AccountMaintenanceDialog account={account} open={open} onOpenChange={setOpen} />
    </>
  )
}

export function AccountMaintenanceDialog({
  account,
  open,
  onOpenChange,
}: {
  account: Account
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, i18n } = useTranslation('accountHistory')
  const [history, setHistory] = useState<AccountMaintenanceHistory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [coverageIds, setCoverageIds] = useState<string[]>([])
  const [periodStart, setPeriodStart] = useState(localDate())
  const [periodEnd, setPeriodEnd] = useState(localDate())
  const [observedBalance, setObservedBalance] = useState('')
  const [acknowledgeProvisional, setAcknowledgeProvisional] = useState(false)
  const [provisionalProvenance, setProvisionalProvenance] = useState('')
  const [finalizationPreview, setFinalizationPreview] = useState<FinalizationPreview | null>(null)
  const [settlementReviewed, setSettlementReviewed] = useState(false)
  const [bridgeId, setBridgeId] = useState('')
  const [supersessionPreview, setSupersessionPreview] = useState<SupersessionPreview | null>(null)
  const [coverageEditingId, setCoverageEditingId] = useState<string | undefined>()
  const [coverageSource, setCoverageSource] = useState('')
  const [coverageDocument, setCoverageDocument] = useState('')
  const [coverageStatus, setCoverageStatus] = useState<'verified' | 'provisional' | 'gap'>(
    'verified'
  )
  const [coverageZeroRows, setCoverageZeroRows] = useState(false)
  const requestSequenceRef = useRef(0)
  const busyOwnerRef = useRef(0)
  const contextEpochRef = useRef(0)
  const renderContextRef = useRef({ open, accountId: account.id })
  const currentContextRef = useRef({ open, accountId: account.id })
  currentContextRef.current = { open, accountId: account.id }
  if (renderContextRef.current.open !== open || renderContextRef.current.accountId !== account.id) {
    contextEpochRef.current += 1
    requestSequenceRef.current += 1
    renderContextRef.current = { open, accountId: account.id }
  }

  const contextIsCurrent = (epoch: number, accountId: string) =>
    epoch === contextEpochRef.current &&
    currentContextRef.current.open &&
    currentContextRef.current.accountId === accountId

  const reload = async (epoch = contextEpochRef.current): Promise<boolean> => {
    const requestId = ++requestSequenceRef.current
    const requestedAccountId = account.id
    if (contextIsCurrent(epoch, requestedAccountId)) setError(null)
    try {
      const result = await readAccountMaintenance(requestedAccountId)
      if (!contextIsCurrent(epoch, requestedAccountId) || requestId !== requestSequenceRef.current)
        return false
      setHistory(result)
      return true
    } catch (reason) {
      if (!contextIsCurrent(epoch, requestedAccountId) || requestId !== requestSequenceRef.current)
        return false
      setHistory(null)
      setError(getErrorMessage(reason, t('errors.load')))
      return true
    }
  }

  useEffect(() => {
    if (!open) {
      setBusy(false)
      return
    }
    setHistory(null)
    setError(null)
    setBusy(false)
    setSelectedIds([])
    setCoverageIds([])
    setFinalizationPreview(null)
    setSupersessionPreview(null)
    setSettlementReviewed(false)
    const epoch = contextEpochRef.current
    void reload(epoch)
    // Reload only when this dialog opens for a different account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, open])

  const staged = useMemo(
    () =>
      history?.transactions.filter(
        (row) =>
          row.account_id === account.id &&
          row.ledger_treatment === 'staged_no_balance_impact' &&
          row.is_archived === 0 &&
          !row.finalization_id
      ) ?? [],
    [account.id, history]
  )
  const selectedRows = useMemo(
    () => staged.filter((row) => selectedIds.includes(row.id)),
    [selectedIds, staged]
  )
  const selectedPending = selectedRows.filter((row) => row.status === 'pending')
  const selectedFinalizable = selectedRows.filter(
    (row) => row.status === 'posted' || row.status === 'cleared'
  )
  const activeBridges = useMemo(
    () =>
      history?.observations.flatMap((observation) => {
        const bridge = history.transactions.find(
          (row) =>
            row.id === observation.adjustment_transaction_id &&
            row.transaction_kind === 'reconciliation_bridge' &&
            row.is_archived === 0
        )
        return bridge ? [{ observation, bridge }] : []
      }) ?? [],
    [history]
  )

  const resetReviews = () => {
    contextEpochRef.current += 1
    requestSequenceRef.current += 1
    setBusy(false)
    setFinalizationPreview(null)
    setSupersessionPreview(null)
    setSettlementReviewed(false)
  }
  const toggle = (id: string, selected: boolean, setter: typeof setSelectedIds) => {
    setter((current) =>
      selected ? [...new Set([...current, id])] : current.filter((x) => x !== id)
    )
    resetReviews()
  }
  const run = async (
    operation: () => Promise<unknown>,
    after?: () => void,
    onError?: () => void
  ) => {
    const requestId = ++requestSequenceRef.current
    busyOwnerRef.current = requestId
    const epoch = contextEpochRef.current
    const requestedAccountId = account.id
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      // The database commit already happened. Invalidate page reads even if refresh failed
      // or this controlled dialog closed while the operation was in flight.
      invalidateTransactionPage('store-refresh')
      if (!contextIsCurrent(epoch, requestedAccountId)) return
      after?.()
      await reload(epoch)
      if (
        contextIsCurrent(epoch, requestedAccountId) &&
        typeof result === 'object' &&
        result !== null &&
        'refreshIncomplete' in result &&
        result.refreshIncomplete === true
      )
        setError(t('errors.savedRefreshFailed'))
    } catch (reason) {
      if (!contextIsCurrent(epoch, requestedAccountId)) return
      onError?.()
      setError(getErrorMessage(reason, t('errors.operation')))
    } finally {
      if (busyOwnerRef.current === requestId && contextIsCurrent(epoch, requestedAccountId))
        setBusy(false)
    }
  }

  const runPreview = async <T,>(operation: () => Promise<T>, onSuccess: (value: T) => void) => {
    const requestId = ++requestSequenceRef.current
    busyOwnerRef.current = requestId
    const epoch = contextEpochRef.current
    const requestedAccountId = account.id
    setBusy(true)
    setError(null)
    try {
      const result = await operation()
      if (contextIsCurrent(epoch, requestedAccountId) && requestId === requestSequenceRef.current)
        onSuccess(result)
    } catch (reason) {
      if (contextIsCurrent(epoch, requestedAccountId) && requestId === requestSequenceRef.current)
        setError(getErrorMessage(reason, t('errors.preview')))
    } finally {
      if (
        busyOwnerRef.current === requestId &&
        contextIsCurrent(epoch, requestedAccountId) &&
        requestId === requestSequenceRef.current
      )
        setBusy(false)
    }
  }

  const finalizationInput = (): FinalizationInput => {
    const numericBalance = Number(observedBalance)
    if (!observedBalance.trim() || !Number.isFinite(numericBalance))
      throw new Error(t('errors.balance'))
    return {
      accountId: account.id,
      transactionIds: selectedFinalizable.map((row) => row.id),
      coverageIds,
      acknowledgeProvisional,
      provisionalProvenance: provisionalProvenance || undefined,
      statementStartDate: periodStart,
      statementEndDate: periodEnd,
      actualBalanceCentavos: toCentavos(numericBalance),
    }
  }

  const supersessionInput = (): SupersessionInput => {
    const selected = activeBridges.find(({ bridge }) => bridge.id === bridgeId)
    if (!selected) throw new Error(t('errors.bridge'))
    return {
      accountId: account.id,
      reconciliationId: selected.observation.id,
      bridgeId: selected.bridge.id,
      transactionIds: selectedFinalizable.map((row) => row.id),
      coverageIds,
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          contextEpochRef.current += 1
          requestSequenceRef.current += 1
          setBusy(false)
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{t('title', { account: account.name })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <ErrorBanner
          message={error}
          onRetry={history ? undefined : () => void reload(contextEpochRef.current)}
        />
        {!history && !error ? (
          <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
            <Loader2 className="animate-spin" aria-hidden="true" /> {t('loading')}
          </div>
        ) : null}

        {history ? (
          <div className="min-w-0 space-y-5">
            <section
              aria-labelledby="history-heading"
              className="border-border rounded-xl border p-4"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 id="history-heading" className="text-sm font-semibold">
                  {t('history.title')}
                </h3>
                <span className="text-muted-foreground text-xs">
                  {t('history.count', { count: history.observations.length })}
                </span>
              </div>
              {history.observations.length ? (
                <ul className="divide-border divide-y">
                  {history.observations.map((observation) => {
                    const bridge = history.transactions.find(
                      (row) => row.id === observation.adjustment_transaction_id
                    )
                    const correction = history.corrections.find(
                      (row) => row.original_reconciliation_id === observation.id
                    )
                    return (
                      <li
                        key={observation.id}
                        className="flex flex-wrap items-center gap-2 py-2 text-sm"
                      >
                        <time className="font-medium tabular-nums">
                          {observation.reconciliation_date}
                        </time>
                        <span className="tabular-nums">
                          {formatMoney(observation.actual_balance, account.currency, i18n.language)}
                        </span>
                        {bridge ? (
                          <Badge variant={bridge.is_archived ? 'outline' : 'secondary'}>
                            B{' '}
                            {formatMoney(
                              signedAmount(bridge.type, bridge.amount),
                              account.currency,
                              i18n.language
                            )}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{t('history.zeroBridge')}</Badge>
                        )}
                        {correction ? (
                          <Badge variant="outline">{t('history.superseded')}</Badge>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">{t('history.empty')}</p>
              )}
            </section>

            <section
              aria-labelledby="coverage-heading"
              className="border-border rounded-xl border p-4"
            >
              <h3 id="coverage-heading" className="mb-1 text-sm font-semibold">
                {t('coverage.title')}
              </h3>
              <p className="text-muted-foreground mb-3 text-xs">{t('coverage.description')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="coverage-source">{t('coverage.source')}</Label>
                  <Input
                    id="coverage-source"
                    value={coverageSource}
                    onChange={(event) => {
                      setCoverageSource(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="coverage-document">{t('coverage.document')}</Label>
                  <Input
                    id="coverage-document"
                    value={coverageDocument}
                    onChange={(event) => {
                      setCoverageDocument(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="period-start">{t('coverage.start')}</Label>
                  <Input
                    id="period-start"
                    type="date"
                    value={periodStart}
                    onChange={(event) => {
                      setPeriodStart(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="period-end">{t('coverage.end')}</Label>
                  <Input
                    id="period-end"
                    type="date"
                    value={periodEnd}
                    onChange={(event) => {
                      setPeriodEnd(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="coverage-status">{t('coverage.status')}</Label>
                  <select
                    id="coverage-status"
                    className="border-input bg-surface h-10 w-full rounded-lg border px-3 text-sm"
                    value={coverageStatus}
                    onChange={(event) => {
                      setCoverageStatus(event.target.value as typeof coverageStatus)
                      resetReviews()
                    }}
                  >
                    <option value="verified">{t('coverage.verified')}</option>
                    <option value="provisional">{t('coverage.provisional')}</option>
                    <option value="gap">{t('coverage.gap')}</option>
                  </select>
                </div>
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={coverageZeroRows}
                    onChange={(event) => {
                      setCoverageZeroRows(event.target.checked)
                      resetReviews()
                    }}
                  />
                  {t('coverage.zeroRows')}
                </label>
              </div>
              <Button
                className="mt-3 min-h-11 sm:min-h-10"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      setAccountSourceCoverage({
                        accountId: account.id,
                        coverageId: coverageEditingId,
                        sourceNamespace: coverageSource,
                        periodStart,
                        periodEnd,
                        status: coverageStatus,
                        zeroRows: coverageZeroRows,
                        documentRef: coverageDocument || null,
                      }),
                    () => {
                      setCoverageEditingId(undefined)
                      setCoverageSource('')
                      setCoverageDocument('')
                      setCoverageZeroRows(false)
                    }
                  )
                }
              >
                {coverageEditingId ? t('coverage.update') : t('coverage.save')}
              </Button>
              <fieldset className="mt-4 space-y-2">
                <legend className="text-xs font-medium">{t('coverage.select')}</legend>
                {history.coverage.length ? (
                  history.coverage.map((item) => (
                    <div
                      key={item.id}
                      className="border-border flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <label className="flex min-w-0 flex-1 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={coverageIds.includes(item.id)}
                          onChange={(event) =>
                            toggle(item.id, event.target.checked, setCoverageIds)
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{item.source_namespace}</span>{' '}
                          <span className="text-muted-foreground tabular-nums">
                            {item.period_start} – {item.period_end}
                          </span>
                        </span>
                        <Badge
                          variant={
                            item.status === 'gap'
                              ? 'destructive'
                              : item.status === 'provisional'
                                ? 'outline'
                                : 'secondary'
                          }
                        >
                          {t(`coverage.${item.status}`)}
                        </Badge>
                        {item.zero_rows ? <Badge variant="outline">0</Badge> : null}
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCoverageEditingId(item.id)
                          setCoverageSource(item.source_namespace)
                          setPeriodStart(item.period_start)
                          setPeriodEnd(item.period_end)
                          setCoverageStatus(item.status)
                          setCoverageZeroRows(item.zero_rows === 1)
                          setCoverageDocument(item.document_ref ?? '')
                          resetReviews()
                        }}
                      >
                        {t('coverage.edit')}
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">{t('coverage.empty')}</p>
                )}
              </fieldset>
            </section>

            <section
              aria-labelledby="staged-heading"
              className="border-border rounded-xl border p-4"
            >
              <h3 id="staged-heading" className="mb-1 text-sm font-semibold">
                {t('staged.title')}
              </h3>
              <p className="text-muted-foreground mb-3 text-xs">{t('staged.description')}</p>
              {staged.length ? (
                <fieldset className="space-y-2">
                  <legend className="sr-only">{t('staged.select')}</legend>
                  {staged.map((row) => (
                    <div key={row.id} className="border-border rounded-lg border px-3 py-2 text-sm">
                      <label className="flex min-h-11 items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(row.id)}
                          onChange={(event) => toggle(row.id, event.target.checked, setSelectedIds)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-medium">{row.description ?? row.id}</span>{' '}
                          <span className="text-muted-foreground block text-xs">
                            {row.date} · {row.import_source ?? t('staged.noSource')} ·{' '}
                            {row.staging_batch_id ?? t('staged.noBatch')}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(
                            signedAmount(row.type, row.amount),
                            account.currency,
                            i18n.language
                          )}
                        </span>
                        <Badge variant={row.status === 'pending' ? 'outline' : 'secondary'}>
                          {row.status}
                        </Badge>
                      </label>
                      {!row.import_source ? (
                        <div className="border-border mt-2 flex justify-end border-t pt-2">
                          <LegacyImportIdentityAction
                            transactionId={row.id}
                            onChanged={() => void reload(contextEpochRef.current)}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </fieldset>
              ) : (
                <p className="text-muted-foreground text-sm">{t('staged.empty')}</p>
              )}

              {selectedPending.length ? (
                <div className="bg-muted mt-3 rounded-lg p-3 text-sm">
                  <p>{t('settlement.review', { count: selectedPending.length })}</p>
                  {!settlementReviewed ? (
                    <Button
                      className="mt-2 min-h-11"
                      variant="outline"
                      onClick={() => setSettlementReviewed(true)}
                    >
                      {t('settlement.reviewAction')}
                    </Button>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        className="min-h-11"
                        disabled={busy}
                        onClick={() =>
                          run(
                            () =>
                              settleAccountStagedTransactions({
                                accountId: account.id,
                                transactionIds: selectedPending.map((row) => row.id),
                                status: 'posted',
                              }),
                            () => {
                              setSelectedIds([])
                              resetReviews()
                            }
                          )
                        }
                      >
                        {t('settlement.confirm')}
                      </Button>
                      <Button
                        className="min-h-11"
                        variant="ghost"
                        onClick={() => setSettlementReviewed(false)}
                      >
                        {t('cancel')}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="observed-balance">
                    {t('finalize.balance', { currency: account.currency })}
                  </Label>
                  <Input
                    id="observed-balance"
                    inputMode="decimal"
                    value={observedBalance}
                    onChange={(event) => {
                      setObservedBalance(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
                <label className="flex min-h-10 items-center gap-2 self-end text-sm">
                  <input
                    type="checkbox"
                    checked={acknowledgeProvisional}
                    onChange={(event) => {
                      setAcknowledgeProvisional(event.target.checked)
                      resetReviews()
                    }}
                  />
                  {t('finalize.acknowledge')}
                </label>
              </div>
              {acknowledgeProvisional ? (
                <div className="mt-3">
                  <Label htmlFor="provisional-note">{t('finalize.provenance')}</Label>
                  <Input
                    id="provisional-note"
                    value={provisionalProvenance}
                    onChange={(event) => {
                      setProvisionalProvenance(event.target.value)
                      resetReviews()
                    }}
                  />
                </div>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={busy || !selectedFinalizable.length}
                  onClick={() => {
                    setFinalizationPreview(null)
                    void runPreview(
                      () => previewAccountStatementFinalization(finalizationInput()),
                      setFinalizationPreview
                    )
                  }}
                >
                  {t('finalize.preview')}
                </Button>
                {finalizationPreview ? (
                  <Button
                    className="min-h-11"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          finalizeAccountStatementHistory({
                            ...finalizationInput(),
                            previewToken: finalizationPreview.previewToken,
                          }),
                        () => {
                          setSelectedIds([])
                          setFinalizationPreview(null)
                        },
                        () => setFinalizationPreview(null)
                      )
                    }
                  >
                    {t('finalize.confirm')}
                  </Button>
                ) : null}
              </div>
              {finalizationPreview ? (
                <div
                  role="status"
                  className="bg-muted mt-3 grid gap-2 rounded-lg p-3 text-sm sm:grid-cols-3"
                >
                  <span>
                    {t('finalize.rows')} <strong>{finalizationPreview.transactionCount}</strong>
                  </span>
                  <span>
                    {t('finalize.selectionEffect')}{' '}
                    <strong className="tabular-nums">
                      {formatMoney(
                        finalizationPreview.stagedBalanceEffect,
                        account.currency,
                        i18n.language
                      )}
                    </strong>
                  </span>
                  <span>
                    {t('finalize.bridge')}{' '}
                    <strong className="tabular-nums">
                      {formatMoney(finalizationPreview.adjustment, account.currency, i18n.language)}
                    </strong>
                  </span>
                </div>
              ) : null}
            </section>

            <section
              aria-labelledby="supersede-heading"
              className="border-border rounded-xl border p-4"
            >
              <h3 id="supersede-heading" className="mb-1 text-sm font-semibold">
                {t('supersede.title')}
              </h3>
              <p className="text-muted-foreground mb-3 text-xs">{t('supersede.description')}</p>
              <Label htmlFor="bridge-select">{t('supersede.bridge')}</Label>
              <select
                id="bridge-select"
                className="border-input bg-surface h-10 w-full rounded-lg border px-3 text-sm"
                value={bridgeId}
                onChange={(event) => {
                  setBridgeId(event.target.value)
                  resetReviews()
                }}
              >
                <option value="">{t('supersede.choose')}</option>
                {activeBridges.map(({ observation, bridge }) => (
                  <option key={bridge.id} value={bridge.id}>
                    {observation.reconciliation_date} ·{' '}
                    {formatMoney(
                      signedAmount(bridge.type, bridge.amount),
                      account.currency,
                      i18n.language
                    )}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="min-h-11"
                  variant="outline"
                  disabled={busy || !bridgeId || !selectedFinalizable.length}
                  onClick={() => {
                    setSupersessionPreview(null)
                    void runPreview(
                      () => previewAccountBridgeSupersession(supersessionInput()),
                      setSupersessionPreview
                    )
                  }}
                >
                  {t('supersede.preview')}
                </Button>
                {supersessionPreview ? (
                  <Button
                    className="min-h-11"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () =>
                          supersedeAccountReconciliationBridge({
                            ...supersessionInput(),
                            previewToken: supersessionPreview.previewToken,
                          }),
                        () => {
                          setSelectedIds([])
                          setSupersessionPreview(null)
                          setBridgeId('')
                        },
                        () => setSupersessionPreview(null)
                      )
                    }
                  >
                    {t('supersede.confirm')}
                  </Button>
                ) : null}
              </div>
              {supersessionPreview ? (
                <div role="status" className="bg-muted mt-3 space-y-2 rounded-lg p-3 text-sm">
                  <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                    <span>
                      B{' '}
                      <strong className="block">
                        {formatMoney(
                          supersessionPreview.originalSignedBridge,
                          account.currency,
                          i18n.language
                        )}
                      </strong>
                    </span>
                    <span>
                      R{' '}
                      <strong className="block">
                        {formatMoney(
                          supersessionPreview.replacementEffect,
                          account.currency,
                          i18n.language
                        )}
                      </strong>
                    </span>
                    <span>
                      S{' '}
                      <strong className="block">
                        {formatMoney(
                          supersessionPreview.successorSignedBridge,
                          account.currency,
                          i18n.language
                        )}
                      </strong>
                    </span>
                  </div>
                  <p>
                    {t('supersede.currentPreserved', {
                      stored: formatMoney(
                        supersessionPreview.currentStored,
                        account.currency,
                        i18n.language
                      ),
                      effective: formatMoney(
                        supersessionPreview.currentEffective,
                        account.currency,
                        i18n.language
                      ),
                    })}
                  </p>
                  <p>
                    {t('supersede.anchors', { count: supersessionPreview.laterAnchors.length })}
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
