import { netConsumption } from '@shikin/finance-core/corrections'
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
  const uncoveredAccountIds = accounts
    .filter((account) => {
      const rows = coverage.filter(
        (row) => row.account_id === account.id && row.period_end >= start && row.period_start <= end
      )
      if (rows.some((row) => row.status !== 'verified')) return true
      // Do not stitch different source namespaces together to invent coverage.
      const sources = [
        ...new Set(
          coverage.filter((row) => row.account_id === account.id).map((row) => row.source_namespace)
        ),
      ]
      return (
        sources.length === 0 ||
        !sources.every((source) => {
          let cursor = start
          for (const row of rows
            .filter((row) => row.source_namespace === source && row.status === 'verified')
            .sort((a, b) => a.period_start.localeCompare(b.period_start))) {
            if (row.period_start > cursor) return false
            if (row.period_end >= end) return true
            if (row.period_end >= cursor) {
              const next = new Date(`${row.period_end}T00:00:00Z`)
              next.setUTCDate(next.getUTCDate() + 1)
              cursor = next.toISOString().slice(0, 10)
            }
          }
          return false
        })
      )
    })
    .map((account) => account.id)
  const coverageComplete = accounts.length > 0 && uncoveredAccountIds.length === 0
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
