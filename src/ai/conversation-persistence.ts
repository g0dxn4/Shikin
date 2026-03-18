import { generateId } from '@/lib/ulid'
import { query, execute } from '@/lib/database'
import type { AIConversation, AIMessage } from '@/types/database'
import type { UIMessage } from 'ai'

const DEFAULT_MESSAGE_WINDOW = 100

function rowToMessage(row: AIMessage): UIMessage {
  const parts: UIMessage['parts'] = []

  if (row.content) {
    parts.push({ type: 'text' as const, text: row.content })
  }

  if (row.tool_calls) {
    try {
      const toolParts = JSON.parse(row.tool_calls) as UIMessage['parts']
      parts.push(...toolParts)
    } catch {
      // Ignore malformed tool_calls
    }
  }

  if (parts.length === 0) {
    parts.push({ type: 'text' as const, text: '' })
  }

  return {
    id: row.id,
    role: row.role as UIMessage['role'],
    parts,
  } as UIMessage
}

export async function createConversation(model?: string): Promise<string> {
  const id = generateId()
  await execute('INSERT INTO ai_conversations (id, title, model) VALUES ($1, $2, $3)', [
    id,
    'New Conversation',
    model || null,
  ])
  return id
}

export async function listConversations(): Promise<AIConversation[]> {
  return query<AIConversation>('SELECT * FROM ai_conversations ORDER BY updated_at DESC')
}

export async function deleteConversation(id: string): Promise<void> {
  await execute('DELETE FROM ai_conversations WHERE id = $1', [id])
}

export async function saveMessage(conversationId: string, message: UIMessage): Promise<void> {
  const textParts = message.parts
    .filter((p) => p.type === 'text')
    .map((p) => (p as { type: 'text'; text: string }).text)
  const content = textParts.join('\n') || ''

  const toolParts = message.parts.filter((p) => p.type.startsWith('tool-'))
  const toolCalls = toolParts.length > 0 ? JSON.stringify(toolParts) : null

  const id = message.id || generateId()
  await execute(
    `INSERT OR IGNORE INTO ai_messages (id, conversation_id, role, content, tool_calls)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, conversationId, message.role, content, toolCalls]
  )

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
  return rows.map(rowToMessage)
}

export async function loadMessagesWindow(
  conversationId: string,
  limit = DEFAULT_MESSAGE_WINDOW,
  offset = 0
): Promise<{ messages: UIMessage[]; hasMore: boolean }> {
  const countRows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = $1',
    [conversationId]
  )
  const rows = await query<AIMessage>(
    `SELECT * FROM ai_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [conversationId, limit, offset]
  )

  const total = countRows[0]?.count ?? 0
  const messages = rows.reverse().map(rowToMessage)
  const hasMore = offset + messages.length < total

  return { messages, hasMore }
}

export async function loadRecentMessages(
  conversationId: string,
  limit = DEFAULT_MESSAGE_WINDOW
): Promise<{ messages: UIMessage[]; hasMore: boolean; loadedCount: number }> {
  const countRows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = $1',
    [conversationId]
  )
  const total = countRows[0]?.count ?? 0
  const offset = Math.max(0, total - limit)
  const { messages, hasMore } = await loadMessagesWindow(conversationId, limit, offset)

  return {
    messages,
    hasMore,
    loadedCount: messages.length,
  }
}

export async function loadOlderMessages(
  conversationId: string,
  loadedCount: number,
  chunkSize = DEFAULT_MESSAGE_WINDOW
): Promise<{ messages: UIMessage[]; hasMore: boolean; loadedCount: number }> {
  const countRows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM ai_messages WHERE conversation_id = $1',
    [conversationId]
  )
  const total = countRows[0]?.count ?? 0

  if (loadedCount >= total) {
    return { messages: [], hasMore: false, loadedCount }
  }

  const remaining = total - loadedCount
  const take = Math.min(chunkSize, remaining)
  const offset = Math.max(0, total - loadedCount - take)
  const { messages } = await loadMessagesWindow(conversationId, take, offset)

  return {
    messages,
    hasMore: offset > 0,
    loadedCount: loadedCount + messages.length,
  }
}

export async function generateTitle(firstUserMessage: string): Promise<string> {
  const title = firstUserMessage.slice(0, 60)
  return title.length < firstUserMessage.length ? title + '...' : title
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  await execute(
    `UPDATE ai_conversations SET title = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
    [title, id]
  )
}

export async function updateConversationSummary(id: string, summary: string): Promise<void> {
  await execute(
    `UPDATE ai_conversations SET summary = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
    [summary, id]
  )
}

export async function getConversation(id: string): Promise<AIConversation | null> {
  const rows = await query<AIConversation>('SELECT * FROM ai_conversations WHERE id = $1', [id])
  return rows[0] || null
}
