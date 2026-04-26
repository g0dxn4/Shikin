import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { BottomNav } from '../bottom-nav'

describe('BottomNav', () => {
  it('renders a More trigger when extra mobile pages are provided', () => {
    render(
      <MemoryRouter>
        <BottomNav
          items={[{ icon: <span>D</span>, label: 'Dashboard', href: '/' }]}
          moreItems={[{ icon: <span>B</span>, label: 'Budgets', href: '/budgets' }]}
          activeHref="/"
        />
      </MemoryRouter>
    )

    expect(screen.getByLabelText('More pages')).toBeInTheDocument()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('marks the More trigger active when a hidden route is selected', () => {
    render(
      <MemoryRouter>
        <BottomNav
          items={[{ icon: <span>D</span>, label: 'Dashboard', href: '/' }]}
          moreItems={[{ icon: <span>B</span>, label: 'Budgets', href: '/budgets' }]}
          activeHref="/budgets"
        />
      </MemoryRouter>
    )

    expect(screen.getByLabelText('More pages')).toHaveClass('text-accent-hover')
  })

  it('active primary link exposes aria-current="page"', () => {
    render(
      <MemoryRouter>
        <BottomNav
          items={[{ icon: <span aria-hidden="true">D</span>, label: 'Dashboard', href: '/' }]}
          activeHref="/"
        />
      </MemoryRouter>
    )

    const activeLink = screen.getByRole('link', { name: 'Dashboard' })
    expect(activeLink).toHaveAttribute('aria-current', 'page')
  })

  it('has mobile primary navigation aria-label', () => {
    render(
      <MemoryRouter>
        <BottomNav
          items={[{ icon: <span>D</span>, label: 'Dashboard', href: '/' }]}
          activeHref="/"
        />
      </MemoryRouter>
    )

    expect(
      screen.getByRole('navigation', { name: 'Mobile primary navigation' })
    ).toBeInTheDocument()
  })
})
