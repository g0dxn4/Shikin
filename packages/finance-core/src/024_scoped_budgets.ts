export const SCOPED_BUDGETS_MIGRATION = '024_scoped_budgets'
export const SCOPED_BUDGETS_VERSION = 24

export const SCOPED_BUDGETS_SCHEMA: Readonly<Record<string, readonly string[]>> = {
  budgets: ['scope_json', 'basis'],
}

export const SCOPED_BUDGETS_COLUMNS = [
  {
    table: 'budgets',
    name: 'scope_json',
    definition:
      "TEXT NOT NULL DEFAULT '{}' CHECK (CASE WHEN json_valid(scope_json) THEN json_type(scope_json) = 'object' ELSE 0 END)",
  },
  {
    table: 'budgets',
    name: 'basis',
    definition:
      "TEXT NOT NULL DEFAULT 'gross_cashflow' CHECK (basis IN ('gross_cashflow', 'net_consumption'))",
  },
] as const

/** category_id is a nullable singleton FK mirror, not the authority for a stored scope.
 * On category deletion, capture only a missing legacy categoryIds field before clearing
 * the mirror; the existing FK CASCADE must not remove budgets or budget_periods.
 * No historical amount, currency, usage counter or transaction is rewritten.
 */
export const SCOPED_BUDGETS_OBJECTS: Readonly<Record<string, string>> = {
  trg_scoped_budgets_category_delete: `CREATE TRIGGER trg_scoped_budgets_category_delete BEFORE DELETE ON categories
    BEGIN
      UPDATE budgets SET scope_json = json_set(scope_json, '$.categoryIds', json_array(OLD.id))
        WHERE category_id = OLD.id AND json_type(scope_json, '$.categoryIds') IS NULL;
      UPDATE budgets SET category_id = NULL WHERE category_id = OLD.id;
    END`,
}

/** Execute within a write transaction with foreign_keys ON; rollback the entire batch on error. */
export function scopedBudgetsStatements(
  existingColumns: Readonly<Record<string, readonly string[]>>
): string[] {
  return [
    ...SCOPED_BUDGETS_COLUMNS.filter(
      (column) => !existingColumns[column.table]?.includes(column.name)
    ).map((column) => `ALTER TABLE ${column.table} ADD COLUMN ${column.name} ${column.definition}`),
    ...Object.values(SCOPED_BUDGETS_OBJECTS),
    `INSERT INTO _migrations (id, name) VALUES (24, '${SCOPED_BUDGETS_MIGRATION}')`,
  ]
}

export function assertScopedBudgetsReady(
  columns: Readonly<Record<string, readonly string[]>>,
  objects: readonly { name: string; sql: string | null }[]
): void {
  for (const [table, required] of Object.entries(SCOPED_BUDGETS_SCHEMA)) {
    if (required.some((column) => !columns[table]?.includes(column)))
      throw new Error(`Database is not ready. Missing 024 columns on ${table}`)
  }
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().replace(/;$/, '').toLowerCase()
  for (const [name, sql] of Object.entries(SCOPED_BUDGETS_OBJECTS)) {
    if (normalize(objects.find((object) => object.name === name)?.sql ?? '') !== normalize(sql))
      throw new Error(`Database is not ready. Missing or incompatible 024 schema object: ${name}`)
  }
}
