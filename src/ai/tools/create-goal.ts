import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { execute } from '@/lib/database'

export const createGoal = tool({
  description:
    'Create a savings goal. Use this when the user wants to set a savings target, like an emergency fund, vacation, or big purchase.',
  inputSchema: zodSchema(
    z.object({
      name: z.string().describe('Name of the savings goal (e.g. "Emergency Fund", "Vacation")'),
      targetAmount: z
        .number()
        .positive()
        .describe('Target amount in the main currency unit (e.g. 5000 for $5,000)'),
      currentAmount: z
        .number()
        .min(0)
        .optional()
        .default(0)
        .describe('Current amount already saved (default: 0)'),
      deadline: z
        .string()
        .optional()
        .describe('Target date in YYYY-MM-DD format (optional)'),
      accountId: z
        .string()
        .optional()
        .describe('Account ID to link this goal to (optional)'),
      icon: z.string().optional().default('🎯').describe('Emoji icon for the goal'),
      color: z.string().optional().default('#bf5af2').describe('Color hex code for the goal'),
      notes: z.string().optional().describe('Additional notes about the goal'),
    })
  ),
  execute: async ({ name, targetAmount, currentAmount, deadline, accountId, icon, color, notes }) => {
    const id = generateId()
    const now = new Date().toISOString()

    await execute(
      `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        name,
        toCentavos(targetAmount),
        toCentavos(currentAmount),
        deadline ?? null,
        accountId ?? null,
        icon,
        color,
        notes ?? null,
        now,
        now,
      ]
    )

    const progress = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0

    return {
      success: true,
      goal: {
        id,
        name,
        targetAmount,
        currentAmount,
        deadline: deadline ?? null,
        progress,
      },
      message: `Created savings goal "${name}" — target: $${targetAmount.toFixed(2)}${currentAmount > 0 ? `, starting at $${currentAmount.toFixed(2)} (${progress}%)` : ''}.${deadline ? ` Deadline: ${deadline}.` : ''}`,
    }
  },
})
