import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '../settings'

const mockChangeLanguage = vi.fn()

// Export these for use in tests
export const mockExportDatabaseSnapshot = vi.fn()
export const mockImportDatabaseSnapshot = vi.fn()
export const mockToastSuccess = vi.fn()
export const mockToastError = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', changeLanguage: mockChangeLanguage },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: () => ({
    preferredCurrency: 'USD',
    lastFetched: null,
    isLoading: false,
    rates: {},
    loadRates: vi.fn().mockResolvedValue(undefined),
    refreshRates: vi.fn(),
    setPreferredCurrency: vi.fn(),
  }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [],
    fetchError: null,
    fetch: vi.fn().mockResolvedValue(undefined),
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
  exportDatabaseSnapshot: (...args: unknown[]) => mockExportDatabaseSnapshot(...args),
  importDatabaseSnapshot: (...args: unknown[]) => mockImportDatabaseSnapshot(...args),
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

  describe('destructive import confirmation', () => {
    it('opens confirmation even when pre-import backup export fails', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockRejectedValueOnce(new Error('backup failed'))

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)

      expect(await screen.findByText('Destructive Import Confirmation')).toBeInTheDocument()
      expect(mockExportDatabaseSnapshot).toHaveBeenCalledOnce()
    })

    it('shows confirmation dialog when import file is selected', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))

      render(<SettingsPage />)

      // Get the hidden file input by its accept attribute
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)

      expect(await screen.findByText('Destructive Import Confirmation')).toBeInTheDocument()
      expect(
        screen.getByText(/Importing a database will completely replace all current data/)
      ).toBeInTheDocument()
    })

    it('creates pre-import backup before showing confirmation', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)

      expect(mockExportDatabaseSnapshot).toHaveBeenCalledOnce()
    })

    it('proceeds with import when user confirms', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))
      mockImportDatabaseSnapshot.mockResolvedValue(undefined)

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: /Yes, Replace All Data/ }))

      expect(mockImportDatabaseSnapshot).toHaveBeenCalledOnce()
    })

    it('triggers full page reload after successful import', async () => {
      const user = userEvent.setup()
      const reloadMock = vi.fn()
      vi.stubGlobal('location', {
        ...window.location,
        reload: reloadMock,
      })

      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))
      mockImportDatabaseSnapshot.mockResolvedValue(undefined)

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: /Yes, Replace All Data/ }))

      expect(mockImportDatabaseSnapshot).toHaveBeenCalledOnce()
      expect(reloadMock).toHaveBeenCalledTimes(1)

      vi.unstubAllGlobals()
    })

    it('downloads backup when user cancels import', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))

      // Mock URL.createObjectURL and related APIs
      const mockCreateObjectURL = vi.fn(() => 'blob:test')
      const mockRevokeObjectURL = vi.fn()
      vi.stubGlobal('URL', {
        createObjectURL: mockCreateObjectURL,
        revokeObjectURL: mockRevokeObjectURL,
      })

      // Mock document.createElement only for anchor elements
      const mockClick = vi.fn()
      const originalCreateElement = document.createElement
      vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          const anchor = originalCreateElement.call(document, 'a')
          anchor.click = mockClick
          return anchor
        }
        return originalCreateElement.call(document, tagName)
      })

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: /Cancel and Keep Current Data/ }))

      expect(mockCreateObjectURL).toHaveBeenCalledOnce()
      expect(mockClick).toHaveBeenCalledOnce()
      expect(mockToastSuccess).toHaveBeenCalledWith('Pre-import backup downloaded')

      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('shows error toast when import fails', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))
      mockImportDatabaseSnapshot.mockRejectedValue(new Error('Import failed'))

      render(<SettingsPage />)

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: /Yes, Replace All Data/ }))

      expect(mockToastError).toHaveBeenCalledWith('data.importError')
    })
  })
})
