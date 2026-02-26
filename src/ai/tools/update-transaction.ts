import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { toCentavos, fromCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import type { Transaction, Category } from '@/types/database'

export const updateTransaction = tool({
  description:
    'Update an existing transaction. Use this when the user wants to change the amount, description, category, date, or other details of a transaction.',
  inputSchema: zodSchema(
    z.object({
      transactionId: z.string().describe('The ID of the transaction to update'),
      amount: z
        .number()
        .positive()
        .optional()
        .describe('New amount in the main currency unit (e.g. 12.50)'),
      type: z.enum(['expense', 'income', 'transfer']).optional().describe('New transaction type'),
      description: z.string().optional().describe('New description'),
      category: z
        .string()
        .optional()
        .describe('New category name — will match the closest existing category'),
      date: z.string().optional().describe('New date in YYYY-MM-DD format'),
      notes: z.string().optional().describe('New notes'),
      accountId: z.string().optional().describe('New account ID to move the transaction to'),
    })
  ),
  execute: async ({ transactionId, amount, type, description, category, date, notes, accountId }) => {
    // Fetch existing transaction
    const existing = await query<Transaction>(
      'SELECT * FROM transactions WHERE id = $1',
      [transactionId]
    )

    if (existing.length === 0) {
      return {
        success: false,
        message: `Transaction ${transactionId} not found.`,
      }
    }

    const tx = existing[0]
    const oldAmountCentavos = tx.amount
    const oldType = tx.type
    const oldAccountId = tx.account_id

    // Resolve new values
    const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
    const newType = type || oldType
    const newAccountId = accountId || oldAccountId

    // Resolve category if provided
    let newCategoryId = tx.category_id
    if (category !== undefined) {
      const categories = await query<Category>(
        'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
        [`%${category}%`]
      )
      newCategoryId = categories.length > 0 ? categories[0].id : null
    }

    // Reverse old balance impact on old account
    const oldBalanceChange = oldType === 'income' ? oldAmountCentavos : -oldAmountCentavos
    await execute(
      "UPDATE accounts SET balance = balance - $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [oldBalanceChange, oldAccountId]
    )

    // Apply new balance impact on new account
    const newBalanceChange = newType === 'income' ? newAmount : -newAmount
    await execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [newBalanceChange, newAccountId]
    )

    // Update the transaction
    await execute(
      `UPDATE transactions
       SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = $8`,
      [
        newAmount,
        newType,
        description !== undefined ? description : tx.description,
        newCategoryId,
        date || tx.date,
        notes !== undefined ? notes : tx.notes,
        newAccountId,
        transactionId,
      ]
    )

    const displayAmount = amount !== undefined ? amount : fromCentavos(oldAmountCentavos)

    return {
      success: true,
      transaction: {
        id: transactionId,
        amount: displayAmount,
        type: newType,
        description: description !== undefined ? description : tx.description,
        date: date || tx.date,
      },
      message: `Updated transaction ${transactionId}: $${displayAmount.toFixed(2)} ${newType}`,
    }
  },
})
