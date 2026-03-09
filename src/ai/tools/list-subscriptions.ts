import { tool, zodSchema } from 'ai'
import { z } from 'zod'

export const listSubscriptions = tool({
  description:
    'List subscriptions from Subby (the subscription tracker app). Shows active subscriptions with their amounts, billing cycles, and next payment dates.',
  inputSchema: zodSchema(
    z.object({
      activeOnly: z
        .boolean()
        .optional()
        .default(true)
        .describe('Only show active subscriptions (default: true)'),
    })
  ),
  execute: async () => {
    return {
      success: false,
      message: 'Subby integration is not available in browser mode. Direct SQLite access to Subby requires Tauri. Future: integrate via Subby MCP server or data import.',
    }
  },
})
