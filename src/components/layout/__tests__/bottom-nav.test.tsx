import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { BottomNav } from '../bottom-nav'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      fallback ??
      ({
        'navigation.mobile': 'Mobile primary navigation',
        'navigation.more': 'More pages',
        'navigation.moreShort': 'More',
        'navigation.allDestinations': 'All destinations',
        'navigation.allDestinationsDescription': 'Every page',
      }[key] ||
        key),
  }),
}))

describe('BottomNav', () => {
  it('renders Overview, Transactions, Accounts, and More', () => {
    render(
      <MemoryRouter>
        <BottomNav activeHref="/" />
      </MemoryRouter>
    )

    const nav = screen.getByRole('navigation', { name: 'Mobile primary navigation' })
    expect(within(nav).getAllByRole('link')).toHaveLength(3)
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(nav).getByRole('link', { name: 'Transactions' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Accounts' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: 'More pages' })).toBeInTheDocument()
  })

  it.each([
    ['/categories', 'Transactions'],
    ['/investments', 'Accounts'],
    ['/receivables', 'Accounts'],
  ])('keeps the primary group active on %s', (path, group) => {
    render(
      <MemoryRouter>
        <BottomNav activeHref={path} />
      </MemoryRouter>
    )

    expect(screen.getByRole('link', { name: group })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: group })).toHaveClass('bottom-nav-link-active')
    expect(screen.getByRole('button', { name: 'More pages' })).not.toHaveClass(
      'bottom-nav-link-active'
    )
  })

  it('marks More active for a route outside the three primary groups', () => {
    render(
      <MemoryRouter>
        <BottomNav activeHref="/reports" />
      </MemoryRouter>
    )

    expect(screen.getByRole('button', { name: 'More pages' })).toHaveClass('bottom-nav-link-active')
  })

  it('exposes all 19 routes in grouped More navigation', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <BottomNav activeHref="/bill-calendar" />
      </MemoryRouter>
    )

    await user.click(screen.getByRole('button', { name: 'More pages' }))
    const dialog = await screen.findByRole('dialog')
    const destinations = within(dialog).getAllByRole('link')
    expect(destinations).toHaveLength(19)
    expect(within(dialog).getByRole('heading', { name: 'Planning' })).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'Bill calendar' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(within(dialog).getByRole('link', { name: 'Extensions' })).toHaveAttribute(
      'href',
      '/extensions'
    )
  })
})
