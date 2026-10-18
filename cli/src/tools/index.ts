import type { ToolDefinition } from './shared.js'
import { transactionsTools } from './transactions.js'
import { transactionBatchTools } from './transaction-batch.js'
import { accountsandanalyticsTools } from './accounts-and-analytics.js'
import { budgetsandnetworthTools } from './budgets-and-net-worth.js'
import { budgetHistoryTools } from './budget-history.js'
import { creditCardsTools } from './credit-cards.js'
import { investmentsandsubscriptionsTools } from './investments-and-subscriptions.js'
import { notebookandmarketTools } from './notebook-and-market.js'
import { automationTools } from './automation.js'
import { planningandhealthTools } from './planning-and-health.js'
import { dataOpsTools } from './data-ops.js'
import { cashflowBucketTools } from './cashflow-buckets.js'
import { auditAndContextTools } from './audit-and-context.js'
import { pluginTools } from './plugins.js'
import { receivablesTools } from './receivables.js'
import { runtimeDiagnosticsTools } from './runtime-diagnostics.js'
import { fxTools } from './fx.js'
import { classificationTools } from '../classification-tools.js'
import { loadEnabledPluginToolDefinitions } from '../plugins.js'

export const builtInTools: ToolDefinition[] = [
  ...transactionsTools,
  ...transactionBatchTools,
  ...accountsandanalyticsTools,
  ...creditCardsTools,
  ...budgetsandnetworthTools,
  ...budgetHistoryTools,
  ...investmentsandsubscriptionsTools,
  ...notebookandmarketTools,
  ...automationTools,
  ...dataOpsTools,
  ...auditAndContextTools,
  ...cashflowBucketTools,
  ...planningandhealthTools,
  ...receivablesTools,
  ...runtimeDiagnosticsTools,
  ...fxTools,
  ...classificationTools,
  ...pluginTools,
]

export const tools: ToolDefinition[] = [
  ...builtInTools,
  ...loadEnabledPluginToolDefinitions(builtInTools),
]
