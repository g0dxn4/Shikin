import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DueHorizon } from '../due-horizon'
import en from '@/i18n/locales/en/billCalendar.json'
import es from '@/i18n/locales/es/billCalendar.json'

type HorizonProps = Parameters<typeof DueHorizon>[0]

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) =>
      typeof params?.count === 'number' ? `${key} ${params.count}` : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

function renderHorizon(overrides: Partial<HorizonProps> = {}) {
  return render(
    <DueHorizon
      overdue={0}
      next7={2}
      later={4}
      isLoading={false}
      runRateValue="$10.00"
      runRateDetail="currency.estimateToday"
      runRateUnavailable={false}
      thisMonthCount={3}
      soonCount={5}
      {...overrides}
    />
  )
}

describe('DueHorizon', () => {
  it('draws rule-count columns and an outlined zero instead of a filled share', () => {
    const { container } = renderHorizon()
    expect(
      screen.getByRole('img', {
        name: 'horizon.overdueCount 0. horizon.next7Count 2. horizon.laterCount 4.',
      })
    ).toBeInTheDocument()
    const overdue = container.querySelector('[data-count-shape="overdue"]')
    const next7 = container.querySelector('[data-count-shape="next7"]')
    const later = container.querySelector('[data-count-shape="later"]')
    expect(overdue).toHaveAttribute('data-filled', 'false')
    expect(overdue).toHaveTextContent('0')
    expect(overdue).toHaveClass('border', 'border-destructive', 'bg-transparent')
    expect(overdue).not.toHaveClass('bg-destructive', 'bg-warning', 'bg-chart-1')
    expect(overdue?.getAttribute('style')).toBeNull()
    expect(next7).toHaveAttribute('data-filled', 'true')
    expect(later).toHaveAttribute('data-filled', 'true')
    expect(next7).toHaveStyle({ height: '40px' })
    expect(later).toHaveStyle({ height: '80px' })
    expect(next7).toHaveClass('bg-warning')
    expect(later).toHaveClass('bg-chart-1')
    for (const shape of [overdue, next7, later]) {
      expect(shape?.getAttribute('style') ?? '').not.toMatch(/min-width|flex-grow|flex-basis/i)
    }
    const legend = screen.getByRole('list', { name: 'horizon.legend' })
    expect(within(legend).queryByText(/[$€]|MX\$/)).not.toBeInTheDocument()
    expect(screen.getByText('$10.00').closest('[role="img"]')).toBeNull()
    expect(screen.getByText('$10.00')).toHaveClass('text-sm')
    expect(screen.getByText('$10.00')).not.toHaveClass('text-2xl')
  })

  it('does not fill any column while loading or when every count is zero', () => {
    const { container, rerender } = renderHorizon({
      isLoading: true,
      overdue: 3,
      next7: 3,
      later: 3,
    })
    expect(container.querySelector('[data-filled="true"]')).toBeNull()
    expect(screen.getByRole('img', { name: 'horizon.loading' })).toBeInTheDocument()
    expect(screen.queryByText('horizon.scope')).not.toBeInTheDocument()

    rerender(
      <DueHorizon
        overdue={0}
        next7={0}
        later={0}
        isLoading={false}
        runRateValue="currency.unavailable"
        runRateDetail="currency.missing"
        runRateUnavailable
        thisMonthCount={0}
        soonCount={0}
      />
    )
    expect(container.querySelector('[data-filled="true"]')).toBeNull()
    expect(container.querySelectorAll('[data-filled="false"]')).toHaveLength(3)
    expect(screen.getByText('currency.missing')).toBeVisible()
    expect(screen.getByText('currency.unavailable')).toHaveClass('text-warning')
    expect(screen.queryByText('currency.estimate')).not.toBeInTheDocument()
  })

  it('keeps count method and the estimate sentence behind info', async () => {
    const user = userEvent.setup()
    renderHorizon()
    expect(screen.queryByText('horizon.scope')).not.toBeInTheDocument()
    expect(screen.queryByText('currency.estimateToday')).not.toBeInTheDocument()
    expect(screen.getByText('currency.estimate')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'horizon.about' }))
    expect(screen.getByText('horizon.scope')).toBeVisible()
    expect(screen.getByText('currency.estimateToday')).toBeVisible()
  })

  it('translates the new short labels in English and Spanish', () => {
    for (const copy of [en, es]) {
      expect(copy.horizon.about.length).toBeGreaterThan(0)
      expect(copy.calendar.markedDays.length).toBeGreaterThan(0)
      expect(copy.currency.basis.length).toBeGreaterThan(0)
      expect(copy.currency.estimate.length).toBeGreaterThan(0)
      expect(copy.schedule.about.length).toBeGreaterThan(0)
      expect(copy.schedule.recordedChip.length).toBeGreaterThan(0)
      expect(copy.schedule.nativeChip.length).toBeGreaterThan(0)
      expect(copy.bills.aboutList.length).toBeGreaterThan(0)
    }
    expect(en.horizon.about).not.toBe(es.horizon.about)
    expect(en.currency.basis).not.toBe(es.currency.basis)
    expect(en.schedule.recordedChip).not.toBe(es.schedule.recordedChip)
  })
})
