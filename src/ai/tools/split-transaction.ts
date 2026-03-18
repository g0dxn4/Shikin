import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { toCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import { createSplits } from '@/lib/split-service'
import { useTransactionStore } from '@/stores/transaction-store'
import type { Transaction } from '@/types/database'

export const splitTransaction = tool({
  description:
    'Split a transaction across multiple categories. Use when a single transaction (e.g. a grocery receipt) should be allocated to different spending categories.',
  inputSchema: zodSchema(
    z.object({
      transactionId: z.string().describe('The ID of the transaction to split'),
      splits: z
        .array(
          z.object({
            categoryId: z.string().describe('Category ID for this split portion'),
            amount: z
              .number()
              .positive()
              .describe('Amount for this split in main currency unit (e.g. 12.50, not cents)'),
            notes: z.string().optional().describe('Optional note for this split'),
          })
        )
        .min(2)
        .describe('Array of split portions. Must have at least 2 splits.'),
    })
  ),
  execute: async ({ transactionId, splits }) => {
    // Find the transaction
    const transactions = await query<Transaction>(
      'SELECT id, amount, description FROM transactions WHERE id = $1',
      [transactionId]
    )

    if (transactions.length === 0) {
      return {
        success: false,
        message: `Transaction ${transactionId} not found.`,
      }
    }

    const transaction = transactions[0]
    const splitsCentavos = splits.map((s) => ({
      categoryId: s.categoryId,
      amount: toCentavos(s.amount),
      notes: s.notes ?? null,
    }))

    const splitsTotal = splitsCentavos.reduce((sum, s) => sum + s.amount, 0)
    if (splitsTotal !== transaction.amount) {
      return {
        success: false,
        message: `Split amounts total $${(splitsTotal / 100).toFixed(2)} but transaction amount is $${(transaction.amount / 100).toFixed(2)}. They must match exactly.`,
      }
    }

    await createSplits(transactionId, splitsCentavos, transaction.amount)
    await useTransactionStore.getState().fetch()

    return {
      success: true,
      transactionId,
      description: transaction.description,
      splitCount: splits.length,
      message: `Split "${transaction.description}" into ${splits.length} categories.`,
    }
  },
})
