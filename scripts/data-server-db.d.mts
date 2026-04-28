interface DatabaseLike {
  close(): void
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
export function ensureSqliteDatabaseBuffer(buffer: Buffer): void
export function removeSqliteSidecarFiles(dbPath: string): void
export function validateShikinDatabase(database: DatabaseLike): void
export function validateImportedDatabaseBuffer(buffer: Buffer, tempDbPath: string): void
export function importDatabaseBuffer(args: {
  db: DatabaseLike
  dbPath: string
  buffer: Buffer
  tempDbPath?: string
}): void
