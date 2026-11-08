import { z, boundedText, type ToolDefinition } from './shared.js'
import { backupDatabase, restoreDatabase } from '../database.js'

function databaseOperationError(error: unknown, fallbackReason: string): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : undefined
  const reasonByCode: Record<string, string> = {
    RESTORE_ACTIVE_HANDLES: 'restore_active_handles',
    RESTORE_UNSUPPORTED_PLATFORM: 'restore_unsupported_platform',
    RESTORE_SOURCE_IS_ACTIVE_DB: 'restore_source_is_active_database',
    RESTORE_LOCK_EXISTS: 'restore_lock_exists',
    RESTORE_SOURCE_HAS_SIDECARS: 'restore_source_has_sidecars',
  }
  const hintByCode: Record<string, string> = {
    RESTORE_ACTIVE_HANDLES:
      'Close Shikin, the browser data-server, MCP server, and other CLI sessions before retrying restore. Backup remains safe to run while the database is active.',
    RESTORE_UNSUPPORTED_PLATFORM:
      'Use the Shikin app restore flow on this platform, or stop all Shikin processes and replace the database manually after creating a backup.',
    RESTORE_SOURCE_IS_ACTIVE_DB:
      'Choose a backup file from the backups directory or another safe location; never restore from the active database file or its sidecars.',
    RESTORE_LOCK_EXISTS:
      'If no restore is running, remove the stale restore lock file after confirming no Shikin restore process is active.',
    RESTORE_SOURCE_HAS_SIDECARS:
      'Create a clean backup with shikin backup-database and restore that single backup file instead of a live SQLite database family.',
  }
  const fallbackCode = fallbackReason.toUpperCase().replace(/[^A-Z0-9]+/g, '_')

  return {
    success: false,
    reason: code ? (reasonByCode[code] ?? fallbackReason) : fallbackReason,
    message,
    code: code ?? fallbackCode,
    ...(error && typeof error === 'object' && 'activeHandles' in error
      ? { activeHandles: error.activeHandles }
      : {}),
    ...(error && typeof error === 'object' && 'sidecars' in error
      ? { sidecars: error.sidecars }
      : {}),
    ...(code && hintByCode[code] ? { hint: hintByCode[code] } : {}),
  }
}

export const backupDatabaseTool: ToolDefinition = {
  name: 'backup-database',
  description:
    'Create a consistent manual SQLite database backup under the Shikin app data backups directory.',
  schema: z.object({}),
  execute: async () => {
    try {
      const backup = await backupDatabase()
      return {
        success: true,
        path: backup.path,
        backup,
        message: `Created database backup at ${backup.path}.`,
      }
    } catch (error) {
      return databaseOperationError(error, 'database_backup_failed')
    }
  },
}

export const restoreDatabaseTool: ToolDefinition = {
  name: 'restore-database',
  description:
    'Preview a Shikin SQLite restore by default. Pass apply:true to restore after validation and create a rollback backup.',
  schema: z.object({
    file: boundedText(
      'Database backup file',
      'Path to a Shikin SQLite backup file to restore',
      4096
    ),
    apply: z.boolean().optional().describe('Apply the restore after validation'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Legacy preview flag. Explicit false still applies for one compatibility cycle.'),
  }),
  execute: async ({ file, apply, dryRun }) => {
    if (apply === true && dryRun === true) {
      return {
        success: false,
        reason: 'restore_apply_conflict',
        message: 'Use either apply:true or dryRun:true, not both.',
      }
    }

    const legacyApply = apply !== true && dryRun === false
    const shouldApply = apply === true || legacyApply

    try {
      const restore = await restoreDatabase({ sourcePath: file, dryRun: !shouldApply })
      const rollbackPath = !restore.dryRun ? restore.rollbackPath : undefined
      return {
        success: true,
        dryRun: restore.dryRun,
        requiresApply: restore.dryRun,
        sourcePath: restore.sourcePath,
        ...(rollbackPath ? { rollbackPath } : {}),
        ...(legacyApply
          ? { warning: 'dryRun:false is deprecated; use apply:true for future restores.' }
          : {}),
        restore,
        message: restore.dryRun
          ? `Validated database backup ${restore.sourcePath}; no restore was applied. Re-run with apply:true to restore it.`
          : `Restored database from ${restore.sourcePath}. Rollback backup: ${restore.rollbackPath ?? 'none'}.`,
      }
    } catch (error) {
      return databaseOperationError(error, 'database_restore_failed')
    }
  },
}
