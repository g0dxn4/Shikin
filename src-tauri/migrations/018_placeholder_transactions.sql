-- Shikin Migration 018: Placeholder Transactions
-- Adds schema for unknown/placeholder charges resolved by CLI/MCP workflows.
-- Runtime startup applies the live migration with column-existence checks in
-- src/lib/database.ts because SQLite does not provide portable ADD COLUMN IF NOT
-- EXISTS syntax. Engines that execute this schema-history file must do so once
-- under _migrations metadata; the changes themselves are additive.

ALTER TABLE transactions ADD COLUMN is_placeholder INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transactions ADD COLUMN placeholder_status TEXT;
ALTER TABLE transactions ADD COLUMN resolved_at TEXT;
ALTER TABLE transactions ADD COLUMN resolved_by_transaction_id TEXT;
ALTER TABLE transactions ADD COLUMN placeholder_reason TEXT;
ALTER TABLE transactions ADD COLUMN placeholder_parent_transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_status
  ON transactions(is_placeholder, placeholder_status);
CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_resolved_by
  ON transactions(resolved_by_transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_parent
  ON transactions(placeholder_parent_transaction_id);
