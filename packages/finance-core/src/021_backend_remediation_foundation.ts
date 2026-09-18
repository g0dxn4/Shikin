/** Versioned, complete SQLite statements. Never split these on semicolons (triggers).
 * Callers must check the migration marker and execute the entire list, including
 * the marker, inside one real transaction. No domain evidence is inferred here.
 */
export const BACKEND_FOUNDATION_MIGRATION = '021_backend_remediation_foundation'
export const BACKEND_FOUNDATION_VERSION = 21

const timestamp = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
type AddedColumn = { table: string; name: string; definition: string; initialize?: string }
export const BACKEND_FOUNDATION_COLUMNS: readonly AddedColumn[] = [
  {
    table: 'accounts',
    name: 'valuation_mode',
    definition:
      "TEXT NOT NULL DEFAULT 'unresolved' CHECK (valuation_mode IN ('cash_plus_holdings', 'portfolio_snapshot', 'unresolved'))",
    initialize: `UPDATE accounts SET valuation_mode = CASE
      WHEN account_mode = 'snapshot_only' THEN 'portfolio_snapshot'
      WHEN type NOT IN ('investment', 'crypto') THEN 'cash_plus_holdings'
      ELSE 'unresolved' END`,
  },
  { table: 'investments', name: 'quantity_decimal', definition: 'TEXT' },
  { table: 'investments', name: 'avg_cost_basis_decimal', definition: 'TEXT' },
  {
    table: 'investments',
    name: 'cost_basis_known',
    definition: 'INTEGER NOT NULL DEFAULT 0 CHECK (cost_basis_known IN (0, 1))',
    // Integer division/remainder only: no floating point formatting or recovered quantity.
    initialize: `UPDATE investments SET avg_cost_basis_decimal =
      CAST(avg_cost_basis / 100 AS TEXT) || '.' || printf('%02d', avg_cost_basis % 100),
      cost_basis_known = 1
      WHERE typeof(avg_cost_basis) = 'integer' AND avg_cost_basis > 0
        AND avg_cost_basis <= 9007199254740991 AND avg_cost_basis_decimal IS NULL`,
  },
  { table: 'investments', name: 'instrument_key', definition: 'TEXT' },
  {
    table: 'transactions',
    name: 'finalization_id',
    definition: 'TEXT REFERENCES account_reconciliations(id) ON DELETE RESTRICT',
  },
  { table: 'transactions', name: 'import_content_fingerprint', definition: 'TEXT' },
  {
    table: 'account_reconciliations',
    name: 'selection_mode',
    definition:
      "TEXT NOT NULL DEFAULT 'legacy_batch' CHECK (selection_mode IN ('legacy_batch', 'explicit_rows'))",
  },
  {
    table: 'credit_card_statements',
    name: 'unattributed_paid_amount',
    definition: 'INTEGER NOT NULL DEFAULT 0',
    initialize: 'UPDATE credit_card_statements SET unattributed_paid_amount = paid_amount',
  },
  {
    table: 'cashflow_bucket_allocations',
    name: 'reverses_allocation_id',
    definition: 'TEXT REFERENCES cashflow_bucket_allocations(id) ON DELETE RESTRICT',
  },
  {
    table: 'cashflow_bucket_allocations',
    name: 'replaces_allocation_id',
    definition: 'TEXT REFERENCES cashflow_bucket_allocations(id) ON DELETE RESTRICT',
  },
  {
    table: 'recaps',
    name: 'basis',
    definition:
      "TEXT NOT NULL DEFAULT 'gross_cashflow' CHECK (basis IN ('gross_cashflow', 'net_consumption'))",
  },
  { table: 'recaps', name: 'currency_scope', definition: "TEXT NOT NULL DEFAULT 'all'" },
]

const tables: Record<string, Record<string, string>> = {
  instrument_prices: {
    id: 'TEXT PRIMARY KEY',
    instrument_key: 'TEXT NOT NULL',
    asset_type: 'TEXT NOT NULL',
    provider: 'TEXT NOT NULL',
    instrument_id: 'TEXT NOT NULL',
    exchange: "TEXT NOT NULL DEFAULT ''",
    quote_currency: 'TEXT NOT NULL',
    unit_price_decimal: 'TEXT NOT NULL',
    quote_date: 'TEXT NOT NULL',
    created_at: timestamp,
  },
  transaction_consumption_classifications: {
    id: 'TEXT PRIMARY KEY',
    transaction_id: 'TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT',
    split_id: 'TEXT REFERENCES transaction_splits(id) ON DELETE RESTRICT',
    role: "TEXT NOT NULL CHECK (role IN ('purchase', 'fee', 'earned_income', 'refund', 'internal_inflow', 'cash_withdrawal', 'principal'))",
    referenced_purchase_id: `TEXT REFERENCES transaction_consumption_classifications(id) ON DELETE RESTRICT
      CHECK ((role IN ('refund', 'principal') AND referenced_purchase_id IS NOT NULL)
        OR (role NOT IN ('refund', 'principal') AND referenced_purchase_id IS NULL))
      CHECK (referenced_purchase_id IS NULL OR referenced_purchase_id <> id)`,
    created_at: timestamp,
    updated_at: timestamp,
  },
  source_coverage: {
    id: 'TEXT PRIMARY KEY',
    account_id: 'TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT',
    source_namespace: 'TEXT NOT NULL',
    period_start: 'TEXT NOT NULL',
    period_end: 'TEXT NOT NULL CHECK (period_end >= period_start)',
    status: "TEXT NOT NULL CHECK (status IN ('verified', 'provisional', 'gap'))",
    zero_rows: 'INTEGER NOT NULL DEFAULT 0 CHECK (zero_rows IN (0, 1))',
    document_ref: 'TEXT',
    source: 'TEXT',
    note: 'TEXT',
    created_at: timestamp,
    updated_at: timestamp,
  },
  reconciliation_corrections: {
    id: 'TEXT PRIMARY KEY',
    original_reconciliation_id:
      'TEXT NOT NULL REFERENCES account_reconciliations(id) ON DELETE RESTRICT',
    original_bridge_id: 'TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT',
    successor_reconciliation_id:
      'TEXT NOT NULL REFERENCES account_reconciliations(id) ON DELETE RESTRICT',
    successor_bridge_id: 'TEXT REFERENCES transactions(id) ON DELETE RESTRICT',
    replacement_transaction_ids_json: 'TEXT NOT NULL',
    source: 'TEXT',
    note: 'TEXT',
    created_at: timestamp,
  },
  // Historical identities deliberately have no FK: deleting a holding/row must not
  // delete or relabel evidence. Services validate identities at creation time.
  transfer_match_provenance: {
    id: 'TEXT PRIMARY KEY',
    source_transaction_id: 'TEXT NOT NULL',
    mirror_transaction_id: 'TEXT NOT NULL CHECK (mirror_transaction_id <> source_transaction_id)',
    source_before_json: 'TEXT NOT NULL',
    mirror_before_json: 'TEXT NOT NULL',
    matched_at: timestamp,
    unmatched_at: 'TEXT',
  },
  duplicate_review_decisions: {
    id: 'TEXT PRIMARY KEY',
    account_id: 'TEXT NOT NULL',
    existing_transaction_id: 'TEXT NOT NULL',
    candidate_identity_key: 'TEXT NOT NULL',
    candidate_content_fingerprint: 'TEXT NOT NULL',
    existing_evidence_fingerprint: 'TEXT NOT NULL',
    decision: "TEXT NOT NULL CHECK (decision IN ('distinct', 'keep_existing'))",
    source: 'TEXT',
    note: 'TEXT',
    created_at: timestamp,
  },
  card_statement_payment_links: {
    id: 'TEXT PRIMARY KEY',
    statement_id: 'TEXT NOT NULL REFERENCES credit_card_statements(id) ON DELETE RESTRICT',
    transaction_id: 'TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT',
    amount: "INTEGER NOT NULL CHECK (typeof(amount) = 'integer' AND amount > 0)",
    mode: "TEXT NOT NULL CHECK (mode IN ('apply_to_unpaid', 'attribute_existing'))",
    source: 'TEXT',
    note: 'TEXT',
    created_at: timestamp,
    voided_at: 'TEXT',
  },
  app_data_state: {
    id: 'INTEGER PRIMARY KEY CHECK (id = 1)',
    database_id: 'TEXT NOT NULL UNIQUE',
    data_revision:
      "INTEGER NOT NULL DEFAULT 0 CHECK (typeof(data_revision) = 'integer' AND data_revision >= 0)",
    last_financial_write_at: 'TEXT',
  },
}

/** New columns plus complete new-table columns, for latest-schema readiness. */
export const BACKEND_FOUNDATION_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(
    Object.entries(tables).map(([table, columns]) => [table, Object.keys(columns)])
  ),
  ...Object.fromEntries(
    [...new Set(BACKEND_FOUNDATION_COLUMNS.map((c) => c.table))].map((table) => [
      table,
      BACKEND_FOUNDATION_COLUMNS.filter((c) => c.table === table).map((c) => c.name),
    ])
  ),
}

/** Explicit allowlist: never audit_log, recaps, extension_data, _migrations or internal tables. */
export const FINANCIAL_REVISION_TABLES = [
  'accounts',
  'categories',
  'subcategories',
  'transactions',
  'transaction_splits',
  'subscriptions',
  'budgets',
  'budget_periods',
  'investments',
  'stock_prices',
  'instrument_prices',
  'exchange_rates',
  'settings',
  'category_rules',
  'recurring_rules',
  'goals',
  'net_worth_snapshots',
  'account_balance_history',
  'cashflow_buckets',
  'cashflow_bucket_allocations',
  'category_suggestions',
  'credit_card_statements',
  'account_reconciliations',
  'receivables',
  'transaction_consumption_classifications',
  'source_coverage',
  'reconciliation_corrections',
  'transfer_match_provenance',
  'duplicate_review_decisions',
  'card_statement_payment_links',
] as const

const indexes: Record<string, string> = {
  idx_instrument_prices_key_date:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_instrument_prices_key_date ON instrument_prices(instrument_key, quote_date)',
  idx_consumption_unsplit:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_consumption_unsplit ON transaction_consumption_classifications(transaction_id) WHERE split_id IS NULL',
  idx_consumption_split:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_consumption_split ON transaction_consumption_classifications(split_id) WHERE split_id IS NOT NULL',
  idx_consumption_reference:
    'CREATE INDEX IF NOT EXISTS idx_consumption_reference ON transaction_consumption_classifications(referenced_purchase_id)',
  idx_transactions_finalization:
    'CREATE INDEX IF NOT EXISTS idx_transactions_finalization ON transactions(finalization_id)',
  idx_reconciliations_batch_unique:
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliations_batch_unique ON account_reconciliations(account_id, staging_batch_id) WHERE staging_batch_id IS NOT NULL AND selection_mode = 'legacy_batch'",
  idx_allocations_reversal_unique:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_allocations_reversal_unique ON cashflow_bucket_allocations(reverses_allocation_id) WHERE reverses_allocation_id IS NOT NULL',
  idx_match_provenance_source_active:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_match_provenance_source_active ON transfer_match_provenance(source_transaction_id) WHERE unmatched_at IS NULL',
  idx_match_provenance_mirror_active:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_match_provenance_mirror_active ON transfer_match_provenance(mirror_transaction_id) WHERE unmatched_at IS NULL',
  idx_payment_links_statement:
    'CREATE INDEX IF NOT EXISTS idx_payment_links_statement ON card_statement_payment_links(statement_id)',
  idx_payment_links_transaction:
    'CREATE INDEX IF NOT EXISTS idx_payment_links_transaction ON card_statement_payment_links(transaction_id)',
}
const triggers: Record<string, string> = {}
for (const operation of ['INSERT', 'UPDATE']) {
  const name = `trg_match_provenance_active_${operation.toLowerCase()}`
  triggers[name] =
    `CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${operation} ON transfer_match_provenance
    WHEN NEW.unmatched_at IS NULL AND EXISTS (
      SELECT 1 FROM transfer_match_provenance WHERE unmatched_at IS NULL
        ${operation === 'UPDATE' ? 'AND id <> OLD.id' : ''}
        AND (source_transaction_id IN (NEW.source_transaction_id, NEW.mirror_transaction_id)
          OR mirror_transaction_id IN (NEW.source_transaction_id, NEW.mirror_transaction_id)))
    BEGIN SELECT RAISE(ABORT, 'Transaction already has active match provenance'); END`
}
for (const operation of ['UPDATE', 'DELETE']) {
  const name = `trg_duplicate_decisions_immutable_${operation.toLowerCase()}`
  triggers[name] =
    `CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${operation} ON duplicate_review_decisions
    BEGIN SELECT RAISE(ABORT, 'Duplicate review evidence is immutable'); END`
}
for (const table of FINANCIAL_REVISION_TABLES) {
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const name = `trg_data_revision_${table}_${operation.toLowerCase()}`
    triggers[name] = `CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${operation} ON ${table}
      BEGIN UPDATE app_data_state SET data_revision = data_revision + 1,
        last_financial_write_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1; END`
  }
}

export const BACKEND_FOUNDATION_OBJECTS: Readonly<Record<string, string>> = {
  ...indexes,
  ...triggers,
}

export function backendFoundationStatements(
  existingColumns: Readonly<Record<string, readonly string[]>>
): string[] {
  const statements: string[] = []
  for (const column of BACKEND_FOUNDATION_COLUMNS) {
    if (existingColumns[column.table]?.includes(column.name)) continue
    statements.push(`ALTER TABLE ${column.table} ADD COLUMN ${column.name} ${column.definition}`)
    if (column.initialize) statements.push(column.initialize)
  }
  for (const [table, columns] of Object.entries(tables)) {
    statements.push(
      `CREATE TABLE IF NOT EXISTS ${table} (${Object.entries(columns)
        .map(([name, definition]) => `${name} ${definition}`)
        .join(',\n')})`
    )
  }
  statements.push(
    'DROP INDEX IF EXISTS idx_reconciliations_batch_unique',
    ...Object.values(indexes),
    // Initialize before triggers; unknown historical last-write stays NULL.
    'INSERT OR IGNORE INTO app_data_state (id, database_id) VALUES (1, lower(hex(randomblob(16))))',
    ...Object.values(triggers),
    `INSERT INTO _migrations (id, name) VALUES (21, '${BACKEND_FOUNDATION_MIGRATION}')`
  )
  return statements
}

/** Only protects callers shipping this check; it cannot protect older binaries. */
export function assertSupportedSchemaVersion(rows: readonly { id?: number; name: string }[]): void {
  if (
    rows.some(
      (row) =>
        Number(row.id ?? 0) > BACKEND_FOUNDATION_VERSION ||
        Number.parseInt(row.name, 10) > BACKEND_FOUNDATION_VERSION
    )
  ) {
    throw new Error(
      'Database schema is newer than this application supports. Upgrade the app, CLI and MCP together.'
    )
  }
}

/** Compare generated objects too, not just a migration marker/column names. */
export function assertBackendFoundationReady(
  columns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[],
  states: readonly { id: number; database_id: string; data_revision: number }[]
): void {
  for (const [table, required] of Object.entries(BACKEND_FOUNDATION_SCHEMA)) {
    const missing = required.filter((column) => !columns[table]?.includes(column))
    if (missing.length)
      throw new Error(
        `Database is not ready for CLI/MCP use. Missing 021 columns on ${table}: ${missing.join(', ')}`
      )
  }
  const normalize = (sql: string) =>
    sql
      .replace(/\bIF NOT EXISTS\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/;$/, '')
      .toLowerCase()
  for (const [name, sql] of Object.entries(BACKEND_FOUNDATION_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql)) {
      throw new Error(
        `Database is not ready for CLI/MCP use. Missing or incompatible 021 schema object: ${name}`
      )
    }
  }
  const state = states[0]
  if (
    states.length !== 1 ||
    !state ||
    state.id !== 1 ||
    !state.database_id ||
    !Number.isSafeInteger(state.data_revision) ||
    state.data_revision < 0
  ) {
    throw new Error('Database is not ready for CLI/MCP use. Invalid app_data_state singleton.')
  }
}
