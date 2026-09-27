// @vitest-environment node
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runHostedTestMigrations } from './backend-foundation-test-schema.js'

const state = vi.hoisted(() => ({ db: null as unknown as Database.Database }))
vi.mock('./database.js', () => ({
  query: (sql: string, params: unknown[] = []) =>
    state.db.prepare(sql.replace(/\$\d+/g, '?')).all(...params),
  execute: (sql: string, params: unknown[] = []) => ({
    rowsAffected: state.db.prepare(sql.replace(/\$\d+/g, '?')).run(...params).changes,
  }),
  transaction: (fn: () => unknown) => state.db.transaction(fn).immediate(),
}))
vi.mock('@/lib/database', () => {
  const query = async (sql: string, params: unknown[] = []) => state.db.prepare(sql).all(...params)
  const execute = async (sql: string, params: unknown[] = []) => {
    const result = state.db.prepare(sql).run(...params)
    return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) }
  }
  return {
    query,
    execute,
    withTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
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
  }
})
import type { ScopedReportResult } from '@shikin/finance-core'
import { budgetsandnetworthTools } from './tools/budgets-and-net-worth.js'
import { transactionsTools } from './tools/transactions.js'
// @ts-expect-error CLI tsconfig has no '@' alias; Vitest root config resolves this import.
import { projectBudget, readScopedReport, readScopedSnapshot } from '@/lib/scoped-report-read'

const tools = [...transactionsTools, ...budgetsandnetworthTools]
const run = (name: string, input: Record<string, unknown> = {}) => {
  const tool = tools.find((item) => item.name === name)!
  return tool.execute(tool.schema.parse(input))
}
const context = { asOf: '2026-01-20', timeZone: 'America/Mexico_City' }
function snapshot() {
  const tables = state.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all() as { name: string }[]
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      state.db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all(),
    ])
  )
}
function cents(major: number | null) {
  return major === null ? null : major * 100
}
function windowInput(request: Record<string, unknown>) {
  return {
    period: request.period as 'week' | 'month' | 'year' | 'custom' | undefined,
    asOf: request.asOf as string | undefined,
    timeZone: request.timeZone as string | undefined,
    start: request.start as string | undefined,
    end: request.end as string | undefined,
    through: request.through as 'as_of' | 'period_end' | undefined,
    weekStartsOn: request.weekStartsOn as number | undefined,
  }
}
async function actuals(input: Record<string, unknown> = {}) {
  const request: Record<string, unknown> = {
    currency: 'MXN',
    basis: 'gross_cashflow',
    groupBy: 'category',
    ...context,
    ...input,
  }
  const before = snapshot()
  const cli = await run('get-spending-summary', request)
  const frontend = await readScopedReport({
    scope: request.scope,
    currency: request.currency as string | undefined,
    basis: request.basis as 'gross_cashflow' | 'net_consumption' | 'recurring_estimate',
    groupBy: request.groupBy as 'category' | 'account' | 'month' | 'none',
    window: windowInput(request),
  })
  expect(snapshot()).toEqual(before)
  return { cli, frontend, before }
}
async function budgets(input: Record<string, unknown> = {}) {
  const request: Record<string, unknown> = { budgetId: 'plan', ...context, ...input }
  const before = snapshot()
  const cli = await run('get-budget-status', request)
  const snapshotRead = await readScopedSnapshot()
  const projected = projectBudget(
    snapshotRead,
    snapshotRead.budgets.find((row: { id: string }) => row.id === 'plan')!,
    windowInput(request)
  )
  expect(snapshot()).toEqual(before)
  return { cli, projected, before }
}
function expectActualParity(
  frontend: Awaited<ReturnType<typeof readScopedReport>>,
  cli: Awaited<ReturnType<typeof run>>
) {
  expect(frontend.result).toEqual(cli.report)
  expect(frontend.window).toEqual(cli.report.window)
  expect(frontend.window).toEqual(cli.window)
}
function expectBudgetParity(
  projected: ReturnType<typeof projectBudget>,
  cli: Awaited<ReturnType<typeof run>>
) {
  const row = cli.budgets[0]
  expect(projected.currency).toBe(row.currency)
  expect(projected.complete).toBe(row.complete)
  expect(projected.spent).toBe(cents(row.spentAmount))
  expect(projected.remaining).toBe(cents(row.remaining))
  expect(projected.percentUsed).toBe(row.percentUsed)
  expect(projected.result.window).toEqual(row.window)
  expect(projected.result).toEqual(row.spending)
}
function expectEstimateParity(
  frontend: Awaited<ReturnType<typeof readScopedReport>>,
  cli: Awaited<ReturnType<typeof run>>
) {
  expect(frontend.result.basis).toBe('recurring_estimate')
  if (frontend.result.basis !== 'recurring_estimate') return
  expect(frontend.result.recurringRules).toEqual(cli.recurringRules)
  expect(frontend.result.subscriptions).toEqual(cli.subscriptions)
  expect(frontend.result.combinedMonthlyCentavos).toBeNull()
  expect(cli.combinedMonthlyCentavos).toBeNull()
  expect(frontend.result.combinedYearlyCentavos).toBeNull()
  expect(cli.combinedYearlyCentavos).toBeNull()
  expect(frontend.result.combinedComplete).toBe(false)
  expect(cli.combinedComplete).toBe(false)
  expect(frontend.result.combinedReason).toBe(cli.combinedReason)
  expect(frontend.result.asOf).toBe(cli.asOf)
  expect(frontend.result.currency).toBe(cli.currency)
  expect(frontend.result.scope).toEqual(cli.scope)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-01-20T18:00:00Z'))
  state.db = new Database(':memory:')
  state.db.pragma('foreign_keys = ON')
  runHostedTestMigrations(state.db)
  state.db.exec(`
    INSERT OR REPLACE INTO settings (key, value) VALUES ('main_currency', 'MXN');
    INSERT INTO accounts (id, name, type, currency, account_mode)
      VALUES ('bank', 'Bank', 'checking', 'MXN', 'transactional');
    INSERT INTO categories (id, name, type)
      VALUES ('food', 'Food', 'expense'), ('pet', 'Pet', 'expense'), ('other', 'Other', 'expense');
    INSERT INTO transactions (id, account_id, category_id, type, amount, currency, date, description, tags)
      VALUES ('expense', 'bank', 'food', 'expense', 25000, 'MXN', '2026-01-10', 'Food',
        '["business",{"label":" Business "}]');
    INSERT INTO budgets (id, name, category_id, amount, currency, period)
      VALUES ('plan', 'Food plan', 'food', 100000, 'MXN', 'monthly');
  `)
})
afterEach(() => {
  state.db.close()
  vi.useRealTimers()
})

describe('scoped CLI/frontend adapter parity', () => {
  it('projects the same MXN 250/750 actuals and stored budget remaining without writes', async () => {
    const omitted = await actuals({ currency: undefined })
    expectActualParity(omitted.frontend, omitted.cli)
    expect(omitted.frontend.result).toMatchObject({
      complete: true,
      currency: 'MXN',
      budgetUsage: { complete: true, amountCentavos: 25000, knownAmountCentavos: 25000 },
    })
    const explicit = await actuals()
    expectActualParity(explicit.frontend, explicit.cli)
    expect(explicit.frontend.result).toEqual(omitted.frontend.result)
    const status = await budgets()
    expectBudgetParity(status.projected, status.cli)
    expect(status.projected).toMatchObject({
      currency: 'MXN',
      complete: true,
      spent: 25000,
      remaining: 75000,
      percentUsed: 25,
    })
    expect(status.cli.budgets[0]).toMatchObject({
      currency: 'MXN',
      spentAmount: 250,
      remaining: 750,
      complete: true,
    })
  })

  it('applies account/category/tag duplicates and exclusions without inflating totals', async () => {
    state.db.exec(
      "INSERT INTO transaction_splits (id, transaction_id, category_id, amount) VALUES ('food-split', 'expense', 'food', 15000), ('pet-split', 'expense', 'pet', 10000)"
    )
    const food = await actuals({
      scope: {
        accountIds: ['bank', 'bank'],
        categoryIds: ['food', 'food'],
        tags: ['BUSINESS', 'business', ' Business '],
      },
    })
    expectActualParity(food.frontend, food.cli)
    expect(food.frontend.result).toMatchObject({
      budgetUsage: { amountCentavos: 15000 },
      transactionIds: ['expense'],
    })
    const union = await actuals({ scope: { categoryIds: ['food', 'pet', 'food'] } })
    expectActualParity(union.frontend, union.cli)
    expect(union.frontend.result.budgetUsage.amountCentavos).toBe(25000)
    const excluded = await actuals({
      scope: { tags: ['business'], excludeTags: ['business'], accountIds: ['bank'] },
    })
    expectActualParity(excluded.frontend, excluded.cli)
    expect(excluded.frontend.result.budgetUsage.amountCentavos).toBe(0)
    const noAccount = await actuals({ scope: { excludeAccountIds: ['bank'] } })
    expectActualParity(noAccount.frontend, noAccount.cli)
    expect(noAccount.frontend.result.budgetUsage.amountCentavos).toBe(0)
  })

  it('apportions 60/40 splits from the once-converted parent and ignores inverse or future rates', async () => {
    state.db.exec(`
      INSERT INTO accounts (id, name, type, currency, account_mode)
        VALUES ('usd', 'USD Bank', 'checking', 'USD', 'transactional');
      INSERT INTO transactions (id, account_id, category_id, type, amount, currency, date, description)
        VALUES ('split', 'usd', 'food', 'expense', 10000, 'USD', '2026-01-10', 'Split');
      INSERT INTO transaction_splits (id, transaction_id, category_id, amount)
        VALUES ('food-60', 'split', 'food', 6000), ('pet-40', 'split', 'pet', 4000);
      INSERT INTO manual_exchange_rates
        (id, from_currency, to_currency, rate_decimal, effective_from, supersedes_rate_id, created_at, source_note)
        VALUES ('usd-mxn', 'USD', 'MXN', '1.5', '2026-01-01', NULL, '2026-01-01T00:00:00Z', NULL);
    `)
    const converted = await actuals({ scope: { categoryIds: ['food', 'pet'] } })
    expectActualParity(converted.frontend, converted.cli)
    const result = converted.frontend.result
    if (result.basis === 'recurring_estimate') return
    const food = result.allocations.find(
      (row: ScopedReportResult['allocations'][number]) => row.allocationId === 'food-60'
    )
    const pet = result.allocations.find(
      (row: ScopedReportResult['allocations'][number]) => row.allocationId === 'pet-40'
    )
    const parent = result.conversions.find(
      (row: ScopedReportResult['conversions'][number]) => row.id === 'split'
    )
    expect(food?.amountCentavos).toBe(9000)
    expect(pet?.amountCentavos).toBe(6000)
    expect((food?.amountCentavos ?? 0) + (pet?.amountCentavos ?? 0)).toBe(
      parent?.conversion?.amountCentavos
    )
    state.db.exec(`
      INSERT INTO transactions (id, account_id, category_id, type, amount, currency, date, description)
        VALUES ('eur', 'usd', 'food', 'expense', 10000, 'EUR', '2026-01-10', 'Euro');
      INSERT INTO manual_exchange_rates
        (id, from_currency, to_currency, rate_decimal, effective_from, supersedes_rate_id, created_at, source_note)
        VALUES
          ('inverse', 'MXN', 'EUR', '0.05', '2026-01-01', NULL, '2026-01-01T00:00:00Z', NULL),
          ('future', 'EUR', 'MXN', '99', '2026-02-01', NULL, '2026-01-01T00:00:00Z', NULL);
    `)
    const missing = await actuals({ scope: { categoryIds: ['food', 'pet'] } })
    expectActualParity(missing.frontend, missing.cli)
    if (missing.frontend.result.basis === 'recurring_estimate') return
    expect(missing.frontend.result.complete).toBe(false)
    expect(missing.frontend.result.totals.expenseCentavos).toBeNull()
    expect(missing.frontend.result.known.expenseCentavos).toBe(40000)
  })

  it('keeps NET refund recognition, out-of-window purchases, and incomplete classification or coverage', async () => {
    state.db.exec(`
      UPDATE transactions SET date = '2025-12-10' WHERE id = 'expense';
      INSERT INTO transactions (id, account_id, category_id, type, amount, currency, date, description, tags)
        VALUES ('refund', 'bank', 'other', 'income', 5000, 'MXN', '2026-01-15', 'Refund', '["business"]');
      INSERT INTO transaction_consumption_classifications (id, transaction_id, role)
        VALUES ('purchase', 'expense', 'purchase');
      INSERT INTO transaction_consumption_classifications (id, transaction_id, role, referenced_purchase_id)
        VALUES ('return', 'refund', 'refund', 'purchase');
      INSERT INTO source_coverage (id, account_id, source_namespace, period_start, period_end, status)
        VALUES ('coverage', 'bank', 'statement', '2026-01-01', '2026-01-31', 'verified');
    `)
    const covered = await actuals({
      basis: 'net_consumption',
      scope: { categoryIds: ['food'], tags: ['business'] },
    })
    expectActualParity(covered.frontend, covered.cli)
    if (covered.frontend.result.basis === 'recurring_estimate') return
    expect(covered.frontend.result).toMatchObject({
      complete: true,
      totals: { consumptionCentavos: -5000, earnedIncomeCentavos: 0 },
      allocations: [
        { transactionId: 'refund', categoryId: 'food', referencedPurchaseId: 'purchase' },
      ],
    })
    state.db.exec('DELETE FROM source_coverage')
    const uncovered = await actuals({
      basis: 'net_consumption',
      scope: { categoryIds: ['food'], tags: ['business'] },
    })
    expectActualParity(uncovered.frontend, uncovered.cli)
    if (uncovered.frontend.result.basis === 'recurring_estimate') return
    expect(uncovered.frontend.result.totals.consumptionCentavos).toBeNull()
    expect(uncovered.frontend.result.known.consumptionCentavos).toBe(-5000)
    expect(uncovered.frontend.result.coverage.complete).toBe(false)
    state.db.exec(`
      DELETE FROM transaction_consumption_classifications WHERE id = 'return';
      DELETE FROM transaction_consumption_classifications WHERE id = 'purchase';
      INSERT INTO source_coverage (id, account_id, source_namespace, period_start, period_end, status)
        VALUES ('coverage', 'bank', 'statement', '2026-01-01', '2026-01-31', 'verified');
    `)
    const unclassified = await actuals({ basis: 'net_consumption' })
    expectActualParity(unclassified.frontend, unclassified.cli)
    if (unclassified.frontend.result.basis === 'recurring_estimate') return
    expect(unclassified.frontend.result.complete).toBe(false)
    expect(unclassified.frontend.result.totals.consumptionCentavos).toBeNull()
    expect(unclassified.frontend.result.classificationComplete).toBe(false)
  })

  it('excludes a confirmed full ordinary repayment and withholds a partial parent as ambiguous', async () => {
    state.db.exec(`
      INSERT INTO accounts (id, name, type, currency) VALUES ('card', 'Card', 'credit_card', 'MXN');
      INSERT INTO credit_card_statements (id, account_id, statement_end_date, due_date, statement_balance, currency)
        VALUES ('statement', 'card', '2026-01-15', '2026-01-25', 25000, 'MXN');
      INSERT INTO card_statement_payment_links
        (id, statement_id, transaction_id, original_statement_id, original_transaction_id, amount, mode)
        VALUES ('link', 'statement', 'expense', 'statement', 'expense', 25000, 'apply_to_unpaid');
    `)
    const full = await actuals()
    expectActualParity(full.frontend, full.cli)
    if (full.frontend.result.basis === 'recurring_estimate') return
    expect(full.frontend.result.budgetUsage.amountCentavos).toBe(0)
    expect(full.frontend.result.repayments).toEqual([
      { transactionId: 'expense', linkIds: ['link'], status: 'excluded_full_parent' },
    ])
    const status = await budgets()
    expectBudgetParity(status.projected, status.cli)
    expect(status.projected.spent).toBe(0)
    state.db.exec('UPDATE card_statement_payment_links SET amount = 10000')
    const partial = await actuals()
    expectActualParity(partial.frontend, partial.cli)
    if (partial.frontend.result.basis === 'recurring_estimate') return
    expect(partial.frontend.result.budgetUsage).toMatchObject({
      complete: false,
      amountCentavos: null,
    })
    expect(partial.frontend.result.repayments[0]?.status).toBe('ambiguous')
  })

  it('keeps unknown and deleted category IDs in scope instead of widening to all categories', async () => {
    const missing = await actuals({ scope: { accountIds: ['missing'], categoryIds: ['gone'] } })
    expectActualParity(missing.frontend, missing.cli)
    if (missing.frontend.result.basis === 'recurring_estimate') return
    expect(missing.frontend.result.complete).toBe(false)
    expect(
      missing.frontend.result.issues
        .map((issue: ScopedReportResult['issues'][number]) => issue.code)
        .sort()
    ).toEqual(['missing_account', 'missing_category'])
    state.db.exec("DELETE FROM categories WHERE id = 'food'")
    const deleted = await budgets()
    expectBudgetParity(deleted.projected, deleted.cli)
    expect(deleted.projected.complete).toBe(false)
    expect(deleted.projected.spent).toBeNull()
    expect(deleted.projected.result.scope?.categoryIds).toEqual(['food'])
    expect(deleted.projected.result.issues[0]?.code).toBe('missing_category')
  })

  it('returns identical week, year, leap, future, and cross-period window metadata', async () => {
    const week = await actuals({
      period: 'week',
      asOf: '2026-01-01',
      timeZone: 'UTC',
    })
    expectActualParity(week.frontend, week.cli)
    expect(week.frontend.window).toMatchObject({
      period: 'week',
      start: '2025-12-28',
      end: '2026-01-01',
      periodEnd: '2026-01-03',
      weekStartsOn: 0,
      timeZone: 'UTC',
    })
    const monday = await actuals({
      period: 'week',
      asOf: '2026-01-01',
      timeZone: 'UTC',
      weekStartsOn: 1,
      through: 'period_end',
    })
    expectActualParity(monday.frontend, monday.cli)
    expect(monday.frontend.window).toMatchObject({ start: '2025-12-29', end: '2026-01-04' })
    const year = await actuals({
      period: 'year',
      asOf: '2026-02-01',
      timeZone: 'UTC',
      through: 'period_end',
    })
    expectActualParity(year.frontend, year.cli)
    expect(year.frontend.window).toMatchObject({ start: '2026-01-01', end: '2026-12-31' })
    const leap = await actuals({
      period: 'month',
      asOf: '2024-02-29',
      timeZone: 'UTC',
      through: 'period_end',
    })
    expectActualParity(leap.frontend, leap.cli)
    expect(leap.frontend.window).toMatchObject({
      start: '2024-02-01',
      end: '2024-02-29',
      periodEnd: '2024-02-29',
    })
    state.db.exec("UPDATE transactions SET date = '2026-01-30'")
    const capped = await budgets()
    expectBudgetParity(capped.projected, capped.cli)
    expect(capped.projected.spent).toBe(0)
    const included = await budgets({ through: 'period_end' })
    expectBudgetParity(included.projected, included.cli)
    expect(included.projected.spent).toBe(25000)
    const cross = await budgets({
      start: '2025-12-01',
      end: '2026-01-31',
      through: 'period_end',
    })
    expectBudgetParity(cross.projected, cross.cli)
    expect(cross.projected).toMatchObject({ spent: 25000, remaining: null, percentUsed: null })
    expect(cross.projected.result.window).toMatchObject({
      period: 'custom',
      start: '2025-12-01',
      end: '2026-01-31',
      requested: { start: '2025-12-01', end: '2026-01-31' },
    })
  })

  it('separates persisted recurring sources, rejects tagged subscriptions, and never materializes', async () => {
    state.db.exec(`
      INSERT INTO recurring_rules
        (id, description, amount, currency, type, frequency, next_date, account_id, category_id, tags, active)
        VALUES
          ('rule', 'Rule', 1000, 'MXN', 'expense', 'monthly', '2026-02-01', 'bank', 'food', '["business"]', 1),
          ('inactive', 'Inactive', 9999, 'MXN', 'expense', 'monthly', '2026-02-01', 'bank', 'food', '[]', 0);
      INSERT INTO subscriptions (id, name, amount, currency, billing_cycle, next_billing_date, account_id, category_id)
        VALUES ('subscription', 'Subscription', 2000, 'MXN', 'monthly', '2026-02-01', 'bank', 'food');
    `)
    const before = snapshot()
    const request = { basis: 'recurring_estimate' as const, currency: 'MXN', ...context }
    const cli = await run('get-spending-summary', request)
    const frontend = await readScopedReport({
      basis: 'recurring_estimate',
      currency: 'MXN',
      window: context,
    })
    expect(snapshot()).toEqual(before)
    expectEstimateParity(frontend, cli)
    if (frontend.result.basis !== 'recurring_estimate') return
    expect(frontend.result.recurringRules.monthlyCentavos).toBe(1000)
    expect(frontend.result.subscriptions.monthlyCentavos).toBe(2000)
    const taggedCli = await run('get-spending-summary', {
      ...request,
      scope: { tags: ['business'] },
    })
    const taggedFrontend = await readScopedReport({
      basis: 'recurring_estimate',
      currency: 'MXN',
      scope: { tags: ['business'] },
      window: context,
    })
    expect(snapshot()).toEqual(before)
    expectEstimateParity(taggedFrontend, taggedCli)
    if (taggedFrontend.result.basis !== 'recurring_estimate') return
    expect(taggedFrontend.result.subscriptions).toMatchObject({
      complete: false,
      monthlyCentavos: null,
    })
    expect(taggedFrontend.result.recurringRules.monthlyCentavos).toBe(1000)
  })
})
