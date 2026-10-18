import { describe, expect, it } from 'vitest'
import {
  buildRecordedBalanceModel,
  formatRecordedAxisDate,
  recordedElapsedFraction,
  type RecordedBalanceInput,
  type RecordedBalancePlotted,
} from '@/components/charts/recorded-balance-model'

const DAY_MS = 86_400_000

/** Illustrative unit rows copied from the research fixture. Not a ledger seed. */
const NET_WORTH_11: RecordedBalanceInput[] = [
  { date: '2026-01-31', amountCentavos: 1_888_150 },
  { date: '2026-02-28', amountCentavos: 2_142_980 },
  { date: '2026-03-31', amountCentavos: 2_407_290 },
  { date: '2026-04-30', amountCentavos: 2_744_850 },
  { date: '2026-05-31', amountCentavos: 3_006_620 },
  { date: '2026-06-30', amountCentavos: 3_257_070 },
  { date: '2026-07-31', amountCentavos: 3_520_770 },
  { date: '2026-08-31', amountCentavos: 3_784_080 },
  { date: '2026-09-30', amountCentavos: 4_036_980 },
  { date: '2026-10-17', amountCentavos: 4_265_840 },
  { date: '2026-10-18', amountCentavos: 4_265_840 },
]

const CASH_8: RecordedBalanceInput[] = [
  { date: '2026-04-30', amountCentavos: 18_200 },
  { date: '2026-05-31', amountCentavos: 17_580 },
  { date: '2026-06-30', amountCentavos: 17_580 },
  { date: '2026-07-31', amountCentavos: 17_580 },
  { date: '2026-08-31', amountCentavos: 16_690 },
  { date: '2026-09-30', amountCentavos: 16_690 },
  { date: '2026-10-17', amountCentavos: 16_690 },
  { date: '2026-10-18', amountCentavos: 16_690 },
]

const VISA_8: RecordedBalanceInput[] = [
  { date: '2026-04-30', amountCentavos: -211_700 },
  { date: '2026-05-31', amountCentavos: -211_300 },
  { date: '2026-06-30', amountCentavos: -204_800 },
  { date: '2026-07-31', amountCentavos: -203_200 },
  { date: '2026-08-31', amountCentavos: -201_300 },
  { date: '2026-09-30', amountCentavos: -198_400 },
  { date: '2026-10-17', amountCentavos: -205_400 },
  { date: '2026-10-18', amountCentavos: -205_400 },
]

function plotted(
  points: readonly RecordedBalanceInput[],
  currency = 'USD',
  options?: Parameters<typeof buildRecordedBalanceModel>[2]
) {
  const model = buildRecordedBalanceModel(points, currency, options)
  expect(model.status).not.toBe('invalid')
  expect(model.status).not.toBe('empty')
  return model as RecordedBalancePlotted
}

describe('recorded balance axis model', () => {
  it('parses strict UTC dates and does not normalize year 0–99 or invalid calendar days', () => {
    const year99 = plotted([{ date: '0099-01-01', amountCentavos: 100 }])
    expect(year99.points[0].date).toBe('0099-01-01')
    expect(new Date(year99.points[0].utcTimestamp).toISOString()).toBe('0099-01-01T00:00:00.000Z')
    expect(year99.points[0].utcTimestamp).not.toBe(Date.UTC(99, 0, 1))
    expect(formatRecordedAxisDate(year99.points[0].utcTimestamp, 'en', true)).not.toContain('1999')

    const october = plotted([{ date: '2026-10-18', amountCentavos: 50 }])
    expect(october.points[0].utcTimestamp).toBe(Date.UTC(2026, 9, 18))
    expect(new Date(october.points[0].utcTimestamp).getUTCHours()).toBe(0)
    const losAngeles = new Intl.DateTimeFormat('en', {
      timeZone: 'America/Los_Angeles',
      month: 'short',
      day: 'numeric',
    }).format(october.points[0].utcTimestamp)
    expect(losAngeles).toBe('Oct 17')
    expect(october.formatDate(october.points[0].utcTimestamp)).toBe('Oct 18')
    expect(formatRecordedAxisDate(october.points[0].utcTimestamp, 'es')).toBe('18 oct')
    expect(october.formatDate(october.points[0].utcTimestamp)).not.toBe(losAngeles)

    for (const date of [
      '2026-02-31',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '1900-02-29',
      '2026-4-05',
      '2026-04-00',
      '2026-04-30T00:00:00Z',
    ]) {
      const model = buildRecordedBalanceModel([{ date, amountCentavos: 1 }], 'USD')
      expect(model.status).toBe('invalid')
      if (model.status === 'invalid') {
        expect(model.reason).toBe('date')
        expect(model.sourceIndex).toBe(0)
      }
    }
    expect(plotted([{ date: '2024-02-29', amountCentavos: 1 }]).points[0].utcTimestamp).toBe(
      Date.UTC(2024, 1, 29)
    )
    expect(plotted([{ date: '2000-02-29', amountCentavos: 1 }]).points[0].date).toBe('2000-02-29')
  })

  it('rejects reversed dates without sorting or mutating the input', () => {
    const input: RecordedBalanceInput[] = [
      { date: '2026-03-01', amountCentavos: 300 },
      { date: '2026-01-15', amountCentavos: 100 },
    ]
    const before = structuredClone(input)
    Object.freeze(input)
    Object.freeze(input[0])
    Object.freeze(input[1])
    const model = buildRecordedBalanceModel(input, 'USD')
    expect(model).toEqual({ status: 'invalid', reason: 'order', currency: 'USD', sourceIndex: 1 })
    expect(input).toEqual(before)
  })

  it('keeps same-date points in input order and does not invent a time span', () => {
    const model = plotted([
      { date: '2026-10-17', amountCentavos: 100 },
      { date: '2026-10-17', amountCentavos: 250 },
    ])
    expect(model.status).toBe('series')
    expect(model.points.map((point) => point.sourceIndex)).toEqual([0, 1])
    expect(model.points[0].utcTimestamp).toBe(model.points[1].utcTimestamp)
    expect(model.points[0].amountCentavos).toBe(100)
    expect(model.points[1].amountCentavos).toBe(250)
    expect(model.xDomain[0]).toBe(model.xDomain[1])
    expect(model.dateTicks).toEqual([model.points[0].utcTimestamp])
    expect(recordedElapsedFraction(model.points[1].utcTimestamp, model.xDomain)).toBe(0)
  })

  it('rejects unsafe amounts and non-arrays without adding a zero point', () => {
    expect(
      buildRecordedBalanceModel([{ date: '2026-01-31', amountCentavos: 10.5 }], 'USD')
    ).toMatchObject({ status: 'invalid', reason: 'amount', sourceIndex: 0 })
    expect(
      buildRecordedBalanceModel([{ date: '2026-01-31', amountCentavos: Number.NaN }], 'USD')
    ).toMatchObject({ status: 'invalid', reason: 'amount' })
    expect(
      buildRecordedBalanceModel(
        [{ date: '2026-01-31', amountCentavos: Number.POSITIVE_INFINITY }],
        'USD'
      )
    ).toMatchObject({ status: 'invalid', reason: 'amount' })
    expect(
      buildRecordedBalanceModel(null as unknown as RecordedBalanceInput[], 'USD')
    ).toMatchObject({
      status: 'invalid',
      reason: 'input',
    })
  })

  it('returns empty, single, and flat without a manufactured trend or ±1 scale', () => {
    const empty = buildRecordedBalanceModel([], 'USD', { includeZero: true })
    expect(empty.status).toBe('empty')
    if (empty.status === 'empty') {
      expect(empty.points).toEqual([])
      expect(empty.xDomain).toBeNull()
      expect(empty.yDomain).toBeNull()
      expect(empty.yTicks).toEqual([])
      expect(empty.dateTicks).toEqual([])
    }

    const single = plotted([{ date: '2026-10-17', amountCentavos: 4_265_840 }])
    expect(single.status).toBe('single')
    expect(single.points).toHaveLength(1)
    expect(single.yDomain).toEqual([4_265_840, 4_265_840])
    expect(single.yTicks).toEqual([4_265_840])
    expect(single.dateTicks).toEqual([single.points[0].utcTimestamp])
    expect(single.formatExact(4_265_840)).toBe('$42,658.40')

    const flat = plotted([
      { date: '2026-04-17', amountCentavos: 0 },
      { date: '2026-10-18', amountCentavos: 0 },
    ])
    expect(flat.status).toBe('flat')
    expect(flat.yDomain).toEqual([0, 0])
    expect(flat.yTicks).toEqual([0])
    expect(flat.yDomain).not.toEqual([-1, 1])
    expect(flat.points).toHaveLength(2)
    expect(flat.xDomain[1] - flat.xDomain[0]).toBe(184 * DAY_MS)
  })

  it('does not turn None, UNKNOWN, or a lowercase code into USD', () => {
    const rows = [{ date: '2026-01-31', amountCentavos: 18_200 }]
    for (const currency of ['None', 'NONE', 'UNKNOWN', 'usd', '', 'US']) {
      const model = buildRecordedBalanceModel(rows, currency)
      expect(model.status).toBe('invalid')
      if (model.status === 'invalid') {
        expect(model.reason).toBe('currency')
        expect(model.currency).toBe(currency)
        expect(model).not.toHaveProperty('formatExact')
        expect(model).not.toHaveProperty('yDomain')
      }
    }

    const euros = plotted(
      [
        { date: '2026-01-31', amountCentavos: -125_000 },
        { date: '2026-02-28', amountCentavos: -80_000 },
      ],
      'EUR',
      { locale: 'en' }
    )
    expect(euros.currency).toBe('EUR')
    expect(euros.formatExact(-125_000)).toContain('€')
    expect(euros.formatExact(-125_000)).not.toContain('$')
    expect(euros.yTickLabels.every((label) => label.includes('€'))).toBe(true)
    expect(euros.yDomain[1]).toBeLessThan(0)
  })

  it('places the 11-point fixture on elapsed days and does not add a 1970 or current row', () => {
    const input = NET_WORTH_11.map((row) => ({ ...row }))
    const before = structuredClone(input)
    const model = plotted(input, 'USD', { maxDateTicks: 5 })
    expect(input).toEqual(before)
    expect(model.points).toHaveLength(11)
    expect(model.points.map((point) => point.date)).toEqual(input.map((row) => row.date))
    expect(model.points.map((point) => point.amountCentavos)).toEqual(
      input.map((row) => row.amountCentavos)
    )
    expect(model.points.map((point) => point.sourceIndex)).toEqual(input.map((_, index) => index))
    expect(model.xDomain).toEqual([model.points[0].utcTimestamp, model.points[10].utcTimestamp])
    expect(model.xDomain[0]).toBe(Date.UTC(2026, 0, 31))
    expect(model.xDomain[1] - model.xDomain[0]).toBe(260 * DAY_MS)
    expect(model.points[10].utcTimestamp - model.points[9].utcTimestamp).toBe(DAY_MS)
    expect(model.points[9].utcTimestamp - model.points[8].utcTimestamp).toBe(17 * DAY_MS)

    const lastDay =
      recordedElapsedFraction(model.points[10].utcTimestamp, model.xDomain)! -
      recordedElapsedFraction(model.points[9].utcTimestamp, model.xDomain)!
    const septemberGap =
      recordedElapsedFraction(model.points[9].utcTimestamp, model.xDomain)! -
      recordedElapsedFraction(model.points[8].utcTimestamp, model.xDomain)!
    expect(lastDay).toBeCloseTo(1 / 260)
    expect(septemberGap).toBeCloseTo(17 / 260)
    expect(lastDay).not.toBeCloseTo(1 / 10)
    expect(model.points.some((point) => point.date.startsWith('1970'))).toBe(false)
    expect(model.dateTicks).toHaveLength(5)
    expect(model.dateTicks[0]).toBe(model.xDomain[0])
    expect(model.dateTicks[4]).toBe(model.xDomain[1])
    expect(model.dateTicks[1] - model.dateTicks[0]).toBe(65 * DAY_MS)
    expect(model.dateTickLabels).toEqual(['Jan 31', 'Apr 6', 'Jun 10', 'Aug 14', 'Oct 18'])
    expect(new Set(model.dateTickLabels).size).toBe(5)
    expect(
      model.points.some((point) => model.dateTicks.slice(1, 4).includes(point.utcTimestamp))
    ).toBe(false)
    expect(model.yDomain).toEqual([1_697_935, 4_456_055])
    expect(model.yDomain[0]).toBeGreaterThan(0)
    expect(model.yTicks).toEqual([2_000_000, 3_000_000, 4_000_000])
    expect(model.yTickLabels).toEqual(['$20K', '$30K', '$40K'])
    expect(model.yTicks.length).toBeGreaterThanOrEqual(3)
    expect(model.suggestedYWidth).toBeGreaterThanOrEqual(64)
    expect(model.suggestedYWidth).toBeLessThanOrEqual(80)
  })

  it('uses two or three anchored date ticks without equal record slots', () => {
    const two = plotted(NET_WORTH_11, 'USD', { maxDateTicks: 2 })
    const three = plotted(NET_WORTH_11, 'USD')
    expect(two.dateTicks).toEqual([two.xDomain[0], two.xDomain[1]])
    expect(two.dateTickLabels).toEqual(['Jan 31', 'Oct 18'])
    expect(three.dateTicks).toHaveLength(3)
    expect(three.dateTicks[1] - three.dateTicks[0]).toBe(130 * DAY_MS)
    expect(three.dateTickLabels.every((label) => !label.includes('1970'))).toBe(true)
  })

  it('formats a wide gap by elapsed days rather than by point index', () => {
    const model = plotted(
      [
        { date: '2026-01-01', amountCentavos: 1_000 },
        { date: '2026-01-02', amountCentavos: 1_100 },
        { date: '2026-12-31', amountCentavos: 1_400 },
      ],
      'USD',
      { maxDateTicks: 2 }
    )
    const fraction =
      recordedElapsedFraction(model.points[1].utcTimestamp, model.xDomain)! -
      recordedElapsedFraction(model.points[0].utcTimestamp, model.xDomain)!
    expect(model.xDomain[1] - model.xDomain[0]).toBe(364 * DAY_MS)
    expect(fraction).toBeCloseTo(1 / 364)
    expect(fraction).not.toBeCloseTo(0.5)
    expect(model.points).toHaveLength(3)
  })

  it('labels cash in dollars and keeps Visa signed, unique, and away from zero', () => {
    const cash = plotted(CASH_8, 'USD', { maxDateTicks: 3, locale: 'en' })
    expect(cash.status).toBe('series')
    expect(cash.points).toHaveLength(8)
    expect(cash.yDomain).toEqual([16_569, 18_321])
    expect(cash.yDomain[0]).toBeGreaterThan(0)
    expect(cash.yTicks).toEqual([17_000, 17_500, 18_000])
    expect(cash.yTicks.length).toBeGreaterThanOrEqual(3)
    expect(cash.yTickLabels).toEqual(['$170', '$175', '$180'])
    expect(cash.yTickLabels.join(' ')).not.toMatch(/0\.2\s?K/i)
    expect(cash.suggestedYWidth).toBeGreaterThanOrEqual(64)
    expect(cash.suggestedYWidth).toBeLessThanOrEqual(80)

    const visa = plotted(VISA_8, 'USD')
    expect(visa.points).toHaveLength(8)
    expect(visa.points.every((point) => point.amountCentavos < 0)).toBe(true)
    expect(visa.yDomain).toEqual([-212_764, -197_336])
    expect(visa.yDomain[1]).toBeLessThan(0)
    expect(visa.yTicks.every((tick) => tick < 0)).toBe(true)
    expect(visa.yTicks.length).toBeGreaterThanOrEqual(3)
    expect(new Set(visa.yTickLabels).size).toBe(visa.yTickLabels.length)
    expect(visa.yTickLabels.every((label) => label.includes('-') || label.includes('−'))).toBe(true)
    expect(visa.yTickLabels).toEqual(['-$2,100', '-$2,050', '-$2,000'])
    expect(visa.yTickLabels.join(' ')).not.toMatch(/\$2K/)
    expect(visa.suggestedYWidth).toBeGreaterThanOrEqual(64)
    expect(visa.suggestedYWidth).toBeLessThanOrEqual(80)

    const spanish = plotted(VISA_8, 'USD', { locale: 'es' })
    expect(new Set(spanish.yTickLabels).size).toBe(spanish.yTickLabels.length)
    expect(spanish.yTickLabels.every((label) => label.includes('-'))).toBe(true)
    expect(spanish.dateTickLabels.every((label) => label.length > 0)).toBe(true)
    expect(new Set(spanish.dateTickLabels).size).toBe(spanish.dateTickLabels.length)
  })

  it('expands a 70-cent range so ticks are not identical $42.7K labels', () => {
    const model = plotted(
      [
        { date: '2026-10-17', amountCentavos: 4_265_840 },
        { date: '2026-10-18', amountCentavos: 4_265_910 },
      ],
      'USD'
    )
    expect(model.yDomain).toEqual([4_244_510, 4_287_240])
    expect(model.points).toHaveLength(2)
    expect(model.yDomain[0]).not.toBe(model.points[0].amountCentavos)
    expect(model.yDomain[1]).not.toBe(model.points[1].amountCentavos)
    const dataSpan = 70
    expect(dataSpan / (model.yDomain[1] - model.yDomain[0])).toBeLessThan(0.01)
    expect(model.yTicks.length).toBeGreaterThanOrEqual(3)
    expect(new Set(model.yTickLabels).size).toBe(model.yTickLabels.length)
    expect(model.yTickLabels).toEqual(['$42,500', '$42,600', '$42,700', '$42,800'])
    expect(model.yTickLabels.every((label) => !label.includes('42.7K'))).toBe(true)
    expect(model.formatExact(4_265_840)).toBe('$42,658.40')
    expect(model.formatExact(4_265_910)).toBe('$42,659.10')
    expect(model.formatExact(4_265_840)).not.toBe(model.formatExact(4_265_910))
  })

  it('includes zero for area and near-zero lines, not for a far liability line', () => {
    const area = plotted(VISA_8, 'USD', { includeZero: true })
    expect(area.includeZero).toBe(true)
    expect(area.yDomain[0]).toBeLessThanOrEqual(VISA_8[0].amountCentavos)
    expect(area.yDomain[1]).toBe(0)
    expect(area.yTicks.some((tick) => tick < 0)).toBe(true)
    expect(area.points.every((point) => point.amountCentavos < 0)).toBe(true)
    expect(area.points).toHaveLength(VISA_8.length)

    const near = plotted([
      { date: '2026-01-01', amountCentavos: 50 },
      { date: '2026-02-01', amountCentavos: 400 },
    ])
    expect(near.yDomain[0]).toBe(0)
    expect(near.yDomain[1]).toBeGreaterThanOrEqual(400)

    const crosses = plotted([
      { date: '2026-01-01', amountCentavos: -100 },
      { date: '2026-02-01', amountCentavos: 250 },
    ])
    expect(crosses.yDomain[0]).toBeLessThan(0)
    expect(crosses.yDomain[1]).toBeGreaterThan(0)

    const far = plotted([
      { date: '2026-01-01', amountCentavos: 10_000 },
      { date: '2026-06-01', amountCentavos: 20_000 },
    ])
    expect(far.yDomain[0]).toBeGreaterThan(0)
    expect(far.yDomain[1]).toBeGreaterThan(20_000)
  })

  it('sizes the Y band for the drawn label and can exceed 80px instead of clipping', () => {
    const exact = plotted([{ date: '2026-10-18', amountCentavos: 4_265_840 }])
    expect(exact.yTickLabels).toEqual(['$42,658.40'])
    expect(exact.suggestedYWidth).toBeGreaterThan(80)
    expect(exact.formatAxis(4_265_840)).toBe('$42,658.40')
    expect(exact.formatAxis(Number.NaN)).toBe('')
  })

  it('rejects an unsupported tick count or locale without plotting', () => {
    const rows = [{ date: '2026-01-31', amountCentavos: 100 }]
    expect(buildRecordedBalanceModel(rows, 'USD', { maxDateTicks: 4 as never })).toMatchObject({
      status: 'invalid',
      reason: 'options',
    })
    expect(buildRecordedBalanceModel(rows, 'USD', { locale: '%%%' })).toMatchObject({
      status: 'invalid',
      reason: 'locale',
    })
  })

  it('adds the year only when short UTC labels would collide', () => {
    const model = plotted(
      [
        { date: '2025-10-18', amountCentavos: 100 },
        { date: '2026-10-18', amountCentavos: 200 },
      ],
      'USD',
      { maxDateTicks: 2, locale: 'en' }
    )
    expect(model.dateTickLabels).toEqual(['Oct 18, 2025', 'Oct 18, 2026'])
    expect(model.formatDate(model.dateTicks[0])).toBe('Oct 18, 2025')
    const spanish = plotted(
      [
        { date: '2025-10-18', amountCentavos: 100 },
        { date: '2026-10-18', amountCentavos: 200 },
      ],
      'USD',
      { maxDateTicks: 2, locale: 'es' }
    )
    expect(new Set(spanish.dateTickLabels).size).toBe(2)
    expect(spanish.dateTickLabels[0]).toContain('2025')
    expect(spanish.dateTickLabels[1]).toContain('2026')
    expect(spanish.dateTickLabels[0]).toContain('18')
  })
})
