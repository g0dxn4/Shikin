// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

type SchemaContract = {
  latestMigration: string
  migrationNames: string[]
  readiness: {
    gui: { currentTables: Record<string, string[]> }
    cli: {
      coreTables: string[]
      coreColumns: Record<string, string[]>
      cliQolColumns: Record<string, string[]>
      creditCardColumns: string[]
    }
  }
}

function loadContract(): SchemaContract {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'schema/shikin-contract.json'), 'utf8')
  ) as SchemaContract
}

describe('CLI schema contract characterization', () => {
  it('pins the complete current migration readiness list through 019', () => {
    const contract = loadContract()
    expect(CLI_DATABASE_MIGRATIONS).toEqual(contract.migrationNames)
    expect(contract.latestMigration).toBe('019_financial_semantics')
    expect(contract.migrationNames).not.toContain('020_database_safety')
  })

  it('keeps every CLI structural readiness column in the canonical current schema', () => {
    const contract = loadContract()
    const currentTables = contract.readiness.gui.currentTables
    const cli = contract.readiness.cli

    for (const table of cli.coreTables) expect(currentTables[table], table).toBeDefined()
    for (const columnsByTable of [cli.coreColumns, cli.cliQolColumns]) {
      for (const [table, columns] of Object.entries(columnsByTable)) {
        expect(
          columns.filter((column) => !currentTables[table]?.includes(column)),
          table
        ).toEqual([])
      }
    }
    for (const column of cli.creditCardColumns) {
      expect(currentTables.accounts).toContain(column)
    }
  })
})
