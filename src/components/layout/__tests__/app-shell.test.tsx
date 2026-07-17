import { beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../app-shell'

let mockPathname = '/'

vi.mock('react-router', () => ({
  Outlet: () => <div data-testid="outlet">Outlet Content</div>,
  useLocation: () => ({ pathname: mockPathname }),
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
  beforeEach(() => {
    mockPathname = '/'
  })

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

  it('resets the internal page scroller when the route changes', () => {
    const { rerender } = render(<AppShell />)
    const previousMain = document.getElementById('main-content')
    expect(previousMain).not.toBeNull()

    previousMain!.scrollTop = 480
    mockPathname = '/transactions'
    rerender(<AppShell />)

    const currentMain = document.getElementById('main-content')
    expect(currentMain).not.toBe(previousMain)
    expect(currentMain).toHaveProperty('scrollTop', 0)
  })
})
