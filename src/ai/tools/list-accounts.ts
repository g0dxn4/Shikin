import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import type { Account } from '@/types/database'

export const listAccounts = tool({
  description:
    'List all active accounts. Use this when the user asks about their accounts, balances, or needs to pick an account.',
  inputSchema: zodSchema(
    z.object({
      type: z
        .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
        .optional()
        .describe('Filter by account type'),
    })
  ),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM accounts WHERE is_archived = 0'

    if (type) {
      sql += ' AND type = $1'
      params.push(type)
    }

    sql += ' ORDER BY name'

    const accounts = await query<Account>(sql, params)

    return {
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: fromCentavos(a.balance),
      })),
      message:
        accounts.length === 0
          ? 'No accounts found.'
          : `Found ${accounts.length} account${accounts.length !== 1 ? 's' : ''}.`,
    }
  },
})
