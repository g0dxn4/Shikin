import type { ToolDefinition } from './shared.js'
import { transactionsTools } from './transactions.js'
import { accountsandanalyticsTools } from './accounts-and-analytics.js'
import { budgetsandnetworthTools } from './budgets-and-net-worth.js'
import { creditCardsTools } from './credit-cards.js'
import { investmentsandsubscriptionsTools } from './investments-and-subscriptions.js'
import { notebookandmarketTools } from './notebook-and-market.js'
import { automationTools } from './automation.js'
import { planningandhealthTools } from './planning-and-health.js'
import { dataOpsTools } from './data-ops.js'
import { cashflowBucketTools } from './cashflow-buckets.js'

export const tools: ToolDefinition[] = [
  ...transactionsTools,
  ...accountsandanalyticsTools,
  ...creditCardsTools,
  ...budgetsandnetworthTools,
  ...investmentsandsubscriptionsTools,
  ...notebookandmarketTools,
  ...automationTools,
  ...dataOpsTools,
  ...cashflowBucketTools,
  ...planningandhealthTools,
]
