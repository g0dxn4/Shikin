-- Shikin Migration 019: Financial Semantics
-- Separates posting status from ledger/reporting treatment, records
-- reconciliation provenance, supports snapshot-only accounts, and adds
-- first-class receivables. Runtime startup mirrors this migration with
-- column-existence guards in src/lib/database.ts and scripts/data-server.mjs.

ALTER TABLE accounts ADD COLUMN account_mode TEXT NOT NULL DEFAULT 'transactional'
  CHECK (account_mode IN ('transactional', 'snapshot_only'));

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

ALTER TABLE transactions ADD COLUMN ledger_treatment TEXT NOT NULL DEFAULT 'normal'
  CHECK (ledger_treatment IN ('normal', 'staged_no_balance_impact'));
ALTER TABLE transactions ADD COLUMN reporting_treatment TEXT NOT NULL DEFAULT 'normal'
  CHECK (reporting_treatment IN ('normal', 'exclude_from_cashflow'));
ALTER TABLE transactions ADD COLUMN transaction_kind TEXT NOT NULL DEFAULT 'standard'
  CHECK (transaction_kind IN ('standard', 'reconciliation_bridge', 'archived_transfer_mirror'));
ALTER TABLE transactions ADD COLUMN staging_batch_id TEXT;
ALTER TABLE transactions ADD COLUMN reconciliation_id TEXT REFERENCES account_reconciliations(id) ON DELETE RESTRICT;
ALTER TABLE transactions ADD COLUMN matched_transaction_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT;
ALTER TABLE transactions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS receivables (
  id TEXT PRIMARY KEY,
  payer TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  received_amount INTEGER NOT NULL DEFAULT 0 CHECK (received_amount >= 0 AND received_amount <= amount),
  currency TEXT NOT NULL DEFAULT 'USD',
  due_date TEXT NOT NULL,
  project_reference TEXT,
  invoice_reference TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'partial', 'received', 'cancelled')),
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
CREATE INDEX IF NOT EXISTS idx_reconciliations_account_date
  ON account_reconciliations(account_id, reconciliation_date);
CREATE INDEX IF NOT EXISTS idx_reconciliations_batch
  ON account_reconciliations(account_id, staging_batch_id);
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
