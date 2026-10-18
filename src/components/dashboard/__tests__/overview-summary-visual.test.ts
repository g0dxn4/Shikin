import { describe, expect, it } from 'vitest'
import {
  reconcileSummaryComposition,
  recordedSnapshotLine,
  selectSummaryVisual,
  type SummaryCompositionAccount,
  type SummaryVisualInput,
} from '@/components/dashboard/overview-summary-visual'

const checking: SummaryCompositionAccount = {
  id: 'checking',
  name: 'Checking',
  currency: 'USD',
  convertedBalance: 80_000,
}
const idle: SummaryCompositionAccount = {
  id: 'idle',
  name: 'Idle',
  currency: 'USD',
  convertedBalance: 0,
}
const card: SummaryCompositionAccount = {
  id: 'card',
  name: 'Card',
  currency: 'MXN',
  convertedBalance: 25_000,
}

function visualInput(overrides: Partial<SummaryVisualInput> = {}): SummaryVisualInput {
  return {
    history: [],
    historyComplete: true,
    historyCurrency: 'USD',
    currentComplete: true,
    currentAmount: 75_000,
    currentCurrency: 'USD',
    totalAssets: 100_000,
    totalLiabilities: 25_000,
    totalInvestments: 20_000,
    accountAssets: [checking, idle],
    accountLiabilities: [card],
    ...overrides,
  }
}

describe('recordedSnapshotLine', () => {
  it('keeps exactly two recorded points and does not add today', () => {
    const points = recordedSnapshotLine(
      [
        { date: '2026-01-01', netWorth: 100_000 },
        { date: '2026-03-01', netWorth: 115_000 },
      ],
      true,
      'USD'
    )
    expect(points).toEqual([
      { date: '2026-01-01', netWorth: 100_000 },
      { date: '2026-03-01', netWorth: 115_000 },
    ])
    expect(points?.some((point) => point.date === '2026-10-17')).toBe(false)
  })

  it('refuses a line for zero or one recorded snapshot', () => {
    expect(recordedSnapshotLine([], true, 'USD')).toBeNull()
    expect(
      recordedSnapshotLine([{ date: '2026-01-01', netWorth: 100_000 }], true, 'USD')
    ).toBeNull()
  })

  it('refuses incomplete, unordered, or non-integer history', () => {
    const points = [
      { date: '2026-01-01', netWorth: 12_345 },
      { date: '2026-02-01', netWorth: 67_890 },
    ]
    expect(recordedSnapshotLine(points, false, 'USD')).toBeNull()
    expect(recordedSnapshotLine(points, true, null)).toBeNull()
    expect(recordedSnapshotLine(points, true, '   ')).toBeNull()
    expect(
      recordedSnapshotLine(
        [
          { date: '2026-02-01', netWorth: 67_890 },
          { date: '2026-01-01', netWorth: 12_345 },
        ],
        true,
        'USD'
      )
    ).toBeNull()
    expect(
      recordedSnapshotLine(
        [
          { date: '2026-01-01', netWorth: 12_345.5 },
          { date: '2026-02-01', netWorth: 67_890 },
        ],
        true,
        'USD'
      )
    ).toBeNull()
    expect(
      recordedSnapshotLine(
        [
          { date: 'today', netWorth: 12_345 },
          { date: '2026-02-01', netWorth: 67_890 },
        ],
        true,
        'USD'
      )
    ).toBeNull()
  })
})

describe('reconcileSummaryComposition', () => {
  it('keeps holdings separate and omits zero account assets when sums match', () => {
    expect(
      reconcileSummaryComposition({
        currency: 'USD',
        totalAssets: 100_000,
        totalLiabilities: 25_000,
        totalInvestments: 20_000,
        netWorth: 75_000,
        accountAssets: [checking, idle],
        accountLiabilities: [card],
      })
    ).toEqual({
      currency: 'USD',
      segments: [
        { id: 'checking', name: 'Checking', amount: 80_000, kind: 'account' },
        { id: 'holdings', name: 'holdings', amount: 20_000, kind: 'holdings' },
      ],
      liabilities: 25_000,
      netWorth: 75_000,
      totalAssets: 100_000,
    })
  })

  it('accepts holdings alone and a liability-only subtraction', () => {
    expect(
      reconcileSummaryComposition({
        currency: 'USD',
        totalAssets: 20_000,
        totalLiabilities: 0,
        totalInvestments: 20_000,
        netWorth: 20_000,
        accountAssets: [],
        accountLiabilities: [],
      })?.segments
    ).toEqual([{ id: 'holdings', name: 'holdings', amount: 20_000, kind: 'holdings' }])

    expect(
      reconcileSummaryComposition({
        currency: 'USD',
        totalAssets: 0,
        totalLiabilities: 25_000,
        totalInvestments: 0,
        netWorth: -25_000,
        accountAssets: [],
        accountLiabilities: [card],
      })
    ).toMatchObject({ segments: [], liabilities: 25_000, netWorth: -25_000 })
  })

  it('refuses a bar unless assets, holdings, liabilities, and net worth reconcile exactly', () => {
    const base = {
      currency: 'USD',
      totalAssets: 100_000,
      totalLiabilities: 25_000,
      totalInvestments: 20_000,
      netWorth: 75_000,
      accountAssets: [checking, idle],
      accountLiabilities: [card],
    }
    expect(reconcileSummaryComposition({ ...base, totalAssets: 100_001 })).toBeNull()
    expect(reconcileSummaryComposition({ ...base, totalInvestments: 20_001 })).toBeNull()
    expect(reconcileSummaryComposition({ ...base, totalLiabilities: 25_001 })).toBeNull()
    expect(reconcileSummaryComposition({ ...base, netWorth: 75_001 })).toBeNull()
    expect(
      reconcileSummaryComposition({
        ...base,
        accountAssets: [{ ...checking, convertedBalance: null }],
      })
    ).toBeNull()
    expect(
      reconcileSummaryComposition({
        ...base,
        accountLiabilities: [{ ...card, convertedBalance: 24_999 }],
      })
    ).toBeNull()
    expect(reconcileSummaryComposition({ ...base, currency: null })).toBeNull()
    expect(reconcileSummaryComposition({ ...base, totalInvestments: null })).toBeNull()
    expect(
      reconcileSummaryComposition({
        ...base,
        accountAssets: [checking, { ...idle, id: 'checking' }],
      })
    ).toBeNull()
    expect(
      reconcileSummaryComposition({
        ...base,
        accountAssets: [{ ...checking, convertedBalance: -1 }],
      })
    ).toBeNull()
  })
})

describe('selectSummaryVisual', () => {
  it('prefers a complete recorded line over composition', () => {
    const visual = selectSummaryVisual(
      visualInput({
        history: [
          { date: '2026-01-01', netWorth: 60_000 },
          { date: '2026-02-01', netWorth: 73_000 },
        ],
      })
    )
    expect(visual.kind).toBe('line')
    if (visual.kind === 'line') {
      expect(visual.points).toHaveLength(2)
      expect(visual.points.map((point) => point.date)).toEqual(['2026-01-01', '2026-02-01'])
    }
  })

  it('does not chart stale or incomplete history, even when points are present', () => {
    const history = [
      { date: '2026-01-01', netWorth: 12_345 },
      { date: '2026-02-01', netWorth: 67_890 },
    ]
    expect(
      selectSummaryVisual(visualInput({ history, historyComplete: false, currentComplete: false }))
    ).toEqual({ kind: 'plain', reason: 'history-unavailable' })
    expect(
      selectSummaryVisual(
        visualInput({
          history,
          historyCurrency: null,
          currentComplete: false,
        })
      )
    ).toEqual({ kind: 'plain', reason: 'history-unavailable' })
  })

  it('uses reconciled composition for zero or one snapshot and never a fake line', () => {
    expect(selectSummaryVisual(visualInput({ history: [] })).kind).toBe('composition')
    expect(
      selectSummaryVisual(visualInput({ history: [{ date: '2026-01-01', netWorth: 75_000 }] })).kind
    ).toBe('composition')
  })

  it('states why a bar is withheld when reconciliation fails', () => {
    expect(selectSummaryVisual(visualInput({ totalAssets: 100_001, history: [] }))).toEqual({
      kind: 'plain',
      reason: 'composition-unproven',
    })
    expect(
      selectSummaryVisual(
        visualInput({
          history: [{ date: '2026-01-01', netWorth: 1 }],
          totalAssets: 100_001,
        })
      )
    ).toEqual({ kind: 'plain', reason: 'one-snapshot' })
    expect(
      selectSummaryVisual(
        visualInput({
          history: [],
          totalAssets: 0,
          totalLiabilities: 0,
          totalInvestments: 0,
          currentAmount: 0,
          accountAssets: [],
          accountLiabilities: [],
        })
      )
    ).toEqual({ kind: 'plain', reason: 'current-only' })
  })
})
