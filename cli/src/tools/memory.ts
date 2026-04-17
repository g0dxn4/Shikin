import { z, query, execute, generateId, type ToolDefinition } from './shared.js'

const saveMemory: ToolDefinition = {
  name: 'save-memory',
  description:
    'Save or update a memory about the user. Use this to remember preferences, facts, goals, behaviors, or context across conversations.',
  schema: z.object({
    content: z.string().describe('The memory content to save'),
    category: z
      .enum(['preference', 'fact', 'goal', 'behavior', 'context'])
      .describe(
        'Memory category: preference (user likes/dislikes), fact (personal info), goal (financial targets), behavior (spending patterns), context (situational info)'
      ),
    importance: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(5)
      .describe('Importance level 1-10 (10 = critical, 5 = normal).'),
    existingMemoryId: z
      .string()
      .optional()
      .describe('If updating an existing memory, pass its ID here'),
  }),
  execute: async ({ content, category, importance, existingMemoryId }) => {
    if (existingMemoryId) {
      const existing = await query<{ id: string }>('SELECT id FROM ai_memories WHERE id = $1', [
        existingMemoryId,
      ])
      if (existing.length === 0) {
        return { success: false, message: `Memory with ID ${existingMemoryId} not found.` }
      }

      await execute(
        `UPDATE ai_memories SET content = $1, category = $2, importance = $3,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $4`,
        [content, category, importance, existingMemoryId]
      )

      return {
        success: true,
        memoryId: existingMemoryId,
        action: 'updated',
        message: `Updated memory: "${content}"`,
      }
    }

    const id = generateId()
    await execute(
      `INSERT INTO ai_memories (id, category, content, importance)
       VALUES ($1, $2, $3, $4)`,
      [id, category, content, importance]
    )

    return {
      success: true,
      memoryId: id,
      action: 'created',
      message: `Saved new memory: "${content}"`,
    }
  },
}

// ---------------------------------------------------------------------------
// 14. recall-memories
// ---------------------------------------------------------------------------

const recallMemories: ToolDefinition = {
  name: 'recall-memories',
  description:
    'Search and retrieve saved memories about the user. Use this to recall preferences, facts, goals, or other stored information.',
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe('Search term to filter memories by content (uses full-text search when available)'),
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
  }),
  execute: async ({ search, category, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0

    if (search) {
      // Try FTS first, fallback to LIKE
      let useFts: boolean
      try {
        const ftsCheck = await query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_memories_fts'"
        )
        useFts = ftsCheck.length > 0
      } catch {
        useFts = false
      }

      if (useFts) {
        paramIndex++
        conditions.push(
          `rowid IN (SELECT rowid FROM ai_memories_fts WHERE ai_memories_fts MATCH $${paramIndex})`
        )
        const safeSearch = search
          .replace(/['"]/g, '')
          .split(/\s+/)
          .filter(Boolean)
          .map((token: string) => `"${token}"`)
          .join(' ')
        params.push(safeSearch || `"${search}"`)
      } else {
        paramIndex++
        conditions.push(`content LIKE $${paramIndex}`)
        params.push(`%${search}%`)
      }
    }
    if (category) {
      paramIndex++
      conditions.push(`category = $${paramIndex}`)
      params.push(category)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    paramIndex++
    params.push(limit)

    const memories = await query<{
      id: string
      category: string
      content: string
      importance: number
    }>(
      `SELECT id, category, content, importance
       FROM ai_memories
       ${whereClause}
       ORDER BY importance DESC, updated_at DESC
       LIMIT $${paramIndex}`,
      params
    )

    // Touch last_accessed_at
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
          : `Found ${memories.length} memor${memories.length !== 1 ? 'ies' : 'y'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 15. forget-memory
// ---------------------------------------------------------------------------

const forgetMemory: ToolDefinition = {
  name: 'forget-memory',
  description:
    'Delete a specific memory. Use this when the user asks you to forget something or when a memory is no longer relevant.',
  schema: z.object({
    memoryId: z.string().describe('The ID of the memory to delete'),
  }),
  execute: async ({ memoryId }) => {
    const existing = await query<{ id: string; content: string }>(
      'SELECT id, content FROM ai_memories WHERE id = $1',
      [memoryId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Memory with ID ${memoryId} not found.` }
    }

    await execute('DELETE FROM ai_memories WHERE id = $1', [memoryId])

    return {
      success: true,
      message: `Forgot memory: "${existing[0].content}"`,
    }
  },
}

// ---------------------------------------------------------------------------
// 16. get-credit-card-status
// ---------------------------------------------------------------------------

export const memoryTools: ToolDefinition[] = [saveMemory, recallMemories, forgetMemory]
