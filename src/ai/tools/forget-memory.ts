import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { query, execute } from '@/lib/database'
import type { AIMemory } from '@/types/database'

export const forgetMemory = tool({
  description:
    'Delete a specific memory. Use this when the user asks you to forget something or when a memory is no longer relevant.',
  inputSchema: zodSchema(
    z.object({
      memoryId: z.string().describe('The ID of the memory to delete'),
    })
  ),
  execute: async ({ memoryId }) => {
    const existing = await query<AIMemory>(
      'SELECT id, content FROM ai_memories WHERE id = $1',
      [memoryId]
    )

    if (existing.length === 0) {
      return {
        success: false,
        message: `Memory with ID ${memoryId} not found.`,
      }
    }

    await execute('DELETE FROM ai_memories WHERE id = $1', [memoryId])

    return {
      success: true,
      message: `Forgot memory: "${existing[0].content}"`,
    }
  },
})
