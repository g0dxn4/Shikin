import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import type { Category } from '@/types/database'
import dayjs from 'dayjs'

export const addTransaction = tool({
  description:
    'Add a new financial transaction (expense, income, or transfer). Use this when the user wants to record spending, earnings, or money movement between accounts.',
  inputSchema: zodSchema(
    z.object({
      amount: z.number().positive().describe('The transaction amount in the main currency unit (e.g. 12.50, not cents)'),
      type: z.enum(['expense', 'income', 'transfer']).describe('The type of transaction'),
      description: z.string().describe('A short description of the transaction'),
      category: z.string().optional().describe('Category name (e.g. "Food & Dining", "Salary"). Will match the closest existing category.'),
      date: z.string().optional().describe('Transaction date in YYYY-MM-DD format. Defaults to today.'),
      notes: z.string().optional().describe('Additional notes about the transaction'),
    })
  ),
  execute: async ({ amount, type, description, category, date, notes }) => {
    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const txDate = date || dayjs().format('YYYY-MM-DD')

    // Find category by name if provided
    let categoryId: string | null = null
    if (category) {
      const categories = await query<Category>(
        'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
        [`%${category}%`]
      )
      if (categories.length > 0) {
        categoryId = categories[0].id
      }
    }

    // Find first account (default)
    const accounts = await query<{ id: string }>('SELECT id FROM accounts LIMIT 1')
    const accountId = accounts.length > 0 ? accounts[0].id : null

    if (!accountId) {
      return {
        success: false,
        message: 'No accounts found. Please create an account first.',
      }
    }

    await execute(
      `INSERT INTO transactions (id, account_id, category_id, type, amount, description, notes, date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, accountId, categoryId, type, amountCentavos, description, notes || null, txDate]
    )

    // Update account balance
    const balanceChange = type === 'income' ? amountCentavos : -amountCentavos
    await execute('UPDATE accounts SET balance = balance + $1, updated_at = strftime(\'%Y-%m-%dT%H:%M:%fZ\', \'now\') WHERE id = $2', [
      balanceChange,
      accountId,
    ])

    return {
      success: true,
      transaction: {
        id,
        amount,
        type,
        description,
        category: category || 'Uncategorized',
        date: txDate,
      },
      message: `Added ${type}: $${amount.toFixed(2)} for "${description}" on ${txDate}`,
    }
  },
})
