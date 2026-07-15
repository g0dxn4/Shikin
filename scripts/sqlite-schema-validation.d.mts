import type { ContractedTable, ShikinSchemaContract } from './check-schema-contract.mjs'

export type SqlTokenKind = 'word' | 'quoted' | 'symbol' | 'comment'
export interface SqlToken {
  kind: SqlTokenKind
  value: string
}
export interface PositionedSqlToken extends SqlToken {
  start: number
  end: number
}
export interface SqlTokenizeOptions {
  includeComments?: boolean
  includePositions?: false
  stopAtDelimiter?: string
}
export interface PositionedSqlTokenizeOptions extends Omit<SqlTokenizeOptions, 'includePositions'> {
  includePositions: true
}

export interface SqliteStatementHandle {
  all(...parameters: unknown[]): unknown[]
}
export interface SqliteDatabaseHandle {
  exec?(sql: string): unknown
  pragma?(sql: string): unknown
  prepare(sql: string): SqliteStatementHandle
}
export type SqliteSchemaValidationMode = 'pre-migration' | 'current'
export interface SqliteSchemaValidationOptions {
  mode?: SqliteSchemaValidationMode
}
export interface SqliteSchemaValidationResult {
  readonly mode: SqliteSchemaValidationMode
  readonly observedObjects: readonly string[]
}

export class SqliteSchemaValidationError extends Error {
  readonly errors: string[]
  constructor(errors: readonly string[])
}

export function normalizeSqlDefinition(value: unknown): string
export function tokenizeSql(source: string, options?: SqlTokenizeOptions): SqlToken[]
export function tokenizeSql(
  source: string,
  options: PositionedSqlTokenizeOptions
): PositionedSqlToken[]
export function readCurrentTableManifest(database: SqliteDatabaseHandle): ContractedTable[]
export function validateSqliteExecutableSchema(
  database: SqliteDatabaseHandle,
  contract: Pick<ShikinSchemaContract, 'allowedSchemaObjects'> &
    Partial<Pick<ShikinSchemaContract, 'currentSchema'>>,
  options?: SqliteSchemaValidationOptions
): SqliteSchemaValidationResult
