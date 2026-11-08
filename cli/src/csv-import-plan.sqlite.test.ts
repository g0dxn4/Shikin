// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    const result = state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  },
  transaction: (fn: () => unknown) => state.db.transaction(fn).immediate(),
}))

import { importTransactions } from './tools/csv-import.js'

let dir: string
let file: string

async function run(input: Record<string, unknown> = {}) {
  return importTransactions.execute(
    importTransactions.schema.parse({ file, account: 'Padded fixture', ...input })
  )
}

function publicPlan(result: Record<string, unknown>) {
  const {
    success,
    mode,
    previewToken,
    databaseId,
    dataRevision,
    summary,
    rows,
    conflicts,
    requiredDecisions,
    account,
  } = result
  return {
    success,
    mode,
    previewToken,
    databaseId,
    dataRevision,
    summary,
    rows,
    conflicts,
    requiredDecisions,
    account,
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shikin-csv-plan-'))
  file = join(dir, 'transactions.csv')
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO settings (key, value) VALUES ('main_currency', 'USD');
    INSERT INTO accounts (id, name, type, currency, balance)
      VALUES ('bank', 'Canonical fixture', 'checking', 'USD', 10000),
             (' bank ', 'Padded fixture', 'checking', 'USD', 20000);
    DELETE FROM categories;
    INSERT INTO categories (id, name, type) VALUES ('food', 'Food', 'expense');
    UPDATE app_data_state SET database_id = 'csv-parent-baseline', data_revision = 37 WHERE id = 1;
  `)
})

afterEach(() => {
  state.db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('CSV parent-baseline plan compatibility', () => {
  it('pins parsed row identities and token, then writes to the parsed account ID', async () => {
    writeFileSync(
      file,
      'date,description,amount,type,category,notes,status,currency,source,note,externalId\n' +
        ' 2026-05-01 , Coffee fixture ,-0.10,expense, foo , note fixture ,posted, usd , Row source , workflow note ,  opaque-01  \n' +
        '2026-05-02,Salary fixture,12.345,income,,,pending,USD,,,salary-02\n'
    )
    const before = state.db.serialize()
    const preview = await run({ source: ' Bank CSV ', reportingTreatment: 'exclude_from_cashflow' })
    // These literal vectors are captured from the pre-E parent (042228c), not recomputed by the test.
    expect(publicPlan(preview)).toMatchInlineSnapshot(`
      {
        "account": {
          "currency": "USD",
          "id": " bank ",
        },
        "conflicts": [],
        "dataRevision": 37,
        "databaseId": "csv-parent-baseline",
        "mode": "preview",
        "previewToken": "sha256:a93342e9b86aa80410da1d7168c5131ad60e0133c9285f0f468220a1b5b51c9a",
        "requiredDecisions": [],
        "rows": [
          {
            "contentFingerprint": "sha256:6df619293d6dc0a91f032a377ce347c3a52caf2fa653ac8fb957ea1e6694ee40",
            "existingTransactionId": undefined,
            "externalId": "  opaque-01  ",
            "identityKey": "sha256:b2b4f6c1a1712dfdd1fcc7d700885dfd19948dd2a29fa05c17fcb3a041720c86",
            "importFingerprint": "{"version":1,"namespace":"shikin-statement-identity","strategy":"external_id","accountId":"bank","sourceNamespace":"Bank CSV","externalId":"  opaque-01  "}",
            "lineNumber": 2,
            "row": 2,
            "status": "create",
          },
          {
            "contentFingerprint": "sha256:888b3e41d4898d1b1622d3695e21fc902a3a64534b1dd1808893ef2bcd390ca0",
            "existingTransactionId": undefined,
            "externalId": "salary-02",
            "identityKey": "sha256:f48d6b46cb07bd1367833f42be20402a48a4740ba420ad0f12022ea3e6907eb3",
            "importFingerprint": "{"version":1,"namespace":"shikin-statement-identity","strategy":"external_id","accountId":"bank","sourceNamespace":"Bank CSV","externalId":"salary-02"}",
            "lineNumber": 3,
            "row": 3,
            "status": "create",
          },
        ],
        "success": true,
        "summary": {
          "importedRows": 2,
          "skippedRows": 0,
          "totalRows": 2,
        },
      }
    `)
    expect(state.db.serialize()).toEqual(before)

    expect(
      await run({
        source: ' Bank CSV ',
        reportingTreatment: 'exclude_from_cashflow',
        apply: true,
        previewToken: preview.previewToken,
      })
    ).toMatchObject({ success: true, mode: 'reviewed_atomic', dataRevision: 37 })
    expect(
      state.db
        .prepare(
          `SELECT account_id, category_id, type, amount, currency, description, date, notes,
                  status, source, note, ledger_treatment, reporting_treatment, import_external_id
           FROM transactions ORDER BY date`
        )
        .all()
    ).toEqual([
      {
        account_id: 'bank',
        category_id: 'food',
        type: 'expense',
        amount: 10,
        currency: 'USD',
        description: 'Coffee fixture',
        date: '2026-05-01',
        notes: 'note fixture',
        status: 'posted',
        source: 'Row source',
        note: 'workflow note',
        ledger_treatment: 'normal',
        reporting_treatment: 'exclude_from_cashflow',
        import_external_id: '  opaque-01  ',
      },
      {
        account_id: 'bank',
        category_id: null,
        type: 'income',
        amount: 1234500,
        currency: 'USD',
        description: 'Salary fixture',
        date: '2026-05-02',
        notes: null,
        status: 'pending',
        source: 'Bank CSV',
        note: null,
        ledger_treatment: 'normal',
        reporting_treatment: 'exclude_from_cashflow',
        import_external_id: 'salary-02',
      },
    ])
    expect(state.db.prepare('SELECT id, balance FROM accounts ORDER BY id').all()).toEqual([
      { id: ' bank ', balance: 20000 },
      { id: 'bank', balance: 9990 },
    ])
  })

  it('detects duplicates on the parsed account ID rather than the raw resolved ID', async () => {
    state.db.exec(`
      INSERT INTO transactions (
        id, account_id, type, amount, currency, description, date,
        import_source, import_external_id, created_at, updated_at
      ) VALUES
        ('bank-duplicate', 'bank', 'expense', 10, 'USD', 'Existing canonical', '2026-05-01',
         'csv-import', 'opaque-id', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
        ('padded-decoy', ' bank ', 'expense', 99, 'USD', 'Existing padded', '2026-05-01',
         'csv-import', 'opaque-id', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z');
      UPDATE app_data_state SET data_revision = 37 WHERE id = 1;
    `)
    writeFileSync(
      file,
      'date,description,amount,externalId\n2026-05-01,Coffee fixture,-0.10,opaque-id\n'
    )
    const before = state.db.serialize()
    const preview = await run()
    expect(publicPlan(preview)).toMatchInlineSnapshot(`
      {
        "account": {
          "currency": "USD",
          "id": " bank ",
        },
        "conflicts": [],
        "dataRevision": 37,
        "databaseId": "csv-parent-baseline",
        "mode": "preview",
        "previewToken": "sha256:86761d51262f0c9a3b77b6ba6c1d82960762fc2aceac3175f0f48fa7b3567789",
        "requiredDecisions": [],
        "rows": [
          {
            "contentFingerprint": "sha256:cb503c1e8aec0f515a9e1fcd73d4b61d37ae060bcb2bd074db67847ec18e9841",
            "existingTransactionId": "bank-duplicate",
            "externalId": "opaque-id",
            "identityKey": "sha256:f7b315d1188c1a2440c550c7f5178eba58607e936b0e8e18cee81f817290f6be",
            "importFingerprint": "{"version":1,"namespace":"shikin-statement-identity","strategy":"external_id","accountId":"bank","sourceNamespace":"csv-import","externalId":"opaque-id"}",
            "legacyEvidenceUnverified": true,
            "lineNumber": 2,
            "row": 2,
            "status": "idempotent",
          },
        ],
        "success": true,
        "summary": {
          "importedRows": 0,
          "skippedRows": 1,
          "totalRows": 1,
        },
      }
    `)
    expect(await run({ apply: true, previewToken: preview.previewToken })).toMatchObject({
      success: true,
      mode: 'reviewed_atomic',
      summary: { importedRows: 0, skippedRows: 1 },
    })
    expect(state.db.serialize()).toEqual(before)
  })
})
