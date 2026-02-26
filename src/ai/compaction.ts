import { generateText } from 'ai'
import type { LanguageModel, UIMessage } from 'ai'
import { updateConversationSummary } from './conversation-persistence'

export const COMPACTION_THRESHOLD = 30
const KEEP_RECENT = 10

export function shouldCompact(messages: UIMessage[]): boolean {
  return messages.length >= COMPACTION_THRESHOLD
}

const SUMMARIZATION_PROMPT = `Summarize the following conversation between a user and their AI financial assistant (Val).
Focus on:
- Key financial actions taken (transactions added, accounts created, etc.)
- Important user preferences or decisions mentioned
- Any unresolved questions or ongoing topics

Be concise but capture all important context. Write in third person.`

export async function compactMessages(
  conversationId: string,
  messages: UIMessage[],
  model: LanguageModel,
  force = false
): Promise<UIMessage[]> {
  if (!force && messages.length < COMPACTION_THRESHOLD) return messages
  if (messages.length < 4) return messages

  const keepRecent = Math.min(KEEP_RECENT, Math.floor(messages.length / 2))
  const olderMessages = messages.slice(0, -keepRecent)
  const recentMessages = messages.slice(-keepRecent)

  // Build text transcript from older messages
  const transcript = olderMessages
    .map((m) => {
      const text = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join('\n')
      return `${m.role}: ${text}`
    })
    .filter((line) => !line.endsWith(': '))
    .join('\n')

  if (!transcript.trim()) return messages

  const { text: summary } = await generateText({
    model,
    prompt: `${SUMMARIZATION_PROMPT}\n\n---\n\n${transcript}`,
    temperature: 0.3,
    maxOutputTokens: 1024,
  })

  // Store summary on conversation
  await updateConversationSummary(conversationId, summary)

  // Create a summary message to prepend
  const summaryMessage: UIMessage = {
    id: 'summary',
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: `[Previous conversation summary]\n${summary}`,
      },
    ],
  }

  return [summaryMessage, ...recentMessages]
}
