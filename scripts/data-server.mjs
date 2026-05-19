import { createServer } from 'node:http'
import dayjs from 'dayjs'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  lstatSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { ulid } from 'ulidx'
import {
  PRIVATE_DIR_MODE,
  PRIVATE_FILE_MODE,
  ensurePrivateDirectory,
  hardenPathMode,
  prepareAppDataDir,
} from './app-data-dir.mjs'
import { checkpointWal, importDatabaseBuffer } from './data-server-db.mjs'
import {
  buildBridgeCorsHeaders,
  safePathNoSymlinks,
  validateBridgePreflight,
  validateBridgeRequest,
} from './data-server-security.mjs'

// ── Configuration ──────────────────────────────────────────────────────────

const PORT_ENV = process.env.SHIKIN_DATA_SERVER_PORT
const parsedPort = Number.parseInt(PORT_ENV || '', 10)
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1480
const DATA_DIR = prepareAppDataDir()
const DB_PATH = join(DATA_DIR, 'shikin.db')
const SETTINGS_PATH = join(DATA_DIR, 'settings.json')
const NOTEBOOK_DIR = join(DATA_DIR, 'notebook')

// Ensure directories exist
ensurePrivateDirectory(DATA_DIR)
ensurePrivateDirectory(NOTEBOOK_DIR)

// ── Database Setup ─────────────────────────────────────────────────────────

function openDatabase() {
  const database = new Database(DB_PATH)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  hardenPathMode(DB_PATH, PRIVATE_FILE_MODE)
  hardenPathMode(`${DB_PATH}-wal`, PRIVATE_FILE_MODE)
  hardenPathMode(`${DB_PATH}-shm`, PRIVATE_FILE_MODE)
  hardenPathMode(`${DB_PATH}-journal`, PRIVATE_FILE_MODE)
  return database
}

let db = openDatabase()
const TRANSACTION_TTL_MS = Number(process.env.SHIKIN_SERVER_TRANSACTION_TTL_MS || 15000)
const activeTransactions = new Map()
const closedTransactions = new Map()

// ── SQL Parameter Conversion ───────────────────────────────────────────────
// The codebase uses $1, $2, ... positional params; better-sqlite3 uses ?

function convertParams(sql) {
  return sql.replace(/\$(\d+)/g, '?')
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
  '016_cli_qol_foundation',
  '017_investment_type_cetes',
  '018_placeholder_transactions',
]

const CURRENT_SHIKIN_SCHEMA = {
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
  transactions: [
    'id',
    'account_id',
    'type',
    'amount',
    'date',
    'status',
    'source',
    'note',
    'recurring_rule_id',
    'is_placeholder',
    'placeholder_status',
    'resolved_at',
    'resolved_by_transaction_id',
    'placeholder_reason',
    'placeholder_parent_transaction_id',
  ],
  subscriptions: ['id', 'name', 'amount', 'billing_cycle', 'next_billing_date'],
  budgets: ['id', 'name', 'amount', 'period'],
  budget_periods: ['id', 'budget_id', 'start_date', 'end_date', 'spent'],
  investments: ['id', 'symbol', 'name', 'type', 'shares'],
  stock_prices: ['id', 'symbol', 'price', 'date'],
  exchange_rates: ['id', 'from_currency', 'to_currency', 'rate', 'date'],
  settings: ['key', 'value', 'updated_at'],
  extension_data: ['id', 'extension_id', 'key', 'value'],
  category_rules: ['id', 'pattern', 'category_id'],
  recurring_rules: ['id', 'description', 'amount', 'currency', 'account_id', 'next_date'],
  goals: ['id', 'name', 'target_amount', 'current_amount'],
  recaps: ['id', 'type', 'period_start', 'period_end', 'summary'],
  transaction_splits: ['id', 'transaction_id', 'amount'],
  net_worth_snapshots: ['id', 'date', 'net_worth'],
  account_balance_history: ['id', 'account_id', 'date', 'balance'],
  audit_log: [
    'id',
    'entity',
    'entity_id',
    'action',
    'before_json',
    'after_json',
    'source',
    'note',
    'created_at',
  ],
  cashflow_buckets: [
    'id',
    'name',
    'description',
    'target_amount',
    'balance',
    'currency',
    'sort_order',
    'is_active',
    'created_at',
    'updated_at',
  ],
  cashflow_bucket_allocations: [
    'id',
    'bucket_id',
    'transaction_id',
    'amount',
    'currency',
    'allocation_date',
    'source',
    'note',
    'created_at',
  ],
  category_suggestions: [
    'id',
    'transaction_id',
    'description',
    'suggested_category_id',
    'suggested_subcategory_id',
    'confidence',
    'status',
    'source',
    'note',
    'created_at',
    'reviewed_at',
  ],
  credit_card_statements: [
    'id',
    'account_id',
    'statement_start_date',
    'statement_end_date',
    'due_date',
    'statement_balance',
    'minimum_payment',
    'paid_amount',
    'currency',
    'status',
    'source',
    'note',
    'created_at',
    'updated_at',
  ],
}

function tableHasColumn(database, tableName, columnName) {
  return database.pragma(`table_info(${tableName})`).some((column) => column.name === columnName)
}

function ensureTableColumn(database, tableName, columnName, definition) {
  if (!tableHasColumn(database, tableName, columnName)) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`)
  }
}

function normalizeSqlDefinition(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function normalizeTransactionStatusDefault(value) {
  let normalized = normalizeSqlDefinition(value)
  while (normalized.startsWith('(') && normalized.endsWith(')')) {
    normalized = normalized.slice(1, -1).trim()
  }
  return normalized.replace(/^['"]|['"]$/g, '')
}

function investmentTypeCheckIncludesCetes(database) {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'investments' LIMIT 1")
    .get()
  return normalizeSqlDefinition(row?.sql).includes("'cetes'")
}

function widenInvestmentTypeCheckForCetes(database) {
  if (investmentTypeCheckIncludesCetes(database)) return

  database.pragma('foreign_keys = OFF')
  try {
    const migrate = database.transaction(() => {
      database.exec(`
        DROP TABLE IF EXISTS __investments_cetes_migration;
        CREATE TABLE __investments_cetes_migration (
          id TEXT PRIMARY KEY,
          account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
          symbol TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'cetes', 'other')),
          shares REAL NOT NULL DEFAULT 0,
          avg_cost_basis INTEGER NOT NULL DEFAULT 0,
          currency TEXT NOT NULL DEFAULT 'USD',
          notes TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        INSERT INTO __investments_cetes_migration (
          id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes, created_at, updated_at
        )
        SELECT id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes, created_at, updated_at
        FROM investments;
        DROP TABLE investments;
        ALTER TABLE __investments_cetes_migration RENAME TO investments;
        CREATE INDEX IF NOT EXISTS idx_investments_account ON investments(account_id);
        CREATE INDEX IF NOT EXISTS idx_investments_symbol ON investments(symbol);
      `)
    })
    migrate()
  } finally {
    database.pragma('foreign_keys = ON')
  }
}

function hasVerifiedTrigger(triggers, name, snippets) {
  const triggerSql = normalizeSqlDefinition(triggers.find((trigger) => trigger.name === name)?.sql)
  return snippets.every((snippet) => triggerSql.includes(snippet))
}

function recreateTransactionStatusTriggers(database) {
  database.exec(`
    DROP TRIGGER IF EXISTS trg_transactions_status_insert_valid;
    DROP TRIGGER IF EXISTS trg_transactions_status_insert_default;
    DROP TRIGGER IF EXISTS trg_transactions_status_update_valid;
    DROP TRIGGER IF EXISTS trg_transactions_status_update_default;

    CREATE TRIGGER trg_transactions_status_insert_valid
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_insert_default
    AFTER INSERT ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
    CREATE TRIGGER trg_transactions_status_update_valid
    BEFORE UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NOT NULL AND TRIM(NEW.status) != '' AND NEW.status NOT IN ('pending', 'posted', 'cleared')
    BEGIN
      SELECT RAISE(ABORT, 'Invalid transaction status');
    END;
    CREATE TRIGGER trg_transactions_status_update_default
    AFTER UPDATE OF status ON transactions
    FOR EACH ROW
    WHEN NEW.status IS NULL OR TRIM(NEW.status) = ''
    BEGIN
      UPDATE transactions SET status = 'posted' WHERE id = NEW.id;
    END;
  `)
}

function assertTransactionStatusReady(database) {
  const statusColumn = database
    .pragma('table_info(transactions)')
    .find((column) => column.name === 'status')
  if (!statusColumn) return

  const defaultValue = normalizeTransactionStatusDefault(statusColumn.dflt_value)
  const hasPostedDefault = defaultValue === 'posted'
  const hasNoDefault = defaultValue === ''
  if (!hasPostedDefault && !hasNoDefault) {
    throw new Error('Database transaction status column has an unsafe default.')
  }
  if (Number(statusColumn.notnull ?? 0) === 1 && !hasPostedDefault) {
    throw new Error('Database transaction status column is missing the posted default.')
  }

  const triggers = database
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'transactions'")
    .all()
  const hasInsertDefaultTrigger = hasVerifiedTrigger(
    triggers,
    'trg_transactions_status_insert_default',
    ['after insert on transactions', "update transactions set status = 'posted' where id = new.id"]
  )
  const hasUpdateDefaultTrigger = hasVerifiedTrigger(
    triggers,
    'trg_transactions_status_update_default',
    [
      'after update of status on transactions',
      "update transactions set status = 'posted' where id = new.id",
    ]
  )
  if (!hasPostedDefault) {
    if (!hasInsertDefaultTrigger || !hasUpdateDefaultTrigger) {
      throw new Error('Database transaction status column is missing default-status protection.')
    }
  }

  const validStatusSnippets = [
    "new.status not in ('pending', 'posted', 'cleared')",
    'raise(abort',
    'invalid transaction status',
  ]
  if (
    !hasVerifiedTrigger(triggers, 'trg_transactions_status_insert_valid', [
      'before insert on transactions',
      ...validStatusSnippets,
    ]) ||
    !hasVerifiedTrigger(triggers, 'trg_transactions_status_update_valid', [
      'before update of status on transactions',
      ...validStatusSnippets,
    ])
  ) {
    throw new Error('Database transaction status column is missing valid-status protection.')
  }
}

function validateCurrentDatabase() {
  const tableRows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const existingTables = new Set(tableRows.map((row) => row.name))
  const missingTables = Object.keys(CURRENT_SHIKIN_SCHEMA).filter(
    (tableName) => !existingTables.has(tableName)
  )
  if (missingTables.length > 0) {
    throw new Error(`Database is missing required Shikin tables: ${missingTables.join(', ')}`)
  }

  for (const [tableName, requiredColumns] of Object.entries(CURRENT_SHIKIN_SCHEMA)) {
    const existingColumns = new Set(
      db.pragma(`table_info(${tableName})`).map((column) => column.name)
    )
    const missingColumns = requiredColumns.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      throw new Error(
        `Database is missing required Shikin columns on ${tableName}: ${missingColumns.join(', ')}`
      )
    }
  }

  assertTransactionStatusReady(db)

  const migrationRows = db.prepare('SELECT name FROM _migrations').all()
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

// ── Migrations ─────────────────────────────────────────────────────────────

function runMigrations() {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `)

  const applied = new Set(
    db
      .prepare('SELECT name FROM _migrations')
      .all()
      .map((r) => r.name)
  )

  // --- Migration 001: Core Tables ---
  if (!applied.has('001_core_tables')) {
    db.exec(`
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
  type TEXT NOT NULL CHECK (type IN ('stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'cetes', 'other')),
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
    `)

    // Seed default categories
    db.exec(`
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
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (1, '001_core_tables')").run()
  }

  // --- Migration 003: Credit Cards ---
  if (!applied.has('003_credit_cards')) {
    if (!tableHasColumn(db, 'accounts', 'credit_limit')) {
      db.exec('ALTER TABLE accounts ADD COLUMN credit_limit INTEGER')
    }
    if (!tableHasColumn(db, 'accounts', 'statement_closing_day')) {
      db.exec('ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER')
    }
    if (!tableHasColumn(db, 'accounts', 'payment_due_day')) {
      db.exec('ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER')
    }

    db.prepare("INSERT INTO _migrations (id, name) VALUES (3, '003_credit_cards')").run()
  }

  // --- Migration 004: Category Rules ---
  if (!applied.has('004_category_rules')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_category_rules_pattern_category ON category_rules(pattern, category_id);
CREATE INDEX IF NOT EXISTS idx_category_rules_pattern ON category_rules(pattern);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (4, '004_category_rules')").run()
  }

  // --- Migration 005: Recurring Rules ---
  if (!applied.has('005_recurring_rules')) {
    db.exec(`
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
);

CREATE INDEX IF NOT EXISTS idx_recurring_rules_next_date ON recurring_rules(next_date);
CREATE INDEX IF NOT EXISTS idx_recurring_rules_active ON recurring_rules(active);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (5, '005_recurring_rules')").run()
  }

  // --- Migration 006: Goals ---
  if (!applied.has('006_goals')) {
    db.exec(`
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
);

CREATE INDEX IF NOT EXISTS idx_goals_deadline ON goals(deadline);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (6, '006_goals')").run()
  }

  // --- Migration 007: Recaps ---
  if (!applied.has('007_recaps')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS recaps (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('weekly', 'monthly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  highlights_json TEXT NOT NULL DEFAULT '[]',
  generated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_recaps_type ON recaps(type);
CREATE INDEX IF NOT EXISTS idx_recaps_generated ON recaps(generated_at);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (7, '007_recaps')").run()
  }

  // --- Migration 010: Transaction Splits ---
  if (!applied.has('010_transaction_splits')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id),
  subcategory_id TEXT REFERENCES subcategories(id),
  amount INTEGER NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_transaction_splits_transaction ON transaction_splits(transaction_id);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (10, '010_transaction_splits')").run()
  }

  // --- Migration 011: Net Worth Snapshots ---
  if (!applied.has('011_net_worth_snapshots')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS net_worth_snapshots (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  total_assets INTEGER NOT NULL DEFAULT 0,
  total_liabilities INTEGER NOT NULL DEFAULT 0,
  net_worth INTEGER NOT NULL DEFAULT 0,
  total_investments INTEGER NOT NULL DEFAULT 0,
  breakdown_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_net_worth_snapshots_date ON net_worth_snapshots(date);
    `)

    db.prepare("INSERT INTO _migrations (id, name) VALUES (11, '011_net_worth_snapshots')").run()
  }

  // --- Migration 012: Account Balance History ---
  if (!applied.has('012_account_balance_history')) {
    db.exec(`
CREATE TABLE IF NOT EXISTS account_balance_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  balance INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_balance_date ON account_balance_history(account_id, date);
CREATE INDEX IF NOT EXISTS idx_account_balance_account ON account_balance_history(account_id);
    `)

    db.prepare(
      "INSERT INTO _migrations (id, name) VALUES (12, '012_account_balance_history')"
    ).run()
  }

  // --- Migration 013: Recurring Rules Currency ---
  if (!applied.has('013_recurring_rules_currency')) {
    if (!tableHasColumn(db, 'recurring_rules', 'currency')) {
      db.exec(`ALTER TABLE recurring_rules ADD COLUMN currency TEXT;`)
    }

    // Pragmatic upgrade backfill for pre-013 rules so existing users keep functioning.
    // Policy: keep backfill best-effort, then surface any unsafe legacy rows through
    // runtime guards and CLI diagnose --deep observability.
    db.exec(`
UPDATE recurring_rules
SET currency = (
  SELECT a.currency
  FROM accounts a
  WHERE a.id = recurring_rules.account_id
)
WHERE (currency IS NULL OR TRIM(currency) = '') AND account_id IS NOT NULL;
    `)

    db.prepare(
      "INSERT INTO _migrations (id, name) VALUES (13, '013_recurring_rules_currency')"
    ).run()
  }

  // --- Migration 014: Recurring Rules Currency Backfill Repair ---
  // Maintains pragmatic backfill behavior; unresolved rows remain observable in diagnose.
  if (!applied.has('014_recurring_rules_currency_backfill')) {
    db.exec(`
UPDATE recurring_rules
SET currency = (
  SELECT a.currency
  FROM accounts a
  WHERE a.id = recurring_rules.account_id
)
WHERE (currency IS NULL OR TRIM(currency) = '') AND account_id IS NOT NULL;
    `)

    db.prepare(
      "INSERT INTO _migrations (id, name) VALUES (14, '014_recurring_rules_currency_backfill')"
    ).run()
  }

  // --- Migration 015: Primary Account ---
  if (!applied.has('015_primary_account')) {
    if (!tableHasColumn(db, 'accounts', 'is_primary')) {
      db.exec(`ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0;`)
    }

    db.prepare("INSERT INTO _migrations (id, name) VALUES (15, '015_primary_account')").run()
  }

  // --- Migration 016: CLI QOL Foundation ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `)
  ensureTableColumn(db, 'settings', 'updated_at', 'TEXT')
  ensureTableColumn(
    db,
    'transactions',
    'status',
    `TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('pending', 'posted', 'cleared'))`
  )
  ensureTableColumn(db, 'transactions', 'source', 'TEXT')
  ensureTableColumn(db, 'transactions', 'note', 'TEXT')
  ensureTableColumn(
    db,
    'transactions',
    'recurring_rule_id',
    'TEXT REFERENCES recurring_rules(id) ON DELETE SET NULL'
  )

  db.exec(`UPDATE settings SET updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`)
  db.exec(
    `UPDATE transactions SET status = 'posted' WHERE status IS NULL OR TRIM(status) = '' OR status NOT IN ('pending', 'posted', 'cleared');`
  )
  recreateTransactionStatusTriggers(db)
  assertTransactionStatusReady(db)

  db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        entity_id TEXT,
        action TEXT NOT NULL,
        before_json TEXT,
        after_json TEXT,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
  ensureTableColumn(db, 'audit_log', 'entity_id', 'TEXT')
  ensureTableColumn(db, 'audit_log', 'before_json', 'TEXT')
  ensureTableColumn(db, 'audit_log', 'after_json', 'TEXT')
  ensureTableColumn(db, 'audit_log', 'source', 'TEXT')
  ensureTableColumn(db, 'audit_log', 'note', 'TEXT')
  ensureTableColumn(db, 'audit_log', 'created_at', 'TEXT')
  db.exec(
    `UPDATE audit_log SET created_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
      CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

      CREATE TABLE IF NOT EXISTS cashflow_buckets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        target_amount INTEGER,
        balance INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
  ensureTableColumn(db, 'cashflow_buckets', 'description', 'TEXT')
  ensureTableColumn(db, 'cashflow_buckets', 'target_amount', 'INTEGER')
  ensureTableColumn(db, 'cashflow_buckets', 'balance', 'INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(db, 'cashflow_buckets', 'currency', `TEXT NOT NULL DEFAULT 'USD'`)
  ensureTableColumn(db, 'cashflow_buckets', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')
  ensureTableColumn(db, 'cashflow_buckets', 'is_active', 'INTEGER NOT NULL DEFAULT 1')
  ensureTableColumn(db, 'cashflow_buckets', 'created_at', 'TEXT')
  ensureTableColumn(db, 'cashflow_buckets', 'updated_at', 'TEXT')
  db.exec(
    `UPDATE cashflow_buckets SET created_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cashflow_buckets_active ON cashflow_buckets(is_active);

      CREATE TABLE IF NOT EXISTS cashflow_bucket_allocations (
        id TEXT PRIMARY KEY,
        bucket_id TEXT NOT NULL REFERENCES cashflow_buckets(id) ON DELETE CASCADE,
        transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
        amount INTEGER NOT NULL,
        currency TEXT NOT NULL DEFAULT 'USD',
        allocation_date TEXT NOT NULL,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
  ensureTableColumn(db, 'cashflow_bucket_allocations', 'transaction_id', 'TEXT')
  ensureTableColumn(db, 'cashflow_bucket_allocations', 'currency', `TEXT NOT NULL DEFAULT 'USD'`)
  ensureTableColumn(db, 'cashflow_bucket_allocations', 'source', 'TEXT')
  ensureTableColumn(db, 'cashflow_bucket_allocations', 'note', 'TEXT')
  ensureTableColumn(db, 'cashflow_bucket_allocations', 'created_at', 'TEXT')
  db.exec(
    `UPDATE cashflow_bucket_allocations SET created_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cashflow_allocations_bucket ON cashflow_bucket_allocations(bucket_id);
      CREATE INDEX IF NOT EXISTS idx_cashflow_allocations_transaction ON cashflow_bucket_allocations(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_cashflow_allocations_date ON cashflow_bucket_allocations(allocation_date);

      CREATE TABLE IF NOT EXISTS category_suggestions (
        id TEXT PRIMARY KEY,
        transaction_id TEXT REFERENCES transactions(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        suggested_category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        suggested_subcategory_id TEXT REFERENCES subcategories(id) ON DELETE SET NULL,
        confidence REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        reviewed_at TEXT
      );
    `)
  ensureTableColumn(db, 'category_suggestions', 'transaction_id', 'TEXT')
  ensureTableColumn(db, 'category_suggestions', 'suggested_subcategory_id', 'TEXT')
  ensureTableColumn(db, 'category_suggestions', 'source', 'TEXT')
  ensureTableColumn(db, 'category_suggestions', 'note', 'TEXT')
  ensureTableColumn(db, 'category_suggestions', 'created_at', 'TEXT')
  ensureTableColumn(db, 'category_suggestions', 'reviewed_at', 'TEXT')
  db.exec(
    `UPDATE category_suggestions SET created_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
  db.exec(`
      CREATE INDEX IF NOT EXISTS idx_category_suggestions_status ON category_suggestions(status);
      CREATE INDEX IF NOT EXISTS idx_category_suggestions_transaction ON category_suggestions(transaction_id);

      CREATE TABLE IF NOT EXISTS credit_card_statements (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        statement_start_date TEXT,
        statement_end_date TEXT NOT NULL,
        due_date TEXT NOT NULL,
        statement_balance INTEGER NOT NULL DEFAULT 0,
        minimum_payment INTEGER NOT NULL DEFAULT 0,
        paid_amount INTEGER NOT NULL DEFAULT 0,
        currency TEXT NOT NULL DEFAULT 'USD',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'paid', 'overdue')),
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
  ensureTableColumn(db, 'credit_card_statements', 'statement_start_date', 'TEXT')
  ensureTableColumn(db, 'credit_card_statements', 'currency', `TEXT NOT NULL DEFAULT 'USD'`)
  ensureTableColumn(db, 'credit_card_statements', 'source', 'TEXT')
  ensureTableColumn(db, 'credit_card_statements', 'note', 'TEXT')
  ensureTableColumn(db, 'credit_card_statements', 'created_at', 'TEXT')
  ensureTableColumn(db, 'credit_card_statements', 'updated_at', 'TEXT')
  db.exec(
    `UPDATE credit_card_statements SET created_at = COALESCE(created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
  db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_card_statements_account_period ON credit_card_statements(account_id, statement_end_date);
      CREATE INDEX IF NOT EXISTS idx_credit_card_statements_due ON credit_card_statements(due_date);
      CREATE INDEX IF NOT EXISTS idx_credit_card_statements_status ON credit_card_statements(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
      CREATE INDEX IF NOT EXISTS idx_transactions_recurring_rule ON transactions(recurring_rule_id);
    `)

  db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (16, '016_cli_qol_foundation')").run()

  if (!applied.has('017_investment_type_cetes')) {
    widenInvestmentTypeCheckForCetes(db)
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (17, '017_investment_type_cetes')").run()
    applied.add('017_investment_type_cetes')
  }

  if (!applied.has('018_placeholder_transactions')) {
    ensureTableColumn(db, 'transactions', 'is_placeholder', 'INTEGER NOT NULL DEFAULT 0')
    ensureTableColumn(db, 'transactions', 'placeholder_status', 'TEXT')
    ensureTableColumn(db, 'transactions', 'resolved_at', 'TEXT')
    ensureTableColumn(db, 'transactions', 'resolved_by_transaction_id', 'TEXT')
    ensureTableColumn(db, 'transactions', 'placeholder_reason', 'TEXT')
    ensureTableColumn(db, 'transactions', 'placeholder_parent_transaction_id', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_status ON transactions(is_placeholder, placeholder_status);
      CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_resolved_by ON transactions(resolved_by_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_parent ON transactions(placeholder_parent_transaction_id);
    `)
    db.prepare("INSERT OR IGNORE INTO _migrations (id, name) VALUES (18, '018_placeholder_transactions')").run()
    applied.add('018_placeholder_transactions')
  }

  validateCurrentDatabase()
  console.log('[data-server] Migrations complete')
}

runMigrations()

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

const MAX_JSON_BODY_BYTES = Number(process.env.SHIKIN_DATA_SERVER_MAX_JSON_BODY_BYTES || 1_000_000)
const MAX_DB_IMPORT_BYTES = Number(process.env.SHIKIN_DATA_SERVER_MAX_DB_IMPORT_BYTES || 50_000_000)

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

function sendJson(res, data, status = 200) {
  res.writeHead(
    status,
    buildBridgeCorsHeaders({
      'Content-Type': 'application/json',
    })
  )
  res.end(JSON.stringify(data))
}

function sendError(res, message, status = 500) {
  sendJson(res, { error: message }, status)
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

    try {
      staleEntry.db.exec('ROLLBACK')
    } catch {
      // Best-effort cleanup for abandoned transactions.
    } finally {
      activeTransactions.delete(transactionId)
      staleEntry.db.close()
      rememberClosedTransaction(transactionId, 'expired_rolled_back')
    }
  }, TRANSACTION_TTL_MS)
}

function beginServerTransaction() {
  const transactionId = ulid()
  const transactionDb = openDatabase()
  transactionDb.exec('BEGIN')
  activeTransactions.set(transactionId, { db: transactionDb, timeout: null })
  scheduleTransactionExpiry(transactionId)
  return transactionId
}

function getDatabaseForRequest(transactionId) {
  const normalizedTransactionId = normalizeTransactionId(transactionId, { allowUndefined: true })
  if (!normalizedTransactionId) {
    return db
  }

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

  try {
    transactionEntry.db.exec(action === 'commit' ? 'COMMIT' : 'ROLLBACK')
  } finally {
    clearTimeout(transactionEntry.timeout)
    activeTransactions.delete(normalizedTransactionId)
    transactionEntry.db.close()
    rememberClosedTransaction(
      normalizedTransactionId,
      action === 'commit' ? 'committed' : 'rolled_back'
    )
  }

  return { ok: true, status: action === 'commit' ? 'committed' : 'rolled_back' }
}

function ensureNoActiveTransactions(operation) {
  if (activeTransactions.size > 0) {
    throw createHttpError(`Cannot ${operation} while server-side transactions are active.`, 409)
  }
}

function advanceRecurringDate(date, frequency) {
  const d = dayjs(date)
  switch (frequency) {
    case 'daily':
      return d.add(1, 'day').format('YYYY-MM-DD')
    case 'weekly':
      return d.add(7, 'day').format('YYYY-MM-DD')
    case 'biweekly':
      return d.add(14, 'day').format('YYYY-MM-DD')
    case 'monthly':
      return d.add(1, 'month').format('YYYY-MM-DD')
    case 'quarterly':
      return d.add(3, 'month').format('YYYY-MM-DD')
    case 'yearly':
      return d.add(1, 'year').format('YYYY-MM-DD')
    default:
      return d.add(1, 'month').format('YYYY-MM-DD')
  }
}

function unknownRecurringRuleCurrencyMessage(rule) {
  return `${rule.description ? `Recurring rule "${rule.description}"` : `Recurring rule ${rule.id}`} has no stored currency. Repair or recreate the rule before moving or materializing it.`
}

function normalizeRecurringCurrency(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function recurringRuleAccountCurrencyMismatchMessage(rule) {
  return `Recurring rule "${rule.description ?? 'Unknown rule'}" has stored currency ${rule.currency ?? 'unknown'} but the linked account is now ${rule.account_currency ?? 'unknown'}. Repair or recreate the rule before materializing it.`
}

function unsupportedRecurringTransferMessage() {
  return 'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
}

function materializeRecurringBatch() {
  const today = dayjs().format('YYYY-MM-DD')
  const runBatch = db.transaction(() => {
    const dueRules = db
      .prepare(
        convertParams(`SELECT r.*, a.currency as account_currency, a.is_archived as account_is_archived
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         WHERE r.active = 1 AND r.next_date <= $1`)
      )
      .all(today)

    if (dueRules.length === 0) {
      return {
        success: true,
        created: 0,
        message: 'No recurring transactions were due.',
      }
    }

    const unsupportedTransferRule = dueRules.find((rule) => rule.type === 'transfer')
    if (unsupportedTransferRule) {
      return {
        success: false,
        reason: 'unsupported_recurring_transfer',
        message: unsupportedRecurringTransferMessage(),
      }
    }

    const archivedAccountRule = dueRules.find((rule) => rule.account_is_archived === 1)
    if (archivedAccountRule) {
      return {
        success: false,
        reason: 'account_archived',
        message: `Recurring rule "${archivedAccountRule.description}" points at archived account ${archivedAccountRule.account_id}. Unarchive the account or pause the rule before materializing it.`,
      }
    }

    const unknownCurrencyRule = dueRules.find(
      (rule) => normalizeRecurringCurrency(rule.currency) === ''
    )
    if (unknownCurrencyRule) {
      return {
        success: false,
        reason: 'unknown_rule_currency',
        message: unknownRecurringRuleCurrencyMessage(unknownCurrencyRule),
      }
    }

    const accountCurrencyMismatchRule = dueRules.find((rule) => {
      const ruleCurrency = normalizeRecurringCurrency(rule.currency)
      const accountCurrency = normalizeRecurringCurrency(rule.account_currency)
      return ruleCurrency !== '' && (accountCurrency === '' || ruleCurrency !== accountCurrency)
    })
    if (accountCurrencyMismatchRule) {
      return {
        success: false,
        reason: 'rule_account_currency_mismatch',
        message: recurringRuleAccountCurrencyMismatchMessage(accountCurrencyMismatchRule),
      }
    }

    let created = 0
    for (const rule of dueRules) {
      let occurrenceDate = rule.next_date
      while (occurrenceDate <= today) {
        if (rule.end_date && occurrenceDate > rule.end_date) {
          const deactivateResult = db
            .prepare(
              convertParams(
                "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 AND active = 1 AND next_date = $2"
              )
            )
            .run(rule.id, occurrenceDate)
          if (deactivateResult.changes !== 1) {
            break
          }
          break
        }

        const newNextDate = advanceRecurringDate(occurrenceDate, rule.frequency)
        const shouldDeactivate = Boolean(rule.end_date && newNextDate > rule.end_date)
        const claimResult = db
          .prepare(
            convertParams(
              "UPDATE recurring_rules SET active = $1, next_date = $2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $3 AND active = 1 AND next_date = $4"
            )
          )
          .run(shouldDeactivate ? 0 : 1, newNextDate, rule.id, occurrenceDate)
        if (claimResult.changes !== 1) {
          break
        }

        db.prepare(
          convertParams(`INSERT INTO transactions (id, account_id, category_id, subcategory_id, type, amount, currency, description, notes, date, tags, is_recurring, transfer_to_account_id, status, recurring_rule_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, 'posted', $13)`)
        ).run(
          ulid(),
          rule.account_id,
          rule.category_id,
          rule.subcategory_id,
          rule.type,
          rule.amount,
          normalizeRecurringCurrency(rule.currency),
          rule.description,
          rule.notes,
          occurrenceDate,
          rule.tags || '[]',
          rule.to_account_id,
          rule.id
        )

        const balanceChange = rule.type === 'income' ? rule.amount : -rule.amount
        db.prepare(
          convertParams(
            "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2"
          )
        ).run(balanceChange, rule.account_id)

        created += 1
        occurrenceDate = newNextDate
        if (shouldDeactivate) {
          break
        }
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
  res.writeHead(403, {
    'Content-Type': 'application/json',
    Vary: 'Origin',
  })
  res.end(JSON.stringify({ error: message }))
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    const preflightError = validateBridgePreflight(req)
    if (preflightError) return sendForbidden(res, preflightError)

    res.writeHead(204, buildBridgeCorsHeaders())
    return res.end()
  }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname

  const bridgeError = validateBridgeRequest(req)
  if (bridgeError) return sendForbidden(res, bridgeError)

  try {
    // ── Database: Query ──────────────────────────────────────────────
    if (path === '/api/db/query' && req.method === 'POST') {
      const body = await readBody(req)
      const sql = convertParams(body.sql || '')
      const params = body.params || []
      const database = getDatabaseForRequest(body.transactionId)
      const rows = database.prepare(sql).all(...params)
      return sendJson(res, rows)
    }

    // ── Database: Execute ────────────────────────────────────────────
    if (path === '/api/db/execute' && req.method === 'POST') {
      const body = await readBody(req)
      const sql = convertParams(body.sql || '')
      const params = body.params || []
      const database = getDatabaseForRequest(body.transactionId)
      const result = database.prepare(sql).run(...params)
      return sendJson(res, {
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      })
    }

    // ── Database: Transaction lifecycle ─────────────────────────────
    if (path === '/api/db/transaction' && req.method === 'POST') {
      const body = await readBody(req)

      if (body.action === 'begin') {
        return sendJson(res, { transactionId: beginServerTransaction() })
      }

      if (body.action === 'commit' || body.action === 'rollback') {
        return sendJson(res, closeServerTransaction(body.transactionId, body.action))
      }

      return sendError(res, 'Unsupported transaction action', 400)
    }

    // ── Recurring: Materialize server-side atomically ─────────────────
    if (path === '/api/recurring/materialize' && req.method === 'POST') {
      return sendJson(res, materializeRecurringBatch())
    }

    // ── Store: Get all ───────────────────────────────────────────────
    if (path === '/api/store' && req.method === 'GET') {
      return sendJson(res, loadSettings())
    }

    // ── Store: Get key ───────────────────────────────────────────────
    const storeKeyMatch = path.match(/^\/api\/store\/(.+)$/)
    if (storeKeyMatch && req.method === 'GET') {
      const key = decodeURIComponent(storeKeyMatch[1])
      const settings = loadSettings()
      return sendJson(res, { value: settings[key] ?? null })
    }

    // ── Store: Put key ───────────────────────────────────────────────
    if (storeKeyMatch && req.method === 'PUT') {
      const key = decodeURIComponent(storeKeyMatch[1])
      const body = await readBody(req)
      const settings = loadSettings()
      settings[key] = body.value
      saveSettings(settings)
      return sendJson(res, { ok: true })
    }

    // ── FS: App data path ────────────────────────────────────────────
    if (path === '/api/fs/appdata' && req.method === 'GET') {
      return sendJson(res, { path: DATA_DIR })
    }

    // ── FS: Join paths ───────────────────────────────────────────────
    if (path === '/api/fs/join' && req.method === 'GET') {
      const parts = url.searchParams.getAll('parts')
      if (parts.length === 0) {
        return sendError(res, 'Missing parts parameter', 400)
      }
      return sendJson(res, { path: join(...parts) })
    }

    // ── FS: Read file ────────────────────────────────────────────────
    if (path === '/api/fs/read' && req.method === 'GET') {
      const filePath = url.searchParams.get('path')
      if (!filePath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
      if (!existsSync(safe)) return sendError(res, 'File not found', 404)
      const content = readFileSync(safe, 'utf-8')
      return sendJson(res, { content })
    }

    // ── FS: Write file ───────────────────────────────────────────────
    if (path === '/api/fs/write' && req.method === 'PUT') {
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

    // ── FS: Check exists ─────────────────────────────────────────────
    if (path === '/api/fs/exists' && req.method === 'GET') {
      const filePath = url.searchParams.get('path')
      if (!filePath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
      return sendJson(res, { exists: existsSync(safe) })
    }

    // ── FS: Remove file ──────────────────────────────────────────────
    if (path === '/api/fs/remove' && req.method === 'DELETE') {
      const filePath = url.searchParams.get('path')
      if (!filePath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePathNoSymlinks(DATA_DIR, filePath, { allowMissing: true })
      if (existsSync(safe)) unlinkSync(safe)
      return sendJson(res, { ok: true })
    }

    // ── FS: Read directory ───────────────────────────────────────────
    if (path === '/api/fs/readdir' && req.method === 'GET') {
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

    // ── FS: Make directory ───────────────────────────────────────────
    if (path === '/api/fs/mkdir' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.path) return sendError(res, 'Missing path', 400)
      const safe = safePathNoSymlinks(DATA_DIR, body.path, { allowMissing: true })
      mkdirSync(safe, { recursive: body.recursive !== false, mode: PRIVATE_DIR_MODE })
      ensurePrivateDirectory(safe)
      safePathNoSymlinks(DATA_DIR, safe)
      return sendJson(res, { ok: true })
    }

    // ── DB: Export (binary) ────────────────────────────────────────
    if (path === '/api/db/export' && req.method === 'GET') {
      ensureNoActiveTransactions('export the database')
      // Checkpoint WAL to ensure all data is in main DB file
      checkpointWal(db, { requireComplete: true })
      const bytes = readFileSync(DB_PATH)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': bytes.length,
        'Content-Disposition': 'attachment; filename="shikin.db"',
        ...buildBridgeCorsHeaders(),
      })
      res.end(bytes)
      return
    }

    // ── DB: Import (binary) ────────────────────────────────────────
    if (path === '/api/db/import' && req.method === 'POST') {
      ensureNoActiveTransactions('import a database snapshot')
      const buffer = await readBuffer(req, {
        maxBytes: MAX_DB_IMPORT_BYTES,
        label: 'Database import payload',
      })

      // Validate: SQLite files start with "SQLite format 3\0"
      const header = buffer.slice(0, 16).toString('ascii')
      if (!header.startsWith('SQLite format 3')) {
        return sendError(res, 'Invalid SQLite database file', 400)
      }

      let importResult
      try {
        importResult = importDatabaseBuffer({ db, dbPath: DB_PATH, buffer })
        try {
          db = openDatabase()
          runMigrations()
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
          importResult.restoreBackup()
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

      return sendJson(res, { ok: true, message: 'Database imported successfully.' })
    }

    // ── 404 ──────────────────────────────────────────────────────────
    sendError(res, 'Not found', 404)
  } catch (err) {
    console.error('[data-server] Error:', err.message)
    sendError(res, err.message, err.statusCode || 500)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[data-server] Listening on http://127.0.0.1:${PORT}`)
  console.log(`[data-server] Data directory: ${DATA_DIR}`)
})
