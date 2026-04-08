import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../app-shell'

vi.mock('react-router', () => ({
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useLocation: () => ({ pathname: '/' }),
}))

vi.mock('../bottom-nav', () => ({
  BottomNav: () => <div data-testid="bottom-nav">Bottom Nav</div>,
}))

vi.mock('../sidebar', () => ({
  Sidebar: () => <div data-testid="sidebar">Sidebar</div>,
}))

vi.mock('@/components/ui/loading-spinner', () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">Loading...</div>,
}))

describe('AppShell', () => {
  it('renders sidebar and outlet', () => {
    render(<AppShell />)

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('renders bottom navigation', () => {
    render(<AppShell />)

    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
  })

  it('has correct layout structure', () => {
    const { container } = render(<AppShell />)

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveClass('flex', 'h-screen')
  })
})
