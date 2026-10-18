import { describe, expect, it } from 'vitest'
import {
  reconcileSummaryComposition,
  recordedSnapshotLine,
  selectSummaryVisual,
  stepSummarySelection,
  summaryEndpointAmount,
  summaryPointSelection,
  summaryRecordedValueDomain,
  SUMMARY_MIN_PAD_CENTAVOS,
  SUMMARY_SPAN_PAD_RATIO,
  SUMMARY_VALUE_FLOOR_RATIO,
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

  it('uses reconciled composition only when the settled range has no snapshots', () => {
    expect(selectSummaryVisual(visualInput({ history: [] })).kind).toBe('composition')
    expect(
      selectSummaryVisual(visualInput({ history: [{ date: '2026-01-01', netWorth: 1 }] }))
    ).toEqual({
      kind: 'point',
      point: { date: '2026-01-01', netWorth: 1 },
      currency: 'USD',
    })
  })

  it('does not borrow the current mix for a pending, incomplete, or invalid range', () => {
    const history = [
      { date: '2026-01-01', netWorth: 12_345 },
      { date: '2026-02-01', netWorth: 67_890 },
    ]
    expect(selectSummaryVisual(visualInput({ history, historyPending: true }))).toEqual({
      kind: 'plain',
      reason: 'history-loading',
    })
    expect(selectSummaryVisual(visualInput({ history, historyComplete: false })).kind).not.toBe(
      'composition'
    )
    expect(selectSummaryVisual(visualInput({ history, historyComplete: false }))).toEqual({
      kind: 'plain',
      reason: 'history-unavailable',
    })
    expect(
      selectSummaryVisual(
        visualInput({
          history: [{ date: 'not-a-date', netWorth: 1 }],
        })
      )
    ).toEqual({ kind: 'plain', reason: 'one-snapshot' })
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
    ).toEqual({
      kind: 'point',
      point: { date: '2026-01-01', netWorth: 1 },
      currency: 'USD',
    })
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

describe('summary point inspection identity', () => {
  const points = [
    { date: '2026-01-15', netWorth: 100_000 },
    { date: '2026-01-15', netWorth: 250_050 },
    { date: '2026-04-02', netWorth: 300_000 },
  ]

  it('selects the clicked index when dates are duplicated', () => {
    expect(summaryPointSelection(points, 1, '2026-01-15')).toEqual({
      index: 1,
      date: '2026-01-15',
    })
    expect(summaryPointSelection(points, 0, '2026-01-15')?.index).toBe(0)
    expect(summaryPointSelection(points, 1, '2026-04-02')).toBeNull()
    expect(summaryPointSelection(points, 3, '2026-04-02')).toBeNull()
  })

  it('steps only across actual points and does not wrap', () => {
    expect(stepSummarySelection(points, null, 1)).toEqual({ index: 0, date: '2026-01-15' })
    expect(stepSummarySelection(points, null, -1)).toEqual({ index: 2, date: '2026-04-02' })
    expect(stepSummarySelection(points, { index: 0, date: '2026-01-15' }, 1)).toEqual({
      index: 1,
      date: '2026-01-15',
    })
    expect(stepSummarySelection(points, { index: 0, date: '2026-01-15' }, -1)).toEqual({
      index: 0,
      date: '2026-01-15',
    })
    expect(stepSummarySelection(points, { index: 2, date: '2026-04-02' }, 1)).toEqual({
      index: 2,
      date: '2026-04-02',
    })
    expect(stepSummarySelection(points, { index: 1, date: '2026-04-02' }, 1)).toEqual({
      index: 0,
      date: '2026-01-15',
    })
  })
})

describe('summaryRecordedValueDomain', () => {
  it('pads a real range by about 12% of the span and does not include zero', () => {
    const domain = summaryRecordedValueDomain([100_000, 200_000])
    expect(domain).toEqual([88_000, 212_000])
    const span = 100_000
    const pad = span * SUMMARY_SPAN_PAD_RATIO
    expect(domain?.[0]).toBe(100_000 - pad)
    expect(domain?.[1]).toBe(200_000 + pad)
    expect(domain?.[0]).toBeGreaterThan(0)
    expect(span / (domain![1] - domain![0])).toBeGreaterThan(0.7)
  })

  it('floors a one-cent move so it cannot fill the plot', () => {
    const values = [1_000_000, 1_000_001]
    const domain = summaryRecordedValueDomain(values)
    expect(domain).not.toBeNull()
    const averageAbsolute = (1_000_000 + 1_000_001) / 2
    const pad = Math.max(
      1 * SUMMARY_SPAN_PAD_RATIO,
      averageAbsolute * SUMMARY_VALUE_FLOOR_RATIO,
      SUMMARY_MIN_PAD_CENTAVOS
    )
    expect(pad).toBeGreaterThan(1)
    expect(domain?.[0]).toBeCloseTo(values[0] - pad)
    expect(domain?.[1]).toBeCloseTo(values[1] + pad)
    expect(domain![0]).toBeGreaterThan(0)
    expect((values[1] - values[0]) / (domain![1] - domain![0])).toBeLessThan(0.001)
  })

  it('keeps a flat series flat inside a symmetric pad instead of a zero baseline', () => {
    expect(summaryRecordedValueDomain([50_000, 50_000, 50_000])).toEqual([49_250, 50_750])
    expect(summaryRecordedValueDomain([0, 0])).toEqual([-1, 1])
  })

  it('does not snap a negative range to zero', () => {
    const domain = summaryRecordedValueDomain([-200, -100])
    expect(domain).toEqual([-212, -88])
    expect(domain?.[1]).toBeLessThan(0)
  })

  it('refuses a domain for fewer than two safe integer values', () => {
    expect(summaryRecordedValueDomain([])).toBeNull()
    expect(summaryRecordedValueDomain([100])).toBeNull()
    expect(summaryRecordedValueDomain([100, 100.5])).toBeNull()
    expect(summaryRecordedValueDomain([Number.NaN, 100])).toBeNull()
  })
})

describe('summaryEndpointAmount', () => {
  it('uses compact values when they still show the range', () => {
    const start = summaryEndpointAmount(100_000, 200_000, 'USD', 'en-US')
    const end = summaryEndpointAmount(200_000, 100_000, 'USD', 'en-US')
    expect(start).not.toBe(end)
    expect(start).not.toContain('1,000.00')
    expect(end).not.toContain('2,000.00')
  })

  it('uses the full amount when compact rounding would hide a real difference', () => {
    expect(summaryEndpointAmount(1_000_000, 1_000_001, 'USD', 'en-US')).toBe('$10,000.00')
    expect(summaryEndpointAmount(1_000_001, 1_000_000, 'USD', 'en-US')).toBe('$10,000.01')
  })

  it('keeps one compact label when the series is flat', () => {
    const amount = summaryEndpointAmount(50_000, 50_000, 'USD', 'en-US')
    expect(summaryEndpointAmount(50_000, 50_000, 'USD', 'en-US')).toBe(amount)
    expect(amount).not.toBe('$500.00')
  })
})
