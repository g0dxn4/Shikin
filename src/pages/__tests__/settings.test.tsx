import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsPage } from '../settings'

const mockChangeLanguage = vi.fn()

// Export these for use in tests
export const mockExportDatabaseSnapshot = vi.fn()
export const mockImportDatabaseSnapshot = vi.fn()
export const mockToastSuccess = vi.fn()
export const mockToastError = vi.fn()
export const mockGetCurrentAppVersion = vi.fn().mockResolvedValue('0.1.0')
export const mockGetAvailableUpdate = vi.fn().mockResolvedValue(null)
export const mockInstallUpdate = vi.fn().mockResolvedValue(undefined)
export const mockRelaunchToApplyUpdate = vi.fn().mockResolvedValue(undefined)

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

vi.mock('@/lib/runtime', () => ({
  isTauri: true,
}))

vi.mock('@/lib/updater', () => ({
  getCurrentAppVersion: (...args: unknown[]) => mockGetCurrentAppVersion(...args),
  getAvailableUpdate: (...args: unknown[]) => mockGetAvailableUpdate(...args),
  installUpdate: (...args: unknown[]) => mockInstallUpdate(...args),
  relaunchToApplyUpdate: (...args: unknown[]) => mockRelaunchToApplyUpdate(...args),
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

  it('renders General section', async () => {
    render(<SettingsPage />)

    expect(screen.getByText('sections.general')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('renders language selector with SUPPORTED_LANGUAGES options', async () => {
    render(<SettingsPage />)

    const select = screen.getByDisplayValue('English')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('renders theme settings', async () => {
    render(<SettingsPage />)

    expect(screen.getByTestId('theme-settings')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('renders desktop updates section', async () => {
    render(<SettingsPage />)

    expect(screen.getByText('sections.updates')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'updates.check' })).toBeInTheDocument()
  })

  it('checks for updates and installs an available release', async () => {
    const user = userEvent.setup()
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall,
    })

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))

    expect(await screen.findByRole('button', { name: 'updates.install' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'updates.install' }))

    await waitFor(() => {
      expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
      expect(mockToastSuccess).toHaveBeenCalledWith('updates.installedToast')
    })

    expect(screen.getByRole('button', { name: 'updates.restart' })).toBeInTheDocument()
  })

  it('keeps restart action available after re-checking updates post-install', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate
      .mockResolvedValueOnce({
        available: true,
        version: '0.2.0',
        downloadAndInstall: vi.fn().mockResolvedValue(undefined),
      })
      .mockResolvedValueOnce(null)

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    await user.click(await screen.findByRole('button', { name: 'updates.install' }))

    expect(await screen.findByRole('button', { name: 'updates.restart' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'updates.check' }))

    expect(await screen.findByRole('button', { name: 'updates.restart' })).toBeInTheDocument()
  })

  it('shows prominent ready state banner after successful install', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    })

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    await user.click(await screen.findByRole('button', { name: 'updates.install' }))

    // Should show the prominent success banner with CheckCircle icon (visible element, not sr-only)
    const readyBanners = await screen.findAllByText('updates.readyTitle')
    // Find the visible one (not the sr-only aria-live region)
    const visibleBanner = readyBanners.find((el) => !el.classList.contains('sr-only'))
    expect(visibleBanner).toBeInTheDocument()
    expect(screen.getByText('updates.readyDescription')).toBeInTheDocument()
  })

  it('shows error banner with retry button when update check fails', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockRejectedValueOnce(new Error('Network error'))

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))

    // Should show error banner with retry button (visible element, not sr-only)
    const errorTitles = await screen.findAllByText('updates.errorTitle')
    const visibleError = errorTitles.find((el) => !el.classList.contains('sr-only'))
    expect(visibleError).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'updates.retry' })).toBeInTheDocument()
  })

  it('retries update check when error banner retry is clicked', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    })

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    const errorTitles = await screen.findAllByText('updates.errorTitle')
    expect(errorTitles.length).toBeGreaterThan(0)

    // Click retry button
    await user.click(screen.getByRole('button', { name: 'updates.retry' }))

    // Should retry and show available update
    expect(await screen.findByRole('button', { name: 'updates.install' })).toBeInTheDocument()
  })

  it('shows progress bar with ARIA attributes during download', async () => {
    const user = userEvent.setup()
    let resolveInstall: (value: unknown) => void = () => {}

    mockInstallUpdate.mockImplementationOnce((_update, callback) => {
      // Simulate download start with content length
      callback({ event: 'Started', data: { contentLength: 1024 * 1024 } })
      // Return a promise that doesn't resolve immediately (keeps isInstallingUpdate true)
      return new Promise((resolve) => {
        resolveInstall = resolve
      })
    })

    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall: vi.fn(),
    })

    render(<SettingsPage />)

    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    await user.click(await screen.findByRole('button', { name: 'updates.install' }))

    // Progress bar should be present with proper ARIA attributes and accessible name
    const progressBar = await screen.findByRole('progressbar')
    expect(progressBar).toBeInTheDocument()
    expect(progressBar).toHaveAttribute('aria-valuemin', '0')
    expect(progressBar).toHaveAttribute('aria-valuemax', '100')
    expect(progressBar).toHaveAttribute('aria-label', 'updates.downloadProgressAria')

    // Verify live region exists and is properly configured
    const liveRegion = document.querySelector('[aria-live="polite"]')
    expect(liveRegion).toBeInTheDocument()
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true')
    // Live region should have content (either available toast or download progress)
    expect(liveRegion?.textContent?.length).toBeGreaterThan(0)

    // Clean up - resolve the install promise
    await act(async () => {
      resolveInstall(undefined)
    })
  })

  it('retries install action when install fails and retry is clicked', async () => {
    const user = userEvent.setup()

    // Mock installUpdate to fail then succeed
    mockInstallUpdate
      .mockRejectedValueOnce(new Error('Download failed'))
      .mockResolvedValueOnce(undefined)

    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall: vi.fn(),
    })

    render(<SettingsPage />)

    // First attempt - check then install
    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    await user.click(await screen.findByRole('button', { name: 'updates.install' }))

    // Wait for error to appear (ErrorBanner shows the actual error message)
    await waitFor(() => {
      expect(screen.getByText('Download failed')).toBeInTheDocument()
    })
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1)

    // Retry install
    await user.click(screen.getByRole('button', { name: 'updates.retry' }))

    // Should retry install
    await waitFor(() => {
      expect(mockInstallUpdate).toHaveBeenCalledTimes(2)
    })
  })

  it('retries restart action when restart fails and retry is clicked', async () => {
    const user = userEvent.setup()

    // Setup: update available, install succeeds, restart fails
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    })
    mockRelaunchToApplyUpdate.mockRejectedValueOnce(new Error('Restart failed'))

    render(<SettingsPage />)

    // Install the update first
    await user.click(screen.getByRole('button', { name: 'updates.check' }))
    await user.click(await screen.findByRole('button', { name: 'updates.install' }))

    // Wait for restart button and click it
    const restartButton = await screen.findByRole('button', { name: 'updates.restart' })
    await user.click(restartButton)

    // Should show error
    expect(await screen.findByText('updates.errorTitle')).toBeInTheDocument()
    expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(1)

    // Setup success for retry
    mockRelaunchToApplyUpdate.mockResolvedValueOnce(undefined)

    // Retry restart
    await user.click(screen.getByRole('button', { name: 'updates.retry' }))

    // Should retry restart
    await waitFor(() => {
      expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(2)
    })
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

      vi.unstubAllGlobals()
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
