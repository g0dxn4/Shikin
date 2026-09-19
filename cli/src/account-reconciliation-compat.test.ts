// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const holder = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    holder.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: holder.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => holder.db.transaction(fn).immediate(),
}))
import { accountsTools } from './tools/accounts.js'

const call = (name: string, input: Record<string, unknown>) => {
  const tool = accountsTools.find((candidate) => candidate.name === name)!
  return tool.execute(tool.schema.parse(input))
}

beforeEach(() => {
  holder.db = new Database(':memory:')
  holder.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(holder.db)
  holder.db
    .prepare(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, account_mode, valuation_mode)
       VALUES ('acct-1', 'Primary', 'checking', 'USD', 110225, 0, 'transactional', 'cash_plus_holdings')`
    )
    .run()
})
afterEach(() => holder.db.close())

describe('reconcile/finalize public response compatibility', () => {
  it('keeps applyRequired, confirmation, message, accountMode, and statementCoverage on preview', async () => {
    const preview = await call('reconcile', {
      accountId: 'acct-1',
      actualBalance: 1102.25,
      statementStartDate: '2026-05-01',
      statementEndDate: '2026-05-31',
    })
    expect(preview).toMatchObject({
      success: true,
      dryRun: true,
      applied: false,
      applyRequired: true,
      requiresConfirmation: true,
      requiredBasis: 'effective_ledger',
      storedBalanceCentavos: 110225,
      ledgerBalanceCentavos: 0,
      differenceCentavos: 110225,
      account: { id: 'acct-1', name: 'Primary', currency: 'USD', accountMode: 'transactional' },
      statementCoverage: { startDate: '2026-05-01', endDate: '2026-05-31' },
    })
    expect(String(preview.message)).toMatch(/as-of reconciliation change/)
    expect(String(preview.message)).toMatch(/Later activity is retained|keep later activity/)
  })

  it('returns structured reconciliation_basis_required without writing', async () => {
    const before = holder.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()
    const result = await call('reconcile', {
      accountId: 'acct-1',
      actualBalance: 1102.25,
      apply: true,
    })
    expect(result).toMatchObject({
      success: false,
      reason: 'reconciliation_basis_required',
      requiredBasis: 'effective_ledger',
    })
    expect(holder.db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual(before)
    expect(holder.db.prepare('SELECT COUNT(*) AS count FROM transactions').get()).toEqual({
      count: 0,
    })
  })

  it('keeps applyRequired on staged finalization preview', async () => {
    holder.db
      .prepare(
        `INSERT INTO transactions (
           id, account_id, type, amount, currency, description, date, status,
           ledger_treatment, reporting_treatment, staging_batch_id, import_source, is_archived
         ) VALUES ('staged-1', 'acct-1', 'expense', 10000, 'USD', 'Purchase', '2026-05-05', 'posted',
           'staged_no_balance_impact', 'normal', 'statement-2026-05', 'statement-import', 0)`
      )
      .run()
    holder.db
      .prepare(
        `INSERT INTO source_coverage (
           id, account_id, source_namespace, period_start, period_end, status, zero_rows, document_ref
         ) VALUES ('cov-1', 'acct-1', 'statement-import', '2026-05-01', '2026-05-31', 'verified', 0, 'stmt')`
      )
      .run()
    const preview = await call('finalize-staged-statement-history', {
      accountId: 'acct-1',
      stagingBatchId: 'statement-2026-05',
      statementStartDate: '2026-05-01',
      statementEndDate: '2026-05-31',
      actualBalance: 1102.25,
      coverageIds: ['cov-1'],
    })
    expect(preview).toMatchObject({
      success: true,
      dryRun: true,
      applyRequired: true,
      transactionCount: 1,
    })
    expect(typeof preview.reconciliationBridgeCentavos).toBe('number')
  })
})
