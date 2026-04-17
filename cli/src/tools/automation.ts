import type { ToolDefinition } from './shared.js'
import { categoryRulesTools } from './category-rules.js'
import { recurringTools } from './recurring.js'
import { alertsAndForecastTools } from './alerts-and-forecast.js'

export const automationTools: ToolDefinition[] = [
  ...categoryRulesTools,
  ...recurringTools,
  ...alertsAndForecastTools,
]
