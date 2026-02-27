import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { execute, query } from '@/lib/database'

export const deleteBudget = tool({
  description:
    'Delete a budget. Use this when the user wants to remove a budget they no longer need.',
  inputSchema: zodSchema(
    z.object({
      budgetId: z.string().describe('The ID of the budget to delete'),
    })
  ),
  execute: async ({ budgetId }) => {
    const existing = await query<{ id: string; name: string }>(
      'SELECT id, name FROM budgets WHERE id = $1',
      [budgetId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Budget ${budgetId} not found.` }
    }

    await execute('DELETE FROM budgets WHERE id = $1', [budgetId])

    return {
      success: true,
      message: `Deleted budget "${existing[0].name}".`,
    }
  },
})
