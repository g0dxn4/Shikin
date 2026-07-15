// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  SqliteSchemaValidationError,
  readCurrentTableManifest,
  validateSqliteExecutableSchema,
} from './sqlite-schema-validation.mjs'

const contract = JSON.parse(readFileSync(resolve('schema/shikin-contract.json'), 'utf8'))
const databases = []
const tempDirs = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SQLite executable schema validation', () => {
  it('rejects an unknown trigger', () => {
    const database = historicalDatabase()
    database.exec(`
      CREATE TRIGGER trg_uncontracted AFTER INSERT ON transactions
      BEGIN UPDATE transactions SET note = 'changed' WHERE id = new.id; END;
    `)

    expectValidationError(database, 'unknown trigger trg_uncontracted is not allowed')
  })

  it('rejects an altered known trigger, including quoted-literal changes', () => {
    const database = historicalDatabase()
    const trigger = contract.allowedSchemaObjects.triggers.find(
      (object) => object.name === 'trg_transactions_no_self_match_insert'
    )
    database.exec(
      trigger.sql.replace("'Transaction cannot match itself'", "'TRANSACTION CANNOT MATCH ITSELF'")
    )

    expectValidationError(
      database,
      'schema object trg_transactions_no_self_match_insert differs from its contracted SQL definition'
    )
  })

  it('rejects an unknown view', () => {
    const database = historicalDatabase()
    database.exec('CREATE VIEW account_names AS SELECT name FROM accounts')

    expectValidationError(database, 'unknown view account_names is not allowed')
  })

  it('rejects unknown ordinary and expression indexes', () => {
    const database = historicalDatabase()
    database.exec(`
      CREATE INDEX idx_uncontracted ON transactions(note);
      CREATE INDEX idx_expression_uncontracted ON transactions((amount * -1));
    `)

    expectValidationError(database, 'unknown index idx_expression_uncontracted is not allowed')
    expectValidationError(database, 'unknown index idx_uncontracted is not allowed')
  })

  it('rejects virtual tables and their shadow surfaces in an on-disk database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'shikin-schema-validator-'))
    tempDirs.push(directory)
    const database = trackedDatabase(join(directory, 'fixture.db'))
    database.exec('CREATE VIRTUAL TABLE searchable_notes USING fts5(value)')

    expectValidationError(database, 'virtual table searchable_notes is not allowed')
    expectValidationError(database, 'shadow table surface searchable_notes_data is not allowed')

    const current = currentDatabase()
    current.exec('CREATE VIRTUAL TABLE current_searchable_notes USING fts5(value)')
    expectValidationError(current, 'virtual table current_searchable_notes is not allowed', {
      mode: 'current',
    })
  })

  it('accepts an exact historical subset and approved ordinary tables', () => {
    const database = historicalDatabase()
    database.exec('CREATE TABLE plugin_private_data (id TEXT PRIMARY KEY, payload TEXT)')
    const index = contract.allowedSchemaObjects.indexes.find(
      (object) => object.name === 'idx_transactions_date'
    )
    database.exec(index.sql)

    expect(validateSqliteExecutableSchema(database, contract, { mode: 'pre-migration' })).toEqual({
      mode: 'pre-migration',
      observedObjects: ['idx_transactions_date'],
    })
    expect(database.pragma('trusted_schema', { simple: true })).toBe(0)
  })

  it('accepts a quoted punctuation extension table without unintended changes', () => {
    const database = currentDatabase()
    const extensionName = 'plugin "odd; DROP TABLE accounts;--'
    database.pragma('user_version = 47')
    database.prepare("INSERT INTO settings (key, value) VALUES ('proof', 'unchanged')").run()
    const schemaBefore = database
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name')
      .all()
    const settingsBefore = database.prepare('SELECT * FROM settings ORDER BY key').all()

    database.exec(`CREATE TABLE ${quoteIdentifier(extensionName)} (payload TEXT)`)
    expect(() =>
      validateSqliteExecutableSchema(database, contract, { mode: 'current' })
    ).not.toThrow()
    expect(readCurrentTableManifest(database).map((table) => table.name)).toContain(extensionName)
    expect(database.pragma('user_version', { simple: true })).toBe(47)
    expect(database.prepare('SELECT * FROM settings ORDER BY key').all()).toEqual(settingsBefore)
    const schemaAfter = database
      .prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name')
      .all()
    expect(schemaAfter.filter((row) => row.name !== extensionName)).toEqual(schemaBefore)
    expect(
      schemaAfter.filter((row) => !schemaBefore.some((before) => before.name === row.name))
    ).toEqual([
      {
        type: 'table',
        name: extensionName,
        tbl_name: extensionName,
        sql: `CREATE TABLE ${quoteIdentifier(extensionName)} (payload TEXT)`,
      },
    ])
  })

  it('binds injection-shaped manifest names instead of preparing them as SQL', () => {
    const candidateName = `candidate'); DROP TABLE accounts;--`
    const candidateIndex = `index'); DROP TABLE transactions;--`
    const preparedSql = []
    const calls = []
    const database = {
      prepare(sql) {
        preparedSql.push(sql)
        return {
          all(...parameters) {
            calls.push({ sql, parameters })
            if (sql === 'PRAGMA main.table_list') {
              return [
                {
                  schema: 'main',
                  name: candidateName,
                  type: 'table',
                  ncol: 1,
                  wr: 0,
                  strict: 0,
                },
              ]
            }
            if (sql.startsWith('SELECT name, type, sql FROM sqlite_schema')) {
              return [
                {
                  name: candidateName,
                  type: 'table',
                  sql: `CREATE TABLE ${quoteIdentifier(candidateName)} (payload TEXT)`,
                },
              ]
            }
            if (sql === "SELECT * FROM pragma_index_list(?, 'main')") {
              return [{ name: candidateIndex, unique: 1, origin: 'u', partial: 0 }]
            }
            if (sql === "SELECT * FROM pragma_index_xinfo(?, 'main')") return []
            if (sql === "SELECT * FROM pragma_table_xinfo(?, 'main')") {
              return [
                {
                  cid: 0,
                  name: 'payload',
                  type: 'TEXT',
                  notnull: 0,
                  dflt_value: null,
                  pk: 0,
                  hidden: 0,
                },
              ]
            }
            throw new Error(`unexpected SQL: ${sql}`)
          },
        }
      },
    }

    expect(readCurrentTableManifest(database)).toHaveLength(1)
    expect(
      preparedSql.every((sql) => !sql.includes(candidateName) && !sql.includes(candidateIndex))
    ).toBe(true)
    expect(
      calls.filter((call) => call.parameters.length > 0).map((call) => call.parameters)
    ).toEqual([[candidateName], [candidateIndex], [candidateName]])

    const malformedPreparedSql = []
    const malformedDatabase = {
      prepare(sql) {
        malformedPreparedSql.push(sql)
        return {
          all() {
            if (sql === 'PRAGMA main.table_list') {
              return [{ schema: 'main', name: null, type: 'table', ncol: 1, wr: 0, strict: 0 }]
            }
            throw new Error(`malformed name reached unexpected SQL: ${sql}`)
          },
        }
      },
    }
    expect(() => readCurrentTableManifest(malformedDatabase)).toThrow(TypeError)
    expect(malformedPreparedSql).toEqual(['PRAGMA main.table_list'])
  })

  it('requires and accepts the exact current table and executable-object set', () => {
    const incomplete = historicalDatabase()
    expectValidationError(
      incomplete,
      'contracted schema object idx_account_balance_account is missing',
      {
        mode: 'current',
      }
    )

    const current = currentDatabase()
    const result = validateSqliteExecutableSchema(current, contract, { mode: 'current' })
    const expectedNames = Object.values(contract.allowedSchemaObjects)
      .flat()
      .map((object) => object.name)
      .sort()
    expect(result).toEqual({ mode: 'current', observedObjects: expectedNames })
    current.exec('CREATE TABLE plugin_private_data (id TEXT PRIMARY KEY, payload TEXT)')
    expect(() =>
      validateSqliteExecutableSchema(current, contract, { mode: 'current' })
    ).not.toThrow()
  })

  it.each([
    [
      'missing UNIQUE and its autoindex',
      '_migrations',
      (sql) => sql.replace('name text not null unique', 'name text not null'),
    ],
    [
      'changed ON CONFLICT behavior',
      '_migrations',
      (sql) =>
        sql.replace('name text not null unique', 'name text not null unique on conflict ignore'),
    ],
    [
      'changed CHECK constraint',
      'accounts',
      (sql) => sql.replace("'checking'", "'checking_changed'"),
    ],
    [
      'changed foreign-key action',
      'account_balance_history',
      (sql) => sql.replace('on delete cascade', 'on delete restrict'),
    ],
    [
      'added generated column',
      'settings',
      (sql) =>
        sql.replace(
          / \)$/,
          ' , key_length integer generated always as ( length ( key ) ) virtual )'
        ),
    ],
    ['added STRICT flag', '_migrations', (sql) => `${sql} strict`],
    ['added WITHOUT ROWID flag', '_migrations', (sql) => `${sql} without rowid`],
    [
      'unexpected core autoindex',
      'settings',
      (sql) => sql.replace(/ \)$/, ' , unique ( value ) )'),
    ],
  ])('rejects %s in a contracted current table', (_label, tableName, transform) => {
    const database = tamperedCurrentDatabase(tableName, transform)
    expectValidationError(
      database,
      `current table ${tableName} differs from its contracted CREATE TABLE definition`,
      { mode: 'current' }
    )
    expectValidationError(
      database,
      `current table ${tableName} differs from its contracted structural metadata`,
      { mode: 'current' }
    )
  })

  it('rejects missing current tables and allows their historical definitions before migration', () => {
    const missing = currentDatabase({ omittedTable: 'settings' })
    expectValidationError(missing, 'contracted current table settings is missing', {
      mode: 'current',
    })

    const historical = tamperedCurrentDatabase('accounts', (sql) =>
      sql.replace("'checking'", "'historical_checking'")
    )
    expect(() =>
      validateSqliteExecutableSchema(historical, contract, { mode: 'pre-migration' })
    ).not.toThrow()
  })

  it('fails closed on malformed contracts and autoindex rows remain the only null-SQL exception', () => {
    const database = historicalDatabase()
    expect(() =>
      validateSqliteExecutableSchema(database, {
        allowedSchemaObjects: { indexes: [], triggers: [], views: [], unknown: [] },
      })
    ).toThrow('Malformed allowedSchemaObjects')

    expect(() =>
      validateSqliteExecutableSchema(database, contract, { mode: 'pre-migration' })
    ).not.toThrow()
  })
})

function trackedDatabase(path = ':memory:') {
  const database = new Database(path)
  databases.push(database)
  return database
}

function historicalDatabase() {
  const database = trackedDatabase()
  createContractTables(database)
  return database
}

function currentDatabase({ omittedTable = null, transformTable = null } = {}) {
  const database = trackedDatabase()
  for (const table of contract.currentSchema.tables) {
    if (table.name === omittedTable) continue
    const sql =
      transformTable?.name === table.name ? transformTable.transform(table.sql) : table.sql
    database.exec(executableTableSql(sql))
  }
  for (const collection of ['indexes', 'triggers', 'views']) {
    for (const object of contract.allowedSchemaObjects[collection]) {
      if (object.table !== omittedTable) database.exec(object.sql)
    }
  }
  return database
}

function tamperedCurrentDatabase(name, transform) {
  return currentDatabase({ transformTable: { name, transform } })
}

function executableTableSql(normalizedSql) {
  return normalizedSql.replace(/(\d) \. (\d)/g, '$1.$2')
}

function createContractTables(database) {
  for (const table of contract.currentSchema.tables) {
    const primaryColumns = table.columns
      .filter((column) => column.primaryKeyPosition > 0)
      .sort((left, right) => left.primaryKeyPosition - right.primaryKeyPosition)
    const columns = table.columns.map((column) => {
      const parts = [quoteIdentifier(column.name), column.type || 'BLOB']
      if (column.notNull) parts.push('NOT NULL')
      if (column.defaultValue !== null) parts.push(`DEFAULT (${column.defaultValue})`)
      if (primaryColumns.length === 1 && column.primaryKeyPosition === 1) parts.push('PRIMARY KEY')
      return parts.join(' ')
    })
    if (primaryColumns.length > 1) {
      columns.push(
        `PRIMARY KEY (${primaryColumns.map((column) => quoteIdentifier(column.name)).join(', ')})`
      )
    }
    database.exec(
      executableTableSql(`CREATE TABLE ${quoteIdentifier(table.name)} (${columns.join(', ')})`)
    )
  }
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function expectValidationError(database, message, options = { mode: 'pre-migration' }) {
  try {
    validateSqliteExecutableSchema(database, contract, options)
    throw new Error('expected schema validation to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(SqliteSchemaValidationError)
    expect(error.errors).toContain(message)
  }
}
