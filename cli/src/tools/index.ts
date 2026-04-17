import type { ToolDefinition } from './shared.js'
import { transactionsTools } from './transactions.js'
import { accountsandanalyticsTools } from './accounts-and-analytics.js'
import { memoryTools } from './memory.js'
import { budgetsandnetworthTools } from './budgets-and-net-worth.js'
import { investmentsandsubscriptionsTools } from './investments-and-subscriptions.js'
import { notebookandmarketTools } from './notebook-and-market.js'
import { automationTools } from './automation.js'
import { planningandhealthTools } from './planning-and-health.js'

export const tools: ToolDefinition[] = [
  ...transactionsTools,
  ...accountsandanalyticsTools,
  ...memoryTools,
  ...budgetsandnetworthTools,
  ...investmentsandsubscriptionsTools,
  ...notebookandmarketTools,
  ...automationTools,
  ...planningandhealthTools,
]
