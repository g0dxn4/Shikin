export const BUDGET_HISTORY_MIGRATION = '025_budget_history'
export const BUDGET_HISTORY_VERSION = 25

/** Deliberately no foreign key to budgets, categories, or transactions: deleting a
 * live definition must never delete or rewrite the evidence captured for a month.
 * WITHOUT ROWID also prevents hidden integer-rowid conflicts from bypassing the
 * explicit identity guards through INSERT OR REPLACE.
 */
const columns = {
  id: 'TEXT PRIMARY KEY',
  budget_id: 'TEXT NOT NULL CHECK (length(trim(budget_id)) BETWEEN 1 AND 128)',
  month:
    "TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND substr(month, 6, 2) BETWEEN '01' AND '12')",
  revision:
    "INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991)",
  supersedes_id: 'TEXT REFERENCES budget_history_revisions(id) ON DELETE RESTRICT',
  kind: "TEXT NOT NULL CHECK (kind IN ('capture', 'retrospective_reconstruction', 'correction'))",
  snapshot_json: `TEXT NOT NULL CHECK (CASE WHEN json_valid(snapshot_json) THEN
    json_type(snapshot_json) = 'object'
    AND COALESCE(json_extract(snapshot_json, '$.schemaVersion'), 0) = 1
    AND COALESCE(json_type(snapshot_json, '$.configuration.amountCentavos'), '') = 'integer'
    AND json_extract(snapshot_json, '$.configuration.amountCentavos') BETWEEN 1 AND 9007199254740991
    AND COALESCE(json_type(snapshot_json, '$.gross.amountCentavos'), '') IN ('integer', 'null')
    AND COALESCE(json_type(snapshot_json, '$.net.amountCentavos'), '') IN ('integer', 'null')
    ELSE 0 END)`,
  reason: 'TEXT NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 1000)',
  source: "TEXT NOT NULL CHECK (source IN ('app', 'cli_mcp'))",
  idempotency_key: 'TEXT NOT NULL UNIQUE CHECK (length(trim(idempotency_key)) BETWEEN 1 AND 128)',
  request_json:
    "TEXT NOT NULL CHECK (CASE WHEN json_valid(request_json) THEN json_type(request_json) = 'object' ELSE 0 END)",
  created_at: "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
} as const

export const BUDGET_HISTORY_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  budget_history_revisions: Object.keys(columns),
}

export const BUDGET_HISTORY_OBJECTS: Readonly<Record<string, string>> = {
  budget_history_revisions: `CREATE TABLE budget_history_revisions (
    ${Object.entries(columns)
      .map(([name, definition]) => `${name} ${definition}`)
      .join(',\n    ')},
    UNIQUE (budget_id, month, revision),
    CHECK ((revision = 1 AND supersedes_id IS NULL AND kind <> 'correction') OR
      (revision > 1 AND supersedes_id IS NOT NULL AND kind = 'correction'))
  ) WITHOUT ROWID`,
  idx_budget_history_month:
    'CREATE INDEX idx_budget_history_month ON budget_history_revisions(month, budget_id, revision)',
  trg_budget_history_chain: `CREATE TRIGGER trg_budget_history_chain BEFORE INSERT ON budget_history_revisions
    BEGIN
      SELECT RAISE(ABORT, 'Budget history identity already exists; replay the original request')
      WHERE EXISTS (SELECT 1 FROM budget_history_revisions
        WHERE id = NEW.id OR idempotency_key = NEW.idempotency_key);
      SELECT RAISE(ABORT, 'Budget history revision conflict; read the latest revision and retry')
      WHERE NEW.revision <> COALESCE((SELECT MAX(revision) FROM budget_history_revisions
        WHERE budget_id = NEW.budget_id AND month = NEW.month), 0) + 1
        OR (NEW.revision > 1 AND NOT EXISTS (SELECT 1 FROM budget_history_revisions
          WHERE id = NEW.supersedes_id AND budget_id = NEW.budget_id AND month = NEW.month
            AND revision = NEW.revision - 1));
    END`,
  trg_budget_history_no_update: `CREATE TRIGGER trg_budget_history_no_update BEFORE UPDATE ON budget_history_revisions
    BEGIN SELECT RAISE(ABORT, 'Budget history is append-only; record a correction revision'); END`,
  trg_budget_history_no_delete: `CREATE TRIGGER trg_budget_history_no_delete BEFORE DELETE ON budget_history_revisions
    BEGIN SELECT RAISE(ABORT, 'Budget history is append-only; record a correction revision'); END`,
  trg_data_revision_budget_history_insert: `CREATE TRIGGER trg_data_revision_budget_history_insert AFTER INSERT ON budget_history_revisions
    BEGIN UPDATE app_data_state SET data_revision = data_revision + 1,
      last_financial_write_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1; END`,
}

/** Run the complete batch within a write transaction; no historical limits are inferred. */
export function budgetHistoryStatements(): string[] {
  return [
    ...Object.values(BUDGET_HISTORY_OBJECTS),
    `INSERT INTO _migrations (id, name) VALUES (25, '${BUDGET_HISTORY_MIGRATION}')`,
  ]
}

export function assertBudgetHistoryReady(
  existingColumns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[]
): void {
  for (const [table, required] of Object.entries(BUDGET_HISTORY_SCHEMA)) {
    if (required.some((column) => !existingColumns[table]?.includes(column)))
      throw new Error(`Database is not ready. Missing 025 columns on ${table}`)
  }
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase()
  for (const [name, sql] of Object.entries(BUDGET_HISTORY_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql))
      throw new Error(`Database is not ready. Missing or incompatible 025 schema object: ${name}`)
  }
}
