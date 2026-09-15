import { isCashFlowEligible } from '@shikin/finance-core'
import { query } from '@/lib/database'
import type { ReportingTreatment, TransactionKind, TransactionStatus } from '@/types/database'

export const HEATMAP_UNCATEGORIZED_ID = 'uncategorized'

export interface HeatmapLedgerRow {
  id: string
  date: string
  amount: number
  currency: string
  type: string
  status?: TransactionStatus | string | null
  reporting_treatment?: ReportingTreatment | string | null
  transaction_kind?: TransactionKind | string | null
  is_archived?: number | boolean | null
  category_id?: string | null
  category_name?: string | null
  category_color?: string | null
  account_id?: string | null
  description?: string | null
}

export type ConvertToPreferredFn = (
  amountCentavos: number,
  currency: string
) => {
  complete: boolean
  amountCentavos?: number
  missingCurrencies?: ReadonlyArray<string>
  reason?: 'missing_exchange_rates' | 'invalid_currency_data'
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
  reason: 'missing_exchange_rates' | 'invalid_currency_data' | null
  dailyTotals: Map<string, number>
  categoryTotals: HeatmapCategoryTotal[]
  eligibleTransactions: HeatmapConvertedTransaction[]
  totalSpent: number
}

export function isHeatmapEligibleExpense(row: HeatmapLedgerRow): boolean {
  if (row.type !== 'expense') return false
  return isCashFlowEligible({
    type: row.type,
    status: row.status ?? 'posted',
    reportingTreatment: (row.reporting_treatment ?? 'normal') as ReportingTreatment,
    transactionKind: (row.transaction_kind ?? 'standard') as TransactionKind,
    isArchived: row.is_archived ?? 0,
  })
}

export function aggregateHeatmapSpending(
  rows: readonly HeatmapLedgerRow[],
  preferredCurrency: string,
  convertToPreferred: ConvertToPreferredFn
): HeatmapAggregation {
  const missingCurrencies = new Set<string>()
  let reason: HeatmapAggregation['reason'] = null
  const converted: HeatmapConvertedTransaction[] = []

  for (const row of rows) {
    if (!isHeatmapEligibleExpense(row)) continue

    const result = convertToPreferred(row.amount, row.currency)
    if (!result.complete) {
      for (const currency of result.missingCurrencies ?? []) {
        missingCurrencies.add(currency)
      }
      if (result.reason === 'invalid_currency_data') {
        reason = 'invalid_currency_data'
        missingCurrencies.add(row.currency?.trim() || 'unknown')
      } else {
        reason = reason ?? 'missing_exchange_rates'
      }
      continue
    }

    converted.push({
      ...row,
      convertedAmount: result.amountCentavos ?? 0,
    })
  }

  const complete = missingCurrencies.size === 0
  const dailyTotals = new Map<string, number>()
  const categoryMap = new Map<string, HeatmapCategoryTotal>()

  if (complete) {
    for (const tx of converted) {
      dailyTotals.set(tx.date, (dailyTotals.get(tx.date) ?? 0) + tx.convertedAmount)

      const categoryId = tx.category_id ?? null
      const key = categoryId ?? HEATMAP_UNCATEGORIZED_ID
      const existing = categoryMap.get(key)
      categoryMap.set(key, {
        categoryId,
        name: tx.category_name || existing?.name || 'Uncategorized',
        color: tx.category_color || existing?.color || '#6b7280',
        total: (existing?.total ?? 0) + tx.convertedAmount,
      })
    }
  }

  return {
    complete,
    currency: preferredCurrency,
    missingCurrencies: [...missingCurrencies].sort(),
    reason: complete ? null : reason,
    dailyTotals,
    categoryTotals: [...categoryMap.values()].sort((a, b) => b.total - a.total),
    eligibleTransactions: complete ? converted : [],
    totalSpent: complete ? converted.reduce((sum, tx) => sum + tx.convertedAmount, 0) : 0,
  }
}

export async function fetchHeatmapLedgerRows(
  startDate: string,
  endDate: string
): Promise<HeatmapLedgerRow[]> {
  return query<HeatmapLedgerRow>(
    `SELECT t.id,
            t.date,
            t.amount,
            t.currency,
            t.type,
            t.status,
            t.reporting_treatment,
            t.transaction_kind,
            t.is_archived,
            t.category_id,
            t.account_id,
            t.description,
            c.name as category_name,
            c.color as category_color
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= ? AND t.date <= ?
     ORDER BY t.date ASC, t.id ASC`,
    [startDate, endDate]
  )
}
