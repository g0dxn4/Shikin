import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'

interface TransactionRow {
  id: string
  description: string
  amount: number
  type: string
  category_name: string | null
  account_name: string | null
  date: string
  notes: string | null
}

export const queryTransactions = tool({
  description:
    'Search and filter transactions. Use this when the user asks about their transactions, wants to find specific ones, or asks questions about their financial history.',
  inputSchema: zodSchema(
    z.object({
      accountId: z.string().optional().describe('Filter by account ID'),
      categoryId: z.string().optional().describe('Filter by category ID'),
      type: z
        .enum(['expense', 'income', 'transfer'])
        .optional()
        .describe('Filter by transaction type'),
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD) inclusive'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD) inclusive'),
      search: z
        .string()
        .optional()
        .describe('Search term to match against transaction descriptions'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe('Maximum number of results (default 20, max 100)'),
    })
  ),
  execute: async ({ accountId, categoryId, type, startDate, endDate, search, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (accountId) {
      paramIndex++
      conditions.push(`t.account_id = $${paramIndex}`)
      params.push(accountId)
    }
    if (categoryId) {
      paramIndex++
      conditions.push(`t.category_id = $${paramIndex}`)
      params.push(categoryId)
    }
    if (type) {
      paramIndex++
      conditions.push(`t.type = $${paramIndex}`)
      params.push(type)
    }
    if (startDate) {
      paramIndex++
      conditions.push(`t.date >= $${paramIndex}`)
      params.push(startDate)
    }
    if (endDate) {
      paramIndex++
      conditions.push(`t.date <= $${paramIndex}`)
      params.push(endDate)
    }
    if (search) {
      paramIndex++
      conditions.push(`t.description LIKE $${paramIndex}`)
      params.push(`%${search}%`)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    const limitParam = `$${paramIndex}`
    params.push(limit)

    const transactions = await query<TransactionRow>(
      `SELECT t.id, t.description, t.amount, t.type, t.date, t.notes,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT ${limitParam}`,
      params
    )

    // Get total count for matched results
    const countResult = await query<{ count: number }>(
      `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
      params.slice(0, -1) // exclude limit param
    )

    const totalMatched = countResult[0]?.count || 0

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        date: t.date,
        notes: t.notes,
      })),
      count: transactions.length,
      totalMatched,
      message:
        transactions.length === 0
          ? 'No transactions found matching your criteria.'
          : `Found ${totalMatched} transaction${totalMatched !== 1 ? 's' : ''}${transactions.length < totalMatched ? `, showing first ${transactions.length}` : ''}.`,
    }
  },
})
