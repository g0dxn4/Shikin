// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../../cli/src/backend-foundation-test-schema'
import type { TransactionClient } from '@/lib/database'

const holder = vi.hoisted(() => ({
  db: null as unknown as Database.Database,
  failAudit: false,
  id: 0,
  refresh: vi.fn(async () => {}),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/database', () => {
  const query = async <Row>(sql: string, values: unknown[] = []) =>
    holder.db.prepare(sql).all(...values) as Row[]
  const execute = async (sql: string, values: unknown[] = []) => {
    if (holder.failAudit && sql.includes('INSERT INTO audit_log')) throw new Error('audit failed')
    const result = holder.db.prepare(sql).run(...values)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  }
  return {
    query,
    withTransaction: async <T>(fn: (tx: TransactionClient) => Promise<T>) => {
      holder.db.exec('BEGIN IMMEDIATE')
      try {
        const value = await fn({ query, execute })
        holder.db.exec('COMMIT')
        return value
      } catch (error) {
        holder.db.exec('ROLLBACK')
        throw error
      }
    },
  }
})
vi.mock('@/lib/ulid', () => ({ generateId: () => `identity-audit-${++holder.id}` }))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: holder.refresh }) },
}))
vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: holder.invalidate,
}))

import {
  bindLegacyImportIdentity,
  previewLegacyImportIdentity,
  readLegacyImportIdentityTransaction,
} from './import-identity-service'

function addTransaction(id: string, overrides: Record<string, unknown> = {}) {
  const row = {
    account_id: 'account',
    category_id: null,
    subcategory_id: null,
    type: 'expense',
    amount: 1234,
    currency: 'USD',
    description: 'Possibly edited description',
    notes: 'preserve notes',
    date: '2025-01-02',
    tags: '["legacy"]',
    status: 'posted',
    source: 'original-ledger-source',
    note: 'original-ledger-note',
    ledger_treatment: 'staged_no_balance_impact',
    reporting_treatment: 'normal',
    transaction_kind: 'standard',
    staging_batch_id: 'legacy-batch',
    import_source: null,
    import_external_id: null,
    import_fingerprint: null,
    import_content_fingerprint: null,
    is_archived: 0,
    ...overrides,
  }
  holder.db
    .prepare(
      `INSERT INTO transactions (
         id, account_id, category_id, subcategory_id, type, amount, currency, description,
         notes, date, tags, status, source, note, ledger_treatment, reporting_treatment,
         transaction_kind, staging_batch_id, import_source, import_external_id,
         import_fingerprint, import_content_fingerprint, is_archived
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, ...Object.values(row))
}

function row(id: string) {
  return holder.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<
    string,
    unknown
  >
}

function databaseSnapshot() {
  const tables = holder.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      holder.db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
    ])
  )
}

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, balance, account_mode, valuation_mode)
       VALUES ('account', 'Legacy USD', 'checking', 'USD', 0, 'transactional', 'cash_plus_holdings')`
    )
    .run()
  holder.failAudit = false
  holder.id = 0
  holder.refresh.mockClear()
  holder.invalidate.mockClear()
})
afterEach(() => holder.db.close())

describe('legacy import identity service on real schema 021 SQLite', () => {
  it('previews then atomically binds exact case-sensitive identity while preserving the full ledger record', async () => {
    addTransaction('legacy')
    const before = row('legacy')
    const allTablesBeforePreview = databaseSnapshot()
    const input = {
      transactionId: 'legacy',
      sourceNamespace: '  Bank Feed  ',
      externalId: '000AbC',
      source: 'manual-verification',
      note: 'Matched against printed bank ID',
    }

    const preview = await previewLegacyImportIdentity(input)
    expect(databaseSnapshot()).toEqual(allTablesBeforePreview)
    expect(row('legacy')).toEqual(before)
    expect(preview).toMatchObject({
      transaction: before,
      binding: {
        transactionId: 'legacy',
        importSource: 'Bank Feed',
        importExternalId: '000AbC',
        importContentFingerprint: null,
        originalContentVerified: false,
      },
    })
    expect(preview.limitation).toMatch(/unknown/i)
    expect(holder.invalidate).not.toHaveBeenCalled()

    const result = await bindLegacyImportIdentity({ ...input, previewToken: preview.previewToken })
    const after = row('legacy')
    for (const [column, value] of Object.entries(before)) {
      if (
        ['import_source', 'import_external_id', 'import_fingerprint', 'updated_at'].includes(column)
      )
        continue
      expect(after[column], column).toEqual(value)
    }
    expect(after).toMatchObject({
      import_source: 'Bank Feed',
      import_external_id: '000AbC',
      import_fingerprint: preview.binding.importFingerprint,
      import_content_fingerprint: null,
    })
    expect(result.refreshIncomplete).toBe(false)
    expect(holder.invalidate).toHaveBeenCalledWith('import')
    expect(holder.refresh).toHaveBeenCalledTimes(1)
    const audit = holder.db
      .prepare("SELECT * FROM audit_log WHERE action = 'bind-import-identity'")
      .get() as Record<string, unknown>
    expect(audit).toMatchObject({
      entity: 'transaction',
      entity_id: 'legacy',
      source: 'manual-verification',
      note: 'Matched against printed bank ID',
    })
    expect(JSON.parse(String(audit.after_json))).toMatchObject({
      importExternalId: '000AbC',
      importContentFingerprint: null,
      originalContentVerified: false,
    })
  })

  it('keeps source namespace and opaque external ID case/zeros distinct', async () => {
    addTransaction('first')
    addTransaction('second')
    addTransaction('third')
    const first = await previewLegacyImportIdentity({
      transactionId: 'first',
      sourceNamespace: 'Bank',
      externalId: '001AbC',
    })
    await bindLegacyImportIdentity({
      transactionId: 'first',
      sourceNamespace: 'Bank',
      externalId: '001AbC',
      previewToken: first.previewToken,
    })
    const second = await previewLegacyImportIdentity({
      transactionId: 'second',
      sourceNamespace: 'bank',
      externalId: '001AbC',
    })
    await bindLegacyImportIdentity({
      transactionId: 'second',
      sourceNamespace: 'bank',
      externalId: '001AbC',
      previewToken: second.previewToken,
    })
    const third = await previewLegacyImportIdentity({
      transactionId: 'third',
      sourceNamespace: 'Bank',
      externalId: '01AbC',
    })
    expect(
      new Set([
        first.binding.importFingerprint,
        second.binding.importFingerprint,
        third.binding.importFingerprint,
      ]).size
    ).toBe(3)
  })

  it('rejects collisions, protected rows, and existing different identities', async () => {
    addTransaction('bound', { import_source: 'Bank', import_external_id: '007' })
    addTransaction('candidate')
    await expect(
      previewLegacyImportIdentity({
        transactionId: 'candidate',
        sourceNamespace: 'Bank',
        externalId: '007',
      })
    ).rejects.toThrow('already bound')
    holder.db.prepare("UPDATE transactions SET is_archived = 1 WHERE id = 'candidate'").run()
    await expect(
      previewLegacyImportIdentity({
        transactionId: 'candidate',
        sourceNamespace: 'Other',
        externalId: 'x',
      })
    ).rejects.toThrow('active standard')
    expect(await readLegacyImportIdentityTransaction('bound')).toMatchObject({ id: 'bound' })
  })

  it('rejects stale preview tokens with zero writes', async () => {
    addTransaction('legacy')
    const input = { transactionId: 'legacy', sourceNamespace: 'Bank', externalId: '0001' }
    const preview = await previewLegacyImportIdentity(input)
    holder.db
      .prepare("UPDATE transactions SET description = 'new evidence' WHERE id = 'legacy'")
      .run()
    const beforeApply = row('legacy')
    await expect(
      bindLegacyImportIdentity({ ...input, previewToken: preview.previewToken })
    ).rejects.toThrow('preview token')
    expect(row('legacy')).toEqual(beforeApply)
    expect(
      holder.db
        .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'bind-import-identity'")
        .get()
    ).toEqual({ count: 0 })
    expect(holder.invalidate).not.toHaveBeenCalled()
    expect(holder.refresh).not.toHaveBeenCalled()
  })

  it('rolls back identity, audit, and revision when audit persistence fails', async () => {
    addTransaction('legacy')
    const input = { transactionId: 'legacy', sourceNamespace: 'Bank', externalId: 'A-1' }
    const preview = await previewLegacyImportIdentity(input)
    const before = row('legacy')
    const stateBefore = holder.db.prepare('SELECT * FROM app_data_state').get()
    holder.failAudit = true
    await expect(
      bindLegacyImportIdentity({ ...input, previewToken: preview.previewToken })
    ).rejects.toThrow('audit failed')
    expect(row('legacy')).toEqual(before)
    expect(holder.db.prepare('SELECT * FROM app_data_state').get()).toEqual(stateBefore)
    expect(holder.invalidate).not.toHaveBeenCalled()
    expect(holder.refresh).not.toHaveBeenCalled()
  })

  it('emits import page invalidation after commit while store refresh is still pending', async () => {
    addTransaction('legacy')
    const input = { transactionId: 'legacy', sourceNamespace: 'Bank', externalId: '0001' }
    const preview = await previewLegacyImportIdentity(input)
    expect(holder.invalidate).not.toHaveBeenCalled()

    let release!: () => void
    holder.refresh.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )

    let finished = false
    const pending = bindLegacyImportIdentity({
      ...input,
      previewToken: preview.previewToken,
    }).then((result) => {
      finished = true
      return result
    })

    await vi.waitFor(() => expect(holder.invalidate).toHaveBeenCalledWith('import'))
    expect(holder.refresh).toHaveBeenCalledTimes(1)
    expect(finished).toBe(false)
    expect(row('legacy')).toMatchObject({ import_source: 'Bank', import_external_id: '0001' })

    release()
    await expect(pending).resolves.toMatchObject({ refreshIncomplete: false })
    expect(finished).toBe(true)
  })
})
