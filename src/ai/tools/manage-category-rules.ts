import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import {
  getAutoCategorizationRules,
  learnFromTransaction,
  deleteRule,
  suggestCategory,
} from '@/lib/auto-categorize'

export const manageCategoryRules = tool({
  description:
    'Manage auto-categorization rules. List learned rules, create new rules (e.g. "Spotify is Entertainment"), delete rules, or suggest a category for a description. Use this when the user wants to manage how transactions are automatically categorized.',
  inputSchema: zodSchema(
    z.object({
      action: z
        .enum(['list', 'create', 'delete', 'suggest'])
        .describe(
          'Action: list (show all rules), create (learn a new rule), delete (remove a rule), suggest (get category suggestion for a description)'
        ),
      pattern: z
        .string()
        .optional()
        .describe('For create/suggest: the merchant or description pattern (e.g. "spotify", "uber eats")'),
      categoryId: z
        .string()
        .optional()
        .describe('For create: the category ID to map the pattern to'),
      subcategoryId: z
        .string()
        .optional()
        .describe('For create: optional subcategory ID'),
      ruleId: z
        .string()
        .optional()
        .describe('For delete: the rule ID to remove'),
    })
  ),
  execute: async ({ action, pattern, categoryId, subcategoryId, ruleId }) => {
    switch (action) {
      case 'list': {
        const rules = await getAutoCategorizationRules()
        return {
          success: true,
          rules: rules.map((r) => ({
            id: r.id,
            pattern: r.pattern,
            category_name: r.category_name,
            category_id: r.category_id,
            hit_count: r.hit_count,
            confidence: r.confidence,
          })),
          count: rules.length,
          message:
            rules.length === 0
              ? 'No auto-categorization rules yet. Rules are learned automatically when transactions are created, or you can create them manually.'
              : `Found ${rules.length} auto-categorization rule(s).`,
        }
      }

      case 'create': {
        if (!pattern || !categoryId) {
          return {
            success: false,
            message: 'Both pattern and categoryId are required to create a rule.',
          }
        }
        await learnFromTransaction(pattern, categoryId, subcategoryId)
        return {
          success: true,
          message: `Learned rule: "${pattern}" will be categorized automatically. I'll remember this for future transactions.`,
        }
      }

      case 'delete': {
        if (!ruleId) {
          return {
            success: false,
            message: 'ruleId is required to delete a rule.',
          }
        }
        await deleteRule(ruleId)
        return {
          success: true,
          message: 'Rule deleted successfully.',
        }
      }

      case 'suggest': {
        if (!pattern) {
          return {
            success: false,
            message: 'pattern is required to suggest a category.',
          }
        }
        const suggestion = await suggestCategory(pattern)
        if (!suggestion) {
          return {
            success: true,
            suggestion: null,
            message: `No category suggestion found for "${pattern}". I haven't learned a pattern for this yet.`,
          }
        }
        return {
          success: true,
          suggestion,
          message: `Suggested category for "${pattern}" with ${Math.round(suggestion.confidence * 100)}% confidence.`,
        }
      }
    }
  },
})
