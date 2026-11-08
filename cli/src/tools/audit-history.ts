import { z, query, dayjs, boundedText, type ToolDefinition } from './shared.js'
import {
  type AuditLogRow,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  formatAuditRow,
  readAuditRows,
} from '../audit-read.js'

export const auditList: ToolDefinition = {
  name: 'audit-list',
  description:
    'List audit history entries with filters for automation-safe triage. Supports redaction of free-text before/after/source/note details.',
  schema: z.object({
    since: z
      .string()
      .trim()
      .datetime({ offset: true })
      .transform((value) => dayjs(value).toISOString())
      .optional()
      .describe('Only entries at or after this ISO timestamp'),
    entity: boundedText(
      'Audit entity',
      'Filter by audit entity, e.g. transaction or budget',
      120
    ).optional(),
    entityId: boundedText('Audit entity ID', 'Filter by audited entity ID', 160).optional(),
    action: boundedText(
      'Audit action',
      'Filter by audit action, e.g. create/update/delete',
      80
    ).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(MAX_AUDIT_LIMIT)
      .optional()
      .default(DEFAULT_AUDIT_LIMIT)
      .describe(`Maximum audit rows to return (max ${MAX_AUDIT_LIMIT})`),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive/free-text before/after/source/note details'),
  }),
  execute: async ({ since, entity, entityId, action, limit, redacted }) => {
    const rows = readAuditRows({ since, entity, entityId, action, limit, redacted })

    return {
      success: true,
      redacted,
      filters: {
        since: since ?? null,
        entity: entity ?? null,
        entityId: entityId ?? null,
        action: action ?? null,
        limit,
      },
      count: rows.length,
      rows,
      message:
        rows.length === 0 ? 'No audit entries found.' : `Found ${rows.length} audit entry(s).`,
    }
  },
}

export const auditShow: ToolDefinition = {
  name: 'audit-show',
  description: 'Show one audit history entry by ID with optional free-text redaction.',
  schema: z.object({
    id: boundedText('Audit ID', 'Audit log entry ID to fetch', 160),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact sensitive/free-text before/after/source/note details'),
  }),
  execute: async ({ id, redacted }) => {
    const row = query<AuditLogRow>(
      `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
       FROM audit_log
       WHERE id = $1
       LIMIT 1`,
      [id]
    )[0]

    if (!row) {
      return {
        success: false,
        reason: 'audit_entry_not_found',
        code: 'AUDIT_ENTRY_NOT_FOUND',
        message: `Audit entry ${id} not found.`,
      }
    }

    return {
      success: true,
      redacted,
      entry: formatAuditRow(row, redacted),
      message: `Found audit entry ${id}.`,
    }
  },
}
