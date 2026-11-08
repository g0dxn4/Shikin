import type { TransactionPageRow } from '@/lib/transaction-query'

/** The store remains authoritative; these gates only avoid presenting unusable actions. */
export type TransactionProtectionKey =
  | 'dialog.archived'
  | 'review.protected.receivable'
  | 'review.protected.reconciliation'
  | 'review.protected.linked'
  | 'review.protected.workflow'
  | 'review.protected.placeholderLifecycle'

export type TransactionReviewProtectionKey =
  | Exclude<TransactionProtectionKey, 'dialog.archived'>
  | 'review.protected.split'
  | 'review.protected.finalized'
  | 'review.protected.transfer'

type SharedProtectionKey = Exclude<TransactionProtectionKey, 'dialog.archived'>

function provenanceProtection(transaction: TransactionPageRow): SharedProtectionKey | null {
  if (transaction.is_receivable_payment) return 'review.protected.receivable'
  if (transaction.is_reconciliation_adjustment) return 'review.protected.reconciliation'
  return null
}

function workflowProtection(transaction: TransactionPageRow): SharedProtectionKey | null {
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

export function transactionProtection(
  transaction: TransactionPageRow
): TransactionProtectionKey | null {
  if (transaction.is_archived === 1) return 'dialog.archived'
  return provenanceProtection(transaction) ?? workflowProtection(transaction)
}

/** Inline review deliberately uses its own order and only the finalized projection. */
export function transactionReviewProtection(
  transaction: TransactionPageRow
): TransactionReviewProtectionKey | null {
  if (transaction.has_splits) return 'review.protected.split'
  const provenance = provenanceProtection(transaction)
  if (provenance) return provenance
  if (transaction.is_finalized_statement) return 'review.protected.finalized'
  const workflow = workflowProtection(transaction)
  if (workflow) return workflow
  if (transaction.type === 'transfer') return 'review.protected.transfer'
  return null
}

/** Splits and finalization lock financial fields, not the metadata correction form. */
export function isTransactionMetadataOnly(transaction: TransactionPageRow): boolean {
  return !!(
    transaction.has_splits ||
    transaction.is_finalized_statement ||
    transaction.finalization_id
  )
}

export function canDeleteTransaction(transaction: TransactionPageRow): boolean {
  return (
    !transactionProtection(transaction) &&
    !transaction.is_finalized_statement &&
    !transaction.finalization_id
  )
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
