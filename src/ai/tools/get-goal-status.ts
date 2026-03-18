import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import dayjs from 'dayjs'

interface GoalRow {
  id: string
  name: string
  target_amount: number
  current_amount: number
  deadline: string | null
  account_id: string | null
  icon: string | null
  color: string | null
  notes: string | null
  account_name: string | null
}

export const getGoalStatus = tool({
  description:
    'Get savings goal status showing progress toward each goal. Returns all goals with progress percentages, days remaining, and monthly contribution needed.',
  inputSchema: zodSchema(
    z.object({
      goalId: z
        .string()
        .optional()
        .describe('Filter by specific goal ID. Omit to see all goals.'),
    })
  ),
  execute: async ({ goalId }) => {
    let goals: GoalRow[]

    if (goalId) {
      goals = await query<GoalRow>(
        `SELECT g.*, a.name as account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         WHERE g.id = $1`,
        [goalId]
      )
    } else {
      goals = await query<GoalRow>(
        `SELECT g.*, a.name as account_name
         FROM goals g
         LEFT JOIN accounts a ON g.account_id = a.id
         ORDER BY g.created_at DESC`
      )
    }

    if (goals.length === 0) {
      return {
        success: true,
        goals: [],
        message: goalId ? `Goal ${goalId} not found.` : 'No savings goals found.',
      }
    }

    const statuses = goals.map((goal) => {
      const targetAmount = fromCentavos(goal.target_amount)
      const currentAmount = fromCentavos(goal.current_amount)
      const remaining = Math.max(0, targetAmount - currentAmount)
      const progress = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0
      const isCompleted = currentAmount >= targetAmount

      let daysRemaining: number | null = null
      let monthlyNeeded = 0

      if (goal.deadline) {
        daysRemaining = Math.max(0, dayjs(goal.deadline).diff(dayjs(), 'day'))
        const monthsLeft = dayjs(goal.deadline).diff(dayjs(), 'month', true)
        if (monthsLeft > 0 && remaining > 0) {
          monthlyNeeded = Math.ceil(remaining / monthsLeft)
        } else if (remaining > 0) {
          monthlyNeeded = remaining
        }
      }

      return {
        id: goal.id,
        name: goal.name,
        icon: goal.icon,
        targetAmount,
        currentAmount,
        remaining,
        progress,
        isCompleted,
        deadline: goal.deadline,
        daysRemaining,
        monthlyNeeded,
        accountName: goal.account_name,
        notes: goal.notes,
      }
    })

    const totalTarget = statuses.reduce((s, g) => s + g.targetAmount, 0)
    const totalSaved = statuses.reduce((s, g) => s + g.currentAmount, 0)
    const completedCount = statuses.filter((g) => g.isCompleted).length

    return {
      success: true,
      goals: statuses,
      summary: {
        totalGoals: statuses.length,
        completedGoals: completedCount,
        totalTarget,
        totalSaved,
        totalRemaining: totalTarget - totalSaved,
        overallProgress: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
      },
      message: `${statuses.length} savings goal(s). $${totalSaved.toFixed(2)} / $${totalTarget.toFixed(2)} total (${totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0}%). ${completedCount} completed.`,
    }
  },
})
