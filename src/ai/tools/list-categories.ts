import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { query } from '@/lib/database'
import type { Category } from '@/types/database'

export const listCategories = tool({
  description:
    'List available transaction categories. Use this when the user asks about categories or needs to pick one.',
  inputSchema: zodSchema(
    z.object({
      type: z
        .enum(['expense', 'income', 'transfer'])
        .optional()
        .describe('Filter by category type'),
    })
  ),
  execute: async ({ type }) => {
    const params: unknown[] = []
    let sql = 'SELECT * FROM categories'

    if (type) {
      sql += ' WHERE type = $1'
      params.push(type)
    }

    sql += ' ORDER BY sort_order'

    const categories = await query<Category>(sql, params)

    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        color: c.color,
      })),
      message:
        categories.length === 0
          ? 'No categories found.'
          : `Found ${categories.length} categor${categories.length !== 1 ? 'ies' : 'y'}.`,
    }
  },
})
