import { generateId } from '@/lib/ulid'
import { query, execute } from '@/lib/database'
import type { AIConversation, AIMessage } from '@/types/database'
import type { UIMessage } from 'ai'

export async function createConversation(model?: string): Promise<string> {
  const id = generateId()
  await execute(
    'INSERT INTO ai_conversations (id, title, model) VALUES ($1, $2, $3)',
    [id, 'New Conversation', model || null]
  )
  return id
}

export async function listConversations(): Promise<AIConversation[]> {
  return query<AIConversation>(
    'SELECT * FROM ai_conversations ORDER BY updated_at DESC'
  )
}

export async function deleteConversation(id: string): Promise<void> {
  await execute('DELETE FROM ai_conversations WHERE id = $1', [id])
}

export async function saveMessage(
  conversationId: string,
  message: UIMessage
): Promise<void> {
  // Extract text content from parts
  const textParts = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
  const content = textParts.join('\n') || ''

  // Serialize tool parts
  const toolParts = message.parts.filter((p) => p.type.startsWith('tool-'))
  const toolCalls = toolParts.length > 0 ? JSON.stringify(toolParts) : null

  const id = generateId()
  await execute(
    `INSERT INTO ai_messages (id, conversation_id, role, content, tool_calls)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, conversationId, message.role, content, toolCalls]
  )

  // Update conversation timestamp
  await execute(
    `UPDATE ai_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1`,
    [conversationId]
  )
}

export async function loadMessages(conversationId: string): Promise<UIMessage[]> {
  const rows = await query<AIMessage>(
    'SELECT * FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId]
  )

  return rows.map((row) => {
    const parts: UIMessage['parts'] = []

    if (row.content) {
      parts.push({ type: 'text' as const, text: row.content })
    }

    // Restore serialized tool parts
    if (row.tool_calls) {
      try {
        const toolParts = JSON.parse(row.tool_calls) as UIMessage['parts']
        parts.push(...toolParts)
      } catch {
        // Ignore malformed tool_calls
      }
    }

    // Ensure at least one part exists
    if (parts.length === 0) {
      parts.push({ type: 'text' as const, text: '' })
    }

    return {
      id: row.id,
      role: row.role as UIMessage['role'],
      parts,
    } as UIMessage
  })
}

export async function generateTitle(firstUserMessage: string): Promise<string> {
  const title = firstUserMessage.slice(0, 60)
  return title.length < firstUserMessage.length ? title + '...' : title
}

export async function updateConversationTitle(
  id: string,
  title: string
): Promise<void> {
  await execute(
    `UPDATE ai_conversations SET title = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
    [title, id]
  )
}

export async function updateConversationSummary(
  id: string,
  summary: string
): Promise<void> {
  await execute(
    `UPDATE ai_conversations SET summary = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
    [summary, id]
  )
}

export async function getConversation(id: string): Promise<AIConversation | null> {
  const rows = await query<AIConversation>(
    'SELECT * FROM ai_conversations WHERE id = $1',
    [id]
  )
  return rows[0] || null
}
