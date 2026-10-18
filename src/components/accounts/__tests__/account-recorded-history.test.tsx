import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import enAccounts from '@/i18n/locales/en/accounts.json'
import esAccounts from '@/i18n/locales/es/accounts.json'
import { buildRecordedBalanceModel } from '@/components/charts/recorded-balance-model'
import { AccountRecordedHistory } from '../account-recorded-history'

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const captured = vi.hoisted(() => ({
  x: null as null | Record<string, unknown>,
  y: null as null | Record<string, unknown>,
  line: null as null | Record<string, unknown>,
  area: null as null | Record<string, unknown>,
  zero: null as null | Record<string, unknown>,
  data: null as null | unknown[],
}))

vi.mock('recharts', () => ({
  LineChart: ({
    children,
    data,
    onClick,
  }: {
    children: React.ReactNode
    data?: unknown[]
    onClick?: (state: { activeTooltipIndex?: number }) => void
  }) => {
    captured.data = data ?? null
    return (
      <div data-testid="line-chart" data-count={data?.length ?? 0}>
        <button type="button" onClick={() => onClick?.({ activeTooltipIndex: 0 })}>
          select-first-point
        </button>
        {children}
      </div>
    )
  },
  AreaChart: ({ children, data }: { children: React.ReactNode; data?: unknown[] }) => {
    captured.data = data ?? null
    return (
      <div data-testid="area-chart" data-count={data?.length ?? 0}>
        {children}
      </div>
    )
  },
  Line: (props: Record<string, unknown>) => {
    captured.line = props
    return <div data-testid="line-series" data-stroke-width={String(props.strokeWidth)} />
  },
  Area: (props: Record<string, unknown>) => {
    captured.area = props
    return (
      <div
        data-testid="area-series"
        data-base={String(props.baseValue)}
        data-stroke-width={String(props.strokeWidth)}
      />
    )
  },
  XAxis: (props: Record<string, unknown>) => {
    captured.x = props
    return (
      <div
        data-testid="x-axis"
        data-scale={String(props.scale)}
        data-key={String(props.dataKey)}
        data-type={String(props.type)}
        data-domain={Array.isArray(props.domain) ? props.domain.join(',') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join(',') : ''}
      />
    )
  },
  YAxis: (props: Record<string, unknown>) => {
    captured.y = props
    return (
      <div
        data-testid="y-axis"
        data-domain={Array.isArray(props.domain) ? props.domain.join(',') : ''}
        data-ticks={Array.isArray(props.ticks) ? props.ticks.join(',') : ''}
        data-width={String(props.width)}
      />
    )
  },
  CartesianGrid: () => <div data-testid="h-grid" />,
  Tooltip: () => null,
  ReferenceLine: (props: Record<string, unknown>) => {
    captured.zero = props
    return <div data-testid="zero-line" data-y={String(props.y)} />
  },
}))

vi.mock('react-i18next', async () => {
  const { default: accounts } = await import('@/i18n/locales/en/accounts.json')
  const lookup = (key: string) => {
    const node = key.split('.').reduce<unknown>((current, part) => {
      if (current && typeof current === 'object') return (current as Record<string, unknown>)[part]
      return undefined
    }, accounts)
    return typeof node === 'string' ? node : key
  }
  const interpolate = (template: string, opts?: Record<string, unknown>) =>
    template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
  return {
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, unknown>) => interpolate(lookup(key), opts),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  }
})

const VISA = [
  { date: '2026-04-30', balance: -211_700 },
  { date: '2026-08-31', balance: -201_300 },
  { date: '2026-10-18', balance: -205_400 },
]

const CASH = [
  { date: '2026-04-30', balance: 1_669_000 },
  { date: '2026-07-31', balance: 1_735_000 },
  { date: '2026-10-18', balance: 1_820_000 },
]

function renderHistory(props: Partial<React.ComponentProps<typeof AccountRecordedHistory>> = {}) {
  captured.x = null
  captured.y = null
  captured.line = null
  captured.area = null
  captured.zero = null
  captured.data = null
  return render(
    <AccountRecordedHistory
      accountName="QA Visa"
      points={VISA}
      currency="EUR"
      windowStart="2026-04-18"
      status="ready"
      locale="en"
      showExact={false}
      plotWidth={286}
      {...props}
    />
  )
}

describe('account recorded history', () => {
  it('keeps the English and Spanish captions free of daily or MAX claims', () => {
    expect(enAccounts.history.coverageLead).toContain('on or after')
    expect(enAccounts.history.show).toBe('View exact data')
    expect(enAccounts.history.title).toBe('Recorded balance')
    expect(enAccounts.history.none.toLowerCase()).not.toContain('daily')
    expect(enAccounts.history.method.toLowerCase()).not.toContain('max')
    expect(esAccounts.history.coverageLead).toContain('a partir del')
    expect(esAccounts.history.show).toBe('Ver datos exactos')
    expect(esAccounts.history.none.toLowerCase()).not.toContain('diariamente')
    expect(esAccounts.history.method.toLowerCase()).not.toContain('max')
  })

  it('plots UTC timestamps and signed native cents, with two anchored ticks at 320', () => {
    renderHistory()
    const root = screen.getByText('Recorded balance').closest('[data-account-history]')
    expect(root).toHaveAttribute('data-window-start', '2026-04-18')
    expect(root).toHaveAttribute('data-currency', 'EUR')
    expect(root).toHaveAttribute('data-x-scale', 'utc')
    expect(root).toHaveAttribute('data-x-key', 'utcTimestamp')
    expect(root).toHaveAttribute('data-max-date-ticks', '2')
    expect(root).toHaveAttribute('data-balances', '-211700,-201300,-205400')
    expect(root).toHaveAttribute('data-source-indexes', '0,1,2')
    expect(root).toHaveAttribute('data-zero-in-domain', 'false')
    expect(
      screen.getByText((_, element) => element?.getAttribute('data-history-caption') !== null)
    ).toHaveTextContent('Native EUR history on or after 2026-04-18')
    expect(screen.queryByText(/MAX|daily/i)).not.toBeInTheDocument()

    const model = buildRecordedBalanceModel(
      VISA.map((point) => ({ date: point.date, amountCentavos: point.balance })),
      'EUR',
      { maxDateTicks: 2, includeZero: false, locale: 'en' }
    )
    expect(model.status).toBe('series')
    if (model.status !== 'series') return
    const axis = screen.getByTestId('x-axis')
    expect(axis).toHaveAttribute('data-scale', 'utc')
    expect(axis).toHaveAttribute('data-key', 'utcTimestamp')
    expect(axis).toHaveAttribute('data-type', 'number')
    expect(axis).toHaveAttribute('data-domain', model.xDomain.join(','))
    expect(axis).toHaveAttribute('data-ticks', model.dateTicks.join(','))
    expect(model.dateTicks).toHaveLength(2)
    expect(model.dateTicks[0]).toBe(model.xDomain[0])
    expect(model.dateTicks[1]).toBe(model.xDomain[1])
    expect(model.xDomain[0]).not.toBe(0)
    expect(model.dateTicks).not.toEqual([0, 1, 2])
    const lastGap = model.points[2].utcTimestamp - model.points[1].utcTimestamp
    const firstGap = model.points[1].utcTimestamp - model.points[0].utcTimestamp
    expect(lastGap).toBeLessThan(firstGap)
    expect(captured.data).toEqual(
      model.points.map((point) => ({
        date: point.date,
        amountCentavos: point.amountCentavos,
        utcTimestamp: point.utcTimestamp,
        sourceIndex: point.sourceIndex,
      }))
    )

    const yAxis = screen.getByTestId('y-axis')
    expect(yAxis).toHaveAttribute('data-domain', model.yDomain.join(','))
    expect(yAxis).toHaveAttribute('data-ticks', model.yTicks.join(','))
    expect(Number(yAxis.getAttribute('data-width'))).toBeGreaterThanOrEqual(64)
    expect(model.yDomain[1]).toBeLessThan(0)
    expect(model.yTickLabels.join('|')).toMatch(/-|−|\(/)
    expect(screen.getByTestId('line-series')).toHaveAttribute('data-stroke-width', '2')
    expect(screen.queryByTestId('zero-line')).not.toBeInTheDocument()
    expect(screen.queryByTestId('area-chart')).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Recorded balance QA Visa' })).toHaveTextContent(
      '-€2,117.00'
    )
    expect(screen.getByRole('img', { name: 'Recorded balance QA Visa' })).toHaveTextContent('EUR')
    const latest = screen.getByText('Latest recorded').parentElement
    expect(latest).toHaveTextContent('Oct 18, 2026')
    expect(latest).not.toHaveTextContent('Oct 17')
    expect(latest).toHaveTextContent('-€2,054.00')
    expect(latest).toHaveTextContent('EUR')
  })

  it('uses three ticks at a 375 plot and five on a desktop plot without plotting tick dates as rows', () => {
    const { rerender } = renderHistory({
      plotWidth: 341,
      accountName: 'Cash',
      points: CASH,
      currency: 'USD',
    })
    expect(screen.getByText('Recorded balance').closest('[data-account-history]')).toHaveAttribute(
      'data-max-date-ticks',
      '3'
    )
    expect(
      screen.getByTestId('x-axis').getAttribute('data-ticks')?.split(',').length
    ).toBeGreaterThanOrEqual(2)
    expect(
      screen.getByTestId('x-axis').getAttribute('data-ticks')?.split(',').length
    ).toBeLessThanOrEqual(3)
    rerender(
      <AccountRecordedHistory
        accountName="Cash"
        points={CASH}
        currency="USD"
        windowStart="2026-04-18"
        status="ready"
        locale="en"
        showExact={false}
        plotWidth={800}
      />
    )
    expect(screen.getByText('Recorded balance').closest('[data-account-history]')).toHaveAttribute(
      'data-max-date-ticks',
      '5'
    )
    const ticks = screen.getByTestId('x-axis').getAttribute('data-ticks')?.split(',') ?? []
    expect(ticks.length).toBeGreaterThanOrEqual(2)
    expect(ticks.length).toBeLessThanOrEqual(5)
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-count', '3')
    expect(ticks).not.toEqual(['0', '1', '2'])
  })

  it('includes zero for area without changing the recorded points, and keeps a negative line off zero', async () => {
    const user = userEvent.setup()
    renderHistory({ plotWidth: 800 })
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-count', '3')
    await user.click(screen.getByRole('button', { name: 'Area' }))
    expect(screen.getByTestId('area-chart')).toHaveAttribute('data-count', '3')
    expect(screen.getByTestId('area-series')).toHaveAttribute('data-base', '0')
    const root = screen.getByText('Recorded balance').closest('[data-account-history]')
    expect(root).toHaveAttribute('data-include-zero', 'true')
    expect(root).toHaveAttribute('data-zero-in-domain', 'true')
    expect(root).toHaveAttribute('data-balances', '-211700,-201300,-205400')
    const domain = screen.getByTestId('y-axis').getAttribute('data-domain')?.split(',').map(Number)
    expect(domain?.[0]).toBeLessThan(0)
    expect(domain?.[1]).toBeGreaterThanOrEqual(0)
    expect(screen.getByTestId('zero-line')).toHaveAttribute('data-y', '0')
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
  })

  it('selects a source index without inventing a point, and keeps the exact table outside the image', async () => {
    const user = userEvent.setup()
    renderHistory({ showExact: true, plotWidth: 800 })
    const figure = screen.getByRole('img', { name: 'Recorded balance QA Visa' })
    expect(within(figure).queryByRole('table')).not.toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(table).toHaveTextContent('2026-04-30')
    expect(table).toHaveTextContent('-€2,117.00')
    expect(table).toHaveTextContent('EUR')
    expect(table.querySelector('button')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Previous QA Visa record' }))
    const selected = screen
      .getByText('Selected record')
      .parentElement?.querySelector('[data-history-selected]')
    expect(selected).toHaveAttribute('data-source-index', '1')
    expect(selected?.querySelector('time')).toHaveAttribute('datetime', '2026-08-31')
    expect(selected).toHaveTextContent('Aug 31, 2026')
    expect(selected).toHaveTextContent('-€2,013.00')
    expect(selected).not.toHaveTextContent('Aug 30')
    expect(table.querySelector('[data-source-index="1"]')).toHaveAttribute('data-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'select-first-point' }))
    expect(document.querySelector('[data-history-selected]')).toHaveAttribute(
      'data-source-index',
      '0'
    )
    expect(screen.getByTestId('line-chart')).toHaveAttribute('data-count', '3')
  })

  it('does not draw a line, zero, or fake point for single, flat, or empty history', () => {
    const { rerender } = renderHistory({
      points: [{ date: '2026-02-28', balance: 2_142_980 }],
      currency: 'USD',
      accountName: 'Checking',
    })
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.queryByTestId('zero-line')).not.toBeInTheDocument()
    expect(screen.getByText(/One recorded balance on 2026-02-28/)).toHaveTextContent('$21,429.80')
    expect(screen.getByText(/Not a trend/)).toBeInTheDocument()

    rerender(
      <AccountRecordedHistory
        accountName="Wallet"
        points={[
          { date: '2026-04-30', balance: 0 },
          { date: '2026-10-18', balance: 0 },
        ]}
        currency="USD"
        windowStart="2026-04-18"
        status="ready"
        locale="en"
        showExact={false}
        plotWidth={800}
      />
    )
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.getByText(/Unchanged at \$0\.00/)).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    rerender(
      <AccountRecordedHistory
        accountName="Empty"
        points={[]}
        currency="EUR"
        windowStart="2026-04-18"
        status="ready"
        locale="en"
        showExact
        plotWidth={800}
      />
    )
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.getByText('No recorded history')).toBeInTheDocument()
    expect(screen.getByText('No recorded balances in this window.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByText('€0.00')).not.toBeInTheDocument()
  })

  it('shows a failed read as unavailable rather than a zero series', () => {
    renderHistory({ status: 'error', windowStart: null, points: VISA })
    expect(screen.getAllByText('History unavailable').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('line-chart')).not.toBeInTheDocument()
    expect(screen.queryByText('-€2,117.00')).not.toBeInTheDocument()
    const root = screen.getByText('Recorded balance').closest('[data-account-history]')
    expect(root).toHaveAttribute('data-window-start', '')
    expect(root).toHaveAttribute('data-balances', '')
  })
})
