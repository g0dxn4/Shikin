import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MonthGrid } from '../month-grid'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) =>
      typeof params?.count === 'number' ? `${key} ${params.count}` : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const days = Array.from({ length: 35 }, (_, index) => (index < 4 ? null : index - 3))

function renderGrid(
  marks: Map<string, { paid: number; unpaid: number }>,
  selectedDate: string | null = null
) {
  const onSelectDate = vi.fn()
  render(
    <MonthGrid
      monthName="June 2026"
      monthKey="2026-06"
      todayKey="2026-06-15"
      days={days}
      marks={marks}
      selectedDate={selectedDate}
      onSelectDate={onSelectDate}
    />
  )
  return { onSelectDate }
}

describe('MonthGrid marked days', () => {
  it('offers only existing marks above the scrolling grid, as counts not money', async () => {
    const user = userEvent.setup()
    const marks = new Map([
      ['2026-06-27', { paid: 1, unpaid: 1 }],
      ['2026-06-02', { paid: 0, unpaid: 0 }],
    ])
    const { onSelectDate } = renderGrid(marks)
    const region = screen.getByRole('region', { name: 'calendar.scrollRegion' })
    const chips = screen.getByRole('list', { name: 'calendar.markedDays' })
    expect(region).not.toContainElement(chips)
    expect(chips.closest('.overflow-x-auto')).toBeNull()
    expect(region).toContainElement(screen.getByRole('table', { name: 'June 2026' }))
    expect(screen.getByRole('table')).toHaveClass('min-w-[22rem]')
    const chipButtons = within(chips).getAllByRole('button')
    expect(chipButtons).toHaveLength(1)
    const chip = screen.getByRole('button', {
      name: '2026-06-27, calendar.paidCount 1, calendar.unpaidCount 1',
    })
    expect(chip).toHaveClass('min-h-11')
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    expect(within(chip).getAllByText('1')).toHaveLength(2)
    expect(chip.textContent).not.toMatch(/[$€]|MX\$/)
    expect(screen.queryByRole('button', { name: /2026-06-02/ })).not.toBeInTheDocument()
    await user.click(chip)
    expect(onSelectDate).toHaveBeenCalledTimes(1)
    expect(onSelectDate).toHaveBeenCalledWith('2026-06-27')
  })

  it('shares the selected date with the grid day and does not invent marks', () => {
    renderGrid(new Map([['2026-06-27', { paid: 0, unpaid: 2 }]]), '2026-06-27')
    const chip = screen.getByRole('button', {
      name: '2026-06-27, calendar.paidCount 0, calendar.unpaidCount 2',
    })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip.querySelector('[data-mark="paid"]')).toBeNull()
    expect(chip.querySelector('[data-mark="unpaid"]')).toBeInTheDocument()
    const day = screen.getByRole('button', {
      name: /June 2026 27, scheduledCount 2, calendar\.paidCount 0, calendar\.unpaidCount 2/,
    })
    expect(day).toHaveAttribute('aria-pressed', 'true')
    expect(day).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { current: 'date' })).toHaveAttribute('aria-pressed', 'false')
    expect(
      within(screen.getByRole('list', { name: 'calendar.markedDays' })).getAllByRole('button')
    ).toHaveLength(1)
  })
})
