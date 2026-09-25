import type { TransactionPageRow } from '@/lib/transaction-query'

/** The store remains authoritative; these gates only avoid presenting unusable actions. */
export type TransactionProtectionKey =
  | 'dialog.archived'
  | 'review.protected.receivable'
  | 'review.protected.reconciliation'
  | 'review.protected.linked'
  | 'review.protected.workflow'
  | 'review.protected.placeholderLifecycle'

export function transactionProtection(
  transaction: TransactionPageRow
): TransactionProtectionKey | null {
  if (transaction.is_archived === 1) return 'dialog.archived'
  if (transaction.is_receivable_payment) return 'review.protected.receivable'
  if (transaction.is_reconciliation_adjustment) return 'review.protected.reconciliation'
  if (transaction.matched_transaction_id) return 'review.protected.linked'
  if ((transaction.transaction_kind ?? 'standard') !== 'standard')
    return 'review.protected.workflow'
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') !== 'unresolved'
  )
    return 'review.protected.placeholderLifecycle'
  return null
}

export function isEligibleLegacyImportIdentityRow(transaction: TransactionPageRow): boolean {
  if (transaction.is_archived === 1) return false
  if ((transaction.transaction_kind ?? 'standard') !== 'standard') return false
  if (
    transaction.import_content_fingerprint !== null &&
    transaction.import_content_fingerprint !== undefined
  )
    return false
  // Missing projections are not proof that an import identity is unbound.
  return (
    transaction.import_source === null &&
    transaction.import_external_id === null &&
    transaction.import_fingerprint === null
  )
}
