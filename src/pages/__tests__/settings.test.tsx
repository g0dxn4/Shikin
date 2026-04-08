import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SettingsPage } from '../settings'

const mockChangeLanguage = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: mockChangeLanguage },
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: 'USD',
    lastFetched: null,
    isLoading: false,
    rates: {},
    loadRates: vi.fn(),
    refreshRates: vi.fn(),
    setPreferredCurrency: vi.fn(),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetch: vi.fn(),
  }),
}))

vi.mock('@/stores/categorization-store', () => ({
  useCategorizationStore: () => ({
    rules: [],
    isLoading: false,
    loadRules: vi.fn(),
    deleteRule: vi.fn(),
  }),
}))

vi.mock('@/lib/exchange-rate-service', () => ({
  COMMON_CURRENCIES: ['USD', 'EUR', 'GBP'],
}))

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  runInTransaction: vi.fn(),
  exportDatabaseSnapshot: vi.fn(),
  importDatabaseSnapshot: vi.fn(),
}))

vi.mock('@/components/ThemeSettings', () => ({
  ThemeSettings: () => <div data-testid="theme-settings">Theme Settings</div>,
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(''),
    set: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders General section', () => {
    render(<SettingsPage />)

    expect(screen.getByText('sections.general')).toBeInTheDocument()
  })

  it('renders language selector with SUPPORTED_LANGUAGES options', () => {
    render(<SettingsPage />)

    const select = screen.getByDisplayValue('English')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
  })

  it('renders theme settings', () => {
    render(<SettingsPage />)

    expect(screen.getByTestId('theme-settings')).toBeInTheDocument()
  })
})
