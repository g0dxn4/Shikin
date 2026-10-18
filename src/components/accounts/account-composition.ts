import type {
  ConvertedTotal,
  ConvertToPreferredFn,
  CurrencyGroup,
} from '@/lib/accounts-group-converted-totals'

export const POSITIVE_SEGMENT_KEYS = [
  'checking',
  'savings',
  'cash',
  'other',
  'creditPositive',
] as const

export type PositiveSegmentKey = (typeof POSITIVE_SEGMENT_KEYS)[number]

export type CompositionAccount = {
  id: string
  type: string
  currency: string
  balance: number
}

export type CompositionSegment = {
  key: PositiveSegmentKey
  amountCentavos: number
  widthPercent: string
}

export type DebtKind = 'card' | 'mixed' | 'other' | 'none'

export type LiquidCompositionModel =
  | {
      kind: 'stack'
      currency: string
      segments: CompositionSegment[]
      positiveCentavos: number
      debtCentavos: number
      debtKind: DebtKind
      netCentavos: number
    }
  | {
      kind: 'context'
      currency: string
      positiveCentavos: number
      debtCentavos: number
      debtKind: DebtKind
      netCentavos: number
    }
  | {
      kind: 'grouped'
      groups: CurrencyGroup[]
    }
  | {
      kind: 'unreconciled'
    }

function positiveKey(type: string): PositiveSegmentKey {
  if (type === 'checking' || type === 'savings' || type === 'cash') return type
  if (type === 'credit_card') return 'creditPositive'
  return 'other'
}

/** Exact share of the positive total. Never applies a minimum floor. */
export function exactSharePercent(amountCentavos: number, totalCentavos: number): string | null {
  if (!Number.isSafeInteger(amountCentavos) || !Number.isSafeInteger(totalCentavos)) return null
  if (amountCentavos <= 0 || totalCentavos <= 0 || amountCentavos > totalCentavos) return null
  const percent = (amountCentavos / totalCentavos) * 100
  if (!Number.isFinite(percent) || percent <= 0 || percent > 100) return null
  return `${percent}%`
}

/**
 * Build a positive-asset stack only when every liquid amount converts through the
 * page's existing converter and the signed sum matches the page net exactly.
 * Incomplete conversion returns native groups and no converted total.
 */
export function buildLiquidComposition({
  accounts,
  convertToPreferred,
  authorityNet,
  groupedNet,
}: {
  accounts: readonly CompositionAccount[]
  convertToPreferred: ConvertToPreferredFn
  authorityNet: ConvertedTotal
  groupedNet: readonly CurrencyGroup[]
}): LiquidCompositionModel {
  if (!authorityNet.complete) {
    return { kind: 'grouped', groups: groupedNet.map((group) => ({ ...group })) }
  }

  const segmentAmounts = new Map<PositiveSegmentKey, number>()
  let positiveTotal = 0
  let debtTotal = 0
  let cardDebtAccounts = 0
  let otherDebtAccounts = 0
  const currency = authorityNet.preferredCurrency

  try {
    for (const account of accounts) {
      if (!Number.isSafeInteger(account.balance)) return { kind: 'unreconciled' }
      const converted = convertToPreferred(account.balance, account.currency)
      if (!converted.complete) {
        return { kind: 'grouped', groups: groupedNet.map((group) => ({ ...group })) }
      }
      if (converted.preferredCurrency !== currency) return { kind: 'unreconciled' }
      if (!Number.isSafeInteger(converted.amountCentavos)) return { kind: 'unreconciled' }

      if (account.balance > 0) {
        if (converted.amountCentavos < 0) return { kind: 'unreconciled' }
        const key = positiveKey(account.type)
        const next = (segmentAmounts.get(key) ?? 0) + converted.amountCentavos
        if (!Number.isSafeInteger(next)) return { kind: 'unreconciled' }
        segmentAmounts.set(key, next)
        positiveTotal += converted.amountCentavos
      } else if (account.balance < 0) {
        if (converted.amountCentavos > 0) return { kind: 'unreconciled' }
        debtTotal += -converted.amountCentavos
        if (account.type === 'credit_card') cardDebtAccounts += 1
        else otherDebtAccounts += 1
      } else if (converted.amountCentavos !== 0) {
        return { kind: 'unreconciled' }
      }

      if (!Number.isSafeInteger(positiveTotal) || !Number.isSafeInteger(debtTotal)) {
        return { kind: 'unreconciled' }
      }
    }
  } catch {
    return { kind: 'unreconciled' }
  }

  const reconstructed = positiveTotal - debtTotal
  if (!Number.isSafeInteger(reconstructed) || reconstructed !== authorityNet.amountCentavos) {
    return { kind: 'unreconciled' }
  }

  const debtKind: DebtKind =
    cardDebtAccounts > 0 && otherDebtAccounts > 0
      ? 'mixed'
      : cardDebtAccounts > 0
        ? 'card'
        : otherDebtAccounts > 0
          ? 'other'
          : 'none'

  if (positiveTotal === 0) {
    return {
      kind: 'context',
      currency,
      positiveCentavos: 0,
      debtCentavos: debtTotal,
      debtKind,
      netCentavos: authorityNet.amountCentavos,
    }
  }

  const segments = POSITIVE_SEGMENT_KEYS.flatMap((key) => {
    const amountCentavos = segmentAmounts.get(key) ?? 0
    if (amountCentavos <= 0) return []
    const widthPercent = exactSharePercent(amountCentavos, positiveTotal)
    if (!widthPercent) return []
    return [{ key, amountCentavos, widthPercent }]
  })
  const segmentSum = segments.reduce((sum, segment) => sum + segment.amountCentavos, 0)
  if (segmentSum !== positiveTotal) return { kind: 'unreconciled' }

  return {
    kind: 'stack',
    currency,
    segments,
    positiveCentavos: positiveTotal,
    debtCentavos: debtTotal,
    debtKind,
    netCentavos: authorityNet.amountCentavos,
  }
}
