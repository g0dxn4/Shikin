import {
  apportionConvertedAmount,
  convertDatedAmounts,
  type DatedExchangeRate,
} from '@shikin/finance-core/fx'
import { query } from '@/lib/database'
import { assertReportingReadComplete, CASH_FLOW_SQL } from '@/lib/reporting-read'

interface SpendingAllocationRow {
  transaction_id: string
  amount: number
  currency: string
  date: string
  category_id: string | null
  split_id: string | null
  split_amount: number | null
  split_category_id: string | null
}

export interface BudgetSpendingRead {
  complete: boolean
  currency: string
  totalCentavos: number | null
  knownTotalCentavos: number
  nativeTotals: Array<{ currency: string; amountCentavos: number }>
  unresolvedIds: string[]
  conversions: ReturnType<typeof convertDatedAmounts>['converted']
}

function safeSum(values: readonly number[]): number {
  let total = 0n
  for (const value of values) {
    if (!Number.isSafeInteger(value)) throw new RangeError('Budget spending must use safe centavos')
    total += BigInt(value)
  }
  const result = Number(total)
  if (!Number.isSafeInteger(result)) throw new RangeError('Budget spending total is unsafe')
  return result
}

/**
 * Read eligible expense parents, convert each parent once at its transaction date,
 * then apportion the converted result across stable split IDs before category filtering.
 */
export async function readBudgetSpending(input: {
  categoryId: string | null
  start: string | null
  end: string
  currency: string
  rates: readonly DatedExchangeRate[]
}): Promise<BudgetSpendingRead> {
  await assertReportingReadComplete(input.start ?? undefined, input.end)
  const rows = await query<SpendingAllocationRow>(
    `SELECT t.id AS transaction_id, t.amount, t.currency, t.date, t.category_id,
            s.id AS split_id, s.amount AS split_amount, s.category_id AS split_category_id
     FROM transactions t
     LEFT JOIN transaction_splits s ON s.transaction_id = t.id
     WHERE ${CASH_FLOW_SQL}
       AND t.type = 'expense'${input.start === null ? '' : ' AND t.date >= ?'} AND t.date <= ?
     ORDER BY t.date, t.id, s.id`,
    input.start === null ? [input.end] : [input.start, input.end]
  )

  const grouped = new Map<string, SpendingAllocationRow[]>()
  for (const row of rows) {
    const parentRows = grouped.get(row.transaction_id) ?? []
    parentRows.push(row)
    grouped.set(row.transaction_id, parentRows)
  }

  const contributing = [...grouped.values()].filter((parentRows) => {
    if (input.categoryId === null) return true
    return parentRows.some(
      (row) => (row.split_id ? row.split_category_id : row.category_id) === input.categoryId
    )
  })
  const conversion = convertDatedAmounts(
    contributing.map((parentRows) => ({
      id: parentRows[0].transaction_id,
      amountCentavos: parentRows[0].amount,
      currency: parentRows[0].currency.trim().toUpperCase(),
      date: parentRows[0].date,
    })),
    input.currency.trim().toUpperCase(),
    input.rates
  )
  const convertedById = new Map(conversion.converted.map((row) => [row.id, row]))
  const selectedKnown: number[] = []
  const selectedNative = new Map<string, number[]>()
  const selectedUnresolved: string[] = []

  for (const parentRows of contributing) {
    const parent = parentRows[0]
    const allocations = parentRows[0].split_id
      ? parentRows.map((row) => ({ id: row.split_id!, amountCentavos: row.split_amount! }))
      : [{ id: parent.transaction_id, amountCentavos: parent.amount }]
    const selectedIds = new Set(
      (parentRows[0].split_id ? parentRows : [parent])
        .filter((row) => {
          const categoryId = row.split_id ? row.split_category_id : row.category_id
          return input.categoryId === null || categoryId === input.categoryId
        })
        .map((row) => row.split_id ?? parent.transaction_id)
    )
    const nativeApportioned = apportionConvertedAmount(parent.amount, allocations, parent.amount)
    const nativeCurrency = parent.currency.trim().toUpperCase()
    const nativeValues = selectedNative.get(nativeCurrency) ?? []
    nativeValues.push(
      ...nativeApportioned.filter((row) => selectedIds.has(row.id)).map((row) => row.amountCentavos)
    )
    selectedNative.set(nativeCurrency, nativeValues)

    const converted = convertedById.get(parent.transaction_id)
    if (!converted?.complete) {
      selectedUnresolved.push(parent.transaction_id)
      continue
    }
    const apportioned = apportionConvertedAmount(
      converted.amountCentavos,
      allocations,
      parent.amount
    )
    selectedKnown.push(
      ...apportioned.filter((row) => selectedIds.has(row.id)).map((row) => row.amountCentavos)
    )
  }

  const knownTotalCentavos = safeSum(selectedKnown)
  return {
    complete: selectedUnresolved.length === 0,
    currency: input.currency.trim().toUpperCase(),
    totalCentavos: selectedUnresolved.length === 0 ? knownTotalCentavos : null,
    knownTotalCentavos,
    nativeTotals: [...selectedNative.entries()]
      .map(([currency, amounts]) => ({ currency, amountCentavos: safeSum(amounts) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    unresolvedIds: selectedUnresolved.sort(),
    conversions: conversion.converted,
  }
}
