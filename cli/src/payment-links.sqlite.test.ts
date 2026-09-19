// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({
  db: null as Database.Database | null,
  failSql: null as string | null,
  beforeTransaction: null as (() => void) | null,
}))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    if (state.failSql && sql.includes(state.failSql)) throw new Error('Injected payment failure')
    return { rowsAffected: state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes }
  },
  transaction: (fn: () => unknown) => {
    const before = state.beforeTransaction
    state.beforeTransaction = null
    before?.()
    return state.db!.transaction(fn).immediate()
  },
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))
vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))

import { creditCardsTools } from './tools/credit-cards.js'
import { accountsTools } from './tools/accounts.js'

const tools = [...creditCardsTools, ...accountsTools]
const run = (name: string, input: Record<string, unknown>) => {
  const tool = tools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const rows = (table: string) =>
  state.db!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
const snapshot = () => ({
  accounts: rows('accounts'),
  transactions: rows('transactions'),
  statements: rows('credit_card_statements'),
  links: rows('card_statement_payment_links'),
  audit: rows('audit_log'),
  state: rows('app_data_state'),
})
function statement(id: string, paid = 0, balance = 1000) {
  const endDate = id === 's2' ? '2026-02-28' : '2026-01-31'
  const dueDate = id === 's2' ? '2026-03-15' : '2026-02-15'
  state
    .db!.prepare(
      `INSERT INTO credit_card_statements
      (id,account_id,statement_end_date,due_date,statement_balance,minimum_payment,paid_amount,unattributed_paid_amount,currency,status)
     VALUES (?,'card',?,?,?,0,?,?,'USD',?)`
    )
    .run(id, endDate, dueDate, balance, paid, paid, paid ? 'partial' : 'open')
}
function transfer(id: string, amount = 1000) {
  state
    .db!.prepare(
      `INSERT INTO transactions
      (id,account_id,transfer_to_account_id,type,amount,currency,description,status,ledger_treatment,reporting_treatment,transaction_kind,is_archived,date)
     VALUES (?,'bank','card','transfer',?,'USD',?,'posted','normal','normal','standard',0,'2026-02-01')`
    )
    .run(id, amount, id)
}
const linkInput = (statementId: string, transactionId: string, amount: number, extra = {}) => ({
  statementId,
  transactionId,
  amount,
  auditSource: 'operator',
  auditNote: 'verified receipt',
  ...extra,
})

beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(
    `INSERT INTO accounts (id,name,type,currency,balance,account_mode,is_archived)
     VALUES ('bank','Synthetic bank','checking','USD',5000,'transactional',0),
            ('card','Synthetic card','credit_card','USD',-1000,'transactional',0),
            ('other-card','Other card','credit_card','USD',0,'transactional',0)`
  )
  state.failSql = null
  state.beforeTransaction = null
})
afterEach(() => state.db?.close())

describe('card statement payment links on real SQLite', () => {
  it('declares exact trigger-maintained effects and read-only listing', () => {
    for (const name of ['link-card-statement-payment', 'unlink-card-statement-payment']) {
      expect(tools.find((tool) => tool.name === name)?.effects?.writesTo).toEqual([
        'card_statement_payment_links',
        'credit_card_statements',
        'audit_log',
        'app_data_state',
      ])
    }
    expect(
      tools.find((tool) => tool.name === 'list-card-statement-payment-links')?.effects
    ).toEqual({ readOnly: true })
  })
  it('applies and unlinks evidence without financial writes and retains immutable originals', async () => {
    statement('s1')
    transfer('pay')
    const financialBefore = {
      accounts: rows('accounts'),
      transactions: rows('transactions'),
    }
    const result = await run('link-card-statement-payment', linkInput('s1', 'pay', 4))
    expect(result).toMatchObject({ success: true, link: { amountCentavos: 400 } })
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 400,
      unattributed_paid_amount: 0,
      status: 'partial',
    })
    expect({ accounts: rows('accounts'), transactions: rows('transactions') }).toEqual(
      financialBefore
    )
    const linkId = String((result.link as { id: string }).id)
    expect(
      await run('list-card-statement-payment-links', {
        statementId: 's1',
        status: 'active',
      })
    ).toMatchObject({ success: true, count: 1, links: [{ id: linkId }] })
    expect(
      await run('unlink-card-statement-payment', {
        linkId,
        auditSource: 'operator',
        auditNote: 'wrong statement',
      })
    ).toMatchObject({ success: true })
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 0,
      unattributed_paid_amount: 0,
      status: 'overdue',
    })
    expect(
      await run('list-card-statement-payment-links', {
        transactionId: 'pay',
        status: 'voided',
      })
    ).toMatchObject({ success: true, count: 1, links: [{ id: linkId }] })
    state.db!.exec(
      "DELETE FROM transactions WHERE id='pay'; DELETE FROM credit_card_statements WHERE id='s1'"
    )
    expect(rows('card_statement_payment_links')[0]).toMatchObject({
      original_statement_id: 's1',
      original_transaction_id: 'pay',
      statement_id: null,
      transaction_id: null,
    })
  })

  it('attributes existing baseline and exactly reverses it', async () => {
    statement('s1', 600)
    transfer('pay')
    const result = await run(
      'link-card-statement-payment',
      linkInput('s1', 'pay', 4, { mode: 'attribute_existing' })
    )
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 600,
      unattributed_paid_amount: 200,
    })
    await run('unlink-card-statement-payment', {
      linkId: (result.link as { id: string }).id,
      auditSource: 'operator',
      auditNote: 'reverse attribution',
    })
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 600,
      unattributed_paid_amount: 600,
    })
  })

  it('enforces canonical capacity across statements under locked revalidation', async () => {
    statement('s1')
    statement('s2')
    transfer('pay')
    expect(await run('link-card-statement-payment', linkInput('s1', 'pay', 6))).toMatchObject({
      success: true,
    })
    expect(await run('link-card-statement-payment', linkInput('s2', 'pay', 4))).toMatchObject({
      success: true,
    })
    const before = snapshot()
    expect(await run('link-card-statement-payment', linkInput('s2', 'pay', 0.01))).toMatchObject({
      success: false,
      reason: 'payment_link_invalid',
    })
    expect(snapshot()).toEqual(before)
  })

  it('revalidates stale capacity rows when the write transaction acquires its lock', async () => {
    statement('s1')
    statement('s2')
    transfer('pay')
    state.beforeTransaction = () => {
      state.db!.exec(
        `UPDATE credit_card_statements SET paid_amount=600 WHERE id='s2';
         INSERT INTO card_statement_payment_links
          (id,statement_id,transaction_id,original_statement_id,original_transaction_id,amount,mode)
         VALUES ('concurrent','s2','pay','s2','pay',600,'apply_to_unpaid')`
      )
    }
    const beforeFinancial = { accounts: rows('accounts'), transactions: rows('transactions') }
    expect(await run('link-card-statement-payment', linkInput('s1', 'pay', 5))).toMatchObject({
      success: false,
    })
    expect(rows('card_statement_payment_links')).toHaveLength(1)
    expect(rows('credit_card_statements').find((row) => row.id === 's1')).toMatchObject({
      paid_amount: 0,
    })
    expect({ accounts: rows('accounts'), transactions: rows('transactions') }).toEqual(
      beforeFinancial
    )
  })

  it('canonicalizes a validated archived mirror and rejects wrong destination or broken aliases', async () => {
    statement('s1')
    transfer('source')
    state.db!.exec(
      `INSERT INTO transactions
        (id,account_id,type,amount,currency,description,status,ledger_treatment,reporting_treatment,transaction_kind,is_archived,matched_transaction_id,date)
       VALUES ('mirror','card','income',1000,'USD','mirror','cleared','normal','exclude_from_cashflow','archived_transfer_mirror',1,'source','2026-02-02');
       UPDATE transactions SET matched_transaction_id='mirror', reporting_treatment='exclude_from_cashflow' WHERE id='source'`
    )
    const linked = await run('link-card-statement-payment', linkInput('s1', 'mirror', 5))
    expect(linked).toMatchObject({
      success: true,
      link: { originalTransactionId: 'source', requestedTransactionId: 'mirror' },
    })
    await run('unlink-card-statement-payment', {
      linkId: (linked.link as { id: string }).id,
      auditSource: 'operator',
      auditNote: 'test',
    })
    state.db!.exec("UPDATE transactions SET amount=999 WHERE id='mirror'")
    expect(await run('link-card-statement-payment', linkInput('s1', 'mirror', 1))).toMatchObject({
      success: false,
    })
    transfer('wrong')
    state.db!.exec("UPDATE transactions SET transfer_to_account_id='other-card' WHERE id='wrong'")
    expect(await run('link-card-statement-payment', linkInput('s1', 'wrong', 1))).toMatchObject({
      success: false,
    })
  })

  it('requires explicit confirmation for ordinary evidence and excludes purchase/refund allocations', async () => {
    statement('s1')
    state.db!.exec(
      `INSERT INTO transactions
        (id,account_id,type,amount,currency,description,status,ledger_treatment,reporting_treatment,transaction_kind,is_archived,date)
       VALUES ('expense','bank','expense',1000,'USD','manual payment','posted','normal','normal','standard',0,'2026-02-01'),
              ('refund','card','income',1000,'USD','refund','posted','normal','normal','standard',0,'2026-02-01');
       INSERT INTO transaction_consumption_classifications
        (id,transaction_id,role,referenced_purchase_id)
       VALUES ('purchase','expense','purchase',NULL), ('refund-role','refund','refund','purchase')`
    )
    expect(await run('link-card-statement-payment', linkInput('s1', 'expense', 1))).toMatchObject({
      success: false,
    })
    expect(
      await run(
        'link-card-statement-payment',
        linkInput('s1', 'expense', 1, { confirmRepaymentToCard: true })
      )
    ).toMatchObject({ success: false })
    expect(
      await run(
        'link-card-statement-payment',
        linkInput('s1', 'refund', 1, { confirmRepaymentToCard: true })
      )
    ).toMatchObject({ success: false })
  })

  it('enforces explicit statement totals, deletion and account-type guards while preserving legacy overpayment', async () => {
    statement('s1')
    transfer('pay')
    const linked = await run('link-card-statement-payment', linkInput('s1', 'pay', 4))
    expect(
      await run('update-credit-card-statement', { statementId: 's1', paidAmount: 3 })
    ).toMatchObject({ success: false, reason: 'statement_paid_below_links' })
    expect(
      await run('update-credit-card-statement', { statementId: 's1', statementBalance: 3 })
    ).toMatchObject({ success: false, reason: 'statement_balance_below_links' })
    expect(await run('delete-credit-card-statement', { statementId: 's1' })).toMatchObject({
      success: false,
      reason: 'active_payment_links',
    })
    await expect(run('update-account', { accountId: 'card', type: 'checking' })).rejects.toThrow(
      /Unlink/
    )
    await run('unlink-card-statement-payment', {
      linkId: (linked.link as { id: string }).id,
      auditSource: 'operator',
      auditNote: 'remove evidence',
    })
    expect(
      await run('update-credit-card-statement', { statementId: 's1', paidAmount: 8 })
    ).toMatchObject({ success: true })
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 800,
      unattributed_paid_amount: 800,
    })
    state.db!.exec(
      "UPDATE credit_card_statements SET paid_amount=1200, unattributed_paid_amount=1200 WHERE id='s1'"
    )
    expect(
      await run('update-credit-card-statement', { statementId: 's1', note: 'legacy retained' })
    ).toMatchObject({ success: true })
    expect(rows('credit_card_statements')[0]).toMatchObject({ paid_amount: 1200 })
    expect(
      await run('update-credit-card-statement', { statementId: 's1', paidAmount: 11 })
    ).toMatchObject({ success: false, reason: 'statement_payment_exceeds_balance' })
  })

  it('records statement-only payment into the unattributed baseline without fake evidence', async () => {
    statement('s1')
    const beforeTransactions = rows('transactions')
    expect(
      await run('record-card-payment', {
        cardAccount: 'card',
        amount: 2,
        statementId: 's1',
        mode: 'statement-payment-only',
        source: 'operator',
        note: 'legacy statement receipt',
      })
    ).toMatchObject({ success: true, transactions: [], paymentLinks: [] })
    expect(rows('transactions')).toEqual(beforeTransactions)
    expect(rows('card_statement_payment_links')).toEqual([])
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 200,
      unattributed_paid_amount: 200,
    })
  })

  it('makes dry runs exact no-writes and rolls back record-card-payment transaction, balances, audit and revision', async () => {
    statement('s1')
    transfer('pay')
    const beforeDry = snapshot()
    expect(
      await run('link-card-statement-payment', { ...linkInput('s1', 'pay', 2), dryRun: true })
    ).toMatchObject({
      success: true,
      dryRun: true,
      balanceImpact: { affectsBalances: false },
      transactionImpact: { creates: [], updates: [], deletes: [] },
    })
    expect(snapshot()).toEqual(beforeDry)

    state.failSql = 'INSERT INTO card_statement_payment_links'
    const before = snapshot()
    await expect(
      run('record-card-payment', {
        fromAccount: 'bank',
        cardAccount: 'card',
        amount: 3,
        statementId: 's1',
        source: 'operator',
        note: 'receipt',
      })
    ).rejects.toThrow(/Injected payment failure/)
    expect(snapshot()).toEqual(before)
    state.failSql = null
    expect(
      await run('record-card-payment', {
        fromAccount: 'bank',
        cardAccount: 'card',
        amount: 3,
        statementId: 's1',
        source: 'operator',
        note: 'receipt',
      })
    ).toMatchObject({ success: true, paymentLinks: [{ amountCentavos: 300 }] })
    expect(rows('transactions')).toHaveLength(2)
    expect(rows('card_statement_payment_links')).toHaveLength(1)
    expect(rows('credit_card_statements')[0]).toMatchObject({
      paid_amount: 300,
      unattributed_paid_amount: 0,
    })
  })
})
