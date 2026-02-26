import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { execute, query } from '@/lib/database'
import type { AIMemory } from '@/types/database'

export const saveMemory = tool({
  description:
    'Save or update a memory about the user. Use this to remember preferences, facts, goals, behaviors, or context across conversations.',
  inputSchema: zodSchema(
    z.object({
      content: z.string().describe('The memory content to save'),
      category: z
        .enum(['preference', 'fact', 'goal', 'behavior', 'context'])
        .describe('Memory category: preference (user likes/dislikes), fact (personal info), goal (financial targets), behavior (spending patterns), context (situational info)'),
      importance: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe('Importance level 1-10 (10 = critical, 5 = normal). Higher importance memories are always loaded.'),
      existingMemoryId: z
        .string()
        .optional()
        .describe('If updating an existing memory, pass its ID here'),
    })
  ),
  execute: async ({ content, category, importance, existingMemoryId }) => {
    if (existingMemoryId) {
      const existing = await query<AIMemory>(
        'SELECT id FROM ai_memories WHERE id = $1',
        [existingMemoryId]
      )
      if (existing.length === 0) {
        return {
          success: false,
          message: `Memory with ID ${existingMemoryId} not found.`,
        }
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
        action: 'updated' as const,
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
      action: 'created' as const,
      message: `Saved new memory: "${content}"`,
    }
  },
})
