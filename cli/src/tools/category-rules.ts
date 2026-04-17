import { z, query, execute, generateId, type ToolDefinition } from './shared.js'

type CategoryRuleRow = {
  id: string
  pattern: string
  category_id: string | null
  subcategory_id: string | null
  confidence: number
  hit_count: number
  category_name: string | null
}

type CategoryRuleIdRow = {
  id: string
}

type CategorySuggestionRow = {
  category_id: string | null
  category_name: string | null
  confidence: number
}

const manageCategoryRules: ToolDefinition = {
  name: 'manage-category-rules',
  description:
    'Manage auto-categorization rules. List learned rules, create new rules, delete rules, or suggest a category for a description.',
  schema: z.object({
    action: z
      .enum(['list', 'create', 'delete', 'suggest'])
      .describe(
        'Action: list (show all rules), create (learn a new rule), delete (remove a rule), suggest (get category suggestion)'
      ),
    pattern: z
      .string()
      .optional()
      .describe('For create/suggest: the merchant or description pattern'),
    categoryId: z.string().optional().describe('For create: the category ID to map the pattern to'),
    subcategoryId: z.string().optional().describe('For create: optional subcategory ID'),
    ruleId: z.string().optional().describe('For delete: the rule ID to remove'),
  }),
  execute: async ({ action, pattern, categoryId, subcategoryId, ruleId }) => {
    switch (action) {
      case 'list': {
        const rules = await query<CategoryRuleRow>(
          `SELECT r.id, r.pattern, r.category_id, r.subcategory_id, r.confidence, r.hit_count,
                  c.name as category_name
           FROM category_rules r
           LEFT JOIN categories c ON r.category_id = c.id
           ORDER BY r.hit_count DESC`
        )
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
              ? 'No auto-categorization rules yet.'
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

        // Check for existing rule with same pattern
        const existing = await query<CategoryRuleIdRow>(
          'SELECT id FROM category_rules WHERE LOWER(pattern) = LOWER($1)',
          [pattern]
        )

        if (existing.length > 0) {
          await execute(
            `UPDATE category_rules
             SET category_id = $1, subcategory_id = $2, confidence = 1.0,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = $3`,
            [categoryId, subcategoryId ?? null, existing[0].id]
          )
        } else {
          const id = generateId()
          await execute(
            `INSERT INTO category_rules (id, pattern, category_id, subcategory_id, confidence, hit_count)
             VALUES ($1, $2, $3, $4, 1.0, 0)`,
            [id, pattern.toLowerCase(), categoryId, subcategoryId ?? null]
          )
        }

        return {
          success: true,
          message: `Learned rule: "${pattern}" will be categorized automatically.`,
        }
      }

      case 'delete': {
        if (!ruleId) {
          return { success: false, message: 'ruleId is required to delete a rule.' }
        }
        await execute('DELETE FROM category_rules WHERE id = $1', [ruleId])
        return { success: true, message: 'Rule deleted successfully.' }
      }

      case 'suggest': {
        if (!pattern) {
          return { success: false, message: 'pattern is required to suggest a category.' }
        }

        const rules = await query<CategorySuggestionRow>(
          `SELECT r.*, c.name as category_name
           FROM category_rules r
           LEFT JOIN categories c ON r.category_id = c.id
           WHERE LOWER($1) LIKE '%' || r.pattern || '%'
           ORDER BY r.confidence DESC, r.hit_count DESC
           LIMIT 1`,
          [pattern.toLowerCase()]
        )

        if (rules.length === 0) {
          return {
            success: true,
            suggestion: null,
            message: `No category suggestion found for "${pattern}".`,
          }
        }

        return {
          success: true,
          suggestion: {
            categoryId: rules[0].category_id,
            categoryName: rules[0].category_name,
            confidence: rules[0].confidence,
          },
          message: `Suggested category for "${pattern}" with ${Math.round(rules[0].confidence * 100)}% confidence.`,
        }
      }

      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  },
}

// ---------------------------------------------------------------------------
// 32. get-spending-anomalies
// ---------------------------------------------------------------------------

export const categoryRulesTools: ToolDefinition[] = [manageCategoryRules]
