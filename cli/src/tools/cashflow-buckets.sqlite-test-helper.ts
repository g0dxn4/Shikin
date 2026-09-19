import Database from 'better-sqlite3'
import { FINANCIAL_REVISION_TABLES } from '@shikin/finance-core'
import { applyBackendFoundationTestSchema } from '../backend-foundation-test-schema.js'

const FOUNDATION_CREATED_TABLES = new Set([
  'instrument_prices',
  'transaction_consumption_classifications',
  'source_coverage',
  'reconciliation_corrections',
  'transfer_match_provenance',
  'duplicate_review_decisions',
  'card_statement_payment_links',
])

export function convertPositionalSql(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?')
}

export type CashflowTestBindings = {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => T[]
  execute: (sql: string, params?: unknown[]) => { rowsAffected: number; lastInsertId: number }
  transaction: <T>(fn: () => T) => T
}

export type CashflowBucketsTestHarness = CashflowTestBindings & {
  db: Database.Database
  onBeforeTransaction: (() => void) | null
  onTransactionStart: (() => void) | null
  failOnExecuteCall: number | null
  executeCalls: number
  close: () => void
}

export function createCashflowBucketsTestDatabase(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE _migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'checking',
      currency TEXT NOT NULL DEFAULT 'USD',
      balance INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      account_mode TEXT NOT NULL DEFAULT 'transactional'
    );
    CREATE TABLE account_reconciliations (
      id TEXT PRIMARY KEY,
      account_id TEXT,
      staging_batch_id TEXT
    );
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id),
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      description TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT,
      source TEXT,
      note TEXT,
      ledger_treatment TEXT NOT NULL DEFAULT 'normal',
      reporting_treatment TEXT NOT NULL DEFAULT 'normal',
      transaction_kind TEXT NOT NULL DEFAULT 'standard',
      staging_batch_id TEXT,
      is_archived INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      entity TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE cashflow_buckets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_amount INTEGER,
      balance INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'USD',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE cashflow_bucket_allocations (
      id TEXT PRIMARY KEY,
      bucket_id TEXT NOT NULL REFERENCES cashflow_buckets(id),
      transaction_id TEXT,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      allocation_date TEXT NOT NULL,
      source TEXT,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
    CREATE TABLE investments (
      id TEXT PRIMARY KEY,
      avg_cost_basis INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE credit_card_statements (
      id TEXT PRIMARY KEY,
      paid_amount INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE recaps (
      id TEXT PRIMARY KEY
    );
  `)

  for (const table of FINANCIAL_REVISION_TABLES) {
    if (FOUNDATION_CREATED_TABLES.has(table)) continue
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY)`)
  }

  applyBackendFoundationTestSchema(db)
  return db
}

export function createCashflowBucketsTestHarness(): CashflowBucketsTestHarness {
  const db = createCashflowBucketsTestDatabase()
  const harness: CashflowBucketsTestHarness = {
    db,
    onBeforeTransaction: null,
    onTransactionStart: null,
    failOnExecuteCall: null,
    executeCalls: 0,
    query<T = Record<string, unknown>>(sql: string, params?: unknown[]) {
      return db.prepare(convertPositionalSql(sql)).all(...(params ?? [])) as T[]
    },
    execute(sql: string, params?: unknown[]) {
      harness.executeCalls += 1
      if (harness.failOnExecuteCall === harness.executeCalls) {
        throw new Error(`Injected execute failure on call ${harness.executeCalls}`)
      }
      const result = db.prepare(convertPositionalSql(sql)).run(...(params ?? []))
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    },
    transaction<T>(fn: () => T) {
      harness.onBeforeTransaction?.()
      return db
        .transaction(() => {
          harness.onTransactionStart?.()
          return fn()
        })
        .immediate()
    },
    close() {
      db.close()
    },
  }
  return harness
}

export function insertAccount(
  db: Database.Database,
  account: {
    id: string
    name?: string
    type?: string
    currency?: string
    balance?: number
    isArchived?: number
  }
) {
  db.prepare(
    `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    account.id,
    account.name ?? account.id,
    account.type ?? 'checking',
    account.currency ?? 'USD',
    account.balance ?? 0,
    account.isArchived ?? 0
  )
}

export function insertTransaction(
  db: Database.Database,
  tx: {
    id: string
    accountId: string
    type?: string
    amount: number
    currency?: string
    description?: string
    date?: string
    status?: string | null
    ledgerTreatment?: string
    reportingTreatment?: string
    transactionKind?: string
    stagingBatchId?: string | null
    isArchived?: number
  }
) {
  db.prepare(
    `INSERT INTO transactions (
       id, account_id, type, amount, currency, description, date, status,
       ledger_treatment, reporting_treatment, transaction_kind, staging_batch_id, is_archived
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tx.id,
    tx.accountId,
    tx.type ?? 'income',
    tx.amount,
    tx.currency ?? 'USD',
    tx.description ?? tx.id,
    tx.date ?? '2026-05-01',
    tx.status ?? 'posted',
    tx.ledgerTreatment ?? 'normal',
    tx.reportingTreatment ?? 'normal',
    tx.transactionKind ?? 'standard',
    tx.stagingBatchId ?? null,
    tx.isArchived ?? 0
  )
}

export function readAccounts(db: Database.Database) {
  return db
    .prepare('SELECT id, name, type, currency, balance, is_archived FROM accounts ORDER BY id')
    .all()
}

export function readTransactions(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, account_id, type, amount, currency, description, date, status,
              ledger_treatment, reporting_treatment, transaction_kind, staging_batch_id, is_archived
       FROM transactions ORDER BY id`
    )
    .all()
}

export function readBuckets(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, name, description, target_amount, balance, currency, sort_order, is_active
       FROM cashflow_buckets ORDER BY id`
    )
    .all()
}

export function readAllocations(db: Database.Database) {
  return db
    .prepare(
      `SELECT id, bucket_id, transaction_id, amount, currency, allocation_date, source, note,
              reverses_allocation_id, replaces_allocation_id
       FROM cashflow_bucket_allocations ORDER BY created_at ASC, id ASC`
    )
    .all()
}

export function readAudit(db: Database.Database) {
  return db
    .prepare(
      `SELECT entity, entity_id, action, before_json, after_json, source, note
       FROM audit_log ORDER BY created_at ASC, id ASC`
    )
    .all() as Array<{
    entity: string
    entity_id: string | null
    action: string
    before_json: string | null
    after_json: string | null
    source: string | null
    note: string | null
  }>
}

export function readLedger(db: Database.Database) {
  return {
    accounts: readAccounts(db),
    transactions: readTransactions(db),
  }
}
