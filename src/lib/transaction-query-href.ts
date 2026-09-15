const UNCATEGORIZED_KEYS = new Set(['', 'uncategorized', 'other'])

export interface TransactionQueryFilters {
  type?: string
  categoryId?: string | null
  dateFrom?: string
  dateTo?: string
  accountId?: string | null
  status?: string
  currency?: string
  reviewReason?: string
}

/** Build a `/transactions` URL using the shared ledger query contract. */
export function buildTransactionsHref(filters: TransactionQueryFilters): string {
  const params = new URLSearchParams()

  if (filters.type) params.set('type', filters.type)

  const categoryId = filters.categoryId?.trim() ?? ''
  if (categoryId && !UNCATEGORIZED_KEYS.has(categoryId.toLowerCase())) {
    params.set('category', categoryId)
  }

  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom)
  if (filters.dateTo) params.set('dateTo', filters.dateTo)
  if (filters.accountId) params.set('account', filters.accountId)
  if (filters.status) params.set('status', filters.status)
  if (filters.currency) params.set('currency', filters.currency)
  if (filters.reviewReason) params.set('reviewReason', filters.reviewReason)

  const query = params.toString()
  return query ? `/transactions?${query}` : '/transactions'
}

export function isRealCategoryId(categoryId: string | null | undefined): boolean {
  const value = categoryId?.trim() ?? ''
  return value.length > 0 && !UNCATEGORIZED_KEYS.has(value.toLowerCase())
}
