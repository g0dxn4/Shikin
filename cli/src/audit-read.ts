import { query } from './database.js'

export type AuditLogRow = {
  id: string
  entity: string
  entity_id: string | null
  action: string
  before_json: string | null
  after_json: string | null
  source: string | null
  note: string | null
  created_at: string
}

export type UndoSupportedEntity = 'transaction' | 'credit_card_statement'
export type UndoSupportedAction = 'create' | 'update' | 'delete'

export const DEFAULT_AUDIT_LIMIT = 25
export const MAX_AUDIT_LIMIT = 200

export const REDACTED_VALUE = '[REDACTED]'

const AUDIT_STRING_ALLOWLIST = new Set([
  'id',
  'entity',
  'entityId',
  'accountId',
  'transferToAccountId',
  'categoryId',
  'subcategoryId',
  'recurringRuleId',
  'budgetId',
  'bucketId',
  'transactionId',
  'statementId',
  'subscriptionId',
  'goalId',
  'currency',
  'type',
  'status',
  'action',
  'date',
  'createdAt',
  'updatedAt',
])

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseAuditJson(value: string | null): unknown {
  if (typeof value !== 'string' || value.trim() === '') return null

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export function redactAuditStructuredValue(value: unknown, parentKey?: string): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map((item) => redactAuditStructuredValue(item, parentKey))
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, redactAuditStructuredValue(nested, key)])
    )
  }
  if (typeof value === 'string') {
    return parentKey && AUDIT_STRING_ALLOWLIST.has(parentKey) ? value : REDACTED_VALUE
  }

  return value
}

export function redactText(value: string | null | undefined, redacted: boolean): string | null {
  if (value === null || value === undefined) return null
  return redacted ? REDACTED_VALUE : value
}

export function formatAuditRow(row: AuditLogRow, redacted: boolean) {
  const before = parseAuditJson(row.before_json)
  const after = parseAuditJson(row.after_json)

  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    before: redacted ? redactAuditStructuredValue(before) : before,
    after: redacted ? redactAuditStructuredValue(after) : after,
    source: redactText(row.source, redacted),
    note: redactText(row.note, redacted),
    createdAt: row.created_at,
  }
}

function auditFilterInput(input: {
  since?: string
  entity?: string
  entityId?: string
  action?: string
  limit?: number
}) {
  const filters: string[] = []
  const params: unknown[] = []
  const addFilter = (sql: string, value: unknown) => {
    params.push(value)
    filters.push(sql.replace('?', `$${params.length}`))
  }

  if (input.since) addFilter('created_at >= ?', input.since)
  if (input.entity) addFilter('entity = ?', input.entity)
  if (input.entityId) addFilter('entity_id = ?', input.entityId)
  if (input.action) addFilter('action = ?', input.action)

  const limit = Math.min(Math.max(input.limit ?? DEFAULT_AUDIT_LIMIT, 1), MAX_AUDIT_LIMIT)

  return { filters, params, limit }
}

export function readAuditRows(input: {
  since?: string
  entity?: string
  entityId?: string
  action?: string
  limit?: number
  redacted: boolean
}) {
  const { filters, params, limit } = auditFilterInput(input)
  params.push(limit)
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )

  return rows.map((row) => formatAuditRow(row, input.redacted))
}

export function failure(reason: string, message: string, extra: Record<string, unknown> = {}) {
  return { success: false as const, reason, message, ...extra }
}

export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

export function nestedSnapshot(value: unknown, key: string): Record<string, unknown> | null {
  if (!isPlainObject(value)) return null
  const nested = value[key]
  return isPlainObject(nested) ? nested : null
}
