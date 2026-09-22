import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from '../sidebar'
import { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH } from '@/lib/constants'

const mockToggleSidebar = vi.fn()
let mockSidebarCollapsed = false
let mockPathname = '/'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      (typeof fallback === 'string' ? fallback : undefined) ??
      ({
        'navigation.primary': 'Primary navigation',
        'navigation.main': 'Main navigation',
        'navigation.expandGroup': 'Expand group',
        'navigation.collapseGroup': 'Collapse group',
        'sidebar.expand': 'Expand sidebar',
        'sidebar.collapse': 'Collapse sidebar',
        'app.tagline': 'Personal finance',
        'appearance.label': 'Appearance',
        'appearance.light': 'Light',
        'appearance.dark': 'Dark',
        'appearance.custom': 'Custom',
      }[key] ||
        key),
  }),
}))

vi.mock('react-router', () => ({
  useLocation: () => ({ pathname: mockPathname }),
  Link: ({
    children,
    to,
    className,
    ...props
  }: {
    children: React.ReactNode
    to: string
    className: string
    [key: string]: unknown
  }) => (
    <a href={to} className={className} {...props}>
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

vi.mock('@/lib/theme', () => ({
  getAppliedAppearance: () => 'native-light',
  subscribeAppearance: () => () => {},
  setAppearance: vi.fn(),
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSidebarCollapsed = false
    mockPathname = '/'
  })

  it('renders six top-level groups with multi-route groups as disclosure buttons', () => {
    render(<Sidebar />)

    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Transactions' })).toBeInTheDocument()
    for (const label of ['Accounts', 'Planning', 'Insights', 'Settings']) {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-controls')
    }
  })

  it('uses the approved expanded and collapsed widths', () => {
    const { rerender } = render(<Sidebar />)
    expect(screen.getByLabelText('Primary navigation')).toHaveStyle({ width: `${SIDEBAR_WIDTH}px` })

    mockSidebarCollapsed = true
    rerender(<Sidebar />)
    expect(screen.getByLabelText('Primary navigation')).toHaveStyle({
      width: `${SIDEBAR_COLLAPSED_WIDTH}px`,
    })
  })

  it('expands a group from the keyboard and exposes its indented home route', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const planning = screen.getByRole('button', { name: 'Planning' })
    planning.focus()
    await user.keyboard('{Enter}')

    expect(planning).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('link', { name: 'Budgets' })).toHaveAttribute('href', '/budgets')
    expect(screen.getByRole('link', { name: 'Bill calendar' })).toHaveClass('sidebar-child-link')
  })

  it('opens the active group, marks the actual route current, and keeps a collapsed group active', async () => {
    const user = userEvent.setup()
    mockPathname = '/categories'
    render(<Sidebar />)

    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings).toHaveAttribute('aria-expanded', 'true')
    expect(settings).toHaveClass('sidebar-group-active')
    expect(screen.getByRole('link', { name: 'Categories' })).toHaveAttribute('aria-current', 'page')

    await user.click(settings)
    expect(settings).toHaveAttribute('aria-expanded', 'false')
    expect(settings).toHaveClass('sidebar-group-active')
    expect(screen.queryByRole('link', { name: 'Categories' })).not.toBeInTheDocument()
  })

  it('reopens the active group when navigation changes within that group', async () => {
    const user = userEvent.setup()
    mockPathname = '/bills'
    const { rerender } = render(<Sidebar />)

    const planning = screen.getByRole('button', { name: 'Planning' })
    await user.click(planning)
    expect(planning).toHaveAttribute('aria-expanded', 'false')

    mockPathname = '/forecast'
    rerender(<Sidebar />)

    await waitFor(() => expect(planning).toHaveAttribute('aria-expanded', 'true'))
    expect(screen.getByRole('link', { name: 'Forecast' })).toHaveAttribute('aria-current', 'page')
  })

  it('expands the narrow rail before revealing a multi-route group', async () => {
    const user = userEvent.setup()
    mockSidebarCollapsed = true
    const { rerender } = render(<Sidebar />)

    expect(screen.queryByText('Shikin')).not.toBeInTheDocument()
    const accounts = screen.getByRole('button', { name: 'Accounts' })
    expect(accounts).toHaveAttribute('aria-expanded', 'false')

    await user.click(accounts)
    expect(mockToggleSidebar).toHaveBeenCalledOnce()

    mockSidebarCollapsed = false
    rerender(<Sidebar />)
    expect(screen.getByRole('button', { name: 'Accounts' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts')
  })

  it('uses a labelled footer collapse control', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const button = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.click(button)
    expect(mockToggleSidebar).toHaveBeenCalledOnce()
  })
})
