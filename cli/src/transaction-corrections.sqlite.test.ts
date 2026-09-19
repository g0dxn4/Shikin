// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db!.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db!.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db!.transaction(fn).immediate(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))
vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: vi.fn(),
  appendNote: vi.fn(),
  noteExists: vi.fn(),
  listNotes: vi.fn(),
}))
import { auditAndContextTools } from './tools/audit-and-context.js'
import { transactionsTools } from './tools/transactions.js'
import { financialInsightsTools } from './tools/financial-insights.js'
const tools = [...transactionsTools, ...financialInsightsTools, ...auditAndContextTools]
const run = (name: string, input: Record<string, unknown>) => {
  const tool = tools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const row = (id: string) =>
  state.db!.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as Record<string, unknown>
function snapshot() {
  return (
    state
      .db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map(({ name }) => [name, state.db!.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()])
}
function add(id: string, type = 'expense', amount = 1000, date = '2026-01-15', account = 'a') {
  state
    .db!.prepare(
      'INSERT INTO transactions (id, account_id, type, amount, currency, description, category_id, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(id, account, type, amount, 'USD', id, 'food', date)
}
beforeEach(() => {
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(
    "INSERT INTO accounts (id,name,type,balance) VALUES ('a','Synthetic bank','checking',-1000), ('b','Synthetic card','credit_card',1000); INSERT INTO categories (id,name,type) VALUES ('food','Synthetic food','expense'), ('other','Synthetic other','expense');"
  )
})
afterEach(() => state.db?.close())
describe('audited transaction correction SQLite preservation', () => {
  it('corrects finalized ordinary metadata while preserving immutable evidence and balances, including legacy metadata routing', async () => {
    add('buy')
    state.db!.exec(
      "INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount,selection_mode) VALUES ('final','a','2026-01-31',-1000,-1000,-1000,-1000,0,'explicit_rows'); UPDATE transactions SET finalization_id='final', source='source-original', note='note-original', import_source='Bank', import_external_id='opaque', import_fingerprint='identity-v1', import_content_fingerprint='content-v1', notes='editable' WHERE id='buy'"
    )
    const before = row('buy')
    const balances = state.db!.prepare('SELECT * FROM accounts').all()
    await run('correct-transaction-metadata', {
      transactionId: 'buy',
      description: 'Corrected',
      notes: null,
      auditSource: 'operator',
      auditNote: 'clarification',
    })
    expect(row('buy')).toEqual({
      ...before,
      description: 'Corrected',
      notes: null,
      updated_at: row('buy').updated_at,
    })
    expect(state.db!.prepare('SELECT * FROM accounts').all()).toEqual(balances)
    expect(state.db!.prepare('SELECT source,note FROM audit_log').get()).toEqual({
      source: 'operator',
      note: 'clarification',
    })
    await expect(
      run('update-transaction', { transactionId: 'buy', source: 'replacement' })
    ).rejects.toThrow(/immutable/)
    expect(
      (await run('update-transaction', { transactionId: 'buy', description: 'Legacy metadata' }))
        .success
    ).toBe(true)
    expect((await run('update-transaction', { transactionId: 'buy', amount: 20 })).success).toBe(
      false
    )
  })
  it('validates wrong owner, independent caps, referenced purchase remaps and rolls back failures', async () => {
    add('buy')
    add('refund', 'income', 600)
    add('refund2', 'income', 500)
    add('principal', 'expense', 1000)
    const purchase = (
      await run('set-transaction-consumption', { transactionId: 'buy', role: 'purchase' })
    ).classification.id
    await run('set-transaction-consumption', {
      transactionId: 'refund',
      role: 'refund',
      referencedPurchaseId: purchase,
    })
    await run('set-transaction-consumption', {
      transactionId: 'principal',
      role: 'principal',
      referencedPurchaseId: purchase,
    })
    const before = snapshot()
    await expect(
      run('set-transaction-consumption', {
        transactionId: 'refund2',
        role: 'refund',
        referencedPurchaseId: purchase,
      })
    ).rejects.toThrow(/capacity/)
    await expect(
      run('set-transaction-consumption', { transactionId: 'buy', role: 'fee' })
    ).rejects.toThrow(/purchase/)
    await expect(
      run('clear-transaction-consumption', { classificationId: purchase })
    ).rejects.toThrow(/referencing/)
    await expect(run('update-transaction', { transactionId: 'buy', amount: 5 })).rejects.toThrow(
      /capacity/
    )
    await expect(
      run('correct-transaction-metadata', {
        transactionId: 'buy',
        splits: [
          { categoryId: 'food', amountCentavos: 500 },
          { categoryId: 'other', amountCentavos: 500 },
        ],
      })
    ).rejects.toThrow(/classifications/)
    expect(snapshot()).toEqual(before)
    state.db!.exec(
      "INSERT INTO transaction_splits (id,transaction_id,category_id,amount) VALUES ('s1','refund2','food',500)"
    )
    await expect(
      run('set-transaction-consumption', {
        transactionId: 'refund',
        splitId: 's1',
        role: 'refund',
        referencedPurchaseId: purchase,
      })
    ).rejects.toThrow(/owned split/)
    await expect(
      run('correct-transaction-metadata', { transactionId: 'refund2', categoryId: 'other' })
    ).rejects.toThrow(/split replacement/)
  })
  it('guards live payments but allows metadata and voided links; protects bucket capacity', async () => {
    add('pay')
    state.db!.exec(
      "INSERT INTO credit_card_statements (id,account_id,statement_end_date,due_date,statement_balance) VALUES ('st','b','2026-01-31','2026-02-15',1000); INSERT INTO card_statement_payment_links (id,statement_id,transaction_id,original_statement_id,original_transaction_id,amount,mode) VALUES ('link','st','pay','st','pay',100,'apply_to_unpaid')"
    )
    await run('correct-transaction-metadata', {
      transactionId: 'pay',
      description: 'Still payment',
    })
    await expect(run('update-transaction', { transactionId: 'pay', amount: 5 })).rejects.toThrow(
      /Unlink/
    )
    await expect(
      run('set-transaction-consumption', { transactionId: 'pay', role: 'purchase' })
    ).rejects.toThrow(/Unlink/)
    state.db!.exec("UPDATE card_statement_payment_links SET voided_at='2026-02-01'")
    expect((await run('update-transaction', { transactionId: 'pay', amount: 5 })).success).toBe(
      true
    )
    state.db!.exec(
      "INSERT INTO cashflow_buckets (id,name) VALUES ('bucket','Synthetic'); INSERT INTO cashflow_bucket_allocations (id,bucket_id,transaction_id,amount,allocation_date) VALUES ('allocation','bucket','pay',100,'2026-01-15')"
    )
    await expect(run('delete-transaction', { transactionId: 'pay' })).rejects.toThrow(/bucket/)
  })
  it('matches excluded ordinary rows deliberately and restores both originals exactly; rejects ambiguous legacy', async () => {
    add('debit')
    add('credit', 'income', 1000, '2026-01-16', 'b')
    state.db!.exec(
      "UPDATE transactions SET reporting_treatment='exclude_from_cashflow', source='immutable', note='original' WHERE id='debit'"
    )
    const original = [row('debit'), row('credit')]
    const balances = state.db!.prepare('SELECT * FROM accounts').all()
    expect(
      (
        await run('match-transfer-transactions', {
          sourceTransactionId: 'debit',
          mirrorTransactionId: 'credit',
          apply: true,
        })
      ).success
    ).toBe(true)
    expect(
      (await run('unmatch-transfer-transactions', { sourceTransactionId: 'debit', apply: true }))
        .success
    ).toBe(true)
    expect([row('debit'), row('credit')]).toEqual(original)
    // Existing match implementation writes zero balance deltas; account balances remain invariant.
    expect(state.db!.prepare('SELECT id,balance FROM accounts').all()).toEqual(
      (balances as { id: string; balance: number }[]).map(({ id, balance }) => ({ id, balance }))
    )
    expect(
      state.db!.prepare('SELECT unmatched_at FROM transfer_match_provenance').get()
    ).toMatchObject({ unmatched_at: expect.any(String) })
    await run('match-transfer-transactions', {
      sourceTransactionId: 'debit',
      mirrorTransactionId: 'credit',
      apply: true,
    })
    state.db!.exec('DELETE FROM transfer_match_provenance')
    const before = snapshot()
    expect(
      (await run('unmatch-transfer-transactions', { sourceTransactionId: 'debit', apply: true }))
        .reason
    ).toBe('ambiguous_legacy_provenance')
    expect(snapshot()).toEqual(before)
  })
  it('returns known net subtotals, incomplete IDs, refund-date purchase-category attribution; recap reads do not write and saves are basis-idempotent', async () => {
    add('buy')
    add('refund', 'income', 200, '2026-02-05')
    add('unknown', 'expense', 700, '2026-02-10')
    const purchase = (
      await run('set-transaction-consumption', { transactionId: 'buy', role: 'purchase' })
    ).classification.id
    await run('set-transaction-consumption', {
      transactionId: 'refund',
      role: 'refund',
      referencedPurchaseId: purchase,
    })
    const before = snapshot()
    const summary = await run('get-spending-summary', {
      period: 'custom',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      basis: 'net_consumption',
    })
    expect(summary).toMatchObject({
      complete: false,
      coverageComplete: false,
      unresolvedIds: ['unknown'],
      totalsByCurrency: [{ currency: 'USD', consumptionCentavos: -200 }],
      byCategory: [{ categoryId: 'food', amountCentavos: -200 }],
    })
    await run('get-spending-recap', {
      type: 'monthly',
      period: '2026-02-01',
      basis: 'net_consumption',
    })
    expect(snapshot()).toEqual(before)
    await run('save-spending-recap', {
      type: 'monthly',
      period: '2026-02-01',
      basis: 'net_consumption',
    })
    const saved = snapshot()
    await run('save-spending-recap', {
      type: 'monthly',
      period: '2026-02-01',
      basis: 'net_consumption',
    })
    expect(snapshot()).toEqual(saved)
    await run('save-spending-recap', { type: 'monthly', period: '2026-02-01' })
    expect(
      state.db!.prepare('SELECT basis,currency_scope FROM recaps ORDER BY basis').all()
    ).toEqual([
      { basis: 'gross_cashflow', currency_scope: 'all' },
      { basis: 'net_consumption', currency_scope: 'all' },
    ])
  })
  it.each(['classification', 'import', 'finalization', 'payment', 'bucket'])(
    'generic undo cannot bypass %s evidence, in preview or apply',
    async (protection) => {
      const added = await run('add-transaction', {
        accountId: 'a',
        type: 'expense',
        amount: 10,
        description: 'Synthetic undo',
        date: '2026-01-15',
      })
      const id = added.transaction.id
      const audit = state
        .db!.prepare("SELECT id FROM audit_log WHERE entity_id = ? AND action='create'")
        .get(id) as { id: string }
      if (protection === 'classification')
        await run('set-transaction-consumption', { transactionId: id, role: 'purchase' })
      if (protection === 'import')
        state
          .db!.prepare(
            "UPDATE transactions SET import_source='bank', import_external_id='opaque' WHERE id=?"
          )
          .run(id)
      if (protection === 'finalization') {
        state.db!.exec(
          "INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount,selection_mode) VALUES ('final','a','2026-01-31',0,0,0,0,0,'explicit_rows')"
        )
        state.db!.prepare("UPDATE transactions SET finalization_id='final' WHERE id=?").run(id)
      }
      if (protection === 'payment') {
        state.db!.exec(
          "INSERT INTO credit_card_statements (id,account_id,statement_end_date,due_date,statement_balance) VALUES ('st','b','2026-01-31','2026-02-15',1000)"
        )
        state
          .db!.prepare(
            "INSERT INTO card_statement_payment_links (id,statement_id,transaction_id,original_statement_id,original_transaction_id,amount,mode) VALUES ('link','st',?,'st',?,100,'apply_to_unpaid')"
          )
          .run(id, id)
      }
      if (protection === 'bucket') {
        state.db!.exec("INSERT INTO cashflow_buckets (id,name) VALUES ('bucket','Synthetic')")
        state
          .db!.prepare(
            "INSERT INTO cashflow_bucket_allocations (id,bucket_id,transaction_id,amount,allocation_date) VALUES ('allocation','bucket',?,100,'2026-01-15')"
          )
          .run(id)
      }
      const before = snapshot()
      for (const apply of [false, true])
        await expect(
          run('undo', { auditId: audit.id, apply, allowDependentWrites: true })
        ).rejects.toThrow(/protected|classifications|Unlink|bucket allocations/)
      expect(snapshot()).toEqual(before)
    }
  )

  it('requires independently verified coverage even for an empty net period and does not infer from row dates', async () => {
    const input = {
      period: 'custom',
      startDate: '2026-02-01',
      endDate: '2026-02-28',
      basis: 'net_consumption',
    }
    expect(await run('get-spending-summary', input)).toMatchObject({
      complete: false,
      totalsByCurrency: [],
      uncoveredAccountIds: ['a', 'b'],
    })
    for (const account of ['a', 'b'])
      state
        .db!.prepare(
          "INSERT INTO source_coverage (id,account_id,source_namespace,period_start,period_end,status,zero_rows) VALUES (?,?,'bank','2026-02-01','2026-02-28','verified',1)"
        )
        .run(account, account)
    expect(await run('get-spending-summary', input)).toMatchObject({
      complete: true,
      totalsByCurrency: [],
      uncoveredAccountIds: [],
    })
  })

  it('allows leftover staged pending financial edits but retains effective legacy batch protection', async () => {
    add('leftover')
    state.db!.exec(
      "INSERT INTO account_reconciliations (id,account_id,reconciliation_date,actual_balance,stored_balance_before,ledger_balance_before,ledger_balance_after,adjustment_amount,staging_batch_id) VALUES ('legacy','a','2026-01-31',0,0,0,0,0,'batch'); UPDATE transactions SET staging_batch_id='batch', ledger_treatment='staged_no_balance_impact', status='pending' WHERE id='leftover'"
    )
    expect(
      (await run('update-transaction', { transactionId: 'leftover', amount: 20 })).success
    ).toBe(true)
    state.db!.exec(
      "UPDATE transactions SET ledger_treatment='normal', status='posted' WHERE id='leftover'"
    )
    expect(
      (await run('update-transaction', { transactionId: 'leftover', amount: 30 })).reason
    ).toBe('finalized_statement_transaction')
  })
  it('rejects cross-currency references and principal overflow independently, and clears only after dependents', async () => {
    add('purchase')
    add('principal', 'expense', 1000)
    add('extra', 'expense', 1)
    add('foreign', 'income', 1)
    state.db!.exec("UPDATE transactions SET currency='EUR' WHERE id='foreign'")
    const purchase = (
      await run('set-transaction-consumption', { transactionId: 'purchase', role: 'purchase' })
    ).classification.id
    const principal = (
      await run('set-transaction-consumption', {
        transactionId: 'principal',
        role: 'principal',
        referencedPurchaseId: purchase,
      })
    ).classification.id
    const before = snapshot()
    await expect(
      run('set-transaction-consumption', {
        transactionId: 'foreign',
        role: 'refund',
        referencedPurchaseId: purchase,
      })
    ).rejects.toThrow(/currency/)
    await expect(
      run('set-transaction-consumption', {
        transactionId: 'extra',
        role: 'principal',
        referencedPurchaseId: purchase,
      })
    ).rejects.toThrow(/capacity/)
    expect(snapshot()).toEqual(before)
    await run('clear-transaction-consumption', { classificationId: principal })
    await run('clear-transaction-consumption', { classificationId: purchase })
    expect(
      state.db!.prepare('SELECT * FROM transaction_consumption_classifications').all()
    ).toEqual([])
  })

  it('previews without writes and distinguishes omitted, cleared and replacement metadata', async () => {
    add('tx')
    state.db!.exec("UPDATE transactions SET notes='keep me' WHERE id='tx'")
    const before = snapshot()
    await run('correct-transaction-metadata', {
      transactionId: 'tx',
      clearNotes: true,
      dryRun: true,
    })
    expect(snapshot()).toEqual(before)
    await run('correct-transaction-metadata', { transactionId: 'tx', description: 'Changed' })
    expect(row('tx').notes).toBe('keep me')
    await expect(
      run('correct-transaction-metadata', {
        transactionId: 'tx',
        clearNotes: true,
        notes: 'conflict',
      })
    ).rejects.toThrow(/Clear flags/)
    await run('correct-transaction-metadata', { transactionId: 'tx', clearNotes: true })
    expect(row('tx').notes).toBeNull()
    await run('correct-transaction-metadata', { transactionId: 'tx', notes: 'new user note' })
    expect(row('tx').notes).toBe('new user note')
  })

  it('allows safe source capacity increases but rejects reductions below live bucket funding atomically', async () => {
    add('income', 'income')
    state.db!.exec(
      "INSERT INTO cashflow_buckets (id,name,currency) VALUES ('bucket','Synthetic','USD'); INSERT INTO cashflow_bucket_allocations (id,bucket_id,transaction_id,amount,currency,allocation_date) VALUES ('allocation','bucket','income',800,'USD','2026-01-15')"
    )
    expect((await run('update-transaction', { transactionId: 'income', amount: 12 })).success).toBe(
      true
    )
    const before = snapshot()
    await expect(run('update-transaction', { transactionId: 'income', amount: 7 })).rejects.toThrow(
      /capacity/
    )
    expect(snapshot()).toEqual(before)
  })
  it('rolls back basis-aware recap persistence if its audit fails', async () => {
    const before = snapshot()
    state.db!.exec(
      "CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END"
    )
    await expect(
      run('save-spending-recap', {
        type: 'monthly',
        period: '2026-02-01',
        basis: 'net_consumption',
      })
    ).rejects.toThrow('synthetic audit failure')
    expect(snapshot()).toEqual(before)
  })
})
