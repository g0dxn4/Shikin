import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fetchNewsForSymbol, fetchNewsForPortfolio } from '@/lib/news-service'
import { query } from '@/lib/database'
import type { Investment } from '@/types/database'

export const getFinancialNews = tool({
  description:
    'Fetch financial news for a specific symbol or the entire portfolio. Val uses this to stay informed about holdings and save insights to the notebook.',
  inputSchema: zodSchema(
    z.object({
      symbol: z
        .string()
        .optional()
        .describe('Stock/crypto symbol. If omitted, fetches news for the whole portfolio.'),
      days: z.number().optional().default(7).describe('Number of days to look back'),
    })
  ),
  execute: async ({ symbol, days }) => {
    try {
      if (symbol) {
        const articles = await fetchNewsForSymbol(symbol, days)
        return {
          success: true,
          symbol,
          articles: articles.slice(0, 10),
          count: articles.length,
          disclaimer: 'News is for informational purposes only and does not constitute investment advice.',
        }
      }

      // Fetch for entire portfolio
      const investments = await query<Investment>('SELECT DISTINCT symbol FROM investments')
      if (investments.length === 0) {
        return { success: true, articles: [], count: 0, message: 'No investments to track news for.' }
      }

      const symbols = investments.map((i) => i.symbol)
      const articles = await fetchNewsForPortfolio(symbols)
      return {
        success: true,
        symbols,
        articles: articles.slice(0, 15),
        count: articles.length,
        disclaimer: 'News is for informational purposes only and does not constitute investment advice.',
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to fetch news: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
