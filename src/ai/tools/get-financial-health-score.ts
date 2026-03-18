import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { calculateHealthScore } from '@/lib/health-score-service'

export const getFinancialHealthScore = tool({
  description:
    'Calculate the user\'s financial health score (0-100) with a breakdown across savings rate, budget adherence, debt-to-income, emergency fund, and spending consistency. Use this when the user asks about their financial health, score, or overall financial status.',
  inputSchema: zodSchema(
    z.object({})
  ),
  execute: async () => {
    const score = await calculateHealthScore()

    return {
      overall: score.overall,
      grade: score.grade,
      trend: score.trend,
      subscores: score.subscores.map((s) => ({
        name: s.name,
        score: s.score,
        weight: `${Math.round(s.weight * 100)}%`,
        description: s.description,
        tip: s.tip,
      })),
      tips: score.tips,
      message: `Financial health score: ${score.overall}/100 (${score.grade}). ${score.tips[0] || ''}`,
    }
  },
})
