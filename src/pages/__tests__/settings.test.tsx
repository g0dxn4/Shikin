import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
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
export const mockGetWebServerStatus = vi.fn()
export const mockApplyWebServerSettings = vi.fn()
export const mockGetRuntimeDiagnostics = vi.fn()

const storageMocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
}))

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

vi.mock('@/stores/currency-store', () => {
  const state = {
    mainCurrency: null,
    preferredCurrency: 'USD',
    manualRates: [],
    isLoading: false,
    error: null,
    loadRates: vi.fn().mockResolvedValue(undefined),
    setPreferredCurrency: vi.fn(),
    saveExchangeRate: vi.fn(),
  }
  return {
    useCurrencyStore: (selector?: (value: typeof state) => unknown) =>
      selector ? selector(state) : state,
  }
})

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

vi.mock('@/components/settings/classification-types-settings', () => ({
  ClassificationTypesSettings: () => (
    <div data-testid="classification-types-settings">Classification types</div>
  ),
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

vi.mock('@/lib/web-server', () => ({
  getWebServerStatus: (...args: unknown[]) => mockGetWebServerStatus(...args),
  applyWebServerSettings: (...args: unknown[]) => mockApplyWebServerSettings(...args),
}))

vi.mock('@/lib/runtime-diagnostics', () => ({
  getRuntimeDiagnostics: (...args: unknown[]) => mockGetRuntimeDiagnostics(...args),
}))

vi.mock('@/lib/storage', () => ({
  load: vi.fn().mockResolvedValue({
    get: storageMocks.get,
    set: storageMocks.set,
    save: storageMocks.save,
  }),
}))

function renderSettings(initialEntry = '/settings') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <SettingsPage />
    </MemoryRouter>
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storageMocks.get.mockResolvedValue('')
    storageMocks.set.mockResolvedValue(undefined)
    storageMocks.save.mockResolvedValue(undefined)
    mockGetWebServerStatus.mockResolvedValue({ running: false, port: null, error: null })
    mockApplyWebServerSettings.mockResolvedValue({ running: false, port: null, error: null })
    mockGetRuntimeDiagnostics.mockResolvedValue({
      success: true,
      build: 'desktop',
      version: '1.0.10',
      schemaVersion: 21,
      schemaMigration: '021_backend_remediation_foundation',
      databaseLineageId: 'lineage-from-backup',
      localInstance: { status: 'available', id: 'local-instance-id' },
      dataRevision: 3,
      lastFinancialWriteAt: null,
    })
  })

  it('renders native settings content without a redundant route heading', async () => {
    renderSettings()

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument()
    expect(screen.getByText('settingsDescription')).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'navigation.general' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'navigation.money' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'navigation.data' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'navigation.manageCategories' })).toHaveAttribute(
      'href',
      '/categories'
    )
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('renders language selector with SUPPORTED_LANGUAGES options', async () => {
    renderSettings()

    const select = screen.getByDisplayValue('English')
    expect(select).toBeInTheDocument()
    expect(screen.getByText('Español')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('renders theme settings', async () => {
    renderSettings()

    expect(screen.getByTestId('theme-settings')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it('opens a hash-linked money task and preserves its draft while other sections remain visible', async () => {
    const user = userEvent.setup()
    renderSettings('/settings#manual-rates')

    const disclosure = document.getElementById('manual-rates')
    expect(disclosure).toHaveAttribute('open')
    const rate = screen.getByLabelText('currency.rateDecimal')
    await user.type(rate, '17.25')
    expect(screen.getByTestId('theme-settings')).toBeVisible()
    expect(screen.getByRole('button', { name: 'data.export' })).toBeVisible()
    await user.click(disclosure!.querySelector('summary')!)
    await user.click(disclosure!.querySelector('summary')!)
    expect(screen.getByLabelText('currency.rateDecimal')).toHaveValue('17.25')
  })

  it.each([
    ['classification-types', 'money'],
    ['category-rules', 'money'],
    ['market-data', 'integrations'],
    ['hosted-access', 'integrations'],
    ['data-identity', 'integrations'],
  ])('opens #%s directly without hiding the rest of the page', async (anchor, section) => {
    renderSettings(`/settings?section=${section}#${anchor}`)
    expect(document.getElementById(anchor)).toHaveAttribute('open')
    expect(screen.getByRole('heading', { name: 'navigation.general' })).toBeVisible()
    expect(await screen.findByText('lineage-from-backup')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
  })

  it.each(['general', 'money', 'data', 'integrations'])(
    'keeps all sections mounted for ?section=%s',
    async (section) => {
      renderSettings(`/settings?section=${section}`)
      expect(screen.getByRole('heading', { name: 'navigation.general' })).toBeVisible()
      expect(screen.getByRole('heading', { name: 'navigation.money' })).toBeVisible()
      expect(screen.getByRole('heading', { name: 'navigation.data' })).toBeVisible()
      expect(screen.getByRole('heading', { name: 'navigation.integrations' })).toBeVisible()
      expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    }
  )

  it('scrolls and focuses the canonical query target without hiding other sections', async () => {
    const scroll = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scroll
    try {
      renderSettings('/settings?section=data')
      await waitFor(() => expect(scroll).toHaveBeenCalled())
      expect(document.activeElement).toBe(document.getElementById('settings-data'))
      expect(screen.getByRole('heading', { name: 'navigation.general' })).toBeVisible()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('retains an unsaved provider-key draft when its named disclosure closes', async () => {
    const user = userEvent.setup()
    renderSettings('/settings#market-data')
    const key = screen.getByPlaceholderText('Alpha Vantage API key')
    await user.type(key, 'unsaved-key')
    const disclosure = document.getElementById('market-data')!
    await user.click(disclosure.querySelector('summary')!)
    await user.click(disclosure.querySelector('summary')!)
    expect(screen.getByPlaceholderText('Alpha Vantage API key')).toHaveValue('unsaved-key')
    expect(storageMocks.set).not.toHaveBeenCalledWith('alpha_vantage_key', 'unsaved-key')
  })

  it('renders desktop updates section', async () => {
    renderSettings('/settings?section=data')

    expect(screen.getByText('sections.updates')).toBeInTheDocument()
    expect(await screen.findByText('0.1.0')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'updates.check' })).toBeInTheDocument()
  })

  it('places backups and updates on the page and diagnostics in a named disclosure', async () => {
    const user = userEvent.setup()
    renderSettings()

    expect(screen.getByTestId('theme-settings')).toBeVisible()
    expect(screen.getByRole('button', { name: 'data.export' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'data.import' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'updates.check' })).toBeVisible()
    expect(document.getElementById('data-identity')).not.toHaveAttribute('open')

    await user.click(document.querySelector('#data-identity > summary')!)
    expect(await screen.findByRole('button', { name: 'diagnostics.refresh' })).toBeVisible()
    expect(screen.getByText('lineage-from-backup')).toBeVisible()
    expect(screen.getByText('local-instance-id')).toBeVisible()
    expect(screen.getByText('diagnostics.lastFinancialWriteNever')).toBeVisible()
    expect(mockGetRuntimeDiagnostics).toHaveBeenCalledWith()
  })

  it('persists the close-to-tray desktop setting', async () => {
    const user = userEvent.setup()
    storageMocks.get.mockImplementation(async (key: string) =>
      key === 'close_to_tray_enabled' ? true : ''
    )

    renderSettings('/settings?section=data')

    const toggle = await screen.findByRole('switch', { name: 'desktop.closeToTrayLabel' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await user.click(toggle)

    await waitFor(() => {
      expect(storageMocks.set).toHaveBeenCalledWith('close_to_tray_enabled', false)
    })
    expect(storageMocks.save).toHaveBeenCalledOnce()
    expect(mockToastSuccess).toHaveBeenCalledWith('desktop.closeToTrayDisabled')
  })

  it('shows specific error toast when close-to-tray save fails', async () => {
    const user = userEvent.setup()
    storageMocks.get.mockImplementation(async (key: string) =>
      key === 'close_to_tray_enabled' ? true : ''
    )
    storageMocks.set.mockRejectedValueOnce(new Error('Desktop settings failed'))

    renderSettings('/settings?section=data')

    const toggle = await screen.findByRole('switch', { name: 'desktop.closeToTrayLabel' })
    await user.click(toggle)

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Desktop settings failed')
    })
    expect(mockToastSuccess).not.toHaveBeenCalledWith('desktop.closeToTrayDisabled')
  })

  it('loads persisted hosted web settings', async () => {
    storageMocks.get.mockImplementation(async (key: string) => {
      if (key === 'web_server_enabled') return true
      if (key === 'web_server_port') return 9000
      return ''
    })
    mockGetWebServerStatus.mockResolvedValue({ running: true, port: 9000, error: null })

    renderSettings('/settings?section=integrations#hosted-access')

    const toggle = await screen.findByRole('switch', { name: 'desktop.webServer.label' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('desktop.webServer.port')).toHaveValue(9000)
  })

  it('shows hosted web server status', async () => {
    mockGetWebServerStatus.mockResolvedValue({ running: true, port: 8480, error: null })

    renderSettings('/settings?section=integrations#hosted-access')

    expect(await screen.findAllByText('desktop.webServer.running')).toHaveLength(2)
    expect(screen.getByText('desktop.webServer.statusPort')).toBeInTheDocument()
  })

  it('applies hosted web settings before persisting them', async () => {
    const user = userEvent.setup()
    mockApplyWebServerSettings.mockResolvedValue({ running: true, port: 8480, error: null })

    renderSettings('/settings?section=integrations#hosted-access')

    const toggle = await screen.findByRole('switch', { name: 'desktop.webServer.label' })
    await waitFor(() => expect(toggle).not.toBeDisabled())
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: 'desktop.webServer.apply' }))

    await waitFor(() => {
      expect(mockApplyWebServerSettings).toHaveBeenCalledWith({ enabled: true, port: 8480 })
    })
    expect(storageMocks.set).toHaveBeenCalledWith('web_server_enabled', true)
    expect(storageMocks.set).toHaveBeenCalledWith('web_server_port', 8480)
    expect(storageMocks.save).toHaveBeenCalledOnce()
    expect(mockToastSuccess).toHaveBeenCalledWith('desktop.webServer.applied')
  })

  it('rejects an invalid hosted web port before invoking the desktop command', async () => {
    const user = userEvent.setup()

    renderSettings('/settings?section=integrations#hosted-access')

    const portInput = await screen.findByLabelText('desktop.webServer.port')
    await waitFor(() => expect(portInput).not.toBeDisabled())
    await user.clear(portInput)
    await user.type(portInput, '1023')
    await user.click(screen.getByRole('button', { name: 'desktop.webServer.apply' }))

    expect(mockApplyWebServerSettings).not.toHaveBeenCalled()
    expect(await screen.findByText('desktop.webServer.invalidPort')).toBeInTheDocument()
    expect(mockToastError).toHaveBeenCalledWith('desktop.webServer.invalidPort')
  })

  it('shows hosted web server command failures', async () => {
    const user = userEvent.setup()
    mockApplyWebServerSettings.mockRejectedValueOnce(new Error('Hosted web failed'))

    renderSettings('/settings?section=integrations#hosted-access')

    const applyButton = await screen.findByRole('button', { name: 'desktop.webServer.apply' })
    await waitFor(() => expect(applyButton).not.toBeDisabled())
    await user.click(applyButton)

    expect(await screen.findByText('Hosted web failed')).toBeInTheDocument()
    expect(mockToastError).toHaveBeenCalledWith('Hosted web failed')
  })

  it('checks for updates and installs an available release', async () => {
    const user = userEvent.setup()
    const downloadAndInstall = vi.fn().mockResolvedValue(undefined)
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.0',
      downloadAndInstall,
    })

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

    renderSettings('/settings?section=data')

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

  it('shows specific error toast when data export fails', async () => {
    const user = userEvent.setup()
    mockExportDatabaseSnapshot.mockRejectedValueOnce(new Error('Export failed'))

    renderSettings('/settings?section=data')

    await user.click(screen.getByRole('button', { name: 'data.export' }))

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Export failed')
    })
    expect(mockToastSuccess).not.toHaveBeenCalledWith('data.exportSuccess')
  })

  describe('destructive import confirmation', () => {
    it('cancels import when the required pre-import backup fails', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockRejectedValueOnce(new Error('backup failed'))

      renderSettings('/settings?section=data')

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('backup failed'))
      expect(screen.queryByText('data.importConfirmTitle')).not.toBeInTheDocument()
      expect(mockImportDatabaseSnapshot).not.toHaveBeenCalled()
    })

    it('shows confirmation dialog when import file is selected', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))

      renderSettings('/settings?section=data')

      // Get the hidden file input by its accept attribute
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)

      expect(await screen.findByText('data.importConfirmTitle')).toBeInTheDocument()
      expect(screen.getByText('data.importConfirmDescription')).toBeInTheDocument()
    })

    it('creates pre-import backup before showing confirmation', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))

      renderSettings('/settings?section=data')

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

      renderSettings('/settings?section=data')

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: 'data.importConfirmLabel' }))

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

      renderSettings('/settings?section=data')

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: 'data.importConfirmLabel' }))

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

      renderSettings('/settings?section=data')

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: 'data.importCancelLabel' }))

      expect(mockCreateObjectURL).toHaveBeenCalledOnce()
      expect(mockClick).toHaveBeenCalledOnce()
      expect(mockToastSuccess).toHaveBeenCalledWith('data.preImportBackupDownloaded')

      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    })

    it('shows error toast when import fails', async () => {
      const user = userEvent.setup()
      mockExportDatabaseSnapshot.mockResolvedValue(new Uint8Array([1, 2, 3]))
      mockImportDatabaseSnapshot.mockRejectedValueOnce(new Error('Import failed'))

      renderSettings('/settings?section=data')

      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      const file = new File(['test'], 'backup.db', { type: 'application/octet-stream' })

      await user.upload(fileInput, file)
      await user.click(screen.getByRole('button', { name: 'data.importConfirmLabel' }))

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith('Import failed')
      })
    })
  })
})
