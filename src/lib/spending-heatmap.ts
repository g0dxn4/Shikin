import { isCashFlowEligible, type LedgerTreatment } from '@shikin/finance-core'
import {
  projectGrossRows,
  readGrossLedgerRows,
  sumReportingAmounts,
  type ReportingContext,
  type GrossProjection,
} from '@/lib/dated-reporting-read'
import type { ReportingTreatment, TransactionKind, TransactionStatus } from '@/types/database'

export const HEATMAP_UNCATEGORIZED_ID = 'uncategorized'

export interface HeatmapLedgerRow {
  id: string
  date: string
  amount: number
  currency: string
  type: string
  status?: TransactionStatus | string | null
  ledger_treatment?: LedgerTreatment | null
  reporting_treatment?: ReportingTreatment | string | null
  transaction_kind?: TransactionKind | string | null
  is_archived?: number | boolean | null
  category_id?: string | null
  category_name?: string | null
  category_color?: string | null
  account_id?: string | null
  description?: string | null
  splits_json?: string
}

export interface HeatmapCategoryTotal {
  categoryId: string | null
  name: string
  color: string
  total: number
}

export interface HeatmapConvertedTransaction extends HeatmapLedgerRow {
  convertedAmount: number
}

export interface HeatmapAggregation {
  complete: boolean
  currency: string
  missingCurrencies: string[]
  reason: GrossProjection['reason']
  evidence: GrossProjection
  dailyTotals: Map<string, number>
  categoryTotals: HeatmapCategoryTotal[]
  eligibleTransactions: HeatmapConvertedTransaction[]
  totalSpent: number | null
}

export function isHeatmapEligibleExpense(row: HeatmapLedgerRow): boolean {
  if (row.type !== 'expense') return false
  return isCashFlowEligible({
    type: row.type,
    status: row.status ?? 'posted',
    ledgerTreatment: row.ledger_treatment,
    reportingTreatment: (row.reporting_treatment ?? 'normal') as ReportingTreatment,
    transactionKind: (row.transaction_kind ?? 'standard') as TransactionKind,
    isArchived: row.is_archived ?? 0,
  })
}

export function aggregateHeatmapSpending(
  rows: readonly HeatmapLedgerRow[],
  context: ReportingContext
): HeatmapAggregation {
  const evidence = projectGrossRows(rows.filter(isHeatmapEligibleExpense), context)
  const dailyTotals = new Map<string, number>()
  const categoryMap = new Map<string, HeatmapCategoryTotal>()
  if (evidence.complete) {
    for (const tx of evidence.parents) {
      dailyTotals.set(
        tx.date,
        sumReportingAmounts([dailyTotals.get(tx.date) ?? 0, tx.convertedAmount!])
      )
      for (const allocation of tx.allocations) {
        const categoryId = allocation.category_id ?? null
        const key = categoryId ?? HEATMAP_UNCATEGORIZED_ID
        const existing = categoryMap.get(key)
        categoryMap.set(key, {
          categoryId,
          name: allocation.category_name || existing?.name || 'Uncategorized',
          color: allocation.category_color || existing?.color || '#6b7280',
          total: sumReportingAmounts([existing?.total ?? 0, allocation.convertedAmount!]),
        })
      }
    }
  }
  return {
    complete: evidence.complete,
    currency: context.mainCurrency ?? '',
    missingCurrencies: evidence.missingCurrencies,
    reason: evidence.reason,
    evidence,
    dailyTotals,
    categoryTotals: [...categoryMap.values()].sort((a, b) => b.total - a.total),
    eligibleTransactions: evidence.complete
      ? evidence.parents.map((p) => ({ ...p, convertedAmount: p.convertedAmount! }))
      : [],
    totalSpent: evidence.totalCentavos,
  }
}

export async function fetchHeatmapLedgerRows(
  startDate: string,
  endDate: string
): Promise<HeatmapLedgerRow[]> {
  return readGrossLedgerRows(startDate, endDate)
}
