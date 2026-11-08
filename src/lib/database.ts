import { runTauriMigrations, type TauriSchemaClient } from '@/lib/tauri-database-schema'
import { enqueueBrowserOperation } from '@/lib/browser-operation-queue'
import { isTauri, DATA_SERVER_URL, withDataServerHeaders } from '@/lib/runtime'

// ── Types ──────────────────────────────────────────────────────────────────

export type TauriDatabase = TauriSchemaClient & {
  close(): Promise<void>
}

type TauriFsModule = {
  exists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<Uint8Array>
  remove: (path: string) => Promise<void>
  writeFile: (path: string, data: Uint8Array, options?: { mode?: number }) => Promise<void>
}

type TauriCoreModule = {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
}

export type TransactionClient = {
  query<T>(sql: string, bindValues?: unknown[]): Promise<T[]>
  execute(
    sql: string,
    bindValues?: unknown[]
  ): Promise<{ rowsAffected: number; lastInsertId: number }>
}

// ── State ──────────────────────────────────────────────────────────────────

let tauriDb: TauriDatabase | null = null
let tauriInitPromise: Promise<TauriDatabase> | null = null
let tauriTransactionSequence = 0
let tauriDbOperationQueue: Promise<unknown> = Promise.resolve()

async function getTauriDbPath(): Promise<string> {
  const pathMod = await (import('@tauri-apps/api/path') as Promise<{
    appDataDir: () => Promise<string>
    join: (...paths: string[]) => Promise<string>
  }>)
  return pathMod.join(await pathMod.appDataDir(), 'shikin.db')
}

async function getTauriSqliteUrl(): Promise<string> {
  return `sqlite:${await getTauriDbPath()}`
}

// ── Tauri Backend ──────────────────────────────────────────────────────────

async function getTauriDb(): Promise<TauriDatabase> {
  if (tauriDb) return tauriDb
  if (!tauriInitPromise) {
    tauriInitPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql')
      const database = await Database.load(await getTauriSqliteUrl())
      const loaded = database as unknown as TauriDatabase
      try {
        await enableTauriForeignKeys(loaded)
        await runTauriMigrations(loaded, runTauriLoadedPoolTransaction)
        // Database initialization is the only native identity creation boundary.
        // Rust performs exclusive creation; an existing valid identity wins.
        await invokeTauri<string>('initialize_runtime_identity', {
          localInstanceId: crypto.randomUUID(),
        })
        tauriDb = loaded
        return loaded
      } catch (error) {
        await loaded.close().catch(() => {})
        tauriInitPromise = null
        throw error
      }
    })()
  }
  return tauriInitPromise
}

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = (await import('@tauri-apps/api/core')) as TauriCoreModule
  return invoke<T>(command, args)
}

function enqueueTauriDbOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = tauriDbOperationQueue.then(operation, operation)
  tauriDbOperationQueue = run.catch(() => {})
  return run
}

function nextTauriTransactionId(): string {
  tauriTransactionSequence += 1
  return `shikin-tx-${Date.now()}-${tauriTransactionSequence}`
}

function createTauriTransactionClient(transactionId: string): TransactionClient {
  return {
    query: <T>(sql: string, bindValues?: unknown[]) =>
      invokeTauri<T[]>('shikin_db_tx_query', {
        statement: {
          transactionId,
          query: sql,
          values: bindValues || [],
        },
      }),
    execute: (sql: string, bindValues?: unknown[]) =>
      invokeTauri<{ rowsAffected: number; lastInsertId: number }>('shikin_db_tx_execute', {
        statement: {
          transactionId,
          query: sql,
          values: bindValues || [],
        },
      }),
  }
}

async function runTauriWithTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  await getTauriDb()
  return runTauriLoadedPoolTransaction(fn)
}

// Initialization already loaded the SQL pool. Do not recurse into getTauriDb here.
async function runTauriLoadedPoolTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>
): Promise<T> {
  const transactionId = nextTauriTransactionId()
  await invokeTauri<void>('shikin_db_tx_begin', { transactionId })

  try {
    const result = await fn(createTauriTransactionClient(transactionId))
    await invokeTauri<void>('shikin_db_tx_commit', { transactionId })
    return result
  } catch (error) {
    try {
      await invokeTauri<void>('shikin_db_tx_rollback', { transactionId })
    } catch {
      // Preserve the original application error when rollback also fails.
    }
    throw error
  }
}

async function enableTauriForeignKeys(db: TauriDatabase): Promise<void> {
  await db.execute('PRAGMA foreign_keys = ON')
}

async function removeIfExists(fsMod: TauriFsModule, path: string): Promise<void> {
  if (await fsMod.exists(path)) {
    await fsMod.remove(path)
  }
}

// ── Browser Backend ────────────────────────────────────────────────────────

async function browserFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${DATA_SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: withDataServerHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
  } catch (err) {
    // eslint-disable-next-line preserve-caught-error -- original error included in message
    throw new Error(
      `Cannot reach data server at ${DATA_SERVER_URL}. ` +
        `Make sure it is running (start it with pnpm dev). ` +
        `Original error: ${err instanceof Error ? err.message : err}`
    )
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DB request failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function verifyBrowserServer(): Promise<void> {
  // Run a lightweight test query to verify the data server is up and the DB is ready
  try {
    await browserFetch<unknown[]>('/api/db/query', {
      sql: 'SELECT 1 AS ok',
      params: [],
    })
  } catch (err) {
    // eslint-disable-next-line preserve-caught-error -- original error included in message
    throw new Error(
      `Data server health check failed. ` +
        `Ensure the data server is running: pnpm dev\n` +
        `${err instanceof Error ? err.message : err}`
    )
  }
}

async function browserQuery<T>(
  sql: string,
  bindValues: unknown[] = [],
  transactionId?: string
): Promise<T[]> {
  return browserFetch<T[]>('/api/db/query', {
    sql,
    params: bindValues,
    ...(transactionId ? { transactionId } : {}),
  })
}

async function browserExecute(
  sql: string,
  bindValues: unknown[] = [],
  transactionId?: string
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  return browserFetch<{ rowsAffected: number; lastInsertId: number }>('/api/db/execute', {
    sql,
    params: bindValues,
    ...(transactionId ? { transactionId } : {}),
  })
}

function createBrowserTransactionClient(transactionId: string): TransactionClient {
  return {
    query: <T>(sql: string, bindValues?: unknown[]) =>
      browserQuery<T>(sql, bindValues || [], transactionId),
    execute: (sql: string, bindValues?: unknown[]) =>
      browserExecute(sql, bindValues || [], transactionId),
  }
}

async function beginBrowserTransaction(): Promise<string> {
  const result = await browserFetch<{ transactionId?: string }>('/api/db/transaction', {
    action: 'begin',
  })

  if (!result.transactionId) {
    throw new Error('Data server did not return a transaction ID.')
  }

  return result.transactionId
}

async function finalizeBrowserTransaction(
  action: 'commit' | 'rollback',
  transactionId: string
): Promise<{ ok: boolean; status?: string }> {
  return browserFetch<{ ok: boolean; status?: string }>('/api/db/transaction', {
    action,
    transactionId,
  })
}

function assertBrowserTransactionFinalStatus(
  action: 'commit' | 'rollback',
  result: { ok: boolean; status?: string }
) {
  if (!result.ok) {
    throw new Error(`Browser transaction ${action} failed.`)
  }

  if (action === 'commit' && result.status !== 'committed') {
    throw new Error(
      `Browser transaction did not commit successfully (status: ${result.status ?? 'unknown'}).`
    )
  }

  if (
    action === 'rollback' &&
    result.status !== 'rolled_back' &&
    result.status !== 'expired_rolled_back'
  ) {
    throw new Error(
      `Browser transaction did not roll back cleanly (status: ${result.status ?? 'unknown'}).`
    )
  }
}

export async function withTransaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
  if (isTauri) {
    return enqueueTauriDbOperation(() => runTauriWithTransaction(fn))
  }

  return enqueueBrowserOperation(async () => {
    const transactionId = await beginBrowserTransaction()
    const tx = createBrowserTransactionClient(transactionId)

    try {
      const result = await fn(tx)
      assertBrowserTransactionFinalStatus(
        'commit',
        await finalizeBrowserTransaction('commit', transactionId)
      )
      return result
    } catch (error) {
      try {
        assertBrowserTransactionFinalStatus(
          'rollback',
          await finalizeBrowserTransaction('rollback', transactionId)
        )
      } catch {
        // Preserve the original application error when rollback transport also fails.
      }
      throw error
    }
  })
}

// ── Public API ─────────────────────────────────────────────────────────────
// These signatures are consumed by 74+ files — do NOT change them.

// fallow-ignore-next-line unused-export
export async function getDb(): Promise<TauriDatabase> {
  if (isTauri) {
    return getTauriDb()
  }
  // In browser mode, return a shim that delegates to the HTTP API.
  // getDb() is only used internally, but we expose it for compatibility.
  await enqueueBrowserOperation(verifyBrowserServer)
  return {
    select: async <T>(sql: string, params?: unknown[]): Promise<T> => {
      return enqueueBrowserOperation(() => browserQuery<T>(sql, params || [])) as Promise<T>
    },
    execute: async (sql: string, params?: unknown[]) => {
      return enqueueBrowserOperation(() => browserExecute(sql, params || []))
    },
    close: async () => {
      // No-op for browser mode
    },
  }
}

export async function query<T>(sql: string, bindValues?: unknown[]): Promise<T[]> {
  if (isTauri) {
    return enqueueTauriDbOperation(async () => {
      const database = await getTauriDb()
      return database.select<T[]>(sql, bindValues || [])
    })
  }
  return enqueueBrowserOperation(() => browserQuery<T>(sql, bindValues || []))
}

export async function execute(
  sql: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  if (isTauri) {
    return enqueueTauriDbOperation(async () => {
      const database = await getTauriDb()
      return database.execute(sql, bindValues || [])
    })
  }
  return enqueueBrowserOperation(() => browserExecute(sql, bindValues || []))
}

export async function runInTransaction<T>(_fn: () => Promise<T>): Promise<T> {
  throw new Error(
    'runInTransaction() is no longer supported. Use withTransaction((tx) => ...) so all transaction reads and writes use the same connection.'
  )
}

export async function materializeRecurringTransactionsBrowser(): Promise<{
  success: true
  created: number
  message: string
}> {
  return enqueueBrowserOperation(async () => {
    const result = await browserFetch<{
      success: boolean
      created?: number
      message?: string
      reason?: string
    }>('/api/recurring/materialize', {})

    if (!result.success) {
      throw new Error(result.message || 'Recurring materialization failed.')
    }

    return {
      success: true,
      created: result.created ?? 0,
      message: result.message ?? 'No recurring transactions were due.',
    }
  })
}

// ── Import / Export ────────────────────────────────────────────────────────

export async function exportDatabaseSnapshot(): Promise<Uint8Array> {
  if (isTauri) {
    return enqueueTauriDbOperation(async () => {
      const fsMod = await (import('@tauri-apps/plugin-fs') as Promise<TauriFsModule>)
      const snapshotPath = await invokeTauri<string>('shikin_db_create_snapshot')
      try {
        return await fsMod.readFile(snapshotPath)
      } finally {
        await removeIfExists(fsMod, snapshotPath)
      }
    })
  }

  // Browser mode: fetch raw binary from data server
  return enqueueBrowserOperation(async () => {
    const res = await fetch(`${DATA_SERVER_URL}/api/db/export`, {
      headers: withDataServerHeaders(),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Export failed (${res.status}): ${text}`)
    }
    const buffer = await res.arrayBuffer()
    return new Uint8Array(buffer)
  })
}

export async function importDatabaseSnapshot(data: Uint8Array): Promise<void> {
  if (isTauri) {
    return enqueueTauriDbOperation(async () => {
      const header = new TextDecoder('ascii').decode(data.subarray(0, 16))
      if (!header.startsWith('SQLite format 3')) {
        throw new Error('Invalid SQLite database file')
      }

      const fsMod = await (import('@tauri-apps/plugin-fs') as Promise<TauriFsModule>)
      const dbPath = await getTauriDbPath()
      const tempPath = `${dbPath}.import-check-${Date.now()}`
      await removeIfExists(fsMod, tempPath)
      await fsMod.writeFile(tempPath, data, { mode: 0o600 })

      let restoreResult: { rollbackPath: string | null } | null = null
      try {
        const currentDb = tauriDb
        tauriDb = null
        tauriInitPromise = null
        await currentDb?.close()

        restoreResult = await invokeTauri<{ rollbackPath: string | null }>(
          'shikin_db_restore_snapshot',
          { candidatePath: tempPath }
        )
        await getTauriDb()
      } catch (error) {
        const failedDb = tauriDb
        tauriDb = null
        tauriInitPromise = null
        await failedDb?.close().catch(() => {})

        if (restoreResult?.rollbackPath) {
          try {
            await invokeTauri('shikin_db_restore_snapshot', {
              candidatePath: restoreResult.rollbackPath,
            })
            await getTauriDb()
          } catch (rollbackError) {
            const symptom = new Error(
              `Database import failed and rollback could not be completed. Import error: ${error instanceof Error ? error.message : error}. Rollback error: ${rollbackError instanceof Error ? rollbackError.message : rollbackError}`
            ) as Error & { cause?: unknown }
            symptom.cause = rollbackError
            throw symptom
          }
        } else {
          await getTauriDb().catch(() => {})
        }
        throw error
      } finally {
        await removeIfExists(fsMod, tempPath)
        await removeIfExists(fsMod, `${tempPath}-wal`)
        await removeIfExists(fsMod, `${tempPath}-shm`)
        await removeIfExists(fsMod, `${tempPath}-journal`)
      }
    })
  }

  // Browser mode: POST binary to data server
  return enqueueBrowserOperation(async () => {
    const res = await fetch(`${DATA_SERVER_URL}/api/db/import`, {
      method: 'POST',
      headers: withDataServerHeaders({ 'Content-Type': 'application/octet-stream' }),
      body: data,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Import failed (${res.status}): ${text}`)
    }
    await res.arrayBuffer()
  })
}
