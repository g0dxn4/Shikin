import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../sidebar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}))

const mockToggleSidebar = vi.fn()
let mockSidebarCollapsed = false

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: '/' }),
  NavLink: ({
    children,
    to,
    className,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode | ((props: { isActive: boolean }) => React.ReactNode)
    to: string
    className: string | ((args: { isActive: boolean }) => string)
    'aria-label'?: string
  }) => {
    const resolvedChildren =
      typeof children === 'function' ? children({ isActive: false }) : children
    return (
      <a
        href={to}
        className={typeof className === 'function' ? className({ isActive: false }) : className}
        aria-label={ariaLabel}
      >
        {resolvedChildren}
      </a>
    )
  },
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    sidebarCollapsed: mockSidebarCollapsed,
    toggleSidebar: mockToggleSidebar,
  }),
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSidebarCollapsed = false
  })

  it('expanded: shows "Shikin" brand text and nav labels', () => {
    render(<Sidebar />)

    expect(screen.getByText('Shikin')).toBeInTheDocument()
    expect(screen.getByText('nav.dashboard')).toBeInTheDocument()
    expect(screen.getByText('nav.transactions')).toBeInTheDocument()
    expect(screen.getByText('nav.accounts')).toBeInTheDocument()
    expect(screen.getByText('nav.budgets')).toBeInTheDocument()
    expect(screen.getByText('nav.goals')).toBeInTheDocument()
    expect(screen.getByText('nav.insights')).toBeInTheDocument()
    expect(screen.getByText('nav.settings')).toBeInTheDocument()
  })

  it('collapsed: hides brand text and nav labels', () => {
    mockSidebarCollapsed = true

    render(<Sidebar />)

    expect(screen.queryByText('Shikin')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument()
  })

  it('renders all nav links', () => {
    render(<Sidebar />)

    const links = screen.getAllByRole('link')
    expect(links.length).toBe(7)
  })

  it('collapse button calls toggleSidebar', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    // The collapse button is the button in the header area
    const collapseBtn = screen.getAllByRole('button')[0]
    await user.click(collapseBtn)

    expect(mockToggleSidebar).toHaveBeenCalled()
  })

  it('Settings link points to /settings', () => {
    render(<Sidebar />)

    const settingsLink = screen.getByText('nav.settings').closest('a')
    expect(settingsLink).toHaveAttribute('href', '/settings')
  })

  it('Insights link points to /insights', () => {
    render(<Sidebar />)

    const insightsLink = screen.getByText('nav.insights').closest('a')
    expect(insightsLink).toHaveAttribute('href', '/insights')
  })

  describe('accessibility', () => {
    it('toggle button has aria-label and aria-expanded', () => {
      render(<Sidebar />)

      const toggleBtn = screen.getByLabelText('Collapse sidebar')
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
    })

    it('collapsed toggle button has aria-label for expand', () => {
      mockSidebarCollapsed = true
      render(<Sidebar />)

      const toggleBtn = screen.getByLabelText('Expand sidebar')
      expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')
    })

    it('navigation has aria-label', () => {
      render(<Sidebar />)

      const nav = screen.getByRole('navigation', { name: 'Main navigation' })
      expect(nav).toBeInTheDocument()
    })

    it('collapsed nav links have aria-labels', () => {
      mockSidebarCollapsed = true
      render(<Sidebar />)

      // When collapsed, nav links should have aria-labels for screen reader accessibility
      // Check specific links we know should have aria-labels
      const dashboardLink = screen.getByLabelText('nav.dashboard')
      const settingsLink = screen.getByLabelText('nav.settings')
      expect(dashboardLink).toHaveAttribute('href', '/')
      expect(settingsLink).toHaveAttribute('href', '/settings')
    })
  })
})
