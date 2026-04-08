-- Shikin Migration 011: Net Worth Snapshots
-- Stores daily snapshots of net worth for historical trend tracking
-- All monetary amounts stored as INTEGER (centavos/cents)

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
