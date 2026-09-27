import {
  projectScopedReport,
  projectScopedRecurringEstimate,
  resolveBudgetScope,
  resolveReportWindow,
  type ScopedReportDataset,
  type ScopedEstimateDataset,
  type ReportWindowInput,
  type ReportWindow,
  type ScopedActualBasis,
  type ScopedReportGroupBy,
  type ScopedReportResult,
} from '@shikin/finance-core'
import { query, transaction } from './database.js'
import { listExchangeRates } from './fx-service.js'
import { readConsumptionEvidence } from './transaction-corrections.js'

/** Call within the caller's synchronous snapshot transaction. Do not narrow evidence before validation. */
export function loadScopedDataset(): ScopedReportDataset {
  const evidence = readConsumptionEvidence()
  return {
    ...evidence,
    accounts: query<ScopedReportDataset['accounts'][number]>('SELECT * FROM accounts'),
    categories: query<{ id: string; name: string }>('SELECT id, name FROM categories'),
    transactions: evidence.transactions as ScopedReportDataset['transactions'],
    coverage: query<ScopedReportDataset['coverage'][number]>('SELECT * FROM source_coverage'),
    rates: listExchangeRates(),
    activePaymentLinks: query<ScopedReportDataset['activePaymentLinks'][number]>(
      `SELECT l.*, s.account_id AS cardAccountId FROM card_statement_payment_links l
       JOIN credit_card_statements s ON s.id = l.statement_id WHERE l.voided_at IS NULL`
    ),
  }
}

export function loadScopedEstimates(dataset: ScopedReportDataset): ScopedEstimateDataset {
  return {
    accounts: dataset.accounts,
    categories: dataset.categories,
    rates: dataset.rates,
    recurringRules: query<ScopedEstimateDataset['recurringRules'][number]>(
      'SELECT *, active AS is_active FROM recurring_rules'
    ),
    subscriptions: query<ScopedEstimateDataset['subscriptions'][number]>(
      'SELECT * FROM subscriptions'
    ),
  }
}

export function storedBudgetScope(row: { scope_json: string | null; category_id: string | null }) {
  let storedScope: unknown
  try {
    storedScope = row.scope_json === null ? undefined : JSON.parse(row.scope_json)
  } catch {
    storedScope = row.scope_json // malformed input is never replaced with an unrestricted scope
  }
  return resolveBudgetScope({ storedScope, storedCategoryId: row.category_id }).scope
}

export function scopedActual(input: {
  dataset: ScopedReportDataset
  scope: unknown
  currency: string
  basis: ScopedActualBasis
  groupBy?: ScopedReportGroupBy
  window: ReportWindowInput | ReportWindow
}) {
  return projectScopedReport({
    dataset: input.dataset,
    scope: input.scope,
    currency: input.currency,
    basis: input.basis,
    groupBy: input.groupBy,
    window: 'requested' in input.window ? input.window : resolveReportWindow(input.window),
  })
}

// Legacy dated-read conversion entries are flat; null core evidence must remain incomplete.
export function flatDatedConversions(entries: ScopedReportResult['conversions']) {
  return entries.map(({ id, conversion }) =>
    conversion
      ? { id, ...conversion }
      : {
          id,
          complete: false as const,
          amountCentavos: null,
          missingReason: 'invalid_conversion_evidence' as const,
        }
  )
}

export function scopedEstimate(input: {
  dataset: ScopedReportDataset
  scope: unknown
  currency: string
  groupBy?: ScopedReportGroupBy
  asOf: string
}) {
  return projectScopedRecurringEstimate({
    dataset: loadScopedEstimates(input.dataset),
    scope: input.scope,
    currency: input.currency,
    groupBy: input.groupBy,
    asOf: input.asOf,
  })
}

/** Bounded preview; the descriptor is accepted verbatim by query-transactions. */
export function contributorInspection(result: ReturnType<typeof scopedActual>, descriptor: object) {
  return {
    contributorPreview: result.contributors.slice(0, 20),
    contributorCount: result.transactionIds.length,
    contributorQuery: { ...descriptor, limit: 20 },
  }
}

export { transaction }
