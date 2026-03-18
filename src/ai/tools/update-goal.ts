import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { toCentavos, fromCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'

interface GoalRow {
  id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
}

export const updateGoal = tool({
  description:
    'Update a savings goal. Can add/withdraw saved amounts, change the target, deadline, or other details. Use "addAmount" to contribute to a goal or "withdrawAmount" to take money out.',
  inputSchema: zodSchema(
    z.object({
      goalId: z.string().describe('The ID of the goal to update'),
      name: z.string().optional().describe('New name for the goal'),
      targetAmount: z.number().positive().optional().describe('New target amount'),
      currentAmount: z.number().min(0).optional().describe('Set current amount directly'),
      addAmount: z.number().positive().optional().describe('Amount to add to current savings'),
      withdrawAmount: z.number().positive().optional().describe('Amount to withdraw from current savings'),
      deadline: z.string().optional().describe('New deadline in YYYY-MM-DD format'),
      icon: z.string().optional().describe('New emoji icon'),
      color: z.string().optional().describe('New color hex code'),
      notes: z.string().optional().describe('New notes'),
    })
  ),
  execute: async ({ goalId, name, targetAmount, currentAmount, addAmount, withdrawAmount, deadline, icon, color, notes }) => {
    const existing = await query<GoalRow>(
      'SELECT id, name, target_amount, current_amount, deadline FROM goals WHERE id = $1',
      [goalId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Goal ${goalId} not found.` }
    }

    const goal = existing[0]
    const now = new Date().toISOString()

    // Calculate new current amount
    let newCurrentCentavos = goal.current_amount
    if (currentAmount !== undefined) {
      newCurrentCentavos = toCentavos(currentAmount)
    } else if (addAmount !== undefined) {
      newCurrentCentavos = goal.current_amount + toCentavos(addAmount)
    } else if (withdrawAmount !== undefined) {
      newCurrentCentavos = Math.max(0, goal.current_amount - toCentavos(withdrawAmount))
    }

    const newTargetCentavos = targetAmount !== undefined ? toCentavos(targetAmount) : goal.target_amount
    const newName = name ?? goal.name
    const newDeadline = deadline !== undefined ? deadline : goal.deadline

    // Build dynamic SET clause for optional fields
    const setClauses = [
      'name = $1',
      'target_amount = $2',
      'current_amount = $3',
      'deadline = $4',
      'updated_at = $5',
    ]
    const params: unknown[] = [newName, newTargetCentavos, newCurrentCentavos, newDeadline, now]
    let paramIdx = 6

    if (icon !== undefined) {
      setClauses.push(`icon = $${paramIdx}`)
      params.push(icon)
      paramIdx++
    }
    if (color !== undefined) {
      setClauses.push(`color = $${paramIdx}`)
      params.push(color)
      paramIdx++
    }
    if (notes !== undefined) {
      setClauses.push(`notes = $${paramIdx}`)
      params.push(notes)
      paramIdx++
    }

    params.push(goalId)
    await execute(
      `UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    const newCurrentAmount = fromCentavos(newCurrentCentavos)
    const newTargetAmount = fromCentavos(newTargetCentavos)
    const progress = newTargetAmount > 0 ? Math.round((newCurrentAmount / newTargetAmount) * 100) : 0

    return {
      success: true,
      goal: {
        id: goalId,
        name: newName,
        targetAmount: newTargetAmount,
        currentAmount: newCurrentAmount,
        deadline: newDeadline,
        progress,
      },
      message: `Updated goal "${newName}" — $${newCurrentAmount.toFixed(2)} / $${newTargetAmount.toFixed(2)} (${progress}%).`,
    }
  },
})
