const EXECUTABLE_TYPES = new Set(['index', 'trigger', 'view'])
const CONTRACT_COLLECTIONS = Object.freeze({
  indexes: 'index',
  triggers: 'trigger',
  views: 'view',
})

export class SqliteSchemaValidationError extends Error {
  constructor(errors) {
    super(`SQLite executable schema validation failed:\n- ${errors.join('\n- ')}`)
    this.name = 'SqliteSchemaValidationError'
    this.errors = [...errors]
  }
}

/**
 * Normalize a SQLite schema definition without changing quoted values. Unquoted
 * words are folded to lower case, comments and insignificant whitespace are
 * removed, and CREATE's optional IF NOT EXISTS guard is ignored.
 */
export function normalizeSqlDefinition(value) {
  const tokens = tokenizeSql(String(value ?? ''))
  const withoutCreateGuards = []
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index]?.kind === 'word' &&
      tokens[index]?.value === 'if' &&
      tokens[index + 1]?.kind === 'word' &&
      tokens[index + 1]?.value === 'not' &&
      tokens[index + 2]?.kind === 'word' &&
      tokens[index + 2]?.value === 'exists'
    ) {
      index += 2
      continue
    }
    withoutCreateGuards.push(tokens[index])
  }
  while (withoutCreateGuards.at(-1)?.value === ';') withoutCreateGuards.pop()
  return withoutCreateGuards.map((token) => token.value).join(' ')
}

export function tokenizeSql(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('SQL source must be a string')
  const tokens = []
  let index = 0
  while (index < source.length) {
    const character = source[index]
    const next = source[index + 1]
    if (/\s/.test(character)) {
      index += 1
      continue
    }
    if (character === '-' && next === '-') {
      const start = index
      index += 2
      while (index < source.length && source[index] !== '\n') index += 1
      pushSqlToken(tokens, 'comment', source.slice(start, index), start, index, options)
      continue
    }
    if (character === '/' && next === '*') {
      const start = index
      const closing = source.indexOf('*/', index + 2)
      if (closing === -1) throw new TypeError('Unterminated SQL block comment')
      index = closing + 2
      pushSqlToken(tokens, 'comment', source.slice(start, index), start, index, options)
      continue
    }
    if (character === options.stopAtDelimiter) {
      pushSqlToken(tokens, 'symbol', character, index, index + 1, options)
      break
    }
    if (character === "'" || character === '"' || character === '`') {
      const start = index
      const delimiter = character
      index += 1
      let closed = false
      while (index < source.length) {
        if (source[index] === delimiter) {
          if (source[index + 1] === delimiter) {
            index += 2
            continue
          }
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) throw new TypeError(`Unterminated SQL ${delimiter} quoted value`)
      pushSqlToken(tokens, 'quoted', source.slice(start, index), start, index, options)
      continue
    }
    if (character === '[') {
      const start = index
      index += 1
      let closed = false
      while (index < source.length) {
        if (source[index] === ']') {
          if (source[index + 1] === ']') {
            index += 2
            continue
          }
          index += 1
          closed = true
          break
        }
        index += 1
      }
      if (!closed) throw new TypeError('Unterminated SQL bracket-quoted identifier')
      pushSqlToken(tokens, 'quoted', source.slice(start, index), start, index, options)
      continue
    }
    if (/[A-Za-z0-9_$]/.test(character)) {
      const start = index
      index += 1
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
      pushSqlToken(tokens, 'word', source.slice(start, index).toLowerCase(), start, index, options)
      continue
    }

    const start = index
    const twoCharacterOperator = source.slice(index, index + 2)
    if (['>=', '<=', '<>', '!=', '==', '||', '->'].includes(twoCharacterOperator)) index += 2
    else index += 1
    pushSqlToken(tokens, 'symbol', source.slice(start, index).toLowerCase(), start, index, options)
  }
  return tokens
}

export function readCurrentTableManifest(database) {
  if (!database || typeof database.prepare !== 'function') {
    throw new TypeError('A synchronous SQLite database handle is required')
  }
  const tableList = new Map(
    readAll(database, 'PRAGMA main.table_list')
      .filter((row) => row.schema === 'main')
      .map((row) => {
        assertSchemaObjectName(row.name, 'table_list table')
        return [row.name, row]
      })
  )
  return readAll(
    database,
    "SELECT name, type, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  )
    .filter((rawTable) => {
      assertSchemaObjectName(rawTable.name, 'sqlite_schema table')
      return tableList.get(rawTable.name)?.type === 'table'
    })
    .map((rawTable) => {
      const table = tableList.get(rawTable.name)
      if (typeof rawTable.sql !== 'string') {
        throw new TypeError(`Could not read structural metadata for table ${rawTable.name}`)
      }
      const autoIndexes = readAll(database, "SELECT * FROM pragma_index_list(?, 'main')", [
        rawTable.name,
      ])
        .filter((index) => index.origin === 'u' || index.origin === 'pk')
        .map((index) => {
          assertSchemaObjectName(index.name, `autoindex for table ${rawTable.name}`)
          return index
        })
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((index) => ({
          name: index.name,
          unique: Boolean(index.unique),
          origin: index.origin,
          partial: Boolean(index.partial),
          columns: readAll(database, "SELECT * FROM pragma_index_xinfo(?, 'main')", [
            index.name,
          ]).map((column) => ({
            sequence: column.seqno,
            columnId: column.cid,
            name: column.name,
            descending: Boolean(column.desc),
            collation: column.coll,
            key: Boolean(column.key),
          })),
        }))
      return {
        schema: 'main',
        name: rawTable.name,
        type: 'table',
        sql: normalizeSqlDefinition(rawTable.sql),
        columns: readAll(database, "SELECT * FROM pragma_table_xinfo(?, 'main')", [
          rawTable.name,
        ]).map((column) => ({
          columnId: column.cid,
          name: column.name,
          type: column.type,
          notNull: Boolean(column.notnull),
          defaultValue:
            column.dflt_value === null ? null : normalizeSqlDefinition(column.dflt_value),
          primaryKeyPosition: column.pk,
          hidden: column.hidden,
        })),
        tableList: {
          columnCount: table.ncol,
          withoutRowid: Boolean(table.wr),
          strict: Boolean(table.strict),
        },
        autoIndexes,
      }
    })
}

/**
 * Validate a live SQLite database against the shared schema contract. Historical
 * pre-migration mode permits ordinary table-definition drift. Current mode pins
 * every contracted core CREATE TABLE definition and its table_xinfo, table_list,
 * and structural autoindex metadata. Additional ordinary extension tables remain
 * allowed; executable objects, virtual tables, and shadow tables remain allowlisted.
 */
export function validateSqliteExecutableSchema(database, contract, options = {}) {
  const mode = options.mode ?? 'current'
  if (mode !== 'pre-migration' && mode !== 'current') {
    throw new TypeError(`Unsupported SQLite schema validation mode: ${String(mode)}`)
  }
  const expected = validateExecutableContract(contract)
  const expectedTables = mode === 'current' ? validateCurrentTableContract(contract) : new Map()
  const errors = []

  setTrustedSchemaOff(database)
  const rows = readAll(
    database,
    `
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_schema
    ORDER BY type, name
  `
  )
  if (!Array.isArray(rows)) throw new TypeError('sqlite_schema query did not return an array')

  const observed = new Set()
  const observedTables = new Set()
  for (const [index, rawRow] of rows.entries()) {
    const row = validateSchemaRow(rawRow, index)
    if (row.type === 'table') {
      const normalized = normalizeSqlDefinition(row.sql)
      if (normalized.startsWith('create virtual table ')) {
        errors.push(`virtual table ${row.name} is not allowed`)
      } else if (mode === 'current' && expectedTables.has(row.name)) {
        observedTables.add(row.name)
        if (normalized !== expectedTables.get(row.name).sql) {
          errors.push(
            `current table ${row.name} differs from its contracted CREATE TABLE definition`
          )
        }
      }
      continue
    }

    if (!EXECUTABLE_TYPES.has(row.type)) {
      errors.push(`sqlite_schema row ${row.name} has unsupported type ${row.type}`)
      continue
    }
    if (row.type === 'index' && row.name.startsWith('sqlite_autoindex')) {
      if (row.sql !== null) errors.push(`automatic index ${row.name} must have null SQL`)
      continue
    }
    if (typeof row.sql !== 'string' || row.sql.trim() === '') {
      errors.push(`${row.type} ${row.name} has no executable SQL definition`)
      continue
    }

    const contracted = expected.get(row.name)
    if (!contracted) {
      errors.push(`unknown ${row.type} ${row.name} is not allowed`)
      continue
    }
    observed.add(row.name)
    if (contracted.type !== row.type) {
      errors.push(`schema object ${row.name} is a ${row.type}, expected ${contracted.type}`)
    }
    if (contracted.table !== row.tableName) {
      errors.push(
        `schema object ${row.name} targets ${row.tableName}, expected ${contracted.table}`
      )
    }
    let normalized
    try {
      normalized = normalizeSqlDefinition(row.sql)
    } catch (error) {
      errors.push(`schema object ${row.name} has malformed SQL: ${errorMessage(error)}`)
      continue
    }
    if (normalized !== contracted.sql) {
      errors.push(`schema object ${row.name} differs from its contracted SQL definition`)
    }
  }

  const tableList = readAll(database, 'PRAGMA main.table_list')
  if (!Array.isArray(tableList))
    throw new TypeError('PRAGMA main.table_list did not return an array')
  for (const [index, rawRow] of tableList.entries()) {
    if (!isPlainRecord(rawRow)) throw new TypeError(`Malformed table_list row at index ${index}`)
    const { schema, name, type } = rawRow
    if (typeof schema !== 'string' || typeof name !== 'string' || typeof type !== 'string') {
      throw new TypeError(`Malformed table_list row at index ${index}`)
    }
    if (schema === 'main' && (type === 'virtual' || type === 'shadow')) {
      errors.push(`${type} table surface ${name} is not allowed`)
    }
  }

  if (mode === 'current') {
    for (const name of expected.keys()) {
      if (!observed.has(name)) errors.push(`contracted schema object ${name} is missing`)
    }
    for (const name of expectedTables.keys()) {
      if (!observedTables.has(name)) errors.push(`contracted current table ${name} is missing`)
    }
    const actualTables = new Map(
      readCurrentTableManifest(database)
        .filter((table) => expectedTables.has(table.name))
        .map((table) => [table.name, table])
    )
    for (const [name, expectedTable] of expectedTables) {
      const actual = actualTables.get(name)
      if (actual && stableJson(actual) !== stableJson(expectedTable)) {
        errors.push(`current table ${name} differs from its contracted structural metadata`)
      }
    }
  }

  if (errors.length > 0) throw new SqliteSchemaValidationError(errors)
  return Object.freeze({ mode, observedObjects: Object.freeze([...observed].sort()) })
}

function pushSqlToken(tokens, kind, value, start, end, options) {
  if (kind === 'comment' && !options.includeComments) return
  tokens.push(options.includePositions ? { kind, value, start, end } : { kind, value })
}

function validateExecutableContract(contract) {
  if (!isPlainRecord(contract) || !isPlainRecord(contract.allowedSchemaObjects)) {
    throw new TypeError('Malformed schema contract: allowedSchemaObjects is required')
  }
  assertExactKeys(
    contract.allowedSchemaObjects,
    Object.keys(CONTRACT_COLLECTIONS),
    'allowedSchemaObjects'
  )
  const definitions = new Map()
  for (const [collection, type] of Object.entries(CONTRACT_COLLECTIONS)) {
    const objects = contract.allowedSchemaObjects[collection]
    if (!Array.isArray(objects)) {
      throw new TypeError(`Malformed schema contract: ${collection} must be an array`)
    }
    for (const [index, object] of objects.entries()) {
      const label = `allowedSchemaObjects.${collection}[${index}]`
      if (!isPlainRecord(object)) throw new TypeError(`Malformed schema contract: ${label}`)
      assertExactKeys(object, ['name', 'table', 'sql'], label)
      if (!isBoundedString(object.name, 1, 128) || !isBoundedString(object.table, 1, 128)) {
        throw new TypeError(`Malformed schema contract: ${label} has an invalid name or table`)
      }
      if (typeof object.sql !== 'string' || object.sql.length === 0) {
        throw new TypeError(`Malformed schema contract: ${label}.sql must be a string`)
      }
      let normalized
      try {
        normalized = normalizeSqlDefinition(object.sql)
      } catch (error) {
        throw new TypeError(`Malformed schema contract: ${label}.sql: ${errorMessage(error)}`)
      }
      const expectedPrefix =
        type === 'index'
          ? normalized.startsWith('create index ') || normalized.startsWith('create unique index ')
          : normalized.startsWith(`create ${type} `)
      if (normalized !== object.sql || !expectedPrefix) {
        throw new TypeError(`Malformed schema contract: ${label}.sql is not normalized ${type} SQL`)
      }
      if (definitions.has(object.name)) {
        throw new TypeError(`Malformed schema contract: duplicate schema object ${object.name}`)
      }
      definitions.set(object.name, Object.freeze({ type, table: object.table, sql: object.sql }))
    }
  }
  return definitions
}

function validateCurrentTableContract(contract) {
  if (!isPlainRecord(contract) || !isPlainRecord(contract.currentSchema)) {
    throw new TypeError('Malformed schema contract: currentSchema is required in current mode')
  }
  assertExactKeys(contract.currentSchema, ['tables'], 'currentSchema')
  if (!Array.isArray(contract.currentSchema.tables)) {
    throw new TypeError('Malformed schema contract: currentSchema.tables must be an array')
  }
  const tables = new Map()
  for (const [index, table] of contract.currentSchema.tables.entries()) {
    const label = `currentSchema.tables[${index}]`
    if (!isPlainRecord(table)) throw new TypeError(`Malformed schema contract: ${label}`)
    assertExactKeys(
      table,
      ['schema', 'name', 'type', 'sql', 'columns', 'tableList', 'autoIndexes'],
      label
    )
    if (
      table.schema !== 'main' ||
      table.type !== 'table' ||
      !isBoundedString(table.name, 1, 128) ||
      typeof table.sql !== 'string' ||
      normalizeSqlDefinition(table.sql) !== table.sql ||
      !table.sql.startsWith('create table ') ||
      !Array.isArray(table.columns) ||
      !isPlainRecord(table.tableList) ||
      !Array.isArray(table.autoIndexes)
    ) {
      throw new TypeError(`Malformed schema contract: ${label} has invalid table metadata`)
    }
    assertExactKeys(
      table.tableList,
      ['columnCount', 'withoutRowid', 'strict'],
      `${label}.tableList`
    )
    if (
      !Number.isSafeInteger(table.tableList.columnCount) ||
      table.tableList.columnCount < 0 ||
      typeof table.tableList.withoutRowid !== 'boolean' ||
      typeof table.tableList.strict !== 'boolean'
    ) {
      throw new TypeError(`Malformed schema contract: ${label}.tableList`)
    }
    for (const [columnIndex, column] of table.columns.entries()) {
      const columnLabel = `${label}.columns[${columnIndex}]`
      if (!isPlainRecord(column)) throw new TypeError(`Malformed schema contract: ${columnLabel}`)
      assertExactKeys(
        column,
        ['columnId', 'name', 'type', 'notNull', 'defaultValue', 'primaryKeyPosition', 'hidden'],
        columnLabel
      )
      if (
        !Number.isSafeInteger(column.columnId) ||
        !isBoundedString(column.name, 1, 128) ||
        typeof column.type !== 'string' ||
        typeof column.notNull !== 'boolean' ||
        (column.defaultValue !== null && typeof column.defaultValue !== 'string') ||
        !Number.isSafeInteger(column.primaryKeyPosition) ||
        !Number.isSafeInteger(column.hidden)
      ) {
        throw new TypeError(`Malformed schema contract: ${columnLabel}`)
      }
    }
    for (const [autoIndex, index] of table.autoIndexes.entries()) {
      const indexLabel = `${label}.autoIndexes[${autoIndex}]`
      if (!isPlainRecord(index)) throw new TypeError(`Malformed schema contract: ${indexLabel}`)
      assertExactKeys(index, ['name', 'unique', 'origin', 'partial', 'columns'], indexLabel)
      if (
        typeof index.name !== 'string' ||
        !index.name.startsWith(`sqlite_autoindex_${table.name}_`) ||
        index.unique !== true ||
        !['u', 'pk'].includes(index.origin) ||
        typeof index.partial !== 'boolean' ||
        !Array.isArray(index.columns)
      ) {
        throw new TypeError(`Malformed schema contract: ${indexLabel}`)
      }
      for (const [indexColumn, column] of index.columns.entries()) {
        const indexColumnLabel = `${indexLabel}.columns[${indexColumn}]`
        if (!isPlainRecord(column)) {
          throw new TypeError(`Malformed schema contract: ${indexColumnLabel}`)
        }
        assertExactKeys(
          column,
          ['sequence', 'columnId', 'name', 'descending', 'collation', 'key'],
          indexColumnLabel
        )
        if (
          !Number.isSafeInteger(column.sequence) ||
          !Number.isSafeInteger(column.columnId) ||
          (column.name !== null && typeof column.name !== 'string') ||
          typeof column.descending !== 'boolean' ||
          typeof column.collation !== 'string' ||
          typeof column.key !== 'boolean'
        ) {
          throw new TypeError(`Malformed schema contract: ${indexColumnLabel}`)
        }
      }
    }
    if (table.tableList.columnCount !== table.columns.length) {
      throw new TypeError(`Malformed schema contract: ${label} column count differs`)
    }
    if (tables.has(table.name)) {
      throw new TypeError(`Malformed schema contract: duplicate current table ${table.name}`)
    }
    tables.set(table.name, table)
  }
  return tables
}

function stableJson(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map(stableValue))
  return JSON.stringify(stableValue(value))
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    )
  }
  return value
}

function setTrustedSchemaOff(database) {
  if (!database || (typeof database.exec !== 'function' && typeof database.pragma !== 'function')) {
    throw new TypeError('A synchronous SQLite database handle is required')
  }
  if (typeof database.pragma === 'function') database.pragma('trusted_schema = OFF')
  else database.exec('PRAGMA trusted_schema = OFF')

  const rows = readAll(database, 'PRAGMA trusted_schema')
  if (
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    !isPlainRecord(rows[0]) ||
    !Object.values(rows[0]).some((value) => value === 0)
  ) {
    throw new TypeError('SQLite trusted_schema could not be disabled')
  }
}

function assertSchemaObjectName(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} name is not a string`)
  }
}

function readAll(database, sql, parameters = []) {
  if (typeof database?.prepare !== 'function') {
    throw new TypeError('SQLite database handle does not expose prepare()')
  }
  const statement = database.prepare(sql)
  if (!statement || typeof statement.all !== 'function') {
    throw new TypeError('SQLite database handle did not return a readable statement')
  }
  return statement.all(...parameters)
}

function validateSchemaRow(row, index) {
  if (!isPlainRecord(row)) throw new TypeError(`Malformed sqlite_schema row at index ${index}`)
  assertExactKeys(row, ['type', 'name', 'tableName', 'sql'], `sqlite_schema row ${index}`)
  if (
    !['table', 'index', 'trigger', 'view'].includes(row.type) ||
    typeof row.name !== 'string' ||
    row.name.length === 0 ||
    typeof row.tableName !== 'string' ||
    row.tableName.length === 0 ||
    (row.sql !== null && typeof row.sql !== 'string') ||
    (row.type === 'table' && typeof row.sql !== 'string')
  ) {
    throw new TypeError(`Malformed sqlite_schema row at index ${index}`)
  }
  return row
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Malformed ${label}: expected fields ${expected.join(', ')}`)
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isBoundedString(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
