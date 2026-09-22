import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '../app-shell'

let mockPathname = '/'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, value?: string | { section?: string }) => {
      if (typeof value === 'string') return value
      if (key === 'navigation.section') return `${value?.section} section navigation`
      return key
    },
  }),
}))

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

  it('renders the shared shell, route heading, and outlet', () => {
    render(<AppShell />)

    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument()
    const heading = screen.getByRole('heading', { level: 1, name: 'Overview' })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveClass('sr-only')
    expect(document.querySelector('.native-topbar')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAccessibleName('Overview')
    expect(screen.getByTestId('outlet')).toBeInTheDocument()
  })

  it('does not render shell cross-page tabs on single or multi-route sections', () => {
    const { rerender } = render(<AppShell />)
    expect(document.querySelector('.native-topbar')).not.toBeInTheDocument()
    expect(document.querySelector('.native-subnav')).not.toBeInTheDocument()

    mockPathname = '/categories'
    rerender(<AppShell />)

    const heading = screen.getByRole('heading', { level: 1, name: 'Categories' })
    expect(heading).toHaveClass('sr-only')
    expect(document.querySelector('.native-subnav')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAccessibleName('Categories')
  })

  it('resets and focuses the internal page scroller when the route changes', () => {
    const { rerender } = render(<AppShell />)
    const previousMain = document.getElementById('main-content')
    expect(previousMain).not.toBeNull()
    previousMain!.scrollTop = 480

    mockPathname = '/transactions'
    rerender(<AppShell />)

    const currentMain = document.getElementById('main-content')
    expect(currentMain).not.toBe(previousMain)
    expect(currentMain).toHaveProperty('scrollTop', 0)
    expect(currentMain).toHaveFocus()
  })
})
