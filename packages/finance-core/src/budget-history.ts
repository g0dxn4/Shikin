import { assertFxCurrency } from './fx.js'
import { sha256Fingerprint } from './imports.js'
import { resolveBudgetScope, type ReportScope, type NormalizedReportScope } from './report-scope.js'
import { budgetWindowComparability, resolveReportWindow } from './report-window.js'
import {
  projectScopedReport,
  sumScopedCentavos,
  type ScopedActualBasis,
  type ScopedReportDataset,
  type ScopedReportResult,
} from './scoped-reporting.js'

export interface HistoricalBudgetDefinition {
  id: string
  name: string
  amount: number
  currency: string
  period: 'weekly' | 'monthly' | 'yearly'
  category_id: string | null
  scope_json: string | null
  basis: ScopedActualBasis
  is_active: number
  created_at?: string
  updated_at?: string
}

export interface BudgetHistoryConfiguration {
  name: string
  amountCentavos: number
  currency: string
  period: HistoricalBudgetDefinition['period']
  scope: NormalizedReportScope
  basis: ScopedActualBasis
  active: boolean
  definitionCreatedAt: string | null
  definitionUpdatedAt: string | null
}

export interface BudgetHistoryCorrection {
  name?: string
  amountCentavos?: number
  currency?: string
  scope?: ReportScope
  basis?: ScopedActualBasis
}

export interface BudgetHistoryRequest {
  budgetId: string
  month: string
  expectedRevision: number
  expectedDataRevision?: number
  expectedToken?: string
  idempotencyKey: string
  reason: string
  correction?: BudgetHistoryCorrection
  timeZone?: string
  source: 'app' | 'cli_mcp'
}

export interface BudgetHistoryMeasure {
  complete: boolean
  amountCentavos: number | null
  knownAmountCentavos: number | null
  remainingCentavos: number | null
  issues: ScopedReportResult['budgetUsage']['issues']
  coverage: ScopedReportResult['coverage']
  classificationComplete: boolean | null
  unresolvedClassificationIds: string[]
  evidence: Pick<ScopedReportResult, 'allocations' | 'conversions' | 'repayments' | 'contributors'>
}

export interface BudgetHistorySnapshot {
  schemaVersion: 1
  configuration: BudgetHistoryConfiguration
  window: ScopedReportResult['window']
  comparison: Omit<ReturnType<typeof budgetWindowComparability>, 'definitionPolicy' | 'reason'> & {
    definitionPolicy: 'captured_definition_revision'
    reason: 'calendar_month_is_not_plan_period' | null
  }
  retrospective: boolean
  originalRevisionId: string
  gross: BudgetHistoryMeasure
  net: BudgetHistoryMeasure
  sourceState: { databaseId: string; dataRevision: number }
}

export interface BudgetHistoryRow {
  id: string
  budget_id: string
  month: string
  revision: number
  supersedes_id: string | null
  kind: 'capture' | 'retrospective_reconstruction' | 'correction'
  snapshot_json: string
  reason: string
  source: 'app' | 'cli_mcp'
  idempotency_key: string
  request_json: string
  created_at: string
}

export class BudgetHistoryError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'BudgetHistoryError'
  }
}

function requiredText(value: string, label: string, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum)
    throw new BudgetHistoryError(
      'invalid_history_request',
      `${label} must contain 1–${maximum} characters.`
    )
  return value.trim()
}

export function assertBudgetHistoryMonth(value: string): void {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || value.startsWith('0000'))
    throw new BudgetHistoryError(
      'invalid_history_month',
      'month must be a calendar month in YYYY-MM format.'
    )
}

/** Stable, normalized request identity excludes execution date and dryRun. A retry
 * returns the original receipt even if the ledger, definition, or month has changed.
 */
export function budgetHistoryRequestJson(input: BudgetHistoryRequest): string {
  assertBudgetHistoryMonth(input.month)
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)
    throw new BudgetHistoryError(
      'invalid_history_revision',
      'expectedRevision must be 0 for a first capture or the latest saved revision.'
    )
  if (
    input.expectedDataRevision !== undefined &&
    (!Number.isSafeInteger(input.expectedDataRevision) || input.expectedDataRevision < 0)
  )
    throw new BudgetHistoryError(
      'invalid_history_revision',
      'expectedDataRevision must be a nonnegative safe integer.'
    )
  if (input.expectedToken !== undefined && !/^sha256:[a-f0-9]{64}$/.test(input.expectedToken))
    throw new BudgetHistoryError(
      'invalid_history_preview_token',
      'expectedToken must be the unchanged previewToken returned by a reviewed preview.'
    )
  requiredText(input.idempotencyKey, 'idempotencyKey', 128)
  const correction = input.correction
  if (
    correction?.amountCentavos !== undefined &&
    (!Number.isSafeInteger(correction.amountCentavos) || correction.amountCentavos <= 0)
  )
    throw new BudgetHistoryError(
      'invalid_history_amount',
      'The historical limit must be positive safe integer centavos.'
    )
  if (correction?.currency !== undefined) assertFxCurrency(correction.currency)
  if (
    correction?.basis !== undefined &&
    !['gross_cashflow', 'net_consumption'].includes(correction.basis)
  )
    throw new BudgetHistoryError(
      'invalid_history_basis',
      'The historical measure must be gross_cashflow or net_consumption.'
    )
  if (!['app', 'cli_mcp'].includes(input.source))
    throw new BudgetHistoryError(
      'invalid_history_source',
      'A trusted app or CLI/MCP source is required.'
    )
  return JSON.stringify({
    budgetId: requiredText(input.budgetId, 'budgetId', 128),
    month: input.month,
    expectedRevision: input.expectedRevision,
    expectedDataRevision: input.expectedDataRevision ?? null,
    expectedToken: input.expectedToken ?? null,
    reason: requiredText(input.reason, 'reason', 1000),
    source: input.source,
    timeZone: input.timeZone ?? null,
    correction: correction
      ? {
          name: correction.name === undefined ? null : requiredText(correction.name, 'name', 120),
          amountCentavos: correction.amountCentavos ?? null,
          currency: correction.currency ?? null,
          scope:
            correction.scope === undefined
              ? null
              : resolveBudgetScope({ scope: correction.scope }).scope,
          basis: correction.basis ?? null,
        }
      : null,
  })
}

export function readBudgetHistorySnapshot(row: BudgetHistoryRow): BudgetHistorySnapshot {
  const snapshot = JSON.parse(row.snapshot_json) as BudgetHistorySnapshot
  if (snapshot.schemaVersion !== 1)
    throw new BudgetHistoryError(
      'unsupported_history_version',
      'Upgrade Shikin to read this budget history version.'
    )
  return snapshot
}

function storedConfiguration(budget: HistoricalBudgetDefinition): BudgetHistoryConfiguration {
  const scope = resolveBudgetScope({
    storedScope: budget.scope_json === null ? undefined : JSON.parse(budget.scope_json),
    storedCategoryId: budget.category_id,
  }).scope
  assertFxCurrency(budget.currency)
  if (!Number.isSafeInteger(budget.amount) || budget.amount <= 0)
    throw new BudgetHistoryError(
      'invalid_history_amount',
      'Repair the stored budget limit before capturing history.'
    )
  return {
    name: budget.name,
    amountCentavos: budget.amount,
    currency: budget.currency,
    period: budget.period,
    scope,
    basis: budget.basis,
    active: budget.is_active === 1,
    definitionCreatedAt: budget.created_at ?? null,
    definitionUpdatedAt: budget.updated_at ?? null,
  }
}

/** Pure projection used by all adapters inside their database transaction. No
 * ledger rows, reserve allocations, or legacy budget_periods are generated.
 */
export function planBudgetHistory(input: {
  request: BudgetHistoryRequest
  id: string
  now: Date
  budget: HistoricalBudgetDefinition | null
  latest: BudgetHistoryRow | null
  dataset: ScopedReportDataset
  sourceState: BudgetHistorySnapshot['sourceState']
}): BudgetHistoryRow {
  const { request, latest } = input
  const requestJson = budgetHistoryRequestJson(request)
  const latestRevision = latest?.revision ?? 0
  if (request.expectedRevision !== latestRevision)
    throw new BudgetHistoryError(
      'budget_history_revision_conflict',
      `Expected revision ${request.expectedRevision}, but latest is ${latestRevision}. Read get-budget-history and review a fresh preview.`
    )
  if (latest && (latest.budget_id !== request.budgetId || latest.month !== request.month))
    throw new BudgetHistoryError(
      'budget_history_revision_conflict',
      'The previous revision belongs to a different budget or month.'
    )
  const previous = latest ? readBudgetHistorySnapshot(latest) : null
  if (!previous && !input.budget)
    throw new BudgetHistoryError(
      'budget_not_found',
      'No live budget or saved history exists for this budgetId. Reconstruct a budget definition before its first capture.'
    )
  const configuration = previous?.configuration ?? storedConfiguration(input.budget!)
  const correction = request.correction ?? {}
  if (
    correction.currency &&
    correction.currency !== configuration.currency &&
    correction.amountCentavos === undefined
  )
    throw new BudgetHistoryError(
      'amount_required_for_currency_change',
      'Changing historical currency requires an explicit limit; no automatic conversion is performed.'
    )
  const after: BudgetHistoryConfiguration = {
    ...configuration,
    ...(correction.name !== undefined ? { name: requiredText(correction.name, 'name', 120) } : {}),
    ...(correction.amountCentavos !== undefined
      ? { amountCentavos: correction.amountCentavos }
      : {}),
    ...(correction.currency !== undefined ? { currency: correction.currency } : {}),
    ...(correction.scope !== undefined
      ? { scope: resolveBudgetScope({ scope: correction.scope }).scope }
      : {}),
    ...(correction.basis !== undefined ? { basis: correction.basis } : {}),
  }
  const timeZone = request.timeZone ?? previous?.window.timeZone
  const today = resolveReportWindow({ now: input.now, ...(timeZone ? { timeZone } : {}) })
  if (request.month > today.asOf.slice(0, 7))
    throw new BudgetHistoryError(
      'future_history_month',
      'Future months are planning, not recorded history. Choose the current or a past month.'
    )
  const fullWindow = resolveReportWindow({
    period: 'month',
    asOf: `${request.month}-01`,
    timeZone: today.timeZone,
    through: 'period_end',
  })
  const window = resolveReportWindow({
    period: 'month',
    asOf: request.month === today.asOf.slice(0, 7) ? today.asOf : fullWindow.periodEnd,
    timeZone: today.timeZone,
    through: 'as_of',
  })
  const comparison: BudgetHistorySnapshot['comparison'] = {
    ...budgetWindowComparability(window, after.period),
    limitComparable: after.period === 'monthly',
    reason: after.period === 'monthly' ? null : 'calendar_month_is_not_plan_period',
    definitionPolicy: 'captured_definition_revision',
  }
  const measure = (basis: ScopedActualBasis): BudgetHistoryMeasure => {
    const report = projectScopedReport({
      dataset: input.dataset,
      scope: after.scope,
      currency: after.currency,
      window,
      basis,
      groupBy: 'none',
    })
    const usage = report.budgetUsage
    return {
      complete: usage.complete,
      amountCentavos: usage.amountCentavos,
      knownAmountCentavos: usage.knownAmountCentavos,
      remainingCentavos:
        comparison.limitComparable && usage.amountCentavos !== null
          ? sumScopedCentavos([after.amountCentavos, -usage.amountCentavos])
          : null,
      issues: usage.issues,
      coverage: report.coverage,
      classificationComplete: report.classificationComplete,
      unresolvedClassificationIds: report.unresolvedClassificationIds,
      evidence: {
        allocations: report.allocations,
        conversions: report.conversions,
        repayments: report.repayments,
        contributors: report.contributors,
      },
    }
  }
  if (
    !Number.isSafeInteger(input.sourceState.dataRevision) ||
    input.sourceState.dataRevision < 0 ||
    !input.sourceState.databaseId
  )
    throw new BudgetHistoryError(
      'invalid_source_state',
      'The source database revision is unavailable; history cannot be captured safely.'
    )
  if (
    request.expectedDataRevision !== undefined &&
    request.expectedDataRevision !== input.sourceState.dataRevision
  )
    throw new BudgetHistoryError(
      'budget_history_data_conflict',
      'Source data changed since the reviewed preview. Refresh the preview and use its sourceState.dataRevision.'
    )
  const retrospective = previous?.retrospective ?? request.month < today.asOf.slice(0, 7)
  const snapshot: BudgetHistorySnapshot = {
    schemaVersion: 1,
    configuration: after,
    window,
    comparison,
    retrospective,
    originalRevisionId: previous?.originalRevisionId ?? input.id,
    gross: measure('gross_cashflow'),
    net: measure('net_consumption'),
    sourceState: input.sourceState,
  }
  return {
    id: input.id,
    budget_id: request.budgetId.trim(),
    month: request.month,
    revision: latestRevision + 1,
    supersedes_id: latest?.id ?? null,
    kind: latest ? 'correction' : retrospective ? 'retrospective_reconstruction' : 'capture',
    snapshot_json: JSON.stringify(snapshot),
    reason: request.reason.trim(),
    source: request.source,
    idempotency_key: request.idempotencyKey.trim(),
    request_json: requestJson,
    created_at: input.now.toISOString(),
  }
}

export function budgetHistoryInsert(row: BudgetHistoryRow) {
  const columns = Object.keys(row) as Array<keyof BudgetHistoryRow>
  return {
    sql: `INSERT INTO budget_history_revisions (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
    params: columns.map((column) => row[column]),
  }
}

/** Bind the reviewed financial projection and intent, including the resolved
 * calendar cutoff and database identity. Generated IDs/timestamps are excluded;
 * the first originalRevisionId is assigned only when the capture is persisted.
 * Guards are excluded because callers add them after reviewing the preview.
 */
export function budgetHistoryPreviewToken(row: BudgetHistoryRow): string {
  const intent = JSON.parse(row.request_json) as Record<string, unknown>
  delete intent.expectedDataRevision
  delete intent.expectedToken
  const snapshot = readBudgetHistorySnapshot(row)
  return sha256Fingerprint(
    JSON.stringify({
      version: 'budget-history-preview-v1',
      intent,
      idempotencyKey: row.idempotency_key,
      budgetId: row.budget_id,
      month: row.month,
      revision: row.revision,
      supersedesId: row.supersedes_id,
      kind: row.kind,
      snapshot: {
        ...snapshot,
        originalRevisionId: row.supersedes_id === null ? null : snapshot.originalRevisionId,
      },
    })
  )
}

/** Adapters must check committed receipts first so an exact retry never
 * recalculates or depends on the current clock, ledger, or definition.
 */
export function assertBudgetHistoryPreview(
  expectedToken: string | undefined,
  previewToken: string
): void {
  if (expectedToken === undefined)
    throw new BudgetHistoryError(
      'budget_history_preview_required',
      'Review a dryRun preview first, then apply the same request and idempotencyKey with expectedToken set to its previewToken.'
    )
  if (expectedToken !== previewToken)
    throw new BudgetHistoryError(
      'budget_history_stale_preview',
      'The database, resolved cutoff, evidence, or requested correction changed since the preview. Review a fresh dryRun preview and use its previewToken.'
    )
}

/** Compact by default; detailed native allocations and FX evidence are opt-in. */
export function budgetHistorySummary(row: BudgetHistoryRow, includeEvidence = false) {
  const snapshot = readBudgetHistorySnapshot(row)
  const measure = ({
    evidence,
    coverage,
    issues,
    unresolvedClassificationIds,
    ...value
  }: BudgetHistoryMeasure) => ({
    ...value,
    issues: includeEvidence ? issues : issues.slice(0, 10),
    issueCount: issues.length,
    unresolvedClassificationIds: includeEvidence
      ? unresolvedClassificationIds
      : unresolvedClassificationIds.slice(0, 20),
    unresolvedClassificationCount: unresolvedClassificationIds.length,
    diagnosticsTruncated:
      !includeEvidence && (issues.length > 10 || unresolvedClassificationIds.length > 20),
    coverage: {
      required: coverage.required,
      complete: coverage.complete,
      selectedAccountIds: coverage.selectedAccountIds,
      uncoveredAccountIds: coverage.uncoveredAccountIds,
      evidenceCount: coverage.evidence.length,
      ...(includeEvidence ? { evidence: coverage.evidence } : {}),
    },
    contributorCount: evidence.contributors.length,
    ...(includeEvidence ? { evidence } : {}),
  })
  return {
    id: row.id,
    budgetId: row.budget_id,
    month: row.month,
    revision: row.revision,
    supersedesId: row.supersedes_id,
    kind: row.kind,
    originalRevisionId: snapshot.originalRevisionId,
    retrospective: snapshot.retrospective,
    configuration: snapshot.configuration,
    window: snapshot.window,
    comparison: snapshot.comparison,
    gross: measure(snapshot.gross),
    net: measure(snapshot.net),
    sourceState: snapshot.sourceState,
    reason: row.reason,
    source: row.source,
    createdAt: row.created_at,
  }
}
