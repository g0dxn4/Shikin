import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { CategoryRule } from '@/types/database'

export interface CategorySuggestion {
  category_id: string
  subcategory_id: string | null
  confidence: number
  rule_id?: string
}

/**
 * Normalize a description for matching: lowercase, trim, collapse whitespace.
 */
export function normalizePattern(description: string): string {
  return description.toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Suggest a category for the given description using learned rules and history.
 *
 * Algorithm:
 *  1. Exact match on category_rules.pattern
 *  2. Partial match (pattern contains description or description contains pattern)
 *  3. Historical: most common category from transactions with similar descriptions
 */
export async function suggestCategory(
  description: string
): Promise<CategorySuggestion | null> {
  const normalized = normalizePattern(description)
  if (!normalized) return null

  // 1. Exact match
  const exact = await query<CategoryRule>(
    `SELECT * FROM category_rules WHERE pattern = ? ORDER BY hit_count DESC LIMIT 1`,
    [normalized]
  )
  if (exact.length > 0) {
    return {
      category_id: exact[0].category_id,
      subcategory_id: exact[0].subcategory_id,
      confidence: 1.0,
      rule_id: exact[0].id,
    }
  }

  // 2. Partial match — description contains a known pattern, or pattern contains description
  const partial = await query<CategoryRule>(
    `SELECT * FROM category_rules
     WHERE ? LIKE '%' || pattern || '%' OR pattern LIKE '%' || ? || '%'
     ORDER BY hit_count DESC LIMIT 1`,
    [normalized, normalized]
  )
  if (partial.length > 0) {
    return {
      category_id: partial[0].category_id,
      subcategory_id: partial[0].subcategory_id,
      confidence: 0.8,
      rule_id: partial[0].id,
    }
  }

  // 3. Historical — most common category from transactions with similar descriptions
  const historical = await query<{ category_id: string; cnt: number }>(
    `SELECT category_id, COUNT(*) as cnt
     FROM transactions
     WHERE category_id IS NOT NULL
       AND (LOWER(description) LIKE '%' || ? || '%' OR ? LIKE '%' || LOWER(description) || '%')
     GROUP BY category_id
     ORDER BY cnt DESC
     LIMIT 1`,
    [normalized, normalized]
  )
  if (historical.length > 0) {
    return {
      category_id: historical[0].category_id,
      subcategory_id: null,
      confidence: 0.6,
    }
  }

  return null
}

/**
 * Learn (upsert) a categorization rule from a transaction.
 * If a rule for (pattern, category_id) exists, increment hit_count.
 * Otherwise create a new rule.
 */
export async function learnFromTransaction(
  description: string,
  categoryId: string,
  subcategoryId?: string | null
): Promise<void> {
  const pattern = normalizePattern(description)
  if (!pattern || !categoryId) return

  // Check for existing rule with same pattern + category
  const existing = await query<CategoryRule>(
    `SELECT * FROM category_rules WHERE pattern = ? AND category_id = ?`,
    [pattern, categoryId]
  )

  if (existing.length > 0) {
    // Upsert — increment hit_count
    await execute(
      `UPDATE category_rules
       SET hit_count = hit_count + 1,
           subcategory_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      [subcategoryId ?? null, existing[0].id]
    )
  } else {
    const id = generateId()
    await execute(
      `INSERT INTO category_rules (id, pattern, category_id, subcategory_id, confidence, hit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1.0, 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      [id, pattern, categoryId, subcategoryId ?? null]
    )
  }
}

/**
 * Get all auto-categorization rules, joined with category names.
 */
export async function getAutoCategorizationRules(): Promise<
  (CategoryRule & { category_name?: string; category_color?: string })[]
> {
  return query(
    `SELECT cr.*, c.name as category_name, c.color as category_color
     FROM category_rules cr
     LEFT JOIN categories c ON cr.category_id = c.id
     ORDER BY cr.hit_count DESC, cr.updated_at DESC`
  )
}

/**
 * Delete a categorization rule by ID.
 */
export async function deleteRule(id: string): Promise<void> {
  await execute('DELETE FROM category_rules WHERE id = ?', [id])
}
