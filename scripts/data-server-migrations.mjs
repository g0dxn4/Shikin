import {
  SCOPED_BUDGETS_MIGRATION,
  scopedBudgetsStatements,
  assertScopedBudgetsReady,
} from '@shikin/finance-core/scoped-budgets-migration'
import {
  CURRENT_SHIKIN_MIGRATIONS,
  CURRENT_SHIKIN_SCHEMA,
  CLASSIFICATION_TYPES_MIGRATION,
  CLASSIFICATION_TYPES_SCHEMA,
  classificationTypesStatements,
  assertClassificationTypesReady,
  DATED_FX_MIGRATION,
  DATED_FX_SCHEMA,
  datedFxStatements,
  assertDatedFxReady,
  BACKEND_FOUNDATION_MIGRATION,
  BACKEND_FOUNDATION_SCHEMA,
  backendFoundationStatements,
  assertBackendFoundationReady,
  assertSupportedSchemaVersion,
} from '@shikin/finance-core'

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
    .prepare(
      "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'transactions'"
    )
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

function validateCurrentDatabase(db) {
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

  const migrationRows = db.prepare('SELECT id, name FROM _migrations').all()
  assertSupportedSchemaVersion(migrationRows)
  assertScopedBudgetsReady(
    { budgets: db.pragma('table_info(budgets)').map((column) => column.name) },
    db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger'").all()
  )
  assertClassificationTypesReady(
    Object.fromEntries(
      Object.keys(CLASSIFICATION_TYPES_SCHEMA).map((table) => [
        table,
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name),
      ])
    ),
    db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')")
      .all()
  )
  assertDatedFxReady(
    Object.fromEntries(
      Object.keys(DATED_FX_SCHEMA).map((table) => [
        table,
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name),
      ])
    ),
    db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger')").all()
  )
  assertBackendFoundationReady(
    Object.fromEntries(
      Object.keys(BACKEND_FOUNDATION_SCHEMA).map((table) => [
        table,
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((column) => column.name),
      ])
    ),
    db.prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('index', 'trigger')").all(),
    db.prepare('SELECT * FROM app_data_state').all()
  )
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

export function runMigrations(db) {
  const hasMigrations = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_migrations'")
    .get()
  const rows = hasMigrations ? db.prepare('SELECT id, name FROM _migrations').all() : []
  assertSupportedSchemaVersion(rows)
  if (rows.length && !rows.some((row) => row.name === '019_financial_semantics'))
    return runMigrationsOnConnection(db)
  return db.transaction(runMigrationsOnConnection).immediate(db)
}

function runMigrationsOnConnection(db) {
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

  assertSupportedSchemaVersion(db.prepare('SELECT id, name FROM _migrations').all())
  if (applied.has(SCOPED_BUDGETS_MIGRATION)) {
    validateCurrentDatabase(db)
    return
  }

  // Do not replay already-applied status/timestamp repair DML on 019/020.
  if (applied.has('019_financial_semantics')) {
    runBackendFoundationUpgrade(db, applied)
    return
  }

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
  import_source TEXT,
  import_external_id TEXT,
  import_fingerprint TEXT,
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
  quote_currency TEXT NOT NULL DEFAULT 'USD',
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
  anchor_kind TEXT CHECK (anchor_kind IN ('fixed_day', 'end_of_month')),
  anchor_day INTEGER CHECK (anchor_day BETWEEN 1 AND 31),
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

  db.exec(
    `UPDATE settings SET updated_at = COALESCE(updated_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`
  )
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

  db.prepare(
    "INSERT OR IGNORE INTO _migrations (id, name) VALUES (16, '016_cli_qol_foundation')"
  ).run()

  if (!applied.has('017_investment_type_cetes')) {
    widenInvestmentTypeCheckForCetes(db)
    db.prepare(
      "INSERT OR IGNORE INTO _migrations (id, name) VALUES (17, '017_investment_type_cetes')"
    ).run()
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
    db.prepare(
      "INSERT OR IGNORE INTO _migrations (id, name) VALUES (18, '018_placeholder_transactions')"
    ).run()
    applied.add('018_placeholder_transactions')
  }

  if (!applied.has('019_financial_semantics')) {
    ensureTableColumn(
      db,
      'accounts',
      'account_mode',
      `TEXT NOT NULL DEFAULT 'transactional' CHECK (account_mode IN ('transactional', 'snapshot_only'))`
    )
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_reconciliations (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        reconciliation_date TEXT NOT NULL,
        actual_balance INTEGER NOT NULL,
        stored_balance_before INTEGER NOT NULL,
        ledger_balance_before INTEGER NOT NULL,
        ledger_balance_after INTEGER NOT NULL,
        adjustment_amount INTEGER NOT NULL,
        adjustment_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
        staging_batch_id TEXT,
        statement_start_date TEXT,
        statement_end_date TEXT,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
    `)
    ensureTableColumn(
      db,
      'transactions',
      'ledger_treatment',
      `TEXT NOT NULL DEFAULT 'normal' CHECK (ledger_treatment IN ('normal', 'staged_no_balance_impact'))`
    )
    ensureTableColumn(
      db,
      'transactions',
      'reporting_treatment',
      `TEXT NOT NULL DEFAULT 'normal' CHECK (reporting_treatment IN ('normal', 'exclude_from_cashflow'))`
    )
    ensureTableColumn(
      db,
      'transactions',
      'transaction_kind',
      `TEXT NOT NULL DEFAULT 'standard' CHECK (transaction_kind IN ('standard', 'reconciliation_bridge', 'archived_transfer_mirror'))`
    )
    ensureTableColumn(db, 'transactions', 'staging_batch_id', 'TEXT')
    ensureTableColumn(
      db,
      'transactions',
      'reconciliation_id',
      'TEXT REFERENCES account_reconciliations(id) ON DELETE RESTRICT'
    )
    ensureTableColumn(
      db,
      'transactions',
      'matched_transaction_id',
      'TEXT REFERENCES transactions(id) ON DELETE RESTRICT'
    )
    ensureTableColumn(db, 'transactions', 'is_archived', 'INTEGER NOT NULL DEFAULT 0')
    db.exec(`
      CREATE TABLE IF NOT EXISTS receivables (
        id TEXT PRIMARY KEY,
        payer TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        received_amount INTEGER NOT NULL DEFAULT 0 CHECK (received_amount >= 0 AND received_amount <= amount),
        currency TEXT NOT NULL DEFAULT 'USD',
        due_date TEXT NOT NULL,
        project_reference TEXT,
        invoice_reference TEXT,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'received', 'cancelled')),
        account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL,
        matched_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT,
        notes TEXT,
        source TEXT,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_mode ON accounts(account_mode);
      CREATE INDEX IF NOT EXISTS idx_transactions_ledger_treatment ON transactions(ledger_treatment);
      CREATE INDEX IF NOT EXISTS idx_transactions_reporting_treatment ON transactions(reporting_treatment);
      CREATE INDEX IF NOT EXISTS idx_transactions_staging_batch ON transactions(account_id, staging_batch_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_reconciliation ON transactions(reconciliation_id);
      CREATE INDEX IF NOT EXISTS idx_transactions_matched ON transactions(matched_transaction_id);
      CREATE INDEX IF NOT EXISTS idx_reconciliations_account_date ON account_reconciliations(account_id, reconciliation_date);
      CREATE INDEX IF NOT EXISTS idx_reconciliations_batch ON account_reconciliations(account_id, staging_batch_id);
      CREATE INDEX IF NOT EXISTS idx_receivables_status_due ON receivables(status, due_date);
      CREATE INDEX IF NOT EXISTS idx_receivables_transaction ON receivables(matched_transaction_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reconciliation_unique
        ON transactions(reconciliation_id) WHERE reconciliation_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_matched_unique
        ON transactions(matched_transaction_id) WHERE matched_transaction_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_batch_unique
        ON account_reconciliations(account_id, staging_batch_id) WHERE staging_batch_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_adjustment_unique
        ON account_reconciliations(adjustment_transaction_id)
        WHERE adjustment_transaction_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_receivables_transaction_unique
        ON receivables(matched_transaction_id) WHERE matched_transaction_id IS NOT NULL;
      CREATE TRIGGER IF NOT EXISTS trg_transactions_no_self_match_insert
      BEFORE INSERT ON transactions
      FOR EACH ROW
      WHEN NEW.matched_transaction_id IS NOT NULL AND NEW.matched_transaction_id = NEW.id
      BEGIN
        SELECT RAISE(ABORT, 'Transaction cannot match itself');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_transactions_no_self_match_update
      BEFORE UPDATE OF matched_transaction_id ON transactions
      FOR EACH ROW
      WHEN NEW.matched_transaction_id IS NOT NULL AND NEW.matched_transaction_id = NEW.id
      BEGIN
        SELECT RAISE(ABORT, 'Transaction cannot match itself');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_transactions_snapshot_account_insert
      BEFORE INSERT ON transactions
      FOR EACH ROW
      WHEN EXISTS (
        SELECT 1 FROM accounts
        WHERE account_mode = 'snapshot_only'
          AND id IN (NEW.account_id, NEW.transfer_to_account_id)
      )
      BEGIN
        SELECT RAISE(ABORT, 'Snapshot-only accounts cannot accept transaction ledger rows');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_transactions_snapshot_account_update
      BEFORE UPDATE OF account_id, transfer_to_account_id ON transactions
      FOR EACH ROW
      WHEN EXISTS (
        SELECT 1 FROM accounts
        WHERE account_mode = 'snapshot_only'
          AND id IN (NEW.account_id, NEW.transfer_to_account_id)
      )
      BEGIN
        SELECT RAISE(ABORT, 'Snapshot-only accounts cannot accept transaction ledger rows');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_accounts_snapshot_mode_update
      BEFORE UPDATE OF account_mode ON accounts
      FOR EACH ROW
      WHEN NEW.account_mode = 'snapshot_only'
        AND OLD.account_mode <> 'snapshot_only'
        AND EXISTS (
          SELECT 1 FROM transactions
          WHERE account_id = OLD.id OR transfer_to_account_id = OLD.id
        )
      BEGIN
        SELECT RAISE(ABORT, 'Accounts with transaction history cannot become snapshot-only');
      END;
    `)
    db.prepare(
      "INSERT OR IGNORE INTO _migrations (id, name) VALUES (19, '019_financial_semantics')"
    ).run()
    applied.add('019_financial_semantics')
  }

  runBackendFoundationUpgrade(db, applied)
}

function runBackendFoundationUpgrade(db, applied) {
  if (!applied.has('020_quote_recurrence_import_identity')) {
    ensureTableColumn(db, 'stock_prices', 'quote_currency', 'TEXT')
    db.prepare(
      `UPDATE stock_prices SET quote_currency = UPPER(COALESCE(NULLIF(TRIM(currency), ''), 'USD')) WHERE quote_currency IS NULL OR TRIM(quote_currency) = ''`
    ).run()
    ensureTableColumn(
      db,
      'recurring_rules',
      'anchor_kind',
      `TEXT CHECK (anchor_kind IN ('fixed_day', 'end_of_month'))`
    )
    ensureTableColumn(
      db,
      'recurring_rules',
      'anchor_day',
      'INTEGER CHECK (anchor_day BETWEEN 1 AND 31)'
    )
    ensureTableColumn(db, 'transactions', 'import_source', 'TEXT')
    ensureTableColumn(db, 'transactions', 'import_external_id', 'TEXT')
    ensureTableColumn(db, 'transactions', 'import_fingerprint', 'TEXT')
    ensureTableColumn(db, 'net_worth_snapshots', 'currency', 'TEXT')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_stock_prices_quote
        ON stock_prices(symbol, quote_currency, date);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_import_external
        ON transactions(account_id, import_source, import_external_id)
        WHERE import_external_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_import_fingerprint
        ON transactions(import_fingerprint)
        WHERE import_fingerprint IS NOT NULL;
    `)
    db.prepare(
      "INSERT OR IGNORE INTO _migrations (id, name) VALUES (20, '020_quote_recurrence_import_identity')"
    ).run()
    applied.add('020_quote_recurrence_import_identity')
  }

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_transactions_snapshot_account_insert
    BEFORE INSERT ON transactions
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM accounts
      WHERE account_mode = 'snapshot_only'
        AND id IN (NEW.account_id, NEW.transfer_to_account_id)
    )
    BEGIN
      SELECT RAISE(ABORT, 'Snapshot-only accounts cannot accept transaction ledger rows');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_transactions_snapshot_account_update
    BEFORE UPDATE OF account_id, transfer_to_account_id ON transactions
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM accounts
      WHERE account_mode = 'snapshot_only'
        AND id IN (NEW.account_id, NEW.transfer_to_account_id)
    )
    BEGIN
      SELECT RAISE(ABORT, 'Snapshot-only accounts cannot accept transaction ledger rows');
    END;
    CREATE TRIGGER IF NOT EXISTS trg_accounts_snapshot_mode_update
    BEFORE UPDATE OF account_mode ON accounts
    FOR EACH ROW
    WHEN NEW.account_mode = 'snapshot_only'
      AND OLD.account_mode <> 'snapshot_only'
      AND EXISTS (
        SELECT 1 FROM transactions
        WHERE account_id = OLD.id OR transfer_to_account_id = OLD.id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Accounts with transaction history cannot become snapshot-only');
    END;
  `)

  db.transaction(() => {
    const migrations = db.prepare('SELECT id, name FROM _migrations').all()
    assertSupportedSchemaVersion(migrations)
    if (!migrations.some((row) => row.name === BACKEND_FOUNDATION_MIGRATION)) {
      const columns = Object.fromEntries(
        Object.keys(BACKEND_FOUNDATION_SCHEMA).map((table) => [
          table,
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((column) => column.name),
        ])
      )
      for (const statement of backendFoundationStatements(columns)) db.exec(statement)
    }
    if (!migrations.some((row) => row.name === DATED_FX_MIGRATION)) {
      const columns = Object.fromEntries(
        Object.keys(DATED_FX_SCHEMA).map((table) => [
          table,
          db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((column) => column.name),
        ])
      )
      for (const statement of datedFxStatements(columns)) db.exec(statement)
    }
    if (!migrations.some((row) => row.name === CLASSIFICATION_TYPES_MIGRATION)) {
      for (const statement of classificationTypesStatements()) db.exec(statement)
    }
    if (!migrations.some((row) => row.name === SCOPED_BUDGETS_MIGRATION)) {
      for (const statement of scopedBudgetsStatements({
        budgets: db.pragma('table_info(budgets)').map((column) => column.name),
      }))
        db.exec(statement)
    }
    validateCurrentDatabase(db)
  }).immediate()
  console.log('[data-server] Migrations complete')
}
