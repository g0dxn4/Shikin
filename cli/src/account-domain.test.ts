// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database, fail: '' }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => {
    if (holder.fail && sql.includes(holder.fail)) throw new Error('Injected failure')
    return { rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes }
  },
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))
import { accountsTools } from './tools/accounts.js'
const call = (name: string, input: Record<string, unknown>) => {
  const tool = accountsTools.find((t) => t.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const rows = (table: string) =>
  holder.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
function snapshot() {
  const tables = holder.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[]
  return Object.fromEntries(tables.map(({ name }) => [name, rows(name)]))
}
function tx(
  id: string,
  amount: number,
  date = '2025-01-15',
  options: {
    type?: string
    staged?: boolean
    status?: string
    account?: string
    source?: string
  } = {}
) {
  holder.db
    .prepare(
      `INSERT INTO transactions (id, account_id, type, amount, currency, date, description, ledger_treatment, status, staging_batch_id, import_source, import_external_id, source, note)
    VALUES (?, ?, ?, ?, 'USD', ?, ?, ?, ?, 'batch', ?, ?, 'original-source', 'original-note')`
    )
    .run(
      id,
      options.account ?? 'a',
      options.type ?? 'income',
      amount,
      date,
      id,
      options.staged ? 'staged_no_balance_impact' : 'normal',
      options.status ?? 'posted',
      options.source ?? 'Bank',
      `external-${id}`
    )
}
async function coverage(extra: Record<string, unknown> = {}) {
  return (
    await call('set-source-coverage', {
      accountId: 'a',
      sourceNamespace: 'Bank',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      status: 'verified',
      documentRef: 'synthetic.pdf',
      ...extra,
    })
  ).coverage.id as string
}
async function observe(balance: number, date = '2025-01-31') {
  return call('reconcile', {
    accountId: 'a',
    actualBalance: balance,
    date,
    apply: true,
    basis: 'effective_ledger',
  })
}
const finalInput = (coverageId: string, extra: Record<string, unknown> = {}) => ({
  accountId: 'a',
  stagingBatchId: 'batch',
  coverageIds: [coverageId],
  statementStartDate: '2025-01-01',
  statementEndDate: '2025-01-31',
  actualBalance: 10,
  ...extra,
})

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db.exec(
    "INSERT INTO accounts (id, name, type, currency, balance) VALUES ('a', 'Synthetic cash', 'checking', 'USD', 0), ('b', 'Synthetic bank', 'checking', 'USD', 0)"
  )
  holder.fail = ''
})
afterEach(() => holder.db.close())

describe('account declarations and nullable maintenance', () => {
  it('requires portfolio ownership, defaults cash, preserves mode-only financial history, and clears only explicit metadata', async () => {
    const initial = snapshot()
    await expect(call('create-account', { name: 'Portfolio', type: 'investment' })).rejects.toThrow(
      'explicit valuationMode'
    )
    expect(snapshot()).toEqual(initial)
    const created = await call('create-account', {
      name: 'Portfolio',
      type: 'investment',
      valuationMode: 'portfolio_snapshot',
      balance: 5,
    })
    const id = created.account.id
    const history = rows('transactions'),
      observations = rows('account_reconciliations')
    await call('update-account', {
      accountId: id,
      valuationMode: 'cash_plus_holdings',
      icon: 'wallet',
      color: '#aaa',
      creditLimit: 10,
      statementClosingDay: 5,
    })
    expect(rows('transactions')).toEqual(history)
    expect(rows('account_reconciliations')).toEqual(observations)
    const before = snapshot()
    await expect(
      call('update-account', { accountId: id, clearIcon: true, icon: 'bad' })
    ).rejects.toThrow('conflicts')
    expect(snapshot()).toEqual(before)
    await call('update-account', {
      accountId: id,
      clearIcon: true,
      color: null,
      creditLimit: null,
      statementClosingDay: null,
    })
    expect(rows('accounts').find((r) => r.id === id)).toMatchObject({
      icon: null,
      color: null,
      credit_limit: null,
      statement_closing_day: null,
      balance: 500,
      valuation_mode: 'cash_plus_holdings',
    })
    const cash = await call('create-account', { name: 'Cash' })
    expect(rows('accounts').find((r) => r.id === cash.account.id)?.valuation_mode).toBe(
      'cash_plus_holdings'
    )
  })
  it('upsert declares ownership without balance inference', async () => {
    await expect(
      call('upsert-account', { name: 'Crypto', type: 'crypto', balance: 0 })
    ).rejects.toThrow('explicit valuationMode')
    const result = await call('upsert-account', {
      name: 'Crypto',
      type: 'crypto',
      valuationMode: 'unresolved',
      balance: 0,
    })
    expect(result.account.valuationMode).toBe('unresolved')
    await call('upsert-account', {
      accountId: result.account.id,
      valuationMode: 'portfolio_snapshot',
    })
    expect(rows('transactions')).toHaveLength(0)
  })
})

describe('dated reconciliation', () => {
  it('retains later activity, discloses discrepancy, keeps history and rejects crossing anchors atomically', async () => {
    tx('early', 1000)
    tx('late', 200, '2025-02-03', { type: 'expense' })
    holder.db.exec("UPDATE accounts SET balance = 777 WHERE id = 'a'")
    const originals = rows('transactions')
    const result = await observe(12)
    expect(result).toMatchObject({
      asOfLedger: 1000,
      currentLedger: 800,
      adjustment: 200,
      currentBalanceAfter: 1000,
      storedVsLedgerDiscrepancy: -23,
      storedBalanceEffect: 223,
      laterActivityRetained: -200,
    })
    expect(rows('accounts')[0]?.balance).toBe(1000)
    expect(rows('transactions').slice(0, 2)).toEqual(originals)
    await observe(10, '2025-02-28')
    const before = snapshot()
    await expect(observe(13)).rejects.toThrow('later anchor')
    expect(snapshot()).toEqual(before)
    await observe(12) // zero-effect at old boundary allowed
    await expect(observe(12, '2999-01-01')).rejects.toThrow('future')
  })
  it('uses cross-date matched credit evidence and rejects broken pairs with exact rollback', async () => {
    tx('source', 1000, '2025-01-30', { type: 'expense' })
    tx('mirror', 1000, '2025-02-02', { account: 'b' })
    holder.db
      .exec(`UPDATE transactions SET type='transfer', transfer_to_account_id='b', matched_transaction_id='mirror', reporting_treatment='exclude_from_cashflow' WHERE id='source';
      UPDATE transactions SET matched_transaction_id='source', transaction_kind='archived_transfer_mirror', is_archived=1, reporting_treatment='exclude_from_cashflow' WHERE id='mirror'`)
    const source = await call('reconcile', {
      accountId: 'a',
      actualBalance: -10,
      date: '2025-01-31',
    })
    const dest = await call('reconcile', { accountId: 'b', actualBalance: 0, date: '2025-01-31' })
    expect(source.asOfLedger).toBe(-1000)
    expect(dest.asOfLedger).toBe(0)
    expect(dest.currentLedger).toBe(1000)
    holder.db.exec("UPDATE transactions SET matched_transaction_id = NULL WHERE id='mirror'")
    const before = snapshot()
    await expect(observe(-10)).rejects.toThrow('Missing matched source')
    expect(snapshot()).toEqual(before)
  })
  it('rolls back every row and durable revision on an injected bridge-link failure', async () => {
    tx('early', 1000)
    const before = snapshot()
    holder.fail = 'UPDATE account_reconciliations SET adjustment_transaction_id'
    await expect(observe(12)).rejects.toThrow('Injected failure')
    expect(snapshot()).toEqual(before)
  })
})

describe('explicit membership, settlement and independent coverage', () => {
  it('revisits a batch for disjoint memberships and never promotes a pending hold', async () => {
    tx('one', 400, undefined, { staged: true })
    tx('two', 600, undefined, { staged: true })
    tx('hold', 100, undefined, { staged: true, status: 'pending' })
    const coverageId = await coverage(),
      original = rows('transactions')
    const first = await call(
      'finalize-staged-statement-history',
      finalInput(coverageId, { transactionIds: ['one'], actualBalance: 4, apply: true })
    )
    const second = await call(
      'finalize-staged-statement-history',
      finalInput(coverageId, { actualBalance: 10, apply: true })
    )
    expect(first.reconciliationId).not.toBe(second.reconciliationId)
    expect(rows('account_reconciliations').map((r) => r.selection_mode)).toEqual([
      'explicit_rows',
      'explicit_rows',
    ])
    const after = rows('transactions')
    expect(after[0]).toMatchObject({
      ...original[0],
      ledger_treatment: 'normal',
      finalization_id: first.reconciliationId,
      updated_at: after[0]?.updated_at,
    })
    expect(after[1]?.finalization_id).toBe(second.reconciliationId)
    expect(after[2]).toEqual(original[2])
    const before = snapshot()
    await expect(
      call(
        'finalize-staged-statement-history',
        finalInput(coverageId, { transactionIds: ['hold'], apply: true })
      )
    ).rejects.toThrow('eligible')
    await expect(
      call(
        'finalize-staged-statement-history',
        finalInput(coverageId, { transactionIds: ['one'], apply: true })
      )
    ).rejects.toThrow('eligible')
    expect(snapshot()).toEqual(before)
    await call('settle-staged-transactions', {
      accountId: 'a',
      transactionIds: ['hold'],
      status: 'posted',
      apply: true,
    })
    expect(rows('transactions')[2]).toMatchObject({
      status: 'posted',
      ledger_treatment: 'staged_no_balance_impact',
      finalization_id: null,
    })
    await call(
      'finalize-staged-statement-history',
      finalInput(coverageId, { transactionIds: ['hold'], actualBalance: 11, apply: true })
    )
    expect(rows('accounts')[0]?.balance).toBe(1100)
  })
  it('retains zero-row and gap evidence; demands provisional acknowledgment and audits the exact evidence snapshot', async () => {
    const zero = await coverage({ zeroRows: true })
    const gap = await coverage({ status: 'gap', documentRef: null })
    expect(rows('transactions')).toHaveLength(0)
    expect((await call('list-source-coverage', { accountId: 'a' })).coverage).toHaveLength(2)
    tx('one', 1000, undefined, { staged: true })
    for (const id of [zero, gap])
      await expect(
        call('finalize-staged-statement-history', finalInput(id, { apply: true }))
      ).rejects.toThrow()
    const provisional = await coverage({
      status: 'provisional',
      note: 'Missing preceding document',
    })
    const before = snapshot()
    await expect(
      call('finalize-staged-statement-history', finalInput(provisional, { apply: true }))
    ).rejects.toThrow('acknowledgeProvisional')
    expect(snapshot()).toEqual(before)
    const result = await call(
      'finalize-staged-statement-history',
      finalInput(provisional, {
        apply: true,
        acknowledgeProvisional: true,
        provisionalProvenance: 'Operator reviewed missing document',
      })
    )
    const audit = rows('audit_log').find((r) => r.action === 'finalize-staged-statement-history')!
    expect(JSON.parse(audit.after_json as string)).toMatchObject({
      transactionIds: ['one'],
      reconciliationId: result.reconciliationId,
      coverage: [expect.objectContaining({ id: provisional, status: 'provisional' })],
    })
    await call('set-source-coverage', {
      accountId: 'a',
      coverageId: provisional,
      sourceNamespace: 'Bank',
      periodStart: '2025-01-01',
      periodEnd: '2025-01-31',
      status: 'verified',
      documentRef: 'found.pdf',
    })
    expect(rows('audit_log').find((r) => r.id === audit.id)).toEqual(audit)
  })
  it('rejects case mismatches, missing coverage, cross-boundary and multi-account selections, and rolls back activation failure', async () => {
    tx('one', 1000, undefined, { staged: true })
    tx('other', 100, undefined, { staged: true, account: 'b' })
    const wrong = await coverage({ sourceNamespace: 'bank' })
    await expect(
      call('finalize-staged-statement-history', finalInput(wrong, { apply: true }))
    ).rejects.toThrow('coverage')
    const good = await coverage(),
      before = snapshot()
    await expect(
      call(
        'finalize-staged-statement-history',
        finalInput(good, { transactionIds: ['one', 'other'], apply: true })
      )
    ).rejects.toThrow('account scope')
    holder.fail = 'UPDATE accounts SET balance'
    await expect(
      call('finalize-staged-statement-history', finalInput(good, { apply: true }))
    ).rejects.toThrow('Injected failure')
    expect(snapshot()).toEqual(before)
  })
})

describe('reviewed invariant-preserving bridge supersession', () => {
  it.each([
    { amount: 400, type: 'income', residual: 600 },
    { amount: 1500, type: 'income', residual: -500 },
    { amount: 1000, type: 'income', residual: 0 },
    { amount: 300, type: 'expense', residual: 1300 },
  ])(
    'preserves exact originals and all later/current balances with residual $residual',
    async ({ amount, type, residual }) => {
      const original = await observe(10)
      tx('later', 200, '2025-02-01', { type: 'expense' })
      await observe(8, '2025-02-28')
      // Existing store/anchor inconsistencies are evidence, not permission to repair.
      holder.db.exec(
        "UPDATE accounts SET balance = 777 WHERE id='a'; UPDATE account_reconciliations SET actual_balance = 888 WHERE reconciliation_date='2025-02-28'"
      )
      tx('replacement', amount, undefined, { staged: true, type })
      const c = await coverage()
      const before = snapshot(),
        oldBridge = rows('transactions').find((r) => r.id === original.adjustmentTransactionId)!
      const input = {
        accountId: 'a',
        reconciliationId: original.reconciliationId,
        bridgeId: original.adjustmentTransactionId,
        transactionIds: ['replacement'],
        coverageIds: [c],
      }
      const preview = await call('supersede-reconciliation-bridge', input)
      expect(snapshot()).toEqual(before)
      expect(preview.plan.successorSignedBridge).toBe(residual)
      const applied = await call('supersede-reconciliation-bridge', {
        ...input,
        apply: true,
        previewToken: preview.previewToken,
      })
      expect(rows('transactions').find((r) => r.id === oldBridge.id)).toEqual({
        ...oldBridge,
        is_archived: 1,
      })
      expect(rows('accounts')).toEqual(before.accounts)
      expect(rows('account_reconciliations').slice(0, 2)).toEqual(before.account_reconciliations)
      expect(rows('account_balance_history')).toEqual(before.account_balance_history)
      expect(applied.currentStoredAfter).toBe(777)
      expect(applied.currentEffectiveAfter).toBe(800)
      expect(applied.laterAnchorsAfter).toEqual(preview.plan.laterAnchors)
      if (residual === 0) expect(applied.successorBridgeId).toBeNull()
      else
        expect(rows('transactions').find((r) => r.id === applied.successorBridgeId)).toMatchObject({
          amount: Math.abs(residual),
          type: residual > 0 ? 'income' : 'expense',
        })
      expect(rows('transactions').find((r) => r.id === 'replacement')).toMatchObject({
        finalization_id: applied.successorReconciliationId,
        reconciliation_id: null,
        import_source: 'Bank',
        import_external_id: 'external-replacement',
        source: 'original-source',
        note: 'original-note',
        staging_batch_id: 'batch',
      })
    }
  )
  it('rejects stale/changed tokens and boundary crossings and rolls back injected and postcondition failures exactly', async () => {
    const original = await observe(10)
    tx('replacement', 400, undefined, { staged: true })
    const c = await coverage()
    const input = {
      accountId: 'a',
      reconciliationId: original.reconciliationId,
      bridgeId: original.adjustmentTransactionId,
      transactionIds: ['replacement'],
      coverageIds: [c],
    }
    const preview = await call('supersede-reconciliation-bridge', input)
    holder.db.exec("UPDATE accounts SET name='Revision changed' WHERE id='b'")
    const changed = snapshot()
    await expect(
      call('supersede-reconciliation-bridge', {
        ...input,
        apply: true,
        previewToken: preview.previewToken,
      })
    ).rejects.toThrow('stale')
    expect(snapshot()).toEqual(changed)
    const reviewed = await call('supersede-reconciliation-bridge', input)
    await expect(
      call('supersede-reconciliation-bridge', {
        ...input,
        note: 'changed plan',
        apply: true,
        previewToken: reviewed.previewToken,
      })
    ).rejects.toThrow('stale')
    holder.fail = 'INSERT INTO reconciliation_corrections'
    await expect(
      call('supersede-reconciliation-bridge', {
        ...input,
        apply: true,
        previewToken: reviewed.previewToken,
      })
    ).rejects.toThrow('Injected failure')
    expect(snapshot()).toEqual(changed)
    holder.fail = ''
    holder.db.exec(
      "CREATE TRIGGER inject_balance_failure AFTER UPDATE OF is_archived ON transactions BEGIN UPDATE accounts SET balance = balance + 1 WHERE id = 'a'; END"
    )
    const before = snapshot(),
      next = await call('supersede-reconciliation-bridge', input)
    await expect(
      call('supersede-reconciliation-bridge', {
        ...input,
        apply: true,
        previewToken: next.previewToken,
      })
    ).rejects.toThrow('postcondition')
    expect(snapshot()).toEqual(before)
    holder.db.exec("UPDATE transactions SET date='2025-02-01' WHERE id='replacement'")
    await expect(call('supersede-reconciliation-bridge', input)).rejects.toThrow('boundary')
  })
})

describe('additional account boundaries', () => {
  it('finalizes exact multi-batch selection without rewriting batch identity and retains later activity', async () => {
    tx('first-batch', 400, undefined, { staged: true })
    tx('second-batch', 600, undefined, { staged: true })
    holder.db.exec("UPDATE transactions SET staging_batch_id='other-batch' WHERE id='second-batch'")
    tx('later', 200, '2025-02-05', { type: 'expense' })
    const c = await coverage()
    const result = await call(
      'finalize-staged-statement-history',
      finalInput(c, {
        stagingBatchId: undefined,
        transactionIds: ['second-batch', 'first-batch'],
        apply: true,
      })
    )
    expect(result.currentBalanceAfter).toBe(800)
    expect(
      rows('transactions')
        .slice(0, 2)
        .map((r) => r.staging_batch_id)
    ).toEqual(['batch', 'other-batch'])
    expect(
      rows('transactions')
        .slice(0, 2)
        .map((r) => r.finalization_id)
    ).toEqual([result.reconciliationId, result.reconciliationId])
  })
  it('does not treat sparse transactions as proof of a larger statement period', async () => {
    tx('sparse', 1000, '2025-01-10', { staged: true })
    const c = await coverage({ periodStart: '2025-01-10', periodEnd: '2025-01-10' }),
      before = snapshot()
    await expect(
      call('finalize-staged-statement-history', finalInput(c, { apply: true }))
    ).rejects.toThrow('full declared period')
    expect(snapshot()).toEqual(before)
  })
  it('preserves legacy batch evidence while finalizing still-staged leftovers', async () => {
    tx('legacy-effective', 400)
    holder.db
      .exec(`INSERT INTO account_reconciliations (id, account_id, reconciliation_date, actual_balance, stored_balance_before, ledger_balance_before, ledger_balance_after, adjustment_amount, staging_batch_id)
      VALUES ('legacy', 'a', '2025-01-31', 400, 400, 400, 400, 0, 'batch')`)
    const legacy = rows('account_reconciliations')[0],
      original = rows('transactions')[0]
    tx('leftover', 600, undefined, { staged: true })
    await call('finalize-staged-statement-history', finalInput(await coverage(), { apply: true }))
    expect(rows('account_reconciliations')[0]).toEqual(legacy)
    expect(rows('transactions')[0]).toEqual(original)
    expect(rows('transactions')[1]?.finalization_id).toBeTruthy()
  })
  it('previews dated account updates honestly and validates future observed dates even for zero openings', async () => {
    tx('early', 1000)
    tx('later', 200, '2025-02-01', { type: 'expense' })
    holder.db.exec("UPDATE accounts SET balance = 800 WHERE id='a'")
    const before = snapshot()
    const preview = await call('update-account', {
      accountId: 'a',
      balance: 12,
      observedDate: '2025-01-31',
      dryRun: true,
    })
    expect(preview.wouldUpdate.after.balanceCentavos).toBe(1000)
    expect(preview.wouldUpdate.reconciliation).toMatchObject({
      adjustment: 200,
      currentBalanceAfter: 1000,
    })
    await expect(
      call('create-account', { name: 'Invalid future', balance: 0, observedDate: '2999-01-01' })
    ).rejects.toThrow('future')
    expect(snapshot()).toEqual(before)
  })
  it('archives accounts with only zero-row coverage, retaining readable evidence', async () => {
    const c = await coverage({ zeroRows: true })
    const result = await call('delete-account', { accountId: 'a' })
    expect(result.action).toBe('archived')
    expect((await call('list-source-coverage', { accountId: 'a' })).coverage[0].id).toBe(c)
  })
})

it('maintains upsert idempotence for explicitly repeated ownership and nullable values', async () => {
  const first = await call('upsert-account', {
    accountId: 'a',
    valuationMode: 'cash_plus_holdings',
    icon: null,
    creditLimit: 0,
  })
  expect(first.changed).toBe(true)
  const before = snapshot()
  const repeat = await call('upsert-account', {
    accountId: 'a',
    valuationMode: 'cash_plus_holdings',
    clearIcon: true,
    creditLimit: 0,
  })
  expect(repeat.changed).toBe(false)
  expect(snapshot()).toEqual(before)
})
