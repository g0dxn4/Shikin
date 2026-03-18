import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import {
  getContextualTip,
  getTipForAction,
  getTipsByTopic,
  type EducationTopic,
} from '@/lib/education-service'

export const getEducationTip = tool({
  description:
    'Get a contextual financial education tip. Use this when the user asks about financial concepts, performs a financial action for the first time, or when educational context would enhance the conversation. Always frame tips as educational information, not financial advice.',
  inputSchema: zodSchema(
    z.object({
      topic: z
        .enum(['budgeting', 'saving', 'investing', 'debt', 'general'])
        .optional()
        .describe('The financial topic to get a tip about'),
      action: z
        .string()
        .optional()
        .describe(
          'The user action that triggered this tip (e.g., "first-budget", "first-investment", "credit-card-payment", "debt-payment", "savings-deposit")'
        ),
      query: z
        .string()
        .optional()
        .describe('A free-text query to match against tip content (e.g., "compound interest", "diversification")'),
    })
  ),
  execute: async ({ topic, action, query }) => {
    // Priority 1: action-based tip
    if (action) {
      const actionTip = getTipForAction(action)
      if (actionTip) {
        return {
          tip: actionTip,
          disclaimer:
            'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
        }
      }
    }

    // Priority 2: topic-based tips
    if (topic) {
      const topicTips = getTipsByTopic(topic as EducationTopic)
      if (topicTips.length > 0) {
        const tip = topicTips[Math.floor(Math.random() * topicTips.length)]
        return {
          tip,
          relatedTips: topicTips
            .filter((t) => t.id !== tip.id)
            .map((t) => ({ id: t.id, title: t.title })),
          disclaimer:
            'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
        }
      }
    }

    // Priority 3: query-based contextual tip
    if (query) {
      const tip = getContextualTip(query)
      if (tip) {
        return {
          tip,
          disclaimer:
            'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
        }
      }
    }

    // Fallback: random tip from topic or general
    const fallbackTip = getContextualTip(topic || 'general')
    return {
      tip: fallbackTip,
      disclaimer:
        'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
    }
  },
})
