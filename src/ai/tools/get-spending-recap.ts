import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateWeeklyRecap, generateMonthlyRecap } from '@/lib/recap-service'

export const getSpendingRecap = tool({
  description:
    'Generate a natural-language spending recap for a given period. Returns a human-readable summary with highlights. Use when the user asks for a recap, summary of their week/month, or spending overview.',
  inputSchema: zodSchema(
    z.object({
      type: z
        .enum(['weekly', 'monthly'])
        .describe('Type of recap: weekly (past 7 days) or monthly (full month)'),
      period: z
        .string()
        .optional()
        .describe('Optional ISO date (YYYY-MM-DD) to target a specific month. Only used for monthly recaps.'),
    })
  ),
  execute: async ({ type, period }) => {
    const recap = type === 'weekly'
      ? await generateWeeklyRecap()
      : await generateMonthlyRecap(period)

    return {
      title: recap.title,
      summary: recap.summary,
      highlights: recap.highlights,
      period: {
        start: recap.period_start,
        end: recap.period_end,
      },
      generated_at: recap.generated_at,
    }
  },
})
