import {
  CASHFLOW_BUCKET_CLEARABLE_FIELDS,
  moneyToSafeCentavos,
  normalizeBucketCurrency,
  planBucketAllocation,
  planBucketCorrection,
  planBucketPatch,
  planBucketReversal,
  safeBucketInteger,
  validateBucketIncomeSource,
  type AllocationPolicySnapshot,
  type BucketPolicySnapshot,
  type CashflowBucketClearableField,
  type CashflowBucketPolicyFailure,
} from '@shikin/finance-core/cashflow-buckets'
import dayjs from 'dayjs'
import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'

export { CASHFLOW_BUCKET_CLEARABLE_FIELDS }
export type { CashflowBucketClearableField }

type BucketRow = {
  id: string
  name: string
  description: string | null
  target_amount: number | null
  balance: number
  currency: string
  sort_order: number
  is_active: number
  created_at: string | null
  updated_at: string | null
}

type AllocationRow = {
  id: string
  bucket_id: string
  transaction_id: string | null
  amount: number
  currency: string
  allocation_date: string
  source: string | null
  note: string | null
  reverses_allocation_id: string | null
  replaces_allocation_id: string | null
  created_at: string | null
}

type SourceRow = {
  id: string
  account_id: string
  type: string
  amount: number
  currency: string
  description: string
  date: string
  status: string | null
  ledger_treatment: string | null
  reporting_treatment: string | null
  transaction_kind: string | null
  is_archived: number
  account_name: string
  account_is_archived: number
}

export type CashflowBucket = BucketPolicySnapshot & {
  createdAt: string | null
  updatedAt: string | null
  allocationCount: number
}

export type CashflowBucketAllocation = AllocationPolicySnapshot & {
  createdAt: string | null
}

export type CashflowIncomeSource = {
  id: string
  accountId: string
  accountName: string
  description: string
  date: string
  amountCentavos: number
  allocatedCentavos: number
  remainingCentavos: number
  currency: string
}

export type CashflowBucketsView = {
  buckets: CashflowBucket[]
  allocations: CashflowBucketAllocation[]
  incomeSources: CashflowIncomeSource[]
}

export class CashflowBucketError extends Error {
  readonly reason: string
  readonly remainingCentavos?: number
  readonly field?: string

  constructor(failure: CashflowBucketPolicyFailure | { reason: string; message: string }) {
    super(failure.message)
    this.name = 'CashflowBucketError'
    this.reason = failure.reason
    if ('remainingCentavos' in failure && failure.remainingCentavos !== undefined) {
      this.remainingCentavos = failure.remainingCentavos
    }
    if ('field' in failure && failure.field !== undefined) this.field = failure.field
  }
}

function fail(reason: string, message: string): never {
  throw new CashflowBucketError({ reason, message })
}

function unwrap<T>(result: { success: true; plan: T } | CashflowBucketPolicyFailure): T {
  if (!result.success) throw new CashflowBucketError(result)
  return result.plan
}

function assertOne(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) throw new Error(message)
}

function bucketPolicy(row: BucketRow): BucketPolicySnapshot {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    targetAmountCentavos: row.target_amount,
    balanceCentavos: row.balance,
    currency: row.currency,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
  }
}

function allocationPolicy(row: AllocationRow): AllocationPolicySnapshot {
  return {
    id: row.id,
    bucketId: row.bucket_id,
    transactionId: row.transaction_id,
    amountCentavos: row.amount,
    currency: row.currency,
    allocationDate: row.allocation_date,
    source: row.source,
    note: row.note,
    reversesAllocationId: row.reverses_allocation_id,
    replacesAllocationId: row.replaces_allocation_id,
  }
}

function sourcePolicy(row: SourceRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    type: row.type,
    amountCentavos: row.amount,
    currency: row.currency,
    status: row.status,
    ledgerTreatment: row.ledger_treatment,
    reportingTreatment: row.reporting_treatment,
    transactionKind: row.transaction_kind,
    isArchived: row.is_archived === 1,
    accountIsArchived: row.account_is_archived === 1,
  }
}

async function loadBucket(tx: TransactionClient, id: string): Promise<BucketRow> {
  const row = (
    await tx.query<BucketRow>('SELECT * FROM cashflow_buckets WHERE id = ? LIMIT 1', [id])
  )[0]
  if (!row) fail('bucket_not_found', `Cashflow bucket ${id} not found.`)
  return row
}

async function loadAllocation(tx: TransactionClient, id: string): Promise<AllocationRow> {
  const row = (
    await tx.query<AllocationRow>(
      'SELECT * FROM cashflow_bucket_allocations WHERE id = ? LIMIT 1',
      [id]
    )
  )[0]
  if (!row) fail('allocation_not_found', `Cashflow allocation ${id} not found.`)
  return row
}

async function loadSource(tx: TransactionClient, id: string): Promise<SourceRow> {
  const row = (
    await tx.query<SourceRow>(
      `SELECT t.id, t.account_id, t.type, t.amount, t.currency, t.description, t.date, t.status,
              t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.is_archived,
              a.name AS account_name, a.is_archived AS account_is_archived
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ? LIMIT 1`,
      [id]
    )
  )[0]
  if (!row) fail('source_transaction_not_found', `Source transaction ${id} not found.`)
  unwrap(validateBucketIncomeSource(sourcePolicy(row)))
  return row
}

async function sourceAllocated(tx: TransactionClient, id: string): Promise<number> {
  const total = (
    await tx.query<{ total: number }>(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM cashflow_bucket_allocations WHERE transaction_id = ?',
      [id]
    )
  )[0]?.total
  if (!Number.isSafeInteger(total)) {
    fail('unsafe_amount', `Allocated total for source transaction ${id} is not a safe integer.`)
  }
  return total ?? 0
}

async function assertBucketBalance(
  tx: TransactionClient,
  bucketId: string,
  expectedCentavos: number
): Promise<BucketPolicySnapshot> {
  const current = bucketPolicy(await loadBucket(tx, bucketId))
  if (current.balanceCentavos !== expectedCentavos) {
    throw new Error(`Cashflow bucket ${bucketId} failed its balance postcondition.`)
  }
  return current
}

async function hasReversal(tx: TransactionClient, id: string): Promise<boolean> {
  return (
    (
      await tx.query<{ id: string }>(
        'SELECT id FROM cashflow_bucket_allocations WHERE reverses_allocation_id = ? LIMIT 1',
        [id]
      )
    ).length > 0
  )
}

async function audit(
  tx: TransactionClient,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  source: string | null = null,
  note: string | null = null
) {
  const result = await tx.execute(
    `INSERT INTO audit_log
       (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    [
      generateId(),
      entity,
      entityId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      source,
      note,
    ]
  )
  assertOne(result, 'Cashflow bucket audit record could not be written safely.')
}

function today() {
  return dayjs().format('YYYY-MM-DD')
}

function snapshotKey(value: unknown): string {
  return JSON.stringify(value)
}

export async function listCashflowBuckets(): Promise<CashflowBucketsView> {
  return withTransaction(async (tx) => {
    const [bucketRows, allocationRows, sourceRows, sourceTotals] = await Promise.all([
      tx.query<BucketRow>('SELECT * FROM cashflow_buckets ORDER BY currency, sort_order, name, id'),
      tx.query<AllocationRow>(
        'SELECT * FROM cashflow_bucket_allocations ORDER BY allocation_date DESC, created_at DESC, id DESC'
      ),
      tx.query<SourceRow>(
        `SELECT t.id, t.account_id, t.type, t.amount, t.currency, t.description, t.date, t.status,
                t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.is_archived,
                a.name AS account_name, a.is_archived AS account_is_archived
         FROM transactions t
         JOIN accounts a ON a.id = t.account_id
         ORDER BY t.date DESC, t.id DESC`
      ),
      tx.query<{ transaction_id: string; total: number }>(
        `SELECT transaction_id, COALESCE(SUM(amount), 0) AS total
         FROM cashflow_bucket_allocations
         WHERE transaction_id IS NOT NULL
         GROUP BY transaction_id`
      ),
    ])
    for (const row of bucketRows) {
      if (!normalizeBucketCurrency(row.currency)) {
        fail(
          'malformed_currency',
          `Cashflow bucket "${row.name}" has malformed or ambiguous currency evidence.`
        )
      }
      const balance = safeBucketInteger(
        row.balance,
        `Cashflow bucket "${row.name}" balance is not a safe integer.`
      )
      if (typeof balance !== 'number') throw new CashflowBucketError(balance)
      if (row.target_amount !== null) {
        const target = safeBucketInteger(
          row.target_amount,
          `Cashflow bucket "${row.name}" target is not a safe integer.`
        )
        if (typeof target !== 'number') throw new CashflowBucketError(target)
        if (target < 0)
          fail('invalid_target', `Cashflow bucket "${row.name}" has a negative target.`)
      }
    }
    for (const row of allocationRows) {
      if (!normalizeBucketCurrency(row.currency)) {
        fail(
          'malformed_currency',
          `Cashflow allocation ${row.id} has malformed or ambiguous currency evidence.`
        )
      }
      const amount = safeBucketInteger(
        row.amount,
        `Cashflow allocation ${row.id} amount is not a safe integer.`
      )
      if (typeof amount !== 'number') throw new CashflowBucketError(amount)
    }
    const counts = new Map<string, number>()
    for (const row of allocationRows)
      counts.set(row.bucket_id, (counts.get(row.bucket_id) ?? 0) + 1)
    const totals = new Map(sourceTotals.map((row) => [row.transaction_id, row.total]))
    const incomeSources: CashflowIncomeSource[] = []
    for (const row of sourceRows) {
      const policy = validateBucketIncomeSource(sourcePolicy(row))
      if (!policy.success) continue
      const allocated = totals.get(row.id) ?? 0
      if (!Number.isSafeInteger(allocated)) continue
      const remaining = policy.plan.amountCentavos - allocated
      if (!Number.isSafeInteger(remaining) || remaining < 0) continue
      incomeSources.push({
        id: row.id,
        accountId: row.account_id,
        accountName: row.account_name,
        description: row.description,
        date: row.date,
        amountCentavos: policy.plan.amountCentavos,
        allocatedCentavos: allocated,
        remainingCentavos: remaining,
        currency: policy.plan.currency,
      })
    }
    return {
      buckets: bucketRows.map((row) => ({
        ...bucketPolicy(row),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        allocationCount: counts.get(row.id) ?? 0,
      })),
      allocations: allocationRows.map((row) => ({
        ...allocationPolicy(row),
        createdAt: row.created_at,
      })),
      incomeSources,
    }
  })
}

export async function createCashflowBucket(input: {
  name: string
  description?: string
  targetAmountCentavos?: number | null
  currency: string
}): Promise<CashflowBucket> {
  const name = input.name.trim()
  if (!name) fail('invalid_name', 'Bucket name is required.')
  const currency = normalizeBucketCurrency(input.currency)
  if (!currency) fail('malformed_currency', 'Bucket currency must be a three-letter code.')
  if (
    input.targetAmountCentavos !== undefined &&
    input.targetAmountCentavos !== null &&
    (!Number.isSafeInteger(input.targetAmountCentavos) || input.targetAmountCentavos < 0)
  ) {
    fail('unsafe_amount', 'Target amount must be a non-negative safe integer in centavos.')
  }
  return withTransaction(async (tx) => {
    const duplicate = (
      await tx.query<{ id: string }>(
        'SELECT id FROM cashflow_buckets WHERE LOWER(name) = LOWER(?) LIMIT 1',
        [name]
      )
    )[0]
    if (duplicate) fail('bucket_name_exists', `Cashflow bucket "${name}" already exists.`)
    const id = generateId()
    const target = input.targetAmountCentavos ?? null
    const result = await tx.execute(
      `INSERT INTO cashflow_buckets
         (id, name, description, target_amount, balance, currency, sort_order, is_active)
       VALUES (?, ?, ?, ?, 0, ?, 0, 1)`,
      [id, name, input.description?.trim() || null, target, currency]
    )
    assertOne(result, 'Cashflow bucket could not be created safely.')
    const createdRow = await loadBucket(tx, id)
    const created = bucketPolicy(createdRow)
    await audit(tx, 'cashflow_bucket', id, 'create', null, { bucket: created })
    return {
      ...created,
      createdAt: createdRow.created_at,
      updatedAt: createdRow.updated_at,
      allocationCount: 0,
    }
  })
}

export async function updateCashflowBucket(
  bucketId: string,
  input: {
    name?: string
    description?: string
    targetAmountCentavos?: number
    active?: boolean
    clearFields?: readonly CashflowBucketClearableField[]
  }
): Promise<CashflowBucket> {
  return withTransaction(async (tx) => {
    const currentRow = await loadBucket(tx, bucketId)
    const current = bucketPolicy(currentRow)
    const name = input.name?.trim()
    if (input.name !== undefined && !name) fail('invalid_name', 'Bucket name is required.')
    const updated = unwrap(
      planBucketPatch(current, {
        ...(name !== undefined ? { name } : {}),
        ...(input.description !== undefined ? { description: input.description.trim() } : {}),
        ...(input.targetAmountCentavos !== undefined
          ? { targetAmountCentavos: input.targetAmountCentavos }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
        ...(input.clearFields !== undefined ? { clearFields: input.clearFields } : {}),
      })
    )
    if (name !== undefined) {
      const duplicate = (
        await tx.query<{ id: string }>(
          'SELECT id FROM cashflow_buckets WHERE LOWER(name) = LOWER(?) AND id <> ? LIMIT 1',
          [name, bucketId]
        )
      )[0]
      if (duplicate) fail('bucket_name_exists', `Cashflow bucket "${name}" already exists.`)
    }
    const result = await tx.execute(
      `UPDATE cashflow_buckets
       SET name = ?, description = ?, target_amount = ?, sort_order = ?, is_active = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      [
        updated.name,
        updated.description,
        updated.targetAmountCentavos,
        updated.sortOrder,
        updated.isActive ? 1 : 0,
        bucketId,
      ]
    )
    assertOne(result, `Cashflow bucket ${bucketId} could not be updated safely.`)
    await audit(tx, 'cashflow_bucket', bucketId, 'update', { bucket: current }, { bucket: updated })
    const updatedRow = await loadBucket(tx, bucketId)
    if (snapshotKey(bucketPolicy(updatedRow)) !== snapshotKey(updated)) {
      throw new Error(`Cashflow bucket ${bucketId} failed its update postcondition.`)
    }
    return {
      ...updated,
      createdAt: updatedRow.created_at,
      updatedAt: updatedRow.updated_at,
      allocationCount:
        (
          await tx.query<{ count: number }>(
            'SELECT COUNT(*) AS count FROM cashflow_bucket_allocations WHERE bucket_id = ?',
            [bucketId]
          )
        )[0]?.count ?? 0,
    }
  })
}

export async function deleteCashflowBucket(bucketId: string): Promise<void> {
  await withTransaction(async (tx) => {
    const current = bucketPolicy(await loadBucket(tx, bucketId))
    const history = (
      await tx.query<{ count: number }>(
        'SELECT COUNT(*) AS count FROM cashflow_bucket_allocations WHERE bucket_id = ?',
        [bucketId]
      )
    )[0]?.count
    if (current.balanceCentavos !== 0 || history !== 0) {
      fail(
        'bucket_not_empty',
        `Cashflow bucket "${current.name}" has a non-zero balance or allocation history. Deactivate it instead of deleting.`
      )
    }
    assertOne(
      await tx.execute('DELETE FROM cashflow_buckets WHERE id = ?', [bucketId]),
      `Cashflow bucket ${bucketId} could not be deleted safely.`
    )
    await audit(tx, 'cashflow_bucket', bucketId, 'delete', { bucket: current }, null)
  })
}

export type AllocateCashflowInput = {
  bucketId: string
  amountCentavos: number
  transactionId: string | null
  allocationDate?: string
  note?: string
}

export async function allocateCashflow(
  input: AllocateCashflowInput
): Promise<CashflowBucketAllocation> {
  return withTransaction(async (tx) => {
    const bucket = bucketPolicy(await loadBucket(tx, input.bucketId))
    const source = input.transactionId ? await loadSource(tx, input.transactionId) : null
    const currency = source
      ? unwrap(validateBucketIncomeSource(sourcePolicy(source))).currency
      : bucket.currency
    const sourceTotal = source ? await sourceAllocated(tx, source.id) : undefined
    const plan = unwrap(
      planBucketAllocation({
        bucket,
        amountCentavos: input.amountCentavos,
        currency,
        ...(source
          ? {
              sourceTransactionId: source.id,
              sourceAmountCentavos: source.amount,
              sourceAllocatedCentavos: sourceTotal,
            }
          : {}),
      })
    )
    const allocation: AllocationPolicySnapshot = {
      id: generateId(),
      bucketId: bucket.id,
      transactionId: source?.id ?? null,
      amountCentavos: input.amountCentavos,
      currency: plan.currency,
      allocationDate: input.allocationDate ?? today(),
      source: source ? 'income-transaction' : 'virtual-unbound',
      note: input.note?.trim() || null,
      reversesAllocationId: null,
      replacesAllocationId: null,
    }
    assertOne(
      await tx.execute(
        `INSERT INTO cashflow_bucket_allocations
           (id, bucket_id, transaction_id, amount, currency, allocation_date, source, note,
            reverses_allocation_id, replaces_allocation_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
        [
          allocation.id,
          allocation.bucketId,
          allocation.transactionId,
          allocation.amountCentavos,
          allocation.currency,
          allocation.allocationDate,
          allocation.source,
          allocation.note,
        ]
      ),
      'Cashflow allocation could not be inserted safely.'
    )
    assertOne(
      await tx.execute(
        `UPDATE cashflow_buckets
         SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND is_active = 1`,
        [allocation.amountCentavos, bucket.id]
      ),
      `Cashflow bucket ${bucket.id} is inactive or missing; allocation was not applied.`
    )
    const after = await assertBucketBalance(tx, bucket.id, plan.nextBalanceCentavos)
    await audit(
      tx,
      'cashflow_bucket_allocation',
      allocation.id,
      'allocate',
      { bucket },
      { bucket: after, allocation },
      allocation.source,
      allocation.note
    )
    return { ...allocation, createdAt: null }
  })
}

export async function reverseCashflowAllocation(
  allocationId: string,
  input: { allocationDate?: string; note?: string } = {}
): Promise<CashflowBucketAllocation> {
  return withTransaction(async (tx) => {
    const originalRow = await loadAllocation(tx, allocationId)
    const original = allocationPolicy(originalRow)
    const bucket = bucketPolicy(await loadBucket(tx, original.bucketId))
    const plan = unwrap(
      planBucketReversal({ original, bucket, alreadyReversed: await hasReversal(tx, allocationId) })
    )
    const reversal: AllocationPolicySnapshot = {
      id: generateId(),
      bucketId: original.bucketId,
      transactionId: original.transactionId,
      amountCentavos: plan.reversalAmountCentavos,
      currency: original.currency,
      allocationDate: input.allocationDate ?? today(),
      source: original.source,
      note: input.note?.trim() || original.note,
      reversesAllocationId: original.id,
      replacesAllocationId: null,
    }
    await insertAllocation(tx, reversal)
    assertOne(
      await tx.execute(
        `UPDATE cashflow_buckets
         SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`,
        [reversal.amountCentavos, bucket.id]
      ),
      `Cashflow bucket ${bucket.id} could not be updated safely.`
    )
    const after = await assertBucketBalance(tx, bucket.id, plan.nextBalanceCentavos)
    await audit(
      tx,
      'cashflow_bucket_allocation',
      reversal.id,
      'reverse',
      { bucket, allocation: original },
      { bucket: after, allocation: reversal },
      reversal.source,
      reversal.note
    )
    return { ...reversal, createdAt: null }
  })
}

async function insertAllocation(tx: TransactionClient, allocation: AllocationPolicySnapshot) {
  assertOne(
    await tx.execute(
      `INSERT INTO cashflow_bucket_allocations
         (id, bucket_id, transaction_id, amount, currency, allocation_date, source, note,
          reverses_allocation_id, replaces_allocation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        allocation.id,
        allocation.bucketId,
        allocation.transactionId,
        allocation.amountCentavos,
        allocation.currency,
        allocation.allocationDate,
        allocation.source,
        allocation.note,
        allocation.reversesAllocationId,
        allocation.replacesAllocationId,
      ]
    ),
    `Cashflow allocation ${allocation.id} could not be inserted safely.`
  )
}

export type CashflowCorrectionPreview = {
  token: string
  original: AllocationPolicySnapshot
  originalBucket: BucketPolicySnapshot
  targetBucket: BucketPolicySnapshot
  replacement: {
    bucketId: string
    amountCentavos: number
    transactionId: string | null
    currency: string
    allocationDate: string
    note: string | null
  }
  balances: { originalAfterCentavos: number; targetAfterCentavos: number }
}

async function buildCorrectionPreview(
  tx: TransactionClient,
  input: {
    allocationId: string
    bucketId: string
    amountCentavos: number
    transactionId?: string | null
    allocationDate?: string
    note?: string
  }
): Promise<CashflowCorrectionPreview> {
  const original = allocationPolicy(await loadAllocation(tx, input.allocationId))
  const originalBucket = bucketPolicy(await loadBucket(tx, original.bucketId))
  const targetBucket = bucketPolicy(await loadBucket(tx, input.bucketId))
  const replacementTransactionId =
    input.transactionId === undefined ? original.transactionId : input.transactionId
  const source = replacementTransactionId ? await loadSource(tx, replacementTransactionId) : null
  const currency = source
    ? unwrap(validateBucketIncomeSource(sourcePolicy(source))).currency
    : targetBucket.currency
  const sourceTotal = source ? await sourceAllocated(tx, source.id) : undefined
  const alreadyReversed = await hasReversal(tx, original.id)
  const plan = unwrap(
    planBucketCorrection({
      original,
      originalBucket,
      targetBucket,
      replacementAmountCentavos: input.amountCentavos,
      replacementCurrency: currency,
      alreadyReversed,
      ...(source
        ? {
            sourceTransactionId: source.id,
            sourceAmountCentavos: source.amount,
            sourceAllocatedCentavos: sourceTotal,
          }
        : {}),
    })
  )
  const replacement = {
    bucketId: targetBucket.id,
    amountCentavos: input.amountCentavos,
    transactionId: source?.id ?? null,
    currency,
    allocationDate: input.allocationDate ?? today(),
    note: input.note?.trim() || original.note,
  }
  const evidence = {
    original,
    originalBucket,
    targetBucket,
    replacement,
    sourceTotal,
    alreadyReversed,
  }
  return {
    token: snapshotKey(evidence),
    original,
    originalBucket,
    targetBucket,
    replacement,
    balances: {
      originalAfterCentavos: plan.originalNextBalanceCentavos,
      targetAfterCentavos: plan.targetNextBalanceCentavos,
    },
  }
}

export async function previewCashflowCorrection(input: {
  allocationId: string
  bucketId: string
  amountCentavos: number
  transactionId?: string | null
  allocationDate?: string
  note?: string
}): Promise<CashflowCorrectionPreview> {
  return withTransaction((tx) => buildCorrectionPreview(tx, input))
}

export async function applyCashflowCorrection(
  reviewed: CashflowCorrectionPreview
): Promise<{ reversal: CashflowBucketAllocation; replacement: CashflowBucketAllocation }> {
  return withTransaction(async (tx) => {
    const current = await buildCorrectionPreview(tx, {
      allocationId: reviewed.original.id,
      bucketId: reviewed.replacement.bucketId,
      amountCentavos: reviewed.replacement.amountCentavos,
      transactionId: reviewed.replacement.transactionId,
      allocationDate: reviewed.replacement.allocationDate,
      ...(reviewed.replacement.note !== null ? { note: reviewed.replacement.note } : {}),
    })
    if (current.token !== reviewed.token) {
      fail('stale_preview', 'Bucket correction preview is stale. Review the current plan again.')
    }
    const reversal: AllocationPolicySnapshot = {
      id: generateId(),
      bucketId: current.original.bucketId,
      transactionId: current.original.transactionId,
      amountCentavos: -current.original.amountCentavos,
      currency: current.original.currency,
      allocationDate: current.replacement.allocationDate,
      source: current.original.source,
      note: current.replacement.note,
      reversesAllocationId: current.original.id,
      replacesAllocationId: null,
    }
    const replacement: AllocationPolicySnapshot = {
      id: generateId(),
      bucketId: current.replacement.bucketId,
      transactionId: current.replacement.transactionId,
      amountCentavos: current.replacement.amountCentavos,
      currency: current.replacement.currency,
      allocationDate: current.replacement.allocationDate,
      source: current.replacement.transactionId
        ? (current.original.source ?? 'income-transaction')
        : 'virtual-unbound',
      note: current.replacement.note,
      reversesAllocationId: null,
      replacesAllocationId: current.original.id,
    }
    await insertAllocation(tx, reversal)
    await insertAllocation(tx, replacement)
    if (current.originalBucket.id === current.targetBucket.id) {
      assertOne(
        await tx.execute(
          `UPDATE cashflow_buckets
           SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND is_active = 1`,
          [reversal.amountCentavos + replacement.amountCentavos, current.targetBucket.id]
        ),
        `Cashflow bucket ${current.targetBucket.id} is inactive or missing.`
      )
    } else {
      assertOne(
        await tx.execute(
          `UPDATE cashflow_buckets
           SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ?`,
          [reversal.amountCentavos, current.originalBucket.id]
        ),
        `Cashflow bucket ${current.originalBucket.id} could not be updated safely.`
      )
      assertOne(
        await tx.execute(
          `UPDATE cashflow_buckets
           SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND is_active = 1`,
          [replacement.amountCentavos, current.targetBucket.id]
        ),
        `Cashflow bucket ${current.targetBucket.id} is inactive or missing.`
      )
    }
    const originalAfter = await assertBucketBalance(
      tx,
      current.originalBucket.id,
      current.balances.originalAfterCentavos
    )
    const targetAfter =
      current.originalBucket.id === current.targetBucket.id
        ? originalAfter
        : await assertBucketBalance(
            tx,
            current.targetBucket.id,
            current.balances.targetAfterCentavos
          )
    await audit(
      tx,
      'cashflow_bucket_allocation',
      replacement.id,
      'correct',
      {
        originalBucket: current.originalBucket,
        targetBucket: current.targetBucket,
        allocation: current.original,
      },
      {
        originalBucket: originalAfter,
        targetBucket: targetAfter,
        reversal,
        replacement,
      },
      replacement.source,
      replacement.note
    )
    return {
      reversal: { ...reversal, createdAt: null },
      replacement: { ...replacement, createdAt: null },
    }
  })
}

export function decimalAmountToCentavos(amount: number): number {
  const centavos = moneyToSafeCentavos(amount)
  if (typeof centavos !== 'number') throw new CashflowBucketError(centavos)
  return centavos
}
