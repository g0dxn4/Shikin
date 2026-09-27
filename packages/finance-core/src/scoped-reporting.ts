import { classificationContribution, type ConsumptionRole } from './classification-policy.js'
import {
  consumptionCoverage,
  type ConsumptionEvidence,
  type ConsumptionCoverageRow,
  type CorrectionTransaction,
  type ConsumptionAllocationSelection,
} from './corrections.js'
import { projectDatedNetConsumption } from './dated-consumption.js'
import {
  apportionConvertedAmount,
  assertFxCurrency,
  assertFxDate,
  convertCentavosAsOf,
  type DatedConversion,
  type DatedExchangeRate,
} from './fx.js'
import {
  assertPaymentLinkCapacity,
  resolvePaymentEvidence,
  type ActivePaymentLink,
  type PaymentAccount,
} from './payments.js'
import { getCashFlowEligibility, type CashFlowCandidate } from './reporting.js'
import {
  inspectReportScope,
  matchesReportAccount,
  matchesReportCategory,
  matchesReportTags,
  reportTagKeys,
} from './report-scope.js'
import type { ReportWindow } from './report-window.js'

export type ScopedActualBasis = 'gross_cashflow' | 'net_consumption'
export type ScopedReportGroupBy = 'category' | 'account' | 'month' | 'none'
export interface ScopedReportTransaction extends CorrectionTransaction {
  tags?: unknown
}
/** Only active links, joined to their statement's card account. An active persisted link is explicit confirmation (as in payment-links revalidation). */
export interface ScopedPaymentLink extends ActivePaymentLink {
  cardAccountId: string
}
export interface ScopedReportDataset extends ConsumptionEvidence {
  accounts: readonly PaymentAccount[]
  categories: readonly { id: string }[]
  transactions: readonly ScopedReportTransaction[]
  coverage: readonly ConsumptionCoverageRow[]
  rates: readonly DatedExchangeRate[]
  activePaymentLinks: readonly ScopedPaymentLink[]
}
export type ScopedReportIssueCode =
  | 'malformed_scope'
  | 'missing_account'
  | 'missing_category'
  | 'invalid_tags'
  | 'invalid_allocation'
  | 'invalid_transaction'
  | 'classification'
  | 'coverage'
  | 'fx'
  | 'ambiguous_repayment'
export interface ScopedReportIssue {
  code: ScopedReportIssueCode
  id: string | null
  message: string
}
export interface ScopedReportAmounts {
  expenseCentavos: number | null
  incomeCentavos: number | null
  consumptionCentavos: number | null
  earnedIncomeCentavos: number | null
  otherIncomeCentavos: number | null
  principalRecoveryCentavos: number | null
  assetAcquisitionCentavos: number | null
}
export interface ScopedReportAllocation {
  transactionId: string
  allocationId: string
  accountId: string | null
  categoryId: string | null
  date: string
  currency: string
  nativeAmountCentavos: number
  amountCentavos: number | null
  nativeAmounts: ScopedReportAmounts
  amounts: ScopedReportAmounts
  classificationId: string | null
  typeRevisionId: string | null
  role: ConsumptionRole | null
  referencedPurchaseId: string | null
}
const fields = [
  'expenseCentavos',
  'incomeCentavos',
  'consumptionCentavos',
  'earnedIncomeCentavos',
  'otherIncomeCentavos',
  'principalRecoveryCentavos',
  'assetAcquisitionCentavos',
] as const
function emptyAmounts(): ScopedReportAmounts {
  return {
    expenseCentavos: null,
    incomeCentavos: null,
    consumptionCentavos: null,
    earnedIncomeCentavos: null,
    otherIncomeCentavos: null,
    principalRecoveryCentavos: null,
    assetAcquisitionCentavos: null,
  }
}
function grossAmounts(type: string, amount: number | null): ScopedReportAmounts {
  return {
    ...emptyAmounts(),
    expenseCentavos: type === 'expense' ? amount : 0,
    incomeCentavos: type === 'income' ? amount : 0,
  }
}
export function sumScopedCentavos(values: readonly number[]): number {
  const total = values.reduce((sum, value) => {
    if (!Number.isSafeInteger(value))
      throw new RangeError('Reporting requires safe integer centavos.')
    return sum + BigInt(value)
  }, 0n)
  const result = Number(total)
  if (!Number.isSafeInteger(result))
    throw new RangeError('Reporting total exceeds safe integer centavos.')
  return result
}
function totals(
  rows: readonly ScopedReportAmounts[],
  basis: ScopedActualBasis
): ScopedReportAmounts {
  const result = emptyAmounts()
  for (const field of fields) {
    if (
      (basis === 'gross_cashflow') !==
      (field === 'expenseCentavos' || field === 'incomeCentavos')
    )
      continue
    result[field] = sumScopedCentavos(
      rows.flatMap((row) => (row[field] === null ? [] : [row[field]]))
    )
  }
  return result
}
function eligibility(row: CorrectionTransaction) {
  return getCashFlowEligibility({
    type: row.type,
    status: row.status,
    ledgerTreatment: row.ledger_treatment,
    reportingTreatment: row.reporting_treatment,
    transactionKind: row.transaction_kind,
    isArchived: row.is_archived,
  } as CashFlowCandidate)
}

export interface ScopedReportInput {
  dataset: ScopedReportDataset
  /** Normalized scope is preferred; malformed stored values return explicit issues. */
  scope: unknown
  window: ReportWindow
  currency: string
  basis: ScopedActualBasis
  groupBy?: ScopedReportGroupBy
}

/** Pure read projection. Keep the complete captured evidence: never prefilter purchases or capacity peers. */
export function projectScopedReport(input: ScopedReportInput) {
  const { dataset, window, currency, basis } = input
  assertFxCurrency(currency)
  assertFxDate(window.start)
  assertFxDate(window.end)
  if (window.start > window.end) throw new Error('Window start must not follow end.')
  if (basis !== 'gross_cashflow' && basis !== 'net_consumption')
    throw new Error('Unsupported actual report basis.')
  const groupBy = input.groupBy ?? 'category'
  if (!['category', 'account', 'month', 'none'].includes(groupBy))
    throw new Error('Unsupported report grouping.')
  const inspected = inspectReportScope(input.scope, dataset)
  const issues: ScopedReportIssue[] = [...inspected.issues]
  const scope = inspected.scope
  const sourceIds = new Set<string>()
  const potentiallySelected = (row: CorrectionTransaction) => {
    if (!scope) return false
    if (basis === 'net_consumption' && row.type === 'income') return true
    const splits = dataset.splits.filter((split) => split.transaction_id === row.id)
    return splits.length
      ? splits.some((split) => matchesReportCategory(scope, split.category_id))
      : matchesReportCategory(scope, row.category_id ?? null)
  }
  for (const row of dataset.transactions) {
    if (!scope || !matchesReportAccount(scope, row.account_id ?? null)) continue
    const eligible = eligibility(row)
    if (!eligible.eligible && !eligible.reason.startsWith('invalid_')) continue
    try {
      assertFxDate(row.date ?? '')
    } catch {
      if (potentiallySelected(row))
        issues.push({
          code: 'invalid_transaction',
          id: row.id,
          message: 'Missing or invalid transaction date.',
        })
      continue
    }
    if (row.date! < window.start || row.date! > window.end) continue
    if (scope.tags.length || scope.excludeTags.length) {
      try {
        if (!matchesReportTags(scope, reportTagKeys(row.tags))) continue
      } catch (error) {
        if (potentiallySelected(row))
          issues.push({ code: 'invalid_tags', id: row.id, message: String(error) })
        continue
      }
    }
    if (!eligible.eligible) {
      if (potentiallySelected(row))
        issues.push({ code: 'invalid_transaction', id: row.id, message: eligible.reason })
      continue
    }
    sourceIds.add(row.id)
  }
  // Validate persisted active-link evidence, not descriptions or inferred transfers.
  const repaymentIds = new Set<string>()
  const repayments: {
    transactionId: string
    linkIds: string[]
    status: 'excluded_full_parent' | 'ambiguous'
  }[] = []
  const paymentEvidence = { ...dataset, activeLinks: dataset.activePaymentLinks }
  for (const row of dataset.transactions) {
    if (!sourceIds.has(row.id) || !potentiallySelected(row)) continue
    const links = dataset.activePaymentLinks.filter((link) => link.transaction_id === row.id)
    if (!links.length) continue
    repaymentIds.add(row.id)
    try {
      for (const link of links) {
        const resolved = resolvePaymentEvidence({
          transactionId: row.id,
          cardAccountId: link.cardAccountId,
          explicitRepaymentConfirmation: true,
          evidence: paymentEvidence,
        })
        const capacity = assertPaymentLinkCapacity({
          resolved,
          activeLinks: dataset.activePaymentLinks,
        })
        if (resolved.capacity !== row.amount || capacity.activeAmount !== row.amount)
          throw new Error('Partial or mixed repayment allocations cannot be attributed safely.')
      }
      repayments.push({
        transactionId: row.id,
        linkIds: links.map((link) => link.id).sort(),
        status: 'excluded_full_parent',
      })
    } catch (error) {
      repayments.push({
        transactionId: row.id,
        linkIds: links.map((link) => link.id).sort(),
        status: 'ambiguous',
      })
      issues.push({ code: 'ambiguous_repayment', id: row.id, message: String(error) })
    }
  }
  const selectAllocation: ConsumptionAllocationSelection = (context) => {
    const row = context.transaction
    if (!scope) return false
    if (!row) return true // Orphan classification cannot be attributed safely.
    if (!sourceIds.has(row.id) || repaymentIds.has(row.id)) return false
    return (
      (!context.classificationValid && row.type === 'income') ||
      matchesReportCategory(scope, context.categoryId)
    )
  }
  const selectedAccountIds = scope
    ? dataset.accounts
        .filter(
          (account) =>
            (account.account_mode ?? 'transactional') === 'transactional' &&
            matchesReportAccount(scope, account.id)
        )
        .map((account) => account.id)
        .sort()
    : []
  const coverage = consumptionCoverage(
    selectedAccountIds,
    dataset.coverage,
    window.start,
    window.end
  )
  // An explicitly empty account universe is vacuously covered; missing scope IDs remain scope issues.
  const coverageComplete = selectedAccountIds.length === 0 || coverage.coverageComplete
  if (basis === 'net_consumption')
    for (const id of coverage.uncoveredAccountIds)
      issues.push({
        code: 'coverage',
        id,
        message: 'Independent source coverage does not verify the selected window.',
      })
  const conversions: { id: string; conversion: DatedConversion | null }[] = []
  function convert(row: CorrectionTransaction): DatedConversion | null {
    try {
      const conversion = convertCentavosAsOf({
        amountCentavos: row.amount,
        fromCurrency: row.currency?.trim().toUpperCase() ?? '',
        toCurrency: currency,
        asOfDate: row.date!,
        rates: dataset.rates,
      })
      conversions.push({ id: row.id, conversion })
      if (!conversion.complete)
        issues.push({ code: 'fx', id: row.id, message: conversion.missingReason })
      return conversion
    } catch (error) {
      conversions.push({ id: row.id, conversion: null })
      issues.push({ code: 'fx', id: row.id, message: String(error) })
      return null
    }
  }
  let allocations: ScopedReportAllocation[] = []
  let unresolvedClassificationIds: string[] = []
  if (basis === 'gross_cashflow') {
    for (const row of dataset.transactions) {
      if (!scope || !sourceIds.has(row.id) || repaymentIds.has(row.id) || !potentiallySelected(row))
        continue
      const splits = dataset.splits.filter((split) => split.transaction_id === row.id)
      const all = splits.length
        ? splits.map((split) => ({
            id: split.id,
            amountCentavos: split.amount,
            categoryId: split.category_id,
          }))
        : [{ id: row.id, amountCentavos: row.amount, categoryId: row.category_id ?? null }]
      try {
        if (row.amount < 0 || !Number.isSafeInteger(row.amount))
          throw new Error('Parent amount must be non-negative safe centavos.')
        // Validation and rounding consider ALL splits, including out-of-scope allocations.
        if (row.amount !== 0 || splits.length) apportionConvertedAmount(row.amount, all, row.amount)
        const conversion = convert(row)
        const amounts = conversion?.complete
          ? row.amount === 0 && !splits.length
            ? [{ id: row.id, amountCentavos: 0 }]
            : apportionConvertedAmount(conversion.amountCentavos, all, row.amount)
          : []
        for (const part of all.filter((part) => matchesReportCategory(scope, part.categoryId))) {
          const amount = amounts.find((item) => item.id === part.id)?.amountCentavos ?? null
          allocations.push({
            transactionId: row.id,
            allocationId: part.id,
            accountId: row.account_id ?? null,
            categoryId: part.categoryId,
            date: row.date!,
            currency: row.currency?.trim().toUpperCase() ?? '',
            nativeAmountCentavos: part.amountCentavos,
            amountCentavos: amount,
            nativeAmounts: grossAmounts(row.type, part.amountCentavos),
            amounts: grossAmounts(row.type, amount),
            classificationId: null,
            typeRevisionId: null,
            role: null,
            referencedPurchaseId: null,
          })
        }
      } catch (error) {
        issues.push({ code: 'invalid_allocation', id: row.id, message: String(error) })
      }
    }
  } else {
    // First pass selects canonical recognized allocations without modifying evidence or inventing FX.
    const selected = projectDatedNetConsumption({
      evidence: dataset,
      start: window.start,
      end: window.end,
      selectAllocation,
      coverageComplete,
      conversion: { complete: false, toCurrency: currency, reason: null, converted: [] },
    })
    const parentIds = new Set(selected.allocations.map((row) => row.transactionId))
    for (const row of dataset.transactions) if (parentIds.has(row.id)) convert(row)
    const projected = projectDatedNetConsumption({
      evidence: dataset,
      start: window.start,
      end: window.end,
      selectAllocation,
      coverageComplete,
      conversion: {
        complete: conversions.every((row) => row.conversion?.complete),
        toCurrency: currency,
        reason: issues.some((issue) => issue.code === 'fx')
          ? 'missing_or_invalid_direct_rate'
          : null,
        converted: conversions.map((row) => ({
          id: row.id,
          complete: row.conversion?.complete ?? false,
          amountCentavos: row.conversion?.amountCentavos ?? null,
        })),
      },
    })
    unresolvedClassificationIds = projected.unresolvedClassificationIds
    for (const id of unresolvedClassificationIds)
      issues.push({
        code: 'classification',
        id,
        message: 'Selected allocation classification is missing, invalid or ambiguous.',
      })
    allocations = projected.allocations.map((row) => ({
      transactionId: row.transactionId,
      allocationId: row.allocationId,
      accountId: dataset.transactions.find((tx) => tx.id === row.transactionId)?.account_id ?? null,
      categoryId: row.categoryId,
      date: row.date,
      currency: row.currency,
      nativeAmountCentavos: row.nativeAmountCentavos,
      amountCentavos: row.amountCentavos,
      nativeAmounts: {
        ...emptyAmounts(),
        ...classificationContribution(row.role, row.nativeAmountCentavos),
      },
      amounts: {
        ...emptyAmounts(),
        consumptionCentavos: row.consumptionCentavos,
        earnedIncomeCentavos: row.earnedIncomeCentavos,
        otherIncomeCentavos: row.otherIncomeCentavos,
        principalRecoveryCentavos: row.principalRecoveryCentavos,
        assetAcquisitionCentavos: row.assetAcquisitionCentavos,
      },
      classificationId: row.classificationId,
      typeRevisionId:
        dataset.classifications.find((item) => item.id === row.classificationId)
          ?.type_revision_id ?? null,
      role: row.role,
      referencedPurchaseId: row.referencedPurchaseId,
    }))
  }
  for (const row of allocations) {
    if (!dataset.accounts.some((account) => account.id === row.accountId))
      issues.push({
        code: 'missing_account',
        id: row.accountId,
        message: 'Selected transaction source account is missing.',
      })
    if (
      row.categoryId !== null &&
      !dataset.categories.some((category) => category.id === row.categoryId)
    )
      issues.push({
        code: 'missing_category',
        id: row.categoryId,
        message: 'Selected allocation category is missing.',
      })
  }
  const complete = issues.length === 0
  const known = totals(
    allocations.map((row) => row.amounts),
    basis
  )
  const nativeTotals = [...new Set(allocations.map((row) => row.currency).filter(Boolean))]
    .sort()
    .map((currency) => ({
      currency,
      known: totals(
        allocations.filter((row) => row.currency === currency).map((row) => row.nativeAmounts),
        basis
      ),
    }))
  const groupKey = (row: ScopedReportAllocation) =>
    groupBy === 'category'
      ? row.categoryId
      : groupBy === 'account'
        ? row.accountId
        : groupBy === 'month'
          ? row.date.slice(0, 7)
          : null
  const groupKeys =
    groupBy === 'none'
      ? [null]
      : [...new Set(allocations.map(groupKey))].sort((a, b) =>
          a === b ? 0 : a === null ? -1 : b === null ? 1 : a < b ? -1 : 1
        )
  const groups = groupKeys.map((key) => {
    const rows = allocations.filter((row) => groupKey(row) === key)
    const known = totals(
      rows.map((row) => row.amounts),
      basis
    )
    return {
      key,
      complete,
      totals: complete ? known : emptyAmounts(),
      known,
      transactionIds: [...new Set(rows.map((row) => row.transactionId))].sort(),
    }
  })
  const issueTransactionId = (issue: ScopedReportIssue): string | null => {
    if (
      !issue.id ||
      ![
        'invalid_tags',
        'invalid_allocation',
        'invalid_transaction',
        'classification',
        'fx',
        'ambiguous_repayment',
      ].includes(issue.code)
    )
      return null
    return (
      dataset.transactions.find((row) => row.id === issue.id)?.id ??
      dataset.splits.find((row) => row.id === issue.id)?.transaction_id ??
      dataset.classifications.find((row) => row.id === issue.id)?.transaction_id ??
      null
    )
  }
  const transactionIds = [
    ...new Set([
      ...allocations.map((row) => row.transactionId),
      ...issues.flatMap((issue) => {
        const id = issueTransactionId(issue)
        return id === null ? [] : [id]
      }),
    ]),
  ].sort()
  const contributors = transactionIds.map((transactionId) => {
    const parent = dataset.transactions.find((row) => row.id === transactionId)
    return {
      transactionId,
      accountId: parent?.account_id ?? null,
      date: parent?.date ?? null,
      currency: parent?.currency ?? null,
      // Evidence only: this full parent amount must never be summed as selected split usage.
      nativeParentAmountCentavos: Number.isSafeInteger(parent?.amount) ? parent!.amount : null,
      allocationIds: allocations
        .filter((row) => row.transactionId === transactionId)
        .map((row) => row.allocationId)
        .sort(),
      classificationIds: allocations
        .filter((row) => row.transactionId === transactionId)
        .flatMap((row) => (row.classificationId === null ? [] : [row.classificationId]))
        .sort(),
      issues: issues.filter((issue) => issueTransactionId(issue) === transactionId),
    }
  })
  // A gross budget measures expenses, not income. Income-only FX/classification evidence
  // must not turn a fully known expense subtotal into unknown budget usage.
  const usageIssues =
    basis === 'net_consumption'
      ? issues
      : issues.filter((issue) => {
          const id = issueTransactionId(issue)
          return id === null || dataset.transactions.find((row) => row.id === id)?.type !== 'income'
        })
  const usageMeasure = basis === 'gross_cashflow' ? 'expenseCentavos' : 'consumptionCentavos'
  const budgetUsage = {
    measure: usageMeasure as 'expenseCentavos' | 'consumptionCentavos',
    complete: usageIssues.length === 0,
    amountCentavos: usageIssues.length === 0 ? known[usageMeasure] : null,
    knownAmountCentavos: known[usageMeasure],
    issues: usageIssues,
  }
  return {
    basis,
    currency,
    scope,
    window,
    groupBy,
    definitionPolicy: 'current_definition_as_of' as const,
    fxPolicy: 'recognition_transaction_date_parent_then_allocation' as const,
    complete,
    totals: complete ? known : emptyAmounts(),
    known,
    budgetUsage,
    nativeTotals,
    issues,
    allocations,
    transactionIds,
    contributors,
    groups,
    conversions,
    repayments,
    classificationComplete:
      basis === 'net_consumption' ? unresolvedClassificationIds.length === 0 : null,
    unresolvedClassificationIds,
    coverage: {
      required: basis === 'net_consumption',
      complete: coverageComplete,
      selectedAccountIds,
      uncoveredAccountIds: coverage.uncoveredAccountIds,
      evidence: dataset.coverage.filter((row) => selectedAccountIds.includes(row.account_id)),
    },
  }
}

export type ScopedReportResult = ReturnType<typeof projectScopedReport>
