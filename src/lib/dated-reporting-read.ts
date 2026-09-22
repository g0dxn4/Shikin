import dayjs from 'dayjs'
import { isCashFlowEligible } from '@shikin/finance-core'
import {
  apportionConvertedAmount,
  convertCentavosAsOf,
  type DatedConversion,
  type DatedExchangeRate,
} from '@shikin/finance-core/fx'
import { query } from '@/lib/database'
import { useCurrencyStore } from '@/stores/currency-store'
import type { LedgerTreatment, ReportingTreatment, TransactionKind } from '@/types/database'

/** Immutable authority captured before any asynchronous read. No live store methods. */
export interface ReportingContext {
  mainCurrency: string | null
  manualRates: readonly DatedExchangeRate[]
  today: string
}
export function captureReportingContext(): ReportingContext {
  const { mainCurrency, manualRates } = useCurrencyStore.getState()
  return { mainCurrency, manualRates, today: dayjs().format('YYYY-MM-DD') }
}
export function reportingContextIsCurrent(context: ReportingContext): boolean {
  const state = useCurrencyStore.getState()
  return state.mainCurrency === context.mainCurrency && state.manualRates === context.manualRates
}
export function assertReportingContextCurrent(context: ReportingContext): void {
  if (!reportingContextIsCurrent(context))
    throw new Error('Currency authority changed; refresh the report.')
}
export function convertReportingAmount(
  context: ReportingContext,
  amount: number,
  currency: string,
  date = context.today
): DatedConversion | null {
  if (!context.mainCurrency) return null
  return convertCentavosAsOf({
    amountCentavos: amount,
    fromCurrency: currency.trim().toUpperCase(),
    toCurrency: context.mainCurrency,
    asOfDate: date,
    rates: context.manualRates,
  })
}
export function sumReportingAmounts(amounts: readonly number[]): number {
  let sum = 0n
  for (const amount of amounts) {
    if (!Number.isSafeInteger(amount))
      throw new RangeError('Reporting requires safe integer centavos')
    sum += BigInt(amount)
  }
  const result = Number(sum)
  if (!Number.isSafeInteger(result)) throw new RangeError('Reporting total exceeds safe centavos')
  return result
}
export interface GrossAllocation {
  id: string
  amount: number
  category_id?: string | null
  category_name?: string | null
  category_color?: string | null
}
export interface GrossLedgerRow extends GrossAllocation {
  date: string
  currency: string
  type: string
  status?: string | null
  ledger_treatment?: LedgerTreatment | null
  reporting_treatment?: string | null
  transaction_kind?: string | null
  is_archived?: number | boolean | null
  account_id?: string | null
  description?: string | null
  splits_json?: string
}
export interface GrossProjectedRow extends GrossLedgerRow {
  convertedAmount: number | null
  conversion: DatedConversion | null
  allocations: Array<GrossAllocation & { convertedAmount: number | null }>
}
export type GrossReadReason =
  | 'main_currency_unconfigured'
  | 'missing_exchange_rates'
  | 'invalid_currency_data'
  | 'invalid_category_allocations'
  | null
export interface GrossProjection {
  complete: boolean
  currency: string | null
  totalCentavos: number | null
  knownTotalCentavos: number | null
  sourceRows: readonly GrossLedgerRow[]
  nativeTotals: Array<{ currency: string; amountCentavos: number }>
  missingCurrencies: string[]
  unresolvedIds: string[]
  reason: GrossReadReason
  parents: GrossProjectedRow[]
}

/** Gross positive flows. Convert each eligible parent once, then allocate, never reround splits. */
export function projectGrossRows(
  rows: readonly GrossLedgerRow[],
  context: ReportingContext
): GrossProjection {
  let reason: GrossReadReason = context.mainCurrency ? null : 'main_currency_unconfigured'
  const missing = new Set<string>()
  const unresolved = new Set<string>()
  const native = new Map<string, number[]>()
  const parents: GrossProjectedRow[] = []
  for (const row of rows) {
    if (
      !isCashFlowEligible({
        type: row.type,
        status: row.status ?? 'posted',
        ledgerTreatment: row.ledger_treatment,
        reportingTreatment: (row.reporting_treatment ?? 'normal') as ReportingTreatment,
        transactionKind: (row.transaction_kind ?? 'standard') as TransactionKind,
        isArchived: row.is_archived ?? 0,
      })
    )
      continue
    let allocations: GrossAllocation[]
    try {
      if (!Number.isSafeInteger(row.amount) || row.amount < 0) throw new Error('Invalid parent')
      const splits: GrossAllocation[] = JSON.parse(row.splits_json ?? '[]')
      if (!Array.isArray(splits)) throw new Error('Invalid splits')
      allocations = splits.length ? splits : [row]
      if (splits.length)
        apportionConvertedAmount(
          row.amount,
          splits.map((s) => ({ id: s.id, amountCentavos: s.amount })),
          row.amount
        )
    } catch {
      reason = 'invalid_category_allocations'
      unresolved.add(row.id)
      continue
    }
    const currency = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : ''
    let conversion: DatedConversion | null = null
    try {
      // Validate source even when main is unset; native evidence must not claim malformed totals.
      convertCentavosAsOf({
        amountCentavos: row.amount,
        fromCurrency: currency,
        toCurrency: currency,
        asOfDate: row.date,
        rates: [],
      })
      const amounts = native.get(currency) ?? []
      amounts.push(row.amount)
      native.set(currency, amounts)
      conversion = convertReportingAmount(context, row.amount, currency, row.date)
      if (!conversion?.complete) {
        reason ??= 'missing_exchange_rates'
        missing.add(currency)
        unresolved.add(row.id)
      }
    } catch {
      reason = 'invalid_currency_data'
      missing.add(currency || '?')
      unresolved.add(row.id)
    }
    const convertedAmount = conversion?.complete ? conversion.amountCentavos : null
    const apportioned =
      convertedAmount === null
        ? null
        : allocations.length === 1 && !row.splits_json
          ? [{ id: row.id, amountCentavos: convertedAmount }]
          : row.amount === 0
            ? [{ id: row.id, amountCentavos: 0 }]
            : apportionConvertedAmount(
                convertedAmount,
                allocations.map((a) => ({ id: a.id, amountCentavos: a.amount })),
                row.amount
              )
    parents.push({
      ...row,
      convertedAmount,
      conversion,
      allocations: allocations.map((a, index) => ({
        ...a,
        convertedAmount: apportioned?.[index]?.amountCentavos ?? null,
      })),
    })
  }
  let knownTotalCentavos: number | null = null
  let nativeTotals: GrossProjection['nativeTotals'] = []
  try {
    knownTotalCentavos = sumReportingAmounts(
      parents.flatMap((p) => (p.convertedAmount === null ? [] : [p.convertedAmount]))
    )
    nativeTotals = [...native]
      .map(([currency, amounts]) => ({ currency, amountCentavos: sumReportingAmounts(amounts) }))
      .sort((a, b) => a.currency.localeCompare(b.currency))
  } catch {
    reason = 'invalid_currency_data'
  }
  const complete = reason === null && unresolved.size === 0
  return {
    sourceRows: rows,
    complete,
    currency: context.mainCurrency,
    totalCentavos: complete ? knownTotalCentavos : null,
    knownTotalCentavos,
    nativeTotals,
    missingCurrencies: [...missing].sort(),
    unresolvedIds: [...unresolved].sort(),
    reason,
    parents,
  }
}

/** One SQL statement provides a consistent parent+split source snapshot. Optional query is an existing transaction client; never starts a nested transaction. */
export async function readGrossLedgerRows(
  start: string,
  end: string,
  options: { accountId?: string; activeAccountsOnly?: boolean; query?: typeof query } = {}
): Promise<GrossLedgerRow[]> {
  return (options.query ?? query)<GrossLedgerRow>(
    `SELECT t.*, c.name AS category_name, c.color AS category_color,
      (SELECT json_group_array(json_object('id', s.id, 'amount', s.amount, 'category_id', s.category_id, 'category_name', sc.name, 'category_color', sc.color))
       FROM transaction_splits s LEFT JOIN categories sc ON sc.id = s.category_id WHERE s.transaction_id = t.id) AS splits_json
     FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.date >= ? AND t.date <= ?
       ${options.accountId ? 'AND t.account_id = ?' : ''}
       ${options.activeAccountsOnly ? 'AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.account_id AND a.is_archived = 0)' : ''}
     ORDER BY t.date, t.id`,
    [start, end, ...(options.accountId ? [options.accountId] : [])]
  )
}
export async function readGrossProjection(
  start: string,
  end: string,
  context: ReportingContext,
  options: Parameters<typeof readGrossLedgerRows>[2] = {}
): Promise<GrossProjection> {
  return projectGrossRows(await readGrossLedgerRows(start, end, options), context)
}
