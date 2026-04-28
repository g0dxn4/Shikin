import { isTauri, DATA_SERVER_URL, withDataServerHeaders } from '@/lib/runtime'

// ── Types ──────────────────────────────────────────────────────────────────

type TauriDatabase = {
  select<T>(sql: string, params?: unknown[]): Promise<T>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>
  close(): Promise<void>
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

// ── Tauri Backend ──────────────────────────────────────────────────────────

async function getTauriDb(): Promise<TauriDatabase> {
  if (tauriDb) return tauriDb
  if (!tauriInitPromise) {
    tauriInitPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql')
      const database = await Database.load('sqlite:shikin.db')
      tauriDb = database as unknown as TauriDatabase
      await runTauriMigrations(tauriDb)
      return tauriDb
    })()
  }
  return tauriInitPromise
}

// ── Migrations (Tauri mode) ────────────────────────────────────────────────
// Migrations 001-003 are handled by tauri-plugin-sql in lib.rs.
// Migrations 004+ must be run from JS since they're not in the Rust code.

async function runTauriMigrations(db: TauriDatabase): Promise<void> {
  // Ensure _migrations table exists (created by earlier JS code or first run)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const rows = await db.select<{ name: string }[]>('SELECT name FROM _migrations')
  const applied = new Set(rows.map((r) => r.name))

  // Migration 001-003 are applied by the Rust plugin, but may not be in _migrations table.
  // Mark them as applied if the tables already exist to keep tracking consistent.
  if (!applied.has('001_core_tables')) {
    // Check if core tables exist (the Rust side creates them)
    const tables = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'"
    )
    if (tables.length > 0) {
      await db.execute("INSERT OR IGNORE INTO _migrations (id, name) VALUES (1, '001_core_tables')")
      applied.add('001_core_tables')
    }
  }
  if (!applied.has('003_credit_cards')) {
    // Credit cards migration adds columns, not tables. Mark as done if accounts exists
    // (the Rust side handles it)
    await db.execute("INSERT OR IGNORE INTO _migrations (id, name) VALUES (3, '003_credit_cards')")
    applied.add('003_credit_cards')
  }

  // Seed categories if 001 was just marked (Rust migrations don't seed)
  // Use OR IGNORE so it's safe to run multiple times
  if (applied.has('001_core_tables')) {
    await db.execute(`
      INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES
        ('01FOOD000000000000000000000', 'Food & Dining', 'utensils', '#f97316', 'expense', 1)
    `)
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01TRANSPORT0000000000000000', 'Transportation', 'car', '#3b82f6', 'expense', 2)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01HOUSING00000000000000000', 'Housing', 'home', '#8b5cf6', 'expense', 3)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01ENTERTAIN000000000000000', 'Entertainment', 'tv', '#ec4899', 'expense', 4)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01HEALTH000000000000000000', 'Health', 'heart-pulse', '#ef4444', 'expense', 5)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SHOPPING0000000000000000', 'Shopping', 'shopping-bag', '#f59e0b', 'expense', 6)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01EDUCATION000000000000000', 'Education', 'graduation-cap', '#06b6d4', 'expense', 7)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01UTILITIES000000000000000', 'Utilities', 'zap', '#64748b', 'expense', 8)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SUBSCRIPT000000000000000', 'Subscriptions', 'repeat', '#a855f7', 'expense', 9)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01OTHER0000000000000000000', 'Other Expenses', 'more-horizontal', '#6b7280', 'expense', 10)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SALARY000000000000000000', 'Salary', 'banknote', '#22c55e', 'income', 11)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01FREELANCE000000000000000', 'Freelance', 'briefcase', '#10b981', 'income', 12)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01INVESTINC000000000000000', 'Investment Income', 'trending-up', '#14b8a6', 'income', 13)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01OTHERINC0000000000000000', 'Other Income', 'plus-circle', '#059669', 'income', 14)`
    )
    await db.execute(
      `INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01TRANSFER0000000000000000', 'Transfer', 'arrow-right-left', '#6366f1', 'transfer', 15)`
    )
  }

  // --- Migration 004: Category Rules ---
  if (!applied.has('004_category_rules')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS category_rules (
        id TEXT PRIMARY KEY,
        pattern TEXT NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
        confidence REAL NOT NULL DEFAULT 1.0,
        hit_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_category_rules_pattern_category ON category_rules(pattern, category_id)`
    )
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern)`
    )
    await db.execute("INSERT INTO _migrations (id, name) VALUES (4, '004_category_rules')")
  }

  // --- Migration 005: Recurring Rules ---
  if (!applied.has('005_recurring_rules')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS recurring_rules (
        id TEXT PRIMARY KEY,
        description TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
        frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
        next_date TEXT NOT NULL,
        end_date TEXT,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        to_account_id TEXT REFERENCES accounts(id),
        category_id TEXT REFERENCES categories(id),
        subcategory_id TEXT REFERENCES subcategories(id),
        tags TEXT DEFAULT '',
        notes TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_date ON recurring_rules(next_date)`
    )
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_recurring_rules_active ON recurring_rules(active)`
    )
    await db.execute("INSERT INTO _migrations (id, name) VALUES (5, '005_recurring_rules')")
  }

  // --- Migration 006: Goals ---
  if (!applied.has('006_goals')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_amount INTEGER NOT NULL,
        current_amount INTEGER NOT NULL DEFAULT 0,
        deadline TEXT,
        account_id TEXT REFERENCES accounts(id),
        icon TEXT DEFAULT '🎯',
        color TEXT DEFAULT '#bf5af2',
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_goals_deadline ON goals(deadline)`)
    await db.execute("INSERT INTO _migrations (id, name) VALUES (6, '006_goals')")
  }

  // --- Migration 007: Recaps ---
  if (!applied.has('007_recaps')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS recaps (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly')),
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        highlights_json TEXT NOT NULL DEFAULT '[]',
        generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_recaps_type ON recaps(type)`)
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_recaps_generated ON recaps(generated_at)`)
    await db.execute("INSERT INTO _migrations (id, name) VALUES (7, '007_recaps')")
  }

  // --- Migration 010: Transaction Splits ---
  if (!applied.has('010_transaction_splits')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS transaction_splits (
        id TEXT PRIMARY KEY,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES categories(id),
        subcategory_id TEXT REFERENCES subcategories(id),
        amount INTEGER NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction ON transaction_splits(transaction_id)`
    )
    await db.execute("INSERT INTO _migrations (id, name) VALUES (10, '010_transaction_splits')")
  }

  // --- Migration 011: Net Worth Snapshots ---
  if (!applied.has('011_net_worth_snapshots')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS net_worth_snapshots (
        id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        total_assets INTEGER NOT NULL DEFAULT 0,
        total_liabilities INTEGER NOT NULL DEFAULT 0,
        net_worth INTEGER NOT NULL DEFAULT 0,
        total_investments INTEGER NOT NULL DEFAULT 0,
        breakdown_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_net_worth_snapshots_date ON net_worth_snapshots(date)`
    )
    await db.execute("INSERT INTO _migrations (id, name) VALUES (11, '011_net_worth_snapshots')")
  }

  // --- Migration 012: Account Balance History ---
  if (!applied.has('012_account_balance_history')) {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS account_balance_history (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        balance INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      )
    `)
    await db.execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_balance_date ON account_balance_history(account_id, date)`
    )
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_account_balance_account ON account_balance_history(account_id)`
    )
    await db.execute(
      "INSERT INTO _migrations (id, name) VALUES (12, '012_account_balance_history')"
    )
  }

  // --- Migration 013: Recurring Rules Currency ---
  if (!applied.has('013_recurring_rules_currency')) {
    const recurringRuleColumns = await db.select<{ name: string }[]>(
      'PRAGMA table_info(recurring_rules)'
    )
    const hasCurrencyColumn = recurringRuleColumns.some((column) => column.name === 'currency')

    if (!hasCurrencyColumn) {
      await db.execute(`ALTER TABLE recurring_rules ADD COLUMN currency TEXT`)
    }

    // Pragmatic upgrade backfill for pre-013 rules so existing users keep functioning.
    // Policy: keep backfill best-effort, then surface any unsafe legacy rows through
    // runtime guards and CLI diagnose --deep observability.
    await db.execute(`
      UPDATE recurring_rules
      SET currency = (
        SELECT a.currency
        FROM accounts a
        WHERE a.id = recurring_rules.account_id
      )
      WHERE (currency IS NULL OR TRIM(currency) = '') AND account_id IS NOT NULL
    `)
    await db.execute(
      "INSERT INTO _migrations (id, name) VALUES (13, '013_recurring_rules_currency')"
    )
  }

  // --- Migration 014: Recurring Rules Currency Backfill Repair ---
  // Maintains pragmatic backfill behavior; unresolved rows remain observable in diagnose.
  if (!applied.has('014_recurring_rules_currency_backfill')) {
    await db.execute(`
      UPDATE recurring_rules
      SET currency = (
        SELECT a.currency
        FROM accounts a
        WHERE a.id = recurring_rules.account_id
      )
      WHERE (currency IS NULL OR TRIM(currency) = '') AND account_id IS NOT NULL
    `)
    await db.execute(
      "INSERT INTO _migrations (id, name) VALUES (14, '014_recurring_rules_currency_backfill')"
    )
  }

  // --- Migration 015: Primary Account ---
  if (!applied.has('015_primary_account')) {
    const accountColumns = await db.select<{ name: string }[]>('PRAGMA table_info(accounts)')
    const hasPrimaryColumn = accountColumns.some((column) => column.name === 'is_primary')

    if (!hasPrimaryColumn) {
      await db.execute(`ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`)
    }

    await db.execute("INSERT INTO _migrations (id, name) VALUES (15, '015_primary_account')")
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
    const database = await getTauriDb()
    await database.execute('BEGIN')

    const tx: TransactionClient = {
      query: <T>(sql: string, bindValues?: unknown[]) =>
        database.select<T[]>(sql, bindValues || []),
      execute: (sql: string, bindValues?: unknown[]) => database.execute(sql, bindValues || []),
    }

    try {
      const result = await fn(tx)
      await database.execute('COMMIT')
      return result
    } catch (error) {
      await database.execute('ROLLBACK')
      throw error
    }
  }

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
}

// ── Public API ─────────────────────────────────────────────────────────────
// These signatures are consumed by 74+ files — do NOT change them.

export async function getDb(): Promise<TauriDatabase> {
  if (isTauri) {
    return getTauriDb()
  }
  // In browser mode, return a shim that delegates to the HTTP API.
  // getDb() is only used internally, but we expose it for compatibility.
  await verifyBrowserServer()
  return {
    select: async <T>(sql: string, params?: unknown[]): Promise<T> => {
      return browserQuery<T>(sql, params || []) as Promise<T>
    },
    execute: async (sql: string, params?: unknown[]) => {
      return browserExecute(sql, params || [])
    },
    close: async () => {
      // No-op for browser mode
    },
  }
}

export async function query<T>(sql: string, bindValues?: unknown[]): Promise<T[]> {
  if (isTauri) {
    const database = await getTauriDb()
    return database.select<T[]>(sql, bindValues || [])
  }
  return browserQuery<T>(sql, bindValues || [])
}

export async function execute(
  sql: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  if (isTauri) {
    const database = await getTauriDb()
    return database.execute(sql, bindValues || [])
  }
  return browserExecute(sql, bindValues || [])
}

export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (!isTauri) {
    throw new Error(
      'runInTransaction() is only supported in Tauri mode. Use withTransaction() for generic browser transaction flows, or a dedicated server endpoint for domain-specific browser workflows.'
    )
  }

  const database = await getTauriDb()
  await database.execute('BEGIN')
  try {
    const result = await fn()
    await database.execute('COMMIT')
    return result
  } catch (error) {
    await database.execute('ROLLBACK')
    throw error
  }
}

export async function materializeRecurringTransactionsBrowser(): Promise<{
  success: true
  created: number
  message: string
}> {
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
}

// ── Import / Export ────────────────────────────────────────────────────────

export async function exportDatabaseSnapshot(): Promise<Uint8Array> {
  if (isTauri) {
    // In Tauri mode, read the DB file directly via the filesystem plugin
    // Use Function() dynamic import to avoid bundler/TS issues with optional Tauri deps
    const pathMod = await (Function('return import("@tauri-apps/api/path")')() as Promise<{
      appDataDir: () => Promise<string>
      join: (...paths: string[]) => Promise<string>
    }>)
    const fsMod = await (Function('return import("@tauri-apps/plugin-fs")')() as Promise<{
      readFile: (path: string) => Promise<Uint8Array>
    }>)
    const dbPath = await pathMod.join(await pathMod.appDataDir(), 'shikin.db')
    return await fsMod.readFile(dbPath)
  }

  // Browser mode: fetch raw binary from data server
  const res = await fetch(`${DATA_SERVER_URL}/api/db/export`, {
    headers: withDataServerHeaders(),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Export failed (${res.status}): ${text}`)
  }
  const buffer = await res.arrayBuffer()
  return new Uint8Array(buffer)
}

export async function importDatabaseSnapshot(data: Uint8Array): Promise<void> {
  if (isTauri) {
    // In Tauri mode, close DB connection, write file, then reload
    if (tauriDb) {
      await tauriDb.close()
      tauriDb = null
      tauriInitPromise = null
    }
    const pathMod = await (Function('return import("@tauri-apps/api/path")')() as Promise<{
      appDataDir: () => Promise<string>
      join: (...paths: string[]) => Promise<string>
    }>)
    const fsMod = await (Function('return import("@tauri-apps/plugin-fs")')() as Promise<{
      writeFile: (path: string, data: Uint8Array) => Promise<void>
    }>)
    const dbPath = await pathMod.join(await pathMod.appDataDir(), 'shikin.db')
    await fsMod.writeFile(dbPath, data)
    return
  }

  // Browser mode: POST binary to data server
  const res = await fetch(`${DATA_SERVER_URL}/api/db/import`, {
    method: 'POST',
    headers: withDataServerHeaders({ 'Content-Type': 'application/octet-stream' }),
    body: data,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Import failed (${res.status}): ${text}`)
  }
}
