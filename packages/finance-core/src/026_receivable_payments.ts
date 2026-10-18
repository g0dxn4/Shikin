export const RECEIVABLE_PAYMENTS_MIGRATION = '026_receivable_payments'
export const RECEIVABLE_PAYMENTS_VERSION = 26

export const RECEIVABLE_PAYMENTS_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  receivables: ['unattributed_received_amount'],
  receivable_payment_links: [
    'id',
    'receivable_id',
    'transaction_id',
    'amount',
    'currency',
    'transaction_date',
    'transaction_snapshot_json',
    'source',
    'note',
    'created_at',
    'reversed_at',
    'reversal_source',
    'reversal_note',
  ],
}

// An explicit text identity is the only row identity. This removes SQLite's
// hidden rowid REPLACE path without relying on undefined BEFORE INSERT rowids.
const table = `CREATE TABLE receivable_payment_links (
  id TEXT PRIMARY KEY,
  receivable_id TEXT NOT NULL REFERENCES receivables(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0 AND amount <= 9007199254740991),
  currency TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  transaction_snapshot_json TEXT NOT NULL CHECK (json_valid(transaction_snapshot_json)),
  source TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  reversed_at TEXT,
  reversal_source TEXT,
  reversal_note TEXT
) WITHOUT ROWID`

const activeSum = (id: string) =>
  `(SELECT COALESCE(SUM(amount), 0) FROM receivable_payment_links WHERE receivable_id = ${id} AND reversed_at IS NULL)`
const mirror = (id: string) =>
  `(SELECT CASE WHEN COUNT(*) = 1 THEN MIN(transaction_id) ELSE NULL END FROM receivable_payment_links WHERE receivable_id = ${id} AND reversed_at IS NULL)`
// SQLite REPLACE skips DELETE triggers when recursive_triggers is off. Protect
// every unique transaction key, including collisions originating from another row.
const protectedSourceCollision = (updating: boolean) => `EXISTS (
  SELECT 1 FROM receivable_payment_links p LEFT JOIN transactions original ON original.id = p.transaction_id
  WHERE p.reversed_at IS NULL ${updating ? 'AND p.transaction_id IS NOT OLD.id' : ''}
    AND (NEW.id = p.transaction_id
      OR (NEW.import_external_id IS NOT NULL AND NEW.account_id = original.account_id
        AND NEW.import_source = original.import_source AND NEW.import_external_id = original.import_external_id)
      OR (NEW.import_fingerprint IS NOT NULL AND NEW.import_fingerprint = original.import_fingerprint)
      OR (NEW.reconciliation_id IS NOT NULL AND NEW.reconciliation_id = original.reconciliation_id)
      OR (NEW.matched_transaction_id IS NOT NULL AND NEW.matched_transaction_id = original.matched_transaction_id))
)`
// Existing bank tables retain their rowids, including valid negative legacy
// values. Check the resulting state after INSERT/UPDATE so an implicit rowid
// never causes a false collision, while REPLACE cannot orphan an active receipt.
const missingActiveSource = `EXISTS (
  SELECT 1 FROM receivable_payment_links p LEFT JOIN transactions t ON t.id = p.transaction_id
  WHERE p.reversed_at IS NULL AND t.id IS NULL
)`
const refresh = `UPDATE receivables
  SET received_amount = unattributed_received_amount + ${activeSum('NEW.receivable_id')},
      matched_transaction_id = ${mirror('NEW.receivable_id')},
      status = CASE WHEN status = 'cancelled' THEN 'cancelled'
        WHEN unattributed_received_amount + ${activeSum('NEW.receivable_id')} = amount THEN 'received'
        WHEN unattributed_received_amount + ${activeSum('NEW.receivable_id')} > 0 THEN 'partial'
        ELSE 'open' END,
      updated_at = COALESCE(NEW.reversed_at, NEW.created_at)
  WHERE id = NEW.receivable_id;`

export const RECEIVABLE_PAYMENTS_OBJECTS: Readonly<Record<string, string>> = {
  receivable_payment_links: table,
  idx_receivable_payment_active_transaction: `CREATE UNIQUE INDEX idx_receivable_payment_active_transaction ON receivable_payment_links(transaction_id) WHERE reversed_at IS NULL`,
  idx_receivable_payment_owner: `CREATE INDEX idx_receivable_payment_owner ON receivable_payment_links(receivable_id, created_at, id)`,
  trg_receivable_payment_validate: `CREATE TRIGGER trg_receivable_payment_validate BEFORE INSERT ON receivable_payment_links
    BEGIN
      SELECT CASE WHEN EXISTS (SELECT 1 FROM receivable_payment_links
        WHERE id = NEW.id OR (transaction_id = NEW.transaction_id AND reversed_at IS NULL))
        THEN RAISE(ABORT, 'Receivable payment identity already exists; replay or reverse the original receipt') END;
      SELECT CASE WHEN NEW.reversed_at IS NOT NULL THEN RAISE(ABORT, 'New receivable payments must be active') END;
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM receivables r JOIN transactions t ON t.id = NEW.transaction_id
        JOIN accounts a ON a.id = t.account_id
        WHERE r.id = NEW.receivable_id AND r.status IN ('open', 'partial')
          AND t.type = 'income' AND t.status IN ('posted', 'cleared')
          AND COALESCE(t.ledger_treatment, 'normal') = 'normal'
          AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
          AND COALESCE(t.transaction_kind, 'standard') = 'standard'
          AND t.matched_transaction_id IS NULL AND COALESCE(t.is_archived, 0) = 0
          AND a.is_archived = 0 AND COALESCE(a.account_mode, 'transactional') = 'transactional'
          AND (r.account_id IS NULL OR r.account_id = t.account_id)
          AND UPPER(TRIM(r.currency)) = NEW.currency AND UPPER(TRIM(t.currency)) = NEW.currency
          AND t.amount = NEW.amount AND t.date = NEW.transaction_date
          AND r.received_amount = r.unattributed_received_amount + ${activeSum('r.id')}
          AND r.received_amount + NEW.amount <= r.amount
          AND NOT EXISTS (SELECT 1 FROM card_statement_payment_links p WHERE p.transaction_id = t.id AND p.voided_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM transaction_consumption_classifications c WHERE c.transaction_id = t.id AND c.role NOT IN ('earned_income', 'other_income'))
      ) THEN RAISE(ABORT, 'Invalid receivable payment evidence or remaining amount') END;
    END`,
  trg_receivable_payment_insert: `CREATE TRIGGER trg_receivable_payment_insert AFTER INSERT ON receivable_payment_links BEGIN ${refresh} END`,
  trg_receivable_payment_reverse: `CREATE TRIGGER trg_receivable_payment_reverse AFTER UPDATE OF reversed_at ON receivable_payment_links BEGIN ${refresh} END`,
  trg_receivable_payment_immutable: `CREATE TRIGGER trg_receivable_payment_immutable BEFORE UPDATE ON receivable_payment_links
    WHEN NEW.id IS NOT OLD.id OR NEW.receivable_id IS NOT OLD.receivable_id
      OR NEW.transaction_id IS NOT OLD.transaction_id OR NEW.amount IS NOT OLD.amount
      OR NEW.currency IS NOT OLD.currency OR NEW.transaction_date IS NOT OLD.transaction_date
      OR NEW.transaction_snapshot_json IS NOT OLD.transaction_snapshot_json
      OR NEW.source IS NOT OLD.source OR NEW.note IS NOT OLD.note OR NEW.created_at IS NOT OLD.created_at
      OR OLD.reversed_at IS NOT NULL OR NEW.reversed_at IS NULL OR LENGTH(TRIM(NEW.reversed_at)) = 0
    BEGIN SELECT RAISE(ABORT, 'Receivable payment evidence is immutable; reverse an active link'); END`,
  trg_receivable_payment_no_delete: `CREATE TRIGGER trg_receivable_payment_no_delete BEFORE DELETE ON receivable_payment_links
    BEGIN SELECT RAISE(ABORT, 'Receivable payment history cannot be deleted'); END`,
  trg_receivable_payment_equation: `CREATE TRIGGER trg_receivable_payment_equation BEFORE UPDATE ON receivables
    WHEN NEW.unattributed_received_amount IS NOT OLD.unattributed_received_amount
      OR NEW.received_amount != NEW.unattributed_received_amount + ${activeSum('NEW.id')}
      OR NEW.matched_transaction_id IS NOT ${mirror('NEW.id')}
      OR NEW.received_amount > NEW.amount
      OR NEW.status != CASE WHEN NEW.status = 'cancelled' THEN 'cancelled'
        WHEN NEW.received_amount = NEW.amount THEN 'received'
        WHEN NEW.received_amount > 0 THEN 'partial' ELSE 'open' END
      OR (EXISTS (SELECT 1 FROM receivable_payment_links p WHERE p.receivable_id = OLD.id AND p.reversed_at IS NULL)
        AND (NEW.amount IS NOT OLD.amount OR NEW.currency IS NOT OLD.currency OR NEW.account_id IS NOT OLD.account_id))
    BEGIN SELECT RAISE(ABORT, 'Receivable totals must equal preserved baseline plus active payment links'); END`,
  trg_receivable_source_update: `CREATE TRIGGER trg_receivable_source_update BEFORE UPDATE ON transactions
    WHEN EXISTS (SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = OLD.id AND p.reversed_at IS NULL)
      AND (NEW.id IS NOT OLD.id OR NEW.account_id IS NOT OLD.account_id OR NEW.amount IS NOT OLD.amount
        OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency OR NEW.date IS NOT OLD.date
        OR NEW.status IS NOT OLD.status OR NEW.ledger_treatment IS NOT OLD.ledger_treatment
        OR NEW.reporting_treatment IS NOT OLD.reporting_treatment OR NEW.transaction_kind IS NOT OLD.transaction_kind
        OR NEW.transfer_to_account_id IS NOT OLD.transfer_to_account_id
        OR NEW.matched_transaction_id IS NOT OLD.matched_transaction_id OR NEW.is_archived IS NOT OLD.is_archived
        OR NEW.import_source IS NOT OLD.import_source OR NEW.import_external_id IS NOT OLD.import_external_id
        OR NEW.import_fingerprint IS NOT OLD.import_fingerprint OR NEW.import_content_fingerprint IS NOT OLD.import_content_fingerprint)
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before changing bank payment evidence'); END`,
  trg_receivable_source_insert: `CREATE TRIGGER trg_receivable_source_insert BEFORE INSERT ON transactions
    WHEN ${protectedSourceCollision(false)}
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before replacing bank payment evidence'); END`,
  trg_receivable_source_unique_update: `CREATE TRIGGER trg_receivable_source_unique_update BEFORE UPDATE ON transactions
    WHEN ${protectedSourceCollision(true)}
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before replacing bank payment evidence'); END`,
  trg_receivable_source_presence_insert: `CREATE TRIGGER trg_receivable_source_presence_insert AFTER INSERT ON transactions
    WHEN ${missingActiveSource}
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before replacing bank payment evidence'); END`,
  trg_receivable_source_presence_update: `CREATE TRIGGER trg_receivable_source_presence_update AFTER UPDATE ON transactions
    WHEN ${missingActiveSource}
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before replacing bank payment evidence'); END`,
  trg_receivable_source_delete: `CREATE TRIGGER trg_receivable_source_delete BEFORE DELETE ON transactions
    WHEN EXISTS (SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = OLD.id AND p.reversed_at IS NULL)
    BEGIN SELECT RAISE(ABORT, 'Reverse receivable payment links before deleting bank payment evidence'); END`,
  trg_receivable_payment_classification_insert: `CREATE TRIGGER trg_receivable_payment_classification_insert BEFORE INSERT ON transaction_consumption_classifications
    WHEN NEW.role NOT IN ('earned_income', 'other_income') AND EXISTS (
      SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = NEW.transaction_id AND p.reversed_at IS NULL)
    BEGIN SELECT RAISE(ABORT, 'A receivable payment must remain ordinary income'); END`,
  trg_receivable_payment_classification_update: `CREATE TRIGGER trg_receivable_payment_classification_update BEFORE UPDATE ON transaction_consumption_classifications
    WHEN NEW.role NOT IN ('earned_income', 'other_income') AND EXISTS (
      SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = NEW.transaction_id AND p.reversed_at IS NULL)
    BEGIN SELECT RAISE(ABORT, 'A receivable payment must remain ordinary income'); END`,
  trg_receivable_payment_card_insert: `CREATE TRIGGER trg_receivable_payment_card_insert BEFORE INSERT ON card_statement_payment_links
    WHEN NEW.voided_at IS NULL AND EXISTS (
      SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = NEW.transaction_id AND p.reversed_at IS NULL)
    BEGIN SELECT RAISE(ABORT, 'A receivable receipt cannot also be a credit-card payment'); END`,
  trg_receivable_payment_card_update: `CREATE TRIGGER trg_receivable_payment_card_update BEFORE UPDATE ON card_statement_payment_links
    WHEN NEW.voided_at IS NULL AND EXISTS (
      SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = NEW.transaction_id AND p.reversed_at IS NULL)
    BEGIN SELECT RAISE(ABORT, 'A receivable receipt cannot also be a credit-card payment'); END`,
}

/** Run the entire migration atomically. Invalid legacy receipts fail closed, without rewriting them. */
export function receivablePaymentsStatements(
  existingColumns: Readonly<Record<string, readonly string[]>>
): string[] {
  return [
    ...(existingColumns.receivables?.includes('unattributed_received_amount')
      ? []
      : [
          `ALTER TABLE receivables ADD COLUMN unattributed_received_amount INTEGER NOT NULL DEFAULT 0
        CHECK (typeof(unattributed_received_amount) = 'integer' AND unattributed_received_amount >= 0 AND unattributed_received_amount <= 9007199254740991)`,
        ]),
    table,
    `CREATE TEMP TABLE receivable_legacy_validation (valid INTEGER CHECK (valid = 1))`,
    `INSERT INTO receivable_legacy_validation SELECT 0 WHERE EXISTS (
      SELECT 1 FROM receivables r LEFT JOIN transactions t ON t.id = r.matched_transaction_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE r.amount <= 0 OR r.received_amount < 0 OR r.received_amount > r.amount
        OR typeof(r.amount) != 'integer' OR typeof(r.received_amount) != 'integer'
        OR r.amount > 9007199254740991
        OR LENGTH(TRIM(r.currency)) != 3 OR UPPER(TRIM(r.currency)) GLOB '*[^A-Z]*'
        OR r.status != CASE WHEN r.status = 'cancelled' THEN 'cancelled'
          WHEN r.received_amount = r.amount THEN 'received'
          WHEN r.received_amount > 0 THEN 'partial' ELSE 'open' END
        OR (r.matched_transaction_id IS NOT NULL AND (
          t.id IS NULL OR t.type != 'income' OR t.amount <= 0 OR t.amount > r.received_amount
          OR t.status NOT IN ('posted', 'cleared')
          OR typeof(t.amount) != 'integer'
          OR t.ledger_treatment IS NOT 'normal' OR t.reporting_treatment IS NOT 'normal'
          OR t.transaction_kind IS NOT 'standard' OR t.matched_transaction_id IS NOT NULL
          OR COALESCE(t.is_archived, 0) != 0
          OR a.id IS NULL OR a.account_mode IS NOT 'transactional'
          OR UPPER(TRIM(t.currency)) IS NOT UPPER(TRIM(r.currency))
          OR (r.account_id IS NOT NULL AND r.account_id != t.account_id)
          OR EXISTS (SELECT 1 FROM card_statement_payment_links p WHERE p.transaction_id = t.id AND p.voided_at IS NULL)
          OR EXISTS (SELECT 1 FROM transaction_consumption_classifications c WHERE c.transaction_id = t.id AND c.role NOT IN ('earned_income', 'other_income'))
        ))
    )`,
    `DROP TABLE receivable_legacy_validation`,
    `UPDATE receivables SET unattributed_received_amount = received_amount - COALESCE(
      (SELECT t.amount FROM transactions t WHERE t.id = receivables.matched_transaction_id), 0)`,
    `INSERT INTO receivable_payment_links (id, receivable_id, transaction_id, amount, currency,
      transaction_date, transaction_snapshot_json, source, note, created_at)
      SELECT 'legacy_receivable_payment:' || r.id, r.id, t.id, t.amount, UPPER(TRIM(t.currency)), t.date,
        json_object('provenance', 'legacy_link_migration', 'id', t.id, 'account_id', t.account_id,
          'amount', t.amount, 'currency', t.currency, 'date', t.date, 'description', t.description,
          'type', t.type, 'status', t.status, 'import_source', t.import_source,
          'import_external_id', t.import_external_id, 'import_fingerprint', t.import_fingerprint,
          'import_content_fingerprint', t.import_content_fingerprint),
        r.source, r.note, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM receivables r JOIN transactions t ON t.id = r.matched_transaction_id`,
    ...Object.entries(RECEIVABLE_PAYMENTS_OBJECTS)
      .filter(([name]) => name !== 'receivable_payment_links')
      .map(([, sql]) => sql),
    `INSERT INTO _migrations (id, name) VALUES (26, '${RECEIVABLE_PAYMENTS_MIGRATION}')`,
  ]
}

export function assertReceivablePaymentsReady(
  columns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[]
): void {
  for (const [name, required] of Object.entries(RECEIVABLE_PAYMENTS_SCHEMA)) {
    if (required.some((column) => !columns[name]?.includes(column)))
      throw new Error(`Database is not ready. Missing 026 columns on ${name}`)
  }
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase()
  for (const [name, sql] of Object.entries(RECEIVABLE_PAYMENTS_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql))
      throw new Error(`Database is not ready. Missing or incompatible 026 schema object: ${name}`)
  }
}
