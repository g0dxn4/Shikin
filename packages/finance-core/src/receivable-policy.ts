export type ReceivableStatus = 'open' | 'partial' | 'received' | 'cancelled'

/** Stored evidence used by maintenance, never by matching or unmatching. */
export interface ReceivablePolicyRow {
  amount: number
  received_amount: number
  currency: string
  account_id: string | null
  status: ReceivableStatus
  matched_transaction_id: string | null
  updated_at: string
}

export interface ReceivablePolicyAccount {
  currency: string
  is_archived: number
}

export type ReceivablePolicyFailure = {
  success: false
  reason:
    | 'invalid_receivable_amount'
    | 'receivable_has_receipts'
    | 'amount_below_received'
    | 'account_unavailable'
    | 'receivable_currency_mismatch'
  message: string
}

export function receivableStatusForAmounts(
  amount: number,
  receivedAmount: number
): { success: true; status: Exclude<ReceivableStatus, 'cancelled'> } | ReceivablePolicyFailure {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return {
      success: false,
      reason: 'invalid_receivable_amount',
      message: 'Receivable amount must be a positive safe integer number of centavos.',
    }
  }
  return {
    success: true,
    status: receivedAmount >= amount ? 'received' : receivedAmount > 0 ? 'partial' : 'open',
  }
}

export function checkReceivableAccount(
  accountId: string | null,
  currency: string,
  account: ReceivablePolicyAccount | null
): ReceivablePolicyFailure | null {
  if (accountId === null) return null
  if (!account || account.is_archived !== 0) {
    return {
      success: false,
      reason: 'account_unavailable',
      message: 'The linked account is unavailable or archived.',
    }
  }
  if (account.currency.trim().toUpperCase() !== currency.trim().toUpperCase()) {
    return {
      success: false,
      reason: 'receivable_currency_mismatch',
      message: 'Receivable currency must match the linked account currency.',
    }
  }
  return null
}

export function planReceivableUpdate(
  existing: ReceivablePolicyRow,
  changes: { amount?: number; currency?: string; accountId?: string | null },
  account: ReceivablePolicyAccount | null
):
  | {
      success: true
      expected: ReceivablePolicyRow
      amount: number
      currency: string
      accountId: string | null
      status: ReceivableStatus
    }
  | ReceivablePolicyFailure {
  const amount = changes.amount ?? existing.amount
  const amounts = receivableStatusForAmounts(amount, existing.received_amount)
  if (!amounts.success) return amounts
  const canonicalCurrency = (changes.currency ?? existing.currency).trim().toUpperCase()
  const currencyChanged = canonicalCurrency !== existing.currency.trim().toUpperCase()
  const accountId = changes.accountId === undefined ? existing.account_id : changes.accountId
  if (
    existing.received_amount > 0 &&
    (amount !== existing.amount || currencyChanged || accountId !== existing.account_id)
  ) {
    return {
      success: false,
      reason: 'receivable_has_receipts',
      message: 'Amount, currency, and account cannot change after a receipt is recorded.',
    }
  }
  if (amount < existing.received_amount) {
    return {
      success: false,
      reason: 'amount_below_received',
      message: 'Amount cannot be less than the amount already received.',
    }
  }
  const accountFailure = checkReceivableAccount(accountId, canonicalCurrency, account)
  if (accountFailure) return accountFailure
  return {
    success: true,
    expected: existing,
    amount,
    // A full frontend form is not an instruction to retag unchanged stored money.
    currency: currencyChanged ? canonicalCurrency : existing.currency,
    accountId,
    status: existing.status === 'cancelled' ? 'cancelled' : amounts.status,
  }
}

export function planReceivableRemoval(
  existing: ReceivablePolicyRow,
  action: 'cancel' | 'delete'
): { success: true; expected: ReceivablePolicyRow; changed: boolean } | ReceivablePolicyFailure {
  if (
    existing.received_amount > 0 ||
    existing.matched_transaction_id !== null ||
    (action === 'cancel' && existing.status === 'received')
  ) {
    return {
      success: false,
      reason: 'receivable_has_receipts',
      message:
        action === 'cancel'
          ? 'A receivable with recorded receipts cannot be cancelled.'
          : 'Receivables with recorded receipts cannot be deleted.',
    }
  }
  return {
    success: true,
    expected: existing,
    changed: action === 'delete' || existing.status !== 'cancelled',
  }
}
