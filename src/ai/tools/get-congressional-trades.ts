import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fetchRecentTrades, fetchTradesForSymbol, DISCLAIMER } from '@/lib/congressional-trades'

export const getCongressionalTrades = tool({
  description:
    'Check recent congressional stock trading disclosures. This is public data that can be interesting to review alongside your own holdings. Not predictive or advisory.',
  inputSchema: zodSchema(
    z.object({
      symbol: z
        .string()
        .optional()
        .describe('Filter trades by ticker symbol. If omitted, returns all recent trades.'),
      days: z.number().optional().default(30).describe('Number of days to look back'),
    })
  ),
  execute: async ({ symbol, days }) => {
    try {
      const trades = symbol
        ? await fetchTradesForSymbol(symbol)
        : await fetchRecentTrades(days)

      return {
        success: true,
        trades: trades.slice(0, 25),
        count: trades.length,
        disclaimer: DISCLAIMER,
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to fetch congressional trades: ${err instanceof Error ? err.message : String(err)}`,
        disclaimer: DISCLAIMER,
      }
    }
  },
})
