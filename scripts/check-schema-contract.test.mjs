// @vitest-environment node
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectSchemaObjectDefinitions,
  normalizeSqlDefinition,
  validateSchemaContract,
} from './check-schema-contract.mjs'

const tempDirs = []

afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('SQL definition canonicalization', () => {
  it('normalizes unquoted keyword, whitespace, guard, and comment changes', () => {
    const verbose = `
      CREATE /* creation comment */ UNIQUE INDEX IF NOT EXISTS idx_mode
      ON transactions ( account_id, ledger_treatment )
      WHERE ledger_treatment = 'snapshot_only'; -- trailing comment
    `
    const compact =
      "create unique index idx_mode on transactions(account_id,ledger_treatment)where ledger_treatment='snapshot_only'"

    expect(normalizeSqlDefinition(verbose)).toBe(normalizeSqlDefinition(compact))
  })

  it('preserves quoted literal and identifier contents plus doubled-quote escapes', () => {
    const lowerLiteral = normalizeSqlDefinition(
      `CREATE INDEX idx_literal ON "Mode Table"(mode) WHERE mode = 'snapshot_only' AND note = 'owner''s row'`
    )
    const upperLiteral = normalizeSqlDefinition(
      `create index idx_literal on "Mode Table"(mode) where mode = 'SNAPSHOT_ONLY' and note = 'owner''s row'`
    )
    const changedIdentifier = normalizeSqlDefinition(
      `create index idx_literal on "mode table"(mode) where mode = 'snapshot_only' and note = 'owner''s row'`
    )

    expect(lowerLiteral).not.toBe(upperLiteral)
    expect(lowerLiteral).not.toBe(changedIdentifier)
    expect(lowerLiteral).toContain("'owner''s row'")
  })

  it('does not discover schema objects hidden in SQL comments', () => {
    const definitions = collectSchemaObjectDefinitions(`
      -- CREATE INDEX idx_fake ON fake(value);
      CREATE INDEX idx_real ON real(value);
      /* CREATE TRIGGER trg_fake AFTER INSERT ON fake BEGIN SELECT 1; END; */
    `)

    expect([...definitions.keys()]).toEqual(['idx_real'])
  })

  it('fails when raw schema contract bytes drift from the generated trusted identity', () => {
    const root = copySchemaContractSurface()
    const contractPath = join(root, 'schema/shikin-contract.json')
    writeFileSync(contractPath, `${readFileSync(contractPath, 'utf8')} `)

    expect(validateSchemaContract(root).errors).toContain(
      'trusted schema identity drifted from raw schema/shikin-contract.json bytes'
    )
  })

  it('reports missing and unexpected objects for the exact migration that drifted', () => {
    const root = copySchemaContractSurface()
    const migrationPath = join(root, 'src-tauri/migrations/018_placeholder_transactions.sql')
    const original = readFileSync(migrationPath, 'utf8')
    writeFileSync(
      migrationPath,
      original.replace(
        /CREATE INDEX IF NOT EXISTS idx_transactions_placeholder_parent[\s\S]*?;\n/,
        ''
      )
    )
    expect(validateSchemaContract(root).errors).toContain(
      'src-tauri/migrations/018_placeholder_transactions.sql is missing schema objects: idx_transactions_placeholder_parent'
    )

    writeFileSync(
      migrationPath,
      `${original}\nCREATE INDEX idx_unexpected_review_fixture ON transactions(date);\n`
    )
    expect(validateSchemaContract(root).errors).toContain(
      'src-tauri/migrations/018_placeholder_transactions.sql contains unexpected schema objects: idx_unexpected_review_fixture'
    )
  })
})

function copySchemaContractSurface() {
  const sourceRoot = resolve(process.cwd())
  const root = mkdtempSync(join(tmpdir(), 'shikin-schema-checker-'))
  tempDirs.push(root)
  for (const directory of ['schema', 'scripts', 'src/lib', 'cli/src', 'src-tauri/migrations']) {
    mkdirSync(join(root, directory), { recursive: true })
  }
  for (const file of [
    'schema/shikin-contract.json',
    'schema/database-operation-lock-v1.json',
    'scripts/shikin-schema-contract-identity.mjs',
    'scripts/data-server.mjs',
    'src/lib/database.ts',
    'cli/src/migrations.ts',
    'cli/src/database.ts',
  ]) {
    copyFileSync(join(sourceRoot, file), join(root, file))
  }
  for (const file of readdirSync(join(sourceRoot, 'src-tauri/migrations'))) {
    if (file.endsWith('.sql')) {
      copyFileSync(
        join(sourceRoot, 'src-tauri/migrations', file),
        join(root, 'src-tauri/migrations', file)
      )
    }
  }
  return root
}
