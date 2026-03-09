import { tool, zodSchema } from 'ai'
import { z } from 'zod'

export const getSubscriptionSpending = tool({
  description:
    'Analyze subscription spending from Subby. Groups subscriptions by category and shows monthly/yearly cost breakdown.',
  inputSchema: zodSchema(
    z.object({})
  ),
  execute: async () => {
    return {
      success: false,
      message: 'Subby integration is not available in browser mode. Direct SQLite access to Subby requires Tauri. Future: integrate via Subby MCP server or data import.',
    }
  },
})
