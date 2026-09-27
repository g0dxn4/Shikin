import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ScopedReportAmounts,
  ScopedReportResult,
  ScopedRecurringEstimateResult,
} from '@shikin/finance-core'
import type { ScopedReferences } from '@/lib/scoped-report-read'
import { formatMoney } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { useUIStore } from '@/stores/ui-store'

const grossFields = ['expenseCentavos', 'incomeCentavos'] as const
const netFields = [
  'consumptionCentavos',
  'earnedIncomeCentavos',
  'otherIncomeCentavos',
  'principalRecoveryCentavos',
  'assetAcquisitionCentavos',
] as const
function Amounts({
  values,
  currency,
  basis,
}: {
  values: ScopedReportAmounts
  currency: string
  basis: ScopedReportResult['basis']
}) {
  const { t } = useTranslation('budgets')
  return (
    <dl className="grid min-w-0 gap-2 text-sm">
      {(basis === 'gross_cashflow' ? grossFields : netFields).map((field) => (
        <div key={field} className="flex flex-wrap justify-between gap-2">
          <dt className="text-muted-foreground">{t(`scoped.${field}`)}</dt>
          <dd className="max-w-full overflow-x-auto font-semibold whitespace-nowrap tabular-nums">
            {values[field] === null ? '—' : formatMoney(values[field], currency)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
export function ScopeSummary({
  result,
  accounts,
  categories,
}: ScopedReferences & { result: Pick<ScopedReportResult, 'scope'> }) {
  const { t } = useTranslation('budgets')
  if (!result.scope) return <p className="text-warning text-xs">{t('scoped.invalidScope')}</p>
  const parts = Object.entries(result.scope)
    .filter(([, ids]) => ids.length)
    .map(([key, ids]) => {
      const values = ids.map((id: string | null) =>
        id === null
          ? t('scoped.uncategorized')
          : key.toLowerCase().includes('account')
            ? (accounts.find((a) => a.id === id)?.name ?? id)
            : key.toLowerCase().includes('categor')
              ? (categories.find((c) => c.id === id)?.name ?? id)
              : id
      )
      return `${t(`scoped.${key}`, { defaultValue: key as string })}: ${values.join(', ')}`
    })
  return (
    <p className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
      {parts.join(' · ') || t('scoped.allScope')}
    </p>
  )
}
export function ScopedActualResult({
  result,
  accounts,
  categories,
  compact = false,
}: ScopedReferences & { result: ScopedReportResult; compact?: boolean }) {
  const { t } = useTranslation('budgets')
  const openTransactionDialog = useUIStore((state) => state.openTransactionDialog)
  const [visible, setVisible] = useState(20)
  const name = (key: string | null) =>
    result.groupBy === 'category'
      ? (categories.find((c) => c.id === key)?.name ?? key ?? t('scoped.uncategorized'))
      : result.groupBy === 'account'
        ? (accounts.find((a) => a.id === key)?.name ?? key ?? '—')
        : (key ?? t('scoped.allScope'))
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-muted-foreground text-xs">
        {t(`scoped.${result.basis}`)} · {result.currency} · {result.window.start} –{' '}
        {result.window.end} · {result.window.timeZone}
      </p>
      <ScopeSummary result={result} accounts={accounts} categories={categories} />
      {!compact && (
        <Amounts values={result.totals} currency={result.currency} basis={result.basis} />
      )}
      <p
        className={result.complete ? 'text-muted-foreground text-xs' : 'text-warning text-xs'}
        role="status"
      >
        {t(result.complete ? 'scoped.complete' : 'scoped.incomplete')}
      </p>
      {compact && result.budgetUsage.complete && !result.complete && (
        <p className="text-muted-foreground text-xs">{t('scoped.budgetUsageComplete')}</p>
      )}
      {!compact && (
        <div
          className="max-w-full overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label={t('scoped.breakdown')}
        >
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{t('scoped.breakdown')}</caption>
            <thead>
              <tr>
                <th className="p-2">{t(`scoped.group.${result.groupBy}`)}</th>
                <th className="p-2">{t(`scoped.${result.budgetUsage.measure}`)}</th>
                <th className="p-2">{t('scoped.known')}</th>
              </tr>
            </thead>
            <tbody>
              {result.groups.map((group) => (
                <tr key={group.key ?? '__none'} className="border-border border-t">
                  <th className="p-2 font-normal">{name(group.key)}</th>
                  <td className="p-2 whitespace-nowrap tabular-nums">
                    {group.totals[result.budgetUsage.measure] === null
                      ? '—'
                      : formatMoney(group.totals[result.budgetUsage.measure]!, result.currency)}
                  </td>
                  <td className="p-2 whitespace-nowrap tabular-nums">
                    {group.known[result.budgetUsage.measure] === null
                      ? '—'
                      : formatMoney(group.known[result.budgetUsage.measure]!, result.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details className="border-border min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t('scoped.evidence')}
        </summary>
        <h3 className="mb-2 text-sm font-medium">{t('scoped.known')}</h3>
        <Amounts values={result.known} currency={result.currency} basis={result.basis} />
        <h3 className="my-2 text-sm font-medium">{t('scoped.native')}</h3>
        {result.nativeTotals.map((row) => (
          <div key={row.currency} className="mb-3">
            <p className="text-xs">{row.currency}</p>
            <Amounts values={row.known} currency={row.currency} basis={result.basis} />
          </div>
        ))}
        <p className="my-2 text-xs">
          {t('scoped.coverage')}:{' '}
          {result.coverage.required
            ? t(result.coverage.complete ? 'scoped.complete' : 'scoped.incomplete')
            : t('scoped.notRequired')}{' '}
          · {result.coverage.uncoveredAccountIds.join(', ')}
        </p>
        <ul className="space-y-2 text-xs [overflow-wrap:anywhere]">
          {result.issues.map((issue, index) => (
            <li key={index}>
              <strong>{t(`scoped.issues.${issue.code}`, { defaultValue: issue.code })}</strong> ·{' '}
              {issue.id} · {issue.message}
            </li>
          ))}
        </ul>
        {result.repayments.map((row) => (
          <p key={row.transactionId} className="mt-2 text-xs [overflow-wrap:anywhere]">
            {t('scoped.repayment')}:{' '}
            <button
              type="button"
              className="text-primary min-h-11 underline"
              onClick={() => openTransactionDialog(row.transactionId)}
            >
              {row.transactionId}
            </button>{' '}
            · {row.status} · {row.linkIds.join(', ')}
          </p>
        ))}
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer text-xs">
            {t('scoped.technicalEvidence')}
          </summary>
          <pre className="max-w-full overflow-x-auto text-xs">
            {JSON.stringify(
              {
                coverage: result.coverage,
                conversions: result.conversions,
                unresolvedClassificationIds: result.unresolvedClassificationIds,
              },
              null,
              2
            )}
          </pre>
        </details>
      </details>
      <details className="border-border min-w-0 rounded-lg border p-3">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          {t('scoped.contributors')} · {result.transactionIds.length}
        </summary>
        <p className="text-muted-foreground mb-3 text-xs">{t('scoped.contributorHelp')}</p>
        <ul className="space-y-3">
          {result.transactionIds.slice(0, visible).map((id) => {
            const parent = result.contributors.find((c) => c.transactionId === id)
            return (
              <li key={id} className="border-border min-w-0 border-t pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-11 max-w-full [overflow-wrap:anywhere] whitespace-normal"
                  onClick={() => openTransactionDialog(id)}
                >
                  {parent?.date} · {id}
                </Button>
                <p className="text-muted-foreground my-2 text-xs">
                  {t('scoped.fullParent')}:{' '}
                  {parent?.nativeParentAmountCentavos !== null &&
                  parent?.nativeParentAmountCentavos !== undefined &&
                  parent.currency
                    ? formatMoney(parent.nativeParentAmountCentavos, parent.currency)
                    : '—'}
                </p>
                {result.allocations
                  .filter((a) => a.transactionId === id)
                  .map((a) => (
                    <div
                      key={a.allocationId}
                      className="bg-muted/30 mb-2 min-w-0 rounded-lg p-2 text-xs [overflow-wrap:anywhere]"
                    >
                      <p>
                        {t('scoped.selectedAllocation')}: {a.allocationId} ·{' '}
                        {categories.find((c) => c.id === a.categoryId)?.name ??
                          a.categoryId ??
                          t('scoped.uncategorized')}
                      </p>
                      <Amounts values={a.amounts} currency={result.currency} basis={result.basis} />
                      <p>
                        {t('scoped.native')}: {formatMoney(a.nativeAmountCentavos, a.currency)} ·{' '}
                        {a.role} · {a.classificationId} · {a.typeRevisionId} ·{' '}
                        {a.referencedPurchaseId}
                      </p>
                    </div>
                  ))}
                {parent?.issues.map((issue, index) => (
                  <p key={index} className="text-warning text-xs [overflow-wrap:anywhere]">
                    {issue.code}: {issue.message}
                  </p>
                ))}
              </li>
            )
          })}
        </ul>
        {visible < result.transactionIds.length && (
          <Button variant="secondary" onClick={() => setVisible((n) => n + 20)}>
            {t('scoped.showMore')}
          </Button>
        )}
      </details>
    </div>
  )
}
export function ScopedEstimateResult({
  result,
  accounts,
  categories,
}: ScopedReferences & { result: ScopedRecurringEstimateResult }) {
  const { t } = useTranslation('budgets')
  const money = (amount: number | null) =>
    amount === null ? '—' : formatMoney(amount, result.currency)
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-sm">{t('scoped.estimateHelp')}</p>
      <ScopeSummary result={result} accounts={accounts} categories={categories} />
      <p className="text-muted-foreground text-xs">
        {result.asOf} · {result.currency} · {t('scoped.noCombinedEstimate')}
      </p>
      {[
        ['recurringRules', result.recurringRules],
        ['subscriptions', result.subscriptions],
      ].map(([key, value]) => {
        const source = value as ScopedRecurringEstimateResult['recurringRules']
        return (
          <section key={key as string} className="border-border min-w-0 rounded-lg border p-4">
            <h2 className="text-sm font-semibold">
              {t(`scoped.${key}`, { defaultValue: key as string })}
            </h2>
            <p className="my-2 text-xs" role="status">
              {t(source.complete ? 'scoped.complete' : 'scoped.incomplete')}
            </p>
            <dl className="grid gap-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2">
                <dt>{t('scoped.monthlyEquivalent')}</dt>
                <dd className="overflow-x-auto tabular-nums">{money(source.monthlyCentavos)}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt>{t('scoped.yearlyEquivalent')}</dt>
                <dd className="overflow-x-auto tabular-nums">{money(source.yearlyCentavos)}</dd>
              </div>
            </dl>
            <div
              className="mt-3 max-w-full overflow-x-auto"
              tabIndex={0}
              role="region"
              aria-label={t('scoped.breakdown')}
            >
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t('scoped.breakdown')}</caption>
                <thead>
                  <tr>
                    <th className="p-2">{t(`scoped.group.${result.groupBy}`)}</th>
                    <th className="p-2">{t('scoped.monthlyEquivalent')}</th>
                    <th className="p-2">{t('scoped.yearlyEquivalent')}</th>
                  </tr>
                </thead>
                <tbody>
                  {source.groups.map((group) => (
                    <tr key={group.key ?? '__none'} className="border-border border-t">
                      <th className="p-2 font-normal">
                        {result.groupBy === 'category'
                          ? (categories.find((c) => c.id === group.key)?.name ??
                            group.key ??
                            t('scoped.uncategorized'))
                          : result.groupBy === 'account'
                            ? (accounts.find((a) => a.id === group.key)?.name ?? group.key ?? '—')
                            : (group.key ?? t('scoped.allScope'))}
                      </th>
                      <td className="p-2 whitespace-nowrap tabular-nums">
                        {money(group.monthlyCentavos)}
                      </td>
                      <td className="p-2 whitespace-nowrap tabular-nums">
                        {money(group.yearlyCentavos)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer text-sm">{t('scoped.evidence')}</summary>
              <p className="text-xs">
                {t('scoped.known')}: {money(source.known.monthlyCentavos)} /{' '}
                {money(source.known.yearlyCentavos)}
              </p>
              {source.nativeTotals.map((row) => (
                <p key={row.currency} className="text-xs">
                  {t('scoped.native')}: {formatMoney(row.monthlyCentavos, row.currency)} /{' '}
                  {formatMoney(row.yearlyCentavos, row.currency)}
                </p>
              ))}
              <ul className="mt-2 space-y-2 text-xs [overflow-wrap:anywhere]">
                {source.issues.map((issue, index) => (
                  <li key={index}>
                    {t(`scoped.issues.${issue.code}`, { defaultValue: issue.code })}: {issue.id} ·{' '}
                    {issue.message}
                  </li>
                ))}
              </ul>
              <pre className="mt-2 max-w-full overflow-x-auto text-xs">
                {JSON.stringify(
                  { groups: source.groups, allocations: source.allocations },
                  null,
                  2
                )}
              </pre>
            </details>
          </section>
        )
      })}
    </div>
  )
}
