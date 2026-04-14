import { createServer } from 'node:http'
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import Database from 'better-sqlite3'
import { checkpointWal, importDatabaseBuffer } from './data-server-db.mjs'
import { cacheItemsFromStream, rewriteCodexProxyBody } from './data-server-chatgpt.mjs'
import {
  buildBridgeCorsHeaders,
  safePath,
  validateBridgePreflight,
  validateBridgeRequest,
} from './data-server-security.mjs'

// ── Configuration ──────────────────────────────────────────────────────────

const PORT_ENV = process.env.SHIKIN_DATA_SERVER_PORT
const parsedPort = Number.parseInt(PORT_ENV || '', 10)
const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535 ? parsedPort : 1480
const DATA_DIR = join(homedir(), '.local', 'share', 'com.asf.shikin')
const DB_PATH = join(DATA_DIR, 'shikin.db')
const SETTINGS_PATH = join(DATA_DIR, 'settings.json')
const NOTEBOOK_DIR = join(DATA_DIR, 'notebook')

// Ensure directories exist
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(NOTEBOOK_DIR, { recursive: true })

// ── Database Setup ─────────────────────────────────────────────────────────

function openDatabase() {
  const database = new Database(DB_PATH)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  return database
}

let db = openDatabase()

// ── SQL Parameter Conversion ───────────────────────────────────────────────
// The codebase uses $1, $2, ... positional params; better-sqlite3 uses ?

function convertParams(sql) {
  return sql.replace(/\$(\d+)/g, '?')
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

  // --- Migration 002: AI Memories ---
  if (!applied.has('002_ai_memories')) {
    db.exec(`
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
    `)

    // Add summary column to ai_conversations
    try {
      db.exec('ALTER TABLE ai_conversations ADD COLUMN summary TEXT')
    } catch {
      // Column may already exist
    }

    db.prepare("INSERT INTO _migrations (id, name) VALUES (2, '002_ai_memories')").run()
  }

  // --- Migration 003: Credit Cards ---
  if (!applied.has('003_credit_cards')) {
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN credit_limit INTEGER')
    } catch {
      /* may exist */
    }
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN statement_closing_day INTEGER')
    } catch {
      /* may exist */
    }
    try {
      db.exec('ALTER TABLE accounts ADD COLUMN payment_due_day INTEGER')
    } catch {
      /* may exist */
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

  // --- Migration 008: AI Memories FTS5 ---
  if (!applied.has('008_ai_memories_fts')) {
    try {
      db.exec(`
CREATE VIRTUAL TABLE IF NOT EXISTS ai_memories_fts USING fts5(content, content=ai_memories, content_rowid=rowid);

INSERT INTO ai_memories_fts(ai_memories_fts) VALUES('rebuild');

CREATE TRIGGER IF NOT EXISTS ai_memories_ai AFTER INSERT ON ai_memories BEGIN
  INSERT INTO ai_memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;

CREATE TRIGGER IF NOT EXISTS ai_memories_ad AFTER DELETE ON ai_memories BEGIN
  INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TRIGGER IF NOT EXISTS ai_memories_au AFTER UPDATE ON ai_memories BEGIN
  INSERT INTO ai_memories_fts(ai_memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
  INSERT INTO ai_memories_fts(rowid, content) VALUES (new.rowid, new.content);
END;
      `)
      db.prepare("INSERT INTO _migrations (id, name) VALUES (8, '008_ai_memories_fts')").run()
    } catch (err) {
      console.warn('[data-server] FTS5 migration failed (may not be supported):', err.message)
    }
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
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8')
}

// ── HTTP Helpers ───────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()))
      } catch {
        resolve({})
      }
    })
    req.on('error', reject)
  })
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

function sendForbidden(res, message) {
  res.writeHead(403, {
    'Content-Type': 'application/json',
    Vary: 'Origin',
  })
  res.end(JSON.stringify({ error: message }))
}

// ── Codex Response Item Cache ──────────────────────────────────────────────
// Caches output items from Codex API streaming responses so the AI SDK's
// tool loop can reference them (since store=false means they aren't persisted).
const codexItemCache = new Map()

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
      const rows = db.prepare(sql).all(...params)
      return sendJson(res, rows)
    }

    // ── Database: Execute ────────────────────────────────────────────
    if (path === '/api/db/execute' && req.method === 'POST') {
      const body = await readBody(req)
      const sql = convertParams(body.sql || '')
      const params = body.params || []
      const result = db.prepare(sql).run(...params)
      return sendJson(res, {
        rowsAffected: result.changes,
        lastInsertId: Number(result.lastInsertRowid),
      })
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
      const safe = safePath(DATA_DIR, filePath)
      if (!existsSync(safe)) return sendError(res, 'File not found', 404)
      const content = readFileSync(safe, 'utf-8')
      return sendJson(res, { content })
    }

    // ── FS: Write file ───────────────────────────────────────────────
    if (path === '/api/fs/write' && req.method === 'PUT') {
      const body = await readBody(req)
      if (!body.path) return sendError(res, 'Missing path', 400)
      const safe = safePath(DATA_DIR, body.path)
      // Ensure parent directory exists
      const parentDir = resolve(safe, '..')
      mkdirSync(parentDir, { recursive: true })
      writeFileSync(safe, body.content || '', 'utf-8')
      return sendJson(res, { ok: true })
    }

    // ── FS: Check exists ─────────────────────────────────────────────
    if (path === '/api/fs/exists' && req.method === 'GET') {
      const filePath = url.searchParams.get('path')
      if (!filePath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePath(DATA_DIR, filePath)
      return sendJson(res, { exists: existsSync(safe) })
    }

    // ── FS: Remove file ──────────────────────────────────────────────
    if (path === '/api/fs/remove' && req.method === 'DELETE') {
      const filePath = url.searchParams.get('path')
      if (!filePath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePath(DATA_DIR, filePath)
      if (existsSync(safe)) unlinkSync(safe)
      return sendJson(res, { ok: true })
    }

    // ── FS: Read directory ───────────────────────────────────────────
    if (path === '/api/fs/readdir' && req.method === 'GET') {
      const dirPath = url.searchParams.get('path')
      if (!dirPath) return sendError(res, 'Missing path parameter', 400)
      const safe = safePath(DATA_DIR, dirPath)
      if (!existsSync(safe)) return sendJson(res, { entries: [] })
      const entries = readdirSync(safe).map((name) => {
        const fullPath = join(safe, name)
        let isDirectory = false
        try {
          isDirectory = statSync(fullPath).isDirectory()
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
      const safe = safePath(DATA_DIR, body.path)
      mkdirSync(safe, { recursive: body.recursive !== false })
      return sendJson(res, { ok: true })
    }

    // ── Codex item cache (for store=false tool loops) ───────────────
    // The Codex API requires store=false, meaning response items aren't
    // persisted. But the AI SDK's tool loop references them via item_reference.
    // We cache output items from responses so we can inline them on follow-up.

    // ── Proxy: ChatGPT Codex API ────────────────────────────────────
    // Proxies requests to chatgpt.com to avoid CORS issues in browser mode.
    // Caches response output items so tool loops work with store=false.
    if (path.startsWith('/api/proxy/chatgpt/')) {
      const targetPath = path.replace('/api/proxy/chatgpt', '')
      const targetUrl = `https://chatgpt.com/backend-api/codex${targetPath}${url.search || ''}`

      // Read raw body and patch for Codex API requirements
      const bodyChunks = []
      for await (const chunk of req) bodyChunks.push(chunk)
      let bodyBuffer = Buffer.concat(bodyChunks)

      // Patch request body for Codex API compatibility
      if (req.headers['content-type']?.includes('application/json') && bodyBuffer.length > 0) {
        try {
          const bodyJson = JSON.parse(bodyBuffer.toString())
          bodyBuffer = Buffer.from(JSON.stringify(rewriteCodexProxyBody(bodyJson, codexItemCache)))
        } catch {
          /* not JSON, pass through */
        }
      }

      // Forward all relevant headers
      const proxyHeaders = {
        'Content-Type': req.headers['content-type'] || 'application/json',
      }
      if (req.headers['authorization']) proxyHeaders['Authorization'] = req.headers['authorization']
      if (req.headers['chatgpt-account-id'])
        proxyHeaders['chatgpt-account-id'] = req.headers['chatgpt-account-id']
      if (req.headers['openai-beta']) proxyHeaders['OpenAI-Beta'] = req.headers['openai-beta']
      if (req.headers['originator']) proxyHeaders['originator'] = req.headers['originator']

      const proxyRes = await fetch(targetUrl, {
        method: req.method,
        headers: proxyHeaders,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : bodyBuffer,
      })

      // Stream the response back with CORS headers
      res.writeHead(proxyRes.status, {
        'Content-Type': proxyRes.headers.get('content-type') || 'application/json',
        ...buildBridgeCorsHeaders(),
      })

      if (proxyRes.body) {
        const reader = proxyRes.body.getReader()
        const decoder = new TextDecoder()
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) {
              res.end()
              return
            }
            // Cache output items from the stream for tool loop support
            try {
              cacheItemsFromStream(decoder.decode(value, { stream: true }), codexItemCache)
            } catch {}
            res.write(value)
          }
        }
        await pump()
      } else {
        const text = await proxyRes.text()
        res.end(text)
      }
      return
    }

    // ── DB: Export (binary) ────────────────────────────────────────
    if (path === '/api/db/export' && req.method === 'GET') {
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
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const buffer = Buffer.concat(chunks)

      // Validate: SQLite files start with "SQLite format 3\0"
      const header = buffer.slice(0, 16).toString('ascii')
      if (!header.startsWith('SQLite format 3')) {
        return sendError(res, 'Invalid SQLite database file', 400)
      }

      importDatabaseBuffer({ db, dbPath: DB_PATH, buffer })
      db = openDatabase()
      runMigrations()

      return sendJson(res, { ok: true, message: 'Database imported successfully.' })
    }

    // ── 404 ──────────────────────────────────────────────────────────
    sendError(res, 'Not found', 404)
  } catch (err) {
    console.error('[data-server] Error:', err.message)
    sendError(res, err.message, 500)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[data-server] Listening on http://127.0.0.1:${PORT}`)
  console.log(`[data-server] Data directory: ${DATA_DIR}`)
})
