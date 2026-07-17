interface DatabaseLike {
  close(): void
  backup(path: string): Promise<{ totalPages: number; remainingPages: number }>
  pragma(sql: string, options?: { simple?: boolean }): unknown
  prepare(sql: string): {
    all(): Array<Record<string, unknown>>
    get(): Record<string, unknown> | undefined
  }
}

export function checkpointWal(
  database: DatabaseLike,
  options?: { requireComplete?: boolean }
): Record<string, unknown>
export function validateDatabaseFile(dbPath: string, label?: string): void
export function exportDatabaseBuffer(args: {
  db: DatabaseLike
  dbPath: string
  tempDbPath?: string
}): Promise<Buffer>
export function importDatabaseBuffer(args: {
  db: DatabaseLike
  dbPath: string
  buffer: Buffer
  tempDbPath?: string
}): Promise<{
  backupPath: string | null
  restoreBackup: () => Promise<void>
}>
