import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  NavLink: ({
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

  it('renders the six desktop navigation groups', () => {
    render(<Sidebar />)

    expect(screen.getAllByRole('link')).toHaveLength(6)
    for (const label of [
      'Overview',
      'Transactions',
      'Accounts',
      'Planning',
      'Insights',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
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

  it('shows labels when expanded and accessible icon links when collapsed', () => {
    const { rerender } = render(<Sidebar />)
    expect(screen.getByText('Shikin')).toBeInTheDocument()
    expect(screen.getByText('Overview')).toBeInTheDocument()

    mockSidebarCollapsed = true
    rerender(<Sidebar />)
    expect(screen.queryByText('Shikin')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Overview')).toHaveAttribute('href', '/')
  })

  it('uses a labelled footer collapse control', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    const button = screen.getByRole('button', { name: 'Collapse sidebar' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    await user.click(button)
    expect(mockToggleSidebar).toHaveBeenCalledOnce()
  })

  it('marks a group active for one of its contextual routes', () => {
    mockPathname = '/spending-heatmap'
    render(<Sidebar />)

    expect(screen.getByRole('link', { name: 'Insights' })).toHaveAttribute('aria-current', 'page')
  })
})
