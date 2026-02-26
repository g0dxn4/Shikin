import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { query, execute } from '@/lib/database'

interface MemoryRow {
  id: string
  category: string
  content: string
  importance: number
}

export const recallMemories = tool({
  description:
    'Search and retrieve saved memories about the user. Use this to recall preferences, facts, goals, or other stored information.',
  inputSchema: zodSchema(
    z.object({
      search: z
        .string()
        .optional()
        .describe('Search term to filter memories by content (uses LIKE matching)'),
      category: z
        .enum(['preference', 'fact', 'goal', 'behavior', 'context'])
        .optional()
        .describe('Filter by memory category'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(20)
        .describe('Maximum number of memories to return (default 20)'),
    })
  ),
  execute: async ({ search, category, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (search) {
      paramIndex++
      conditions.push(`content LIKE $${paramIndex}`)
      params.push(`%${search}%`)
    }
    if (category) {
      paramIndex++
      conditions.push(`category = $${paramIndex}`)
      params.push(category)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    params.push(limit)

    const memories = await query<MemoryRow>(
      `SELECT id, category, content, importance
       FROM ai_memories
       ${whereClause}
       ORDER BY importance DESC, updated_at DESC
       LIMIT $${paramIndex}`,
      params
    )

    // Touch last_accessed_at for retrieved memories
    if (memories.length > 0) {
      const ids = memories.map((m) => m.id)
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
      await execute(
        `UPDATE ai_memories SET last_accessed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id IN (${placeholders})`,
        ids
      )
    }

    return {
      memories: memories.map((m) => ({
        id: m.id,
        category: m.category,
        content: m.content,
        importance: m.importance,
      })),
      count: memories.length,
      message:
        memories.length === 0
          ? 'No memories found.'
          : `Found ${memories.length} memory${memories.length !== 1 ? 'ies' : ''}.`,
    }
  },
})
