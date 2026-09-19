import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  positiveMoneyAmount,
  nonNegativeMoneyAmount,
  isoDate,
  currencyCode,
  normalizeCurrencyCode,
  isAccountWriteEligible,
  resolveAccountId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type CashflowBucketRow = {
  id: string
  name: string
  description: string | null
  target_amount: number | null
  balance: number
  currency: string
  sort_order: number
  is_active: number
  created_at?: string | null
  updated_at?: string | null
}

type CashflowAllocationRow = {
  id: string
  bucket_id: string
  transaction_id: string | null
  amount: number
  currency: string
  allocation_date: string
  source: string | null
  note: string | null
  reverses_allocation_id?: string | null
  replaces_allocation_id?: string | null
  created_at?: string | null
}

type SourceIncomeTransactionRow = {
  id: string
  account_id: string
  type: string
  amount: number
  currency: string
  description: string
  date: string
  status: string | null
  ledger_treatment?: string | null
  transaction_kind?: string | null
  account_name: string | null
  account_is_archived: number | null
}

type Failure = {
  success: false
  reason: string
  message: string
  remainingAmount?: number
  reversalId?: string
  bucketId?: string
  field?: string
  deactivateWith?: {
    tool: 'update-bucket'
    bucketId: string
    active: false
  }
}

type BuiltReversal = { success: true; reversal: CashflowAllocationRow }

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/
const BUCKET_CLEARABLE_FIELDS = ['description', 'targetAmount'] as const
type BucketClearableField = (typeof BUCKET_CLEARABLE_FIELDS)[number]

function bucketSnapshot(bucket: CashflowBucketRow) {
  return {
    id: bucket.id,
    name: bucket.name,
    description: bucket.description,
    targetAmount: bucket.target_amount === null ? null : fromCentavos(bucket.target_amount),
    targetAmountCentavos: bucket.target_amount,
    balance: fromCentavos(bucket.balance),
    balanceCentavos: bucket.balance,
    currency: bucket.currency,
    sortOrder: bucket.sort_order,
    isActive: bucket.is_active === 1,
    createdAt: bucket.created_at ?? null,
    updatedAt: bucket.updated_at ?? null,
  }
}

function allocationSnapshot(allocation: CashflowAllocationRow) {
  return {
    id: allocation.id,
    bucketId: allocation.bucket_id,
    transactionId: allocation.transaction_id,
    amount: fromCentavos(allocation.amount),
    amountCentavos: allocation.amount,
    currency: allocation.currency,
    allocationDate: allocation.allocation_date,
    source: allocation.source,
    note: allocation.note,
    reversesAllocationId: allocation.reverses_allocation_id ?? null,
    replacesAllocationId: allocation.replaces_allocation_id ?? null,
    createdAt: allocation.created_at ?? null,
  }
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

function parseCurrencyCode(value: string | null | undefined) {
  const normalized = normalizeCurrencyCode(value)
  return CURRENCY_CODE_PATTERN.test(normalized) ? normalized : null
}

function malformedCurrencyFailure(message: string): Failure {
  return {
    success: false,
    reason: 'malformed_currency',
    message,
  }
}

function unsafeAmountFailure(message: string): Failure {
  return {
    success: false,
    reason: 'unsafe_amount',
    message,
  }
}

function requireSafeInteger(value: unknown, message: string): number | Failure {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return unsafeAmountFailure(message)
  }
  return value
}

function requireSafeSum(left: number, right: number, message: string): number | Failure {
  const total = left + right
  if (!Number.isSafeInteger(total)) return unsafeAmountFailure(message)
  return total
}

function resolveBucket(bucketId?: string, bucketName?: string) {
  if (bucketId) {
    const bucket = query<CashflowBucketRow>(
      'SELECT * FROM cashflow_buckets WHERE id = $1 LIMIT 1',
      [bucketId]
    )[0]
    return bucket
      ? { success: true as const, bucket, matchedBy: 'bucketId' as const }
      : {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${bucketId} not found.`,
        }
  }

  if (bucketName) {
    const matches = query<CashflowBucketRow>(
      'SELECT * FROM cashflow_buckets WHERE LOWER(name) = LOWER($1) ORDER BY name ASC, id ASC LIMIT 2',
      [bucketName]
    )
    if (matches.length === 1) {
      return { success: true as const, bucket: matches[0], matchedBy: 'bucketName' as const }
    }
    if (matches.length > 1) {
      return {
        success: false as const,
        reason: 'bucket_match_ambiguous',
        message: `Bucket name "${bucketName}" matches multiple buckets. Use bucketId.`,
      }
    }
    return {
      success: false as const,
      reason: 'bucket_not_found',
      message: `Cashflow bucket "${bucketName}" not found.`,
    }
  }

  return {
    success: false as const,
    reason: 'bucket_required',
    message: 'Provide bucketId or bucketName.',
  }
}

function loadBucketById(bucketId: string) {
  return query<CashflowBucketRow>('SELECT * FROM cashflow_buckets WHERE id = $1 LIMIT 1', [
    bucketId,
  ])[0]
}

function loadAllocationById(allocationId: string) {
  const allocation = query<CashflowAllocationRow>(
    'SELECT * FROM cashflow_bucket_allocations WHERE id = $1 LIMIT 1',
    [allocationId]
  )[0]
  return allocation
    ? { success: true as const, allocation }
    : {
        success: false as const,
        reason: 'allocation_not_found',
        message: `Cashflow allocation ${allocationId} not found.`,
      }
}

function findReversal(allocationId: string) {
  return query<CashflowAllocationRow>(
    'SELECT * FROM cashflow_bucket_allocations WHERE reverses_allocation_id = $1 LIMIT 1',
    [allocationId]
  )[0]
}

function assertReversible(allocation: CashflowAllocationRow) {
  if (allocation.reverses_allocation_id) {
    return {
      success: false as const,
      reason: 'cannot_reverse_reversal',
      message: `Allocation ${allocation.id} is a reversal and cannot be reversed.`,
    }
  }
  const amount = requireSafeInteger(
    allocation.amount,
    `Allocation ${allocation.id} amount is not a safe integer.`
  )
  if (typeof amount !== 'number') return amount
  if (amount <= 0) {
    return {
      success: false as const,
      reason: 'allocation_not_reversible',
      message: `Allocation ${allocation.id} is not a positive original allocation.`,
    }
  }
  const existing = findReversal(allocation.id)
  if (existing) {
    return {
      success: false as const,
      reason: 'allocation_already_reversed',
      message: `Allocation ${allocation.id} already has reversal ${existing.id}.`,
      reversalId: existing.id,
    }
  }
  return { success: true as const, amount }
}

function inactiveBucketFailure(bucket: CashflowBucketRow): Failure {
  return {
    success: false,
    reason: 'bucket_inactive',
    message: `Cashflow bucket "${bucket.name}" is inactive. Activate it before allocating income.`,
  }
}

function bucketCurrencyFailure(allocationCurrency: string, bucketCurrency: string): Failure {
  return {
    success: false,
    reason: 'bucket_currency_mismatch',
    message: `Allocation currency ${allocationCurrency || '(missing)'} does not match bucket currency ${bucketCurrency}.`,
  }
}

function sourceAllocatedTotal(transactionId: string) {
  const total =
    (query<{ total: number | null }>(
      'SELECT COALESCE(SUM(amount), 0) as total FROM cashflow_bucket_allocations WHERE transaction_id = $1',
      [transactionId]
    ) ?? [])[0]?.total ?? 0
  return requireSafeInteger(
    total,
    `Allocated total for source transaction ${transactionId} is not a safe integer.`
  )
}

function sourceOverallocatedFailure(
  transactionId: string,
  remainingCentavos: number,
  currency: string
): Failure {
  return {
    success: false,
    reason: 'source_transaction_overallocated',
    message: `Source transaction ${transactionId} has ${fromCentavos(Math.max(remainingCentavos, 0)).toFixed(2)} ${currency} remaining to allocate.`,
    remainingAmount: fromCentavos(Math.max(remainingCentavos, 0)),
  }
}

function getSourceIncomeTransaction(transactionId: string) {
  const tx = query<SourceIncomeTransactionRow>(
    `SELECT t.id, t.account_id, t.type, t.amount, t.currency, t.description, t.date, t.status,
            t.ledger_treatment, t.transaction_kind,
            a.name as account_name, a.is_archived as account_is_archived
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.id = $1
       AND COALESCE(t.reporting_treatment, 'normal') = 'normal'
       AND COALESCE(t.is_archived, 0) = 0
     LIMIT 1`,
    [transactionId]
  )[0]

  if (!tx) {
    return {
      success: false as const,
      reason: 'source_transaction_not_found',
      message: `Source transaction ${transactionId} not found.`,
    }
  }
  if (!isAccountWriteEligible({ is_archived: tx.account_is_archived })) {
    return {
      success: false as const,
      reason: 'account_archived',
      message: `Source transaction ${transactionId} belongs to an archived account. Unarchive it before allocating income from it.`,
    }
  }
  if (tx.type !== 'income') {
    return {
      success: false as const,
      reason: 'source_transaction_not_income',
      message: `Source transaction ${transactionId} is a ${tx.type} transaction, not income.`,
    }
  }
  const status = tx.status && tx.status.trim() ? tx.status.trim() : 'posted'
  if (status !== 'posted' && status !== 'cleared') {
    return {
      success: false as const,
      reason: 'source_transaction_not_posted',
      message: `Source transaction ${transactionId} must be posted or cleared before allocating income.`,
    }
  }
  if ((tx.ledger_treatment ?? 'normal') !== 'normal') {
    return {
      success: false as const,
      reason: 'source_transaction_staged',
      message: `Source transaction ${transactionId} is staged or not ordinary normal-ledger income.`,
    }
  }
  if ((tx.transaction_kind ?? 'standard') !== 'standard') {
    return {
      success: false as const,
      reason: 'source_transaction_technical',
      message: `Source transaction ${transactionId} is a technical ${tx.transaction_kind} record, not ordinary income.`,
    }
  }
  if (!parseCurrencyCode(tx.currency)) {
    return malformedCurrencyFailure(
      `Source transaction ${transactionId} has malformed or ambiguous currency evidence.`
    )
  }
  const amount = requireSafeInteger(
    tx.amount,
    `Source transaction ${transactionId} amount is not a safe integer.`
  )
  if (typeof amount !== 'number') return amount
  if (amount <= 0) {
    return {
      success: false as const,
      reason: 'source_transaction_not_income',
      message: `Source transaction ${transactionId} amount must be a positive safe integer.`,
    }
  }

  return { success: true as const, transaction: { ...tx, amount } }
}

function applyBucketBalanceDelta(
  bucketId: string,
  deltaCentavos: number,
  options: { requireActive?: boolean } = {}
) {
  const result = execute(
    options.requireActive
      ? "UPDATE cashflow_buckets SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND is_active = 1"
      : "UPDATE cashflow_buckets SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
    [deltaCentavos, bucketId]
  )
  assertSingleRowUpdated(
    result,
    options.requireActive
      ? `Cashflow bucket ${bucketId} is inactive or missing; allocation was not applied.`
      : `Cashflow bucket ${bucketId} could not be updated safely.`
  )
}

function revalidateTargetBucketForAllocation(
  bucketId: string,
  allocationCurrency: string,
  amountCentavos: number
) {
  const current = loadBucketById(bucketId)
  if (!current) {
    return {
      success: false as const,
      reason: 'bucket_not_found',
      message: `Cashflow bucket ${bucketId} not found.`,
    }
  }
  if (current.is_active !== 1) return inactiveBucketFailure(current)
  const currentCurrency = parseCurrencyCode(current.currency)
  if (!currentCurrency) {
    return malformedCurrencyFailure(
      `Cashflow bucket "${current.name}" has malformed or ambiguous currency evidence.`
    )
  }
  if (currentCurrency !== allocationCurrency) {
    return bucketCurrencyFailure(allocationCurrency, currentCurrency)
  }
  const currentBalance = requireSafeInteger(
    current.balance,
    `Cashflow bucket "${current.name}" balance is not a safe integer.`
  )
  if (typeof currentBalance !== 'number') return currentBalance
  const nextBalance = requireSafeSum(
    currentBalance,
    amountCentavos,
    `Cashflow bucket "${current.name}" balance exceeds the safe integer range.`
  )
  if (typeof nextBalance !== 'number') return nextBalance
  return {
    success: true as const,
    bucket: { ...current, balance: currentBalance },
    nextBalance,
  }
}

function revalidateReliedAccountCurrency(accountId: string, allocationCurrency: string) {
  const currentAccount = resolveAccountId(accountId)
  if (!currentAccount.success) return currentAccount
  const accountCurrency = parseCurrencyCode(currentAccount.currency)
  if (!accountCurrency) {
    return malformedCurrencyFailure(
      `Account ${currentAccount.id} has malformed or ambiguous currency evidence.`
    )
  }
  if (accountCurrency !== allocationCurrency) {
    return {
      success: false as const,
      reason: 'source_account_currency_changed',
      message: `Source account ${currentAccount.id} currency is ${accountCurrency}, not ${allocationCurrency}.`,
    }
  }
  return { success: true as const }
}

function applyBucketUpdatePatch(
  current: CashflowBucketRow,
  input: {
    name?: string
    description?: string
    targetAmount?: number
    sortOrder?: number
    active?: boolean
    clearSet: Set<BucketClearableField>
  }
) {
  const next: CashflowBucketRow = { ...current }
  if (input.name !== undefined) next.name = input.name
  if (input.clearSet.has('description')) next.description = null
  else if (input.description !== undefined) next.description = input.description
  if (input.clearSet.has('targetAmount')) next.target_amount = null
  else if (input.targetAmount !== undefined) {
    const targetCentavos = requireSafeInteger(
      toCentavos(input.targetAmount),
      'Target amount must be a safe integer in centavos.'
    )
    if (typeof targetCentavos !== 'number') return targetCentavos
    next.target_amount = targetCentavos
  }
  if (input.sortOrder !== undefined) next.sort_order = input.sortOrder
  if (input.active !== undefined) next.is_active = input.active ? 1 : 0
  return next
}

function insertLinkedAllocation(allocation: CashflowAllocationRow) {
  execute(
    `INSERT INTO cashflow_bucket_allocations (
       id, bucket_id, transaction_id, amount, currency, allocation_date, source, note,
       reverses_allocation_id, replaces_allocation_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      allocation.id,
      allocation.bucket_id,
      allocation.transaction_id,
      allocation.amount,
      allocation.currency,
      allocation.allocation_date,
      allocation.source,
      allocation.note,
      allocation.reverses_allocation_id ?? null,
      allocation.replaces_allocation_id ?? null,
    ]
  )
}

function cannotDeleteBucketFailure(bucket: CashflowBucketRow): Failure {
  return {
    success: false,
    reason: 'bucket_not_empty',
    message: `Cashflow bucket "${bucket.name}" has a non-zero balance or allocation history. Deactivate it with update-bucket (active: false) instead of deleting.`,
    bucketId: bucket.id,
    deactivateWith: {
      tool: 'update-bucket',
      bucketId: bucket.id,
      active: false,
    },
  }
}

function duplicateBucketNameFailure(name: string, bucketId: string): Failure {
  return {
    success: false,
    reason: 'bucket_name_exists',
    message: `Cashflow bucket "${name}" already exists.`,
    bucketId,
  }
}

function clearFieldConflictFailure(field: string): Failure {
  return {
    success: false,
    reason: 'clear_field_conflict',
    message: `Cannot set ${field} and clear it in the same request.`,
    field,
  }
}

function sourceAccountSnapshot(
  resolvedAccount: { success: true; id: string; currency: string } | { success: false } | null
) {
  return resolvedAccount?.success
    ? { id: resolvedAccount.id, currency: resolvedAccount.currency, persisted: false as const }
    : null
}

const createBucket: ToolDefinition = {
  name: 'create-bucket',
  description: 'Create a cashflow bucket for envelope-style allocation with dry-run support.',
  schema: z.object({
    name: boundedText('Bucket name', 'Bucket name', 120),
    description: z.string().trim().max(500).optional().describe('Optional bucket description'),
    targetAmount: nonNegativeMoneyAmount(
      'Optional target amount in the main currency unit'
    ).optional(),
    currency: currencyCode('Bucket currency').optional().default('USD'),
    sortOrder: z.number().int().optional().default(0).describe('Display sort order'),
    active: z.boolean().optional().default(true).describe('Whether the bucket is active'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({ name, description, targetAmount, currency, sortOrder, active, dryRun }) => {
    const duplicate = query<{ id: string }>(
      'SELECT id FROM cashflow_buckets WHERE LOWER(name) = LOWER($1) LIMIT 1',
      [name]
    )[0]
    if (duplicate) {
      return {
        success: false,
        reason: 'bucket_name_exists',
        message: `Cashflow bucket "${name}" already exists.`,
        bucketId: duplicate.id,
      }
    }

    const bucket: CashflowBucketRow = {
      id: generateId(),
      name,
      description: description ?? null,
      target_amount: targetAmount === undefined ? null : toCentavos(targetAmount),
      balance: 0,
      currency: normalizeCurrencyCode(currency),
      sort_order: sortOrder,
      is_active: active ? 1 : 0,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreate: bucketSnapshot(bucket),
        message: `Dry run: cashflow bucket "${name}" would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO cashflow_buckets (id, name, description, target_amount, balance, currency, sort_order, is_active)
         VALUES ($1, $2, $3, $4, 0, $5, $6, $7)`,
        [
          bucket.id,
          bucket.name,
          bucket.description,
          bucket.target_amount,
          bucket.currency,
          bucket.sort_order,
          bucket.is_active,
        ]
      )
      writeAuditLog({
        entity: 'cashflow_bucket',
        entityId: bucket.id,
        action: 'create',
        before: null,
        after: { bucket: bucketSnapshot(bucket) },
      })
    })

    return {
      success: true,
      action: 'created' as const,
      bucket: bucketSnapshot(bucket),
      message: `Created cashflow bucket "${name}".`,
    }
  },
}

const listBuckets: ToolDefinition = {
  name: 'list-buckets',
  description: 'List cashflow buckets with balances and allocation summaries.',
  schema: z.object({
    activeOnly: z.boolean().optional().default(true).describe('Only list active buckets'),
  }),
  execute: async ({ activeOnly }) => {
    const buckets = query<CashflowBucketRow>(
      `SELECT * FROM cashflow_buckets
       ${activeOnly ? 'WHERE is_active = 1' : ''}
       ORDER BY sort_order ASC, name ASC, id ASC`
    )
    const summaries = query<{
      bucket_id: string
      allocation_count: number
      allocated_amount: number | null
      last_allocation_date: string | null
    }>(
      `SELECT bucket_id, COUNT(*) as allocation_count, COALESCE(SUM(amount), 0) as allocated_amount,
              MAX(allocation_date) as last_allocation_date
       FROM cashflow_bucket_allocations
       GROUP BY bucket_id`
    )
    const summaryByBucket = new Map(summaries.map((summary) => [summary.bucket_id, summary]))

    return {
      success: true,
      buckets: buckets.map((bucket) => {
        const summary = summaryByBucket.get(bucket.id)
        return {
          ...bucketSnapshot(bucket),
          allocationSummary: {
            count: summary?.allocation_count ?? 0,
            allocatedAmount: fromCentavos(summary?.allocated_amount ?? 0),
            allocatedAmountCentavos: summary?.allocated_amount ?? 0,
            lastAllocationDate: summary?.last_allocation_date ?? null,
          },
        }
      }),
      count: buckets.length,
      message:
        buckets.length === 0
          ? 'No cashflow buckets found.'
          : `Found ${buckets.length} cashflow bucket(s).`,
    }
  },
}

const allocateIncome: ToolDefinition = {
  name: 'allocate-income',
  description:
    'Allocate posted income into a cashflow bucket. Optional account inputs only validate source/currency; allocations persist bucket, optional transaction, amount, source, and note.',
  schema: z.object({
    bucketId: boundedText('Bucket ID', 'Cashflow bucket ID', 128).optional(),
    bucketName: boundedText('Bucket name', 'Cashflow bucket name', 120).optional(),
    amount: positiveMoneyAmount('Allocation amount in the main currency unit'),
    currency: currencyCode(
      'Allocation currency. Defaults from source transaction/account or bucket'
    ).optional(),
    transactionId: boundedText(
      'Transaction ID',
      'Optional source income transaction ID',
      128
    ).optional(),
    accountId: boundedText('Account ID', 'Optional source account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional source account alias, ID, or exact name',
      128
    ).optional(),
    allocationDate: isoDate('Allocation date in YYYY-MM-DD format').optional(),
    source: z.string().trim().max(120).optional().describe('Optional source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({
    bucketId,
    bucketName,
    amount,
    currency,
    transactionId,
    accountId,
    account,
    allocationDate,
    source,
    note,
    dryRun,
  }) => {
    const resolvedBucket = resolveBucket(bucketId, bucketName)
    if (!resolvedBucket.success) return resolvedBucket
    const bucket = resolvedBucket.bucket
    if (bucket.is_active !== 1) {
      return inactiveBucketFailure(bucket)
    }

    const sourceTx = transactionId ? getSourceIncomeTransaction(transactionId) : null
    if (sourceTx && !sourceTx.success) return sourceTx

    const resolvedAccount = accountId || account ? resolveAccountId(accountId, account) : null
    if (resolvedAccount && !resolvedAccount.success) return resolvedAccount
    if (
      sourceTx?.success &&
      resolvedAccount?.success &&
      sourceTx.transaction.account_id !== resolvedAccount.id
    ) {
      return {
        success: false,
        reason: 'source_account_mismatch',
        message: `Source transaction ${sourceTx.transaction.id} belongs to account ${sourceTx.transaction.account_id}, not ${resolvedAccount.id}.`,
      }
    }

    const amountCentavos = toCentavos(amount)
    if (!Number.isSafeInteger(amountCentavos) || amountCentavos <= 0) {
      return unsafeAmountFailure('Allocation amount must convert to a positive safe integer.')
    }
    const allocationCurrency = normalizeCurrencyCode(
      currency ??
        (sourceTx?.success ? sourceTx.transaction.currency : null) ??
        (resolvedAccount?.success ? resolvedAccount.currency : null) ??
        bucket.currency
    )
    const bucketCurrency = normalizeCurrencyCode(bucket.currency)
    if (!parseCurrencyCode(allocationCurrency) || !parseCurrencyCode(bucketCurrency)) {
      return malformedCurrencyFailure(
        'Allocation or bucket currency evidence is malformed or ambiguous.'
      )
    }
    if (!allocationCurrency || allocationCurrency !== bucketCurrency) {
      return bucketCurrencyFailure(allocationCurrency, bucketCurrency)
    }
    if (sourceTx?.success) {
      const sourceCurrency = parseCurrencyCode(sourceTx.transaction.currency)
      if (!sourceCurrency) {
        return malformedCurrencyFailure(
          `Source transaction ${sourceTx.transaction.id} has malformed or ambiguous currency evidence.`
        )
      }
      if (sourceCurrency !== allocationCurrency) {
        return {
          success: false,
          reason: 'source_transaction_currency_changed',
          message: `Source transaction ${sourceTx.transaction.id} currency is ${sourceCurrency}, not ${allocationCurrency}.`,
        }
      }
    }

    if (sourceTx?.success) {
      const alreadyAllocated = sourceAllocatedTotal(sourceTx.transaction.id)
      if (typeof alreadyAllocated !== 'number') return alreadyAllocated
      const nextAllocated = requireSafeSum(
        alreadyAllocated,
        amountCentavos,
        `Source transaction ${sourceTx.transaction.id} allocated total exceeds the safe integer range.`
      )
      if (typeof nextAllocated !== 'number') return nextAllocated
      if (nextAllocated > sourceTx.transaction.amount) {
        return sourceOverallocatedFailure(
          sourceTx.transaction.id,
          sourceTx.transaction.amount - alreadyAllocated,
          allocationCurrency
        )
      }
    }

    const allocation: CashflowAllocationRow = {
      id: generateId(),
      bucket_id: bucket.id,
      transaction_id: sourceTx?.success ? sourceTx.transaction.id : null,
      amount: amountCentavos,
      currency: allocationCurrency,
      allocation_date: allocationDate ?? dayjs().format('YYYY-MM-DD'),
      source:
        source ??
        (sourceTx?.success ? 'income-transaction' : resolvedAccount?.success ? 'account' : null),
      note: note ?? null,
    }
    const nextBalance = requireSafeSum(
      bucket.balance,
      amountCentavos,
      `Cashflow bucket "${bucket.name}" balance exceeds the safe integer range.`
    )
    if (typeof nextBalance !== 'number') return nextBalance
    const updatedBucket: CashflowBucketRow = { ...bucket, balance: nextBalance }

    if (dryRun) {
      return {
        success: true,
        action: 'allocated' as const,
        dryRun: true,
        matchedBy: resolvedBucket.matchedBy,
        wouldAllocate: {
          allocation: allocationSnapshot(allocation),
          bucketBefore: bucketSnapshot(bucket),
          bucketAfter: bucketSnapshot(updatedBucket),
          sourceTransaction: sourceTx?.success
            ? {
                id: sourceTx.transaction.id,
                description: sourceTx.transaction.description,
                amount: fromCentavos(sourceTx.transaction.amount),
                currency: sourceTx.transaction.currency,
              }
            : null,
          sourceAccount: sourceAccountSnapshot(resolvedAccount),
        },
        message: `Dry run: ${amount.toFixed(2)} ${allocationCurrency} would be allocated to "${bucket.name}".`,
      }
    }

    const reliedOnAccountCurrency = Boolean(!currency && !transactionId && resolvedAccount?.success)

    const allocationResult = transaction(() => {
      const currentTarget = revalidateTargetBucketForAllocation(
        bucket.id,
        allocation.currency,
        amountCentavos
      )
      if (!currentTarget.success) return currentTarget

      if (reliedOnAccountCurrency && resolvedAccount?.success) {
        const currentAccount = revalidateReliedAccountCurrency(
          resolvedAccount.id,
          allocation.currency
        )
        if (!currentAccount.success) return currentAccount
      }

      if (sourceTx?.success) {
        const currentSourceTx = getSourceIncomeTransaction(sourceTx.transaction.id)
        if (!currentSourceTx.success) return currentSourceTx
        if (
          resolvedAccount?.success &&
          currentSourceTx.transaction.account_id !== resolvedAccount.id
        ) {
          return {
            success: false as const,
            reason: 'source_account_mismatch',
            message: `Source transaction ${currentSourceTx.transaction.id} belongs to account ${currentSourceTx.transaction.account_id}, not ${resolvedAccount.id}.`,
          }
        }

        const currentSourceCurrency = normalizeCurrencyCode(currentSourceTx.transaction.currency)
        if (!currentSourceCurrency || currentSourceCurrency !== allocation.currency) {
          return {
            success: false as const,
            reason: 'source_transaction_currency_changed',
            message: `Source transaction ${currentSourceTx.transaction.id} currency is ${currentSourceCurrency || '(missing)'}, not ${allocation.currency}.`,
          }
        }
        if (!parseCurrencyCode(currentSourceCurrency)) {
          return malformedCurrencyFailure(
            `Source transaction ${currentSourceTx.transaction.id} has malformed or ambiguous currency evidence.`
          )
        }

        const alreadyAllocated = sourceAllocatedTotal(currentSourceTx.transaction.id)
        if (typeof alreadyAllocated !== 'number') return alreadyAllocated
        const nextAllocated = requireSafeSum(
          alreadyAllocated,
          amountCentavos,
          `Source transaction ${currentSourceTx.transaction.id} allocated total exceeds the safe integer range.`
        )
        if (typeof nextAllocated !== 'number') return nextAllocated
        if (nextAllocated > currentSourceTx.transaction.amount) {
          return sourceOverallocatedFailure(
            currentSourceTx.transaction.id,
            currentSourceTx.transaction.amount - alreadyAllocated,
            allocationCurrency
          )
        }
      }

      const afterBucket: CashflowBucketRow = {
        ...currentTarget.bucket,
        balance: currentTarget.nextBalance,
      }
      execute(
        `INSERT INTO cashflow_bucket_allocations (id, bucket_id, transaction_id, amount, currency, allocation_date, source, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          allocation.id,
          allocation.bucket_id,
          allocation.transaction_id,
          allocation.amount,
          allocation.currency,
          allocation.allocation_date,
          allocation.source,
          allocation.note,
        ]
      )
      applyBucketBalanceDelta(currentTarget.bucket.id, allocation.amount, { requireActive: true })
      writeAuditLog({
        entity: 'cashflow_bucket_allocation',
        entityId: allocation.id,
        action: 'allocate',
        before: { bucket: bucketSnapshot(currentTarget.bucket) },
        after: {
          bucket: bucketSnapshot(afterBucket),
          allocation: allocationSnapshot(allocation),
        },
        source: allocation.source,
        note: allocation.note,
      })
      return { success: true as const, bucket: afterBucket }
    })
    if (!allocationResult.success) return allocationResult

    return {
      success: true,
      action: 'allocated' as const,
      matchedBy: resolvedBucket.matchedBy,
      allocation: allocationSnapshot(allocation),
      bucket: bucketSnapshot(allocationResult.bucket),
      sourceAccount: sourceAccountSnapshot(resolvedAccount),
      message: `Allocated ${amount.toFixed(2)} ${allocationCurrency} to "${allocationResult.bucket.name}".`,
    }
  },
}

const updateBucket: ToolDefinition = {
  name: 'update-bucket',
  description:
    'Update cashflow bucket name, description, target, sort order, or active flag. IDs and allocation history are preserved. Use clearFields to null description or targetAmount.',
  schema: z.object({
    bucketId: boundedText('Bucket ID', 'Cashflow bucket ID', 128).optional(),
    bucketName: boundedText('Bucket name', 'Cashflow bucket name', 120).optional(),
    name: boundedText('Bucket name', 'Replacement bucket name', 120).optional(),
    description: z.string().trim().max(500).optional().describe('Replacement description'),
    targetAmount: nonNegativeMoneyAmount('Replacement target amount').optional(),
    sortOrder: z.number().int().optional().describe('Replacement display sort order'),
    active: z.boolean().optional().describe('Whether the bucket is active'),
    clearFields: z
      .array(z.enum(BUCKET_CLEARABLE_FIELDS))
      .optional()
      .default([])
      .describe('Nullable fields to clear: description, targetAmount'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({
    bucketId,
    bucketName,
    name,
    description,
    targetAmount,
    sortOrder,
    active,
    clearFields,
    dryRun,
  }) => {
    const resolvedBucket = resolveBucket(bucketId, bucketName)
    if (!resolvedBucket.success) return resolvedBucket
    const clearSet = new Set<BucketClearableField>(clearFields)
    if (description !== undefined && clearSet.has('description')) {
      return clearFieldConflictFailure('description')
    }
    if (targetAmount !== undefined && clearSet.has('targetAmount')) {
      return clearFieldConflictFailure('targetAmount')
    }
    if (
      name === undefined &&
      description === undefined &&
      targetAmount === undefined &&
      sortOrder === undefined &&
      active === undefined &&
      clearSet.size === 0
    ) {
      return {
        success: false,
        reason: 'no_updates',
        message: 'Provide at least one field to update or clear.',
      }
    }

    if (name !== undefined) {
      const duplicate = query<{ id: string }>(
        'SELECT id FROM cashflow_buckets WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1',
        [name, resolvedBucket.bucket.id]
      )[0]
      if (duplicate) return duplicateBucketNameFailure(name, duplicate.id)
    }

    const patchInput = { name, description, targetAmount, sortOrder, active, clearSet }
    const previewBucket = applyBucketUpdatePatch(resolvedBucket.bucket, patchInput)
    if (!('id' in previewBucket)) return previewBucket

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        matchedBy: resolvedBucket.matchedBy,
        wouldUpdate: {
          bucketBefore: bucketSnapshot(resolvedBucket.bucket),
          bucketAfter: bucketSnapshot(previewBucket),
        },
        message: `Dry run: cashflow bucket "${resolvedBucket.bucket.name}" would be updated.`,
      }
    }

    const updateResult = transaction(() => {
      const current = loadBucketById(resolvedBucket.bucket.id)
      if (!current) {
        return {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${resolvedBucket.bucket.id} not found.`,
        }
      }
      const updated = applyBucketUpdatePatch(current, patchInput)
      if (!('id' in updated)) return updated
      if (name !== undefined) {
        const duplicate = query<{ id: string }>(
          'SELECT id FROM cashflow_buckets WHERE LOWER(name) = LOWER($1) AND id <> $2 LIMIT 1',
          [name, current.id]
        )[0]
        if (duplicate) return duplicateBucketNameFailure(name, duplicate.id)
      }

      const result = execute(
        `UPDATE cashflow_buckets
         SET name = $1, description = $2, target_amount = $3, sort_order = $4, is_active = $5,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $6`,
        [
          updated.name,
          updated.description,
          updated.target_amount,
          updated.sort_order,
          updated.is_active,
          current.id,
        ]
      )
      assertSingleRowUpdated(result, `Cashflow bucket ${current.id} could not be updated safely.`)
      writeAuditLog({
        entity: 'cashflow_bucket',
        entityId: current.id,
        action: 'update',
        before: { bucket: bucketSnapshot(current) },
        after: { bucket: bucketSnapshot(updated) },
      })
      return { success: true as const, current, updated }
    })
    if (!updateResult.success) return updateResult

    return {
      success: true,
      action: 'updated' as const,
      matchedBy: resolvedBucket.matchedBy,
      bucket: bucketSnapshot(updateResult.updated),
      message: `Updated cashflow bucket "${updateResult.updated.name}".`,
    }
  },
}

const deleteBucket: ToolDefinition = {
  name: 'delete-bucket',
  description:
    'Delete a cashflow bucket only when it is truly empty and has no allocation history. Funded or referenced buckets must be deactivated with update-bucket.',
  schema: z.object({
    bucketId: boundedText('Bucket ID', 'Cashflow bucket ID', 128).optional(),
    bucketName: boundedText('Bucket name', 'Cashflow bucket name', 120).optional(),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({ bucketId, bucketName, dryRun }) => {
    const resolvedBucket = resolveBucket(bucketId, bucketName)
    if (!resolvedBucket.success) return resolvedBucket
    const historyCount =
      query<{ count: number }>(
        'SELECT COUNT(*) as count FROM cashflow_bucket_allocations WHERE bucket_id = $1',
        [resolvedBucket.bucket.id]
      )[0]?.count ?? 0
    if (resolvedBucket.bucket.balance !== 0 || historyCount > 0) {
      return cannotDeleteBucketFailure(resolvedBucket.bucket)
    }

    if (dryRun) {
      return {
        success: true,
        action: 'deleted' as const,
        dryRun: true,
        matchedBy: resolvedBucket.matchedBy,
        wouldDelete: bucketSnapshot(resolvedBucket.bucket),
        message: `Dry run: cashflow bucket "${resolvedBucket.bucket.name}" would be deleted.`,
      }
    }

    const deleteResult = transaction(() => {
      const current = loadBucketById(resolvedBucket.bucket.id)
      if (!current) {
        return {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${resolvedBucket.bucket.id} not found.`,
        }
      }
      const currentHistory =
        query<{ count: number }>(
          'SELECT COUNT(*) as count FROM cashflow_bucket_allocations WHERE bucket_id = $1',
          [current.id]
        )[0]?.count ?? 0
      if (current.balance !== 0 || currentHistory > 0) {
        return cannotDeleteBucketFailure(current)
      }
      const result = execute('DELETE FROM cashflow_buckets WHERE id = $1', [current.id])
      assertSingleRowUpdated(result, `Cashflow bucket ${current.id} could not be deleted safely.`)
      writeAuditLog({
        entity: 'cashflow_bucket',
        entityId: current.id,
        action: 'delete',
        before: { bucket: bucketSnapshot(current) },
        after: null,
      })
      return { success: true as const, current }
    })
    if (!deleteResult.success) return deleteResult

    return {
      success: true,
      action: 'deleted' as const,
      matchedBy: resolvedBucket.matchedBy,
      bucket: bucketSnapshot(deleteResult.current),
      message: `Deleted cashflow bucket "${deleteResult.current.name}".`,
    }
  },
}

function buildReversal(
  original: CashflowAllocationRow,
  allocationDate?: string,
  source?: string,
  note?: string
): Failure | BuiltReversal {
  const reversedAmount = requireSafeSum(
    0,
    -original.amount,
    `Reversal of allocation ${original.id} exceeds the safe integer range.`
  )
  if (typeof reversedAmount !== 'number') return reversedAmount
  const reversal: CashflowAllocationRow = {
    id: generateId(),
    bucket_id: original.bucket_id,
    transaction_id: original.transaction_id,
    amount: reversedAmount,
    currency: original.currency,
    allocation_date: allocationDate ?? dayjs().format('YYYY-MM-DD'),
    source: source ?? original.source,
    note: note ?? original.note,
    reverses_allocation_id: original.id,
    replaces_allocation_id: null,
  }
  return { success: true as const, reversal }
}

const reverseBucketAllocation: ToolDefinition = {
  name: 'reverse-bucket-allocation',
  description:
    'Append an equal negative reversal for a positive cashflow allocation. Original rows are preserved. Does not change real account balances or transactions.',
  schema: z.object({
    allocationId: boundedText('Allocation ID', 'Original cashflow allocation ID', 128),
    allocationDate: isoDate('Reversal date in YYYY-MM-DD format').optional(),
    source: z.string().trim().max(120).optional().describe('Optional reversal source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional reversal note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({ allocationId, allocationDate, source, note, dryRun }) => {
    const loaded = loadAllocationById(allocationId)
    if (!loaded.success) return loaded
    const reversible = assertReversible(loaded.allocation)
    if (!reversible.success) return reversible
    const originalCurrency = parseCurrencyCode(loaded.allocation.currency)
    if (!originalCurrency) {
      return malformedCurrencyFailure(
        `Allocation ${loaded.allocation.id} has malformed or ambiguous currency evidence.`
      )
    }

    const originalBucket = loadBucketById(loaded.allocation.bucket_id)
    if (!originalBucket) {
      return {
        success: false,
        reason: 'bucket_not_found',
        message: `Cashflow bucket ${loaded.allocation.bucket_id} not found.`,
      }
    }
    const bucketCurrency = parseCurrencyCode(originalBucket.currency)
    if (!bucketCurrency || bucketCurrency !== originalCurrency) {
      return malformedCurrencyFailure(
        `Allocation ${loaded.allocation.id} currency does not match its bucket; refusing to guess.`
      )
    }

    const built = buildReversal(loaded.allocation, allocationDate, source, note)
    if (!built.success) return built
    const nextBalance = requireSafeSum(
      originalBucket.balance,
      built.reversal.amount,
      `Cashflow bucket "${originalBucket.name}" balance exceeds the safe integer range.`
    )
    if (typeof nextBalance !== 'number') return nextBalance
    const updatedBucket: CashflowBucketRow = { ...originalBucket, balance: nextBalance }

    if (dryRun) {
      return {
        success: true,
        action: 'reversed' as const,
        dryRun: true,
        wouldReverse: {
          original: allocationSnapshot(loaded.allocation),
          reversal: allocationSnapshot(built.reversal),
          bucketBefore: bucketSnapshot(originalBucket),
          bucketAfter: bucketSnapshot(updatedBucket),
        },
        message: `Dry run: allocation ${loaded.allocation.id} would be reversed.`,
      }
    }

    const reverseResult = transaction(() => {
      const currentAllocation = loadAllocationById(allocationId)
      if (!currentAllocation.success) return currentAllocation
      const currentReversible = assertReversible(currentAllocation.allocation)
      if (!currentReversible.success) return currentReversible
      const currentBucket = loadBucketById(currentAllocation.allocation.bucket_id)
      if (!currentBucket) {
        return {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${currentAllocation.allocation.bucket_id} not found.`,
        }
      }
      const currentCurrency = parseCurrencyCode(currentAllocation.allocation.currency)
      const currentBucketCurrency = parseCurrencyCode(currentBucket.currency)
      if (
        !currentCurrency ||
        !currentBucketCurrency ||
        currentCurrency !== currentBucketCurrency ||
        currentCurrency !== built.reversal.currency
      ) {
        return malformedCurrencyFailure(
          `Allocation ${currentAllocation.allocation.id} currency does not match its bucket; refusing to guess.`
        )
      }
      const currentNextBalance = requireSafeSum(
        currentBucket.balance,
        built.reversal.amount,
        `Cashflow bucket "${currentBucket.name}" balance exceeds the safe integer range.`
      )
      if (typeof currentNextBalance !== 'number') return currentNextBalance

      insertLinkedAllocation(built.reversal)
      applyBucketBalanceDelta(currentBucket.id, built.reversal.amount)
      writeAuditLog({
        entity: 'cashflow_bucket_allocation',
        entityId: built.reversal.id,
        action: 'reverse',
        before: {
          bucket: bucketSnapshot(currentBucket),
          allocation: allocationSnapshot(currentAllocation.allocation),
        },
        after: {
          bucket: bucketSnapshot({ ...currentBucket, balance: currentNextBalance }),
          allocation: allocationSnapshot(built.reversal),
          reversedAllocationId: currentAllocation.allocation.id,
        },
        source: built.reversal.source,
        note: built.reversal.note,
      })
      return {
        success: true as const,
        bucket: { ...currentBucket, balance: currentNextBalance },
        original: currentAllocation.allocation,
      }
    })
    if (!reverseResult.success) return reverseResult

    return {
      success: true,
      action: 'reversed' as const,
      original: allocationSnapshot(reverseResult.original),
      reversal: allocationSnapshot(built.reversal),
      bucket: bucketSnapshot(reverseResult.bucket),
      sourceAccount: null,
      message: `Reversed allocation ${reverseResult.original.id}.`,
    }
  },
}

const correctBucketAllocation: ToolDefinition = {
  name: 'correct-bucket-allocation',
  description:
    'Atomically reverse an original cashflow allocation and insert a replacement or reallocation. Real account balances and transactions are never changed.',
  schema: z.object({
    allocationId: boundedText('Allocation ID', 'Original cashflow allocation ID', 128),
    bucketId: boundedText('Bucket ID', 'Replacement cashflow bucket ID', 128).optional(),
    bucketName: boundedText('Bucket name', 'Replacement cashflow bucket name', 120).optional(),
    amount: positiveMoneyAmount('Replacement allocation amount in the main currency unit'),
    currency: currencyCode('Replacement allocation currency').optional(),
    transactionId: boundedText(
      'Transaction ID',
      'Optional replacement source income transaction ID',
      128
    ).optional(),
    accountId: boundedText('Account ID', 'Optional source account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional source account alias, ID, or exact name',
      128
    ).optional(),
    allocationDate: isoDate('Replacement date in YYYY-MM-DD format').optional(),
    source: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('Optional replacement source identifier'),
    note: z.string().trim().max(1000).optional().describe('Optional replacement note'),
    dryRun: z.boolean().optional().default(false).describe('Validate and preview without writing'),
  }),
  execute: async ({
    allocationId,
    bucketId,
    bucketName,
    amount,
    currency,
    transactionId,
    accountId,
    account,
    allocationDate,
    source,
    note,
    dryRun,
  }) => {
    const loaded = loadAllocationById(allocationId)
    if (!loaded.success) return loaded
    const reversible = assertReversible(loaded.allocation)
    if (!reversible.success) return reversible
    const originalCurrency = parseCurrencyCode(loaded.allocation.currency)
    if (!originalCurrency) {
      return malformedCurrencyFailure(
        `Allocation ${loaded.allocation.id} has malformed or ambiguous currency evidence.`
      )
    }

    const originalBucket = loadBucketById(loaded.allocation.bucket_id)
    if (!originalBucket) {
      return {
        success: false,
        reason: 'bucket_not_found',
        message: `Cashflow bucket ${loaded.allocation.bucket_id} not found.`,
      }
    }
    const originalBucketCurrency = parseCurrencyCode(originalBucket.currency)
    if (!originalBucketCurrency || originalBucketCurrency !== originalCurrency) {
      return malformedCurrencyFailure(
        `Allocation ${loaded.allocation.id} currency does not match its bucket; refusing to guess.`
      )
    }

    const hasTarget = Boolean(bucketId || bucketName)
    const resolvedTarget = hasTarget
      ? resolveBucket(bucketId, bucketName)
      : { success: true as const, bucket: originalBucket, matchedBy: 'original' as const }
    if (!resolvedTarget.success) return resolvedTarget
    if (resolvedTarget.bucket.is_active !== 1) {
      return inactiveBucketFailure(resolvedTarget.bucket)
    }

    const replacementAmount = toCentavos(amount)
    if (!Number.isSafeInteger(replacementAmount) || replacementAmount <= 0) {
      return unsafeAmountFailure('Replacement amount must convert to a positive safe integer.')
    }

    const boundToOriginalSource = transactionId === undefined
    const replacementTransactionId =
      transactionId === undefined ? loaded.allocation.transaction_id : transactionId
    const sourceTx = replacementTransactionId
      ? getSourceIncomeTransaction(replacementTransactionId)
      : null
    if (sourceTx && !sourceTx.success) return sourceTx

    const resolvedAccount = accountId || account ? resolveAccountId(accountId, account) : null
    if (resolvedAccount && !resolvedAccount.success) return resolvedAccount
    if (
      sourceTx?.success &&
      resolvedAccount?.success &&
      sourceTx.transaction.account_id !== resolvedAccount.id
    ) {
      return {
        success: false,
        reason: 'source_account_mismatch',
        message: `Source transaction ${sourceTx.transaction.id} belongs to account ${sourceTx.transaction.account_id}, not ${resolvedAccount.id}.`,
      }
    }

    const targetCurrency = parseCurrencyCode(resolvedTarget.bucket.currency)
    if (!targetCurrency) {
      return malformedCurrencyFailure(
        `Cashflow bucket "${resolvedTarget.bucket.name}" has malformed or ambiguous currency evidence.`
      )
    }
    const replacementCurrency = parseCurrencyCode(
      currency ?? (sourceTx?.success ? sourceTx.transaction.currency : null) ?? targetCurrency
    )
    if (!replacementCurrency) {
      return malformedCurrencyFailure(
        'Replacement currency evidence is malformed or ambiguous; refusing to guess.'
      )
    }
    if (replacementCurrency !== targetCurrency) {
      return bucketCurrencyFailure(replacementCurrency, targetCurrency)
    }
    if (sourceTx?.success) {
      const sourceCurrency = parseCurrencyCode(sourceTx.transaction.currency)
      if (!sourceCurrency || sourceCurrency !== replacementCurrency) {
        return sourceCurrency
          ? {
              success: false,
              reason: 'source_transaction_currency_changed',
              message: `Source transaction ${sourceTx.transaction.id} currency is ${sourceCurrency}, not ${replacementCurrency}.`,
            }
          : malformedCurrencyFailure(
              `Source transaction ${sourceTx.transaction.id} has malformed or ambiguous currency evidence.`
            )
      }
    }

    if (sourceTx?.success) {
      const alreadyAllocated = sourceAllocatedTotal(sourceTx.transaction.id)
      if (typeof alreadyAllocated !== 'number') return alreadyAllocated
      const unwound =
        boundToOriginalSource || sourceTx.transaction.id === loaded.allocation.transaction_id
          ? requireSafeSum(
              alreadyAllocated,
              -loaded.allocation.amount,
              `Source transaction ${sourceTx.transaction.id} allocated total exceeds the safe integer range.`
            )
          : alreadyAllocated
      if (typeof unwound !== 'number') return unwound
      const nextAllocated = requireSafeSum(
        unwound,
        replacementAmount,
        `Source transaction ${sourceTx.transaction.id} allocated total exceeds the safe integer range.`
      )
      if (typeof nextAllocated !== 'number') return nextAllocated
      if (nextAllocated > sourceTx.transaction.amount) {
        return sourceOverallocatedFailure(
          sourceTx.transaction.id,
          sourceTx.transaction.amount - unwound,
          replacementCurrency
        )
      }
    }

    const built = buildReversal(
      loaded.allocation,
      allocationDate,
      source ?? loaded.allocation.source,
      note
    )
    if (!built.success) return built
    const replacement: CashflowAllocationRow = {
      id: generateId(),
      bucket_id: resolvedTarget.bucket.id,
      transaction_id: sourceTx?.success ? sourceTx.transaction.id : null,
      amount: replacementAmount,
      currency: replacementCurrency,
      allocation_date: allocationDate ?? dayjs().format('YYYY-MM-DD'),
      source:
        source ??
        (sourceTx?.success
          ? (loaded.allocation.source ?? 'income-transaction')
          : loaded.allocation.source),
      note: note ?? loaded.allocation.note,
      reverses_allocation_id: null,
      replaces_allocation_id: loaded.allocation.id,
    }

    const originalNextBalance = requireSafeSum(
      originalBucket.balance,
      built.reversal.amount,
      `Cashflow bucket "${originalBucket.name}" balance exceeds the safe integer range.`
    )
    if (typeof originalNextBalance !== 'number') return originalNextBalance
    const targetBeforeBalance =
      resolvedTarget.bucket.id === originalBucket.id
        ? originalNextBalance
        : resolvedTarget.bucket.balance
    const targetNextBalance = requireSafeSum(
      targetBeforeBalance,
      replacement.amount,
      `Cashflow bucket "${resolvedTarget.bucket.name}" balance exceeds the safe integer range.`
    )
    if (typeof targetNextBalance !== 'number') return targetNextBalance

    const originalAfter: CashflowBucketRow = {
      ...originalBucket,
      balance:
        originalBucket.id === resolvedTarget.bucket.id ? targetNextBalance : originalNextBalance,
    }
    const targetAfter: CashflowBucketRow = {
      ...resolvedTarget.bucket,
      balance: targetNextBalance,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'corrected' as const,
        dryRun: true,
        wouldCorrect: {
          original: allocationSnapshot(loaded.allocation),
          reversal: allocationSnapshot(built.reversal),
          replacement: allocationSnapshot(replacement),
          originalBucketBefore: bucketSnapshot(originalBucket),
          originalBucketAfter: bucketSnapshot(originalAfter),
          targetBucketBefore: bucketSnapshot(resolvedTarget.bucket),
          targetBucketAfter: bucketSnapshot(targetAfter),
          sourceAccount: sourceAccountSnapshot(resolvedAccount),
        },
        message: `Dry run: allocation ${loaded.allocation.id} would be corrected.`,
      }
    }

    const correctResult = transaction(() => {
      const currentAllocation = loadAllocationById(allocationId)
      if (!currentAllocation.success) return currentAllocation
      const currentReversible = assertReversible(currentAllocation.allocation)
      if (!currentReversible.success) return currentReversible

      const currentOriginalBucket = loadBucketById(currentAllocation.allocation.bucket_id)
      if (!currentOriginalBucket) {
        return {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${currentAllocation.allocation.bucket_id} not found.`,
        }
      }
      const currentTargetBucket = loadBucketById(resolvedTarget.bucket.id)
      if (!currentTargetBucket) {
        return {
          success: false as const,
          reason: 'bucket_not_found',
          message: `Cashflow bucket ${resolvedTarget.bucket.id} not found.`,
        }
      }
      if (currentTargetBucket.is_active !== 1) {
        return inactiveBucketFailure(currentTargetBucket)
      }

      const currentOriginalCurrency = parseCurrencyCode(currentAllocation.allocation.currency)
      const currentOriginalBucketCurrency = parseCurrencyCode(currentOriginalBucket.currency)
      const currentTargetCurrency = parseCurrencyCode(currentTargetBucket.currency)
      if (
        !currentOriginalCurrency ||
        !currentOriginalBucketCurrency ||
        currentOriginalCurrency !== currentOriginalBucketCurrency ||
        !currentTargetCurrency ||
        currentTargetCurrency !== replacement.currency
      ) {
        return malformedCurrencyFailure(
          'Bucket or allocation currency evidence is malformed, ambiguous, or no longer matches; refusing to guess.'
        )
      }

      if (replacement.transaction_id) {
        const currentSourceTx = getSourceIncomeTransaction(replacement.transaction_id)
        if (!currentSourceTx.success) return currentSourceTx
        if (
          resolvedAccount?.success &&
          currentSourceTx.transaction.account_id !== resolvedAccount.id
        ) {
          return {
            success: false as const,
            reason: 'source_account_mismatch',
            message: `Source transaction ${currentSourceTx.transaction.id} belongs to account ${currentSourceTx.transaction.account_id}, not ${resolvedAccount.id}.`,
          }
        }
        const currentSourceCurrency = parseCurrencyCode(currentSourceTx.transaction.currency)
        if (!currentSourceCurrency || currentSourceCurrency !== replacement.currency) {
          return currentSourceCurrency
            ? {
                success: false as const,
                reason: 'source_transaction_currency_changed',
                message: `Source transaction ${currentSourceTx.transaction.id} currency is ${currentSourceCurrency}, not ${replacement.currency}.`,
              }
            : malformedCurrencyFailure(
                `Source transaction ${currentSourceTx.transaction.id} has malformed or ambiguous currency evidence.`
              )
        }
        const alreadyAllocated = sourceAllocatedTotal(currentSourceTx.transaction.id)
        if (typeof alreadyAllocated !== 'number') return alreadyAllocated
        const unwound =
          currentSourceTx.transaction.id === currentAllocation.allocation.transaction_id
            ? requireSafeSum(
                alreadyAllocated,
                -currentAllocation.allocation.amount,
                `Source transaction ${currentSourceTx.transaction.id} allocated total exceeds the safe integer range.`
              )
            : alreadyAllocated
        if (typeof unwound !== 'number') return unwound
        const nextAllocated = requireSafeSum(
          unwound,
          replacement.amount,
          `Source transaction ${currentSourceTx.transaction.id} allocated total exceeds the safe integer range.`
        )
        if (typeof nextAllocated !== 'number') return nextAllocated
        if (nextAllocated > currentSourceTx.transaction.amount) {
          return sourceOverallocatedFailure(
            currentSourceTx.transaction.id,
            currentSourceTx.transaction.amount - unwound,
            replacement.currency
          )
        }
      }

      const currentOriginalNext = requireSafeSum(
        currentOriginalBucket.balance,
        built.reversal.amount,
        `Cashflow bucket "${currentOriginalBucket.name}" balance exceeds the safe integer range.`
      )
      if (typeof currentOriginalNext !== 'number') return currentOriginalNext
      const currentTargetBefore =
        currentTargetBucket.id === currentOriginalBucket.id
          ? currentOriginalNext
          : currentTargetBucket.balance
      const currentTargetNext = requireSafeSum(
        currentTargetBefore,
        replacement.amount,
        `Cashflow bucket "${currentTargetBucket.name}" balance exceeds the safe integer range.`
      )
      if (typeof currentTargetNext !== 'number') return currentTargetNext

      insertLinkedAllocation(built.reversal)
      insertLinkedAllocation(replacement)
      if (currentOriginalBucket.id === currentTargetBucket.id) {
        applyBucketBalanceDelta(
          currentTargetBucket.id,
          built.reversal.amount + replacement.amount,
          { requireActive: true }
        )
      } else {
        applyBucketBalanceDelta(currentOriginalBucket.id, built.reversal.amount)
        applyBucketBalanceDelta(currentTargetBucket.id, replacement.amount, { requireActive: true })
      }
      writeAuditLog({
        entity: 'cashflow_bucket_allocation',
        entityId: replacement.id,
        action: 'correct',
        before: {
          originalBucket: bucketSnapshot(currentOriginalBucket),
          targetBucket: bucketSnapshot(currentTargetBucket),
          allocation: allocationSnapshot(currentAllocation.allocation),
        },
        after: {
          originalBucket: bucketSnapshot({
            ...currentOriginalBucket,
            balance:
              currentOriginalBucket.id === currentTargetBucket.id
                ? currentTargetNext
                : currentOriginalNext,
          }),
          targetBucket: bucketSnapshot({ ...currentTargetBucket, balance: currentTargetNext }),
          reversal: allocationSnapshot(built.reversal),
          replacement: allocationSnapshot(replacement),
          replacedAllocationId: currentAllocation.allocation.id,
        },
        source: replacement.source,
        note: replacement.note,
      })
      return {
        success: true as const,
        original: currentAllocation.allocation,
        originalBucket: {
          ...currentOriginalBucket,
          balance:
            currentOriginalBucket.id === currentTargetBucket.id
              ? currentTargetNext
              : currentOriginalNext,
        },
        targetBucket: { ...currentTargetBucket, balance: currentTargetNext },
      }
    })
    if (!correctResult.success) return correctResult

    return {
      success: true,
      action: 'corrected' as const,
      matchedBy: resolvedTarget.matchedBy,
      original: allocationSnapshot(correctResult.original),
      reversal: allocationSnapshot(built.reversal),
      replacement: allocationSnapshot(replacement),
      bucket: bucketSnapshot(correctResult.targetBucket),
      originalBucket: bucketSnapshot(correctResult.originalBucket),
      sourceAccount: sourceAccountSnapshot(resolvedAccount),
      message: `Corrected allocation ${correctResult.original.id}.`,
    }
  },
}

export const cashflowBucketTools: ToolDefinition[] = [
  createBucket,
  listBuckets,
  allocateIncome,
  updateBucket,
  deleteBucket,
  reverseBucketAllocation,
  correctBucketAllocation,
]
