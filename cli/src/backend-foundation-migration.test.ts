import { SCOPED_BUDGETS_MIGRATION } from '@shikin/finance-core/scoped-budgets-migration'
// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BACKEND_FOUNDATION_MIGRATION,
  CLASSIFICATION_TYPES_MIGRATION,
  CLASSIFICATION_TYPES_REVISION_TABLES,
  DATED_FX_MIGRATION,
  DATED_FX_REVISION_TABLES,
  FINANCIAL_REVISION_TABLES,
} from '@shikin/finance-core'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const databases: Database.Database[] = []
const homes: string[] = []
function database(path = ':memory:') {
  const db = new Database(path)
  db.pragma('foreign_keys = ON')
  databases.push(db)
  return db
}
function home() {
  const path = mkdtempSync(join(tmpdir(), 'shikin-foundation-'))
  homes.push(path)
  return path
}
function rows(db: Database.Database, sql: string) {
  return db.prepare(sql).all()
}
function state(db: Database.Database) {
  return db.prepare('SELECT * FROM app_data_state').get() as {
    database_id: string
    data_revision: number
    last_financial_write_at: string | null
  }
}
function legacyEvidence(db: Database.Database) {
  db.exec(`
    INSERT INTO accounts (id, name, type, balance) VALUES
      ('cash', 'Cash', 'checking', 45000), ('card', 'Card credit', 'credit_card', 2500),
      ('portfolio', 'Ambiguous investment', 'investment', 0), ('crypto', 'Ambiguous crypto', 'crypto', 9876);
    INSERT INTO accounts (id, name, type, account_mode, balance) VALUES ('snapshot', 'Snapshot', 'investment', 'snapshot_only', 34567);
    INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis) VALUES
      ('holding', 'portfolio', 'XYZ', 'Legacy quantity', 'stock', 0.1234567890123456, 12345),
      ('unknown', 'crypto', 'XYZ', 'Unknown basis', 'crypto', 10.1, 0),
      ('large', 'portfolio', 'BIG', 'Exact cents', 'stock', 1, 9007199254740991);
    INSERT INTO stock_prices (id, symbol, price, currency, date) VALUES ('manual-old', 'XYZ', 7654, 'MXN', '2025-01-01');
    INSERT INTO transactions (id, account_id, type, amount, description, date, import_fingerprint) VALUES
      ('t1', 'cash', 'expense', 500, 'Purchase', '2025-01-01', 'legacy-identity'),
      ('t2', 'cash', 'income', 200, 'Income', '2025-01-02', NULL);
    INSERT INTO credit_card_statements (id, account_id, statement_end_date, due_date, statement_balance, paid_amount) VALUES
      ('statement', 'card', '2025-01-31', '2025-02-15', 5000, 6000);
    INSERT INTO cashflow_buckets (id, name, balance) VALUES ('bucket', 'Original', 321);
    INSERT INTO cashflow_bucket_allocations (id, bucket_id, amount, allocation_date) VALUES ('allocation', 'bucket', 321, '2025-01-01');
    INSERT INTO recaps (id, type, period_start, period_end, title, summary) VALUES ('recap', 'monthly', '2025-01-01', '2025-01-31', 'Old', 'Gross');
  `)
}
function snapshot(db: Database.Database) {
  return Object.fromEntries(
    (
      rows(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ) as Array<{ name: string }>
    ).map(({ name }) => [
      name,
      {
        columns: (rows(db, `PRAGMA table_info(${name})`) as Array<{ name: string }>).map(
          (c) => c.name
        ),
        rows: rows(db, `SELECT * FROM ${name} ORDER BY rowid`),
      },
    ])
  )
}
function assertPreserved(db: Database.Database, before: ReturnType<typeof snapshot>) {
  for (const [table, data] of Object.entries(before)) {
    if (table === '_migrations') continue
    expect(
      rows(db, `SELECT ${data.columns.join(',')} FROM ${table} ORDER BY rowid`),
      table
    ).toEqual(data.rows)
  }
}
function reconciliation(db: Database.Database, id: string, mode = 'legacy_batch') {
  db.prepare(
    `INSERT INTO account_reconciliations (id, account_id, reconciliation_date, actual_balance, stored_balance_before, ledger_balance_before, ledger_balance_after, adjustment_amount, staging_batch_id, selection_mode)
    VALUES (?, 'cash', '2025-01-01', 0, 0, 0, 0, 0, 'batch', ?)`
  ).run(id, mode)
}
async function mockNative(db: Database.Database, fail: boolean | string = false) {
  vi.resetModules()
  vi.doMock('@/lib/runtime', () => ({ isTauri: true }))
  vi.doMock('@tauri-apps/api/path', () => ({
    appDataDir: async () => '/synthetic',
    join: async (...parts: string[]) => parts.join('/'),
  }))
  const execute = async (sql: string, params: unknown[] = []) => {
    if (
      fail &&
      sql.includes(
        typeof fail === 'string' ? fail : 'CREATE TRIGGER IF NOT EXISTS trg_data_revision_'
      )
    )
      throw new Error('injected migration failure')
    const result = db.prepare(sql).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  }
  const invoke = vi.fn(
    async (
      command: string,
      args: { statement?: { query: string; values: unknown[] }; localInstanceId?: string }
    ) => {
      if (command === 'shikin_db_tx_begin') return db.exec('BEGIN IMMEDIATE')
      if (command === 'shikin_db_tx_commit') return db.exec('COMMIT')
      if (command === 'shikin_db_tx_rollback') return db.exec('ROLLBACK')
      const statement = args.statement!
      if (command === 'shikin_db_tx_query')
        return db.prepare(statement.query).all(...statement.values)
      if (command === 'shikin_db_tx_execute') return execute(statement.query, statement.values)
      if (command === 'initialize_runtime_identity') return args.localInstanceId
      throw new Error(`Unexpected ${command}`)
    }
  )
  vi.doMock('@tauri-apps/api/core', () => ({ invoke }))
  vi.doMock('@tauri-apps/plugin-sql', () => ({
    default: {
      load: async () => ({
        select: async (sql: string, params: unknown[] = []) => db.prepare(sql).all(...params),
        execute,
        close: async () => {},
      }),
    },
  }))
  return { api: await import(/* @vite-ignore */ ['../../src', 'lib/database'].join('/')), invoke }
}
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close()
  for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const module of [
    '@/lib/runtime',
    '@tauri-apps/api/path',
    '@tauri-apps/api/core',
    '@tauri-apps/plugin-sql',
  ])
    vi.doUnmock(module)
})

describe('021 backend remediation foundation', () => {
  it('initializes fresh hosted schema once, with unknown last-write and independent random lineage', () => {
    const db = database()
    runHostedTestMigrations(db)
    expect(state(db)).toMatchObject({ data_revision: 0, last_financial_write_at: null })
    expect(state(db).database_id).toMatch(/^[a-f0-9]{32}$/)
    const initial = snapshot(db)
    runHostedTestMigrations(db)
    expect(snapshot(db)).toEqual(initial)
    const other = database()
    runHostedTestMigrations(other)
    expect(state(other).database_id).not.toBe(state(db).database_id)
  })

  it.each([19, 20] as const)(
    'preserves every old column on a schema %i upgrade without inferred evidence',
    (version) => {
      const db = database()
      runHostedTestMigrations(db, version)
      legacyEvidence(db)
      const before = snapshot(db)
      runHostedTestMigrations(db)
      assertPreserved(db, before)
      expect(rows(db, 'SELECT id, valuation_mode FROM accounts ORDER BY id')).toEqual([
        { id: 'card', valuation_mode: 'cash_plus_holdings' },
        { id: 'cash', valuation_mode: 'cash_plus_holdings' },
        { id: 'crypto', valuation_mode: 'unresolved' },
        { id: 'portfolio', valuation_mode: 'unresolved' },
        { id: 'snapshot', valuation_mode: 'portfolio_snapshot' },
      ])
      expect(
        rows(
          db,
          'SELECT id, quantity_decimal, avg_cost_basis_decimal, cost_basis_known, instrument_key FROM investments ORDER BY id'
        )
      ).toEqual([
        {
          id: 'holding',
          quantity_decimal: null,
          avg_cost_basis_decimal: '123.45',
          cost_basis_known: 1,
          instrument_key: null,
        },
        {
          id: 'large',
          quantity_decimal: null,
          avg_cost_basis_decimal: '90071992547409.91',
          cost_basis_known: 1,
          instrument_key: null,
        },
        {
          id: 'unknown',
          quantity_decimal: null,
          avg_cost_basis_decimal: null,
          cost_basis_known: 0,
          instrument_key: null,
        },
      ])
      expect(
        rows(db, 'SELECT unattributed_paid_amount, paid_amount FROM credit_card_statements')
      ).toEqual([{ unattributed_paid_amount: 6000, paid_amount: 6000 }])
      expect(rows(db, 'SELECT basis, currency_scope FROM recaps')).toEqual([
        { basis: 'gross_cashflow', currency_scope: 'all' },
      ])
      expect(
        rows(db, 'SELECT finalization_id, import_content_fingerprint FROM transactions')
      ).toEqual([
        { finalization_id: null, import_content_fingerprint: null },
        { finalization_id: null, import_content_fingerprint: null },
      ])
      for (const table of [
        'instrument_prices',
        'transaction_consumption_classifications',
        'source_coverage',
        'reconciliation_corrections',
        'transfer_match_provenance',
        'duplicate_review_decisions',
        'card_statement_payment_links',
      ])
        expect(rows(db, `SELECT * FROM ${table}`)).toEqual([])
      expect(state(db)).toMatchObject({ data_revision: 0, last_financial_write_at: null })
    }
  )

  it('leaves invalid/unsafe legacy basis unknown and defaults new writes without inventing evidence', () => {
    const db = database()
    runHostedTestMigrations(db, 20)
    db.exec(`INSERT INTO investments (id, symbol, name, type, avg_cost_basis) VALUES
      ('negative', 'N', 'Negative', 'stock', -1), ('fractional', 'F', 'Fractional cents', 'stock', 1.5),
      ('unsafe', 'U', 'Unsafe cents', 'stock', 9007199254740992)`)
    runHostedTestMigrations(db)
    expect(rows(db, 'SELECT avg_cost_basis_decimal, cost_basis_known FROM investments')).toEqual([
      { avg_cost_basis_decimal: null, cost_basis_known: 0 },
      { avg_cost_basis_decimal: null, cost_basis_known: 0 },
      { avg_cost_basis_decimal: null, cost_basis_known: 0 },
    ])
    db.exec(
      "INSERT INTO accounts (id, name, type) VALUES ('new', 'Explicit choice required', 'checking')"
    )
    expect(rows(db, 'SELECT valuation_mode FROM accounts')).toEqual([
      { valuation_mode: 'unresolved' },
    ])
  })

  it('keeps finalization membership nonunique and preserves bridge/adjustment uniqueness while explicit batches can repeat', () => {
    const db = database()
    runHostedTestMigrations(db)
    legacyEvidence(db)
    reconciliation(db, 'legacy')
    expect(() => reconciliation(db, 'legacy2')).toThrow(/UNIQUE/)
    reconciliation(db, 'explicit1', 'explicit_rows')
    reconciliation(db, 'explicit2', 'explicit_rows')
    db.exec("UPDATE transactions SET finalization_id = 'explicit1'")
    expect(
      rows(db, "SELECT id FROM transactions WHERE finalization_id = 'explicit1'")
    ).toHaveLength(2)
    db.exec("UPDATE transactions SET reconciliation_id = 'legacy' WHERE id = 't1'")
    expect(() =>
      db.exec("UPDATE transactions SET reconciliation_id = 'legacy' WHERE id = 't2'")
    ).toThrow(/UNIQUE/)
    db.exec(
      "UPDATE account_reconciliations SET adjustment_transaction_id = 't1' WHERE id = 'legacy'"
    )
    expect(() =>
      db.exec(
        "UPDATE account_reconciliations SET adjustment_transaction_id = 't1' WHERE id = 'explicit1'"
      )
    ).toThrow(/UNIQUE/)
  })

  it('enforces structural classifications, restrictive references, allocation reversals and payment link checks', () => {
    const db = database()
    runHostedTestMigrations(db)
    legacyEvidence(db)
    const classify = db.prepare(
      'INSERT INTO transaction_consumption_classifications (id, transaction_id, role, referenced_purchase_id) VALUES (?, ?, ?, ?)'
    )
    classify.run('purchase', 't1', 'purchase', null)
    expect(() => classify.run('again', 't1', 'fee', null)).toThrow(/UNIQUE/)
    expect(() => classify.run('refund', 't2', 'refund', null)).toThrow(/CHECK/)
    expect(() => classify.run('income', 't2', 'earned_income', 'purchase')).toThrow(/CHECK/)
    classify.run('refund', 't2', 'refund', 'purchase')
    expect(() =>
      db.exec("DELETE FROM transaction_consumption_classifications WHERE id = 'purchase'")
    ).toThrow(/FOREIGN KEY/)
    expect(() => db.exec("DELETE FROM transactions WHERE id = 't1'")).toThrow(/FOREIGN KEY/)
    db.exec(
      "INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES ('split', 't1', '01FOOD000000000000000000000', 100)"
    )
    db.exec(
      "INSERT INTO transaction_consumption_classifications (id, transaction_id, split_id, role) VALUES ('split-role', 't1', 'split', 'fee')"
    )
    expect(() =>
      db.exec(
        "INSERT INTO transaction_consumption_classifications (id, transaction_id, split_id, role) VALUES ('split-role2', 't1', 'split', 'fee')"
      )
    ).toThrow(/UNIQUE/)
    expect(() => db.exec("DELETE FROM transaction_splits WHERE id = 'split'")).toThrow(
      /FOREIGN KEY/
    )
    db.exec(
      "INSERT INTO cashflow_bucket_allocations (id, bucket_id, amount, allocation_date, reverses_allocation_id) VALUES ('reverse', 'bucket', -321, '2025-02-01', 'allocation')"
    )
    expect(() =>
      db.exec(
        "INSERT INTO cashflow_bucket_allocations (id, bucket_id, amount, allocation_date, reverses_allocation_id) VALUES ('reverse2', 'bucket', -321, '2025-02-01', 'allocation')"
      )
    ).toThrow(/UNIQUE/)
    db.exec(
      "INSERT INTO transactions (id, account_id, type, amount, description, date) VALUES ('payment', 'cash', 'expense', 100, 'Card payment', '2025-02-01')"
    )
    const link = db.prepare(
      `INSERT INTO card_statement_payment_links
        (id, original_statement_id, original_transaction_id, statement_id, transaction_id, amount, mode)
       VALUES (?, 'statement', 'payment', 'statement', 'payment', ?, ?)`
    )
    expect(() => link.run('bad', 0, 'apply_to_unpaid')).toThrow(/CHECK/)
    expect(() => link.run('bad', 1.5, 'apply_to_unpaid')).toThrow(/CHECK/)
    expect(() => link.run('bad', 1, 'other')).toThrow(/CHECK/)
    link.run('valid', 1, 'attribute_existing')
    expect(() =>
      db.exec(
        "UPDATE card_statement_payment_links SET original_transaction_id = 't2' WHERE id = 'valid'"
      )
    ).toThrow(/immutable/)
    expect(() => db.exec("DELETE FROM transactions WHERE id = 'payment'")).toThrow(/CHECK/)
    expect(() => db.exec("DELETE FROM credit_card_statements WHERE id = 'statement'")).toThrow(
      /CHECK/
    )
    const balances = rows(db, 'SELECT id, balance FROM accounts ORDER BY id')
    db.exec(
      "UPDATE card_statement_payment_links SET voided_at = '2025-02-02' WHERE id = 'valid'; DELETE FROM transactions WHERE id = 'payment'; DELETE FROM credit_card_statements WHERE id = 'statement'"
    )
    expect(rows(db, 'SELECT * FROM card_statement_payment_links')).toEqual([
      expect.objectContaining({
        id: 'valid',
        original_statement_id: 'statement',
        original_transaction_id: 'payment',
        statement_id: null,
        transaction_id: null,
        voided_at: '2025-02-02',
      }),
    ])
    expect(rows(db, 'SELECT id, balance FROM accounts ORDER BY id')).toEqual(balances)
    db.exec(
      "UPDATE investments SET avg_cost_basis_decimal = '0', cost_basis_known = 1 WHERE id = 'unknown'"
    )
    expect(() => db.exec("UPDATE accounts SET valuation_mode = 'guess'")).toThrow(/CHECK/)
  })

  it('retains quote/manual and inactive match evidence and prevents cross-side active matches', () => {
    const db = database()
    runHostedTestMigrations(db)
    const quote = db.prepare(
      "INSERT INTO instrument_prices (id, instrument_key, asset_type, provider, instrument_id, quote_currency, unit_price_decimal, quote_date) VALUES (?, ?, 'stock', 'manual', 'deleted-holding', 'MXN', '1.234567890123', '2025-01-01')"
    )
    quote.run('q1', 'manual:holding1')
    quote.run('q2', 'manual:holding2')
    expect(() => quote.run('q3', 'manual:holding1')).toThrow(/UNIQUE/)
    const match = db.prepare(
      "INSERT INTO transfer_match_provenance (id, source_transaction_id, mirror_transaction_id, source_before_json, mirror_before_json) VALUES (?, ?, ?, '{}', '{}')"
    )
    match.run('m1', 'a', 'b')
    expect(() => match.run('m2', 'b', 'c')).toThrow(/active match/)
    expect(() => match.run('m2', 'c', 'a')).toThrow(/active match/)
    db.exec("UPDATE transfer_match_provenance SET unmatched_at = '2025-02-01' WHERE id = 'm1'")
    match.run('m2', 'b', 'c')
    expect(() =>
      db.exec("UPDATE transfer_match_provenance SET unmatched_at = NULL WHERE id = 'm1'")
    ).toThrow(/active match/)
    expect(rows(db, 'SELECT id FROM transfer_match_provenance')).toHaveLength(2)
    db.exec(
      "INSERT INTO duplicate_review_decisions (id, account_id, existing_transaction_id, candidate_identity_key, candidate_content_fingerprint, existing_evidence_fingerprint, decision) VALUES ('d', 'deleted-account', 'deleted-row', 'candidate-v1', 'content-v1', 'existing-v1', 'distinct')"
    )
    expect(() =>
      db.exec("UPDATE duplicate_review_decisions SET decision = 'keep_existing'")
    ).toThrow(/immutable/)
    expect(() => db.exec('DELETE FROM duplicate_review_decisions')).toThrow(/immutable/)
  })

  it('tracks only allowlisted financial writes, with rollback and recap/audit exclusions', () => {
    const db = database()
    runHostedTestMigrations(db)
    const revisionTriggers = rows(
      db,
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_data_revision_%'"
    ) as Array<{ name: string; tbl_name: string }>
    expect(revisionTriggers).toHaveLength(
      (FINANCIAL_REVISION_TABLES.length +
        DATED_FX_REVISION_TABLES.length +
        CLASSIFICATION_TYPES_REVISION_TABLES.length) *
        3
    )
    expect(new Set(revisionTriggers.map((t) => t.tbl_name))).toEqual(
      new Set([
        ...FINANCIAL_REVISION_TABLES,
        ...DATED_FX_REVISION_TABLES,
        ...CLASSIFICATION_TYPES_REVISION_TABLES,
      ])
    )
    db.exec("INSERT INTO accounts (id, name, type) VALUES ('a', 'A', 'checking')")
    expect(state(db).data_revision).toBe(1)
    expect(state(db).last_financial_write_at).toMatch(/^\d{4}-/)
    db.exec("UPDATE accounts SET balance = 1 WHERE id = 'a'; DELETE FROM accounts WHERE id = 'a'")
    expect(state(db).data_revision).toBe(3)
    db.exec("INSERT INTO settings (key, value) VALUES ('s', '1')")
    const before = state(db)
    db.exec(
      "INSERT INTO recaps (id, type, period_start, period_end, title, summary) VALUES ('r', 'monthly', '2025-01-01', '2025-01-31', 'T', 'S'); INSERT INTO audit_log (id, entity, action) VALUES ('audit', 'recaps', 'create')"
    )
    expect(state(db)).toEqual(before)
    expect(() =>
      db.transaction(() => {
        db.exec("UPDATE settings SET value = '2'")
        throw new Error('rollback')
      })()
    ).toThrow('rollback')
    expect(state(db)).toEqual(before)
  })

  it('rolls back all 021 DDL, data initialization, indexes and marker on hosted failure', () => {
    const db = database()
    runHostedTestMigrations(db, 20)
    legacyEvidence(db)
    const before = snapshot(db)
    const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
    const original = db.exec.bind(db)
    vi.spyOn(db, 'exec').mockImplementation((sql) => {
      if (sql.includes('CREATE TRIGGER IF NOT EXISTS trg_data_revision_'))
        throw new Error('injected migration failure')
      return original(sql)
    })
    expect(() => runHostedTestMigrations(db)).toThrow('injected migration failure')
    expect(snapshot(db)).toEqual(before)
    expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
  })

  it.each([
    { version: 19, fail: false },
    { version: 20, fail: false },
    { version: 20, fail: true },
  ] as const)(
    'uses the already-loaded native pool transaction for $version with rollback=$fail',
    async ({ version, fail }) => {
      const db = database()
      runHostedTestMigrations(db, version)
      legacyEvidence(db)
      const before = snapshot(db)
      const { api, invoke } = await mockNative(db, fail)
      if (fail) {
        await expect(api.getDb()).rejects.toThrow('injected migration failure')
        expect(snapshot(db)).toEqual(before)
      } else {
        await api.getDb()
        assertPreserved(db, before)
        expect(state(db)).toMatchObject({ data_revision: 0, last_financial_write_at: null })
        await api.query('SELECT 1')
      }
      const commands = invoke.mock.calls.map((call) => call[0])
      expect(commands.filter((c) => c === 'shikin_db_tx_begin')).toHaveLength(1)
      expect(commands.at(-1)).toBe(fail ? 'shikin_db_tx_rollback' : 'initialize_runtime_identity')
    }
  )

  it('initializes fresh native schema using complete trigger statements', async () => {
    const db = database()
    const { api } = await mockNative(db)
    await api.getDb()
    expect(
      rows(db, `SELECT name FROM _migrations WHERE name = '${BACKEND_FOUNDATION_MIGRATION}'`)
    ).toHaveLength(1)
    expect(state(db)).toMatchObject({ data_revision: 0, last_financial_write_at: null })
  })

  it.each(['hosted', 'native'] as const)(
    'rejects future versions without changes in %s startup',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db)
      db.exec("INSERT INTO _migrations (id, name) VALUES (25, '025_future')")
      const before = snapshot(db)
      if (engine === 'hosted') expect(() => runHostedTestMigrations(db)).toThrow(/newer/)
      else {
        const { api } = await mockNative(db)
        await expect(api.getDb()).rejects.toThrow(/newer/)
      }
      expect(snapshot(db)).toEqual(before)
    }
  )
})

describe('CLI staged restore and read-only readiness', { timeout: 20_000 }, () => {
  async function cli(path: string) {
    vi.stubEnv('HOME', path)
    vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
    vi.resetModules()
    return import('./database.js')
  }
  it.each([19, 20, 21, 22, 23, 24] as const)(
    'upgrades a staged %i backup, never its source, before successful restore',
    async (version) => {
      const path = home()
      const source = join(path, 'backup.db')
      const backup = database(source)
      runHostedTestMigrations(backup, version)
      legacyEvidence(backup)
      const before = snapshot(backup)
      backup.close()
      const digest = () => createHash('sha256').update(readFileSync(source)).digest('hex')
      const sourceDigest = digest()
      const api = await cli(path)
      await api.restoreDatabase({ sourcePath: source, dryRun: true })
      expect(digest()).toBe(sourceDigest)
      await api.restoreDatabase({ sourcePath: source, dryRun: false })
      expect(digest()).toBe(sourceDigest)
      expect(api.query('SELECT name FROM _migrations WHERE id = 23')).toEqual([
        { name: CLASSIFICATION_TYPES_MIGRATION },
      ])
      expect(api.query('SELECT name FROM _migrations WHERE id = 24')).toEqual([
        { name: SCOPED_BUDGETS_MIGRATION },
      ])
      api.close()
      const restored = database(api.getDatabasePath())
      // Restore metadata is an existing settings write, separate from the migration.
      const { settings: _settings, app_data_state: _state, ...financialBefore } = before
      assertPreserved(restored, financialBefore)
      expect(rows(restored, "SELECT key FROM settings WHERE key <> 'database_backups'")).toEqual([])
      expect(rows(restored, 'SELECT * FROM manual_exchange_rates')).toEqual([])
      expect(rows(restored, 'SELECT * FROM transaction_fx_evidence')).toEqual([])
    }
  )

  it('rejects failed staged migrations without promoting candidate or changing source/live evidence', async () => {
    const path = home()
    const api = await cli(path)
    mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
    const live = database(api.getDatabasePath())
    runHostedTestMigrations(live)
    live.close()
    const source = join(path, 'backup.db')
    const backup = database(source)
    runHostedTestMigrations(backup, 20)
    legacyEvidence(backup)
    // Force the initialization DML to fail, after ALTERs have started.
    backup.exec(
      "CREATE TRIGGER inject_failure BEFORE UPDATE ON investments BEGIN SELECT RAISE(ABORT, 'injected migration failure'); END"
    )
    backup.close()
    const sourceBytes = readFileSync(source)
    const liveBytes = readFileSync(api.getDatabasePath())
    await expect(api.restoreDatabase({ sourcePath: source })).rejects.toThrow(
      'injected migration failure'
    )
    expect(readFileSync(source)).toEqual(sourceBytes)
    expect(readFileSync(api.getDatabasePath())).toEqual(liveBytes)
    expect(
      readdirSync(join(path, 'data', 'com.asf.shikin')).some((name) =>
        name.includes('restore-candidate')
      )
    ).toBe(false)
    api.close()
  })

  it.each([19, 20, 21, 22, 23, 25] as const)(
    'does not auto-migrate normal CLI reads for schema %i',
    async (version) => {
      const path = home()
      const api = await cli(path)
      mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
      const db = database(api.getDatabasePath())
      runHostedTestMigrations(db, version === 25 ? 24 : version)
      if (version === 25) db.exec("INSERT INTO _migrations (id, name) VALUES (25, '025_future')")
      const before = snapshot(db)
      db.close()
      expect(() => api.query('SELECT 1')).toThrow(version === 25 ? /newer/ : /not ready/)
      api.close()
      expect(snapshot(database(api.getDatabasePath()))).toEqual(before)
    }
  )

  it('rejects future backups during staged validation without modifying source', async () => {
    const path = home()
    const source = join(path, 'future.db')
    const db = database(source)
    runHostedTestMigrations(db)
    db.exec("INSERT INTO _migrations (id, name) VALUES (99, '099_future')")
    db.close()
    const before = readFileSync(source)
    const api = await cli(path)
    await expect(api.restoreDatabase({ sourcePath: source, dryRun: true })).rejects.toThrow(/newer/)
    expect(readFileSync(source)).toEqual(before)
    api.close()
  })
})

describe('022 dated FX migration boundaries', () => {
  it.each(['hosted', 'native'] as const)(
    'rejects incomplete schema22 without repairing it (%s)',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db)
      db.exec('DROP TRIGGER trg_manual_fx_append_only')
      const before = snapshot(db)
      const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
      if (engine === 'hosted')
        expect(() => runHostedTestMigrations(db)).toThrow(/022 schema object/)
      else await expect((await mockNative(db)).api.getDb()).rejects.toThrow(/022 schema object/)
      expect(snapshot(db)).toEqual(before)
      expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
    }
  )

  it.each([19, 20, 21, 22, 23, 24] as const)(
    'upgrades %i preserving USD denomination without inferred FX authority',
    (version) => {
      const db = database()
      runHostedTestMigrations(db, version)
      db.exec(
        "INSERT INTO budgets(id,name,amount,period) VALUES ('budget','B',123,'monthly'); INSERT INTO goals(id,name,target_amount) VALUES ('goal','G',456)"
      )
      const before = snapshot(db)
      runHostedTestMigrations(db)
      assertPreserved(db, before)
      expect(rows(db, 'SELECT currency FROM budgets')).toEqual([{ currency: 'USD' }])
      expect(rows(db, 'SELECT currency FROM goals')).toEqual([{ currency: 'USD' }])
      expect(rows(db, "SELECT * FROM settings WHERE key = 'main_currency'")).toEqual([])
      expect(rows(db, 'SELECT * FROM manual_exchange_rates')).toEqual([])
    }
  )

  for (const engine of ['hosted', 'native'] as const) {
    it.each([0, 19, 20, 21] as const)(
      `atomically preserves fresh/%i schema after late 022 failure (${engine})`,
      async (version) => {
        const db = database()
        if (version) runHostedTestMigrations(db, version)
        const before = snapshot(db)
        const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
        if (engine === 'hosted') {
          const original = db.exec.bind(db)
          vi.spyOn(db, 'exec').mockImplementation((sql) => {
            if (sql.includes('CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_immutable_update'))
              throw new Error('injected migration failure')
            return original(sql)
          })
          expect(() => runHostedTestMigrations(db)).toThrow('injected migration failure')
        } else {
          const { api } = await mockNative(
            db,
            'CREATE TRIGGER IF NOT EXISTS trg_fx_evidence_immutable_update'
          )
          await expect(api.getDb()).rejects.toThrow('injected migration failure')
        }
        expect(snapshot(db)).toEqual(before)
        expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
      }
    )
    it.each([21, 22] as const)(`validates schema %i through ${engine} startup`, async (version) => {
      const db = database()
      runHostedTestMigrations(db, version)
      if (engine === 'hosted') runHostedTestMigrations(db)
      else await (await mockNative(db)).api.getDb()
      expect(rows(db, 'SELECT name FROM _migrations WHERE id = 22')).toEqual([
        { name: DATED_FX_MIGRATION },
      ])
    })
  }

  it('roundtrips schema22 main/rates/retained evidence through CLI restore and preserves snapshots', async () => {
    const path = home()
    const source = join(path, 'fx.db')
    const backup = database(source)
    runHostedTestMigrations(backup, 22)
    backup.exec(`
      INSERT INTO settings(key,value) VALUES ('main_currency','MXN');
      INSERT INTO accounts(id,name,type) VALUES ('a','Cash','checking');
      INSERT INTO transactions(id,account_id,type,amount,description,date) VALUES ('t','a','expense',1700,'Synthetic','2025-09-14');
      INSERT INTO manual_exchange_rates(id,from_currency,to_currency,rate_decimal,effective_from,created_at) VALUES ('rate','USD','MXN','17','2025-09-01','2025-09-01T00:00:00Z');
      INSERT INTO transaction_fx_evidence(id,transaction_id,original_transaction_id,original_account_id,transaction_type,status,ledger_treatment,input_amount_centavos,input_currency,account_amount_centavos,account_currency,account_balance_delta_centavos,transaction_date,rate_id,rate_decimal,created_at)
        VALUES ('fx','t','t','a','expense','posted','normal',100,'USD',1700,'MXN',-1700,'2025-09-14','rate','17','2025-09-14T00:00:00Z');
      DELETE FROM transactions WHERE id = 't';
    `)
    const before = snapshot(backup)
    backup.close()
    const sourceBytes = readFileSync(source)
    vi.stubEnv('HOME', path)
    vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
    vi.resetModules()
    const api = await import('./database.js')
    try {
      await api.restoreDatabase({ sourcePath: source, dryRun: false })
      expect(api.query("SELECT value FROM settings WHERE key = 'main_currency'")).toEqual([
        { value: 'MXN' },
      ])
      for (const table of ['manual_exchange_rates', 'transaction_fx_evidence'])
        expect(api.query(`SELECT * FROM ${table}`)).toEqual(before[table]!.rows)
      expect(readFileSync(source)).toEqual(sourceBytes)
    } finally {
      api.close()
    }
  })

  it.each([19, 20, 21] as const)(
    'preserves source and live database when schema%i candidate fails at migration022',
    async (version) => {
      const path = home()
      vi.stubEnv('HOME', path)
      vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
      vi.resetModules()
      const api = await import('./database.js')
      mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
      const live = database(api.getDatabasePath())
      runHostedTestMigrations(live)
      live.close()
      const source = join(path, 'broken-fx.db')
      const backup = database(source)
      runHostedTestMigrations(backup, version)
      backup.exec('CREATE TABLE manual_exchange_rates (incompatible TEXT)')
      backup.close()
      const beforeSource = readFileSync(source)
      const beforeLive = readFileSync(api.getDatabasePath())
      try {
        await expect(api.restoreDatabase({ sourcePath: source, dryRun: false })).rejects.toThrow()
        expect(readFileSync(source)).toEqual(beforeSource)
        expect(readFileSync(api.getDatabasePath())).toEqual(beforeLive)
      } finally {
        api.close()
      }
    }
  )
})

/** A populated, self-referenced classification graph plus untouched source/FX evidence. */
function classificationEvidence(db: Database.Database) {
  legacyEvidence(db)
  db.exec(`
    INSERT INTO transactions(id,account_id,type,amount,description,date) VALUES
      ('principal','cash','expense',100,'Principal','2025-01-03'),
      ('split-parent','cash','expense',300,'Split purchase','2025-01-04');
    INSERT INTO transaction_splits(id,transaction_id,category_id,amount) VALUES
      ('split-one','split-parent','01FOOD000000000000000000000',100),
      ('split-two','split-parent','01FOOD000000000000000000000',200);
    INSERT INTO transaction_consumption_classifications(id,transaction_id,split_id,role,referenced_purchase_id,created_at,updated_at) VALUES
      ('purchase','t1',NULL,'purchase',NULL,'original-created','original-updated'),
      ('refund','t2',NULL,'refund','purchase','refund-created','refund-updated'),
      ('principal-class','principal',NULL,'principal','purchase','principal-created','principal-updated'),
      ('split-class-one','split-parent','split-one','purchase',NULL,'split-created','split-updated'),
      ('split-class-two','split-parent','split-two','fee',NULL,'split-created','split-updated');
    INSERT INTO source_coverage(id,account_id,source_namespace,period_start,period_end,status) VALUES
      ('coverage','cash','synthetic','2025-01-01','2025-01-31','verified');
    INSERT INTO manual_exchange_rates(id,from_currency,to_currency,rate_decimal,effective_from,created_at) VALUES
      ('rate','USD','MXN','17','2025-01-01','original');
    INSERT INTO manual_exchange_rates(id,from_currency,to_currency,rate_decimal,effective_from,supersedes_rate_id,created_at) VALUES
      ('correction','USD','MXN','18','2025-01-01','rate','corrected');
    INSERT INTO transaction_fx_evidence(id,transaction_id,original_transaction_id,original_account_id,transaction_type,status,ledger_treatment,input_amount_centavos,input_currency,account_amount_centavos,account_currency,account_balance_delta_centavos,transaction_date,rate_id,rate_decimal,created_at) VALUES
      ('retained',NULL,'deleted','cash','expense','posted','normal',100,'USD',1700,'MXN',-1700,'2025-01-01','rate','17','retained'),
      ('live-fx','t1','t1','cash','expense','posted','normal',500,'USD',500,'USD',-500,'2025-01-01',NULL,'1','accepted');
  `)
}
function assertIntegrity(db: Database.Database) {
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  expect(db.pragma('defer_foreign_keys', { simple: true })).toBe(0)
  expect(db.pragma('foreign_key_check')).toEqual([])
  expect(db.pragma('integrity_check', { simple: true })).toBe('ok')
}

describe('023 classification foundation', () => {
  it.each(['hosted', 'native'] as const)(
    'preserves the populated purchase/refund/principal/split graph and exact financial digest (%s)',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db, 22)
      classificationEvidence(db)
      const before = snapshot(db)
      const digest = createHash('sha256').update(JSON.stringify(before)).digest('hex')
      if (engine === 'hosted') runHostedTestMigrations(db)
      else await (await mockNative(db)).api.getDb()
      assertPreserved(db, before)
      const projected = Object.fromEntries(
        Object.entries(before).map(([table, data]) => [
          table,
          table === '_migrations'
            ? data
            : {
                columns: data.columns,
                rows: rows(db, `SELECT ${data.columns.join(',')} FROM ${table} ORDER BY rowid`),
              },
        ])
      )
      expect(createHash('sha256').update(JSON.stringify(projected)).digest('hex')).toBe(digest)
      expect(
        rows(db, 'SELECT DISTINCT type_revision_id FROM transaction_consumption_classifications')
      ).toEqual([{ type_revision_id: null }])
      expect(rows(db, 'SELECT * FROM classification_types')).toEqual([])
      expect(rows(db, 'SELECT name FROM _migrations WHERE id = 23')).toEqual([
        { name: CLASSIFICATION_TYPES_MIGRATION },
      ])
      assertIntegrity(db)
    }
  )

  for (const engine of ['hosted', 'native'] as const) {
    it.each([
      'DROP TABLE transaction_consumption_classifications',
      'ALTER TABLE classification_assignments_023',
      'CREATE TRIGGER trg_classification_assignment_revision_insert',
      'INSERT INTO _migrations (id, name) VALUES (23',
    ])(`rolls back populated schema after failure at %s (${engine})`, async (failure) => {
      const db = database()
      runHostedTestMigrations(db, 22)
      classificationEvidence(db)
      const before = snapshot(db)
      const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
      if (engine === 'hosted') {
        const original = db.exec.bind(db)
        vi.spyOn(db, 'exec').mockImplementation((sql) => {
          if (sql.includes(failure)) throw new Error('injected migration failure')
          return original(sql)
        })
        expect(() => runHostedTestMigrations(db)).toThrow('injected migration failure')
      } else
        await expect((await mockNative(db, failure)).api.getDb()).rejects.toThrow(
          'injected migration failure'
        )
      expect(snapshot(db)).toEqual(before)
      expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
      assertIntegrity(db)
    })
  }

  it.each(['RESTRICT', 'CASCADE', 'SET NULL'])(
    'rolls back unsupported external %s foreign-key extensions',
    (action) => {
      const db = database()
      runHostedTestMigrations(db, 22)
      classificationEvidence(db)
      db.exec(
        `CREATE TABLE extension (id TEXT REFERENCES transaction_consumption_classifications(id) ON DELETE ${action}); INSERT INTO extension VALUES ('purchase')`
      )
      const before = snapshot(db)
      const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
      expect(() => runHostedTestMigrations(db)).toThrow(/external_references/)
      expect(snapshot(db)).toEqual(before)
      expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
      assertIntegrity(db)
    }
  )

  it('protects custom revisions, head ownership, role matching and historical assignments after archive', () => {
    const db = database()
    runHostedTestMigrations(db)
    legacyEvidence(db)
    const before = state(db).data_revision
    db.transaction(() => {
      db.exec(
        "INSERT INTO classification_types(id,current_revision_id) VALUES ('type','v1'); INSERT INTO classification_type_revisions(id,type_id,version,name,financial_treatment) VALUES ('v1','type',1,'Support','other_income')"
      )
    })()
    expect(state(db).data_revision).toBe(before + 2)
    const assign = db.prepare(
      "INSERT INTO transaction_consumption_classifications(id,transaction_id,role,type_revision_id) VALUES ('custom','t2',?,?)"
    )
    expect(() => assign.run('earned_income', 'v1')).toThrow(/must match/)
    expect(() => assign.run('other_income', 'missing')).toThrow(/must match/)
    assign.run('other_income', 'v1')
    db.transaction(() => {
      db.exec(
        "INSERT INTO classification_type_revisions(id,type_id,version,name,financial_treatment) VALUES ('v2','type',2,'New name and meaning','earned_income'); UPDATE classification_types SET current_revision_id = 'v2', archived = 1"
      )
    })()
    expect(
      rows(db, 'SELECT role,type_revision_id FROM transaction_consumption_classifications')
    ).toEqual([{ role: 'other_income', type_revision_id: 'v1' }])
    expect(
      rows(db, "SELECT name,financial_treatment FROM classification_type_revisions WHERE id='v1'")
    ).toEqual([{ name: 'Support', financial_treatment: 'other_income' }])
    db.exec(
      "UPDATE transaction_consumption_classifications SET updated_at = 'still-valid' WHERE id = 'custom'"
    )
    expect(() =>
      db.exec(
        "UPDATE transaction_consumption_classifications SET type_revision_id='v2',role='earned_income'"
      )
    ).toThrow(/Archived/)
    for (const sql of [
      "UPDATE classification_type_revisions SET name='Changed'",
      'DELETE FROM classification_type_revisions',
      "INSERT OR REPLACE INTO classification_type_revisions(id,type_id,version,name,financial_treatment) VALUES ('v1','type',1,'Replace','fee')",
      'DELETE FROM classification_types',
    ])
      expect(() => db.exec(sql)).toThrow(/immutable|append-only|Archive/)
    expect(() => db.exec("UPDATE classification_types SET current_revision_id='missing'")).toThrow(
      /FOREIGN KEY/
    )
    expect(() =>
      db.transaction(() => {
        db.exec("INSERT INTO classification_types(id,current_revision_id) VALUES ('wrong','v1')")
      })()
    ).toThrow(/FOREIGN KEY/)
    assertIntegrity(db)
  })

  it.each(['hosted', 'native'] as const)(
    'rejects incomplete schema023 without repairing it (%s)',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db)
      db.exec('DROP TRIGGER trg_classification_revision_immutable_update')
      const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
      if (engine === 'hosted')
        expect(() => runHostedTestMigrations(db)).toThrow(/023 schema object/)
      else await expect((await mockNative(db)).api.getDb()).rejects.toThrow(/023 schema object/)
      expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
    }
  )

  it.each([22, 23] as const)(
    'restores populated schema%i including links and immutable FX history without changing source',
    async (version) => {
      const path = home()
      const source = join(path, 'classification.db')
      const backup = database(source)
      runHostedTestMigrations(backup, version)
      classificationEvidence(backup)
      if (version === 23)
        backup.transaction(() => {
          backup.exec(
            "INSERT INTO classification_types(id,current_revision_id) VALUES ('type','v1'); INSERT INTO classification_type_revisions(id,type_id,version,name,financial_treatment) VALUES ('v1','type',1,'Supplies','purchase'); UPDATE transaction_consumption_classifications SET type_revision_id='v1' WHERE id='purchase'; UPDATE classification_types SET archived=1"
          )
        })()
      const before = snapshot(backup)
      backup.close()
      const sourceBytes = readFileSync(source)
      vi.stubEnv('HOME', path)
      vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
      vi.resetModules()
      const api = await import('./database.js')
      try {
        await api.restoreDatabase({ sourcePath: source, dryRun: true })
        await api.restoreDatabase({ sourcePath: source, dryRun: false })
        expect(readFileSync(source)).toEqual(sourceBytes)
        api.close()
        const restored = database(api.getDatabasePath())
        const { settings: _settings, app_data_state: _state, ...financialBefore } = before
        assertPreserved(restored, financialBefore)
        assertIntegrity(restored)
      } finally {
        api.close()
      }
    }
  )

  it('preserves source/live bytes and removes stage after late 023 restore failure', async () => {
    const path = home()
    vi.stubEnv('HOME', path)
    vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
    vi.resetModules()
    const api = await import('./database.js')
    mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
    const live = database(api.getDatabasePath())
    runHostedTestMigrations(live)
    live.close()
    const source = join(path, 'failure.db')
    const backup = database(source)
    runHostedTestMigrations(backup, 22)
    classificationEvidence(backup)
    backup.exec(
      "CREATE TRIGGER inject_023 BEFORE INSERT ON _migrations WHEN NEW.id=23 BEGIN SELECT RAISE(ABORT,'late 023 failure'); END"
    )
    backup.close()
    const sourceBytes = readFileSync(source)
    const liveBytes = readFileSync(api.getDatabasePath())
    try {
      await expect(api.restoreDatabase({ sourcePath: source, dryRun: false })).rejects.toThrow(
        'late 023 failure'
      )
      expect(readFileSync(source)).toEqual(sourceBytes)
      expect(readFileSync(api.getDatabasePath())).toEqual(liveBytes)
      expect(
        readdirSync(join(path, 'data', 'com.asf.shikin')).some((name) =>
          name.includes('restore-candidate')
        )
      ).toBe(false)
    } finally {
      api.close()
    }
  })
})

describe('024 scoped budget storage', () => {
  it.each(['hosted', 'native'] as const)(
    'upgrades without changing legacy financial rows and preserves scoped budgets on category deletion (%s)',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db, 23)
      db.exec(`
        INSERT INTO categories(id,name,type) VALUES ('food','Food','expense'),('travel','Travel','expense'),('other','Other','expense');
        INSERT INTO accounts(id,name,type) VALUES ('bank','Bank','checking');
        INSERT INTO transactions(id,account_id,category_id,type,amount,description,date)
          VALUES ('purchase','bank','food','expense',123,'Purchase','2025-02-01');
        INSERT INTO budgets(id,category_id,name,amount,currency,period,is_active)
          VALUES ('legacy','food','Legacy',1000,'MXN','monthly',0),
            ('single','food','Single',2000,'USD','weekly',1),
            ('multi','food','Multi',3000,'MXN','yearly',1),
            ('unrelated','other','Other',4000,'USD','monthly',1);
        INSERT INTO budget_periods(id,budget_id,start_date,end_date,spent)
          VALUES ('period','legacy','2025-02-01','2025-02-28',250);
      `)
      const before = snapshot(db)
      if (engine === 'hosted') runHostedTestMigrations(db)
      else await (await mockNative(db)).api.getDb()
      assertPreserved(db, before)
      expect(
        rows(
          db,
          'SELECT id,category_id,amount,currency,period,is_active,scope_json,basis FROM budgets ORDER BY id'
        )
      ).toEqual([
        {
          id: 'legacy',
          category_id: 'food',
          amount: 1000,
          currency: 'MXN',
          period: 'monthly',
          is_active: 0,
          scope_json: '{}',
          basis: 'gross_cashflow',
        },
        {
          id: 'multi',
          category_id: 'food',
          amount: 3000,
          currency: 'MXN',
          period: 'yearly',
          is_active: 1,
          scope_json: '{}',
          basis: 'gross_cashflow',
        },
        {
          id: 'single',
          category_id: 'food',
          amount: 2000,
          currency: 'USD',
          period: 'weekly',
          is_active: 1,
          scope_json: '{}',
          basis: 'gross_cashflow',
        },
        {
          id: 'unrelated',
          category_id: 'other',
          amount: 4000,
          currency: 'USD',
          period: 'monthly',
          is_active: 1,
          scope_json: '{}',
          basis: 'gross_cashflow',
        },
      ])
      db.exec(`
        UPDATE budgets SET scope_json='{"categoryIds":["food"],"tags":["grocery"]}' WHERE id='single';
        UPDATE budgets SET scope_json='{"categoryIds":["food","travel"],"excludeAccountIds":["bank"]}' WHERE id='multi';
      `)
      expect(() => db.exec("UPDATE budgets SET basis='not_a_basis' WHERE id='single'")).toThrow(
        /CHECK/
      )
      for (const invalid of ['[]', 'null', 'not json'])
        expect(() =>
          db.prepare('UPDATE budgets SET scope_json=? WHERE id=?').run(invalid, 'single')
        ).toThrow(/CHECK/)
      const periods = rows(db, 'SELECT * FROM budget_periods')
      const original = rows(
        db,
        'SELECT id,name,amount,currency,period,is_active,created_at,updated_at FROM budgets ORDER BY id'
      )
      db.exec("DELETE FROM categories WHERE id='food'")
      expect(rows(db, 'SELECT id,category_id,scope_json FROM budgets ORDER BY id')).toEqual([
        { id: 'legacy', category_id: null, scope_json: '{"categoryIds":["food"]}' },
        {
          id: 'multi',
          category_id: null,
          scope_json: '{"categoryIds":["food","travel"],"excludeAccountIds":["bank"]}',
        },
        {
          id: 'single',
          category_id: null,
          scope_json: '{"categoryIds":["food"],"tags":["grocery"]}',
        },
        { id: 'unrelated', category_id: 'other', scope_json: '{}' },
      ])
      expect(
        rows(
          db,
          'SELECT id,name,amount,currency,period,is_active,created_at,updated_at FROM budgets ORDER BY id'
        )
      ).toEqual(original)
      expect(rows(db, 'SELECT * FROM budget_periods')).toEqual(periods)
      expect(rows(db, 'SELECT id,amount,category_id FROM transactions')).toEqual([
        { id: 'purchase', amount: 123, category_id: null },
      ])
      expect(db.pragma('foreign_key_check')).toEqual([])
      const after = snapshot(db)
      runHostedTestMigrations(db)
      expect(snapshot(db)).toEqual(after)
    }
  )

  it.each(['hosted', 'native'] as const)('rolls back a late 024 failure (%s)', async (engine) => {
    const db = database()
    runHostedTestMigrations(db, 23)
    db.exec("INSERT INTO budgets(id,name,amount,period) VALUES ('old','Original',123,'monthly')")
    const before = snapshot(db)
    const schema = rows(db, 'SELECT * FROM sqlite_master ORDER BY name')
    if (engine === 'hosted') {
      db.exec(
        "CREATE TRIGGER inject_024 BEFORE INSERT ON _migrations WHEN NEW.id=24 BEGIN SELECT RAISE(ABORT,'late 024 failure'); END"
      )
      expect(() => runHostedTestMigrations(db)).toThrow(/late 024 failure/)
    } else {
      await expect(
        (await mockNative(db, 'INSERT INTO _migrations (id, name) VALUES (24')).api.getDb()
      ).rejects.toThrow(/injected migration failure/)
    }
    expect(snapshot(db)).toEqual(before)
    if (engine === 'native')
      expect(rows(db, 'SELECT * FROM sqlite_master ORDER BY name')).toEqual(schema)
    else
      expect(
        rows(
          db,
          "SELECT name FROM sqlite_master WHERE name IN ('scope_json','trg_scoped_budgets_category_delete')"
        )
      ).toEqual([])
  })

  it.each(['hosted', 'native'] as const)(
    'refuses missing or incompatible 024 trigger (%s)',
    async (engine) => {
      const db = database()
      runHostedTestMigrations(db)
      db.exec('DROP TRIGGER trg_scoped_budgets_category_delete')
      const before = snapshot(db)
      if (engine === 'hosted')
        expect(() => runHostedTestMigrations(db)).toThrow(/024 schema object/)
      else await expect((await mockNative(db)).api.getDb()).rejects.toThrow(/024 schema object/)
      expect(snapshot(db)).toEqual(before)
    }
  )
})

describe('024 staged restore validation', () => {
  it('rejects a 024 backup missing category-retention protection without changing source or live data', async () => {
    const path = home()
    const api = await (async () => {
      vi.stubEnv('HOME', path)
      vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
      vi.resetModules()
      return import('./database.js')
    })()
    mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
    const live = database(api.getDatabasePath())
    runHostedTestMigrations(live)
    live.close()
    const source = join(path, 'unsafe24.db')
    const backup = database(source)
    runHostedTestMigrations(backup)
    backup.exec('DROP TRIGGER trg_scoped_budgets_category_delete')
    backup.close()
    const originalSource = readFileSync(source)
    const originalLive = readFileSync(api.getDatabasePath())
    await expect(api.restoreDatabase({ sourcePath: source, dryRun: true })).rejects.toThrow(
      /024 schema object/
    )
    expect(readFileSync(source)).toEqual(originalSource)
    expect(readFileSync(api.getDatabasePath())).toEqual(originalLive)
    api.close()
  })

  it('rolls back a late 024 upgrade on the staged copy only', async () => {
    const path = home()
    vi.stubEnv('HOME', path)
    vi.stubEnv('XDG_DATA_HOME', join(path, 'data'))
    vi.resetModules()
    const api = await import('./database.js')
    mkdirSync(join(path, 'data', 'com.asf.shikin'), { recursive: true })
    const live = database(api.getDatabasePath())
    runHostedTestMigrations(live)
    live.close()
    const source = join(path, 'old23.db')
    const backup = database(source)
    runHostedTestMigrations(backup, 23)
    backup.exec(
      "CREATE TRIGGER inject_024 BEFORE INSERT ON _migrations WHEN NEW.id=24 BEGIN SELECT RAISE(ABORT,'late 024 failure'); END"
    )
    backup.close()
    const originalSource = readFileSync(source)
    const originalLive = readFileSync(api.getDatabasePath())
    await expect(api.restoreDatabase({ sourcePath: source, dryRun: true })).rejects.toThrow(
      /late 024 failure/
    )
    expect(readFileSync(source)).toEqual(originalSource)
    expect(readFileSync(api.getDatabasePath())).toEqual(originalLive)
    expect(
      readdirSync(join(path, 'data', 'com.asf.shikin')).some((name) =>
        name.includes('restore-candidate')
      )
    ).toBe(false)
    api.close()
  })
})
