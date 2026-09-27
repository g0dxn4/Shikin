import {
  FX_RATE_SELECT,
  resolveBudgetScope,
  resolveReportWindow,
  projectScopedReport,
  projectScopedRecurringEstimate,
  budgetWindowComparability,
  sumScopedCentavos,
  type ScopedReportDataset,
  type ScopedEstimateDataset,
  type ReportWindowInput,
  type ScopedActualBasis,
  type ScopedReportGroupBy,
} from '@shikin/finance-core'
import { withTransaction, type TransactionClient } from '@/lib/database'
import type { Budget } from '@/types/database'

export interface ScopedReferences {
  accounts: Array<ScopedReportDataset['accounts'][number] & { name: string }>
  categories: Array<{ id: string; name: string; color: string | null }>
}
export interface ScopedSnapshot extends ScopedReferences {
  dataset: ScopedReportDataset
  estimates: ScopedEstimateDataset
  budgets: Budget[]
  mainCurrency: string | null
}

/** One coherent snapshot. Never narrow reference, refund or repayment capacity evidence. */
export async function loadScopedSnapshot(tx: TransactionClient): Promise<ScopedSnapshot> {
  const [
    accounts,
    categories,
    transactions,
    splits,
    classifications,
    typeRevisions,
    coverage,
    rates,
    activePaymentLinks,
    recurringRules,
    subscriptions,
    budgets,
    settings,
  ] = await Promise.all([
    tx.query<ScopedReferences['accounts'][number]>('SELECT * FROM accounts'),
    tx.query<ScopedReferences['categories'][number]>('SELECT id, name, color FROM categories'),
    tx.query<ScopedReportDataset['transactions'][number]>('SELECT * FROM transactions'),
    tx.query<ScopedReportDataset['splits'][number]>('SELECT * FROM transaction_splits'),
    tx.query<ScopedReportDataset['classifications'][number]>(
      'SELECT * FROM transaction_consumption_classifications'
    ),
    tx.query<NonNullable<ScopedReportDataset['typeRevisions']>[number]>(
      'SELECT * FROM classification_type_revisions'
    ),
    tx.query<ScopedReportDataset['coverage'][number]>('SELECT * FROM source_coverage'),
    tx.query<ScopedReportDataset['rates'][number]>(FX_RATE_SELECT),
    tx.query<ScopedReportDataset['activePaymentLinks'][number]>(
      `SELECT l.*, COALESCE(s.account_id, '') AS cardAccountId FROM card_statement_payment_links l LEFT JOIN credit_card_statements s ON s.id = l.statement_id WHERE l.voided_at IS NULL`
    ),
    tx.query<ScopedEstimateDataset['recurringRules'][number]>(
      'SELECT *, active AS is_active FROM recurring_rules'
    ),
    tx.query<ScopedEstimateDataset['subscriptions'][number]>('SELECT * FROM subscriptions'),
    tx.query<Budget>('SELECT * FROM budgets ORDER BY created_at DESC, id'),
    tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'"),
  ])
  const mainCurrency = settings[0]?.value.trim().toUpperCase() || null
  return {
    accounts,
    categories,
    budgets,
    mainCurrency,
    dataset: {
      accounts,
      categories,
      transactions,
      splits,
      classifications,
      typeRevisions,
      coverage,
      rates,
      activePaymentLinks,
    },
    estimates: { accounts, categories, rates, recurringRules, subscriptions },
  }
}
export function readScopedSnapshot() {
  return withTransaction(loadScopedSnapshot)
}

/** Malformed stored JSON stays malformed: it must never become unrestricted. */
export function storedBudgetScope(budget: Budget): unknown {
  try {
    return resolveBudgetScope({
      storedScope: JSON.parse(budget.scope_json ?? '{}'),
      storedCategoryId: budget.category_id,
    }).scope
  } catch {
    return budget.scope_json ?? 'invalid stored scope'
  }
}
export function projectBudget(
  snapshot: ScopedSnapshot,
  budget: Budget,
  input: ReportWindowInput = {}
) {
  if (!budget.currency) throw new Error(`Budget ${budget.id} has no durable currency`)
  if (!Number.isSafeInteger(budget.amount) || budget.amount <= 0)
    throw new Error(`Budget ${budget.id} has an invalid limit`)
  const window = resolveReportWindow({
    period: ({ weekly: 'week', monthly: 'month', yearly: 'year' } as const)[budget.period],
    ...input,
  })
  const result = projectScopedReport({
    dataset: snapshot.dataset,
    scope: storedBudgetScope(budget),
    window,
    currency: budget.currency,
    basis: budget.basis ?? 'gross_cashflow',
  })
  const comparison = budgetWindowComparability(window, budget.period)
  const spent = result.budgetUsage.amountCentavos
  return {
    ...budget,
    currency: budget.currency,
    categoryName:
      snapshot.categories.find((c) => c.id === budget.category_id)?.name ??
      budget.category_id ??
      '',
    categoryColor:
      snapshot.categories.find((c) => c.id === budget.category_id)?.color ??
      'var(--muted-foreground)',
    result,
    comparison,
    limitCentavos: comparison.limitComparable ? budget.amount : null,
    complete: result.budgetUsage.complete,
    spent,
    knownSpent: result.budgetUsage.knownAmountCentavos,
    remaining:
      comparison.limitComparable && spent !== null
        ? sumScopedCentavos([budget.amount, -spent])
        : null,
    percentUsed:
      comparison.limitComparable && spent !== null && budget.amount > 0
        ? Math.round((spent / budget.amount) * 100)
        : null,
  }
}
export interface ScopedReadInput {
  scope?: unknown
  currency?: string
  basis: ScopedActualBasis | 'recurring_estimate'
  groupBy?: ScopedReportGroupBy
  window?: ReportWindowInput
}
export async function readScopedReport(input: ScopedReadInput) {
  return withTransaction(async (tx) => {
    const snapshot = await loadScopedSnapshot(tx)
    const currency = input.currency || snapshot.mainCurrency
    if (!currency)
      throw new Error('Configure a database main currency or choose an explicit report currency.')
    const window = resolveReportWindow(input.window)
    const result =
      input.basis === 'recurring_estimate'
        ? projectScopedRecurringEstimate({
            dataset: snapshot.estimates,
            scope: input.scope,
            currency,
            asOf: window.asOf,
            groupBy: input.groupBy,
          })
        : projectScopedReport({
            dataset: snapshot.dataset,
            scope: input.scope,
            currency,
            window,
            basis: input.basis,
            groupBy: input.groupBy,
          })
    return {
      result,
      window,
      accounts: snapshot.accounts,
      categories: snapshot.categories,
      mainCurrency: snapshot.mainCurrency,
    }
  })
}
export type ScopedRead = Awaited<ReturnType<typeof readScopedReport>>
