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
const mockToggleAIPanel = vi.fn()
let mockSidebarCollapsed = false

vi.mock('react-router', () => ({
  NavLink: ({ children, to, className }: { children: React.ReactNode; to: string; className: (args: { isActive: boolean }) => string }) => (
    <a href={to} className={typeof className === 'function' ? className({ isActive: false }) : className}>
      {children}
    </a>
  ),
}))

vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    sidebarCollapsed: mockSidebarCollapsed,
    toggleSidebar: mockToggleSidebar,
    toggleAIPanel: mockToggleAIPanel,
  }),
}))

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSidebarCollapsed = false
  })

  it('expanded: shows "Valute" brand text and nav labels', () => {
    render(<Sidebar />)

    expect(screen.getByText('Valute')).toBeInTheDocument()
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

    expect(screen.queryByText('Valute')).not.toBeInTheDocument()
    expect(screen.queryByText('nav.dashboard')).not.toBeInTheDocument()
  })

  it('renders 8 nav links + Settings link', () => {
    render(<Sidebar />)

    const links = screen.getAllByRole('link')
    // 8 nav items + 1 settings
    expect(links.length).toBe(9)
  })

  it('collapse button calls toggleSidebar', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    // The collapse button is the button in the header area
    const collapseBtn = screen.getAllByRole('button')[0]
    await user.click(collapseBtn)

    expect(mockToggleSidebar).toHaveBeenCalled()
  })

  it('AI button calls toggleAIPanel', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    // The AI button shows "nav.ai" text
    await user.click(screen.getByText('nav.ai'))

    expect(mockToggleAIPanel).toHaveBeenCalled()
  })

  it('Settings link points to /settings', () => {
    render(<Sidebar />)

    const settingsLink = screen.getByText('nav.settings').closest('a')
    expect(settingsLink).toHaveAttribute('href', '/settings')
  })
})
