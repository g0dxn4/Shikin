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
  account_name: string | null
  account_is_archived: number | null
}

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
    createdAt: allocation.created_at ?? null,
  }
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
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

function getSourceIncomeTransaction(transactionId: string) {
  const tx = query<SourceIncomeTransactionRow>(
    `SELECT t.id, t.account_id, t.type, t.amount, t.currency, t.description, t.date, t.status,
            a.name as account_name, a.is_archived as account_is_archived
     FROM transactions t
     LEFT JOIN accounts a ON t.account_id = a.id
     WHERE t.id = $1
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
  if (tx.account_is_archived === 1) {
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

  return { success: true as const, transaction: tx }
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
      return {
        success: false,
        reason: 'bucket_inactive',
        message: `Cashflow bucket "${bucket.name}" is inactive. Activate it before allocating income.`,
      }
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
    const allocationCurrency = normalizeCurrencyCode(
      currency ??
        (sourceTx?.success ? sourceTx.transaction.currency : null) ??
        (resolvedAccount?.success ? resolvedAccount.currency : null) ??
        bucket.currency
    )
    const bucketCurrency = normalizeCurrencyCode(bucket.currency)
    if (!allocationCurrency || allocationCurrency !== bucketCurrency) {
      return {
        success: false,
        reason: 'bucket_currency_mismatch',
        message: `Allocation currency ${allocationCurrency || '(missing)'} does not match bucket currency ${bucketCurrency}.`,
      }
    }

    if (sourceTx?.success) {
      const alreadyAllocated =
        (query<{ total: number | null }>(
          'SELECT COALESCE(SUM(amount), 0) as total FROM cashflow_bucket_allocations WHERE transaction_id = $1',
          [sourceTx.transaction.id]
        ) ?? [])[0]?.total ?? 0
      if (alreadyAllocated + amountCentavos > sourceTx.transaction.amount) {
        return {
          success: false,
          reason: 'source_transaction_overallocated',
          message: `Source transaction ${sourceTx.transaction.id} has ${fromCentavos(sourceTx.transaction.amount - alreadyAllocated).toFixed(2)} ${allocationCurrency} remaining to allocate.`,
          remainingAmount: fromCentavos(
            Math.max(sourceTx.transaction.amount - alreadyAllocated, 0)
          ),
        }
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
    const updatedBucket: CashflowBucketRow = { ...bucket, balance: bucket.balance + amountCentavos }

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
          sourceAccount: resolvedAccount?.success
            ? { id: resolvedAccount.id, currency: resolvedAccount.currency, persisted: false }
            : null,
        },
        message: `Dry run: ${amount.toFixed(2)} ${allocationCurrency} would be allocated to "${bucket.name}".`,
      }
    }

    const allocationResult = transaction(() => {
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

        const alreadyAllocated =
          (query<{ total: number | null }>(
            'SELECT COALESCE(SUM(amount), 0) as total FROM cashflow_bucket_allocations WHERE transaction_id = $1',
            [currentSourceTx.transaction.id]
          ) ?? [])[0]?.total ?? 0
        if (alreadyAllocated + amountCentavos > currentSourceTx.transaction.amount) {
          return {
            success: false as const,
            reason: 'source_transaction_overallocated',
            message: `Source transaction ${currentSourceTx.transaction.id} has ${fromCentavos(currentSourceTx.transaction.amount - alreadyAllocated).toFixed(2)} ${allocationCurrency} remaining to allocate.`,
            remainingAmount: fromCentavos(
              Math.max(currentSourceTx.transaction.amount - alreadyAllocated, 0)
            ),
          }
        }
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
      const bucketUpdate = execute(
        "UPDATE cashflow_buckets SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [allocation.amount, bucket.id]
      )
      assertSingleRowUpdated(
        bucketUpdate,
        `Cashflow bucket ${bucket.id} could not be updated safely.`
      )
      writeAuditLog({
        entity: 'cashflow_bucket_allocation',
        entityId: allocation.id,
        action: 'allocate',
        before: { bucket: bucketSnapshot(bucket) },
        after: {
          bucket: bucketSnapshot(updatedBucket),
          allocation: allocationSnapshot(allocation),
        },
        source: allocation.source,
        note: allocation.note,
      })
      return { success: true as const }
    })
    if (!allocationResult.success) return allocationResult

    return {
      success: true,
      action: 'allocated' as const,
      matchedBy: resolvedBucket.matchedBy,
      allocation: allocationSnapshot(allocation),
      bucket: bucketSnapshot(updatedBucket),
      sourceAccount: resolvedAccount?.success
        ? { id: resolvedAccount.id, currency: resolvedAccount.currency, persisted: false }
        : null,
      message: `Allocated ${amount.toFixed(2)} ${allocationCurrency} to "${bucket.name}".`,
    }
  },
}

export const cashflowBucketTools: ToolDefinition[] = [createBucket, listBuckets, allocateIncome]
