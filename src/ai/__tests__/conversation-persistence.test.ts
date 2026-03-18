import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01CONV00000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import {
  createConversation,
  listConversations,
  deleteConversation,
  saveMessage,
  loadMessages,
  generateTitle,
} from '../conversation-persistence'
import type { UIMessage } from 'ai'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a conversation and returns id', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const id = await createConversation('gpt-4o')
    expect(id).toBe('01CONV00000000000000000000')
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_conversations'),
      ['01CONV00000000000000000000', 'New Conversation', 'gpt-4o']
    )
  })

  it('creates a conversation without model', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    await createConversation()
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_conversations'),
      ['01CONV00000000000000000000', 'New Conversation', null]
    )
  })
})

describe('listConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns conversations ordered by updated_at', async () => {
    const convos = [
      { id: '1', title: 'Chat 1', model: null, summary: null, created_at: '', updated_at: '' },
      { id: '2', title: 'Chat 2', model: null, summary: null, created_at: '', updated_at: '' },
    ]
    mockQuery.mockResolvedValueOnce(convos)

    const result = await listConversations()
    expect(result).toEqual(convos)
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('ORDER BY updated_at DESC'))
  })
})

describe('deleteConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a conversation by id', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    await deleteConversation('conv-1')
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM ai_conversations WHERE id = $1', [
      'conv-1',
    ])
  })
})

describe('saveMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('saves a text message', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const message: UIMessage = {
      id: 'msg-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello Val' }],
    }

    await saveMessage('conv-1', message)
    expect(mockExecute).toHaveBeenCalledTimes(2) // insert + update timestamp
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR IGNORE INTO ai_messages'),
      expect.arrayContaining(['msg-1', 'conv-1', 'user', 'Hello Val', null])
    )
  })

  it('serializes tool parts as JSON', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    // Construct a message with tool parts using `as any` since
    // tool part types are generic and depend on registered tools
    const message = {
      id: 'msg-2',
      role: 'assistant' as const,
      parts: [
        { type: 'text', text: 'Let me check...' },
        { type: 'tool-test', toolCallId: 'tc1', state: 'result', result: {} },
      ],
    } as UIMessage

    await saveMessage('conv-1', message)
    const insertCall = mockExecute.mock.calls[0]
    const toolCalls = insertCall[1]![4] as string
    expect(toolCalls).not.toBeNull()
    expect(JSON.parse(toolCalls)).toHaveLength(1)
  })
})

describe('loadMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reconstructs UIMessages from rows', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'Hello Val',
        tool_calls: null,
        tool_result: null,
        created_at: '2024-01-15T10:00:00.000Z',
      },
      {
        id: 'msg-2',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: 'Hi there!',
        tool_calls: null,
        tool_result: null,
        created_at: '2024-01-15T10:00:01.000Z',
      },
    ])

    const messages = await loadMessages('conv-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: 'Hello Val' })
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].parts[0]).toMatchObject({ type: 'text', text: 'Hi there!' })
  })

  it('handles empty content with fallback', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'msg-1',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: '',
        tool_calls: null,
        tool_result: null,
        created_at: '2024-01-15T10:00:00.000Z',
      },
    ])

    const messages = await loadMessages('conv-1')
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0]).toMatchObject({ type: 'text', text: '' })
  })
})

describe('generateTitle', () => {
  it('truncates long messages to 60 chars', async () => {
    const longMessage =
      'This is a really long message that should be truncated because it exceeds sixty characters in length'
    const title = await generateTitle(longMessage)
    expect(title.length).toBeLessThanOrEqual(64) // 60 + "..."
    expect(title).toContain('...')
  })

  it('keeps short messages as-is', async () => {
    const shortMessage = 'Check my balance'
    const title = await generateTitle(shortMessage)
    expect(title).toBe('Check my balance')
  })
})
