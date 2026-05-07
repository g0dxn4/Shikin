import {
  z,
  query,
  execute,
  transaction,
  generateId,
  boundedText,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

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

type RuleSuggestionRow = {
  category_id: string | null
  category_name: string | null
  confidence: number
}

type ReviewSuggestionRow = {
  id: string
  transaction_id: string | null
  description: string
  suggested_category_id: string | null
  suggested_subcategory_id: string | null
  confidence: number
  status: 'pending' | 'approved' | 'rejected'
  source: string | null
  note: string | null
  created_at: string
  reviewed_at: string | null
  category_name?: string | null
  subcategory_name?: string | null
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

function reviewSuggestionSnapshot(suggestion: ReviewSuggestionRow) {
  return {
    id: suggestion.id,
    transactionId: suggestion.transaction_id,
    description: suggestion.description,
    suggestedCategoryId: suggestion.suggested_category_id,
    suggestedCategoryName: suggestion.category_name ?? null,
    suggestedSubcategoryId: suggestion.suggested_subcategory_id,
    suggestedSubcategoryName: suggestion.subcategory_name ?? null,
    confidence: suggestion.confidence,
    status: suggestion.status,
    source: suggestion.source,
    note: suggestion.note,
    createdAt: suggestion.created_at,
    reviewedAt: suggestion.reviewed_at,
  }
}

function getReviewSuggestion(id: string): ReviewSuggestionRow | null {
  return (
    query<ReviewSuggestionRow>(
      `SELECT s.*, c.name as category_name, sc.name as subcategory_name
       FROM category_suggestions s
       LEFT JOIN categories c ON s.suggested_category_id = c.id
       LEFT JOIN subcategories sc ON s.suggested_subcategory_id = sc.id
       WHERE s.id = $1
       LIMIT 1`,
      [id]
    )[0] ?? null
  )
}

function validateCategoryForSuggestion(categoryId: string) {
  const category = query<{ id: string; name: string }>(
    'SELECT id, name FROM categories WHERE id = $1 LIMIT 1',
    [categoryId]
  )[0]
  return category
    ? { success: true as const, category }
    : {
        success: false as const,
        reason: 'category_not_found',
        message: `Category ${categoryId} not found.`,
      }
}

function validateSubcategoryForSuggestion(subcategoryId: string, categoryId: string) {
  const subcategory = query<{ id: string; category_id: string; name: string }>(
    'SELECT id, category_id, name FROM subcategories WHERE id = $1 LIMIT 1',
    [subcategoryId]
  )[0]
  if (!subcategory) {
    return {
      success: false as const,
      reason: 'subcategory_not_found',
      message: `Subcategory ${subcategoryId} not found.`,
    }
  }
  if (subcategory.category_id !== categoryId) {
    return {
      success: false as const,
      reason: 'subcategory_category_mismatch',
      message: `Subcategory ${subcategoryId} belongs to category ${subcategory.category_id}, not ${categoryId}.`,
    }
  }
  return { success: true as const, subcategory }
}

function validateSuggestionTransaction(transactionId: string) {
  const transaction = query<{ id: string }>('SELECT id FROM transactions WHERE id = $1 LIMIT 1', [
    transactionId,
  ])[0]
  return transaction
    ? { success: true as const, transaction }
    : {
        success: false as const,
        reason: 'transaction_not_found',
        message: `Transaction ${transactionId} not found.`,
      }
}

function upsertCategoryRuleForSuggestion(input: {
  pattern: string
  categoryId: string
  subcategoryId: string | null
}) {
  const pattern = input.pattern.trim().toLowerCase()
  const existing = query<CategoryRuleIdRow>(
    'SELECT id FROM category_rules WHERE LOWER(pattern) = LOWER($1) ORDER BY id ASC LIMIT 1',
    [pattern]
  )[0]

  if (existing) {
    execute(
      `UPDATE category_rules
       SET category_id = $1, subcategory_id = $2, confidence = 1.0,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = $3`,
      [input.categoryId, input.subcategoryId, existing.id]
    )
    return { action: 'updated' as const, ruleId: existing.id, pattern }
  }

  const ruleId = generateId()
  execute(
    `INSERT INTO category_rules (id, pattern, category_id, subcategory_id, confidence, hit_count)
     VALUES ($1, $2, $3, $4, 1.0, 0)`,
    [ruleId, pattern, input.categoryId, input.subcategoryId]
  )
  return { action: 'created' as const, ruleId, pattern }
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

        const rules = await query<RuleSuggestionRow>(
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

const suggestCategory: ToolDefinition = {
  name: 'suggest-category',
  description:
    'Suggest a category for a transaction description using the existing auto-categorization rules, optionally enqueueing the suggestion for review.',
  schema: z.object({
    description: boundedText(
      'Description',
      'Transaction description or merchant text to categorize',
      200
    ),
    enqueue: z
      .boolean()
      .optional()
      .default(false)
      .describe('Store the suggestion in the review queue'),
    transactionId: boundedText(
      'Transaction ID',
      'Optional transaction ID for queued review',
      128
    ).optional(),
    categoryId: boundedText(
      'Category ID',
      'Optional category ID to enqueue instead of the rule suggestion',
      128
    ).optional(),
    subcategoryId: boundedText(
      'Subcategory ID',
      'Optional subcategory ID to enqueue',
      128
    ).optional(),
    confidence: z.number().min(0).max(1).optional().describe('Confidence score for queued review'),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview queue writes'),
  }),
  execute: async ({
    description,
    enqueue,
    transactionId,
    categoryId,
    subcategoryId,
    confidence,
    source,
    note,
    dryRun,
  }) => {
    const directResult = await manageCategoryRules.execute({
      action: 'suggest',
      pattern: description,
    })
    if (!enqueue) return directResult

    const directSuggestion =
      directResult &&
      typeof directResult === 'object' &&
      'suggestion' in directResult &&
      directResult.suggestion &&
      typeof directResult.suggestion === 'object'
        ? (directResult.suggestion as {
            categoryId?: string | null
            categoryName?: string | null
            confidence?: number
          })
        : null
    const suggestedCategoryId = categoryId ?? directSuggestion?.categoryId ?? null
    if (!suggestedCategoryId) {
      return {
        success: false,
        reason: 'suggestion_not_available',
        message: `No category suggestion found for "${description}". Provide categoryId to enqueue a manual suggestion.`,
      }
    }

    const category = validateCategoryForSuggestion(suggestedCategoryId)
    if (!category.success) return category
    if (subcategoryId) {
      const subcategory = validateSubcategoryForSuggestion(subcategoryId, suggestedCategoryId)
      if (!subcategory.success) return subcategory
    }
    if (transactionId) {
      const transaction = validateSuggestionTransaction(transactionId)
      if (!transaction.success) return transaction
    }

    const now = new Date().toISOString()
    const queued: ReviewSuggestionRow = {
      id: generateId(),
      transaction_id: transactionId ?? null,
      description,
      suggested_category_id: suggestedCategoryId,
      suggested_subcategory_id: subcategoryId ?? null,
      confidence: confidence ?? directSuggestion?.confidence ?? 0,
      status: 'pending',
      source: source ?? null,
      note: note ?? null,
      created_at: now,
      reviewed_at: null,
      category_name: category.category.name,
      subcategory_name: null,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'enqueued' as const,
        dryRun: true,
        directSuggestion,
        wouldEnqueue: reviewSuggestionSnapshot(queued),
        message: `Dry run: category suggestion for "${description}" would be queued for review.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO category_suggestions
           (id, transaction_id, description, suggested_category_id, suggested_subcategory_id, confidence, status, source, note, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, $9)`,
        [
          queued.id,
          queued.transaction_id,
          queued.description,
          queued.suggested_category_id,
          queued.suggested_subcategory_id,
          queued.confidence,
          queued.source,
          queued.note,
          queued.created_at,
        ]
      )
      writeAuditLog({
        entity: 'category_suggestion',
        entityId: queued.id,
        action: 'enqueue',
        before: null,
        after: { suggestion: reviewSuggestionSnapshot(queued) },
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'enqueued' as const,
      suggestion: reviewSuggestionSnapshot(queued),
      directSuggestion,
      message: `Queued category suggestion for "${description}" for review.`,
    }
  },
}

const reviewSuggestions: ToolDefinition = {
  name: 'review-suggestions',
  description: 'List queued category suggestions for review.',
  schema: z.object({
    status: z.enum(['pending', 'approved', 'rejected', 'all']).optional().default('pending'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  execute: async ({ status, limit }) => {
    const params: unknown[] = []
    const where = status === 'all' ? '' : 'WHERE s.status = $1'
    if (status !== 'all') params.push(status)
    params.push(limit)

    const suggestions = query<ReviewSuggestionRow>(
      `SELECT s.*, c.name as category_name, sc.name as subcategory_name
       FROM category_suggestions s
       LEFT JOIN categories c ON s.suggested_category_id = c.id
       LEFT JOIN subcategories sc ON s.suggested_subcategory_id = sc.id
       ${where}
       ORDER BY s.created_at ASC, s.id ASC
       LIMIT $${params.length}`,
      params
    )

    return {
      success: true,
      suggestions: suggestions.map(reviewSuggestionSnapshot),
      count: suggestions.length,
      status,
      message:
        suggestions.length === 0
          ? `No ${status === 'all' ? '' : `${status} `}category suggestions found.`
          : `Found ${suggestions.length} category suggestion(s).`,
    }
  },
}

const approveSuggestion: ToolDefinition = {
  name: 'approve-suggestion',
  description:
    'Approve a queued category suggestion and optionally create or update a category rule for the approved pattern.',
  schema: z.object({
    id: boundedText('Suggestion ID', 'Category suggestion ID to approve', 128),
    categoryId: boundedText(
      'Category ID',
      'Optional category override for approval',
      128
    ).optional(),
    subcategoryId: boundedText(
      'Subcategory ID',
      'Optional subcategory override for approval',
      128
    ).optional(),
    createRule: z
      .boolean()
      .optional()
      .default(false)
      .describe('Create or update a category rule from the approved suggestion'),
    rulePattern: boundedText(
      'Rule pattern',
      'Optional rule pattern. Defaults to the suggestion description',
      200
    ).optional(),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview approval without writing'),
  }),
  execute: async ({
    id,
    categoryId,
    subcategoryId,
    createRule,
    rulePattern,
    source,
    note,
    dryRun,
  }) => {
    const existing = getReviewSuggestion(id)
    if (!existing) {
      return {
        success: false,
        reason: 'suggestion_not_found',
        message: `Suggestion ${id} not found.`,
      }
    }
    if (existing.status !== 'pending') {
      return {
        success: false,
        reason: 'suggestion_already_reviewed',
        message: `Suggestion ${id} is already ${existing.status}.`,
      }
    }

    const approvedCategoryId = categoryId ?? existing.suggested_category_id
    if (!approvedCategoryId) {
      return {
        success: false,
        reason: 'suggestion_missing_category',
        message: `Suggestion ${id} has no category. Provide categoryId to approve it.`,
      }
    }
    const category = validateCategoryForSuggestion(approvedCategoryId)
    if (!category.success) return category
    const approvedSubcategoryId =
      categoryId && subcategoryId === undefined
        ? null
        : (subcategoryId ?? existing.suggested_subcategory_id)
    if (approvedSubcategoryId) {
      const subcategory = validateSubcategoryForSuggestion(
        approvedSubcategoryId,
        approvedCategoryId
      )
      if (!subcategory.success) return subcategory
    }

    const reviewedAt = new Date().toISOString()
    const approved: ReviewSuggestionRow = {
      ...existing,
      suggested_category_id: approvedCategoryId,
      suggested_subcategory_id: approvedSubcategoryId,
      status: 'approved',
      source: source ?? existing.source,
      note: note ?? existing.note,
      reviewed_at: reviewedAt,
      category_name: category.category.name,
    }
    const rulePreview = createRule
      ? {
          pattern: (rulePattern ?? existing.description).trim().toLowerCase(),
          categoryId: approved.suggested_category_id,
          subcategoryId: approved.suggested_subcategory_id,
        }
      : null

    if (dryRun) {
      return {
        success: true,
        action: 'approved' as const,
        dryRun: true,
        wouldApprove: {
          before: reviewSuggestionSnapshot(existing),
          after: reviewSuggestionSnapshot(approved),
          rule: rulePreview,
        },
        message: `Dry run: suggestion ${id} would be approved.`,
      }
    }

    let ruleResult: { action: 'created' | 'updated'; ruleId: string; pattern: string } | null = null
    transaction(() => {
      const updateResult = execute(
        `UPDATE category_suggestions
         SET suggested_category_id = $1, suggested_subcategory_id = $2, status = 'approved',
             source = $3, note = $4, reviewed_at = $5
         WHERE id = $6 AND status = 'pending'`,
        [
          approved.suggested_category_id,
          approved.suggested_subcategory_id,
          approved.source,
          approved.note,
          reviewedAt,
          id,
        ]
      )
      assertSingleRowUpdated(
        updateResult,
        `Category suggestion ${id} could not be approved because it was already reviewed.`
      )
      if (createRule) {
        ruleResult = upsertCategoryRuleForSuggestion({
          pattern: rulePattern ?? existing.description,
          categoryId: approved.suggested_category_id!,
          subcategoryId: approved.suggested_subcategory_id,
        })
      }
      writeAuditLog({
        entity: 'category_suggestion',
        entityId: id,
        action: 'approve',
        before: { suggestion: reviewSuggestionSnapshot(existing) },
        after: { suggestion: reviewSuggestionSnapshot(approved), rule: ruleResult },
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'approved' as const,
      suggestion: reviewSuggestionSnapshot(approved),
      rule: ruleResult,
      message: `Approved category suggestion ${id}.`,
    }
  },
}

const rejectSuggestion: ToolDefinition = {
  name: 'reject-suggestion',
  description: 'Reject a queued category suggestion with optional source and note metadata.',
  schema: z.object({
    id: boundedText('Suggestion ID', 'Category suggestion ID to reject', 128),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional rejection note'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview rejection without writing'),
  }),
  execute: async ({ id, source, note, dryRun }) => {
    const existing = getReviewSuggestion(id)
    if (!existing) {
      return {
        success: false,
        reason: 'suggestion_not_found',
        message: `Suggestion ${id} not found.`,
      }
    }
    if (existing.status !== 'pending') {
      return {
        success: false,
        reason: 'suggestion_already_reviewed',
        message: `Suggestion ${id} is already ${existing.status}.`,
      }
    }

    const rejected: ReviewSuggestionRow = {
      ...existing,
      status: 'rejected',
      source: source ?? existing.source,
      note: note ?? existing.note,
      reviewed_at: new Date().toISOString(),
    }

    if (dryRun) {
      return {
        success: true,
        action: 'rejected' as const,
        dryRun: true,
        wouldReject: {
          before: reviewSuggestionSnapshot(existing),
          after: reviewSuggestionSnapshot(rejected),
        },
        message: `Dry run: suggestion ${id} would be rejected.`,
      }
    }

    transaction(() => {
      const updateResult = execute(
        `UPDATE category_suggestions
         SET status = 'rejected', source = $1, note = $2, reviewed_at = $3
         WHERE id = $4 AND status = 'pending'`,
        [rejected.source, rejected.note, rejected.reviewed_at, id]
      )
      assertSingleRowUpdated(
        updateResult,
        `Category suggestion ${id} could not be rejected because it was already reviewed.`
      )
      writeAuditLog({
        entity: 'category_suggestion',
        entityId: id,
        action: 'reject',
        before: { suggestion: reviewSuggestionSnapshot(existing) },
        after: { suggestion: reviewSuggestionSnapshot(rejected) },
        source,
        note,
      })
    })

    return {
      success: true,
      action: 'rejected' as const,
      suggestion: reviewSuggestionSnapshot(rejected),
      message: `Rejected category suggestion ${id}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 32. get-spending-anomalies
// ---------------------------------------------------------------------------

export const categoryRulesTools: ToolDefinition[] = [
  manageCategoryRules,
  suggestCategory,
  reviewSuggestions,
  approveSuggestion,
  rejectSuggestion,
]
