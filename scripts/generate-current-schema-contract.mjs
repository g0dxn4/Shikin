#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { format, resolveConfig } from 'prettier'
import {
  readCurrentTableManifest,
  renderSchemaContractIdentity,
} from './check-schema-contract.mjs'

const databasePath = process.argv[2]
if (!databasePath) {
  console.error('Usage: node scripts/generate-current-schema-contract.mjs <current-shikin.db>')
  process.exitCode = 2
} else {
  const contractPath = resolve('schema/shikin-contract.json')
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'))
  const database = new Database(resolve(databasePath), { readonly: true, fileMustExist: true })
  try {
    const migrations = database
      .prepare('SELECT name FROM _migrations ORDER BY id')
      .all()
      .map((row) => row.name)
    if (JSON.stringify(migrations) !== JSON.stringify(contract.migrationNames)) {
      throw new Error('Input database does not have the exact contracted current migration history')
    }
    const tables = readCurrentTableManifest(database)
    const actualNames = tables.map((table) => table.name)
    const expectedNames = Object.keys(contract.readiness.gui.currentTables).sort()
    if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
      throw new Error('Input database does not have the complete contracted current table set')
    }
    contract.currentSchema = { tables }
  } finally {
    database.close()
  }
  const prettierOptions = (await resolveConfig(contractPath)) ?? {}
  const formattedContract = await format(JSON.stringify(contract), {
    ...prettierOptions,
    filepath: contractPath,
  })
  writeFileSync(contractPath, formattedContract)
  const identityPath = resolve('scripts/shikin-schema-contract-identity.mjs')
  writeFileSync(
    identityPath,
    renderSchemaContractIdentity(Buffer.from(formattedContract, 'utf8'), contract)
  )
  console.log(`Updated ${contractPath} and ${identityPath} from ${resolve(databasePath)}`)
}
