import { saveBasisRecap } from '../recap-persistence.js'
import { z, isoDate, type ToolDefinition } from './shared.js'

import {
  calculateFinancialHealthScoreSummary,
  generateSpendingRecapSummary,
  getEducationTipSummary,
} from '../insights.js'

const getFinancialHealthScore: ToolDefinition = {
  name: 'get-financial-health-score',
  description:
    "Calculate the user's financial health score (0-100) with a breakdown across savings rate, budget adherence, debt-to-income, emergency fund, and spending consistency.",
  schema: z.object({}),
  execute: async () => calculateFinancialHealthScoreSummary(),
}

// ---------------------------------------------------------------------------
// 40. get-spending-recap
// ---------------------------------------------------------------------------
const getSpendingRecap: ToolDefinition = {
  name: 'get-spending-recap',
  description:
    'Read a spending recap without saving. Gross cash flow by default; explicit net consumption is available with coverage status.',
  schema: z.object({
    basis: z.enum(['gross_cashflow', 'net_consumption']).optional().default('gross_cashflow'),
    type: z
      .enum(['weekly', 'monthly'])
      .describe('Type of recap: weekly (past 7 days) or monthly (full month)'),
    period: isoDate('Optional ISO date (YYYY-MM-DD) to target a specific month.').optional(),
  }),
  effects: {
    readOnly: true,
    writesTo: [],
  },
  execute: async ({ type, period, basis }) => generateSpendingRecapSummary(type, period, basis),
}

/** Explicit persistence; logical identity by type, period, currencyScope=all and selected basis.
 * Only recaps and audit_log are written; identical repeated saves are no-ops.
 */
const saveSpendingRecap: ToolDefinition = {
  name: 'save-spending-recap',
  description:
    'Explicitly save a spending recap. Writes only recaps and audit_log; identity includes type, period, all-currencies scope and selected basis. Unchanged re-saves are no-ops.',
  schema: getSpendingRecap.schema,
  effects: {
    readOnly: false,
    idempotent: true,
    writesTo: ['recaps', 'audit_log'],
  },
  execute: async ({ type, period, basis }) => {
    const result = await generateSpendingRecapSummary(type, period, basis)
    if (!result.success || !result.recap) return result
    await saveBasisRecap(result.recap)
    return { ...result, saved: true, message: `Saved ${type} ${basis} recap.` }
  },
}

// ---------------------------------------------------------------------------
// 41. get-debt-payoff-plan
// ---------------------------------------------------------------------------
const getEducationTip: ToolDefinition = {
  name: 'get-education-tip',
  description:
    'Get a contextual financial education tip. Use this when the user asks about financial concepts or when educational context would enhance the conversation.',
  schema: z.object({
    topic: z
      .enum(['budgeting', 'saving', 'investing', 'debt', 'general'])
      .optional()
      .describe('The financial topic to get a tip about'),
    action: z.string().optional().describe('The user action that triggered this tip'),
    query: z.string().optional().describe('A free-text query to match against tip content'),
  }),
  execute: async ({ topic, action, query }) => getEducationTipSummary({ topic, action, query }),
}

export const financialInsightsTools: ToolDefinition[] = [
  getFinancialHealthScore,
  getSpendingRecap,
  saveSpendingRecap,
  getEducationTip,
]
