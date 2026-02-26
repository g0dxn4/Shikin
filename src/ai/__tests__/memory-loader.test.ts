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
    mockQuery.mockResolvedValueOnce([])

    const result = await loadCoreMemories()
    expect(result).toBe('')
  })

  it('formats memories grouped by category', async () => {
    mockQuery.mockResolvedValueOnce([
      { category: 'preference', content: 'Prefers MXN' },
      { category: 'preference', content: 'Likes concise responses' },
      { category: 'goal', content: 'Saving $5000 by December' },
      { category: 'fact', content: 'Lives in Mexico' },
    ])

    const result = await loadCoreMemories()

    expect(result).toContain('## Your Memories About This User')
    expect(result).toContain('### User Preferences')
    expect(result).toContain('- Prefers MXN')
    expect(result).toContain('- Likes concise responses')
    expect(result).toContain('### Financial Goals')
    expect(result).toContain('- Saving $5000 by December')
    expect(result).toContain('### Known Facts')
    expect(result).toContain('- Lives in Mexico')
  })

  it('queries with correct ORDER BY and LIMIT', async () => {
    mockQuery.mockResolvedValueOnce([])

    await loadCoreMemories()

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY importance DESC, updated_at DESC')
    )
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT 50')
    )
  })
})
