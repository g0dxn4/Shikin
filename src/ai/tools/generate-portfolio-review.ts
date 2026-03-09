import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { writeWeeklyReview, gatherReviewData, shouldGenerateReview } from '@/lib/portfolio-review'

export const generatePortfolioReview = tool({
  description:
    'Generate a portfolio review and save it to the notebook. Reviews include performance summary, top/worst performers, and a holdings table. Val can then add commentary and news analysis.',
  inputSchema: zodSchema(
    z.object({
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe('Force generation even if a review exists for this week'),
    })
  ),
  execute: async ({ force }) => {
    try {
      if (!force) {
        const needed = await shouldGenerateReview()
        if (!needed) {
          return {
            success: true,
            message: 'A review already exists for this week. Use force=true to regenerate.',
            alreadyExists: true,
          }
        }
      }

      const data = await gatherReviewData()
      if (data.holdings.length === 0) {
        return {
          success: true,
          message: 'No investments to review. Add some holdings first!',
        }
      }

      const filename = await writeWeeklyReview()
      return {
        success: true,
        message: `Portfolio review generated and saved to notebook: ${filename}`,
        filename,
        summary: {
          portfolioValue: data.portfolioValue,
          gainLossPercent: data.gainLossPercent,
          topPerformer: data.topPerformer,
          worstPerformer: data.worstPerformer,
          holdingsCount: data.holdings.length,
        },
      }
    } catch (err) {
      return {
        success: false,
        message: `Failed to generate review: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
})
