export interface SummaryHistoryPoint {
  date: string
  netWorth: number
}

export interface SummaryCompositionAccount {
  id: string
  name: string
  currency: string
  convertedBalance: number | null
}

export interface SummaryCompositionInput {
  currency: string | null
  totalAssets: number | null
  totalLiabilities: number | null
  totalInvestments: number | null
  netWorth: number | null
  accountAssets: readonly SummaryCompositionAccount[]
  accountLiabilities: readonly SummaryCompositionAccount[]
}

export interface SummaryCompositionSegment {
  id: string
  name: string
  amount: number
  kind: 'account' | 'holdings'
}

export interface SummaryComposition {
  currency: string
  segments: SummaryCompositionSegment[]
  liabilities: number
  netWorth: number
  totalAssets: number
}

export type SummaryPlainReason =
  | 'one-snapshot'
  | 'no-snapshots'
  | 'history-unavailable'
  | 'composition-unproven'
  | 'current-only'

export type SummaryVisual =
  | { kind: 'line'; points: SummaryHistoryPoint[]; currency: string }
  | { kind: 'composition'; composition: SummaryComposition }
  | { kind: 'plain'; reason: SummaryPlainReason }

export interface SummaryVisualInput {
  history: readonly SummaryHistoryPoint[]
  historyComplete: boolean
  historyCurrency: string | null
  currentComplete: boolean
  currentAmount: number | null
  currentCurrency: string | null
  totalAssets: number | null
  totalLiabilities: number | null
  totalInvestments: number | null
  accountAssets: readonly SummaryCompositionAccount[]
  accountLiabilities: readonly SummaryCompositionAccount[]
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function isSafeMoney(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function hasText(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Recorded snapshots only. Returns null unless the series is complete, dated,
 * and has at least two points. Does not insert today, fill gaps, or reorder.
 */
export function recordedSnapshotLine(
  history: readonly SummaryHistoryPoint[],
  historyComplete: boolean,
  historyCurrency: string | null
): SummaryHistoryPoint[] | null {
  if (!historyComplete || !hasText(historyCurrency) || history.length < 2) return null

  const points: SummaryHistoryPoint[] = []
  let previousDate = ''
  for (const point of history) {
    if (!ISO_DATE.test(point.date) || !isSafeMoney(point.netWorth)) return null
    if (previousDate && point.date < previousDate) return null
    points.push({ date: point.date, netWorth: point.netWorth })
    previousDate = point.date
  }
  return points
}

/**
 * Current-valuation composition in one currency. Account segments are positive
 * converted asset balances. Holdings are totalInvestments, never account liquid
 * balances. Liabilities stay out of the asset bar. Any unproven row or sum fails.
 */
export function reconcileSummaryComposition(
  input: SummaryCompositionInput
): SummaryComposition | null {
  const currency = input.currency?.trim() ?? ''
  if (!currency) return null
  if (
    !isSafeMoney(input.totalAssets) ||
    !isSafeMoney(input.totalLiabilities) ||
    !isSafeMoney(input.totalInvestments) ||
    !isSafeMoney(input.netWorth)
  ) {
    return null
  }
  if (input.totalAssets < 0 || input.totalLiabilities < 0 || input.totalInvestments < 0) {
    return null
  }
  if (input.totalAssets - input.totalLiabilities !== input.netWorth) return null

  const assetIds = new Set<string>()
  let assetSum = 0
  const segments: SummaryCompositionSegment[] = []
  for (const account of input.accountAssets) {
    if (!hasText(account.id) || !hasText(account.name) || !hasText(account.currency)) return null
    if (assetIds.has(account.id)) return null
    assetIds.add(account.id)
    if (!isSafeMoney(account.convertedBalance) || account.convertedBalance < 0) return null
    assetSum += account.convertedBalance
    if (!isSafeMoney(assetSum)) return null
    if (account.convertedBalance > 0) {
      segments.push({
        id: account.id,
        name: account.name,
        amount: account.convertedBalance,
        kind: 'account',
      })
    }
  }

  if (input.totalInvestments > 0) {
    segments.push({
      id: 'holdings',
      name: 'holdings',
      amount: input.totalInvestments,
      kind: 'holdings',
    })
  }
  if (assetSum + input.totalInvestments !== input.totalAssets) return null
  if (!isSafeMoney(assetSum + input.totalInvestments)) return null

  const liabilityIds = new Set<string>()
  let liabilitySum = 0
  for (const account of input.accountLiabilities) {
    if (!hasText(account.id) || !hasText(account.name) || !hasText(account.currency)) return null
    if (liabilityIds.has(account.id)) return null
    liabilityIds.add(account.id)
    if (!isSafeMoney(account.convertedBalance) || account.convertedBalance < 0) return null
    liabilitySum += account.convertedBalance
    if (!isSafeMoney(liabilitySum)) return null
  }
  if (liabilitySum !== input.totalLiabilities) return null

  return {
    currency,
    segments,
    liabilities: input.totalLiabilities,
    netWorth: input.netWorth,
    totalAssets: input.totalAssets,
  }
}

export function selectSummaryVisual(input: SummaryVisualInput): SummaryVisual {
  const historyCurrency = input.historyCurrency?.trim() ?? ''
  const points = recordedSnapshotLine(input.history, input.historyComplete, historyCurrency)
  if (points && historyCurrency) {
    return { kind: 'line', points, currency: historyCurrency }
  }

  const composition = input.currentComplete
    ? reconcileSummaryComposition({
        currency: input.currentCurrency,
        totalAssets: input.totalAssets,
        totalLiabilities: input.totalLiabilities,
        totalInvestments: input.totalInvestments,
        netWorth: input.currentAmount,
        accountAssets: input.accountAssets,
        accountLiabilities: input.accountLiabilities,
      })
    : null

  if (composition && (composition.segments.length > 0 || composition.liabilities > 0)) {
    return { kind: 'composition', composition }
  }

  if (input.historyComplete && input.history.length === 1) {
    return { kind: 'plain', reason: 'one-snapshot' }
  }
  if (composition) return { kind: 'plain', reason: 'current-only' }
  if (input.currentComplete) return { kind: 'plain', reason: 'composition-unproven' }
  if (!input.historyComplete || !historyCurrency || input.history.length >= 2) {
    return { kind: 'plain', reason: 'history-unavailable' }
  }
  return { kind: 'plain', reason: 'no-snapshots' }
}
