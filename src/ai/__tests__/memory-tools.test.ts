import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01MEMORY0000000000000000000'),
}))

import { query, execute } from '@/lib/database'
import { saveMemory } from '../tools/save-memory'
import { recallMemories } from '../tools/recall-memories'
import { resetFtsCache } from '../tools/recall-memories'
import { forgetMemory } from '../tools/forget-memory'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)

describe('saveMemory tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct description', () => {
    expect(saveMemory.description).toContain('memory')
  })

  it('creates a new memory', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await saveMemory.execute!(
      {
        content: 'User prefers MXN',
        category: 'preference',
        importance: 8,
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: true,
      memoryId: '01MEMORY0000000000000000000',
      action: 'created',
    })
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO ai_memories'),
      expect.arrayContaining(['01MEMORY0000000000000000000', 'preference', 'User prefers MXN', 8])
    )
  })

  it('creates a memory with default importance', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await saveMemory.execute!(
      {
        content: 'Some fact',
        category: 'fact',
        importance: 5,
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: true,
      action: 'created',
    })
  })

  it('updates an existing memory', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'existing-id' }])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await saveMemory.execute!(
      {
        content: 'Updated preference',
        category: 'preference',
        importance: 9,
        existingMemoryId: 'existing-id',
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: true,
      memoryId: 'existing-id',
      action: 'updated',
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ai_memories'),
      expect.arrayContaining(['Updated preference', 'preference', 9, 'existing-id'])
    )
  })

  it('returns error when updating non-existent memory', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await saveMemory.execute!(
      {
        content: 'Updated preference',
        category: 'preference',
        importance: 5,
        existingMemoryId: 'nonexistent-id',
      },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('not found'),
    })
  })
})

describe('recallMemories tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetFtsCache()
  })

  it('has correct description', () => {
    expect(recallMemories.description).toContain('memories')
  })

  it('retrieves all memories with no filters', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'mem1', category: 'preference', content: 'Prefers MXN', importance: 8 },
      { id: 'mem2', category: 'goal', content: 'Save 5000', importance: 7 },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 2, lastInsertId: 0 })

    const result = (await recallMemories.execute!(
      { limit: 20 },
      { toolCallId: 'test', messages: [] }
    )) as { memories: Array<Record<string, unknown>>; count: number }

    expect(result.count).toBe(2)
    expect(result.memories).toHaveLength(2)
    expect(result.memories[0]).toMatchObject({
      id: 'mem1',
      category: 'preference',
      content: 'Prefers MXN',
    })
    // Should touch last_accessed_at
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE ai_memories'),
      expect.arrayContaining(['mem1', 'mem2'])
    )
  })

  it('filters by category', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'mem1', category: 'preference', content: 'Prefers MXN', importance: 8 },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await recallMemories.execute!(
      { category: 'preference', limit: 20 },
      { toolCallId: 'test', messages: [] }
    )) as { memories: Array<Record<string, unknown>>; count: number }

    expect(result.count).toBe(1)
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('category = $1'),
      expect.arrayContaining(['preference'])
    )
  })

  it('filters by search term (LIKE fallback when FTS unavailable)', async () => {
    // First call: FTS availability check — return empty (no FTS table)
    mockQuery.mockResolvedValueOnce([])
    // Second call: the actual memory query
    mockQuery.mockResolvedValueOnce([
      { id: 'mem1', category: 'preference', content: 'Prefers MXN', importance: 8 },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await recallMemories.execute!(
      { search: 'MXN', limit: 20 },
      { toolCallId: 'test', messages: [] }
    )) as { count: number }

    expect(result.count).toBe(1)
    // Second query call should use LIKE fallback
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('content LIKE'),
      expect.arrayContaining(['%MXN%'])
    )
  })

  it('filters by search term (FTS5 when available)', async () => {
    resetFtsCache()
    // First call: FTS availability check — return a match (FTS table exists)
    mockQuery.mockResolvedValueOnce([{ name: 'ai_memories_fts' }])
    // Second call: the actual memory query
    mockQuery.mockResolvedValueOnce([
      { id: 'mem1', category: 'preference', content: 'Prefers MXN', importance: 8 },
    ])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await recallMemories.execute!(
      { search: 'MXN', limit: 20 },
      { toolCallId: 'test', messages: [] }
    )) as { count: number }

    expect(result.count).toBe(1)
    // Second query call should use FTS5
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ai_memories_fts MATCH'),
      expect.arrayContaining(['"MXN"'])
    )
  })

  it('returns empty result when no memories found', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await recallMemories.execute!(
      { limit: 20 },
      { toolCallId: 'test', messages: [] }
    )) as { memories: unknown[]; count: number; message: string }

    expect(result.count).toBe(0)
    expect(result.memories).toHaveLength(0)
    expect(result.message).toContain('No memories found')
    // Should not touch last_accessed_at when no results
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('forgetMemory tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct description', () => {
    expect(forgetMemory.description).toContain('memory')
  })

  it('deletes an existing memory', async () => {
    mockQuery.mockResolvedValueOnce([{ id: 'mem1', content: 'Prefers MXN' }])
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await forgetMemory.execute!(
      { memoryId: 'mem1' },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: true,
      message: expect.stringContaining('Prefers MXN'),
    })
    expect(mockExecute).toHaveBeenCalledWith(
      'DELETE FROM ai_memories WHERE id = $1',
      ['mem1']
    )
  })

  it('returns error when memory not found', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await forgetMemory.execute!(
      { memoryId: 'nonexistent' },
      { toolCallId: 'test', messages: [] }
    )) as Record<string, unknown>

    expect(result).toMatchObject({
      success: false,
      message: expect.stringContaining('not found'),
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
