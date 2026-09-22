import { FX_CURRENCIES } from './fx.js'

export const DATED_FX_MIGRATION = '022_dated_fx'
export const DATED_FX_VERSION = 22
const currencies = FX_CURRENCIES.map((code) => `'${code}'`).join(', ')
const currency = (name: string) => `TEXT NOT NULL CHECK (${name} IN (${currencies}))`
const decimal = (name: string) => `TEXT NOT NULL CHECK (
  length(${name}) BETWEEN 1 AND 81 AND ${name} NOT GLOB '*[^0-9.]*'
  AND ${name} GLOB '[0-9]*' AND substr(${name}, -1) <> '.'
  AND length(${name}) - length(replace(${name}, '.', '')) <= 1
  AND length(replace(${name}, '.', '')) <= 80
  AND (instr(${name}, '.') = 0 OR length(${name}) - instr(${name}, '.') <= 40)
  AND ${name} GLOB '*[1-9]*')`
const date = (name: string) => `TEXT NOT NULL CHECK (length(${name}) = 10
  AND ${name} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  AND substr(${name}, 1, 4) <> '0000'
  AND date(${name}, '+0 days') IS NOT NULL AND date(${name}, '+0 days') = ${name})`
const amount = (name: string) =>
  `INTEGER NOT NULL CHECK (typeof(${name}) = 'integer' AND ${name} BETWEEN 0 AND 9007199254740991)`
export const DATED_FX_COLUMNS = ['budgets', 'goals'].map((table) => ({
  table,
  name: 'currency',
  definition: `TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN (${currencies}))`,
}))
const tables: Record<string, Record<string, string>> = {
  manual_exchange_rates: {
    id: 'TEXT PRIMARY KEY NOT NULL',
    from_currency: currency('from_currency'),
    to_currency: `${currency('to_currency')} CHECK (from_currency <> to_currency)`,
    rate_decimal: decimal('rate_decimal'),
    effective_from: date('effective_from'),
    supersedes_rate_id:
      'TEXT REFERENCES manual_exchange_rates(id) ON DELETE RESTRICT CHECK (supersedes_rate_id IS NULL OR supersedes_rate_id <> id)',
    source_note: 'TEXT CHECK (source_note IS NULL OR length(source_note) <= 1000)',
    created_at: 'TEXT NOT NULL',
  },
  // Acceptance snapshot, never an authority for CURRENT transaction status/balance.
  transaction_fx_evidence: {
    id: 'TEXT PRIMARY KEY NOT NULL',
    transaction_id:
      'TEXT REFERENCES transactions(id) ON DELETE SET NULL CHECK (transaction_id IS NULL OR transaction_id = original_transaction_id)',
    original_transaction_id: 'TEXT NOT NULL',
    original_account_id: 'TEXT NOT NULL',
    transaction_type: "TEXT NOT NULL CHECK (transaction_type IN ('income', 'expense'))",
    status: "TEXT NOT NULL CHECK (status IN ('pending', 'posted', 'cleared'))",
    ledger_treatment:
      "TEXT NOT NULL CHECK (ledger_treatment IN ('normal', 'staged_no_balance_impact'))",
    input_amount_centavos: amount('input_amount_centavos'),
    input_currency: currency('input_currency'),
    account_amount_centavos: amount('account_amount_centavos'),
    account_currency: currency('account_currency'),
    account_balance_delta_centavos: `INTEGER NOT NULL CHECK (typeof(account_balance_delta_centavos) = 'integer'
      AND account_balance_delta_centavos BETWEEN -9007199254740991 AND 9007199254740991
      AND (account_balance_delta_centavos = 0 OR
        (status <> 'pending' AND ledger_treatment = 'normal' AND
          account_balance_delta_centavos = CASE transaction_type WHEN 'income' THEN account_amount_centavos ELSE -account_amount_centavos END)))`,
    transaction_date: date('transaction_date'),
    rate_id: 'TEXT REFERENCES manual_exchange_rates(id) ON DELETE RESTRICT',
    rate_decimal: `${decimal('rate_decimal')} CHECK (
      (input_currency = account_currency AND rate_id IS NULL AND rate_decimal = '1' AND input_amount_centavos = account_amount_centavos)
      OR (input_currency <> account_currency AND rate_id IS NOT NULL))`,
    created_at: 'TEXT NOT NULL',
  },
}
export const DATED_FX_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  ...Object.fromEntries(
    Object.entries(tables).map(([table, columns]) => [table, Object.keys(columns)])
  ),
  budgets: ['currency'],
  goals: ['currency'],
}
const objects: Record<string, string> = {
  idx_manual_fx_root:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_fx_root ON manual_exchange_rates(from_currency, to_currency, effective_from) WHERE supersedes_rate_id IS NULL',
  idx_manual_fx_successor:
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_fx_successor ON manual_exchange_rates(supersedes_rate_id) WHERE supersedes_rate_id IS NOT NULL',
  idx_fx_evidence_original:
    'CREATE INDEX IF NOT EXISTS idx_fx_evidence_original ON transaction_fx_evidence(original_transaction_id, created_at, id)',
  idx_fx_evidence_live:
    'CREATE INDEX IF NOT EXISTS idx_fx_evidence_live ON transaction_fx_evidence(transaction_id, created_at, id)',
  trg_manual_fx_append_only: `CREATE TRIGGER IF NOT EXISTS trg_manual_fx_append_only BEFORE INSERT ON manual_exchange_rates
    WHEN EXISTS (SELECT 1 FROM manual_exchange_rates WHERE id = NEW.id
      OR (NEW.supersedes_rate_id IS NULL AND supersedes_rate_id IS NULL AND from_currency = NEW.from_currency AND to_currency = NEW.to_currency AND effective_from = NEW.effective_from)
      OR (NEW.supersedes_rate_id IS NOT NULL AND supersedes_rate_id = NEW.supersedes_rate_id))
    BEGIN SELECT RAISE(ABORT, 'Manual FX history is append-only; duplicate root or stale correction'); END`,
  trg_fx_evidence_append_only: `CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_append_only BEFORE INSERT ON transaction_fx_evidence
    WHEN EXISTS (SELECT 1 FROM transaction_fx_evidence WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'FX evidence is append-only'); END`,
  trg_manual_fx_predecessor: `CREATE TRIGGER IF NOT EXISTS trg_manual_fx_predecessor BEFORE INSERT ON manual_exchange_rates
    WHEN NEW.supersedes_rate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM manual_exchange_rates
      WHERE id = NEW.supersedes_rate_id AND from_currency = NEW.from_currency AND to_currency = NEW.to_currency AND effective_from = NEW.effective_from)
    BEGIN SELECT RAISE(ABORT, 'Correction must retain predecessor pair/date'); END`,
  trg_fx_evidence_rate: `CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_rate BEFORE INSERT ON transaction_fx_evidence
    WHEN NEW.rate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM manual_exchange_rates WHERE id = NEW.rate_id
      AND from_currency = NEW.input_currency AND to_currency = NEW.account_currency
      AND rate_decimal = NEW.rate_decimal AND effective_from <= NEW.transaction_date)
    BEGIN SELECT RAISE(ABORT, 'FX acceptance rate does not match snapshot'); END`,
}
for (const operation of ['UPDATE', 'DELETE']) {
  const name = `trg_manual_fx_immutable_${operation.toLowerCase()}`
  objects[name] =
    `CREATE TRIGGER IF NOT EXISTS ${name} BEFORE ${operation} ON manual_exchange_rates BEGIN SELECT RAISE(ABORT, 'Manual FX history is immutable'); END`
}
objects.trg_fx_evidence_immutable_delete = `CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_immutable_delete BEFORE DELETE ON transaction_fx_evidence BEGIN SELECT RAISE(ABORT, 'FX evidence is retained'); END`
const unchanged = Object.keys(tables.transaction_fx_evidence!)
  .filter((column) => column !== 'transaction_id')
  .map((column) => `NEW.${column} IS OLD.${column}`)
  .join(' AND ')
objects.trg_fx_evidence_immutable_update = `CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_immutable_update BEFORE UPDATE ON transaction_fx_evidence
  WHEN NOT (${unchanged} AND OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM transactions WHERE id = OLD.transaction_id))
  BEGIN SELECT RAISE(ABORT, 'FX evidence is immutable except deletion retention'); END`
export const DATED_FX_REVISION_TABLES = [
  'manual_exchange_rates',
  'transaction_fx_evidence',
] as const
for (const table of DATED_FX_REVISION_TABLES) {
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const name = `trg_data_revision_${table}_${operation.toLowerCase()}`
    objects[name] = `CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${operation} ON ${table}
      BEGIN UPDATE app_data_state SET data_revision = data_revision + 1,
        last_financial_write_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1; END`
  }
}
export const DATED_FX_OBJECTS: Readonly<Record<string, string>> = objects
export function datedFxStatements(
  existingColumns: Readonly<Record<string, readonly string[]>>
): string[] {
  return [
    ...DATED_FX_COLUMNS.filter((c) => !existingColumns[c.table]?.includes(c.name)).map(
      (c) => `ALTER TABLE ${c.table} ADD COLUMN ${c.name} ${c.definition}`
    ),
    ...Object.entries(tables).map(
      ([table, columns]) =>
        `CREATE TABLE IF NOT EXISTS ${table} (${Object.entries(columns)
          .map(([name, definition]) => `${name} ${definition}`)
          .join(',\n')})`
    ),
    ...Object.values(DATED_FX_OBJECTS),
    `INSERT INTO _migrations (id, name) VALUES (22, '${DATED_FX_MIGRATION}')`,
  ]
}
export function assertDatedFxReady(
  columns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[]
): void {
  for (const [table, required] of Object.entries(DATED_FX_SCHEMA)) {
    if (required.some((column) => !columns[table]?.includes(column)))
      throw new Error(`Database is not ready. Missing 022 columns on ${table}`)
  }
  const normalize = (sql: string) =>
    sql
      .replace(/\bIF NOT EXISTS\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/;$/, '')
      .toLowerCase()
  for (const [name, sql] of Object.entries(DATED_FX_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql))
      throw new Error(`Database is not ready. Missing or incompatible 022 schema object: ${name}`)
  }
}
