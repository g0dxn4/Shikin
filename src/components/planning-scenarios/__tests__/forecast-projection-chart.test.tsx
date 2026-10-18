import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ForecastProjectionChart } from '@/components/planning-scenarios/forecast-projection-chart'
import { forecastUncertaintyBand } from '@/components/planning-scenarios/forecast-band-geometry'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}))

vi.mock('@/components/ui/safe-chart', () => ({
  SafeChart: ({ children }: { children: ReactNode }) => (
    <div data-testid="safe-chart">{children}</div>
  ),
}))

const captured: {
  rows: Array<{ date: string; band: [number, number]; projected: number }>
  area: Record<string, unknown> | null
  lines: Array<Record<string, unknown>>
  yDomain: unknown
  xKey: unknown
} = {
  rows: [],
  area: null,
  lines: [],
  yDomain: null,
  xKey: null,
}

vi.mock('recharts', () => ({
  ComposedChart: ({
    data,
    children,
  }: {
    data?: Array<{ date: string; band: [number, number]; projected: number }>
    children?: React.ReactNode
  }) => {
    captured.rows = data ?? []
    return <div data-testid="composed-chart">{children}</div>
  },
  Area: (props: Record<string, unknown>) => {
    captured.area = props
    return (
      <div
        data-testid="forecast-band"
        data-key={String(props.dataKey)}
        data-fill={String(props.fill)}
        data-opacity={String(props.fillOpacity)}
        data-stroke={String(props.stroke)}
      />
    )
  },
  Line: (props: Record<string, unknown>) => {
    captured.lines.push(props)
    return (
      <div
        data-testid={`forecast-line-${String(props.dataKey)}`}
        data-width={String(props.strokeWidth)}
        data-dash={props.strokeDasharray ? String(props.strokeDasharray) : ''}
        data-stroke={String(props.stroke)}
      />
    )
  },
  XAxis: (props: { dataKey?: string }) => {
    captured.xKey = props.dataKey
    return <div data-testid="x-axis" data-key={props.dataKey ?? ''} />
  },
  YAxis: (props: { domain?: unknown; allowDataOverflow?: boolean }) => {
    captured.yDomain = props.domain
    return (
      <div
        data-testid="y-axis"
        data-overflow={props.allowDataOverflow ? 'true' : 'false'}
        data-domain={Array.isArray(props.domain) ? props.domain.join(',') : ''}
      />
    )
  },
  CartesianGrid: () => null,
  Tooltip: () => <div data-testid="forecast-tooltip" />,
}))

const points = [
  { date: '2028-01-01', projected: 4_265_840, optimistic: 4_300_000, pessimistic: 4_200_000 },
  { date: '2028-01-02', projected: 4_512_730, optimistic: 4_600_000, pessimistic: 4_400_000 },
]

describe('ForecastProjectionChart band', () => {
  it('renders the uncertainty band between the outer series on a padded positive domain', () => {
    captured.lines = []
    render(<ForecastProjectionChart points={points} currency="USD" />)

    const root = document.querySelector('[data-band]')
    expect(root).toHaveAttribute('data-band', 'between')
    expect(root).toHaveAttribute('data-includes-zero', 'false')
    expect(root).toHaveAttribute('data-band-fill', 'var(--color-chart-1)')
    expect(root?.innerHTML).not.toContain('var(--color-primary)')
    expect(root?.innerHTML).not.toContain('url(#')

    const band = screen.getByTestId('forecast-band')
    expect(band).toHaveAttribute('data-key', 'band')
    expect(band).toHaveAttribute('data-fill', 'var(--color-chart-1)')
    expect(band).toHaveAttribute('data-opacity', '0.12')
    expect(band).toHaveAttribute('data-stroke', 'none')
    expect(captured.area?.tooltipType).toBe('none')
    expect(captured.area?.stackId).toBeUndefined()

    expect(screen.getByTestId('forecast-line-projected')).toHaveAttribute('data-width', '2')
    expect(screen.getByTestId('forecast-line-projected')).toHaveAttribute('data-dash', '')
    expect(screen.getByTestId('forecast-line-projected')).toHaveAttribute(
      'data-stroke',
      'var(--color-chart-1)'
    )
    for (const key of ['optimistic', 'pessimistic']) {
      const line = screen.getByTestId(`forecast-line-${key}`)
      expect(line).toHaveAttribute('data-width', '1.25')
      expect(line).toHaveAttribute('data-dash', '4 3')
    }

    expect(screen.getByTestId('x-axis')).toHaveAttribute('data-key', 'date')
    expect(captured.xKey).toBe('date')
    const domain = String(screen.getByTestId('y-axis').getAttribute('data-domain'))
      .split(',')
      .map(Number)
    expect(domain[0]).toBeGreaterThan(0)
    expect(domain[0]).toBeLessThan(4_200_000)
    expect(domain[1]).toBeGreaterThan(4_600_000)
    expect(screen.getByTestId('y-axis')).toHaveAttribute('data-overflow', 'true')

    expect(captured.rows).toHaveLength(points.length)
    expect(captured.rows.map((row) => row.date)).toEqual(points.map((point) => point.date))
    expect(captured.rows.map((row) => row.projected)).toEqual(
      points.map((point) => point.projected)
    )
    expect(captured.rows.map((row) => row.band)).toEqual(points.map(forecastUncertaintyBand))
    expect(screen.getByRole('table', { name: 'chart.title' })).toHaveTextContent('2028-01-01')
    expect(screen.getByRole('table', { name: 'chart.title' })).toHaveTextContent('$42,658.40')
  })

  it('includes zero in the axis when any series value is non-positive', () => {
    captured.lines = []
    render(
      <ForecastProjectionChart
        points={[
          { date: '2028-02-01', projected: 1_000, optimistic: 1_200, pessimistic: -50 },
          { date: '2028-02-02', projected: -20, optimistic: 40, pessimistic: -80 },
        ]}
        currency="USD"
      />
    )
    expect(document.querySelector('[data-includes-zero]')).toHaveAttribute(
      'data-includes-zero',
      'true'
    )
    const domain = String(screen.getByTestId('y-axis').getAttribute('data-domain'))
      .split(',')
      .map(Number)
    expect(domain[0]).toBeLessThanOrEqual(-80)
    expect(domain[0]).toBeLessThanOrEqual(0)
    expect(domain[1]).toBeGreaterThanOrEqual(0)
    expect(domain[1]).toBeGreaterThanOrEqual(1_200)
    expect(screen.getByTestId('forecast-band')).toHaveAttribute('data-key', 'band')
  })
})
