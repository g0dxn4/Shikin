import {
  projectDatedNetConsumption,
  convertDatedAmounts,
  FX_RATE_SELECT,
  classificationCatalog,
  currentClassificationTypeRevision,
  historicalClassificationLabel,
  type ClassificationType,
  type DatedExchangeRate,
} from '@shikin/finance-core'
import {
  assertOrdinaryCorrection,
  clearConsumptionClassificationInEvidence,
  consumptionCoverage,
  consumptionRoles,
  netConsumption,
  owningAllocation,
  setConsumptionClassificationInEvidence,
  type ConsumptionClassification,
  type ConsumptionRole,
  validateConsumptionClassification,
  type CorrectionTransaction,
} from '@shikin/finance-core/corrections'
import { query, withTransaction, type TransactionClient } from '@/lib/database'
import {
  assertFrontendActivePaymentCapacity,
  auditFrontendCorrection,
  readFrontendConsumptionEvidence,
} from '@/lib/split-service'
import { generateId } from '@/lib/ulid'

export interface ConsumptionAllocationView {
  transactionId: string
  splitId: string | null
  amountCentavos: number
  categoryId: string | null
  categoryName: string | null
  classification: ConsumptionClassification | null
  classificationDisplay?: { name: string; version: number | null; revisionId: string | null } | null
}

export interface ConsumptionPurchaseOption {
  classificationId: string
  transactionId: string
  splitId: string | null
  description: string
  date: string
  amountCentavos: number
  currency: string
  categoryId: string | null
  categoryName: string | null
}

export interface ConsumptionClassificationContext {
  transaction: CorrectionTransaction
  allocations: ConsumptionAllocationView[]
  purchaseOptions: ConsumptionPurchaseOption[]
  classificationTypes?: ReturnType<typeof classificationCatalog>
}

export type SetConsumptionClassificationInput = {
  transactionId: string
  splitId?: string | null
  referencedPurchaseId?: string | null
  auditNote?: string
} & (
  | { role: ConsumptionRole; customTypeId?: never; expectedRevisionId?: never }
  | { role?: never; customTypeId: string; expectedRevisionId: string }
)

interface CategoryRow {
  id: string
  name: string
}

async function assertClassificationOwnerAllowed(
  tx: TransactionClient,
  owner: CorrectionTransaction
): Promise<void> {
  assertOrdinaryCorrection(owner)
  if (
    (
      await tx.query<{ id: string }>(
        'SELECT id FROM receivables WHERE matched_transaction_id = ? LIMIT 1',
        [owner.id]
      )
    ).length > 0 ||
    (
      await tx.query<{ id: string }>(
        'SELECT id FROM account_reconciliations WHERE adjustment_transaction_id = ? LIMIT 1',
        [owner.id]
      )
    ).length > 0
  ) {
    throw new Error('Protected financial provenance requires its dedicated workflow.')
  }
}

async function readContext(
  tx: TransactionClient,
  transactionId: string
): Promise<ConsumptionClassificationContext> {
  const [evidence, categories, types] = await Promise.all([
    readFrontendConsumptionEvidence(tx),
    tx.query<CategoryRow>('SELECT id, name FROM categories'),
    tx.query<ClassificationType>('SELECT * FROM classification_types'),
  ])
  const transaction = evidence.transactions.find((row) => row.id === transactionId)
  if (!transaction) throw new Error('Transaction not found.')
  const categoryNames = new Map(categories.map((row) => [row.id, row.name]))
  const ownedSplits = evidence.splits
    .filter((split) => split.transaction_id === transactionId)
    .sort((a, b) => a.id.localeCompare(b.id))
  const allocations = (
    ownedSplits.length
      ? ownedSplits.map((split) => ({
          transactionId,
          splitId: split.id,
          amountCentavos: split.amount,
          categoryId: split.category_id,
        }))
      : [
          {
            transactionId,
            splitId: null,
            amountCentavos: transaction.amount,
            categoryId: transaction.category_id ?? null,
          },
        ]
  ).map((allocation) => {
    const classification =
      evidence.classifications.find(
        (item) =>
          item.transaction_id === allocation.transactionId && item.split_id === allocation.splitId
      ) ?? null
    return {
      ...allocation,
      categoryName: allocation.categoryId
        ? (categoryNames.get(allocation.categoryId) ?? null)
        : null,
      classification,
      classificationDisplay: classification
        ? historicalClassificationLabel(classification, evidence.typeRevisions ?? [])
        : null,
    }
  })
  const purchaseOptions: ConsumptionPurchaseOption[] = []
  for (const classification of evidence.classifications) {
    if (classification.role !== 'purchase') continue
    try {
      const owner = owningAllocation(classification, evidence)
      purchaseOptions.push({
        classificationId: classification.id,
        transactionId: owner.row.id,
        splitId: classification.split_id,
        description: owner.row.description ?? owner.row.id,
        date: owner.row.date ?? '',
        amountCentavos: owner.amount,
        currency: owner.currency,
        categoryId: owner.categoryId,
        categoryName: owner.categoryId ? (categoryNames.get(owner.categoryId) ?? null) : null,
      })
    } catch {
      // Invalid legacy classifications are not valid reference candidates.
    }
  }
  purchaseOptions.sort(
    (a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description)
  )
  return {
    transaction,
    allocations,
    purchaseOptions,
    classificationTypes: classificationCatalog(types, evidence.typeRevisions ?? []),
  }
}

/** Read current allocations and explicit purchase choices from one database snapshot. */
export function readConsumptionClassificationContext(
  transactionId: string
): Promise<ConsumptionClassificationContext> {
  return withTransaction((tx) => readContext(tx, transactionId))
}

/** Set or replace one allocation role atomically. Financial/source/import fields are untouched. */
export function setConsumptionClassification(
  input: SetConsumptionClassificationInput
): Promise<ConsumptionClassification> {
  return withTransaction(async (tx) => {
    if (input.role && !consumptionRoles.includes(input.role))
      throw new Error('Invalid consumption role.')
    if (Boolean(input.role) === Boolean(input.customTypeId))
      throw new Error('Choose exactly one builtin role or custom classification type.')
    const evidence = await readFrontendConsumptionEvidence(tx)
    const owner = evidence.transactions.find((row) => row.id === input.transactionId)
    if (!owner) throw new Error('Transaction not found.')
    await assertClassificationOwnerAllowed(tx, owner)
    const splitId = input.splitId ?? null
    const before =
      evidence.classifications.find(
        (item) => item.transaction_id === input.transactionId && item.split_id === splitId
      ) ?? null
    const custom = input.customTypeId
      ? currentClassificationTypeRevision(
          input.customTypeId,
          input.expectedRevisionId,
          await tx.query<ClassificationType>('SELECT * FROM classification_types'),
          evidence.typeRevisions ?? []
        )
      : null
    const after: ConsumptionClassification = {
      id: before?.id ?? generateId(),
      transaction_id: input.transactionId,
      split_id: splitId,
      role: custom?.revision.financial_treatment ?? input.role!,
      referenced_purchase_id: input.referencedPurchaseId ?? null,
      type_revision_id: custom?.revision.id ?? null,
    }
    const classifications = setConsumptionClassificationInEvidence(evidence, after)
    if (
      before &&
      before.role === after.role &&
      before.referenced_purchase_id === after.referenced_purchase_id &&
      (before.type_revision_id ?? null) === (after.type_revision_id ?? null)
    )
      return before
    await assertFrontendActivePaymentCapacity(tx, input.transactionId, { classifications })
    await tx.execute(
      `INSERT INTO transaction_consumption_classifications
         (id, transaction_id, split_id, role, referenced_purchase_id, type_revision_id)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         role = excluded.role,
         referenced_purchase_id = excluded.referenced_purchase_id,
         type_revision_id = excluded.type_revision_id,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      [
        after.id,
        after.transaction_id,
        after.split_id,
        after.role,
        after.referenced_purchase_id,
        after.type_revision_id,
      ]
    )
    await auditFrontendCorrection(
      tx,
      input.transactionId,
      'classify-consumption',
      before,
      after,
      'frontend-consumption-classification',
      input.auditNote
    )
    return after
  })
}

/** Explicitly clear one role. Referencing refund/principal rows must be cleared first. */
export function clearConsumptionClassification(
  classificationId: string,
  auditNote?: string
): Promise<boolean> {
  return withTransaction(async (tx) => {
    const evidence = await readFrontendConsumptionEvidence(tx)
    const cleared = clearConsumptionClassificationInEvidence(evidence, classificationId)
    if (!cleared.before) return false
    await assertFrontendActivePaymentCapacity(tx, cleared.before.transaction_id, {
      classifications: cleared.classifications,
    })
    await tx.execute('DELETE FROM transaction_consumption_classifications WHERE id = ?', [
      cleared.before.id,
    ])
    await auditFrontendCorrection(
      tx,
      cleared.before.transaction_id,
      'clear-consumption',
      cleared.before,
      null,
      'frontend-consumption-classification',
      auditNote
    )
    return true
  })
}

export interface FrontendNetConsumptionReport {
  basis: 'net_consumption'
  complete: boolean
  classificationComplete: boolean
  coverageComplete: boolean
  unresolvedIds: string[]
  uncoveredAccountIds: string[]
  totalsByCurrency: Array<{
    currency: string
    consumptionCentavos: number
    earnedIncomeCentavos: number
    otherIncomeCentavos?: number
    principalRecoveryCentavos?: number
    assetAcquisitionCentavos?: number
  }>
  mainConversion?: ReturnType<typeof projectDatedNetConsumption> & {
    conversion: unknown
    uncoveredAccountIds: string[]
  }
  byCategory: Array<{
    currency: string
    categoryId: string | null
    categoryName: string | null
    amountCentavos: number
  }>
  period: { start: string; end: string }
  currencyScope: 'all'
  message: string
}

const REPORT_DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/

/** Real YYYY-MM-DD calendar date. Rolled dates such as 2026-02-31 are rejected. */
export function isRealCalendarDate(value: string): boolean {
  if (!REPORT_DATE_PATTERN.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/** Inclusive report window with strict calendar dates. No future-observation rule. */
export function isValidNetConsumptionPeriod(start: string, end: string): boolean {
  return isRealCalendarDate(start) && isRealCalendarDate(end) && start <= end
}

/** Read-only net-consumption basis with the same independent coverage policy as the CLI. */
export function readNetConsumptionReport(
  start: string,
  end: string
): Promise<FrontendNetConsumptionReport> {
  if (!isValidNetConsumptionPeriod(start, end))
    return Promise.reject(new Error('A valid report date range is required.'))
  return withTransaction(async (tx) => {
    const [evidence, accounts, coverage, categories, mainCurrencyRows, rates] = await Promise.all([
      readFrontendConsumptionEvidence(tx),
      tx.query<{ id: string }>(
        "SELECT id FROM accounts WHERE COALESCE(account_mode, 'transactional') = 'transactional'"
      ),
      tx.query<{
        account_id: string
        source_namespace: string
        period_start: string
        period_end: string
        status: string
      }>('SELECT * FROM source_coverage'),
      tx.query<CategoryRow>('SELECT id, name FROM categories'),
      tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'"),
      tx.query<DatedExchangeRate>(FX_RATE_SELECT),
    ])
    const result = netConsumption(evidence, start, end)
    const coverageResult = consumptionCoverage(
      accounts.map((account) => account.id),
      coverage,
      start,
      end
    )
    const categoryNames = new Map(categories.map((row) => [row.id, row.name]))
    const complete = result.classificationComplete && coverageResult.coverageComplete
    const parentIds = new Set<string>()
    for (const item of evidence.classifications) {
      try {
        validateConsumptionClassification(item, evidence)
        const owner = owningAllocation(item, evidence)
        if (owner.row.date && owner.row.date >= start && owner.row.date <= end)
          parentIds.add(owner.row.id)
      } catch {
        // Invalid evidence remains represented by native classification completeness.
      }
    }
    const parents = evidence.transactions.filter((row) => parentIds.has(row.id))
    const mainCurrency = mainCurrencyRows[0]?.value ?? null
    const conversion = mainCurrency
      ? (() => {
          const converted = convertDatedAmounts(
            parents.map((row) => ({
              id: row.id,
              amountCentavos: row.amount,
              currency: row.currency!.trim().toUpperCase(),
              date: row.date!,
            })),
            mainCurrency,
            rates
          )
          return { ...converted, reason: converted.complete ? null : 'missing_direct_rate' }
        })()
      : {
          complete: false,
          toCurrency: null,
          reason: 'main_currency_unconfigured',
          totalCentavos: null,
          knownTotalCentavos: null,
          nativeTotals: [],
          unresolvedIds: parents.map((row) => row.id).sort(),
          converted: [],
        }
    const projection = projectDatedNetConsumption({
      evidence,
      start,
      end,
      conversion,
      coverageComplete: coverageResult.coverageComplete,
    })
    return {
      ...result,
      ...coverageResult,
      complete,
      mainConversion: {
        ...projection,
        conversion,
        uncoveredAccountIds: coverageResult.uncoveredAccountIds,
      },
      byCategory: result.byCategory.map((row) => ({
        ...row,
        categoryName: row.categoryId ? (categoryNames.get(row.categoryId) ?? null) : null,
      })),
      period: { start, end },
      currencyScope: 'all' as const,
      message: complete
        ? 'Explicit net consumption, native currencies; no FX conversion.'
        : 'Known net consumption subtotals only. Classification or independently verified source coverage is incomplete.',
    }
  })
}

/** Lightweight read for callers that only need current rows. */
export function readConsumptionClassifications(): Promise<ConsumptionClassification[]> {
  return query<ConsumptionClassification>('SELECT * FROM transaction_consumption_classifications')
}
