import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { loadCoreMemories } from '../memory-loader'

const mockQuery = vi.mocked(query)

describe('loadCoreMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty string when no memories exist', async () => {
    mockQuery.mockResolvedValueOnce([]) // counts query

    const result = await loadCoreMemories()
    expect(result).toBe('')
  })

  it('returns memory index with counts and pinned items', async () => {
    // First call: category counts
    mockQuery.mockResolvedValueOnce([
      { category: 'preference', count: 3 },
      { category: 'goal', count: 2 },
      { category: 'fact', count: 1 },
    ])
    // Second call: pinned high-importance memories
    mockQuery.mockResolvedValueOnce([
      { category: 'preference', content: 'Prefers MXN', importance: 9 },
      { category: 'goal', content: 'Saving $5000 by December', importance: 8 },
    ])

    const result = await loadCoreMemories()

    expect(result).toContain('## Memory Index')
    expect(result).toContain('6 saved memories')
    expect(result).toContain('3 Preferences')
    expect(result).toContain('2 Goals')
    expect(result).toContain('1 Facts')
    expect(result).toContain('Use recallMemories to look up details')
    expect(result).toContain('### Pinned')
    expect(result).toContain('[Preferences] Prefers MXN')
    expect(result).toContain('[Goals] Saving $5000 by December')
  })

  it('shows index without pinned section when no high-importance memories', async () => {
    mockQuery.mockResolvedValueOnce([
      { category: 'context', count: 4 },
    ])
    mockQuery.mockResolvedValueOnce([]) // no pinned

    const result = await loadCoreMemories()

    expect(result).toContain('## Memory Index')
    expect(result).toContain('4 saved memories')
    expect(result).not.toContain('### Pinned')
  })

  it('fetches pinned memories with importance >= 7', async () => {
    mockQuery.mockResolvedValueOnce([{ category: 'fact', count: 1 }])
    mockQuery.mockResolvedValueOnce([])

    await loadCoreMemories()

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenLastCalledWith(
      expect.stringContaining('importance >= 7')
    )
  })
})
