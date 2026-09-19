import {
  z,
  query,
  toCentavos,
  boundedText,
  currencyCode,
  positiveMoneyAmount,
  type ToolDefinition,
} from './shared.js'
import { correctMetadataMutation } from '../transaction-corrections.js'

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
  description: 'Convert an amount from one currency to another using stored exchange rates.',
  schema: z.object({
    amount: positiveMoneyAmount('The amount to convert (in regular units, e.g. 100.50)'),
    from: currencyCode('Source currency code (e.g. USD, EUR, GBP)'),
    to: currencyCode('Target currency code (e.g. MXN, JPY, BRL)'),
  }),
  execute: async ({ amount, from, to }) => {
    const fromUpper = from.toUpperCase()
    const toUpper = to.toUpperCase()
    let invalidRateFound = false

    if (fromUpper === toUpper) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: amount,
        rate: 1,
        message: `${amount} ${fromUpper} = ${amount} ${toUpper} (same currency)`,
      }
    }

    // Try to find a rate in exchange_rates table
    const directRate = await query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE from_currency = $1 AND to_currency = $2
       ORDER BY date DESC, created_at DESC LIMIT 1`,
      [fromUpper, toUpper]
    )

    if (directRate.length > 0) {
      const rate = directRate[0].rate
      if (rate > 0) {
        const converted = amount * rate
        return {
          amount,
          from: fromUpper,
          to: toUpper,
          convertedAmount: Number(converted.toFixed(2)),
          rate: Number(rate.toFixed(6)),
          message: `${amount} ${fromUpper} = ${converted.toFixed(2)} ${toUpper} (rate: ${rate.toFixed(4)})`,
        }
      }

      invalidRateFound = true
    }

    // Try inverse rate
    const inverseRate = await query<{ rate: number }>(
      `SELECT rate FROM exchange_rates
       WHERE from_currency = $1 AND to_currency = $2
       ORDER BY date DESC, created_at DESC LIMIT 1`,
      [toUpper, fromUpper]
    )

    if (inverseRate.length > 0) {
      if (inverseRate[0].rate > 0) {
        const rate = 1 / inverseRate[0].rate
        const converted = amount * rate
        return {
          amount,
          from: fromUpper,
          to: toUpper,
          convertedAmount: Number(converted.toFixed(2)),
          rate: Number(rate.toFixed(6)),
          message: `${amount} ${fromUpper} = ${converted.toFixed(2)} ${toUpper} (rate: ${rate.toFixed(4)})`,
        }
      }

      invalidRateFound = true
    }

    if (invalidRateFound) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: null,
        rate: null,
        message: `Stored exchange rate for ${fromUpper} to ${toUpper} is invalid. Refresh exchange rates first.`,
      }
    }

    return {
      amount,
      from: fromUpper,
      to: toUpper,
      convertedAmount: null,
      rate: null,
      message: `No exchange rate found for ${fromUpper} to ${toUpper}. Import exchange rates first.`,
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
