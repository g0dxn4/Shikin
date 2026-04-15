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
  NavLink: ({
    children,
    to,
    className,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode
    to: string
    className: (args: { isActive: boolean }) => string
    'aria-label'?: string
  }) => (
    <a
      href={to}
      className={typeof className === 'function' ? className({ isActive: false }) : className}
      aria-label={ariaLabel}
    >
      {children}
    </a>
  ),
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
    expect(screen.getByText('nav.investments')).toBeInTheDocument()
    expect(screen.getByText('nav.subscriptions')).toBeInTheDocument()
  })

  it('collapsed: hides brand text and nav labels', () => {
    mockSidebarCollapsed = true

    render(<Sidebar />)

    expect(screen.queryByText('Shikin')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument()
  })

  it('renders 10 nav links + Settings link', () => {
    render(<Sidebar />)

    const links = screen.getAllByRole('link')
    // 13 nav items + 1 settings
    expect(links.length).toBe(14)
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
