import { query, execute } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { TransactionSplitWithCategory } from '@/types/database'

export interface SplitInput {
  categoryId: string
  subcategoryId?: string | null
  amount: number // centavos
  notes?: string | null
}

/**
 * Create splits for a transaction.
 * Validates that split amounts sum exactly to the transaction total.
 */
export async function createSplits(
  transactionId: string,
  splits: SplitInput[],
  transactionAmountCentavos: number,
  tx?: Pick<TransactionClient, 'execute'>
): Promise<void> {
  const splitsTotal = splits.reduce((sum, s) => sum + s.amount, 0)
  if (splitsTotal !== transactionAmountCentavos) {
    throw new Error(
      `Split amounts (${splitsTotal}) must equal transaction total (${transactionAmountCentavos})`
    )
  }

  // Delete any existing splits first
  await deleteSplits(transactionId, tx)

  for (const split of splits) {
    const id = generateId()
    await (tx?.execute ?? execute)(
      `INSERT INTO transaction_splits (id, transaction_id, category_id, subcategory_id, amount, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        transactionId,
        split.categoryId,
        split.subcategoryId ?? null,
        split.amount,
        split.notes ?? null,
      ]
    )
  }
}

/**
 * Get all splits for a transaction with joined category names.
 */
export async function getSplits(transactionId: string): Promise<TransactionSplitWithCategory[]> {
  return query<TransactionSplitWithCategory>(
    `SELECT ts.*, c.name as category_name, c.color as category_color, sc.name as subcategory_name
     FROM transaction_splits ts
     LEFT JOIN categories c ON ts.category_id = c.id
     LEFT JOIN subcategories sc ON ts.subcategory_id = sc.id
     WHERE ts.transaction_id = ?
     ORDER BY ts.amount DESC`,
    [transactionId]
  )
}

/**
 * Delete all splits for a transaction.
 */
export async function deleteSplits(
  transactionId: string,
  tx?: Pick<TransactionClient, 'execute'>
): Promise<void> {
  await (tx?.execute ?? execute)('DELETE FROM transaction_splits WHERE transaction_id = ?', [
    transactionId,
  ])
}

/**
 * Check if a transaction has splits.
 */
export async function isSplit(transactionId: string): Promise<boolean> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM transaction_splits WHERE transaction_id = ?',
    [transactionId]
  )
  return rows.length > 0 && rows[0].count > 0
}

/**
 * Get all transaction IDs that have splits (for batch checking).
 */
export async function getSplitTransactionIds(): Promise<Set<string>> {
  const rows = await query<{ transaction_id: string }>(
    'SELECT DISTINCT transaction_id FROM transaction_splits'
  )
  return new Set(rows.map((r) => r.transaction_id))
}
