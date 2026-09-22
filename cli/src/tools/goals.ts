import { getCurrencySettings } from '../fx-service.js'
import { mainCurrencySetupNeeded, readCurrentAmounts, sumCentavos } from '../dated-read.js'
import {
  z,
  query,
  execute,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  isoDate,
  isAccountWriteEligible,
  transaction,
  type ToolDefinition,
} from './shared.js'

type GoalRow = {
  id: string
  name: string
  currency: string
  target_amount: number
  current_amount: number
  deadline: string | null
  account_id: string | null
  icon: string | null
  color: string | null
  notes: string | null
  account_name?: string | null
}

function nullableClearConflict(
  clear: boolean | undefined,
  value: unknown,
  field: string,
  flag: string
) {
  if (clear && value !== undefined) {
    return {
      success: false as const,
      message: `${field} conflicts with ${flag}; provide one or the other.`,
    }
  }
  return null
}

function resolveGoalAccountId(accountId: string | null) {
  if (accountId === null) return { success: true as const, id: null }
  const account = query<{ id: string; is_archived: number }>(
    'SELECT id, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  )[0]
  if (!account) {
    return { success: false as const, message: `Account ${accountId} not found.` }
  }
  if (!isAccountWriteEligible(account)) {
    return {
      success: false as const,
      message: `Account ${accountId} is archived. Unarchive it before using it for new writes.`,
    }
  }
  return { success: true as const, id: account.id }
}

const createGoal: ToolDefinition = {
  name: 'create-goal',
  description:
    'Create a savings goal. Use this when the user wants to set a savings target, like an emergency fund, vacation, or big purchase.',
  schema: z.object({
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
    deadline: z.string().optional().describe('Target date in YYYY-MM-DD format (optional)'),
    accountId: z.string().optional().describe('Account ID to link this goal to (optional)'),
    icon: z.string().optional().default('🎯').describe('Emoji icon for the goal'),
    color: z.string().optional().default('#bf5af2').describe('Color hex code for the goal'),
    notes: z.string().optional().describe('Additional notes about the goal'),
  }),
  execute: async ({
    name,
    targetAmount,
    currentAmount,
    deadline,
    accountId,
    icon,
    color,
    notes,
  }) => {
    const id = generateId()
    const now = new Date().toISOString()

    const creation = transaction(() => {
      const settings = getCurrencySettings()
      if (!settings.configured) return mainCurrencySetupNeeded
      execute(
        `INSERT INTO goals (id, name, target_amount, current_amount, deadline, account_id, icon, color, notes, created_at, updated_at, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
          settings.mainCurrency,
        ]
      )

      return { success: true as const, currency: settings.mainCurrency }
    })
    if (!creation.success) return creation

    const progress = targetAmount > 0 ? Math.round((currentAmount / targetAmount) * 100) : 0

    return {
      success: true,
      goal: {
        id,
        name,
        currency: creation.currency,
        targetAmount,
        currentAmount,
        deadline: deadline ?? null,
        progress,
      },
      message: `Created savings goal "${name}" — target: ${creation.currency} ${targetAmount.toFixed(2)}${currentAmount > 0 ? `, starting at $${currentAmount.toFixed(2)} (${progress}%)` : ''}.${deadline ? ` Deadline: ${deadline}.` : ''}`,
    }
  },
}

// ---------------------------------------------------------------------------
// 37. update-goal
// ---------------------------------------------------------------------------
const updateGoal: ToolDefinition = {
  name: 'update-goal',
  description:
    'Update a savings goal. Can add/withdraw saved amounts, change the target, deadline, or other details. Null or clear flags remove optional deadline, notes, and account; omission preserves them.',
  schema: z.object({
    goalId: z.string().describe('The ID of the goal to update'),
    name: z.string().optional().describe('New name for the goal'),
    targetAmount: z
      .number()
      .positive()
      .optional()
      .describe('New target amount in the goal’s recorded currency'),
    currentAmount: z.number().min(0).optional().describe('Set current amount directly'),
    addAmount: z
      .number()
      .positive()
      .optional()
      .describe('Amount to add in the goal’s recorded currency; linked account money is unchanged'),
    withdrawAmount: z
      .number()
      .positive()
      .optional()
      .describe(
        'Amount to withdraw in the goal’s recorded currency; linked account money is unchanged'
      ),
    deadline: isoDate('New deadline in YYYY-MM-DD format').nullable().optional(),
    notes: z
      .string()
      .nullable()
      .optional()
      .describe('New notes. Pass null or clearNotes to clear; omit to preserve.'),
    accountId: z
      .string()
      .nullable()
      .optional()
      .describe('Account ID to link this goal to. Pass null or clearAccount to unlink.'),
    clearDeadline: z.boolean().optional().describe('Clear the goal deadline'),
    clearNotes: z.boolean().optional().describe('Clear goal notes'),
    clearAccount: z.boolean().optional().describe('Clear the linked account'),
    icon: z.string().optional().describe('New emoji icon'),
    color: z.string().optional().describe('New color hex code'),
  }),
  execute: async ({
    goalId,
    name,
    targetAmount,
    currentAmount,
    addAmount,
    withdrawAmount,
    deadline,
    notes,
    accountId,
    clearDeadline,
    clearNotes,
    clearAccount,
    icon,
    color,
  }) => {
    const deadlineConflict = nullableClearConflict(
      clearDeadline,
      deadline,
      'deadline',
      'clearDeadline'
    )
    if (deadlineConflict) return deadlineConflict
    const notesConflict = nullableClearConflict(clearNotes, notes, 'notes', 'clearNotes')
    if (notesConflict) return notesConflict
    const accountConflict = nullableClearConflict(
      clearAccount,
      accountId,
      'accountId',
      'clearAccount'
    )
    if (accountConflict) return accountConflict

    return transaction(() => {
      const goal = query<GoalRow>(
        'SELECT id, name, currency, target_amount, current_amount, deadline, account_id, icon, color, notes FROM goals WHERE id = $1',
        [goalId]
      )[0]

      if (!goal) {
        return { success: false, message: `Goal ${goalId} not found.` }
      }

      const now = new Date().toISOString()
      const nextDeadline = clearDeadline ? null : deadline !== undefined ? deadline : goal.deadline
      const nextNotes = clearNotes ? null : notes !== undefined ? notes : goal.notes
      const requestedAccountId = clearAccount ? null : accountId
      let nextAccountId = goal.account_id
      if (requestedAccountId !== undefined) {
        const resolvedAccount = resolveGoalAccountId(requestedAccountId)
        if (!resolvedAccount.success) return resolvedAccount
        nextAccountId = resolvedAccount.id
      }

      let newCurrentCentavos = goal.current_amount
      if (currentAmount !== undefined) {
        newCurrentCentavos = toCentavos(currentAmount)
      } else if (addAmount !== undefined) {
        newCurrentCentavos = goal.current_amount + toCentavos(addAmount)
      } else if (withdrawAmount !== undefined) {
        newCurrentCentavos = Math.max(0, goal.current_amount - toCentavos(withdrawAmount))
      }

      const newTargetCentavos =
        targetAmount !== undefined ? toCentavos(targetAmount) : goal.target_amount
      const newName = name ?? goal.name
      const setClauses: string[] = []
      const params: unknown[] = []
      const addSetClause = (column: string, value: unknown) => {
        params.push(value)
        setClauses.push(`${column} = $${params.length}`)
      }

      if (name !== undefined) addSetClause('name', newName)
      if (targetAmount !== undefined) addSetClause('target_amount', newTargetCentavos)
      if (currentAmount !== undefined || addAmount !== undefined || withdrawAmount !== undefined) {
        addSetClause('current_amount', newCurrentCentavos)
      }
      if (clearDeadline || deadline !== undefined) addSetClause('deadline', nextDeadline)
      if (clearNotes || notes !== undefined) addSetClause('notes', nextNotes)
      if (requestedAccountId !== undefined) addSetClause('account_id', nextAccountId)
      if (icon !== undefined) addSetClause('icon', icon)
      if (color !== undefined) addSetClause('color', color)
      addSetClause('updated_at', now)

      params.push(goalId)
      execute(`UPDATE goals SET ${setClauses.join(', ')} WHERE id = $${params.length}`, params)

      const newCurrentAmount = fromCentavos(newCurrentCentavos)
      const newTargetAmount = fromCentavos(newTargetCentavos)
      const progress =
        newTargetAmount > 0 ? Math.round((newCurrentAmount / newTargetAmount) * 100) : 0

      return {
        success: true,
        goal: {
          id: goalId,
          name: newName,
          currency: goal.currency,
          targetAmount: newTargetAmount,
          currentAmount: newCurrentAmount,
          deadline: nextDeadline,
          progress,
        },
        message: `Updated goal "${newName}" — ${goal.currency} ${newCurrentAmount.toFixed(2)} / ${newTargetAmount.toFixed(2)} (${progress}%).`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 38. get-goal-status
// ---------------------------------------------------------------------------
const getGoalStatus: ToolDefinition = {
  name: 'get-goal-status',
  description: 'Get savings goal status showing progress toward each goal.',
  schema: z.object({
    goalId: z.string().optional().describe('Filter by specific goal ID. Omit to see all goals.'),
  }),
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
        currency: goal.currency,
        mainConversion: {
          policy: 'recorded_goal_value_today',
          target: readCurrentAmounts([
            { id: goal.id, amountCentavos: goal.target_amount, currency: goal.currency },
          ]),
          saved: readCurrentAmounts([
            { id: goal.id, amountCentavos: goal.current_amount, currency: goal.currency },
          ]),
        },
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

    const totalsByCurrency = [...new Set(goals.map((row) => row.currency))]
      .sort()
      .map((currency) => {
        const rows = goals.filter((row) => row.currency === currency)
        const totalTarget = fromCentavos(sumCentavos(rows.map((row) => row.target_amount)))
        const totalSaved = fromCentavos(sumCentavos(rows.map((row) => row.current_amount)))
        return {
          currency,
          totalTarget,
          totalSaved,
          totalRemaining: totalTarget - totalSaved,
          overallProgress: totalTarget > 0 ? Math.round((totalSaved / totalTarget) * 100) : 0,
        }
      })
    const single = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null
    const completedCount = statuses.filter((g) => g.isCompleted).length
    return {
      success: true,
      currency: single?.currency ?? null,
      goals: statuses,
      totalsByCurrency,
      mainConversion: {
        policy: 'recorded_goal_value_today',
        target: readCurrentAmounts(
          goals.map((row) => ({
            id: row.id,
            amountCentavos: row.target_amount,
            currency: row.currency,
          }))
        ),
        saved: readCurrentAmounts(
          goals.map((row) => ({
            id: row.id,
            amountCentavos: row.current_amount,
            currency: row.currency,
          }))
        ),
      },
      summary: {
        totalGoals: statuses.length,
        completedGoals: completedCount,
        totalTarget: single?.totalTarget ?? null,
        totalSaved: single?.totalSaved ?? null,
        totalRemaining: single?.totalRemaining ?? null,
        overallProgress: single?.overallProgress ?? null,
      },
      message: `${statuses.length} savings goal(s), grouped by recorded denomination. ${completedCount} completed.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 39. get-financial-health-score
// ---------------------------------------------------------------------------

export const goalsTools: ToolDefinition[] = [createGoal, updateGoal, getGoalStatus]
