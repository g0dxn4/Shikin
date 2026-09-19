// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const databaseState = vi.hoisted(() => ({ current: null as Database.Database | null }))

vi.mock('./database.js', () => ({
  query: <T>(sql: string, params: unknown[] = []): T[] =>
    databaseState.current!.prepare(sql.replace(/\$\d+/g, '?')).all(...params) as T[],
  execute: (sql: string, params: unknown[] = []) => {
    const result = databaseState.current!.prepare(sql.replace(/\$\d+/g, '?')).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  },
  transaction: <T>(callback: () => T): T =>
    databaseState.current!.transaction(callback).immediate(),
}))

import { executeAtomicImport, type AtomicImportRequest } from './import-transactions'
import { transactionsTools } from './tools/transactions'

let db: Database.Database

function setupDatabase(): void {
  db = new Database(':memory:')
  databaseState.current = db
  db.exec(`
    CREATE TABLE accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, currency TEXT NOT NULL, balance INTEGER NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0, account_mode TEXT NOT NULL DEFAULT 'transactional',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT, type TEXT);
    CREATE TABLE transactions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, category_id TEXT, transfer_to_account_id TEXT,
      type TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT NOT NULL,
      notes TEXT, status TEXT, source TEXT, note TEXT, recurring_rule_id TEXT,
      ledger_treatment TEXT, reporting_treatment TEXT, transaction_kind TEXT, staging_batch_id TEXT,
      import_source TEXT, import_external_id TEXT, import_fingerprint TEXT,
      import_content_fingerprint TEXT, is_archived INTEGER DEFAULT 0, date TEXT NOT NULL,
      finalization_id TEXT, reconciliation_id TEXT, matched_transaction_id TEXT, tags TEXT,
      is_placeholder INTEGER DEFAULT 0, placeholder_status TEXT, resolved_at TEXT,
      resolved_by_transaction_id TEXT, placeholder_reason TEXT, placeholder_parent_transaction_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE subcategories (id TEXT PRIMARY KEY, category_id TEXT, name TEXT);
    CREATE TABLE account_reconciliations (
      id TEXT PRIMARY KEY, reconciliation_date TEXT, account_id TEXT, adjustment_amount INTEGER,
      staging_batch_id TEXT, statement_start_date TEXT, statement_end_date TEXT, source TEXT, note TEXT
    );
    CREATE TABLE transaction_splits (
      id TEXT PRIMARY KEY, transaction_id TEXT NOT NULL, category_id TEXT NOT NULL,
      subcategory_id TEXT, amount INTEGER NOT NULL, notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, entity TEXT, entity_id TEXT, action TEXT, before_json TEXT, after_json TEXT,
      source TEXT, note TEXT, created_at TEXT
    );
    CREATE TABLE app_data_state (
      id INTEGER PRIMARY KEY, database_id TEXT NOT NULL, data_revision INTEGER NOT NULL,
      last_financial_write_at TEXT
    );
    CREATE TABLE duplicate_review_decisions (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, existing_transaction_id TEXT NOT NULL,
      candidate_identity_key TEXT NOT NULL, candidate_content_fingerprint TEXT NOT NULL,
      existing_evidence_fingerprint TEXT NOT NULL, decision TEXT NOT NULL, source TEXT, note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO accounts (id, name, currency, balance) VALUES ('account-1', 'Checking', 'USD', 10000);
    INSERT INTO app_data_state (id, database_id, data_revision) VALUES (1, 'atomic-import-test', 0);
  `)
}

function request(descriptions = ['First', 'Second']): AtomicImportRequest {
  return {
    rawContent: descriptions.join(','),
    options: {
      accountId: 'account-1',
      accountCurrency: 'USD',
      sourceNamespace: 'Bank CSV',
      ledgerTreatment: 'normal',
      reportingTreatment: 'normal',
    },
    rows: descriptions.map((description, index) => ({
      row: index + 2,
      lineNumber: index + 2,
      externalId: `opaque-${index}`,
      input: {
        accountId: 'account-1',
        amountCentavos: 1000,
        type: 'expense',
        description,
        date: `2026-01-0${index + 1}`,
        source: 'Bank CSV',
      },
    })),
    apply: false,
  }
}

beforeEach(setupDatabase)
afterEach(() => {
  databaseState.current = null
  db.close()
})

describe('atomic CLI import', () => {
  it('previews without writes, applies the exact token, and reimports idempotently', () => {
    const preview = executeAtomicImport(request()) as {
      success: boolean
      previewToken: string
      mode: string
    }
    expect(preview).toMatchObject({ success: true, mode: 'preview' })
    expect(preview.previewToken).toMatch(/^sha256:/)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })

    const applied = executeAtomicImport({
      ...request(),
      apply: true,
      previewToken: preview.previewToken,
    })
    expect(applied).toMatchObject({ success: true, mode: 'reviewed_atomic' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 2 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 8000,
    })

    const repeated = executeAtomicImport({ ...request(), apply: true })
    expect(repeated).toMatchObject({ success: true, mode: 'unreviewed_atomic' })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 2 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 8000,
    })
  })

  it('rejects stale preview revisions before any write', () => {
    const preview = executeAtomicImport(request()) as { previewToken: string }
    db.prepare('UPDATE app_data_state SET data_revision = 1 WHERE id = 1').run()

    expect(() =>
      executeAtomicImport({ ...request(), apply: true, previewToken: preview.previewToken })
    ).toThrow(/stale|does not match/i)
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
  })

  it('traverses more than 100 identical timestamps without gaps and rejects stale cursors', async () => {
    const insert = db.prepare(
      `INSERT INTO transactions (
         id, account_id, type, amount, currency, description, status, ledger_treatment,
         reporting_treatment, transaction_kind, is_archived, date, created_at
       ) VALUES (?, 'account-1', 'expense', 100, 'USD', ?, 'posted', 'normal', 'normal', 'standard', 0, '2026-02-01', '2026-02-01T12:00:00.000Z')`
    )
    const insertMany = db.transaction(() => {
      for (let index = 0; index < 125; index++) {
        const id = `tx-${String(index).padStart(3, '0')}`
        insert.run(id, `Row ${index}`)
      }
    })
    insertMany()
    db.prepare("INSERT INTO categories (id,name,type) VALUES ('food','Food','expense')").run()
    db.prepare(
      "INSERT INTO transaction_splits (id,transaction_id,category_id,amount,notes) VALUES ('split-1','tx-124','food',100,'complete split')"
    ).run()
    db.prepare('UPDATE app_data_state SET data_revision = 10 WHERE id = 1').run()
    const tool = transactionsTools.find((candidate) => candidate.name === 'query-transactions')!

    const first = await tool.execute(tool.schema.parse({ limit: 100 }))
    expect(first).toMatchObject({ success: true, count: 100, totalMatched: 125, hasMore: true })
    expect(first.transactions[0]).toMatchObject({ id: 'tx-124', splits: [{ id: 'split-1' }] })
    const second = await tool.execute(tool.schema.parse({ limit: 100, cursor: first.nextCursor }))
    expect(second).toMatchObject({ success: true, count: 25, totalMatched: 125, hasMore: false })
    const ids = [...first.transactions, ...second.transactions].map(
      (transaction: { id: string }) => transaction.id
    )
    expect(new Set(ids).size).toBe(125)
    const filterMismatch = await tool.execute(
      tool.schema.parse({ limit: 100, type: 'income', cursor: first.nextCursor })
    )
    expect(filterMismatch).toMatchObject({ success: false, reason: 'cursor_filter_mismatch' })
    const tampered = await tool.execute(
      tool.schema.parse({ limit: 100, cursor: `${first.nextCursor}x` })
    )
    expect(tampered).toMatchObject({ success: false, reason: 'invalid_cursor' })

    db.prepare("UPDATE transactions SET description='changed' WHERE id='tx-000'").run()
    db.prepare('UPDATE app_data_state SET data_revision = 11 WHERE id = 1').run()
    const stale = await tool.execute(tool.schema.parse({ limit: 100, cursor: first.nextCursor }))
    expect(stale).toMatchObject({ success: false, reason: 'cursor_stale' })
  })

  it('requires and persists candidate-specific no-ID decisions', () => {
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, type, amount, currency, description, status, ledger_treatment,
         reporting_treatment, transaction_kind, is_archived, date
       ) VALUES ('existing-candidate','account-1','expense',1000,'USD','Existing label','posted','normal','normal','standard',0,'2026-01-01')`
    ).run()
    const candidateRequest: AtomicImportRequest = {
      ...request(['Imported label']),
      rows: [
        {
          ...request(['Imported label']).rows[0],
          externalId: null,
        },
      ],
    }
    const undecided = executeAtomicImport(candidateRequest) as {
      success: boolean
      requiredDecisions: Array<{
        candidateIdentityKey: string
        candidateContentFingerprint: string
        existingTransactionId: string
        existingEvidenceFingerprint: string
      }>
    }
    expect(undecided).toMatchObject({ success: false })
    expect(undecided.requiredDecisions).toHaveLength(1)
    const decisions = [{ ...undecided.requiredDecisions[0], decision: 'distinct' as const }]
    const reviewed = executeAtomicImport({ ...candidateRequest, decisions }) as {
      success: boolean
      previewToken: string
    }
    expect(reviewed.success).toBe(true)
    executeAtomicImport({
      ...candidateRequest,
      decisions,
      apply: true,
      previewToken: reviewed.previewToken,
    })
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 2 })
    expect(db.prepare('SELECT decision FROM duplicate_review_decisions').get()).toEqual({
      decision: 'distinct',
    })
  })

  it('binds explicit legacy external identity without fabricating original content', async () => {
    db.prepare(
      `INSERT INTO transactions (
         id, account_id, type, amount, currency, description, status, ledger_treatment,
         reporting_treatment, transaction_kind, is_archived, date
       ) VALUES ('legacy-1','account-1','expense',500,'USD','Edited legacy row','posted','normal','normal','standard',0,'2026-01-01')`
    ).run()
    const tool = transactionsTools.find(
      (candidate) => candidate.name === 'bind-transaction-import-identity'
    )!
    const input = {
      transactionId: 'legacy-1',
      sourceNamespace: 'Bank Scope',
      externalId: '001-Case',
      source: 'test-review',
      note: 'verified statement evidence',
    }
    const preview = await tool.execute(tool.schema.parse(input))
    expect(preview).toMatchObject({
      success: true,
      dryRun: true,
      binding: { importExternalId: '001-Case', importContentFingerprint: null },
    })
    const applied = await tool.execute(
      tool.schema.parse({ ...input, apply: true, previewToken: preview.previewToken })
    )
    expect(applied).toMatchObject({ success: true, mode: 'reviewed_atomic' })
    expect(
      db
        .prepare(
          "SELECT import_source, import_external_id, import_fingerprint, import_content_fingerprint FROM transactions WHERE id='legacy-1'"
        )
        .get()
    ).toMatchObject({
      import_source: 'Bank Scope',
      import_external_id: '001-Case',
      import_fingerprint: expect.any(String),
      import_content_fingerprint: null,
    })
  })

  it('rolls back transactions, balances, audits, and evidence after a middle write failure', () => {
    db.exec(`
      CREATE TRIGGER fail_second_import BEFORE INSERT ON transactions
      WHEN NEW.description = 'Failing'
      BEGIN SELECT RAISE(ABORT, 'synthetic middle failure'); END;
    `)

    expect(() =>
      executeAtomicImport({ ...request(['Earlier', 'Failing', 'Never']), apply: true })
    ).toThrow('synthetic middle failure')
    expect(db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM duplicate_review_decisions').get()).toEqual({
      count: 0,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual({
      balance: 10000,
    })
  })
})
