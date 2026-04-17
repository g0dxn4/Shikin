import {
  EDUCATION_TIPS,
  ACTION_TO_TIP,
  getDailyEducationTip,
  type EducationTopic,
  type EducationTip,
} from './shared.js'

export async function getEducationTipSummary(input: {
  topic?: EducationTopic
  action?: string
  query?: string
}) {
  let tip: EducationTip | undefined
  let source = 'daily'

  if (input.action) {
    const mappedTipId = ACTION_TO_TIP[input.action]
    if (mappedTipId) {
      tip = EDUCATION_TIPS.find((entry) => entry.id === mappedTipId)
      source = 'action'
    }
  }

  if (!tip && input.topic) {
    tip = EDUCATION_TIPS.find((entry) => entry.topic === input.topic)
    source = 'topic'
  }

  if (!tip && input.query) {
    const normalized = input.query.toLowerCase()
    tip = EDUCATION_TIPS.find(
      (entry) =>
        entry.id.includes(normalized) ||
        entry.title.toLowerCase().includes(normalized) ||
        entry.content.toLowerCase().includes(normalized)
    )
    source = 'query'
  }

  if (!tip) {
    tip = getDailyEducationTip()
  }

  return {
    success: true,
    tip,
    source,
    disclaimer:
      'This is educational information, not financial advice. Consider consulting a qualified financial professional for personalized guidance.',
    message: `Selected education tip: ${tip.title}.`,
  }
}
