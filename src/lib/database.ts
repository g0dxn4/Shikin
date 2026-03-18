import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js'

const DB_NAME = 'valute'
const IDB_STORE = 'databases'
const IDB_KEY = 'valute.db'

let db: SqlJsDatabase | null = null
let initPromise: Promise<SqlJsDatabase> | null = null

// --- IndexedDB persistence helpers ---

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadFromIDB(): Promise<Uint8Array | null> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly')
    const store = tx.objectStore(IDB_STORE)
    const req = store.get(IDB_KEY)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => idb.close()
  })
}

async function saveToIDB(data: Uint8Array): Promise<void> {
  const idb = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite')
    const store = tx.objectStore(IDB_STORE)
    store.put(data, IDB_KEY)
    tx.oncomplete = () => {
      idb.close()
      resolve()
    }
    tx.onerror = () => {
      idb.close()
      reject(tx.error)
    }
  })
}

async function persist(): Promise<void> {
  if (!db) return
  const data = db.export()
  await saveToIDB(data)
}

// --- Migrations ---

const MIGRATION_001 = `
-- Valute Migration 001: Core Tables
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other')),
  currency TEXT NOT NULL DEFAULT 'USD',
  balance INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  color TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  icon TEXT,
  color TEXT,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(category_id, name)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  description TEXT NOT NULL,
  notes TEXT,
  date TEXT NOT NULL,
  tags TEXT DEFAULT '[]',
  is_recurring INTEGER NOT NULL DEFAULT 0,
  transfer_to_account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_cycle TEXT NOT NULL CHECK (billing_cycle IN ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_billing_date TEXT NOT NULL,
  icon TEXT,
  color TEXT,
  url TEXT,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  period TEXT NOT NULL CHECK (period IN ('weekly', 'monthly', 'yearly')),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS budget_periods (
  id TEXT PRIMARY KEY,
  budget_id TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  spent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS investments (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other')),
  shares REAL NOT NULL DEFAULT 0,
  avg_cost_basis INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS stock_prices (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(symbol, date)
);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New Conversation',
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  tool_calls TEXT,
  tool_result TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  id TEXT PRIMARY KEY,
  from_currency TEXT NOT NULL,
  to_currency TEXT NOT NULL,
  rate REAL NOT NULL,
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(from_currency, to_currency, date)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS extension_data (
  id TEXT PRIMARY KEY,
  extension_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(extension_id, key)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_subcategories_category ON subcategories(category_id);
CREATE INDEX IF NOT EXISTS idx_budget_periods_budget ON budget_periods(budget_id);
CREATE INDEX IF NOT EXISTS idx_investments_account ON investments(account_id);
CREATE INDEX IF NOT EXISTS idx_investments_symbol ON investments(symbol);
CREATE INDEX IF NOT EXISTS idx_stock_prices_symbol_date ON stock_prices(symbol, date);
CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_extension_data_extension ON extension_data(extension_id);
`

const MIGRATION_001_SEEDS = `
INSERT OR IGNORE INTO categories (id, name, icon, color, type, sort_order) VALUES
  ('01FOOD000000000000000000000', 'Food & Dining', 'utensils', '#f97316', 'expense', 1),
  ('01TRANSPORT0000000000000000', 'Transportation', 'car', '#3b82f6', 'expense', 2),
  ('01HOUSING00000000000000000', 'Housing', 'home', '#8b5cf6', 'expense', 3),
  ('01ENTERTAIN000000000000000', 'Entertainment', 'tv', '#ec4899', 'expense', 4),
  ('01HEALTH000000000000000000', 'Health', 'heart-pulse', '#ef4444', 'expense', 5),
  ('01SHOPPING0000000000000000', 'Shopping', 'shopping-bag', '#f59e0b', 'expense', 6),
  ('01EDUCATION000000000000000', 'Education', 'graduation-cap', '#06b6d4', 'expense', 7),
  ('01UTILITIES000000000000000', 'Utilities', 'zap', '#64748b', 'expense', 8),
  ('01SUBSCRIPT000000000000000', 'Subscriptions', 'repeat', '#a855f7', 'expense', 9),
  ('01OTHER0000000000000000000', 'Other Expenses', 'more-horizontal', '#6b7280', 'expense', 10),
  ('01SALARY000000000000000000', 'Salary', 'banknote', '#22c55e', 'income', 11),
  ('01FREELANCE000000000000000', 'Freelance', 'briefcase', '#10b981', 'income', 12),
  ('01INVESTINC000000000000000', 'Investment Income', 'trending-up', '#14b8a6', 'income', 13),
  ('01OTHERINC0000000000000000', 'Other Income', 'plus-circle', '#059669', 'income', 14),
  ('01TRANSFER0000000000000000', 'Transfer', 'arrow-right-left', '#6366f1', 'transfer', 15);
`

const MIGRATION_002 = `
CREATE TABLE IF NOT EXISTS ai_memories (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('preference', 'fact', 'goal', 'behavior', 'context')),
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5 CHECK (importance >= 1 AND importance <= 10),
  last_accessed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_category ON ai_memories(category);
`

// --- Parameter conversion ---
// The codebase uses two param styles:
//   - $1, $2, $3 (tauri-plugin-sql positional) used in AI tools
//   - ? (positional) used in stores
// sql.js supports both ? and $1 natively, so no conversion needed.
// However, sql.js $-params are named (dict-based), while the codebase passes arrays.
// We convert $N params to ? so sql.js can bind positionally from an array.

function convertParams(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

// --- Helpers to convert sql.js results to objects ---

function rowsToObjects<T>(stmt: ReturnType<SqlJsDatabase['prepare']>): T[] {
  const results: T[] = []
  const columns = stmt.getColumnNames()
  while (stmt.step()) {
    const values = stmt.get()
    const row: Record<string, unknown> = {}
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = values[i]
    }
    results.push(row as T)
  }
  stmt.free()
  return results
}

// --- Initialization ---

function runMigrations(database: SqlJsDatabase): void {
  // Create migrations tracking table
  database.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const applied = new Set<string>()
  const stmt = database.prepare('SELECT name FROM _migrations')
  while (stmt.step()) {
    applied.add(stmt.get()[0] as string)
  }
  stmt.free()

  if (!applied.has('001_core_tables')) {
    // sql.js doesn't support multiple statements in run() reliably,
    // so we split and execute individually
    const statements = MIGRATION_001.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const s of statements) {
      database.run(s)
    }
    // Seeds separately (multi-row INSERT)
    database.run(MIGRATION_001_SEEDS)
    database.run("INSERT INTO _migrations (id, name) VALUES (1, '001_core_tables')")
  }

  if (!applied.has('002_ai_memories')) {
    const statements = MIGRATION_002.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const s of statements) {
      database.run(s)
    }
    // ALTER TABLE for ai_conversations — add summary column if not exists
    try {
      database.run('ALTER TABLE ai_conversations ADD COLUMN summary TEXT')
    } catch {
      // Column may already exist
    }
    database.run("INSERT INTO _migrations (id, name) VALUES (2, '002_ai_memories')")
  }

  if (!applied.has('003_credit_cards')) {
    try {
      database.run('ALTER TABLE accounts ADD COLUMN credit_limit INTEGER')
    } catch {
      // Column may already exist
    }
    try {
      database.run('ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER')
    } catch {
      // Column may already exist
    }
    try {
      database.run('ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER')
    } catch {
      // Column may already exist
    }
    database.run("INSERT INTO _migrations (id, name) VALUES (3, '003_credit_cards')")
  }

  if (!applied.has('007_transaction_splits')) {
    const MIGRATION_007 = `
CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  subcategory_id TEXT REFERENCES subcategories(id),
  amount INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction ON transaction_splits(transaction_id)
`
    const statements = MIGRATION_007.split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    for (const s of statements) {
      database.run(s)
    }
    database.run("INSERT INTO _migrations (id, name) VALUES (7, '007_transaction_splits')")
  }
}

async function initDb(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  })

  // Try to load existing database from IndexedDB
  const saved = await loadFromIDB()
  const database = saved ? new SQL.Database(saved) : new SQL.Database()

  // Enable WAL mode equivalent and foreign keys
  database.run('PRAGMA foreign_keys = ON')

  // Run migrations
  runMigrations(database)

  // Persist after migrations
  await saveToIDB(database.export())

  return database
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db
  if (!initPromise) {
    initPromise = initDb().then((database) => {
      db = database
      return database
    })
  }
  return initPromise
}

export async function query<T>(sql: string, bindValues?: unknown[]): Promise<T[]> {
  const database = await getDb()
  const converted = convertParams(sql)
  const stmt = database.prepare(converted)
  if (bindValues && bindValues.length > 0) {
    stmt.bind(bindValues as (string | number | Uint8Array | null)[])
  }
  return rowsToObjects<T>(stmt)
}

export async function execute(
  sql: string,
  bindValues?: unknown[]
): Promise<{ rowsAffected: number; lastInsertId: number }> {
  const database = await getDb()
  const converted = convertParams(sql)
  database.run(converted, bindValues as (string | number | Uint8Array | null)[] | undefined)
  const rowsAffected = database.getRowsModified()
  // sql.js doesn't directly expose lastInsertId through getRowsModified,
  // so we query it separately
  const lastIdResult = database.exec('SELECT last_insert_rowid()')
  const lastInsertId =
    lastIdResult.length > 0 ? (lastIdResult[0].values[0][0] as number) : 0

  // Persist to IndexedDB after every write
  await persist()

  return { rowsAffected, lastInsertId }
}
