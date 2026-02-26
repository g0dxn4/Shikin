import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

import { query } from '@/lib/database'
import { listCategories } from '../tools/list-categories'

const mockQuery = vi.mocked(query)
const toolCtx = { toolCallId: 'test', messages: [] }

describe('listCategories tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns all categories ordered by sort_order', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'cat1', name: 'Food & Dining', type: 'expense', color: '#FF5722', sort_order: 1 },
      { id: 'cat2', name: 'Transportation', type: 'expense', color: '#2196F3', sort_order: 2 },
      { id: 'cat3', name: 'Salary', type: 'income', color: '#4CAF50', sort_order: 3 },
    ])

    const result = (await listCategories.execute!(
      {},
      toolCtx
    )) as { categories: Array<Record<string, unknown>>; message: string }

    expect(result.categories).toHaveLength(3)
    expect(result.categories[0].name).toBe('Food & Dining')
    expect(result.categories[2].name).toBe('Salary')
    expect(result.message).toContain('3 categories')
    // Verify ORDER BY sort_order
    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[0]).toContain('ORDER BY sort_order')
  })

  it('filters by type', async () => {
    mockQuery.mockResolvedValueOnce([
      { id: 'cat1', name: 'Food & Dining', type: 'expense', color: '#FF5722', sort_order: 1 },
    ])

    await listCategories.execute!({ type: 'expense' }, toolCtx)

    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[0]).toContain('WHERE type = $1')
    expect(queryCall[1]).toContain('expense')
  })

  it('handles empty result', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await listCategories.execute!(
      {},
      toolCtx
    )) as { categories: Array<Record<string, unknown>>; message: string }

    expect(result.categories).toHaveLength(0)
    expect(result.message).toContain('No categories found')
  })
})
