import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { execute, query } from '@/lib/database'
import { useAccountStore } from '@/stores/account-store'
import type { Account } from '@/types/database'

export const deleteAccount = tool({
  description:
    'Delete or archive an account. If the account has linked transactions it will be archived instead of deleted. Use this when the user wants to remove an account.',
  inputSchema: zodSchema(
    z.object({
      accountId: z.string().describe('The ID of the account to delete'),
    })
  ),
  execute: async ({ accountId }) => {
    const existing = await query<Account>(
      'SELECT * FROM accounts WHERE id = $1',
      [accountId]
    )

    if (existing.length === 0) {
      return {
        success: false,
        message: `Account ${accountId} not found.`,
      }
    }

    const account = existing[0]

    // Check for linked transactions
    const txCount = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM transactions WHERE account_id = $1',
      [accountId]
    )

    const hasTransactions = txCount.length > 0 && txCount[0].count > 0

    if (hasTransactions) {
      // Soft-archive instead of hard delete
      await execute(
        "UPDATE accounts SET is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1",
        [accountId]
      )

      await useAccountStore.getState().fetch()

      return {
        success: true,
        action: 'archived',
        message: `Archived account "${account.name}" (has ${txCount[0].count} linked transactions). It won't appear in your active accounts.`,
      }
    }

    // Hard delete if no transactions
    await execute('DELETE FROM accounts WHERE id = $1', [accountId])

    await useAccountStore.getState().fetch()

    return {
      success: true,
      action: 'deleted',
      message: `Deleted account "${account.name}".`,
    }
  },
})
