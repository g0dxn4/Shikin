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
  description: 'Generate a natural-language spending recap for a given period.',
  schema: z.object({
    type: z
      .enum(['weekly', 'monthly'])
      .describe('Type of recap: weekly (past 7 days) or monthly (full month)'),
    period: isoDate('Optional ISO date (YYYY-MM-DD) to target a specific month.').optional(),
  }),
  execute: async ({ type, period }) => generateSpendingRecapSummary(type, period),
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
  getEducationTip,
]
