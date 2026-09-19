import { query } from '@/lib/database'
import type { TransactionWithDetails } from '@/stores/transaction-store'

export const TRANSACTION_PAGE_SIZES = [25, 50, 100] as const

export type TransactionPageSize = (typeof TRANSACTION_PAGE_SIZES)[number]
export type TransactionQueryType = 'all' | 'expense' | 'income' | 'transfer'
export type TransactionQueryStatus = 'all' | 'posted' | 'pending' | 'cleared'
export type TransactionReviewReason =
  | 'all'
  | 'needs-category'
  | 'pending'
  | 'placeholder'
  | 'staged'
  | 'unclassified'
export type TransactionSort =
  | 'date'
  | 'description'
  | 'amount'
  | 'account'
  | 'category'
  | 'type'
  | 'status'
  | 'source'
export type TransactionSortDirection = 'asc' | 'desc'

export interface TransactionPageRequest {
  search?: string
  type?: TransactionQueryType
  account?: string
  category?: string
  dateFrom?: string
  dateTo?: string
  status?: TransactionQueryStatus
  currency?: string
  reviewReason?: TransactionReviewReason
  sort?: TransactionSort
  direction?: TransactionSortDirection
  page?: number
  pageSize?: TransactionPageSize
}

export interface TransactionReviewCounts {
  all: number
  'needs-category': number
  pending: number
  placeholder: number
  staged: number
  unclassified: number
}

export interface TransactionPageRow extends TransactionWithDetails {
  has_splits: number
  is_consumption_unclassified?: number
}

export interface TransactionPageResult {
  rows: TransactionPageRow[]
  total: number
  currencies: string[]
  reviewCounts: TransactionReviewCounts
}

type CountRow = { total: number }
type CurrencyRow = { currency: string }
type ReviewCountRow = {
  all_count: number | null
  needs_category_count: number | null
  pending_count: number | null
  placeholder_count: number | null
  staged_count: number | null
  unclassified_count: number | null
}

const NORMALIZED_STATUS_SQL = "COALESCE(NULLIF(TRIM(t.status), ''), 'posted')"
const HAS_SPLITS_SQL =
  'EXISTS(SELECT 1 FROM transaction_splits split_check WHERE split_check.transaction_id = t.id)'
const NEEDS_CATEGORY_SQL = `(t.type IN ('expense', 'income') AND t.category_id IS NULL AND NOT ${HAS_SPLITS_SQL})`
const PENDING_SQL = `${NORMALIZED_STATUS_SQL} = 'pending'`
const PLACEHOLDER_SQL = `(COALESCE(t.is_placeholder, 0) = 1 AND COALESCE(t.placeholder_status, 'unresolved') = 'unresolved')`
const STAGED_SQL = `COALESCE(t.ledger_treatment, 'normal') = 'staged_no_balance_impact'`
const CONSUMPTION_ELIGIBLE_SQL = `(t.type IN ('expense', 'income')
  AND ${NORMALIZED_STATUS_SQL} IN ('posted', 'cleared')
  AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
  AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
  AND COALESCE(t.transaction_kind, 'standard') = 'standard'
  AND COALESCE(t.is_archived, 0) = 0
  AND t.matched_transaction_id IS NULL
  AND COALESCE(t.is_placeholder, 0) = 0
  AND NOT EXISTS(SELECT 1 FROM receivables consumption_receivable WHERE consumption_receivable.matched_transaction_id = t.id)
  AND NOT EXISTS(SELECT 1 FROM account_reconciliations consumption_reconciliation WHERE consumption_reconciliation.adjustment_transaction_id = t.id))`
const UNCLASSIFIED_SQL = `(${CONSUMPTION_ELIGIBLE_SQL} AND (
  (${HAS_SPLITS_SQL} AND EXISTS(
    SELECT 1 FROM transaction_splits consumption_split
    WHERE consumption_split.transaction_id = t.id
      AND NOT EXISTS(
        SELECT 1 FROM transaction_consumption_classifications consumption_classification
        WHERE consumption_classification.transaction_id = t.id
          AND consumption_classification.split_id = consumption_split.id
      )
  ))
  OR (NOT ${HAS_SPLITS_SQL} AND NOT EXISTS(
    SELECT 1 FROM transaction_consumption_classifications consumption_classification
    WHERE consumption_classification.transaction_id = t.id
      AND consumption_classification.split_id IS NULL
  ))
))`
const NEEDS_REVIEW_SQL = `(${NEEDS_CATEGORY_SQL} OR ${PENDING_SQL} OR ${PLACEHOLDER_SQL} OR ${STAGED_SQL} OR ${UNCLASSIFIED_SQL})`

const SORT_SQL: Record<TransactionSort, string> = {
  date: 't.date',
  description: 'LOWER(t.description)',
  amount: 't.amount',
  account: "LOWER(COALESCE(a.name, ''))",
  category: "LOWER(COALESCE(c.name, ''))",
  type: 't.type',
  status: NORMALIZED_STATUS_SQL,
  source: "LOWER(COALESCE(t.source, t.import_source, 'manual'))",
}

function normalizePageSize(value: number | undefined): TransactionPageSize {
  return TRANSACTION_PAGE_SIZES.includes(value as TransactionPageSize)
    ? (value as TransactionPageSize)
    : 50
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback
}

/** Escape a user value for a literal SQLite LIKE substring using `\\` as ESCAPE. */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

function reviewReasonSql(reason: TransactionReviewReason | undefined): string | null {
  switch (reason) {
    case 'all':
      return NEEDS_REVIEW_SQL
    case 'needs-category':
      return NEEDS_CATEGORY_SQL
    case 'pending':
      return PENDING_SQL
    case 'placeholder':
      return PLACEHOLDER_SQL
    case 'staged':
      return STAGED_SQL
    case 'unclassified':
      return UNCLASSIFIED_SQL
    default:
      return null
  }
}

function buildBaseWhere(request: TransactionPageRequest): { sql: string; params: unknown[] } {
  const clauses = ['COALESCE(t.is_archived, 0) = 0']
  const params: unknown[] = []
  const search = request.search?.trim()

  if (search) {
    const literal = `%${escapeLikeLiteral(search.toLocaleLowerCase())}%`
    clauses.push(`(
      LOWER(t.description) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(t.notes, t.note, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(a.name, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(ta.name, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(c.name, '')) LIKE ? ESCAPE '\\'
      OR LOWER(COALESCE(t.source, t.import_source, 'manual')) LIKE ? ESCAPE '\\'
      OR EXISTS(
        SELECT 1
        FROM transaction_splits search_split
        JOIN categories search_category ON search_category.id = search_split.category_id
        WHERE search_split.transaction_id = t.id
          AND LOWER(search_category.name) LIKE ? ESCAPE '\\'
      )
    )`)
    params.push(literal, literal, literal, literal, literal, literal, literal)
  }

  if (request.type && request.type !== 'all') {
    clauses.push('t.type = ?')
    params.push(request.type)
  }
  if (request.account && request.account !== 'all') {
    clauses.push('(t.account_id = ? OR t.transfer_to_account_id = ?)')
    params.push(request.account, request.account)
  }
  if (request.category && request.category !== 'all') {
    clauses.push(`(
      (${HAS_SPLITS_SQL} AND EXISTS(
        SELECT 1 FROM transaction_splits category_split
        WHERE category_split.transaction_id = t.id AND category_split.category_id = ?
      ))
      OR (NOT ${HAS_SPLITS_SQL} AND t.category_id = ?)
    )`)
    params.push(request.category, request.category)
  }
  if (request.dateFrom) {
    clauses.push('t.date >= ?')
    params.push(request.dateFrom)
  }
  if (request.dateTo) {
    clauses.push('t.date <= ?')
    params.push(request.dateTo)
  }
  if (request.status && request.status !== 'all') {
    clauses.push(`${NORMALIZED_STATUS_SQL} = ?`)
    params.push(request.status)
  }
  if (request.currency && request.currency !== 'all') {
    clauses.push('t.currency = ?')
    params.push(request.currency)
  }

  return { sql: clauses.join('\n AND '), params }
}

const JOINED_TRANSACTION_SELECT = `
  SELECT t.*,
         ${NORMALIZED_STATUS_SQL} AS status,
         a.name AS account_name,
         c.name AS category_name,
         c.color AS category_color,
         ta.name AS transfer_to_account_name,
         ${HAS_SPLITS_SQL} AS has_splits,
         ${UNCLASSIFIED_SQL} AS is_consumption_unclassified,
         EXISTS(SELECT 1 FROM receivables r WHERE r.matched_transaction_id = t.id) AS is_receivable_payment,
         EXISTS(SELECT 1 FROM account_reconciliations ar WHERE ar.adjustment_transaction_id = t.id) AS is_reconciliation_adjustment,
         (t.finalization_id IS NOT NULL OR EXISTS(
           SELECT 1 FROM account_reconciliations ar
           WHERE ar.account_id = t.account_id AND ar.staging_batch_id = t.staging_batch_id AND ar.selection_mode = 'legacy_batch' AND COALESCE(t.ledger_treatment, 'normal') = 'normal' AND COALESCE(t.status, 'posted') != 'pending'
         )) AS is_finalized_statement
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN accounts ta ON ta.id = t.transfer_to_account_id`

/** Read one current transaction without relying on the global transaction cache. */
export async function getTransactionById(id: string): Promise<TransactionPageRow | null> {
  const rows = await query<TransactionPageRow>(
    `${JOINED_TRANSACTION_SELECT}
     WHERE t.id = ? AND COALESCE(t.is_archived, 0) = 0
     LIMIT 1`,
    [id]
  )
  return rows[0] ?? null
}

/**
 * Execute one bounded, deterministic transaction page read. All filters are applied before
 * LIMIT/OFFSET; review counts cover the complete filtered result rather than the visible page.
 */
export async function queryTransactionPage(
  request: TransactionPageRequest
): Promise<TransactionPageResult> {
  const base = buildBaseWhere(request)
  const reviewReason = reviewReasonSql(request.reviewReason)
  const filteredSql = reviewReason ? `${base.sql}\n AND ${reviewReason}` : base.sql
  const page = normalizePositiveInteger(request.page, 1)
  const pageSize = normalizePageSize(request.pageSize)
  const sort = request.sort && request.sort in SORT_SQL ? request.sort : 'date'
  const direction = request.direction === 'asc' ? 'ASC' : 'DESC'
  const offset = (page - 1) * pageSize

  const [rows, countRows, currencyRows, reviewRows] = await Promise.all([
    query<TransactionPageRow>(
      `${JOINED_TRANSACTION_SELECT}
       WHERE ${filteredSql}
       ORDER BY ${SORT_SQL[sort]} ${direction}, t.id ASC
       LIMIT ? OFFSET ?`,
      [...base.params, pageSize, offset]
    ),
    query<CountRow>(
      `SELECT COUNT(*) AS total
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts ta ON ta.id = t.transfer_to_account_id
       WHERE ${filteredSql}`,
      base.params
    ),
    query<CurrencyRow>(
      `SELECT DISTINCT t.currency AS currency
       FROM transactions t
       WHERE COALESCE(t.is_archived, 0) = 0 AND TRIM(COALESCE(t.currency, '')) != ''
       ORDER BY t.currency ASC`
    ),
    query<ReviewCountRow>(
      `SELECT
         SUM(CASE WHEN ${NEEDS_REVIEW_SQL} THEN 1 ELSE 0 END) AS all_count,
         SUM(CASE WHEN ${NEEDS_CATEGORY_SQL} THEN 1 ELSE 0 END) AS needs_category_count,
         SUM(CASE WHEN ${PENDING_SQL} THEN 1 ELSE 0 END) AS pending_count,
         SUM(CASE WHEN ${PLACEHOLDER_SQL} THEN 1 ELSE 0 END) AS placeholder_count,
         SUM(CASE WHEN ${STAGED_SQL} THEN 1 ELSE 0 END) AS staged_count,
         SUM(CASE WHEN ${UNCLASSIFIED_SQL} THEN 1 ELSE 0 END) AS unclassified_count
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN accounts ta ON ta.id = t.transfer_to_account_id
       WHERE ${base.sql}`,
      base.params
    ),
  ])

  const review = reviewRows[0]
  return {
    rows,
    total: Number(countRows[0]?.total ?? 0),
    currencies: currencyRows.map((row) => row.currency),
    reviewCounts: {
      all: Number(review?.all_count ?? 0),
      'needs-category': Number(review?.needs_category_count ?? 0),
      pending: Number(review?.pending_count ?? 0),
      placeholder: Number(review?.placeholder_count ?? 0),
      staged: Number(review?.staged_count ?? 0),
      unclassified: Number(review?.unclassified_count ?? 0),
    },
  }
}
