import Database from 'better-sqlite3'
import { ulid } from 'ulidx'
import { existsSync, unlinkSync } from 'node:fs'
import { PRIVATE_FILE_MODE, hardenPathMode } from './app-data-dir.mjs'
import { exportDatabaseBuffer, importDatabaseBuffer } from './data-server-db.mjs'

export function createDatabaseSession({ dbPath: DB_PATH, runMigrations }) {
  function sqliteErrorCode(error) {
    return error && typeof error === 'object' && typeof error.code === 'string'
      ? error.code
      : undefined
  }

  function databaseStartupError(error) {
    const code = sqliteErrorCode(error)
    const detail = error instanceof Error ? error.message : String(error)
    if (
      code === 'SQLITE_NOTADB' ||
      code === 'SQLITE_CORRUPT' ||
      /not a database|malformed/i.test(detail)
    ) {
      return new Error(
        `The Shikin database at ${DB_PATH} is invalid or corrupt. Original error: ${detail}`,
        {
          cause: error,
        }
      )
    }
    if (
      code === 'EACCES' ||
      code === 'EPERM' ||
      /permission denied|access denied|readonly|read-only/i.test(detail)
    ) {
      return new Error(
        `Permission denied while opening the Shikin database at ${DB_PATH}. Original error: ${detail}`,
        {
          cause: error,
        }
      )
    }
    return new Error(
      `Unable to open the Shikin database at ${DB_PATH}. Original error: ${detail}`,
      {
        cause: error,
      }
    )
  }

  function openDatabase() {
    let database = null
    try {
      database = new Database(DB_PATH)
      database.pragma('journal_mode = WAL')
      database.pragma('foreign_keys = ON')
      database.pragma('busy_timeout = 5000')
      hardenPathMode(DB_PATH, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-wal`, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-shm`, PRIVATE_FILE_MODE)
      hardenPathMode(`${DB_PATH}-journal`, PRIVATE_FILE_MODE)
      return database
    } catch (error) {
      try {
        database?.close()
      } catch {
        // Preserve the open/pragma failure.
      }
      throw databaseStartupError(error)
    }
  }

  let db = openDatabase()
  const TRANSACTION_TTL_MS = Number(process.env.SHIKIN_SERVER_TRANSACTION_TTL_MS || 15000)
  const activeTransactions = new Map()
  const closedTransactions = new Map()

  // better-sqlite3 calls are synchronous. A second connection waiting on SQLite's
  // busy timeout would therefore block this process from committing the transaction
  // which owns the lock. Keep all use of the shared database behind an asynchronous
  // ownership gate; transaction-scoped requests use their owner's connection directly.
  const databaseGate = {
    owner: null,
    waiters: [],
    idleWaiters: [],
    maintenance: null,
    closed: false,
  }

  function notifyDatabaseGateIdle() {
    if (databaseGate.owner) return
    const idleWaiters = databaseGate.idleWaiters.splice(0)
    for (const resolveIdle of idleWaiters) resolveIdle()
  }

  function waitForDatabaseGateIdle() {
    if (!databaseGate.owner) return Promise.resolve()
    return new Promise((resolveIdle) => databaseGate.idleWaiters.push(resolveIdle))
  }

  function removeDatabaseGateWaiter(waiter) {
    const index = databaseGate.waiters.indexOf(waiter)
    if (index >= 0) databaseGate.waiters.splice(index, 1)
  }

  function grantDatabaseGateWaiter(waiter) {
    waiter.granted = true
    waiter.cleanup()
    const owner = { kind: waiter.kind, token: Symbol(waiter.kind) }
    databaseGate.owner = owner
    if (waiter.maintenance) databaseGate.maintenance = 'active'

    let released = false
    waiter.resolve(() => {
      if (released) return
      released = true
      if (databaseGate.owner?.token === owner.token) databaseGate.owner = null
      if (waiter.maintenance) databaseGate.maintenance = null
      grantNextDatabaseGateWaiter()
      notifyDatabaseGateIdle()
    })
  }

  function grantNextDatabaseGateWaiter() {
    if (databaseGate.owner || databaseGate.closed) return

    let waiter
    while ((waiter = databaseGate.waiters.shift())) {
      if (!waiter.cancelled) {
        grantDatabaseGateWaiter(waiter)
        return
      }
    }
  }

  function rejectDatabaseGateWaiter(waiter, error) {
    if (waiter.granted || waiter.cancelled) return
    waiter.cancelled = true
    removeDatabaseGateWaiter(waiter)
    waiter.cleanup()
    waiter.reject(error)
  }

  function enqueueDatabaseGateOwnership(req, res, kind, { maintenance = false } = {}) {
    return new Promise((resolveOwnership, rejectOwnership) => {
      const waiter = {
        kind,
        maintenance,
        granted: false,
        cancelled: false,
        cleanup: () => {},
        resolve: resolveOwnership,
        reject: rejectOwnership,
      }

      const cancel = () => {
        rejectDatabaseGateWaiter(
          waiter,
          createHttpError('Database request was cancelled before it acquired ownership.', 499)
        )
        if (maintenance && databaseGate.maintenance === 'pending') {
          databaseGate.maintenance = null
          grantNextDatabaseGateWaiter()
        }
      }
      waiter.cleanup = () => {
        req?.off('aborted', cancel)
        res?.off('close', cancel)
      }
      req?.once('aborted', cancel)
      res?.once('close', cancel)

      if (!databaseGate.owner && databaseGate.waiters.length === 0) {
        grantDatabaseGateWaiter(waiter)
      } else {
        databaseGate.waiters.push(waiter)
      }
    })
  }

  function acquireDatabaseOwnership(req, res, kind) {
    if (databaseGate.closed) {
      throw createHttpError('Database server is shutting down.', 503)
    }
    if (databaseGate.maintenance) {
      throw createHttpError('Database restore is in progress.', 409)
    }
    return enqueueDatabaseGateOwnership(req, res, kind)
  }

  function assertDatabaseRequestConnected(req, res) {
    if (req.aborted || res.destroyed) {
      throw createHttpError('Database request was cancelled before it acquired ownership.', 499)
    }
  }

  function acquireDatabaseMaintenance(req, res, operation) {
    if (databaseGate.closed) {
      throw createHttpError('Database server is shutting down.', 503)
    }
    if (databaseGate.maintenance) {
      throw createHttpError(
        `Cannot ${operation} while another database restore is in progress.`,
        409
      )
    }
    if (activeTransactions.size > 0 || databaseGate.owner?.kind === 'transaction') {
      throw createHttpError(`Cannot ${operation} while server-side transactions are active.`, 409)
    }

    databaseGate.maintenance = 'pending'
    const displacedWaiters = databaseGate.waiters.splice(0)
    for (const waiter of displacedWaiters) {
      rejectDatabaseGateWaiter(
        waiter,
        createHttpError('Database restore started before this queued database request ran.', 409)
      )
    }
    return enqueueDatabaseGateOwnership(req, res, 'restore', { maintenance: true })
  }

  function closeDatabaseGate() {
    databaseGate.closed = true
    const waiters = databaseGate.waiters.splice(0)
    for (const waiter of waiters) {
      rejectDatabaseGateWaiter(waiter, createHttpError('Database server is shutting down.', 503))
    }
    notifyDatabaseGateIdle()
  }

  function createHttpError(message, statusCode) {
    const error = new Error(message)
    error.statusCode = statusCode
    return error
  }

  function rememberClosedTransaction(transactionId, status) {
    const existing = closedTransactions.get(transactionId)
    if (existing) {
      clearTimeout(existing.timeout)
    }

    const timeout = setTimeout(() => {
      closedTransactions.delete(transactionId)
    }, TRANSACTION_TTL_MS)
    closedTransactions.set(transactionId, { status, timeout })
  }

  function normalizeTransactionId(transactionId, { allowUndefined = false } = {}) {
    if (transactionId === undefined) {
      if (allowUndefined) {
        return undefined
      }
      throw createHttpError('Missing transactionId', 400)
    }

    if (typeof transactionId !== 'string' || transactionId.trim() === '') {
      throw createHttpError('Invalid transactionId', 400)
    }

    return transactionId.trim()
  }

  function scheduleTransactionExpiry(transactionId) {
    const entry = activeTransactions.get(transactionId)
    if (!entry) {
      return
    }

    clearTimeout(entry.timeout)
    entry.timeout = setTimeout(() => {
      const staleEntry = activeTransactions.get(transactionId)
      if (!staleEntry) {
        return
      }

      let status = 'expired_rolled_back'
      try {
        staleEntry.db.exec('ROLLBACK')
      } catch {
        status = 'expired_rollback_failed'
      }

      activeTransactions.delete(transactionId)
      try {
        staleEntry.db.close()
      } catch {
        // The ownership permit must still be released if connection cleanup fails.
      } finally {
        try {
          rememberClosedTransaction(transactionId, status)
        } finally {
          staleEntry.releaseOwnership()
        }
      }
    }, TRANSACTION_TTL_MS)
  }

  async function beginServerTransaction(req, res) {
    const releaseOwnership = await acquireDatabaseOwnership(req, res, 'transaction')
    let transactionDb = null

    try {
      assertDatabaseRequestConnected(req, res)

      const transactionId = ulid()
      transactionDb = openDatabase()
      transactionDb.exec('BEGIN IMMEDIATE')
      activeTransactions.set(transactionId, {
        db: transactionDb,
        timeout: null,
        releaseOwnership,
      })
      scheduleTransactionExpiry(transactionId)
      return transactionId
    } catch (error) {
      try {
        transactionDb?.close()
      } catch {
        // Preserve the begin failure.
      } finally {
        releaseOwnership()
      }
      throw error
    }
  }

  function getDatabaseForRequest(transactionId) {
    const normalizedTransactionId = normalizeTransactionId(transactionId)

    const transactionEntry = activeTransactions.get(normalizedTransactionId)
    if (!transactionEntry) {
      const closedEntry = closedTransactions.get(normalizedTransactionId)
      if (closedEntry) {
        throw createHttpError(
          `Transaction already ${closedEntry.status.replaceAll('_', ' ')}: ${normalizedTransactionId}`,
          409
        )
      }

      throw createHttpError(`Unknown transaction: ${normalizedTransactionId}`, 404)
    }

    scheduleTransactionExpiry(normalizedTransactionId)
    return transactionEntry.db
  }

  function closeServerTransaction(transactionId, action) {
    const normalizedTransactionId = normalizeTransactionId(transactionId)
    const transactionEntry = activeTransactions.get(normalizedTransactionId)
    if (!transactionEntry) {
      const closedEntry = closedTransactions.get(normalizedTransactionId)
      if (closedEntry) {
        return { ok: true, status: closedEntry.status }
      }

      throw createHttpError(`Unknown transaction: ${normalizedTransactionId}`, 404)
    }

    let terminalError = null
    let status
    try {
      transactionEntry.db.exec(action === 'commit' ? 'COMMIT' : 'ROLLBACK')
      status = action === 'commit' ? 'committed' : 'rolled_back'
    } catch (error) {
      terminalError = error
      status = action === 'commit' ? 'commit_failed' : 'rollback_failed'
    }

    clearTimeout(transactionEntry.timeout)
    activeTransactions.delete(normalizedTransactionId)
    try {
      transactionEntry.db.close()
    } catch (error) {
      terminalError ??= error
    } finally {
      try {
        rememberClosedTransaction(normalizedTransactionId, status)
      } finally {
        transactionEntry.releaseOwnership()
      }
    }

    if (terminalError) throw terminalError
    return { ok: true, status }
  }

  function ensureNoActiveTransactions(operation) {
    if (activeTransactions.size > 0) {
      throw createHttpError(`Cannot ${operation} while server-side transactions are active.`, 409)
    }
  }

  function initialize(initializeIdentity) {
    try {
      runMigrations(db)
      initializeIdentity()
    } catch (error) {
      try {
        db?.close()
      } catch {
        // Preserve the initialization failure.
      }
      throw error
    }
  }

  async function query(req, res, sql, params, requestTransactionId, respond) {
    const transactionId = normalizeTransactionId(requestTransactionId, { allowUndefined: true })

    if (transactionId) {
      const rows = getDatabaseForRequest(transactionId)
        .prepare(sql)
        .all(...params)
      return respond(rows)
    }

    const releaseOwnership = await acquireDatabaseOwnership(req, res, 'query')
    try {
      assertDatabaseRequestConnected(req, res)
      const rows = db.prepare(sql).all(...params)
      return respond(rows)
    } finally {
      releaseOwnership()
    }
  }

  async function execute(req, res, sql, params, requestTransactionId, respond) {
    const transactionId = normalizeTransactionId(requestTransactionId, { allowUndefined: true })

    let releaseOwnership = null
    const database = transactionId
      ? getDatabaseForRequest(transactionId)
      : await acquireDatabaseOwnership(req, res, 'execute').then((release) => {
          releaseOwnership = release
          return db
        })

    try {
      if (releaseOwnership) assertDatabaseRequestConnected(req, res)
      const result = database.prepare(sql).run(...params)
      return respond({
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      })
    } finally {
      releaseOwnership?.()
    }
  }

  // The operation and response run synchronously while the permit is held.
  async function runSynchronous(req, res, kind, operation) {
    const releaseOwnership = await acquireDatabaseOwnership(req, res, kind)
    try {
      assertDatabaseRequestConnected(req, res)
      return operation(db)
    } finally {
      releaseOwnership()
    }
  }

  async function exportSnapshot(req, res, respond) {
    ensureNoActiveTransactions('export the database')
    const releaseOwnership = await acquireDatabaseOwnership(req, res, 'export')
    try {
      assertDatabaseRequestConnected(req, res)
      const bytes = await exportDatabaseBuffer({ db, dbPath: DB_PATH })
      return respond(bytes)
    } finally {
      releaseOwnership()
    }
  }

  async function importSnapshot(req, res, buffer, respond) {
    // Recheck after the upload and reserve exclusive ownership before validation
    // creates files or the live database can be closed/replaced.
    const releaseOwnership = await acquireDatabaseMaintenance(
      req,
      res,
      'import a database snapshot'
    )
    try {
      assertDatabaseRequestConnected(req, res)
      let importResult
      try {
        importResult = await importDatabaseBuffer({ db, dbPath: DB_PATH, buffer })
        try {
          db = openDatabase()
          runMigrations(db)
          if (importResult.backupPath && existsSync(importResult.backupPath)) {
            try {
              unlinkSync(importResult.backupPath)
            } catch (cleanupError) {
              console.warn(
                `[data-server] Imported database successfully, but could not remove rollback backup: ${cleanupError.message}`
              )
            }
          }
        } catch (error) {
          db?.close()
          await importResult.restoreBackup()
          db = openDatabase()
          throw error
        }
      } catch (error) {
        try {
          db.prepare('SELECT 1').get()
        } catch {
          db = openDatabase()
        }
        throw error
      }

      return respond({ ok: true, message: 'Database imported successfully.' })
    } finally {
      releaseOwnership()
    }
  }

  let shuttingDown = false

  async function shutdown(signal, server, releaseHostedProcessMarker) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[data-server] Received ${signal}; shutting down.`)
    closeDatabaseGate()
    const serverClosed = new Promise((resolveClose) => server.close(resolveClose))

    for (const [transactionId, transactionEntry] of activeTransactions) {
      clearTimeout(transactionEntry.timeout)
      try {
        transactionEntry.db.exec('ROLLBACK')
      } catch {
        // Best-effort cleanup for active transactions during process shutdown.
      }
      activeTransactions.delete(transactionId)
      try {
        transactionEntry.db.close()
      } catch {
        // Ownership and shutdown must progress even if connection cleanup fails.
      } finally {
        transactionEntry.releaseOwnership()
      }
    }

    for (const { timeout } of closedTransactions.values()) {
      clearTimeout(timeout)
    }
    closedTransactions.clear()

    await waitForDatabaseGateIdle()
    await serverClosed
    try {
      db?.close()
    } finally {
      releaseHostedProcessMarker()
      process.exit(0)
    }
  }

  return {
    initialize,
    query,
    execute,
    runSynchronous,
    beginTransaction: beginServerTransaction,
    closeTransaction: closeServerTransaction,
    assertCanImport() {
      ensureNoActiveTransactions('import a database snapshot')
    },
    exportSnapshot,
    importSnapshot,
    shutdown,
  }
}
