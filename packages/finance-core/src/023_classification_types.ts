import { BACKEND_FOUNDATION_OBJECTS } from './021_backend_remediation_foundation.js'
import { consumptionRoles } from './classification-policy.js'

export const CLASSIFICATION_TYPES_MIGRATION = '023_classification_types'
export const CLASSIFICATION_TYPES_VERSION = 23
const roles = consumptionRoles.map((role) => `'${role}'`).join(', ')
const timestamp = "TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
const assignmentTable = 'transaction_consumption_classifications'
const replacementTable = 'classification_assignments_023'
const assignmentSql = (table: string) => `CREATE TABLE ${table} (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  split_id TEXT REFERENCES transaction_splits(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN (${roles})),
  referenced_purchase_id TEXT REFERENCES ${table}(id) ON DELETE RESTRICT
    CHECK ((role IN ('refund', 'principal') AND referenced_purchase_id IS NOT NULL)
      OR (role NOT IN ('refund', 'principal') AND referenced_purchase_id IS NULL))
    CHECK (referenced_purchase_id IS NULL OR referenced_purchase_id <> id),
  created_at ${timestamp},
  updated_at ${timestamp},
  type_revision_id TEXT REFERENCES classification_type_revisions(id) ON DELETE RESTRICT
)`
const tables = {
  classification_types: `CREATE TABLE classification_types (
    id TEXT PRIMARY KEY NOT NULL,
    current_revision_id TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at ${timestamp},
    updated_at ${timestamp},
    FOREIGN KEY (id, current_revision_id) REFERENCES classification_type_revisions(type_id, id)
      ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
  )`,
  classification_type_revisions: `CREATE TABLE classification_type_revisions (
    id TEXT PRIMARY KEY NOT NULL,
    type_id TEXT NOT NULL REFERENCES classification_types(id) ON DELETE RESTRICT,
    version INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version BETWEEN 1 AND 9007199254740991),
    name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name = trim(name)),
    financial_treatment TEXT NOT NULL CHECK (financial_treatment IN (${roles})),
    created_at ${timestamp},
    UNIQUE (type_id, version),
    UNIQUE (type_id, id)
  )`,
  transaction_consumption_classifications: assignmentSql(assignmentTable),
}
export const CLASSIFICATION_TYPES_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  classification_types: ['id', 'current_revision_id', 'archived', 'created_at', 'updated_at'],
  classification_type_revisions: [
    'id',
    'type_id',
    'version',
    'name',
    'financial_treatment',
    'created_at',
  ],
  transaction_consumption_classifications: [
    'id',
    'transaction_id',
    'split_id',
    'role',
    'referenced_purchase_id',
    'created_at',
    'updated_at',
    'type_revision_id',
  ],
}
const objects: Record<string, string> = {
  ...tables,
  // Restore every existing classification index and financial-revision trigger after rebuilding.
  ...Object.fromEntries(
    Object.entries(BACKEND_FOUNDATION_OBJECTS).filter(([, sql]) =>
      sql.includes(`ON ${assignmentTable}`)
    )
  ),
  idx_classification_type_revision: `CREATE INDEX idx_classification_type_revision ON ${assignmentTable}(type_revision_id)`,
  trg_classification_revision_append_only: `CREATE TRIGGER trg_classification_revision_append_only BEFORE INSERT ON classification_type_revisions
    WHEN EXISTS (SELECT 1 FROM classification_type_revisions WHERE id = NEW.id OR (type_id = NEW.type_id AND version = NEW.version))
    BEGIN SELECT RAISE(ABORT, 'Classification type revisions are append-only'); END`,
  trg_classification_type_identity: `CREATE TRIGGER trg_classification_type_identity BEFORE UPDATE OF id, created_at ON classification_types
    WHEN NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at
    BEGIN SELECT RAISE(ABORT, 'Classification type identity is immutable'); END`,
  trg_classification_type_no_replace: `CREATE TRIGGER trg_classification_type_no_replace BEFORE INSERT ON classification_types
    WHEN EXISTS (SELECT 1 FROM classification_types WHERE id = NEW.id)
    BEGIN SELECT RAISE(ABORT, 'Classification type identity already exists'); END`,
  trg_classification_type_no_delete: `CREATE TRIGGER trg_classification_type_no_delete BEFORE DELETE ON classification_types
    BEGIN SELECT RAISE(ABORT, 'Archive classification types instead of deleting'); END`,
}
for (const operation of ['UPDATE', 'DELETE']) {
  const name = `trg_classification_revision_immutable_${operation.toLowerCase()}`
  objects[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON classification_type_revisions
    BEGIN SELECT RAISE(ABORT, 'Classification type revisions are immutable'); END`
}
for (const operation of ['INSERT', 'UPDATE']) {
  const name = `trg_classification_assignment_revision_${operation.toLowerCase()}`
  objects[name] = `CREATE TRIGGER ${name} BEFORE ${operation} ON ${assignmentTable}
    WHEN NEW.type_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM classification_type_revisions
      WHERE id = NEW.type_revision_id AND financial_treatment = NEW.role)
    BEGIN SELECT RAISE(ABORT, 'Classification role must match pinned revision'); END`
  const archive = `trg_classification_assignment_archive_${operation.toLowerCase()}`
  objects[archive] = `CREATE TRIGGER ${archive} BEFORE ${operation} ON ${assignmentTable}
    WHEN NEW.type_revision_id IS NOT NULL ${operation === 'UPDATE' ? 'AND (NEW.type_revision_id IS NOT OLD.type_revision_id OR NEW.transaction_id IS NOT OLD.transaction_id OR NEW.split_id IS NOT OLD.split_id)' : ''}
      AND EXISTS (SELECT 1 FROM classification_type_revisions r JOIN classification_types t ON t.id = r.type_id
        WHERE r.id = NEW.type_revision_id AND t.archived = 1)
    BEGIN SELECT RAISE(ABORT, 'Archived classification types cannot be newly assigned'); END`
}
export const CLASSIFICATION_TYPES_REVISION_TABLES = [
  'classification_types',
  'classification_type_revisions',
] as const
for (const table of CLASSIFICATION_TYPES_REVISION_TABLES) {
  for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
    const name = `trg_data_revision_${table}_${operation.toLowerCase()}`
    objects[name] = `CREATE TRIGGER ${name} AFTER ${operation} ON ${table}
      BEGIN UPDATE app_data_state SET data_revision = data_revision + 1,
        last_financial_write_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = 1; END`
  }
}
export const CLASSIFICATION_TYPES_OBJECTS: Readonly<Record<string, string>> = objects

/** Entire list MUST run in a real transaction with foreign_keys ON; rollback on any failure.
 * Deferred FK checking is transaction-local, and permits the populated self-referencing rebuild.
 * Legacy 021/022 statements deliberately remain unchanged.
 */
export function classificationTypesStatements(): string[] {
  return [
    // Unknown extension FKs could CASCADE or SET NULL during DROP. Refuse rather than mutate them.
    'CREATE TEMP TABLE classification_023_fk_guard (external_references INTEGER CHECK (external_references = 0))',
    `INSERT INTO classification_023_fk_guard SELECT count(*) FROM sqlite_master m
      JOIN pragma_foreign_key_list(m.name) f
      WHERE m.type = 'table' AND m.name <> '${assignmentTable}' AND f."table" = '${assignmentTable}'`,
    'DROP TABLE classification_023_fk_guard',
    'PRAGMA defer_foreign_keys = ON',
    tables.classification_types,
    tables.classification_type_revisions,
    assignmentSql(replacementTable),
    `INSERT INTO ${replacementTable} (id, transaction_id, split_id, role, referenced_purchase_id, created_at, updated_at)
      SELECT id, transaction_id, split_id, role, referenced_purchase_id, created_at, updated_at FROM ${assignmentTable}`,
    `DROP TABLE ${assignmentTable}`,
    `ALTER TABLE ${replacementTable} RENAME TO ${assignmentTable}`,
    ...Object.entries(objects)
      .filter(([name]) => !(name in tables))
      .map(([, sql]) => sql),
    `INSERT INTO _migrations (id, name) VALUES (23, '${CLASSIFICATION_TYPES_MIGRATION}')`,
  ]
}
export function assertClassificationTypesReady(
  columns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[]
): void {
  for (const [table, required] of Object.entries(CLASSIFICATION_TYPES_SCHEMA)) {
    if (required.some((column) => !columns[table]?.includes(column)))
      throw new Error(`Database is not ready. Missing 023 columns on ${table}`)
  }
  const normalize = (sql: string) =>
    sql
      .replace(/\bIF NOT EXISTS\b/gi, '')
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/;$/, '')
      .toLowerCase()
  for (const [name, sql] of Object.entries(CLASSIFICATION_TYPES_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql))
      throw new Error(`Database is not ready. Missing or incompatible 023 schema object: ${name}`)
  }
}
