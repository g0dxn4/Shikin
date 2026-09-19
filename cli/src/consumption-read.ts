import { consumptionCoverage, netConsumption } from '@shikin/finance-core/corrections'
import { readConsumptionEvidence } from './transaction-corrections.js'
import { query } from './database.js'

/** Explicit coverage only; transaction dates cannot prove statement coverage. */
export function readNetConsumption(start: string, end: string) {
  const result = netConsumption(readConsumptionEvidence(), start, end)
  const accounts = query<{ id: string }>(
    "SELECT id FROM accounts WHERE COALESCE(account_mode, 'transactional') = 'transactional'"
  )
  const coverage = query<{
    account_id: string
    source_namespace: string
    period_start: string
    period_end: string
    status: string
  }>('SELECT * FROM source_coverage')
  const { coverageComplete, uncoveredAccountIds } = consumptionCoverage(
    accounts.map((account) => account.id),
    coverage,
    start,
    end
  )
  return {
    success: true,
    ...result,
    complete: result.classificationComplete && coverageComplete,
    coverageComplete,
    uncoveredAccountIds,
    period: { start, end },
    currencyScope: 'all' as const,
    message:
      coverageComplete && result.classificationComplete
        ? 'Explicit net consumption, native currencies; no FX conversion.'
        : 'Known net consumption subtotals only. Classification or independently verified source coverage is incomplete.',
  }
}
