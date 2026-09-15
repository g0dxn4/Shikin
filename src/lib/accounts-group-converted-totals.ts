export type ConvertToPreferredFn = (
  amountCentavos: number,
  fromCurrency: string
) => PreferredAmountResult

export type PreferredAmountResult =
  | {
      complete: true
      preferredCurrency: string
      amountCentavos: number
      missingCurrencies: readonly []
    }
  | {
      complete: false
      preferredCurrency: string
      missingCurrencies: ReadonlyArray<string>
      reason: 'missing_exchange_rates' | 'invalid_currency_data'
    }

export type ConvertedTotal =
  | {
      complete: true
      preferredCurrency: string
      amountCentavos: number
      missingCurrencies: readonly []
    }
  | {
      complete: false
      preferredCurrency: string
      amountCentavos: null
      missingCurrencies: readonly string[]
      reason: 'missing_exchange_rates' | 'invalid_currency_data'
    }

export type IncompleteConvertedTotal = Extract<ConvertedTotal, { complete: false }>

export type ConvertibleAmount = {
  amountCentavos: number
  currency: string
}

export type CurrencyGroup = {
  currency: string
  amountCentavos: number
}

export type BalanceLikeAccount = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
}

export type ReceivableLikeItem = {
  status: string
  isOverdue: boolean
  remainingAmount: number
  received_amount: number
  currency: string
}

function emptyComplete(preferredCurrency: string): ConvertedTotal {
  return {
    complete: true,
    preferredCurrency,
    amountCentavos: 0,
    missingCurrencies: [],
  }
}

export function fromPreferredResult(result: PreferredAmountResult): ConvertedTotal {
  if (result.complete) {
    return {
      complete: true,
      preferredCurrency: result.preferredCurrency,
      amountCentavos: result.amountCentavos,
      missingCurrencies: [],
    }
  }

  return {
    complete: false,
    preferredCurrency: result.preferredCurrency,
    amountCentavos: null,
    missingCurrencies: [...result.missingCurrencies],
    reason: result.reason,
  }
}

/** Sum converted amounts only when every conversion is complete. Never returns a partial total. */
export function sumConvertedAmounts(
  amounts: readonly ConvertibleAmount[],
  convertToPreferred: ConvertToPreferredFn,
  preferredCurrency: string
): ConvertedTotal {
  if (amounts.length === 0) return emptyComplete(preferredCurrency)

  let total = 0
  let resolvedPreferred = preferredCurrency
  const missing = new Set<string>()
  let reason: 'missing_exchange_rates' | 'invalid_currency_data' | undefined

  for (const item of amounts) {
    const result = convertToPreferred(item.amountCentavos, item.currency)
    resolvedPreferred = result.preferredCurrency || resolvedPreferred
    if (result.complete) {
      total += result.amountCentavos
      continue
    }
    reason = result.reason
    for (const currency of result.missingCurrencies) missing.add(currency)
  }

  if (reason) {
    return {
      complete: false,
      preferredCurrency: resolvedPreferred,
      amountCentavos: null,
      missingCurrencies: [...missing].sort(),
      reason,
    }
  }

  return {
    complete: true,
    preferredCurrency: resolvedPreferred,
    amountCentavos: total,
    missingCurrencies: [],
  }
}

export function groupAmountsByCurrency(amounts: readonly ConvertibleAmount[]): CurrencyGroup[] {
  const totals = new Map<string, number>()
  for (const item of amounts) {
    const currency = item.currency.trim().toUpperCase() || 'UNKNOWN'
    totals.set(currency, (totals.get(currency) ?? 0) + item.amountCentavos)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amountCentavos]) => ({ currency, amountCentavos }))
}

function mergeIncomplete(...totals: ConvertedTotal[]): IncompleteConvertedTotal | null {
  const incomplete = totals.filter((total): total is IncompleteConvertedTotal => !total.complete)
  if (incomplete.length === 0) return null
  const missing = new Set<string>()
  let reason: IncompleteConvertedTotal['reason'] = 'missing_exchange_rates'
  let preferredCurrency = totals[0]?.preferredCurrency ?? 'USD'
  for (const total of incomplete) {
    preferredCurrency = total.preferredCurrency
    reason = total.reason
    for (const currency of total.missingCurrencies) missing.add(currency)
  }
  return {
    complete: false,
    preferredCurrency,
    amountCentavos: null,
    missingCurrencies: [...missing].sort(),
    reason,
  }
}

export function buildAccountsLiquidTotals({
  liquidAccounts,
  convertToPreferred,
  getTotalBalanceInPreferred,
  preferredCurrency,
}: {
  liquidAccounts: readonly BalanceLikeAccount[]
  convertToPreferred: ConvertToPreferredFn
  getTotalBalanceInPreferred: (accounts: BalanceLikeAccount[]) => PreferredAmountResult
  preferredCurrency: string
}) {
  const depositAccounts = liquidAccounts.filter((account) => account.type !== 'credit_card')
  const creditAccounts = liquidAccounts.filter((account) => account.type === 'credit_card')

  const net = fromPreferredResult(
    liquidAccounts.length === 0
      ? {
          complete: true,
          preferredCurrency,
          amountCentavos: 0,
          missingCurrencies: [],
        }
      : getTotalBalanceInPreferred([...liquidAccounts])
  )
  const assets = fromPreferredResult(
    depositAccounts.length === 0
      ? {
          complete: true,
          preferredCurrency,
          amountCentavos: 0,
          missingCurrencies: [],
        }
      : getTotalBalanceInPreferred([...depositAccounts])
  )
  const liabilities = sumConvertedAmounts(
    creditAccounts.map((account) => ({
      amountCentavos: Math.max(0, -account.balance),
      currency: account.currency,
    })),
    convertToPreferred,
    preferredCurrency
  )
  const mix = {
    checking: sumConvertedAmounts(
      liquidAccounts
        .filter((account) => account.type === 'checking')
        .map((account) => ({
          amountCentavos: Math.max(0, account.balance),
          currency: account.currency,
        })),
      convertToPreferred,
      preferredCurrency
    ),
    savings: sumConvertedAmounts(
      liquidAccounts
        .filter((account) => account.type === 'savings')
        .map((account) => ({
          amountCentavos: Math.max(0, account.balance),
          currency: account.currency,
        })),
      convertToPreferred,
      preferredCurrency
    ),
    credit: liabilities,
  }

  return {
    net,
    assets,
    liabilities,
    mix,
    accountCount: liquidAccounts.length,
    conversionIssue: mergeIncomplete(net, assets, liabilities, mix.checking, mix.savings),
    groupedNet: groupAmountsByCurrency(
      liquidAccounts.map((account) => ({
        amountCentavos: account.balance,
        currency: account.currency,
      }))
    ),
  }
}

export function buildReceivablesStatusTotals({
  receivables,
  convertToPreferred,
  preferredCurrency,
}: {
  receivables: readonly ReceivableLikeItem[]
  convertToPreferred: ConvertToPreferredFn
  preferredCurrency: string
}) {
  const active = receivables.filter((item) => item.status !== 'cancelled')
  const outstanding = sumConvertedAmounts(
    active.map((item) => ({
      amountCentavos: item.remainingAmount,
      currency: item.currency,
    })),
    convertToPreferred,
    preferredCurrency
  )
  const overdue = sumConvertedAmounts(
    active
      .filter((item) => item.isOverdue)
      .map((item) => ({
        amountCentavos: item.remainingAmount,
        currency: item.currency,
      })),
    convertToPreferred,
    preferredCurrency
  )
  const received = sumConvertedAmounts(
    active.map((item) => ({
      amountCentavos: item.received_amount,
      currency: item.currency,
    })),
    convertToPreferred,
    preferredCurrency
  )

  return {
    outstanding,
    overdue,
    received,
    conversionIssue: mergeIncomplete(outstanding, overdue, received),
    groupedOutstanding: groupAmountsByCurrency(
      active.map((item) => ({
        amountCentavos: item.remainingAmount,
        currency: item.currency,
      }))
    ),
  }
}
