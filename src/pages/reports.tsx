import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  normalizeReportScope,
  type ReportWindowInput,
  type ScopedReportGroupBy,
} from '@shikin/finance-core'
import { Button } from '@/components/ui/button'
import { NativePanel, PageToolbar } from '@/components/ui/native-layout'
import {
  CurrencyControl,
  ScopeControls,
  WindowControls,
  scopedSelectClass,
} from '@/components/budgets/scoped-controls'
import { ScopedActualResult, ScopedEstimateResult } from '@/components/budgets/scoped-result'
import { useScopedReport } from '@/components/budgets/use-scoped-report'
import type { ScopedReadInput, ScopedReferences } from '@/lib/scoped-report-read'

export function ReportsPage() {
  const { t } = useTranslation('budgets')
  const [basis, setBasis] = useState<ScopedReadInput['basis']>('gross_cashflow')
  const [scope, setScope] = useState(() => normalizeReportScope())
  const [currency, setCurrency] = useState('')
  const [groupBy, setGroupBy] = useState<ScopedReportGroupBy>('category')
  const [window, setWindow] = useState<ReportWindowInput>({})
  const { data, error, loading, refresh } = useScopedReport({
    basis,
    scope,
    currency: currency || undefined,
    groupBy,
    window,
  })
  // Option labels may survive loading; financial values below are always request-owned.
  const [references, setReferences] = useState<ScopedReferences>({ accounts: [], categories: [] })
  if (data && (references.accounts !== data.accounts || references.categories !== data.categories))
    setReferences({ accounts: data.accounts, categories: data.categories })
  return (
    <div className="page-content">
      <PageToolbar
        className="flex-col items-stretch sm:flex-row sm:items-center"
        leading={<p className="text-muted-foreground text-sm">{t('scoped.reportDescription')}</p>}
        actions={
          <Button variant="outline" onClick={refresh}>
            {t('scoped.refresh')}
          </Button>
        }
      />
      <NativePanel className="min-w-0 space-y-3 p-4 sm:p-5">
        <div className="grid min-w-0 gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            {t('scoped.basis')}
            <select
              className={scopedSelectClass}
              value={basis}
              onChange={(e) => setBasis(e.target.value as ScopedReadInput['basis'])}
            >
              {(['gross_cashflow', 'net_consumption', 'recurring_estimate'] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {t(`scoped.${value}`)}
                  </option>
                )
              )}
            </select>
          </label>
          <CurrencyControl allowDefault value={currency} onChange={setCurrency} />
          <label className="grid gap-1 text-sm">
            {t('scoped.groupBy')}
            <select
              className={scopedSelectClass}
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as ScopedReportGroupBy)}
            >
              {(['category', 'account', 'month', 'none'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`scoped.group.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <ScopeControls scope={scope} onChange={setScope} {...references} />
        <WindowControls value={window} onChange={setWindow} />
        <p className="text-muted-foreground text-xs">{t('scoped.currentDefinition')}</p>
      </NativePanel>
      <NativePanel className="min-w-0 p-4 sm:p-5" aria-busy={loading}>
        {loading ? (
          <p role="status">{t('scoped.loading')}</p>
        ) : error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : data ? (
          data.result.basis === 'recurring_estimate' ? (
            <ScopedEstimateResult
              result={data.result}
              accounts={data.accounts}
              categories={data.categories}
            />
          ) : (
            <ScopedActualResult
              key={JSON.stringify([scope, window, basis, currency, groupBy])}
              result={data.result}
              accounts={data.accounts}
              categories={data.categories}
            />
          )
        ) : null}
      </NativePanel>
    </div>
  )
}
