import { z, type ToolDefinition } from './shared.js'

import { detectSpendingAnomaliesSummary, generateCashFlowForecastSummary } from '../insights.js'

const getSpendingAnomalies: ToolDefinition = {
  name: 'get-spending-anomalies',
  description:
    'Detect and return spending anomalies such as unusual charges, duplicate transactions, spending spikes, and large transactions.',
  schema: z.object({
    largeTransactionThreshold: z
      .number()
      .optional()
      .default(500)
      .describe(
        'Threshold for flagging large transactions, interpreted independently in each transaction’s own currency (default: 500 units of that currency).'
      ),
  }),
  execute: async ({ largeTransactionThreshold }) =>
    detectSpendingAnomaliesSummary(largeTransactionThreshold),
}

// ---------------------------------------------------------------------------
// 33. manage-recurring-transaction
// ---------------------------------------------------------------------------
const getForecastedCashFlow: ToolDefinition = {
  name: 'get-forecasted-cash-flow',
  description: 'Get a cash flow forecast showing projected balances, burn rate, and danger dates.',
  schema: z.object({
    days: z
      .number()
      .optional()
      .default(30)
      .describe('Number of days to forecast (default 30, max 90)'),
  }),
  execute: async ({ days }) => generateCashFlowForecastSummary(days),
}

// ---------------------------------------------------------------------------
// 36. create-goal
// ---------------------------------------------------------------------------

export const alertsAndForecastTools: ToolDefinition[] = [
  getSpendingAnomalies,
  getForecastedCashFlow,
]
