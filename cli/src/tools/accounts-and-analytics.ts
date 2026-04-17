import type { ToolDefinition } from './shared.js'
import { accountsTools } from './accounts.js'
import { analyticsTools } from './analytics.js'

export const accountsandanalyticsTools: ToolDefinition[] = [...accountsTools, ...analyticsTools]
