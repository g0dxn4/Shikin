// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { TransactionClient } from '@/lib/database'
import { runHostedTestMigrations } from '../../../cli/src/backend-foundation-test-schema.js'

const databaseState = vi.hoisted(() => ({ db: null as Database.Database | null }))

vi.mock('@/lib/database', () => ({
  withTransaction: async <T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> => {
    const db = databaseState.db!
    const tx: TransactionClient = {
      query: async <Row>(sql: string, values: unknown[] = []) =>
        db.prepare(sql).all(...values) as Row[],
      execute: async (sql: string, values: unknown[] = []) => {
        const result = db.prepare(sql).run(...values)
        return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
      },
    }
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = await fn(tx)
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  },
}))

import {
  createCardStatement,
  deleteCardStatement,
  linkCardPayment,
  listCardPaymentLinks,
  listCardStatements,
  previewCreateCardStatement,
  previewDeleteCardStatement,
  previewLinkCardPayment,
  previewRecordCardPayment,
  previewUnlinkCardPayment,
  previewUpdateCardStatement,
  recordCardPayment,
  unlinkCardPayment,
  updateCardStatement,
} from '../card-payment-service'

let db: Database.Database

function count(table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

function allTableSnapshot(): Record<string, unknown[]> {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as Array<{ name: string }>
  return Object.fromEntries(
    tables.map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])
  )
}

async function createStatement(paidAmount = 0, balance = 1000, second = false) {
  const draft = {
    statementEndDate: second ? '2026-02-28' : '2026-01-31',
    dueDate: second ? '2026-03-15' : '2026-02-15',
    statementBalance: balance,
    minimumPayment: 100,
    paidAmount,
    source: 'test',
    note: 'synthetic statement',
  }
  const preview = await previewCreateCardStatement('card', draft)
  return createCardStatement('card', draft, preview.token)
}

function insertPayment(id = 'existing-payment', reporting = 'exclude_from_cashflow') {
  db.prepare(
    `INSERT INTO transactions
       (id, account_id, type, amount, currency, description, date, status, ledger_treatment,
        reporting_treatment, transaction_kind, is_archived)
     VALUES (?, 'bank', 'expense', 1000, 'USD', 'Confirmed card repayment', '2026-02-01',
             'posted', 'normal', ?, 'standard', 0)`
  ).run(id, reporting)
}

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  databaseState.db = db
  runHostedTestMigrations(db)
  db.exec(`
    INSERT INTO accounts (id, name, type, currency, balance, account_mode, is_archived)
    VALUES ('bank', 'Synthetic checking', 'checking', 'USD', 5000, 'transactional', 0),
           ('card', 'Synthetic card', 'credit_card', 'USD', -1500, 'transactional', 0),
           ('eur', 'Euro checking', 'checking', 'EUR', 5000, 'transactional', 0);
  `)
})

afterEach(() => {
  databaseState.db = null
  db.close()
})

describe('browser/Tauri card payment service on real SQLite 021', () => {
  it('creates, explicitly edits and deletes statement-only accounting without fake transactions', async () => {
    const statement = await createStatement(200)
    expect(statement).toMatchObject({ paidAmount: 200, unattributedPaidAmount: 200 })

    const updatePreview = await previewUpdateCardStatement(statement.id, { paidAmount: 350 })
    const updated = await updateCardStatement(
      statement.id,
      { paidAmount: 350 },
      updatePreview.token
    )
    expect(updated).toMatchObject({ paidAmount: 350, unattributedPaidAmount: 350 })

    const baselinePreview = await previewRecordCardPayment({
      cardAccountId: 'card',
      statementId: statement.id,
      amount: 150,
      statementOnly: true,
      source: 'operator',
      note: 'paper receipt',
    })
    await recordCardPayment(
      {
        cardAccountId: 'card',
        statementId: statement.id,
        amount: 150,
        statementOnly: true,
        source: 'operator',
        note: 'paper receipt',
      },
      baselinePreview.token
    )
    expect(count('transactions')).toBe(0)
    expect(count('card_statement_payment_links')).toBe(0)
    expect((await listCardStatements('card'))[0]).toMatchObject({
      paidAmount: 500,
      unattributedPaidAmount: 500,
    })

    const deletePreview = await previewDeleteCardStatement(
      statement.id,
      'operator',
      'duplicate statement'
    )
    await deleteCardStatement(statement.id, deletePreview.token, 'operator', 'duplicate statement')
    expect(await listCardStatements('card')).toEqual([])
  })

  it('links report-excluded ordinary evidence, preserves money tables, unlinks, and retains immutable history after deletion', async () => {
    const statement = await createStatement()
    insertPayment()
    const moneyBefore = {
      accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all(),
      transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
    }
    const input = {
      statementId: statement.id,
      transactionId: 'existing-payment',
      amount: 400,
      mode: 'apply_to_unpaid' as const,
      explicitRepaymentConfirmation: true,
      source: 'operator',
      note: 'bank receipt',
    }
    const preview = await previewLinkCardPayment(input)
    const linked = await linkCardPayment(input, preview.token)
    expect(linked).toMatchObject({ paidAmount: 400, linkedPaidAmount: 400 })
    expect({
      accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all(),
      transactions: db.prepare('SELECT * FROM transactions ORDER BY id').all(),
    }).toEqual(moneyBefore)

    const link = (await listCardPaymentLinks(statement.id, 'active'))[0]
    const unlinkPreview = await previewUnlinkCardPayment(link.id, 'operator', 'wrong cycle')
    await unlinkCardPayment(link.id, unlinkPreview.token, 'operator', 'wrong cycle')
    expect((await listCardPaymentLinks(statement.id, 'voided'))[0]).toMatchObject({
      originalStatementId: statement.id,
      originalTransactionId: 'existing-payment',
    })

    const deletePreview = await previewDeleteCardStatement(
      statement.id,
      'operator',
      'remove statement'
    )
    await deleteCardStatement(statement.id, deletePreview.token, 'operator', 'remove statement')
    db.prepare("DELETE FROM transactions WHERE id = 'existing-payment'").run()
    expect(db.prepare('SELECT * FROM card_statement_payment_links').get()).toMatchObject({
      original_statement_id: statement.id,
      original_transaction_id: 'existing-payment',
      statement_id: null,
      transaction_id: null,
    })
  })

  it('keeps explicit attribution total stable and rejects unsafe paid/balance edits', async () => {
    const statement = await createStatement(600)
    db.prepare(
      `INSERT INTO transactions
       (id, account_id, transfer_to_account_id, type, amount, currency, description, date, status,
        ledger_treatment, reporting_treatment, transaction_kind, is_archived)
       VALUES ('transfer', 'bank', 'card', 'transfer', 1000, 'USD', 'Transfer', '2026-02-01',
               'posted', 'normal', 'normal', 'standard', 0)`
    ).run()
    const input = {
      statementId: statement.id,
      transactionId: 'transfer',
      amount: 400,
      mode: 'attribute_existing' as const,
      explicitRepaymentConfirmation: false,
      source: 'operator',
      note: 'attribute receipt',
    }
    const preview = await previewLinkCardPayment(input)
    expect(await linkCardPayment(input, preview.token)).toMatchObject({
      paidAmount: 600,
      unattributedPaidAmount: 200,
      linkedPaidAmount: 400,
    })
    await expect(previewUpdateCardStatement(statement.id, { paidAmount: 300 })).rejects.toThrow(
      /lower than active linked/i
    )
    await expect(
      previewUpdateCardStatement(statement.id, { statementBalance: 300 })
    ).rejects.toThrow(/lower than active linked/i)
    await expect(
      previewDeleteCardStatement(statement.id, 'operator', 'remove statement')
    ).rejects.toThrow(/Unlink active/)
  })

  it('enforces canonical capacity across statements and rejects pending evidence', async () => {
    const first = await createStatement()
    const second = await createStatement(0, 1000, true)
    db.exec(`
      INSERT INTO transactions
        (id, account_id, transfer_to_account_id, type, amount, currency, description, date, status,
         ledger_treatment, reporting_treatment, transaction_kind, is_archived)
      VALUES ('shared-transfer', 'bank', 'card', 'transfer', 1000, 'USD', 'Shared transfer',
              '2026-02-01', 'posted', 'normal', 'normal', 'standard', 0),
             ('pending-transfer', 'bank', 'card', 'transfer', 1000, 'USD', 'Pending transfer',
              '2026-02-02', 'pending', 'normal', 'normal', 'standard', 0);
    `)
    const firstInput = {
      statementId: first.id,
      transactionId: 'shared-transfer',
      amount: 600,
      mode: 'apply_to_unpaid' as const,
      explicitRepaymentConfirmation: false,
      source: 'operator',
      note: 'first allocation',
    }
    const firstPreview = await previewLinkCardPayment(firstInput)
    await linkCardPayment(firstInput, firstPreview.token)
    await expect(
      previewLinkCardPayment({ ...firstInput, statementId: second.id, amount: 401 })
    ).rejects.toThrow(/capacity/i)
    await expect(
      previewLinkCardPayment({
        ...firstInput,
        statementId: second.id,
        transactionId: 'pending-transfer',
      })
    ).rejects.toThrow(/eligible posted/i)
  })

  it('preserves and diagnoses legacy overpayment without allowing it to grow', async () => {
    const statement = await createStatement()
    db.prepare(
      'UPDATE credit_card_statements SET paid_amount = 1200, unattributed_paid_amount = 1200 WHERE id = ?'
    ).run(statement.id)
    expect((await listCardStatements('card'))[0]).toMatchObject({
      paidAmount: 1200,
      legacyOverpaid: true,
    })
    const harmless = await previewUpdateCardStatement(statement.id, { note: 'retain history' })
    await updateCardStatement(statement.id, { note: 'retain history' }, harmless.token)
    await expect(previewUpdateCardStatement(statement.id, { paidAmount: 1300 })).rejects.toThrow(
      /overpayment/i
    )
  })

  it('creates a real transfer and optional evidence link atomically, including rollback on link failure', async () => {
    const statement = await createStatement()
    const input = {
      cardAccountId: 'card',
      fromAccountId: 'bank',
      statementId: statement.id,
      amount: 500,
      date: '2026-02-02',
      source: 'operator',
      note: 'confirmed transfer',
    }
    const preview = await previewRecordCardPayment(input)
    const result = await recordCardPayment(input, preview.token)
    expect(result.transactionId).toBeTruthy()
    expect(result.statement).toMatchObject({ paidAmount: 500, linkedPaidAmount: 500 })
    expect(db.prepare("SELECT balance FROM accounts WHERE id = 'bank'").get()).toEqual({
      balance: 4500,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id = 'card'").get()).toEqual({
      balance: -1000,
    })

    const second = await createStatement(0, 500, true)
    db.exec(`
      CREATE TRIGGER fail_frontend_payment_link BEFORE INSERT ON card_statement_payment_links
      BEGIN SELECT RAISE(ABORT, 'link failure'); END;
    `)
    const failingInput = { ...input, statementId: second.id, amount: 100 }
    const failingPreview = await previewRecordCardPayment(failingInput)
    const before = allTableSnapshot()
    await expect(recordCardPayment(failingInput, failingPreview.token)).rejects.toThrow(
      /link failure/
    )
    expect(allTableSnapshot()).toEqual(before)
  })

  it('binds every mutation token to its operation, normalized arguments, plan, and database lineage', async () => {
    const draft = {
      statementEndDate: '2026-01-31',
      dueDate: '2026-02-15',
      statementBalance: 1000,
      minimumPayment: 100,
      paidAmount: 0,
      source: 'operator',
      note: 'reviewed create',
    }
    const createPreview = await previewCreateCardStatement('card', draft)
    await expect(
      createCardStatement('card', { ...draft, statementBalance: 1001 }, createPreview.token)
    ).rejects.toThrow(/arguments changed after preview/i)
    expect(count('credit_card_statements')).toBe(0)
    const statement = await createCardStatement('card', draft, createPreview.token)

    const updatePreview = await previewUpdateCardStatement(statement.id, { note: 'reviewed edit' })
    await expect(
      updateCardStatement(statement.id, { note: 'different edit' }, updatePreview.token)
    ).rejects.toThrow(/arguments changed after preview/i)

    const deletePreview = await previewDeleteCardStatement(
      statement.id,
      'operator',
      'reviewed delete'
    )
    await expect(
      deleteCardStatement(statement.id, deletePreview.token, 'operator', 'different delete')
    ).rejects.toThrow(/arguments changed after preview/i)

    insertPayment()
    const linkInput = {
      statementId: statement.id,
      transactionId: 'existing-payment',
      amount: 100,
      mode: 'apply_to_unpaid' as const,
      explicitRepaymentConfirmation: true,
      source: 'operator',
      note: 'reviewed link',
    }
    const linkPreview = await previewLinkCardPayment(linkInput)
    await expect(linkCardPayment({ ...linkInput, amount: 101 }, linkPreview.token)).rejects.toThrow(
      /arguments changed after preview/i
    )
    await linkCardPayment(linkInput, linkPreview.token)
    const link = (await listCardPaymentLinks(statement.id, 'active'))[0]
    const unlinkPreview = await previewUnlinkCardPayment(link.id, 'operator', 'reviewed unlink')
    await expect(
      unlinkCardPayment(link.id, unlinkPreview.token, 'operator', 'different unlink')
    ).rejects.toThrow(/arguments changed after preview/i)

    const baselineInput = {
      cardAccountId: 'card',
      statementId: statement.id,
      amount: 100,
      statementOnly: true,
      source: 'operator',
      note: 'reviewed baseline',
    }
    const baselinePreview = await previewRecordCardPayment(baselineInput)
    await expect(
      recordCardPayment({ ...baselineInput, amount: 101 }, baselinePreview.token)
    ).rejects.toThrow(/arguments changed after preview/i)

    const transferInput = {
      cardAccountId: 'card',
      fromAccountId: 'bank',
      amount: 100,
      source: 'operator',
      note: 'reviewed transfer',
    }
    const transferPreview = await previewRecordCardPayment(transferInput)
    await expect(
      recordCardPayment({ ...transferInput, amount: 101 }, transferPreview.token)
    ).rejects.toThrow(/arguments changed after preview/i)
    await expect(recordCardPayment(transferInput, baselinePreview.token)).rejects.toThrow(
      /arguments changed after preview/i
    )

    db.prepare("UPDATE app_data_state SET database_id = 'different-lineage' WHERE id = 1").run()
    const before = allTableSnapshot()
    await expect(recordCardPayment(transferInput, transferPreview.token)).rejects.toThrow(
      /changed after preview/i
    )
    expect(allTableSnapshot()).toEqual(before)
  })

  it('validates exact calendar dates, including leap years and nullable-but-not-blank starts', async () => {
    const valid = {
      statementStartDate: '2024-02-29',
      statementEndDate: '2024-03-31',
      dueDate: '2024-04-30',
      statementBalance: 100,
      minimumPayment: 10,
      paidAmount: 0,
    }
    await expect(previewCreateCardStatement('card', valid)).resolves.toMatchObject({
      operation: 'create-statement',
    })
    for (const patch of [
      { ...valid, statementStartDate: '' },
      { ...valid, statementStartDate: '2026-02-31' },
      { ...valid, statementEndDate: '2026-04-31' },
      { ...valid, dueDate: '2026-02-29' },
    ]) {
      await expect(previewCreateCardStatement('card', patch)).rejects.toThrow(/ISO date/)
    }
  })

  it('uses the local calendar date for default payments while audit timestamps remain UTC', async () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'America/Los_Angeles'
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:30:00.000Z'))
    try {
      const input = {
        cardAccountId: 'card',
        fromAccountId: 'bank',
        amount: 100,
        source: 'operator',
        note: 'midnight boundary',
      }
      const preview = await previewRecordCardPayment(input)
      await recordCardPayment(input, preview.token)
      expect(db.prepare('SELECT date, created_at FROM transactions').get()).toEqual({
        date: '2025-12-31',
        created_at: '2026-01-01T00:30:00.000Z',
      })
      expect(
        db.prepare("SELECT created_at FROM audit_log WHERE entity = 'transaction'").get()
      ).toEqual({ created_at: '2026-01-01T00:30:00.000Z' })
    } finally {
      vi.useRealTimers()
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })

  it('allows reviewed bank overdraft and card credit while retaining statement capacity limits', async () => {
    const statement = await createStatement(0, 7000)
    const input = {
      cardAccountId: 'card',
      fromAccountId: 'bank',
      statementId: statement.id,
      amount: 6000,
      source: 'operator',
      note: 'intentional overdraft and credit',
    }
    const preview = await previewRecordCardPayment(input)
    expect(preview.after).toMatchObject({ sourceBalance: -1000, cardBalance: 4500 })
    await recordCardPayment(input, preview.token)
    expect(db.prepare("SELECT balance FROM accounts WHERE id = 'bank'").get()).toEqual({
      balance: -1000,
    })
    expect(db.prepare("SELECT balance FROM accounts WHERE id = 'card'").get()).toEqual({
      balance: 4500,
    })
    expect((await listCardStatements('card'))[0]).toMatchObject({
      paidAmount: 6000,
      linkedPaidAmount: 6000,
      unattributedPaidAmount: 0,
    })
    await expect(previewRecordCardPayment({ ...input, amount: 1001 })).rejects.toThrow(
      /newly overpay|statement/i
    )
  })

  it('rejects stale reviewed plans and currency mismatches with zero writes', async () => {
    const statement = await createStatement()
    insertPayment()
    const input = {
      statementId: statement.id,
      transactionId: 'existing-payment',
      amount: 100,
      mode: 'apply_to_unpaid' as const,
      explicitRepaymentConfirmation: true,
      source: 'operator',
      note: 'receipt',
    }
    const preview = await previewLinkCardPayment(input)
    db.prepare("UPDATE accounts SET name = 'Changed' WHERE id = 'bank'").run()
    await expect(linkCardPayment(input, preview.token)).rejects.toThrow(/changed after preview/i)
    expect(count('card_statement_payment_links')).toBe(0)

    await expect(
      previewRecordCardPayment({
        cardAccountId: 'card',
        fromAccountId: 'eur',
        amount: 100,
        source: 'operator',
        note: 'wrong currency',
      })
    ).rejects.toThrow(/currencies do not match/i)
  })
})
