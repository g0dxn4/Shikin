export type ConvertToPreferredFn = (
  amountCentavos: number,
  fromCurrency: string
) => PreferredAmountResult

export type ConversionIssueReason =
  | 'main_currency_unconfigured'
  | 'missing_exchange_rates'
  | 'invalid_currency_data'

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
      reason: ConversionIssueReason
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
      reason: ConversionIssueReason
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

function emptyResult(preferredCurrency: string, mainCurrency: string | null): ConvertedTotal {
  if (!mainCurrency) {
    return {
      complete: false,
      preferredCurrency,
      amountCentavos: null,
      missingCurrencies: [],
      reason: 'main_currency_unconfigured',
    }
  }
  return {
    complete: true,
    preferredCurrency: mainCurrency,
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

/** Sum current converted amounts only when every conversion is complete. */
export function sumConvertedAmounts(
  amounts: readonly ConvertibleAmount[],
  convertToPreferred: ConvertToPreferredFn,
  preferredCurrency: string,
  mainCurrency: string | null = preferredCurrency
): ConvertedTotal {
  if (amounts.length === 0) return emptyResult(preferredCurrency, mainCurrency)

  let total = 0
  let resolvedPreferred = preferredCurrency
  const missing = new Set<string>()
  let reason: ConversionIssueReason | undefined

  for (const item of amounts) {
    const result = convertToPreferred(item.amountCentavos, item.currency)
    resolvedPreferred = result.preferredCurrency || resolvedPreferred
    if (result.complete) {
      total += result.amountCentavos
      if (!Number.isSafeInteger(total)) reason = 'invalid_currency_data'
      continue
    }
    if (result.reason === 'invalid_currency_data' || !reason) reason = result.reason
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
    const next = (totals.get(currency) ?? 0) + item.amountCentavos
    if (!Number.isSafeInteger(next)) throw new RangeError('Native currency total is unsafe')
    totals.set(currency, next)
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
  let preferredCurrency = totals[0]?.preferredCurrency ?? ''
  for (const total of incomplete) {
    preferredCurrency = total.preferredCurrency
    if (total.reason === 'invalid_currency_data' || reason !== 'invalid_currency_data') {
      reason = total.reason
    }
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
  mainCurrency,
}: {
  liquidAccounts: readonly BalanceLikeAccount[]
  convertToPreferred: ConvertToPreferredFn
  getTotalBalanceInPreferred: (accounts: BalanceLikeAccount[]) => PreferredAmountResult
  preferredCurrency: string
  mainCurrency: string | null
}) {
  const depositAccounts = liquidAccounts.filter((account) => account.type !== 'credit_card')
  const creditAccounts = liquidAccounts.filter((account) => account.type === 'credit_card')

  const net = fromPreferredResult(getTotalBalanceInPreferred([...liquidAccounts]))
  const assets = fromPreferredResult(getTotalBalanceInPreferred([...depositAccounts]))
  const liabilities = sumConvertedAmounts(
    creditAccounts.map((account) => ({
      amountCentavos: Math.max(0, -account.balance),
      currency: account.currency,
    })),
    convertToPreferred,
    preferredCurrency,
    mainCurrency
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
      preferredCurrency,
      mainCurrency
    ),
    savings: sumConvertedAmounts(
      liquidAccounts
        .filter((account) => account.type === 'savings')
        .map((account) => ({
          amountCentavos: Math.max(0, account.balance),
          currency: account.currency,
        })),
      convertToPreferred,
      preferredCurrency,
      mainCurrency
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
  mainCurrency,
}: {
  receivables: readonly ReceivableLikeItem[]
  convertToPreferred: ConvertToPreferredFn
  preferredCurrency: string
  mainCurrency: string | null
}) {
  const active = receivables.filter((item) => item.status !== 'cancelled')
  const outstanding = sumConvertedAmounts(
    active.map((item) => ({
      amountCentavos: item.remainingAmount,
      currency: item.currency,
    })),
    convertToPreferred,
    preferredCurrency,
    mainCurrency
  )
  const overdue = sumConvertedAmounts(
    active
      .filter((item) => item.isOverdue)
      .map((item) => ({
        amountCentavos: item.remainingAmount,
        currency: item.currency,
      })),
    convertToPreferred,
    preferredCurrency,
    mainCurrency
  )
  const received = sumConvertedAmounts(
    active.map((item) => ({
      amountCentavos: item.received_amount,
      currency: item.currency,
    })),
    convertToPreferred,
    preferredCurrency,
    mainCurrency
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
