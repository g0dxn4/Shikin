export interface ContractedSchemaObject {
  name: string
  table: string
  sql: string
}

export interface ContractedColumn {
  columnId: number
  name: string
  type: string
  notNull: boolean
  defaultValue: string | null
  primaryKeyPosition: number
  hidden: number
}

export interface ContractedIndexColumn {
  sequence: number
  columnId: number
  name: string | null
  descending: boolean
  collation: string
  key: boolean
}

export interface ContractedAutoIndex {
  name: string
  unique: boolean
  origin: 'u' | 'pk'
  partial: boolean
  columns: ContractedIndexColumn[]
}

export interface ContractedTable {
  schema: 'main'
  name: string
  type: 'table'
  sql: string
  columns: ContractedColumn[]
  tableList: {
    columnCount: number
    withoutRowid: boolean
    strict: boolean
  }
  autoIndexes: ContractedAutoIndex[]
}

export interface MigrationSchemaObjects {
  indexes: string[]
  triggers: string[]
  views: string[]
}

export interface ShikinSchemaContract {
  contractVersion: number
  latestMigration: string
  migrationNames: string[]
  migrationSqlFiles: string[]
  migrationSchemaObjects: Record<string, MigrationSchemaObjects>
  readiness: {
    gui: {
      importMinimumTables: Record<string, string[]>
      currentTables: Record<string, string[]>
    }
    dataServer: {
      currentTables: Record<string, string[]>
    }
    cli: {
      coreTables: string[]
      coreColumns: Record<string, string[]>
      cliQolColumns: Record<string, string[]>
      creditCardColumns: string[]
    }
  }
  currentSchema: {
    tables: ContractedTable[]
  }
  allowedSchemaObjects: {
    indexes: ContractedSchemaObject[]
    triggers: ContractedSchemaObject[]
    views: ContractedSchemaObject[]
  }
}

export function normalizeSqlDefinition(value: unknown): string
export function collectSchemaObjectDefinitions(source: string): Map<string, string>
export function extractStringArrayConstant(source: string, constantName: string): string[]
export function extractStringArrayMapConstant(
  source: string,
  constantName: string
): Record<string, string[]>
export interface SqliteManifestDatabase {
  prepare(sql: string): { all(...parameters: unknown[]): unknown[] }
}

export function readCurrentTableManifest(database: SqliteManifestDatabase): ContractedTable[]
export function readSchemaContract(rootDir?: string): ShikinSchemaContract
export function renderSchemaContractIdentity(
  rawContractBytes: Uint8Array,
  contract: Pick<ShikinSchemaContract, 'contractVersion' | 'latestMigration'>
): string
export function validateSchemaContract(rootDir?: string): {
  contract: ShikinSchemaContract
  errors: string[]
}
export function isDirectExecution(importMetaUrl: string, argvPath?: string): boolean
