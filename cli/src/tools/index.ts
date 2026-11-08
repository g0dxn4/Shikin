import type { ToolDefinition } from './shared.js'
import {
  addTransaction,
  bindTransactionImportIdentity,
  updateTransaction,
  deleteTransaction,
  matchTransferTransactions,
  unmatchTransferTransactions,
  tagTransaction,
  untagTransaction,
  createPlaceholderTransaction,
  resolvePlaceholderTransaction,
  splitPlaceholderTransaction,
} from './transactions.js'
import {
  correctTransactionMetadata,
  setTransactionConsumption,
  clearTransactionConsumption,
} from '../transaction-corrections.js'
import { queryTransactions, listTags, listPlaceholderTransactions } from './transaction-queries.js'
import { getSpendingSummary } from './spending-summary.js'
import { accountsandanalyticsTools } from './accounts-and-analytics.js'
import { budgetsandnetworthTools } from './budgets-and-net-worth.js'
import { creditCardsTools } from './credit-cards.js'
import { manageInvestment, listInvestments } from './investments.js'
import { getUpcomingBills } from './upcoming-bills.js'
import {
  createSubscription,
  createSubscriptionFromTransaction,
  updateSubscription,
  deleteSubscription,
  listSubscriptions,
  getSubscriptionSpending,
} from './subscriptions.js'
import { notebookandmarketTools } from './notebook-and-market.js'
import { automationTools } from './automation.js'
import { planningandhealthTools } from './planning-and-health.js'
import { backupDatabaseTool, restoreDatabaseTool } from './database-backup.js'
import { financeProfile } from './finance-profile.js'
import { importTransactions } from './csv-import.js'
import { exportData } from './export-data.js'
import { cashflowBucketTools } from './cashflow-buckets.js'
import { financeSanityCheck } from './finance-sanity.js'
import { auditList, auditShow } from './audit-history.js'
import { automationContext } from './automation-context.js'
import { undo } from './undo.js'
import { pluginTools } from './plugins.js'
import { receivablesTools } from './receivables.js'
import { runtimeDiagnosticsTools } from './runtime-diagnostics.js'
import { fxTools } from './fx.js'
import { classificationTools } from '../classification-tools.js'
import { loadEnabledPluginToolDefinitions } from '../plugins.js'

export const builtInTools: ToolDefinition[] = [
  correctTransactionMetadata,
  setTransactionConsumption,
  clearTransactionConsumption,
  addTransaction,
  bindTransactionImportIdentity,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  matchTransferTransactions,
  unmatchTransferTransactions,
  tagTransaction,
  untagTransaction,
  listTags,
  createPlaceholderTransaction,
  listPlaceholderTransactions,
  resolvePlaceholderTransaction,
  splitPlaceholderTransaction,
  getSpendingSummary,
  ...accountsandanalyticsTools,
  ...creditCardsTools,
  ...budgetsandnetworthTools,
  manageInvestment,
  listInvestments,
  getUpcomingBills,
  createSubscription,
  createSubscriptionFromTransaction,
  updateSubscription,
  deleteSubscription,
  listSubscriptions,
  getSubscriptionSpending,
  ...notebookandmarketTools,
  ...automationTools,
  backupDatabaseTool,
  restoreDatabaseTool,
  financeProfile,
  importTransactions,
  exportData,
  undo,
  financeSanityCheck,
  auditList,
  auditShow,
  automationContext,
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
