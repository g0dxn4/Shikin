import { isTauri, DATA_SERVER_URL, withDataServerHeaders } from '@/lib/runtime'

// ── Types ──────────────────────────────────────────────────────────────────

type TauriDatabase = {
  select<T>(sql: string, params?: unknown[]): Promise<T>
  execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }>
  close(): Promise<void>
}

type TauriFsModule = {
  exists: (path: string) => Promise<boolean>
  readFile: (path: string) => Promise<Uint8Array>
  remove: (path: string) => Promise<void>
  rename: (oldPath: string, newPath: string) => Promise<void>
  writeFile: (path: string, data: Uint8Array, options?: { mode?: number }) => Promise<void>
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

async function getTauriDbPath(): Promise<string> {
  const pathMod = await (Function('return import("@tauri-apps/api/path")')() as Promise<{
    appDataDir: () => Promise<string>
    join: (...paths: string[]) => Promise<string>
  }>)
  return pathMod.join(await pathMod.appDataDir(), 'shikin.db')
}

async function getTauriSqliteUrl(): Promise<string> {
  return `sqlite:${await getTauriDbPath()}`
}

const TAURI_CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other')),
  currency TEXT NOT NULL DEFAULT 'USD',
  balance INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  color TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0,
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
CREATE INDEX IF NOT EXISTS idx_exchange_rates_currencies ON exchange_rates(from_currency, to_currency);
CREATE INDEX IF NOT EXISTS idx_extension_data_extension ON extension_data(extension_id);
`

const REQUIRED_SHIKIN_TABLES: Record<string, readonly string[]> = {
  _migrations: ['id', 'name'],
  accounts: ['id', 'name', 'balance'],
  categories: ['id', 'name', 'type'],
  transactions: ['id', 'account_id', 'type', 'amount', 'date'],
}

const CURRENT_SHIKIN_MIGRATIONS = [
  '001_core_tables',
  '003_credit_cards',
  '004_category_rules',
  '005_recurring_rules',
  '006_goals',
  '007_recaps',
  '010_transaction_splits',
  '011_net_worth_snapshots',
  '012_account_balance_history',
  '013_recurring_rules_currency',
  '014_recurring_rules_currency_backfill',
  '015_primary_account',
] as const

const CURRENT_SHIKIN_SCHEMA: Record<string, readonly string[]> = {
  _migrations: ['id', 'name', 'applied_at'],
  accounts: [
    'id',
    'name',
    'type',
    'currency',
    'balance',
    'is_archived',
    'is_primary',
    'credit_limit',
    'statement_closing_day',
    'payment_due_day',
  ],
  categories: ['id', 'name', 'type', 'sort_order'],
  subcategories: ['id', 'category_id', 'name'],
  transactions: ['id', 'account_id', 'type', 'amount', 'date'],
  subscriptions: ['id', 'name', 'amount', 'billing_cycle', 'next_billing_date'],
  budgets: ['id', 'name', 'amount', 'period'],
  budget_periods: ['id', 'budget_id', 'start_date', 'end_date', 'spent'],
  investments: ['id', 'symbol', 'name', 'type', 'shares'],
  stock_prices: ['id', 'symbol', 'price', 'date'],
  exchange_rates: ['id', 'from_currency', 'to_currency', 'rate', 'date'],
  settings: ['key', 'value'],
  extension_data: ['id', 'extension_id', 'key', 'value'],
  category_rules: ['id', 'pattern', 'category_id'],
  recurring_rules: ['id', 'description', 'amount', 'currency', 'account_id', 'next_date'],
  goals: ['id', 'name', 'target_amount', 'current_amount'],
  recaps: ['id', 'type', 'period_start', 'period_end', 'summary'],
  transaction_splits: ['id', 'transaction_id', 'amount'],
  net_worth_snapshots: ['id', 'date', 'net_worth'],
  account_balance_history: ['id', 'account_id', 'date', 'balance'],
}

// ── Tauri Backend ──────────────────────────────────────────────────────────

async function getTauriDb(): Promise<TauriDatabase> {
  if (tauriDb) return tauriDb
  if (!tauriInitPromise) {
    tauriInitPromise = (async () => {
      const { default: Database } = await import('@tauri-apps/plugin-sql')
      const database = await Database.load(await getTauriSqliteUrl())
      tauriDb = database as unknown as TauriDatabase
      await runTauriMigrations(tauriDb)
      return tauriDb
    })()
  }
  return tauriInitPromise
}

// ── Migrations (Tauri mode) ────────────────────────────────────────────────
// Tauri runs the same guarded JS migrations as browser mode so AppData DBs can
// move between desktop, browser data-server, CLI, and MCP without SQLx history drift.

async function tableHasColumn(
  db: TauriDatabase,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${tableName})`)
  return columns.some((column) => column.name === columnName)
}

async function executeSqlBatch(db: TauriDatabase, sql: string): Promise<void> {
  for (const statement of sql
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)) {
    await db.execute(statement)
  }
}

function getFirstRowValue(row: Record<string, unknown> | undefined): unknown {
  return row ? Object.values(row)[0] : undefined
}

async function checkpointTauriWal(
  db: TauriDatabase,
  { requireComplete = false } = {}
): Promise<void> {
  const rows = await db.select<Record<string, unknown>[]>('PRAGMA wal_checkpoint(TRUNCATE)')
  const result = rows[0] ?? {}
  const busy = Number(result.busy ?? 0)
  const log = Number(result.log ?? -1)
  const checkpointed = Number(result.checkpointed ?? -1)

  if (requireComplete && (busy !== 0 || (log >= 0 && checkpointed >= 0 && checkpointed !== log))) {
    throw new Error('Could not fully checkpoint the database WAL before continuing')
  }
}

async function validateTauriImportDatabase(db: TauriDatabase): Promise<void> {
  const integrityRows = await db.select<Record<string, unknown>[]>('PRAGMA integrity_check')
  const integrityCheck = String(getFirstRowValue(integrityRows[0]) ?? '')
  if (integrityCheck !== 'ok') {
    throw new Error(
      `Imported SQLite database failed integrity check: ${integrityCheck || 'unknown'}`
    )
  }

  const tableRows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  )
  const existingTables = new Set(tableRows.map((row) => row.name))
  const missingTables = Object.keys(REQUIRED_SHIKIN_TABLES).filter(
    (tableName) => !existingTables.has(tableName)
  )
  if (missingTables.length > 0) {
    throw new Error(
      `Imported SQLite database is not a Shikin database. Missing required tables: ${missingTables.join(', ')}`
    )
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_SHIKIN_TABLES)) {
    const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${tableName})`)
    const existingColumns = new Set(columns.map((column) => column.name))
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(
        `Imported SQLite database is missing required Shikin columns on ${tableName}: ${missingColumns.join(', ')}`
      )
    }
  }

  const coreMigration = await db.select<{ name: string }[]>(
    "SELECT name FROM _migrations WHERE name = '001_core_tables' LIMIT 1"
  )
  if (coreMigration.length === 0) {
    throw new Error('Imported SQLite database is missing required Shikin migration metadata')
  }
}

async function validateTauriCurrentDatabase(db: TauriDatabase): Promise<void> {
  const tableRows = await db.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type = 'table'"
  )
  const existingTables = new Set(tableRows.map((row) => row.name))
  const missingTables = Object.keys(CURRENT_SHIKIN_SCHEMA).filter(
    (tableName) => !existingTables.has(tableName)
  )
  if (missingTables.length > 0) {
    throw new Error(`Database is missing required Shikin tables: ${missingTables.join(', ')}`)
  }

  for (const [tableName, requiredColumns] of Object.entries(CURRENT_SHIKIN_SCHEMA)) {
    const columns = await db.select<{ name: string }[]>(`PRAGMA table_info(${tableName})`)
    const existingColumns = new Set(columns.map((column) => column.name))
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(
        `Database is missing required Shikin columns on ${tableName}: ${missingColumns.join(', ')}`
      )
    }
  }

  const migrationRows = await db.select<{ name: string }[]>('SELECT name FROM _migrations')
  const appliedMigrations = new Set(migrationRows.map((row) => row.name))
  const missingMigrations = CURRENT_SHIKIN_MIGRATIONS.filter(
    (migration) => !appliedMigrations.has(migration)
  )
  if (missingMigrations.length > 0) {
    throw new Error(
      `Database is missing required Shikin migrations: ${missingMigrations.join(', ')}`
    )
  }
}

async function removeIfExists(fsMod: TauriFsModule, path: string): Promise<void> {
  if (await fsMod.exists(path)) {
    await fsMod.remove(path)
  }
}

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

  // --- Migration 001: Core Tables ---
  if (!applied.has('001_core_tables')) {
    await executeSqlBatch(db, TAURI_CORE_SCHEMA_SQL)
    await db.execute("INSERT OR IGNORE INTO _migrations (id, name) VALUES (1, '001_core_tables')")
    applied.add('001_core_tables')
  }

  // --- Migration 003: Credit Cards ---
  if (!applied.has('003_credit_cards')) {
    if (!(await tableHasColumn(db, 'accounts', 'credit_limit'))) {
      await db.execute('ALTER TABLE accounts ADD COLUMN credit_limit INTEGER')
    }
    if (!(await tableHasColumn(db, 'accounts', 'statement_closing_day'))) {
      await db.execute('ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER')
    }
    if (!(await tableHasColumn(db, 'accounts', 'payment_due_day'))) {
      await db.execute('ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER')
    }

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
    if (!(await tableHasColumn(db, 'accounts', 'is_primary'))) {
      await db.execute(`ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0`)
    }

    await db.execute("INSERT INTO _migrations (id, name) VALUES (15, '015_primary_account')")
  }

  await validateTauriCurrentDatabase(db)
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

// fallow-ignore-next-line unused-export
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
    const database = await getTauriDb()
    await checkpointTauriWal(database, { requireComplete: true })

    // In Tauri mode, read the DB file directly via the filesystem plugin
    // Use Function() dynamic import to avoid bundler/TS issues with optional Tauri deps
    const fsMod = await (Function(
      'return import("@tauri-apps/plugin-fs")'
    )() as Promise<TauriFsModule>)
    const dbPath = await getTauriDbPath()
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
    const header = new TextDecoder('ascii').decode(data.subarray(0, 16))
    if (!header.startsWith('SQLite format 3')) {
      throw new Error('Invalid SQLite database file')
    }

    const [{ default: Database }, fsMod] = await Promise.all([
      import('@tauri-apps/plugin-sql'),
      Function('return import("@tauri-apps/plugin-fs")')() as Promise<TauriFsModule>,
    ])
    const dbPath = await getTauriDbPath()
    const importStamp = `${Date.now()}`
    const tempPath = `${dbPath}.import-check-${importStamp}`
    const backupPath = `${dbPath}.backup-${importStamp}`

    await removeIfExists(fsMod, tempPath)
    await removeIfExists(fsMod, `${tempPath}-wal`)
    await removeIfExists(fsMod, `${tempPath}-shm`)
    await removeIfExists(fsMod, `${tempPath}-journal`)
    await fsMod.writeFile(tempPath, data, { mode: 0o600 })

    let tempDb: TauriDatabase | null = null
    try {
      tempDb = (await Database.load(`sqlite:${tempPath}`)) as unknown as TauriDatabase
      await validateTauriImportDatabase(tempDb)
    } finally {
      await tempDb?.close()
    }

    let backupCreated = false
    let importedDb: TauriDatabase | null = null

    try {
      let currentDb = tauriDb
      let openedCurrentDb = false
      if (!currentDb && (await fsMod.exists(dbPath))) {
        currentDb = (await Database.load(await getTauriSqliteUrl())) as unknown as TauriDatabase
        openedCurrentDb = true
      }

      if (currentDb) {
        await checkpointTauriWal(currentDb, { requireComplete: true })
        await currentDb.close()
      }
      if (openedCurrentDb || tauriDb) {
        tauriDb = null
        tauriInitPromise = null
      }

      await removeIfExists(fsMod, `${dbPath}-wal`)
      await removeIfExists(fsMod, `${dbPath}-shm`)
      await removeIfExists(fsMod, `${dbPath}-journal`)

      if (await fsMod.exists(dbPath)) {
        await fsMod.rename(dbPath, backupPath)
        backupCreated = true
      }

      await fsMod.rename(tempPath, dbPath)
      importedDb = (await Database.load(await getTauriSqliteUrl())) as unknown as TauriDatabase
      tauriDb = importedDb
      await runTauriMigrations(importedDb)
      if (backupCreated) {
        try {
          await removeIfExists(fsMod, backupPath)
        } catch (cleanupError) {
          console.warn(
            `Imported database successfully, but could not remove rollback backup: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`
          )
        }
      }
      return
    } catch (error) {
      await importedDb?.close()
      tauriDb = null
      tauriInitPromise = null

      await removeIfExists(fsMod, `${dbPath}-wal`)
      await removeIfExists(fsMod, `${dbPath}-shm`)
      await removeIfExists(fsMod, `${dbPath}-journal`)

      if (backupCreated) {
        await removeIfExists(fsMod, dbPath)
        if (await fsMod.exists(backupPath)) {
          await fsMod.rename(backupPath, dbPath)
        }
      }

      throw error
    } finally {
      await removeIfExists(fsMod, tempPath)
      await removeIfExists(fsMod, `${tempPath}-wal`)
      await removeIfExists(fsMod, `${tempPath}-shm`)
      await removeIfExists(fsMod, `${tempPath}-journal`)
    }
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
