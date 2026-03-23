import { generateText } from 'ai'
import type { LanguageModel, UIMessage } from 'ai'
import { updateConversationSummary } from './conversation-persistence'
import { execute, query } from '@/lib/database'
import { generateId } from '@/lib/ulid'

export const COMPACTION_THRESHOLD = 30
const KEEP_RECENT = 10
/** Minimum number of user messages since last extraction before we attempt auto-extraction */
const EXTRACTION_USER_MESSAGE_THRESHOLD = 5

export function shouldCompact(messages: UIMessage[]): boolean {
  return messages.length >= COMPACTION_THRESHOLD
}

const SUMMARIZATION_PROMPT = `Summarize the following conversation between a user and their AI financial assistant (Ivy).
Focus on:
- Key financial actions taken (transactions added, accounts created, etc.)
- Tool calls and their results (e.g., "queried transactions for March", "created budget for Food")
- Important user preferences or decisions mentioned
- Any unresolved questions or ongoing topics

Be concise but capture all important context, including tool interactions. Write in third person.`

const MEMORY_EXTRACTION_PROMPT = `You are analyzing a conversation between a user and their AI financial assistant (Ivy).
Extract key facts, preferences, goals, and behavioral patterns that should be remembered across conversations.

Rules:
- Only extract genuinely useful, long-term information (not transient questions or greetings)
- Each memory should be a single, clear statement
- Categorize each memory as one of: preference, fact, goal, behavior, context
- Assign importance 1-10 (10=critical life fact, 7-9=important preference/goal, 4-6=useful context, 1-3=minor detail)
- Do NOT extract information that is purely transactional (e.g., "user asked about balance" — that's not a memory)
- DO extract: currency preferences, income details, financial goals, spending habits, life context, account preferences

Respond with a JSON array of objects. Each object must have: content (string), category (string), importance (number).
If there is nothing worth extracting, respond with an empty array: []

Example output:
[
  {"content": "User prefers to track expenses in MXN", "category": "preference", "importance": 8},
  {"content": "User has a savings goal of $10,000 for a house down payment", "category": "goal", "importance": 9}
]`

/**
 * Count user messages in a message array.
 */
function countUserMessages(messages: UIMessage[]): number {
  return messages.filter((m) => m.role === 'user').length
}

/**
 * Extract and save memories from recent conversation messages.
 * Returns the number of memories extracted.
 */
export async function extractMemories(
  messages: UIMessage[],
  model: LanguageModel
): Promise<number> {
  const transcript = messages
    .map((m) => {
      const textParts = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join('\n')
      // Include tool call context for richer extraction
      const toolParts = m.parts
        .filter((p) => p.type.startsWith('tool-'))
        .map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolPart = p as any
          const toolName = toolPart.toolName || toolPart.name || 'tool'
          const result = toolPart.result ?? toolPart.toolInvocation?.result
          return `[Tool: ${toolName}${result ? ` → ${JSON.stringify(result).slice(0, 200)}` : ''}]`
        })
        .join('\n')
      const content = [textParts, toolParts].filter(Boolean).join('\n')
      return content ? `${m.role}: ${content}` : ''
    })
    .filter(Boolean)
    .join('\n')

  if (!transcript.trim()) return 0

  try {
    const { text } = await generateText({
      model,
      prompt: `${MEMORY_EXTRACTION_PROMPT}\n\n---\n\n${transcript}`,
      temperature: 0.2,
      maxOutputTokens: 1024,
    })

    // Parse JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return 0

    const memories = JSON.parse(jsonMatch[0]) as Array<{
      content: string
      category: string
      importance: number
    }>

    if (!Array.isArray(memories) || memories.length === 0) return 0

    const validCategories = new Set(['preference', 'fact', 'goal', 'behavior', 'context'])
    let saved = 0

    for (const mem of memories) {
      if (!mem.content || !validCategories.has(mem.category)) continue
      const importance = Math.max(1, Math.min(10, Math.round(mem.importance || 5)))

      // Check for duplicate/similar content to avoid redundant memories
      const existing = await query<{ id: string; content: string }>(
        `SELECT id, content FROM ai_memories
         WHERE category = $1 AND content LIKE $2
         LIMIT 1`,
        [mem.category, `%${mem.content.slice(0, 40)}%`]
      )

      if (existing.length > 0) {
        // Update existing similar memory if new one has higher importance
        await execute(
          `UPDATE ai_memories SET content = $1, importance = MAX(importance, $2),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $3`,
          [mem.content, importance, existing[0].id]
        )
      } else {
        const id = generateId()
        await execute(
          `INSERT INTO ai_memories (id, category, content, importance)
           VALUES ($1, $2, $3, $4)`,
          [id, mem.category, mem.content, importance]
        )
      }
      saved++
    }

    return saved
  } catch (err) {
    console.error('[Ivy] Memory extraction failed:', err)
    return 0
  }
}

/**
 * Check whether we should run auto-extraction based on the number of
 * user messages since we last extracted.
 */
export function shouldExtractMemories(messages: UIMessage[]): boolean {
  const userMsgCount = countUserMessages(messages)
  return userMsgCount >= EXTRACTION_USER_MESSAGE_THRESHOLD
}

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

  // Extract memories from the messages being compacted before summarizing
  try {
    const extracted = await extractMemories(olderMessages, model)
    if (extracted > 0) {
      console.log(`[Ivy] Extracted ${extracted} memories during compaction`)
    }
  } catch (err) {
    console.warn('[Ivy] Memory extraction during compaction failed:', err)
  }

  // Build text transcript from older messages, including tool context
  const transcript = olderMessages
    .map((m) => {
      const textParts = m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { type: 'text'; text: string }).text)
        .join('\n')
      // Include tool call context so the summary preserves tool interactions
      const toolParts = m.parts
        .filter((p) => p.type.startsWith('tool-'))
        .map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const toolPart = p as any
          const toolName = toolPart.toolName || toolPart.name || 'tool'
          const result = toolPart.result ?? toolPart.toolInvocation?.result
          return `[Used tool: ${toolName}${result ? ` → ${typeof result === 'string' ? result.slice(0, 150) : JSON.stringify(result).slice(0, 150)}` : ''}]`
        })
        .join('\n')
      const content = [textParts, toolParts].filter(Boolean).join('\n')
      return content ? `${m.role}: ${content}` : ''
    })
    .filter(Boolean)
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
