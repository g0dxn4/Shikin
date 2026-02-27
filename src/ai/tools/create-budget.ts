import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import type { Category } from '@/types/database'

export const createBudget = tool({
  description:
    'Create a budget for a spending category. Use this when the user wants to set a spending limit for a category like food, transportation, etc.',
  inputSchema: zodSchema(
    z.object({
      categoryId: z
        .string()
        .optional()
        .describe('Category ID to budget. If not provided, use categoryName to find it.'),
      categoryName: z
        .string()
        .optional()
        .describe('Category name to match (e.g. "Food & Dining"). Used if categoryId not provided.'),
      amount: z
        .number()
        .positive()
        .describe('Budget amount in the main currency unit (e.g. 500 for $500)'),
      period: z
        .enum(['weekly', 'monthly', 'yearly'])
        .optional()
        .default('monthly')
        .describe('Budget period (default: monthly)'),
      name: z
        .string()
        .optional()
        .describe('Budget name. Defaults to the category name if not provided.'),
    })
  ),
  execute: async ({ categoryId, categoryName, amount, period, name }) => {
    let resolvedCategoryId = categoryId ?? null
    let resolvedName = name

    if (!resolvedCategoryId && categoryName) {
      const categories = await query<Category>(
        'SELECT id, name FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
        [`%${categoryName}%`]
      )
      if (categories.length > 0) {
        resolvedCategoryId = categories[0].id
        if (!resolvedName) resolvedName = categories[0].name + ' Budget'
      }
    }

    if (!resolvedName) resolvedName = 'Budget'

    const id = generateId()
    const amountCentavos = toCentavos(amount)

    await execute(
      `INSERT INTO budgets (id, category_id, name, amount, period, is_active)
       VALUES ($1, $2, $3, $4, $5, 1)`,
      [id, resolvedCategoryId, resolvedName, amountCentavos, period]
    )

    return {
      success: true,
      budget: {
        id,
        name: resolvedName,
        categoryId: resolvedCategoryId,
        amount,
        period,
      },
      message: `Created ${period} budget "${resolvedName}" for $${amount.toFixed(2)}.`,
    }
  },
})
