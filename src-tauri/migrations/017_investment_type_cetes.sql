-- Shikin Migration 017: Investment Type CETES
-- SQLite cannot alter CHECK constraints in place, so rebuild investments while preserving rows.

PRAGMA foreign_keys = OFF;

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

PRAGMA foreign_keys = ON;
