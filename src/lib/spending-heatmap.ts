import { isCashFlowEligible, type LedgerTreatment } from '@shikin/finance-core'
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

type HeatmapAllocation = Pick<
  HeatmapLedgerRow,
  'amount' | 'category_id' | 'category_name' | 'category_color'
>

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
  reason: 'missing_exchange_rates' | 'invalid_currency_data' | 'invalid_category_allocations' | null
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
    ledgerTreatment: row.ledger_treatment,
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
  const allocations = new Map<string, HeatmapAllocation[]>()

  for (const row of rows) {
    if (!isHeatmapEligibleExpense(row)) continue

    if (!Number.isSafeInteger(row.amount) || row.amount < 0) {
      reason = 'invalid_category_allocations'
      continue
    }
    const currency = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : ''
    if (!/^[A-Z0-9]{2,10}$/.test(currency)) {
      reason = 'invalid_currency_data'
      missingCurrencies.add(row.currency?.trim() || 'unknown')
      continue
    }

    let splits: HeatmapAllocation[]
    try {
      splits = JSON.parse(row.splits_json ?? '[]') as HeatmapAllocation[]
      if (
        !Array.isArray(splits) ||
        (splits.length > 0 &&
          (splits.some(
            (split) => !split || !Number.isSafeInteger(split.amount) || split.amount <= 0
          ) ||
            !Number.isSafeInteger(splits.reduce((total, split) => total + split.amount, 0)) ||
            splits.reduce((total, split) => total + split.amount, 0) !== row.amount))
      ) {
        reason = 'invalid_category_allocations'
        continue
      }
    } catch {
      reason = 'invalid_category_allocations'
      continue
    }
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

    const convertedAllocations: HeatmapAllocation[] = []
    for (const allocation of splits.length ? splits : [row]) {
      const allocationResult = splits.length
        ? convertToPreferred(allocation.amount, row.currency)
        : result
      if (!allocationResult.complete) {
        reason = allocationResult.reason ?? 'missing_exchange_rates'
        for (const currency of allocationResult.missingCurrencies ?? [])
          missingCurrencies.add(currency)
      } else {
        convertedAllocations.push({ ...allocation, amount: allocationResult.amountCentavos ?? 0 })
      }
    }
    allocations.set(row.id, convertedAllocations)
    converted.push({
      ...row,
      convertedAmount: result.amountCentavos ?? 0,
    })
  }

  const complete = reason === null && missingCurrencies.size === 0
  const dailyTotals = new Map<string, number>()
  const categoryMap = new Map<string, HeatmapCategoryTotal>()

  if (complete) {
    for (const tx of converted) {
      dailyTotals.set(tx.date, (dailyTotals.get(tx.date) ?? 0) + tx.convertedAmount)

      for (const allocation of allocations.get(tx.id) ?? []) {
        const categoryId = allocation.category_id ?? null
        const key = categoryId ?? HEATMAP_UNCATEGORIZED_ID
        const existing = categoryMap.get(key)
        categoryMap.set(key, {
          categoryId,
          name: allocation.category_name || existing?.name || 'Uncategorized',
          color: allocation.category_color || existing?.color || '#6b7280',
          total: (existing?.total ?? 0) + allocation.amount,
        })
      }
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
            t.ledger_treatment, t.reporting_treatment,
            t.transaction_kind,
            t.is_archived,
            t.category_id,
            t.account_id,
            t.description,
            c.name as category_name,
            c.color as category_color,
            (SELECT json_group_array(json_object('amount', s.amount, 'category_id', s.category_id,
                      'category_name', sc.name, 'category_color', sc.color))
             FROM transaction_splits s LEFT JOIN categories sc ON sc.id = s.category_id
             WHERE s.transaction_id = t.id) AS splits_json
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= ? AND t.date <= ?
     ORDER BY t.date ASC, t.id ASC`,
    [startDate, endDate]
  )
}
