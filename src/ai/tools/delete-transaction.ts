import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import type { Transaction } from '@/types/database'

export const deleteTransaction = tool({
  description:
    'Delete a transaction. Use this when the user wants to remove a transaction. The account balance will be adjusted accordingly.',
  inputSchema: zodSchema(
    z.object({
      transactionId: z.string().describe('The ID of the transaction to delete'),
    })
  ),
  execute: async ({ transactionId }) => {
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

    // Reverse balance impact
    const balanceChange = tx.type === 'income' ? tx.amount : -tx.amount
    await execute(
      "UPDATE accounts SET balance = balance - $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [balanceChange, tx.account_id]
    )

    // Delete the transaction
    await execute('DELETE FROM transactions WHERE id = $1', [transactionId])

    await useTransactionStore.getState().fetch()
    await useAccountStore.getState().fetch()

    return {
      success: true,
      message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}" from ${tx.date}`,
    }
  },
})
