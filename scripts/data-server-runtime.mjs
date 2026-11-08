import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import dayjs from 'dayjs'
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  rmSync,
  readdirSync,
  lstatSync,
  statSync,
  realpathSync,
  createReadStream,
} from 'node:fs'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { ulid } from 'ulidx'
import {
  planRecurringOccurrence,
  recurringOccurrenceFailureMessage,
  validateRecurringOccurrences,
} from '@shikin/finance-core'
import { runMigrations } from './data-server-migrations.mjs'
import {
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  createStorageContext,
  ensurePrivateDirectory,
  hardenPathMode,
  prepareStorageContext,
} from './app-data-dir.mjs'
import { createDatabaseSession } from './data-server-session.mjs'
import { initializeRuntimeIdentity, readRuntimeIdentity } from './runtime-identity.mjs'
import {
  buildBridgeCorsHeaders,
  safePathNoSymlinks,
  validateBridgePreflight,
  validateBridgeRequest,
  validateHostedRequest,
} from './data-server-security.mjs'

// ── Configuration ──────────────────────────────────────────────────────────

const APPLICATION_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
).version

let started = false
let startup
let startupError

// Preserve the executable module's once-only startup and cached failure without
// making import itself acquire storage, probe SQLite, install signals or listen.
export function startDataServer(options) {
  if (!started) {
    started = true
    try {
      startup = initializeDataServer(options)
    } catch (error) {
      startupError = { error }
    }
  }
  if (startupError) throw startupError.error
  return startup
}

function initializeDataServer({
  port: PORT,
  hostedMode: HOSTED_MODE,
  staticRoot: STATIC_ROOT,
  storageEnvironment,
}) {
  if (HOSTED_MODE && !STATIC_ROOT) {
    throw new Error('Hosted web mode requires SHIKIN_WEB_STATIC_ROOT.')
  }

  if (STATIC_ROOT) {
    const staticRootStats = statSync(STATIC_ROOT)
    if (!staticRootStats.isDirectory()) {
      throw new Error(`Hosted web static root is not a directory: ${STATIC_ROOT}`)
    }
  }

  const STORAGE_CONTEXT = createStorageContext(storageEnvironment)

  function validateNativeSqliteBinding() {
    let probe = null
    try {
      probe = new Database(':memory:')
      probe.close()
      probe = null
    } catch (error) {
      try {
        probe?.close()
      } catch {
        // Keep the native load failure as the diagnostic cause.
      }
      throw new Error(
        'The better-sqlite3 native binding could not be loaded for this Node.js runtime. Reinstall or rebuild the CLI dependencies for the active Node ABI.',
        { cause: error }
      )
    }
  }

  // Native validation must succeed before preparation can inspect or migrate any
  // existing storage. The context itself is pure and immutable.
  validateNativeSqliteBinding()
  const DATA_DIR = prepareStorageContext(STORAGE_CONTEXT)
  const DB_PATH = STORAGE_CONTEXT.databasePath
  const SETTINGS_PATH = join(DATA_DIR, 'settings.json')
  const HOSTED_PROCESS_PATH = join(DATA_DIR, '.shikin-web.pid')
  const RESTORE_LOCK_PATH = STORAGE_CONTEXT.restoreLockPath

  function processIsRunning(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      return error?.code === 'EPERM'
    }
  }

  function readHostedProcessId() {
    try {
      const marker = JSON.parse(readFileSync(HOSTED_PROCESS_PATH, 'utf8'))
      return Number.isSafeInteger(marker?.pid) ? marker.pid : null
    } catch {
      return null
    }
  }

  function acquireHostedProcessMarker() {
    if (!HOSTED_MODE) return () => {}
    if (existsSync(RESTORE_LOCK_PATH)) {
      throw new Error('Cannot start hosted web access while a database restore is in progress.')
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let markerFd = null
      try {
        markerFd = openSync(HOSTED_PROCESS_PATH, 'wx', PRIVATE_FILE_MODE)
        writeFileSync(
          markerFd,
          JSON.stringify({ pid: process.pid, port: PORT, startedAt: new Date().toISOString() })
        )
        closeSync(markerFd)
        markerFd = null
        hardenPathMode(HOSTED_PROCESS_PATH, PRIVATE_FILE_MODE)
        return () => {
          if (readHostedProcessId() === process.pid) {
            rmSync(HOSTED_PROCESS_PATH, { force: true })
          }
        }
      } catch (error) {
        if (markerFd !== null) closeSync(markerFd)
        if (error?.code !== 'EEXIST') throw error

        const existingPid = readHostedProcessId()
        if (existingPid !== null && processIsRunning(existingPid)) {
          throw new Error(`Hosted web access is already running in process ${existingPid}.`)
        }
        rmSync(HOSTED_PROCESS_PATH, { force: true })
      }
    }

    throw new Error('Could not acquire the hosted web process marker.')
  }

  const releaseHostedProcessMarker = acquireHostedProcessMarker()

  // ── Database Setup ─────────────────────────────────────────────────────────

  let databaseSession
  try {
    databaseSession = createDatabaseSession({ dbPath: DB_PATH, runMigrations })
  } catch (error) {
    releaseHostedProcessMarker()
    throw error
  }

  // ── SQL Parameter Conversion ───────────────────────────────────────────────
  // The codebase uses $1, $2, ... positional params; better-sqlite3 uses ?

  function convertParams(sql) {
    return sql.replace(/\$(\d+)/g, '?')
  }

  try {
    databaseSession.initialize(() => {
      // Startup is the authorized initialization boundary. Reads never create or
      // repair this identity, and database restore leaves the sidecar untouched.
      initializeRuntimeIdentity(DATA_DIR, randomUUID())
    })
  } catch (error) {
    releaseHostedProcessMarker()
    throw error
  }

  // ── Settings (Key-Value Store) ─────────────────────────────────────────────

  function loadSettings() {
    try {
      if (existsSync(SETTINGS_PATH)) {
        return JSON.parse(readFileSync(SETTINGS_PATH, 'utf-8'))
      }
    } catch {
      // Corrupted file, start fresh
    }
    return {}
  }

  function saveSettings(settings) {
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
      encoding: 'utf-8',
      mode: PRIVATE_FILE_MODE,
    })
    hardenPathMode(SETTINGS_PATH, PRIVATE_FILE_MODE)
  }

  // ── HTTP Helpers ───────────────────────────────────────────────────────────

  const MAX_JSON_BODY_BYTES = Number(
    process.env.SHIKIN_DATA_SERVER_MAX_JSON_BODY_BYTES || 1_000_000
  )
  const MAX_DB_IMPORT_BYTES = Number(
    process.env.SHIKIN_DATA_SERVER_MAX_DB_IMPORT_BYTES || 50_000_000
  )

  function createPayloadTooLargeError(label, maxBytes) {
    const error = new Error(`${label} exceeds the ${maxBytes}-byte limit.`)
    error.statusCode = 413
    return error
  }

  function readBuffer(req, { maxBytes, label }) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let totalBytes = 0
      let tooLargeError = null

      req.on('data', (chunk) => {
        if (tooLargeError) {
          return
        }

        totalBytes += chunk.length

        if (totalBytes > maxBytes) {
          tooLargeError = createPayloadTooLargeError(label, maxBytes)
          return
        }

        chunks.push(chunk)
      })

      req.on('end', () => {
        if (tooLargeError) {
          reject(tooLargeError)
          return
        }

        resolve(Buffer.concat(chunks))
      })
      req.on('error', reject)
    })
  }

  function readBody(req) {
    return readBuffer(req, { maxBytes: MAX_JSON_BODY_BYTES, label: 'JSON request body' }).then(
      (buffer) => {
        try {
          return JSON.parse(buffer.toString())
        } catch {
          return {}
        }
      }
    )
  }

  const HOSTED_SECURITY_HEADERS = {
    'Content-Security-Policy':
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https://www.alphavantage.co https://api.coingecko.com https://api.frankfurter.app https://finnhub.io https://newsapi.org https://house-stock-watcher-data.s3-us-west-2.amazonaws.com https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com https://github.com https://objects.githubusercontent.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }

  function buildResponseHeaders(headers = {}) {
    return HOSTED_MODE
      ? { ...HOSTED_SECURITY_HEADERS, ...headers }
      : buildBridgeCorsHeaders(headers)
  }

  function sendJson(res, data, status = 200) {
    res.writeHead(
      status,
      buildResponseHeaders({
        'Content-Type': 'application/json',
      })
    )
    res.end(HOSTED_MODE && res.req?.method === 'HEAD' ? undefined : JSON.stringify(data))
  }

  function sendError(res, message, status = 500) {
    sendJson(res, { error: message }, status)
  }

  function advanceShortRecurringDate(date, frequency) {
    const d = dayjs(date)
    switch (frequency) {
      case 'daily':
        return d.add(1, 'day').format('YYYY-MM-DD')
      case 'weekly':
        return d.add(7, 'day').format('YYYY-MM-DD')
      case 'biweekly':
        return d.add(14, 'day').format('YYYY-MM-DD')
    }
  }

  function materializeRecurringBatch(db) {
    const today = dayjs().format('YYYY-MM-DD')
    const runBatch = db.transaction(() => {
      const dueRules = db
        .prepare(
          convertParams(`SELECT r.*, a.currency as account_currency,
                              a.is_archived as account_is_archived, a.account_mode
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         WHERE r.active = 1 AND r.next_date <= $1`)
        )
        .all(today)
      const failure = validateRecurringOccurrences(dueRules)
      if (failure) {
        return {
          success: false,
          reason: failure.reason,
          message: recurringOccurrenceFailureMessage(failure),
        }
      }

      let created = 0
      for (const rule of dueRules) {
        let date = rule.next_date
        while (date <= today) {
          const plan = planRecurringOccurrence(
            rule,
            date,
            today,
            advanceShortRecurringDate(date, rule.frequency)
          )
          if (!plan) break
          if (plan.kind === 'deactivate') {
            db.prepare(
              convertParams(
                "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 AND active = 1 AND next_date = $2"
              )
            ).run(rule.id, plan.date)
            break
          }
          const claimResult = db
            .prepare(
              convertParams(
                "UPDATE recurring_rules SET active = $1, next_date = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $3 AND active = 1 AND next_date = $4"
              )
            )
            .run(plan.active, plan.nextDate, rule.id, plan.date)
          if (claimResult.changes !== 1) break

          const occurrence = plan.transaction
          db.prepare(
            convertParams(`INSERT INTO transactions (id, account_id, category_id, subcategory_id, type, amount, currency, description, notes, date, tags, is_recurring, transfer_to_account_id, status, recurring_rule_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, 'posted', $13)`)
          ).run(
            ulid(),
            occurrence.account_id,
            occurrence.category_id,
            occurrence.subcategory_id,
            occurrence.type,
            occurrence.amount,
            occurrence.currency,
            occurrence.description,
            occurrence.notes,
            occurrence.date,
            occurrence.tags,
            occurrence.transfer_to_account_id,
            occurrence.recurring_rule_id
          )
          db.prepare(
            convertParams(
              "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND COALESCE(account_mode, 'transactional') = 'transactional'"
            )
          ).run(plan.balanceDelta, occurrence.account_id)
          created += 1
          if (plan.active === 0) break
          date = plan.nextDate
        }
      }
      return {
        success: true,
        created,
        message:
          created > 0
            ? `Created ${created} transaction(s) from recurring rules.`
            : 'No recurring transactions were due.',
      }
    })
    return runBatch()
  }

  function sendForbidden(res, message) {
    res.writeHead(
      403,
      HOSTED_MODE
        ? buildResponseHeaders({ 'Content-Type': 'application/json' })
        : {
            'Content-Type': 'application/json',
            Vary: 'Origin',
          }
    )
    res.end(
      HOSTED_MODE && res.req?.method === 'HEAD' ? undefined : JSON.stringify({ error: message })
    )
  }

  const STATIC_MIME_TYPES = {
    '.css': 'text/css; charset=utf-8',
    '.gif': 'image/gif',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8',
    '.webmanifest': 'application/manifest+json',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  function resolveStaticPath(pathname) {
    if (!STATIC_ROOT || pathname.includes('\0')) return null

    let decodedPath
    try {
      decodedPath = decodeURIComponent(pathname)
    } catch {
      return null
    }

    if (decodedPath.split(/[\\/]+/).includes('..')) return null

    const staticRoot = resolve(STATIC_ROOT)
    const staticPath = resolve(staticRoot, `.${decodedPath}`)
    const confinedPath = relative(staticRoot, staticPath)
    if (
      confinedPath === '..' ||
      confinedPath.startsWith(`..${'/'}`) ||
      confinedPath.startsWith(`..${'\\'}`) ||
      isAbsolute(confinedPath)
    ) {
      return null
    }

    try {
      const stats = lstatSync(staticPath)
      if (!stats.isFile() || stats.isSymbolicLink()) return null

      const realStaticRoot = realpathSync(staticRoot)
      const realStaticPath = realpathSync(staticPath)
      const realConfinedPath = relative(realStaticRoot, realStaticPath)
      if (
        realConfinedPath === '..' ||
        realConfinedPath.startsWith(`..${'/'}`) ||
        realConfinedPath.startsWith(`..${'\\'}`) ||
        isAbsolute(realConfinedPath)
      ) {
        return null
      }

      return realStaticPath
    } catch {
      return null
    }
  }

  function isHashedStaticAsset(pathname) {
    return /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname)
  }

  function isStaticAssetPath(pathname) {
    return pathname.startsWith('/assets/') || extname(pathname) !== ''
  }

  function serveStaticFile(req, res, pathname) {
    const staticPath = resolveStaticPath(pathname)
    if (!staticPath) {
      if (isStaticAssetPath(pathname)) {
        return sendError(res, 'Not found', 404)
      }
      return serveStaticFile(req, res, '/index.html')
    }

    const stats = statSync(staticPath)
    const isIndex = staticPath === resolve(STATIC_ROOT, 'index.html')
    const cacheControl = isIndex
      ? 'no-cache'
      : isHashedStaticAsset(pathname)
        ? 'public, max-age=31536000, immutable'
        : 'public, max-age=3600'
    const mimeType =
      STATIC_MIME_TYPES[extname(staticPath).toLowerCase()] ?? 'application/octet-stream'

    res.writeHead(
      200,
      buildResponseHeaders({
        'Cache-Control': cacheControl,
        'Content-Length': stats.size,
        'Content-Type': mimeType,
      })
    )
    if (req.method === 'HEAD') return res.end()

    const stream = createReadStream(staticPath)
    stream.on('error', (error) => {
      console.error('[data-server] Static file error:', error.message)
      if (!res.headersSent) sendError(res, 'Unable to read static file', 500)
      else res.destroy(error)
    })
    return stream.pipe(res)
  }

  // ── Request Handlers ────────────────────────────────────────────────────────

  async function handleDbQuery(req, res) {
    const body = await readBody(req)
    const sql = convertParams(body.sql || '')
    const params = body.params || []
    return databaseSession.query(req, res, sql, params, body.transactionId, (rows) =>
      sendJson(res, rows)
    )
  }

  async function handleDbExecute(req, res) {
    const body = await readBody(req)
    const sql = convertParams(body.sql || '')
    const params = body.params || []
    return databaseSession.execute(req, res, sql, params, body.transactionId, (result) =>
      sendJson(res, result)
    )
  }

  async function handleTransaction(req, res) {
    const body = await readBody(req)

    if (body.action === 'begin') {
      return sendJson(res, { transactionId: await databaseSession.beginTransaction(req, res) })
    }

    if (body.action === 'commit' || body.action === 'rollback') {
      return sendJson(res, databaseSession.closeTransaction(body.transactionId, body.action))
    }

    return sendError(res, 'Unsupported transaction action', 400)
  }

  async function handleRecurringMaterialization(req, res) {
    return databaseSession.runSynchronous(req, res, 'recurring-materialization', (db) =>
      sendJson(res, materializeRecurringBatch(db))
    )
  }

  function handleStoreGetAll(res) {
    return sendJson(res, loadSettings())
  }

  function handleStoreGetKey(res, storeKeyMatch) {
    const key = decodeURIComponent(storeKeyMatch[1])
    const settings = loadSettings()
    return sendJson(res, { value: settings[key] ?? null })
  }

  async function handleStorePutKey(req, res, storeKeyMatch) {
    const key = decodeURIComponent(storeKeyMatch[1])
    const body = await readBody(req)
    const settings = loadSettings()
    settings[key] = body.value
    saveSettings(settings)
    return sendJson(res, { ok: true })
  }

  function handleFsAppData(res) {
    return sendJson(res, { path: DATA_DIR })
  }

  function handleFsJoin(res, url) {
    const parts = url.searchParams.getAll('parts')
    if (parts.length === 0) {
      return sendError(res, 'Missing parts parameter', 400)
    }
    return sendJson(res, { path: join(...parts) })
  }

  function handleFsRead(res, url) {
    const filePath = url.searchParams.get('path')
    if (!filePath) return sendError(res, 'Missing path parameter', 400)
    const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
    if (!existsSync(safe)) return sendError(res, 'File not found', 404)
    const content = readFileSync(safe, 'utf-8')
    return sendJson(res, { content })
  }

  async function handleFsWrite(req, res) {
    const body = await readBody(req)
    if (!body.path) return sendError(res, 'Missing path', 400)
    const safe = safePathNoSymlinks(DATA_DIR, body.path, { allowMissing: true })
    // Ensure parent directory exists
    const parentDir = resolve(safe, '..')
    safePathNoSymlinks(DATA_DIR, parentDir, { allowMissing: true })
    ensurePrivateDirectory(parentDir)
    safePathNoSymlinks(DATA_DIR, parentDir)
    safePathNoSymlinks(DATA_DIR, safe, { allowMissing: true })
    writeFileSync(safe, body.content || '', { encoding: 'utf-8', mode: PRIVATE_FILE_MODE })
    hardenPathMode(safe, PRIVATE_FILE_MODE)
    safePathNoSymlinks(DATA_DIR, safe)
    return sendJson(res, { ok: true })
  }

  function handleFsExists(res, url) {
    const filePath = url.searchParams.get('path')
    if (!filePath) return sendError(res, 'Missing path parameter', 400)
    const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
    return sendJson(res, { exists: existsSync(safe) })
  }

  function handleFsRemove(res, url) {
    const filePath = url.searchParams.get('path')
    if (!filePath) return sendError(res, 'Missing path parameter', 400)
    const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
    if (existsSync(safe)) unlinkSync(safe)
    return sendJson(res, { ok: true })
  }

  function handleFsReadDirectory(res, url) {
    const dirPath = url.searchParams.get('path')
    if (!dirPath) return sendError(res, 'Missing path parameter', 400)
    const safe = safePathNoSymlinks(DATA_DIR, dirPath, { allowMissing: true })
    if (!existsSync(safe)) return sendJson(res, { entries: [] })
    const entries = readdirSync(safe).map((name) => {
      const fullPath = join(safe, name)
      let isDirectory = false
      try {
        isDirectory = lstatSync(fullPath).isDirectory()
      } catch {
        /* ignore */
      }
      return { name, isDirectory }
    })
    return sendJson(res, { entries })
  }

  async function handleFsMakeDirectory(req, res) {
    const body = await readBody(req)
    if (!body.path) return sendError(res, 'Missing path', 400)
    const safe = safePathNoSymlinks(DATA_DIR, body.path, { allowMissing: true })
    mkdirSync(safe, { recursive: body.recursive !== false, mode: PRIVATE_DIR_MODE })
    ensurePrivateDirectory(safe)
    safePathNoSymlinks(DATA_DIR, safe)
    return sendJson(res, { ok: true })
  }

  async function handleRuntimeDiagnostics(req, res) {
    return databaseSession.runSynchronous(req, res, 'runtime-diagnostics', (db) => {
      const migration = db
        .prepare('SELECT id, name FROM _migrations ORDER BY id DESC LIMIT 1')
        .get()
      const state = db
        .prepare(
          'SELECT database_id, data_revision, last_financial_write_at FROM app_data_state WHERE id = 1'
        )
        .get()
      if (!migration || !state) {
        throw new Error('Runtime diagnostics metadata is unavailable.')
      }

      return sendJson(res, {
        success: true,
        build: HOSTED_MODE ? 'hosted-web' : 'browser-development',
        version: APPLICATION_VERSION,
        schemaVersion: migration.id,
        schemaMigration: migration.name,
        databaseLineageId: state.database_id,
        localInstance: readRuntimeIdentity(DATA_DIR),
        dataRevision: state.data_revision,
        lastFinancialWriteAt: state.last_financial_write_at,
      })
    })
  }

  async function handleDbExport(req, res) {
    return databaseSession.exportSnapshot(req, res, (bytes) => {
      res.writeHead(
        200,
        buildResponseHeaders({
          'Content-Type': 'application/octet-stream',
          'Content-Length': bytes.length,
          'Content-Disposition': 'attachment; filename="shikin.db"',
        })
      )
      res.end(HOSTED_MODE && res.req?.method === 'HEAD' ? undefined : bytes)
    })
  }

  async function handleDbImport(req, res) {
    if (HOSTED_MODE) {
      return sendError(
        res,
        'Database import and restore are unavailable while hosted access is running. Stop hosted access and use the desktop app.',
        409
      )
    }

    databaseSession.assertCanImport()
    const buffer = await readBuffer(req, {
      maxBytes: MAX_DB_IMPORT_BYTES,
      label: 'Database import payload',
    })

    // Validate: SQLite files start with "SQLite format 3\0"
    const header = buffer.slice(0, 16).toString('ascii')
    if (!header.startsWith('SQLite format 3')) {
      return sendError(res, 'Invalid SQLite database file', 400)
    }

    return databaseSession.importSnapshot(req, res, buffer, (result) => sendJson(res, result))
  }

  function dispatchRequest(req, res, url, path) {
    const requestMethod = HOSTED_MODE && req.method === 'HEAD' ? 'GET' : req.method
    const route = `${requestMethod} ${path}`

    switch (route) {
      // ── Database: Query ────────────────────────────────────────────
      case 'POST /api/db/query':
        return handleDbQuery(req, res)

      // ── Database: Execute ──────────────────────────────────────────
      case 'POST /api/db/execute':
        return handleDbExecute(req, res)

      // ── Database: Transaction lifecycle ───────────────────────────
      case 'POST /api/db/transaction':
        return handleTransaction(req, res)

      // ── Recurring: Materialize server-side atomically ───────────────
      case 'POST /api/recurring/materialize':
        return handleRecurringMaterialization(req, res)

      // ── Store: Get all ─────────────────────────────────────────────
      case 'GET /api/store':
        return handleStoreGetAll(res)
    }

    const storeKeyMatch = path.match(/^\/api\/store\/(.+)$/)
    if (storeKeyMatch) {
      if (req.method === 'GET') {
        return handleStoreGetKey(res, storeKeyMatch)
      }

      if (req.method === 'PUT') {
        return handleStorePutKey(req, res, storeKeyMatch)
      }
    }

    switch (route) {
      // ── Runtime diagnostics (read-only, no public paths) ───────────
      case 'GET /api/runtime/diagnostics':
        return handleRuntimeDiagnostics(req, res)

      // ── FS: App data path ──────────────────────────────────────────
      case 'GET /api/fs/appdata':
        return handleFsAppData(res)

      // ── FS: Join paths ─────────────────────────────────────────────
      case 'GET /api/fs/join':
        return handleFsJoin(res, url)

      // ── FS: Read file ──────────────────────────────────────────────
      case 'GET /api/fs/read':
        return handleFsRead(res, url)

      // ── FS: Write file ─────────────────────────────────────────────
      case 'PUT /api/fs/write':
        return handleFsWrite(req, res)

      // ── FS: Check exists ───────────────────────────────────────────
      case 'GET /api/fs/exists':
        return handleFsExists(res, url)

      // ── FS: Remove file ────────────────────────────────────────────
      case 'DELETE /api/fs/remove':
        return handleFsRemove(res, url)

      // ── FS: Read directory ─────────────────────────────────────────
      case 'GET /api/fs/readdir':
        return handleFsReadDirectory(res, url)

      // ── FS: Make directory ─────────────────────────────────────────
      case 'POST /api/fs/mkdir':
        return handleFsMakeDirectory(req, res)

      // ── DB: Export (binary) ────────────────────────────────────────
      case 'GET /api/db/export':
        return handleDbExport(req, res)

      // ── DB: Import (binary) ────────────────────────────────────────
      case 'POST /api/db/import':
        return handleDbImport(req, res)
    }

    // ── 404 ──────────────────────────────────────────────────────────
    return sendError(res, 'Not found', 404)
  }

  // ── Server ─────────────────────────────────────────────────────────────────

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const path = url.pathname
    const isApiRequest = path === '/api' || path.startsWith('/api/')

    if (!HOSTED_MODE && req.method === 'OPTIONS') {
      const preflightError = validateBridgePreflight(req)
      if (preflightError) return sendForbidden(res, preflightError)

      res.writeHead(204, buildBridgeCorsHeaders())
      return res.end()
    }

    if (HOSTED_MODE && isApiRequest) {
      const hostedRequestError = validateHostedRequest(req)
      if (hostedRequestError) return sendForbidden(res, hostedRequestError)
    }

    if (!HOSTED_MODE) {
      const bridgeError = validateBridgeRequest(req)
      if (bridgeError) return sendForbidden(res, bridgeError)
    }

    if (HOSTED_MODE && !isApiRequest) {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const rawPath = String(req.url || '/').split(/[?#]/, 1)[0] || '/'
        return serveStaticFile(req, res, rawPath)
      }
      return sendError(res, 'Not found', 404)
    }

    try {
      await dispatchRequest(req, res, url, path)
    } catch (err) {
      console.error('[data-server] Error:', err.message)
      if (!res.destroyed && !res.writableEnded) {
        sendError(res, err.message, err.statusCode || 500)
      }
    }
  })

  const shutdown = (signal) => databaseSession.shutdown(signal, server, releaseHostedProcessMarker)

  process.once('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[data-server] Listening on http://127.0.0.1:${PORT}`)
    console.log(`[data-server] Data directory: ${DATA_DIR}`)
    if (HOSTED_MODE) {
      console.log(`tailscale serve --bg http://127.0.0.1:${PORT}`)
      console.log('Stop hosted access with: tailscale serve reset')
    }
  })

  return { server, shutdown }
}
