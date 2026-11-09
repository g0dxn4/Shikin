// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'
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
vi.mock('@/lib/database', () => ({
  withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    const query = async (sql: string, params: unknown[] = []) =>
      state.db.prepare(sql).all(...params)
    const execute = async (sql: string, params: unknown[] = []) => {
      const result = state.db.prepare(sql).run(...params)
      return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
    }
    state.db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn({ query, execute })
      state.db.exec('COMMIT')
      return result
    } catch (error) {
      state.db.exec('ROLLBACK')
      throw error
    }
  },
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: vi.fn() }) },
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: vi.fn() }) },
}))

import { executeAtomicImport, type AtomicImportRequest } from './import-transactions.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import { previewStatementFile } from '@/lib/statement-import'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import { importStatementFile } from '@/lib/statement-import-actions'

type Client = 'cli' | 'statement'
type SourceRow = { date: string; amount: number; description: string; externalId: string | null }
type Preview = {
  success: boolean
  previewToken: string | null
  requiredDecisions: ImportReviewDecision[]
}
const incoming: SourceRow = {
  date: '2026-07-13',
  amount: 10,
  description: 'Incoming row',
  externalId: 'incoming-id',
}

function statement(rows: SourceRow[]): File {
  const content = rows
    .map(
      (row) =>
        `<STMTTRN><DTPOSTED>${row.date.replaceAll('-', '')}<TRNAMT>-${row.amount.toFixed(2)}${
          row.externalId === null ? '' : `<FITID>${row.externalId}`
        }<NAME>${row.description}</STMTTRN>`
    )
    .join('\n')
  return new File([`<OFX><STMTRS><CURDEF>USD\n${content}\n</STMTRS></OFX>`], 'statement.ofx')
}

function request(rows: SourceRow[]): AtomicImportRequest {
  return {
    rawContent: JSON.stringify(rows),
    options: {
      accountId: 'account-1',
      accountCurrency: 'USD',
      sourceNamespace: 'statement:ofx',
      ledgerTreatment: 'normal',
      reportingTreatment: 'normal',
    },
    rows: rows.map((row, index) => ({
      row: index + 2,
      lineNumber: index + 2,
      externalId: row.externalId,
      input: {
        accountId: 'account-1',
        amountCentavos: Math.round(row.amount * 100),
        type: 'expense',
        description: row.description,
        date: row.date,
        source: 'parity-test',
      },
    })),
    apply: false,
  }
}

async function preview(
  client: Client,
  decisions: ImportReviewDecision[] = [],
  rows = [incoming]
): Promise<Preview> {
  return client === 'cli'
    ? (executeAtomicImport({ ...request(rows), decisions }) as Preview)
    : previewStatementFile(statement(rows), 'account-1', decisions)
}

async function apply(
  client: Client,
  decisions: ImportReviewDecision[] = [],
  previewToken?: string,
  rows = [incoming]
): Promise<void> {
  if (client === 'cli') {
    expect(
      executeAtomicImport({ ...request(rows), decisions, previewToken, apply: true })
    ).toMatchObject({ success: true })
  } else {
    const result = await importStatementFile(statement(rows), 'account-1', {
      decisions,
      previewToken,
    })
    expect(result.refreshIncomplete).toBe(false)
    if (result.errors.length) throw new Error(result.errors.join('\n'))
  }
}

function insertExisting(id = 'existing-1'): void {
  state.db
    .prepare(
      `INSERT INTO transactions (
         id, account_id, type, amount, currency, description, date, created_at, updated_at
       ) VALUES (?, 'account-1', 'expense', 1000, 'USD', 'Existing row', '2026-07-13',
                 '2026-07-13T12:00:00.000Z', '2026-07-13T12:00:00.000Z')`
    )
    .run(id)
}

function snapshot() {
  const tables = state.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      state.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ])
  )
}

beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance, is_archived, account_mode)
      VALUES ('account-1', 'Checking', 'checking', 'USD', 10000, 0, 'transactional');
    UPDATE app_data_state SET data_revision = 0 WHERE id = 1;
  `)
})
afterEach(() => state.db.close())

const evidenceVectors = [
  {
    label: 'null provenance',
    source: null,
    externalId: null,
    identity: null,
    content: null,
    updatedAt: '2026-07-13T12:00:00.000Z',
    expected: 'sha256:746d0043f0e5b42b9205b11a099f4030b78d0b510a2300029d17b116a0b70d7c',
  },
  {
    label: 'blank provenance',
    source: '',
    externalId: '',
    identity: '',
    content: '',
    updatedAt: '',
    expected: 'sha256:689c569c2c0624d5afaab3c034f519784784d54cedbe71e730c04eb161d37abf',
  },
  {
    label: 'whitespace provenance',
    source: ' \t',
    externalId: ' \t',
    identity: ' \t',
    content: ' \t',
    updatedAt: ' \t',
    expected: 'sha256:8cf0242550f5863d1908e05cb4638184660c6f65fb889ad417696b7d03318292',
  },
  {
    label: 'opaque provenance',
    source: ' Other Source ',
    externalId: ' 001-AbC ',
    identity: 'opaque:Identity/Ω',
    content: 'sha256:ContentCase',
    updatedAt: '2026-07-13T12:00:00.000Z',
    expected: 'sha256:91a9b126ad314182cd952cf92c41d670ae099d6c03107512a94a251b029ef9ee',
  },
  {
    label: 'updated evidence',
    source: ' Other Source ',
    externalId: ' 001-AbC ',
    identity: 'opaque:Identity/Ω',
    content: 'sha256:ContentCase',
    updatedAt: '2026-07-13T12:00:01.000Z',
    expected: 'sha256:4d7d5cc498489bb4c077c173e82b3d4debaef83d512bafeca20cc8e85c921c9e',
  },
]

describe('persisted import review CLI/statement contract', () => {
  it.each(evidenceVectors)('pins existing evidence bytes for $label', async (vector) => {
    insertExisting()
    state.db
      .prepare(
        `UPDATE transactions SET import_source=?, import_external_id=?, import_fingerprint=?,
           import_content_fingerprint=?, updated_at=? WHERE id='existing-1'`
      )
      .run(vector.source, vector.externalId, vector.identity, vector.content, vector.updatedAt)
    const before = snapshot()
    for (const client of ['cli', 'statement'] as const) {
      const result = await preview(client)
      expect(result.success).toBe(false)
      expect(result.requiredDecisions).toEqual([
        expect.objectContaining({
          existingTransactionId: 'existing-1',
          existingEvidenceFingerprint: vector.expected,
        }),
      ])
    }
    expect(snapshot()).toEqual(before)
  })

  it.each([
    { source: ' statement:ofx ', externalId: 'other-id', required: false },
    { source: ' statement:ofx ', externalId: 'incoming-id ', required: false },
    { source: ' statement:ofx ', externalId: 'incoming-id', required: true },
    { source: ' statement:ofx ', externalId: '', required: true },
    { source: ' statement:ofx ', externalId: ' \t', required: true },
    { source: 'statement:OFX', externalId: 'other-id', required: true },
    { source: ' \t', externalId: 'other-id', required: true },
    { source: null, externalId: null, required: true },
  ])('preserves opaque-ID/source review for $source/$externalId', async (row) => {
    insertExisting()
    state.db
      .prepare(
        "UPDATE transactions SET import_source=?, import_external_id=? WHERE id='existing-1'"
      )
      .run(row.source, row.externalId)
    for (const client of ['cli', 'statement'] as const) {
      const result = await preview(client)
      expect(result.success).toBe(!row.required)
      expect(result.requiredDecisions).toHaveLength(row.required ? 1 : 0)
    }
  })

  for (const creator of ['cli', 'statement'] as const) {
    const consumer = creator === 'cli' ? 'statement' : 'cli'
    it.each(['existing-1', 'existing-2'])(
      `accepts ${creator}-persisted candidate decisions in ${consumer}, keeping %s`,
      async (keptId) => {
        insertExisting()
        insertExisting('existing-2')
        const fromCreator = await preview(creator)
        const fromConsumer = await preview(consumer)
        const decisions = fromCreator.requiredDecisions.map((decision) => ({
          candidateIdentityKey: decision.candidateIdentityKey,
          candidateContentFingerprint: decision.candidateContentFingerprint,
          existingTransactionId: decision.existingTransactionId,
          existingEvidenceFingerprint: decision.existingEvidenceFingerprint,
          decision:
            decision.existingTransactionId === keptId
              ? ('keep_existing' as const)
              : ('distinct' as const),
        }))
        expect(fromCreator.requiredDecisions).toHaveLength(2)
        expect(fromConsumer.requiredDecisions).toEqual(
          decisions.map((decision) =>
            expect.objectContaining({
              candidateIdentityKey: decision.candidateIdentityKey,
              candidateContentFingerprint: decision.candidateContentFingerprint,
              existingTransactionId: decision.existingTransactionId,
              existingEvidenceFingerprint: decision.existingEvidenceFingerprint,
            })
          )
        )
        const reviewed = await preview(creator, decisions)
        expect(reviewed.success).toBe(true)
        await apply(creator, decisions, reviewed.previewToken!)
        expect(
          state.db
            .prepare(
              'SELECT decision, source FROM duplicate_review_decisions ORDER BY existing_transaction_id'
            )
            .all()
        ).toEqual(
          [...decisions]
            .sort((a, b) => a.existingTransactionId.localeCompare(b.existingTransactionId))
            .map(({ decision }) => ({
              decision,
              source: creator === 'cli' ? 'csv-import' : 'statement-import',
            }))
        )
        const before = snapshot()
        const persisted = await preview(consumer)
        expect(persisted).toMatchObject({ success: true, requiredDecisions: [] })
        await apply(consumer, [], persisted.previewToken!)
        expect(snapshot()).toEqual(before)
        expect(state.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({
          count: 2,
        })
        expect(state.db.prepare("SELECT balance FROM accounts WHERE id='account-1'").get()).toEqual(
          { balance: 10000 }
        )
      }
    )

    it.each([
      'candidateIdentityKey',
      'candidateContentFingerprint',
      'existingTransactionId',
      'existingEvidenceFingerprint',
    ] as const)(`${creator} rejects stale or unused %s decisions without writes`, async (field) => {
      insertExisting()
      const required = (await preview(consumer)).requiredDecisions[0]
      const decisions: ImportReviewDecision[] = [
        { ...required, [field]: 'stale', decision: 'keep_existing' },
      ]
      const before = snapshot()
      await expect(apply(creator, decisions)).rejects.toThrow(
        creator === 'cli' ? 'unresolved conflicts or duplicate decisions' : 'stale or do not belong'
      )
      expect(snapshot()).toEqual(before)
    })

    it(`${creator} invalidates persisted evidence after updatedAt changes`, async () => {
      insertExisting()
      const required = (await preview(consumer)).requiredDecisions[0]
      const decisions: ImportReviewDecision[] = [{ ...required, decision: 'keep_existing' }]
      await apply(consumer, decisions, (await preview(consumer, decisions)).previewToken!)
      state.db
        .prepare(
          "UPDATE transactions SET updated_at='2026-07-14T00:00:00.000Z' WHERE id='existing-1'"
        )
        .run()
      const before = snapshot()
      const stale = await preview(creator)
      expect(stale.success).toBe(false)
      expect(stale.requiredDecisions).toHaveLength(1)
      expect(stale.requiredDecisions[0].existingEvidenceFingerprint).not.toBe(
        required.existingEvidenceFingerprint
      )
      await expect(apply(creator, decisions)).rejects.toThrow()
      expect(snapshot()).toEqual(before)
    })

    it(`${creator} rolls back transactions, decisions, audits, balance and revision on audit failure`, async () => {
      insertExisting()
      const rows = [
        { ...incoming, date: '2026-07-10', amount: 7, externalId: 'earlier-id' },
        incoming,
      ]
      const required = (await preview(consumer, [], rows)).requiredDecisions[0]
      const decisions: ImportReviewDecision[] = [{ ...required, decision: 'keep_existing' }]
      const reviewed = await preview(creator, decisions, rows)
      expect(reviewed.success).toBe(true)
      state.db.exec(`
        CREATE TRIGGER fail_review_audit BEFORE INSERT ON audit_log
        WHEN NEW.entity = 'duplicate_review_decision'
        BEGIN SELECT RAISE(ABORT, 'synthetic review audit failure'); END;
      `)
      const before = snapshot()
      await expect(apply(creator, decisions, reviewed.previewToken!, rows)).rejects.toThrow(
        'synthetic review audit failure'
      )
      expect(snapshot()).toEqual(before)
    })
  }

  it('preserves B-06: CLI trims legacy currency while statements report changed content', async () => {
    insertExisting()
    state.db
      .prepare(
        `UPDATE transactions SET import_source='statement:ofx', import_external_id='incoming-id',
         currency=' USD ' WHERE id='existing-1'`
      )
      .run()
    const before = snapshot()
    expect(await preview('cli')).toMatchObject({
      success: true,
      summary: { importedRows: 0, skippedRows: 1 },
      rows: [expect.objectContaining({ status: 'idempotent', legacyEvidenceUnverified: true })],
    })
    expect(await preview('statement')).toMatchObject({
      success: false,
      errors: ['Source identity for row 1 has changed financial content'],
    })
    expect(snapshot()).toEqual(before)
  })
})
