export const TRANSACTION_PAGE_INVALIDATION_EVENT = 'shikin:transaction-page-invalidate'

export type TransactionPageInvalidationReason =
  | 'add'
  | 'edit'
  | 'delete'
  | 'review'
  | 'import'
  | 'store-refresh'

/** The single public invalidation entrypoint for transaction page reads. */
export function invalidateTransactionPage(reason: TransactionPageInvalidationReason): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent<TransactionPageInvalidationReason>(TRANSACTION_PAGE_INVALIDATION_EVENT, {
      detail: reason,
    })
  )
}
