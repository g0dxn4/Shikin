import { isTauri, DATA_SERVER_URL } from '@/lib/runtime'

// ── Types ──────────────────────────────────────────────────────────────────

type TauriDatabase = {
  select<T>(sql: string, params?: unknown[]): Promise<T>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>
  close(): Promise<void>
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
      const database = await Database.load('sqlite:valute.db')
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
  if (!applied.has('002_ai_memories')) {
    const tables = await db.select<{ name: string }[]>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='ai_memories'"
    )
    if (tables.length > 0) {
      await db.execute("INSERT OR IGNORE INTO _migrations (id, name) VALUES (2, '002_ai_memories')")
      applied.add('002_ai_memories')
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
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01TRANSPORT0000000000000000', 'Transportation', 'car', '#3b82f6', 'expense', 2)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01HOUSING00000000000000000', 'Housing', 'home', '#8b5cf6', 'expense', 3)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01ENTERTAIN000000000000000', 'Entertainment', 'tv', '#ec4899', 'expense', 4)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01HEALTH000000000000000000', 'Health', 'heart-pulse', '#ef4444', 'expense', 5)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SHOPPING0000000000000000', 'Shopping', 'shopping-bag', '#f59e0b', 'expense', 6)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01EDUCATION000000000000000', 'Education', 'graduation-cap', '#06b6d4', 'expense', 7)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01UTILITIES000000000000000', 'Utilities', 'zap', '#64748b', 'expense', 8)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SUBSCRIPT000000000000000', 'Subscriptions', 'repeat', '#a855f7', 'expense', 9)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01OTHER0000000000000000000', 'Other Expenses', 'more-horizontal', '#6b7280', 'expense', 10)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01SALARY000000000000000000', 'Salary', 'banknote', '#22c55e', 'income', 11)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01FREELANCE000000000000000', 'Freelance', 'briefcase', '#10b981', 'income', 12)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01INVESTINC000000000000000', 'Investment Income', 'trending-up', '#14b8a6', 'income', 13)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01OTHERINC0000000000000000', 'Other Income', 'plus-circle', '#059669', 'income', 14)`)
    await db.execute(`INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES ('01TRANSFER0000000000000000', 'Transfer', 'arrow-right-left', '#6366f1', 'transfer', 15)`)
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

  // --- Migration 008: AI Memories FTS5 ---
  if (!applied.has('008_ai_memories_fts')) {
    try {
      await db.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS ai_memories_fts USING fts5(content, content=ai_memories, content_rowid=rowid)
      `)
      await db.execute(`INSERT INTO ai_memories_fts(ai_memories_fts) VALUES('rebuild')`)
      await db.execute(`
        CREATE TRIGGER IF NOT EXISTS ai_memories_ai AFTER INSERT ON ai_memories BEGIN
          INSERT INTO ai_memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END
      `)
      await db.execute(`
        CREATE TRIGGER IF NOT EXISTS ai_memories_ad AFTER DELETE ON ai_memories BEGIN
          INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        END
      `)
      await db.execute(`
        CREATE TRIGGER IF NOT EXISTS ai_memories_au AFTER UPDATE ON ai_memories BEGIN
          INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
          INSERT INTO ai_memories_fts(rowid, content) VALUES (new.rowid, new.content);
        END
      `)
      await db.execute("INSERT INTO _migrations (id, name) VALUES (8, '008_ai_memories_fts')")
    } catch (err) {
      console.warn('[database] FTS5 migration failed (may not be supported):', err)
    }
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
}

// ── Browser Backend ────────────────────────────────────────────────────────

async function browserFetch<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${DATA_SERVER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (err) {
    throw new Error(
      `Cannot reach data server at ${DATA_SERVER_URL}. ` +
        `Make sure it is running (npm run data-server). ` +
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
      sql: "SELECT 1 AS ok",
      params: [],
    })
  } catch (err) {
    throw new Error(
      `Data server health check failed. ` +
        `Ensure the data server is running: npm run data-server\n` +
        `${err instanceof Error ? err.message : err}`
    )
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
      return browserFetch<T>('/api/db/query', { sql, params: params || [] })
    },
    execute: async (sql: string, params?: unknown[]) => {
      return browserFetch<{ rowsAffected: number; lastInsertId: number }>('/api/db/execute', {
        sql,
        params: params || [],
      })
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
  return browserFetch<T[]>('/api/db/query', { sql, params: bindValues || [] })
}

export async function execute(
  sql: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  if (isTauri) {
    const database = await getTauriDb()
    return database.execute(sql, bindValues || [])
  }
  return browserFetch<{ rowsAffected: number; lastInsertId: number }>('/api/db/execute', {
    sql,
    params: bindValues || [],
  })
}

export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  if (isTauri) {
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

  // Browser mode: the data server uses better-sqlite3 which is synchronous
  // and single-threaded, so we just execute the statements sequentially.
  // Wrap in BEGIN/COMMIT for atomicity on the server side.
  await browserFetch('/api/db/execute', { sql: 'BEGIN', params: [] })
  try {
    const result = await fn()
    await browserFetch('/api/db/execute', { sql: 'COMMIT', params: [] })
    return result
  } catch (error) {
    await browserFetch('/api/db/execute', { sql: 'ROLLBACK', params: [] })
    throw error
  }
}

// ── Import / Export ────────────────────────────────────────────────────────
// TODO: Phase 3 — implement proper import/export for both backends.
// For now these are stubbed to throw a clear error in browser mode,
// and use a query-based approach in Tauri mode.

export async function exportDatabaseSnapshot(): Promise<Uint8Array> {
  if (!isTauri) {
    throw new Error(
      'Database export is not yet supported in browser mode. ' +
        'Use the Tauri desktop app to export your database.'
    )
  }
  // In Tauri mode, we can't easily get a raw binary dump through plugin-sql.
  // For now, throw with guidance. A future phase can use a Tauri command.
  throw new Error(
    'Database export in Tauri mode requires a dedicated Tauri command. ' +
      'This will be implemented in a future phase.'
  )
}

export async function importDatabaseSnapshot(_data: Uint8Array): Promise<void> {
  if (!isTauri) {
    throw new Error(
      'Database import is not yet supported in browser mode. ' +
        'Use the Tauri desktop app to import your database.'
    )
  }
  throw new Error(
    'Database import in Tauri mode requires a dedicated Tauri command. ' +
      'This will be implemented in a future phase.'
  )
}
