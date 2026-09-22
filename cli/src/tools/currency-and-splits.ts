import { convertCentavosAsOf } from '@shikin/finance-core/fx'
import { multiplyDecimalsToCentavos } from '@shikin/finance-core/valuation'
import {
  z,
  query,
  toCentavos,
  boundedText,
  currencyCode,
  dayjs,
  isoDate,
  positiveMoneyAmount,
  type ToolDefinition,
} from './shared.js'
import { correctMetadataMutation } from '../transaction-corrections.js'
import { listExchangeRates } from '../fx-service.js'

type SplitTransactionInput = {
  transactionId: string
  splits: Array<{
    categoryId: string
    amount: number
    notes?: string
  }>
  dryRun: boolean
  auditSource?: string
  auditNote?: string
}

type TransactionSplitTargetRow = {
  id: string
  amount: number
  description: string
}

const convertCurrency: ToolDefinition = {
  name: 'convert-currency',
  description:
    'Convert an amount with an effective-dated manual direct rate. No provider, inverse, triangulation, or future fallback is used.',
  schema: z.object({
    amount: positiveMoneyAmount('The amount to convert (in regular units, e.g. 100.50)'),
    from: currencyCode('Source currency code (e.g. USD, EUR, GBP)'),
    to: currencyCode('Target currency code (e.g. MXN, JPY, BRL)'),
    asOfDate: isoDate('Optional effective-rate date; defaults to trusted local today').optional(),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async ({ amount, from, to, asOfDate }) => {
    const fromUpper = from.toUpperCase()
    const toUpper = to.toUpperCase()
    const effectiveDate = asOfDate ?? dayjs().format('YYYY-MM-DD')
    const conversion = convertCentavosAsOf({
      amountCentavos: multiplyDecimalsToCentavos([String(amount)]),
      fromCurrency: fromUpper,
      toCurrency: toUpper,
      asOfDate: effectiveDate,
      rates: listExchangeRates(),
    })

    if (!conversion.complete) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: null,
        rate: null,
        message: `No manual direct exchange rate found for ${conversion.direction} as of ${effectiveDate}.`,
        convertedAmountCentavos: null,
        rateDecimal: null,
        asOfDate: conversion.asOfDate,
        effectiveFrom: null,
        rateId: null,
        direction: conversion.direction,
        complete: false,
        missingReason: conversion.missingReason,
      }
    }

    const exactConvertedAmount = conversion.amountCentavos / 100
    const convertedAmount = fromUpper === toUpper ? amount : exactConvertedAmount
    const approximateRate = Number(conversion.rateDecimal)
    return {
      amount,
      from: fromUpper,
      to: toUpper,
      convertedAmount,
      rate: approximateRate,
      message:
        fromUpper === toUpper
          ? `${amount} ${fromUpper} = ${convertedAmount} ${toUpper} (same currency)`
          : `${amount} ${fromUpper} = ${convertedAmount} ${toUpper} (${conversion.direction}, effective ${conversion.effectiveFrom})`,
      convertedAmountCentavos: conversion.amountCentavos,
      rateDecimal: conversion.rateDecimal,
      asOfDate: conversion.asOfDate,
      effectiveFrom: conversion.effectiveFrom,
      rateId: conversion.rateId,
      direction: conversion.direction,
      complete: true,
      missingReason: null,
    }
  },
}

// ---------------------------------------------------------------------------
// 43. split-transaction
// ---------------------------------------------------------------------------
const splitTransaction: ToolDefinition = {
  name: 'split-transaction',
  description:
    'Audited split correction across multiple categories. Amounts remain in the main currency unit. Finalized ordinary rows are supported; protected provenance and dependent evidence require their dedicated workflows.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to split', 128),
    splits: z
      .array(
        z.object({
          categoryId: boundedText('Category ID', 'Category ID for this split portion', 128),
          amount: positiveMoneyAmount('Amount for this split in main currency unit'),
          notes: boundedText('Notes', 'Optional note for this split', 1000).optional(),
        })
      )
      .min(2)
      .describe('Array of split portions. Must have at least 2 splits.'),
    dryRun: z.boolean().default(false),
    auditSource: boundedText('Audit source', 'Optional correction audit source', 120).optional(),
    auditNote: boundedText('Audit note', 'Optional correction audit note', 1000).optional(),
  }),
  effects: {
    writesTo: ['transactions', 'transaction_splits', 'audit_log', 'app_data_state'],
  },
  execute: async ({
    transactionId,
    splits,
    dryRun,
    auditSource,
    auditNote,
  }: SplitTransactionInput) => {
    const transactions = await query<TransactionSplitTargetRow>(
      'SELECT id, amount, description FROM transactions WHERE id = $1',
      [transactionId]
    )

    if (transactions.length === 0) {
      return { success: false, message: `Transaction ${transactionId} not found.` }
    }

    const targetTransaction = transactions[0]
    const splitsCentavos = splits.map((s) => ({
      categoryId: s.categoryId,
      amount: toCentavos(s.amount),
      notes: s.notes ?? null,
    }))

    const splitsTotal = splitsCentavos.reduce((sum, s) => sum + s.amount, 0)
    if (splitsTotal !== targetTransaction.amount) {
      return {
        success: false,
        message: `Split amounts total $${(splitsTotal / 100).toFixed(2)} but transaction amount is $${(targetTransaction.amount / 100).toFixed(2)}. They must match exactly.`,
      }
    }

    correctMetadataMutation({
      transactionId,
      splits: splitsCentavos.map((split) => ({
        categoryId: split.categoryId,
        amountCentavos: split.amount,
        notes: split.notes,
      })),
      dryRun,
      auditSource,
      auditNote,
    })

    return {
      success: true,
      ...(dryRun ? { dryRun: true } : {}),
      transactionId,
      description: targetTransaction.description,
      splitCount: splits.length,
      message: `Split "${targetTransaction.description}" into ${splits.length} categories.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 44. get-education-tip
// ---------------------------------------------------------------------------

export const currencyAndSplitTools: ToolDefinition[] = [convertCurrency, splitTransaction]
