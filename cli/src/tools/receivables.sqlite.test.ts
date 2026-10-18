// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from '../backend-foundation-test-schema.js'
import {
  assertReceivablePaymentsReady,
  RECEIVABLE_PAYMENTS_SCHEMA,
} from '@shikin/finance-core/receivable-payments-migration'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('../database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))
import { receivablesTools } from './receivables.js'

function call(name: string, input: Record<string, unknown>) {
  const tool = receivablesTools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
function state() {
  return holder.db
    .prepare(
      'SELECT amount, received_amount, unattributed_received_amount, status, matched_transaction_id FROM receivables WHERE id = ?'
    )
    .get('invoice')
}
function ledger() {
  return {
    accounts: holder.db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    transactions: holder.db.prepare('SELECT * FROM transactions ORDER BY id').all(),
  }
}
function seed(db: Database.Database) {
  db.exec(`
    INSERT INTO accounts (id,name,type,currency,balance) VALUES ('bank','Bank','checking','MXN',42000);
    INSERT INTO receivables (id,payer,amount,currency,due_date,status,account_id)
      VALUES ('invoice','Client',20000,'MXN','2026-10-20','open','bank'), ('other','Other client',20000,'MXN','2026-10-20','open','bank');
    INSERT INTO transactions (id,account_id,type,amount,currency,description,date,status,import_source,import_external_id)
      VALUES ('first','bank','income',8000,'MXN','First installment','2026-10-01','posted','bank-statement','bank-001'),
             ('last','bank','income',12000,'MXN','Final installment','2026-10-10','cleared','bank-statement','bank-002'),
             ('pending','bank','income',1000,'MXN','Not received','2026-10-12','pending',NULL,NULL);
  `)
}
beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  seed(holder.db)
})
afterEach(() => holder.db.close())

describe('receivable installments on isolated SQLite', () => {
  it('previews and applies two installments without changing bank activity; retries are no-ops', async () => {
    const original = ledger()
    const initial = state()
    expect(
      await call('match-receivable', { receivableId: 'invoice', transactionId: 'first' })
    ).toMatchObject({
      success: true,
      dryRun: true,
      wouldMatch: {
        receivable: {
          receivedAmountCentavos: 8000,
          remainingAmountCentavos: 12000,
          status: 'partial',
        },
      },
    })
    expect(state()).toEqual(initial)
    expect(
      holder.db.prepare('SELECT COUNT(*) AS count FROM receivable_payment_links').get()
    ).toEqual({ count: 0 })
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
    ).toMatchObject({ success: true, changed: true })
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'last',
        apply: true,
      })
    ).toMatchObject({
      success: true,
      receivable: {
        receivedAmountCentavos: 20000,
        status: 'received',
        activePaymentCount: 2,
        matchedTransactionId: null,
      },
    })
    const audits = holder.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'last',
        apply: true,
      })
    ).toMatchObject({ success: true, replayed: true, changed: false })
    expect(holder.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual(audits)
    expect(ledger()).toEqual(original)
    expect(
      await call('match-receivable', { receivableId: 'other', transactionId: 'last', apply: true })
    ).toMatchObject({ success: false, reason: 'transaction_already_matched' })
  })

  it('rejects pending payments and payments larger than the remaining balance', async () => {
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'pending',
        apply: true,
      })
    ).toMatchObject({ success: false, reason: 'transaction_not_posted' })
    holder.db.prepare('UPDATE receivables SET amount = 7000 WHERE id = ?').run('invoice')
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
    ).toMatchObject({ success: false, reason: 'payment_amount_mismatch' })
  })

  it('binds a reviewed MCP receipt to its evidence and keeps completed retries idempotent', async () => {
    const input = { receivableId: 'invoice', transactionId: 'first' }
    const oldPreview = (await call('match-receivable', input)) as { token: string }
    holder.db.exec("UPDATE transactions SET amount = 8100 WHERE id = 'first'")
    expect(
      await call('match-receivable', { ...input, apply: true, expectedToken: oldPreview.token })
    ).toMatchObject({ success: false, reason: 'stale_preview' })
    const preview = (await call('match-receivable', input)) as { token: string }
    expect(
      await call('match-receivable', { ...input, apply: true, expectedToken: preview.token })
    ).toMatchObject({ success: true, changed: true, receivable: { receivedAmountCentavos: 8100 } })
    const beforeRetry = holder.db.prepare('SELECT total_changes() AS changes').get()
    expect(
      await call('match-receivable', { ...input, apply: true, expectedToken: preview.token })
    ).toMatchObject({ success: true, changed: false, replayed: true })
    expect(holder.db.prepare('SELECT total_changes() AS changes').get()).toEqual(beforeRetry)
  })

  it('rejects a stale reversal-all preview when another payment has arrived', async () => {
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    const input = { receivableId: 'invoice', all: true }
    const preview = (await call('unmatch-receivable', input)) as { token: string }
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'last', apply: true })
    expect(
      await call('unmatch-receivable', { ...input, apply: true, expectedToken: preview.token })
    ).toMatchObject({ success: false, reason: 'stale_preview' })
    expect(state()).toMatchObject({ received_amount: 20000, status: 'received' })
  })

  it('requires explicit reversal selection and preserves immutable receipt evidence', async () => {
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'last', apply: true })
    expect(
      await call('unmatch-receivable', { receivableId: 'invoice', apply: true })
    ).toMatchObject({ success: false, reason: 'payment_selection_required' })
    const first = holder.db
      .prepare('SELECT * FROM receivable_payment_links WHERE transaction_id = ?')
      .get('first') as { id: string; transaction_snapshot_json: string }
    expect(
      await call('unmatch-receivable', {
        receivableId: 'invoice',
        paymentId: first.id,
        apply: true,
        note: 'Wrong invoice',
      })
    ).toMatchObject({
      success: true,
      receivable: {
        receivedAmountCentavos: 12000,
        status: 'partial',
        matchedTransactionId: 'last',
      },
    })
    expect(
      await call('unmatch-receivable', {
        receivableId: 'invoice',
        paymentId: first.id,
        apply: true,
      })
    ).toMatchObject({ success: true, replayed: true, changed: false })
    expect(
      holder.db
        .prepare('SELECT transaction_snapshot_json FROM receivable_payment_links WHERE id = ?')
        .get(first.id)
    ).toEqual({ transaction_snapshot_json: first.transaction_snapshot_json })
    expect(() =>
      holder.db.prepare('DELETE FROM receivable_payment_links WHERE id = ?').run(first.id)
    ).toThrow(/history cannot be deleted/)
    expect(() =>
      holder.db.prepare('UPDATE receivable_payment_links SET amount = 1 WHERE id = ?').run(first.id)
    ).toThrow(/immutable/)
    expect(
      await call('unmatch-receivable', { receivableId: 'invoice', all: true, apply: true })
    ).toMatchObject({ success: true, receivable: { receivedAmountCentavos: 0, status: 'open' } })
    expect(
      await call('manage-receivable', { action: 'delete', receivableId: 'invoice', apply: true })
    ).toMatchObject({ success: false, reason: 'receivable_has_receipts' })
  })

  it('protects all active sources after the compatibility mirror becomes null', async () => {
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'last', apply: true })
    for (const id of ['first', 'last']) {
      expect(() =>
        holder.db.prepare('UPDATE transactions SET amount = amount + 1 WHERE id = ?').run(id)
      ).toThrow(/Reverse receivable/)
      expect(() =>
        holder.db.prepare('UPDATE transactions SET date = ? WHERE id = ?').run('2026-10-16', id)
      ).toThrow(/Reverse receivable/)
      expect(() => holder.db.prepare('DELETE FROM transactions WHERE id = ?').run(id)).toThrow(
        /Reverse receivable/
      )
    }
    expect(() =>
      holder.db.exec("UPDATE receivables SET received_amount = 1 WHERE id = 'invoice'")
    ).toThrow(/totals must equal/)
  })

  it('protects receipt history and bank evidence from SQLite REPLACE with recursive triggers off', async () => {
    holder.db.pragma('recursive_triggers = OFF')
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    const replaceRow = (table: string, row: Record<string, unknown>) => {
      const columns = Object.keys(row)
      holder.db
        .prepare(
          `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
        )
        .run(...columns.map((column) => row[column]))
    }
    const payment = holder.db.prepare('SELECT * FROM receivable_payment_links').get() as Record<
      string,
      unknown
    >
    expect(() =>
      replaceRow('receivable_payment_links', { ...payment, note: 'Overwrite evidence' })
    ).toThrow(/identity already exists/)
    expect(() =>
      replaceRow('receivable_payment_links', { ...payment, id: 'different-id' })
    ).toThrow(/identity already exists/)
    const source = holder.db
      .prepare("SELECT * FROM transactions WHERE id = 'first'")
      .get() as Record<string, unknown>
    expect(() => replaceRow('transactions', { ...source, amount: 9000 })).toThrow(
      /Reverse receivable/
    )
    expect(holder.db.prepare('SELECT * FROM receivable_payment_links').get()).toEqual(payment)
    expect(holder.db.prepare("SELECT * FROM transactions WHERE id = 'first'").get()).toEqual(source)
  })

  it.each(['external', 'fingerprint', 'reconciliation'])(
    'protects linked evidence from INSERT/UPDATE OR REPLACE through the %s unique key',
    async (key) => {
      holder.db.pragma('recursive_triggers = OFF')
      holder.db.exec(`
        INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,
          stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount)
          VALUES ('reconciliation','bank','2026-10-01',42000,42000,42000,42000,0);
        UPDATE transactions SET import_fingerprint = 'unique-bank-fingerprint', reconciliation_id = 'reconciliation' WHERE id = 'first';
      `)
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'last',
        apply: true,
      })
      expect(state()).toMatchObject({ matched_transaction_id: null, received_amount: 20000 })
      const original = ledger()
      const source = holder.db
        .prepare("SELECT * FROM transactions WHERE id = 'first'")
        .get() as Record<string, unknown>
      const replacement: Record<string, unknown> = {
        ...source,
        id: 'replacement',
        amount: 7000,
        import_external_id: key === 'external' ? source.import_external_id : null,
        import_fingerprint: key === 'fingerprint' ? source.import_fingerprint : null,
        reconciliation_id: key === 'reconciliation' ? source.reconciliation_id : null,
      }
      const columns = Object.keys(replacement)
      expect(() =>
        holder.db
          .prepare(
            `INSERT OR REPLACE INTO transactions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
          )
          .run(...columns.map((column) => replacement[column]))
      ).toThrow(/Reverse receivable/)
      const update =
        key === 'external'
          ? { import_source: source.import_source, import_external_id: source.import_external_id }
          : key === 'fingerprint'
            ? { import_fingerprint: source.import_fingerprint }
            : { reconciliation_id: source.reconciliation_id }
      const keys = Object.keys(update)
      expect(() =>
        holder.db
          .prepare(
            `UPDATE OR REPLACE transactions SET ${keys.map((column) => `${column} = ?`).join(',')} WHERE id = 'pending'`
          )
          .run(...keys.map((column) => update[column as keyof typeof update]))
      ).toThrow(/Reverse receivable/)
      expect(ledger()).toEqual(original)
      expect(
        holder.db
          .prepare(
            'SELECT COUNT(*) AS count FROM receivable_payment_links WHERE reversed_at IS NULL'
          )
          .get()
      ).toEqual({ count: 2 })
    }
  )

  it('removes hidden receipt identities and validates the protective table definition', async () => {
    holder.db.pragma('recursive_triggers = OFF')
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    const payment = holder.db.prepare('SELECT * FROM receivable_payment_links').get() as Record<
      string,
      unknown
    >
    for (const alias of ['rowid', '_rowid_', 'oid']) {
      const replacement = {
        [alias]: 1,
        ...payment,
        id: 'replacement',
        receivable_id: 'other',
        transaction_id: 'last',
        amount: 12000,
        transaction_date: '2026-10-10',
      }
      const columns = Object.keys(replacement)
      expect(() =>
        holder.db
          .prepare(
            `INSERT OR REPLACE INTO receivable_payment_links (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
          )
          .run(...Object.values(replacement))
      ).toThrow(/has no column named/)
    }
    expect(holder.db.prepare('SELECT * FROM receivable_payment_links').get()).toEqual(payment)
    const columns = Object.fromEntries(
      Object.keys(RECEIVABLE_PAYMENTS_SCHEMA).map((table) => [
        table,
        (holder.db.pragma(`table_info(${table})`) as { name: string }[]).map(({ name }) => name),
      ])
    )
    const objects = holder.db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger')")
      .all() as { name: string; sql: string | null }[]
    expect(() => assertReceivablePaymentsReady(columns, objects)).not.toThrow()
    expect(() =>
      assertReceivablePaymentsReady(
        columns,
        objects.map((object) =>
          object.name === 'receivable_payment_links'
            ? { ...object, sql: object.sql!.replace(/WITHOUT ROWID/i, '') }
            : object
        )
      )
    ).toThrow(/incompatible 026 schema object: receivable_payment_links/)
    expect(
      await call('match-receivable', { receivableId: 'other', transactionId: 'last', apply: true })
    ).toMatchObject({ success: true, changed: true })
  })

  it.each([1, -1, -42])(
    'rejects hidden-rowid source replacement while preserving valid source rowid %s and ordinary inserts',
    async (sourceRowid) => {
      holder.db.pragma('recursive_triggers = OFF')
      holder.db.prepare("UPDATE transactions SET rowid = ? WHERE id = 'first'").run(sourceRowid)
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'last',
        apply: true,
      })
      expect(state()).toMatchObject({ matched_transaction_id: null, received_amount: 20000 })
      // Implicit rowids are undefined in BEFORE INSERT. Valid legacy negative
      // rowids must not make unrelated ordinary inserts or updates fail.
      holder.db.exec(`
        INSERT INTO transactions (id,account_id,type,amount,currency,description,date,status)
          VALUES ('ordinary','bank','income',2000,'MXN','Ordinary income','2026-10-11','posted');
        UPDATE transactions SET description = 'Updated ordinary description' WHERE id = 'ordinary';
      `)
      const original = ledger()
      const originalState = state()
      const originalRevision = holder.db.prepare('SELECT * FROM app_data_state').all()
      const originalPayments = holder.db
        .prepare('SELECT * FROM receivable_payment_links ORDER BY id')
        .all()
      const source = holder.db
        .prepare("SELECT rowid, * FROM transactions WHERE id = 'first'")
        .get() as Record<string, unknown>
      const replacement = {
        ...source,
        id: 'replacement',
        amount: 7000,
        import_external_id: null,
        import_fingerprint: null,
        reconciliation_id: null,
      }
      const columns = Object.keys(replacement)
      expect(() =>
        holder.db
          .prepare(
            `INSERT OR REPLACE INTO transactions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`
          )
          .run(...Object.values(replacement))
      ).toThrow(/Reverse receivable/)
      expect(() =>
        holder.db
          .prepare("UPDATE OR REPLACE transactions SET rowid = ? WHERE id = 'pending'")
          .run(sourceRowid)
      ).toThrow(/Reverse receivable/)
      expect(ledger()).toEqual(original)
      expect(state()).toEqual(originalState)
      expect(holder.db.prepare('SELECT * FROM app_data_state').all()).toEqual(originalRevision)
      expect(holder.db.prepare('SELECT * FROM receivable_payment_links ORDER BY id').all()).toEqual(
        originalPayments
      )
      expect(holder.db.prepare("SELECT rowid FROM transactions WHERE id = 'first'").get()).toEqual({
        rowid: sourceRowid,
      })
    }
  )

  it('rolls back link, aggregate and audit together on failure', async () => {
    const before = state()
    holder.db.exec(
      "CREATE TRIGGER fail_receipt_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'injected audit failure'); END"
    )
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
    ).toMatchObject({ success: false })
    expect(state()).toEqual(before)
    expect(
      holder.db.prepare('SELECT COUNT(*) AS count FROM receivable_payment_links').get()
    ).toEqual({ count: 0 })
    holder.db.exec('DROP TRIGGER fail_receipt_audit')
    expect(
      await call('match-receivable', {
        receivableId: 'invoice',
        transactionId: 'first',
        apply: true,
      })
    ).toMatchObject({ success: true })
  })

  it('exposes a read-only receipt history with redacted source snapshots', async () => {
    await call('match-receivable', { receivableId: 'invoice', transactionId: 'first', apply: true })
    const before = holder.db.prepare('SELECT total_changes() AS changes').get()
    expect(receivablesTools.find((tool) => tool.name === 'list-receivables')!.effects).toEqual({
      readOnly: true,
      writesTo: [],
    })
    const result = await call('list-receivables', {
      payer: 'Client',
      includePayments: true,
      redacted: true,
    })
    expect(result).toMatchObject({
      success: true,
      receivables: [{ activePaymentCount: 1, payments: [{ transactionSnapshot: '[REDACTED]' }] }],
    })
    expect(holder.db.prepare('SELECT total_changes() AS changes').get()).toEqual(before)
  })

  it('migrates legacy payment links and preserves an unattributed receipt baseline', () => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    try {
      runHostedTestMigrations(legacy, 25)
      seed(legacy)
      legacy.exec(
        "UPDATE receivables SET received_amount = 11000, status = 'partial', matched_transaction_id = 'first' WHERE id = 'invoice'"
      )
      runHostedTestMigrations(legacy)
      expect(
        legacy
          .prepare(
            'SELECT received_amount, unattributed_received_amount, matched_transaction_id FROM receivables WHERE id = ?'
          )
          .get('invoice')
      ).toEqual({
        received_amount: 11000,
        unattributed_received_amount: 3000,
        matched_transaction_id: 'first',
      })
      const migrated = legacy
        .prepare('SELECT amount, transaction_snapshot_json FROM receivable_payment_links')
        .get() as { amount: number; transaction_snapshot_json: string }
      expect(migrated.amount).toBe(8000)
      expect(JSON.parse(migrated.transaction_snapshot_json)).toMatchObject({
        provenance: 'legacy_link_migration',
        import_external_id: 'bank-001',
        amount: 8000,
      })
    } finally {
      legacy.close()
    }
  })

  it.each([
    "UPDATE transactions SET reporting_treatment = 'exclude_from_cashflow' WHERE id = 'first'",
    "UPDATE transactions SET ledger_treatment = 'staged_no_balance_impact' WHERE id = 'first'",
    "UPDATE transactions SET transaction_kind = 'reconciliation_bridge' WHERE id = 'first'",
    "UPDATE transactions SET status = 'pending' WHERE id = 'first'",
    "UPDATE transactions SET is_archived = 1 WHERE id = 'first'",
    "UPDATE receivables SET status = 'received' WHERE id = 'invoice'",
    "UPDATE receivables SET currency = 'USD' WHERE id = 'invoice'",
    "UPDATE transactions SET amount = 8100 WHERE id = 'first'",
  ])('rolls back migration 026 for invalid legacy evidence: %s', (invalidSql) => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    try {
      runHostedTestMigrations(legacy, 25)
      seed(legacy)
      legacy.exec(
        "UPDATE receivables SET received_amount = 8000, status = 'partial', matched_transaction_id = 'first' WHERE id = 'invoice'"
      )
      legacy.exec(invalidSql)
      const before = legacy.prepare('SELECT * FROM receivables ORDER BY id').all()
      expect(() => runHostedTestMigrations(legacy)).toThrow(/CHECK constraint failed/)
      expect(legacy.prepare('SELECT * FROM receivables ORDER BY id').all()).toEqual(before)
      expect(
        legacy
          .prepare("SELECT name FROM sqlite_master WHERE name = 'receivable_payment_links'")
          .all()
      ).toEqual([])
      expect(legacy.prepare('SELECT id FROM _migrations WHERE id = 26').all()).toEqual([])
    } finally {
      legacy.close()
    }
  })

  it('preserves a valid legacy cancelled receivable without reviving its expected income', () => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    try {
      runHostedTestMigrations(legacy, 25)
      seed(legacy)
      legacy.exec(
        "UPDATE receivables SET received_amount = 8000, status = 'cancelled', matched_transaction_id = 'first' WHERE id = 'invoice'"
      )
      runHostedTestMigrations(legacy)
      expect(
        legacy.prepare("SELECT received_amount, status FROM receivables WHERE id = 'invoice'").get()
      ).toEqual({ received_amount: 8000, status: 'cancelled' })
      expect(legacy.prepare('SELECT amount FROM receivable_payment_links').get()).toEqual({
        amount: 8000,
      })
    } finally {
      legacy.close()
    }
  })

  it('preserves a valid legacy receipt after its bank account was archived, including negative source rowids', () => {
    const legacy = new Database(':memory:')
    legacy.pragma('foreign_keys = ON')
    try {
      runHostedTestMigrations(legacy, 25)
      seed(legacy)
      legacy.exec(
        "UPDATE receivables SET received_amount = 8000, status = 'partial', matched_transaction_id = 'first' WHERE id = 'invoice'"
      )
      legacy.exec("UPDATE accounts SET is_archived = 1 WHERE id = 'bank'")
      legacy.exec("UPDATE transactions SET rowid = -1 WHERE id = 'first'")
      runHostedTestMigrations(legacy)
      expect(
        legacy
          .prepare(
            "SELECT received_amount, status, matched_transaction_id FROM receivables WHERE id = 'invoice'"
          )
          .get()
      ).toEqual({ received_amount: 8000, status: 'partial', matched_transaction_id: 'first' })
      expect(legacy.prepare('SELECT amount FROM receivable_payment_links').get()).toEqual({
        amount: 8000,
      })
      expect(legacy.prepare("SELECT rowid FROM transactions WHERE id = 'first'").get()).toEqual({
        rowid: -1,
      })
    } finally {
      legacy.close()
    }
  })
})
