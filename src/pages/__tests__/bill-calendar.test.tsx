import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BillCalendar } from '../bill-calendar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

describe('BillCalendar', () => {
  it('renders calendar grid and navigation', () => {
    render(<BillCalendar />)

    expect(screen.getByText('title')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'prevMonth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'nextMonth' })).toBeInTheDocument()
    expect(screen.getByRole('grid')).toBeInTheDocument()
  })

  it('navigates to previous and next months', async () => {
    const user = userEvent.setup()
    render(<BillCalendar />)

    const prevBtn = screen.getByRole('button', { name: 'prevMonth' })
    const nextBtn = screen.getByRole('button', { name: 'nextMonth' })

    const initialMonth = screen.getByRole('heading', { level: 2 }).textContent

    await user.click(prevBtn)
    const prevMonth = screen.getByRole('heading', { level: 2 }).textContent
    expect(prevMonth).not.toBe(initialMonth)

    await user.click(nextBtn)
    await user.click(nextBtn)
    const nextMonth = screen.getByRole('heading', { level: 2 }).textContent
    expect(nextMonth).not.toBe(prevMonth)
  })

  it('renders localized day headers', () => {
    render(<BillCalendar />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.length).toBe(7)
    expect(headers[0]).toHaveTextContent('dayLabels.sunday')
  })
})
