import type { ToolDefinition } from './shared.js'
import { goalsTools } from './goals.js'
import { financialInsightsTools } from './financial-insights.js'
import { debtTools } from './debt-tools.js'
import { currencyAndSplitTools } from './currency-and-splits.js'
import { setupStatusTools } from './setup-status.js'

export const planningandhealthTools: ToolDefinition[] = [
  ...setupStatusTools,
  ...goalsTools,
  ...financialInsightsTools,
  ...debtTools,
  ...currencyAndSplitTools,
]
