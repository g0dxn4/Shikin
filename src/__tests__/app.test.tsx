import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import type * as UpdateCardModule from '@/components/update/one-click-update-card'
import type { installUpdate } from '@/lib/updater'

const {
  mockMaterializeTransactions,
  mockRecurringState,
  mockLoadRates,
  mockCurrencyState,
  mockFetchAccounts,
  mockSnapshotBalances,
  mockRefreshNetWorth,
  mockInitPriceScheduler,
  mockStopPriceScheduler,
  mockGetAvailableUpdate,
  mockInstallUpdate,
  mockRelaunchToApplyUpdate,
} = vi.hoisted(() => ({
  mockMaterializeTransactions: vi.fn(),
  mockRecurringState: { refreshWarning: null as string | null },
  mockLoadRates: vi.fn(),
  mockCurrencyState: { mainCurrency: null as string | null },
  mockFetchAccounts: vi.fn(),
  mockSnapshotBalances: vi.fn(),
  mockRefreshNetWorth: vi.fn(),
  mockInitPriceScheduler: vi.fn(),
  mockStopPriceScheduler: vi.fn(),
  mockGetAvailableUpdate: vi.fn(),
  mockInstallUpdate: vi.fn(),
  mockRelaunchToApplyUpdate: vi.fn(),
}))

vi.mock('react-router', () => ({
  BrowserRouter: ({ children }: { children: ReactNode }) => <>{children}</>,
  Navigate: ({ to }: { to: string }) => <div>Navigate to {to}</div>,
  Routes: ({ children }: { children: ReactNode }) => <>{children}</>,
  Route: ({ element }: { element?: ReactNode }) => <>{element ?? null}</>,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/layout/app-shell', () => ({
  AppShell: () => (
    <div data-testid="app-shell" className="min-h-0 flex-1 overflow-hidden">
      App shell
    </div>
  ),
}))

vi.mock('@/components/ui/loading-spinner', () => ({
  LoadingSpinner: () => <div>Loading…</div>,
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: (
    selector: (state: {
      materializeTransactions: typeof mockMaterializeTransactions
      refreshWarning: string | null
    }) => unknown
  ) => selector({ materializeTransactions: mockMaterializeTransactions, ...mockRecurringState }),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: (
    selector: (state: { loadRates: typeof mockLoadRates; mainCurrency: string | null }) => unknown
  ) => selector({ loadRates: mockLoadRates, mainCurrency: mockCurrencyState.mainCurrency }),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: (
    selector: (state: {
      fetch: typeof mockFetchAccounts
      snapshotBalances: typeof mockSnapshotBalances
    }) => unknown
  ) =>
    selector({
      fetch: mockFetchAccounts,
      snapshotBalances: mockSnapshotBalances,
    }),
}))

vi.mock('@/stores/net-worth-store', () => ({
  useNetWorthStore: (selector: (state: { refresh: typeof mockRefreshNetWorth }) => unknown) =>
    selector({ refresh: mockRefreshNetWorth }),
}))

vi.mock('@/lib/price-scheduler', () => ({
  initPriceScheduler: mockInitPriceScheduler,
  stopPriceScheduler: mockStopPriceScheduler,
}))

vi.mock('@/lib/updater', () => ({
  getAvailableUpdate: mockGetAvailableUpdate,
  installUpdate: mockInstallUpdate,
  relaunchToApplyUpdate: mockRelaunchToApplyUpdate,
}))

type UpdateCardProps = Parameters<typeof UpdateCardModule.OneClickUpdateCard>[0]
const { observeUpdateCard } = vi.hoisted(() => ({ observeUpdateCard: vi.fn() }))

vi.mock('@/components/update/one-click-update-card', async (importOriginal) => {
  const actual = await importOriginal<typeof UpdateCardModule>()
  return {
    ...actual,
    OneClickUpdateCard: (props: UpdateCardProps) => {
      observeUpdateCard(props)
      return <actual.OneClickUpdateCard {...props} />
    },
  }
})

import App from '../App'

describe('App startup orchestration', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockMaterializeTransactions.mockResolvedValue(undefined)
    mockRecurringState.refreshWarning = null
    mockLoadRates.mockResolvedValue(undefined)
    mockCurrencyState.mainCurrency = 'USD'
    mockFetchAccounts.mockResolvedValue(undefined)
    mockSnapshotBalances.mockResolvedValue(undefined)
    mockRefreshNetWorth.mockResolvedValue(undefined)
    mockGetAvailableUpdate.mockResolvedValue(null)
    mockInstallUpdate.mockResolvedValue(undefined)
    mockRelaunchToApplyUpdate.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('stays pending until the startup timer runs, then becomes ready after all tasks settle', async () => {
    let resolveRecurring: (() => void) | undefined
    mockMaterializeTransactions.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRecurring = resolve
        })
    )

    const { container } = render(<App />)
    const startupRoot = container.querySelector('[data-startup-state]')
    expect(startupRoot).toHaveAttribute('data-startup-state', 'pending')

    await waitFor(() => {
      expect(startupRoot).toHaveAttribute('data-startup-state', 'running')
    })
    expect(startupRoot).not.toHaveAttribute('data-startup-state', 'ready')

    resolveRecurring?.()
    await waitFor(() => {
      expect(startupRoot).toHaveAttribute('data-startup-state', 'ready')
    })
  })

  it('reports committed recurring entries with a refresh warning, not a startup failure or retry-save prompt', async () => {
    mockMaterializeTransactions.mockResolvedValueOnce(1)
    mockRecurringState.refreshWarning = 'Transaction read unavailable'
    const { container } = render(<App />)

    expect(await screen.findByText('Recurring entries saved')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Your recurring entries were saved, but some views could not be refreshed. Reload the app to refresh them. Transaction read unavailable'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry startup' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-startup-state]')).toHaveAttribute(
      'data-startup-state',
      'ready'
    )
    expect(container.querySelector('[data-recurring-refresh-warning]')).toHaveAttribute(
      'role',
      'status'
    )
    expect(mockSnapshotBalances).toHaveBeenCalledTimes(1)
    expect(mockMaterializeTransactions).toHaveBeenCalledTimes(1)
  })

  it('loads manual FX offline and gives unconfigured users a localized Settings CTA', async () => {
    mockCurrencyState.mainCurrency = null

    render(<App />)

    expect(await screen.findByText('Main currency needs to be configured')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open currency settings' })).toHaveAttribute(
      'href',
      '/settings?section=money#main-currency'
    )
    await waitFor(() => expect(mockLoadRates).toHaveBeenCalledTimes(1))
  })

  it('bounds setup and startup-error banners above the remaining shell viewport', async () => {
    mockCurrencyState.mainCurrency = null
    mockRefreshNetWorth.mockRejectedValueOnce(new Error('Expected unadapted reporter error'))

    const { container } = render(<App />)

    expect(await screen.findByText('Main currency needs to be configured')).toBeInTheDocument()
    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()
    expect(container.querySelector('[data-startup-state]')).toHaveClass(
      'flex',
      'h-full',
      'min-h-0',
      'flex-col',
      'overflow-hidden'
    )
    expect(container.querySelector('[data-currency-setup-banner]')).toHaveClass('shrink-0')
    expect(container.querySelector('[data-startup-error-banner]')).toHaveClass('shrink-0')
    expect(screen.getByTestId('app-shell')).toHaveClass('min-h-0', 'flex-1', 'overflow-hidden')
  })

  it('surfaces startup failures and skips dependent account tasks when accounts fail', async () => {
    mockMaterializeTransactions.mockRejectedValueOnce(new Error('Recurring down'))
    mockLoadRates.mockRejectedValueOnce(new Error('Rates down'))
    mockFetchAccounts.mockRejectedValueOnce(new Error('Accounts down'))

    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()
    expect(
      screen.getByText('Recurring transactions could not be prepared: Recurring down')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Currency settings and manual exchange rates could not be loaded: Rates down'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Accounts could not be loaded: Accounts down')).toBeInTheDocument()
    expect(mockSnapshotBalances).not.toHaveBeenCalled()
    expect(mockRefreshNetWorth).not.toHaveBeenCalled()
    expect(mockInitPriceScheduler).toHaveBeenCalledTimes(1)
    expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[data-startup-state]')).toHaveAttribute(
      'data-startup-state',
      'error'
    )
  })

  it('retries startup tasks and clears the banner after recovery', async () => {
    mockMaterializeTransactions.mockRejectedValueOnce(new Error('Recurring down'))
    mockLoadRates.mockRejectedValueOnce(new Error('Rates down'))
    mockFetchAccounts.mockRejectedValueOnce(new Error('Accounts down'))

    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry startup' }))

    await waitFor(() => {
      expect(mockMaterializeTransactions).toHaveBeenCalledTimes(2)
      expect(mockLoadRates).toHaveBeenCalledTimes(2)
      expect(mockFetchAccounts).toHaveBeenCalledTimes(2)
      expect(mockSnapshotBalances).toHaveBeenCalledTimes(1)
      expect(mockRefreshNetWorth).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    })
    expect(document.querySelector('[data-startup-state]')).toHaveAttribute(
      'data-startup-state',
      'ready'
    )
  })

  it('aggregates dependent startup failures and clears them after retry', async () => {
    mockMaterializeTransactions.mockResolvedValue(undefined)
    mockLoadRates.mockResolvedValue(undefined)
    mockFetchAccounts.mockResolvedValue(undefined)
    mockSnapshotBalances
      .mockRejectedValueOnce(new Error('Snapshot failed'))
      .mockResolvedValueOnce(undefined)
    mockRefreshNetWorth
      .mockRejectedValueOnce(new Error('Net worth failed'))
      .mockResolvedValueOnce(undefined)

    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()
    expect(
      screen.getByText('Balance snapshots could not be updated: Snapshot failed')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Net worth data could not be refreshed: Net worth failed')
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry startup' }))

    await waitFor(() => {
      expect(mockMaterializeTransactions).toHaveBeenCalledTimes(2)
      expect(mockLoadRates).toHaveBeenCalledTimes(2)
      expect(mockFetchAccounts).toHaveBeenCalledTimes(2)
      expect(mockSnapshotBalances).toHaveBeenCalledTimes(2)
      expect(mockRefreshNetWorth).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    })
  })

  it('installs and restarts a startup update from one click', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })

    render(<App />)

    expect(await screen.findByText('Shikin v0.2.7 is ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update & restart' }))

    await waitFor(() => {
      expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
      expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(1)
    })
  })

  it('hides the startup update card when dismissed before installing', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })

    render(<App />)

    expect(await screen.findByText('Shikin v0.2.7 is ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss update prompt' }))

    await waitFor(() => {
      expect(screen.queryByText('Shikin v0.2.7 is ready')).not.toBeInTheDocument()
    })
  })

  it('hides the startup update card with Escape before installing', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })

    render(<App />)

    expect(await screen.findByText('Shikin v0.2.7 is ready')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByText('Shikin v0.2.7 is ready')).not.toBeInTheDocument()
    })
  })

  it('does not dismiss the startup update card when Escape was already handled', async () => {
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })

    render(<App />)

    expect(await screen.findByText('Shikin v0.2.7 is ready')).toBeInTheDocument()

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })
    event.preventDefault()
    window.dispatchEvent(event)

    expect(screen.getByText('Shikin v0.2.7 is ready')).toBeInTheDocument()
  })

  it('retries install from the startup update card after install failure', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })
    mockInstallUpdate
      .mockRejectedValueOnce(new Error('Download failed'))
      .mockResolvedValueOnce(undefined)

    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Update & restart' }))

    expect(await screen.findByText('Download failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update & restart' }))

    await waitFor(() => {
      expect(mockInstallUpdate).toHaveBeenCalledTimes(2)
      expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(1)
    })
  })

  it('retries only restart after startup update relaunch failure', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })
    mockRelaunchToApplyUpdate
      .mockRejectedValueOnce(new Error('Restart failed'))
      .mockResolvedValueOnce(undefined)

    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Update & restart' }))

    expect(await screen.findByText('Restart failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restart now' }))

    await waitFor(() => {
      expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
      expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(2)
    })
  })

  it('keeps an installed startup update ready when startup tasks are retried', async () => {
    const user = userEvent.setup()
    mockMaterializeTransactions
      .mockRejectedValueOnce(new Error('Recurring down'))
      .mockResolvedValue(undefined)
    mockGetAvailableUpdate.mockResolvedValue({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })
    mockRelaunchToApplyUpdate
      .mockRejectedValueOnce(new Error('Restart failed'))
      .mockResolvedValueOnce(undefined)

    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()

    await user.click(await screen.findByRole('button', { name: 'Update & restart' }))

    expect(await screen.findByText('Restart failed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry startup' }))

    await waitFor(() => {
      expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Version 0.2.7 is installed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Restart now' }))

    await waitFor(() => {
      expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
      expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
      expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(2)
    })
  })

  it('pins a startup retry while the original update check is still pending', async () => {
    const user = userEvent.setup()
    mockMaterializeTransactions.mockRejectedValue(new Error('Recurring down'))
    const pending: (() => void)[] = []
    mockGetAvailableUpdate.mockImplementation(
      () => new Promise<null>((resolve) => pending.push(() => resolve(null)))
    )
    render(<App />)
    expect(mockGetAvailableUpdate).not.toHaveBeenCalled()
    await screen.findByRole('button', { name: 'Retry startup' })
    expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Retry startup' }))
    expect(mockMaterializeTransactions).toHaveBeenCalledTimes(2)
    expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
    await act(async () => pending.forEach((resolve) => resolve()))
    mockGetAvailableUpdate.mockReset().mockResolvedValue(null)
    await user.click(screen.getByRole('button', { name: 'Retry startup' }))
    expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
  })

  it('pins an already-started same-version check settling after install and failed restart', async () => {
    const user = userEvent.setup()
    const update = { available: true, version: '0.2.7', downloadAndInstall: vi.fn() }
    let finishCheck!: () => void
    mockMaterializeTransactions.mockRejectedValue(new Error('Recurring down'))
    mockGetAvailableUpdate.mockResolvedValueOnce(update).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishCheck = () => resolve(update)
        })
    )
    mockRelaunchToApplyUpdate.mockRejectedValueOnce(new Error('Restart failed'))
    render(<App />)
    await screen.findByRole('button', { name: 'Update & restart' })
    await user.click(screen.getByRole('button', { name: 'Retry startup' }))
    await user.click(screen.getByRole('button', { name: 'Update & restart' }))
    expect(await screen.findByText('Version 0.2.7 is installed')).toBeInTheDocument()
    await act(async () => finishCheck())
    const card = observeUpdateCard.mock.lastCall![0] as UpdateCardProps
    expect(card.readyToRestart).toBe(true)
    expect(card.phase).toBe('error')
    await act(async () => card.onUpdateAndRestart())
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
    expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(2)
  })

  it('pins a retained action after its version is installed and restart fails', async () => {
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })
    mockRelaunchToApplyUpdate.mockRejectedValueOnce(new Error('Restart failed'))
    render(<App />)
    await screen.findByRole('button', { name: 'Update & restart' })
    const install = (observeUpdateCard.mock.lastCall![0] as UpdateCardProps).onUpdateAndRestart
    await act(async () => install())
    expect(await screen.findByText('Version 0.2.7 is installed')).toBeInTheDocument()
    await act(async () => install())
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
    expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(2)
  })

  it('preserves literal progress tuples, reset, and the immediate duplicate-install guard', async () => {
    const user = userEvent.setup()
    mockGetAvailableUpdate.mockResolvedValueOnce({
      available: true,
      version: '0.2.7',
      downloadAndInstall: vi.fn(),
    })
    let progress!: NonNullable<Parameters<typeof installUpdate>[1]>
    let rejectInstall!: (error: unknown) => void
    mockInstallUpdate.mockImplementationOnce(
      (_update, callback) =>
        new Promise<void>((_resolve, reject) => {
          progress = callback
          rejectInstall = reject
        })
    )
    render(<App />)
    await screen.findByRole('button', { name: 'Update & restart' })
    const card = () => observeUpdateCard.mock.lastCall![0] as UpdateCardProps
    act(() => {
      const install = card().onUpdateAndRestart
      install()
      install()
    })
    expect(mockInstallUpdate).toHaveBeenCalledTimes(1)
    const tuples: [number, number | null][] = []
    const events: Parameters<typeof progress>[0][] = [
      { event: 'Progress', data: { chunkLength: 2 } },
      { event: 'Started', data: { contentLength: 0 } },
      { event: 'Progress', data: { chunkLength: 3 } },
      { event: 'Progress', data: { chunkLength: 4 } },
      { event: 'Finished' },
      { event: 'Started', data: {} },
    ]
    for (const event of events) {
      act(() => progress(event))
      tuples.push([card().downloadedBytes, card().totalBytes])
    }
    expect(tuples).toEqual([
      [2, null],
      [0, 0],
      [3, 0],
      [7, 0],
      [7, 0],
      [0, null],
    ])
    act(() => {
      progress({ event: 'Started', data: { contentLength: 10 } })
      progress({ event: 'Progress', data: { chunkLength: 12 } })
    })
    expect([card().downloadedBytes, card().totalBytes]).toEqual([12, 10])
    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Updating...' })).toBeDisabled()
    await act(async () => rejectInstall({}))
    expect(await screen.findByText('Unknown error')).toBeInTheDocument()

    let finishInstall!: () => void
    mockInstallUpdate.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finishInstall = resolve))
    )
    await user.click(screen.getByRole('button', { name: 'Update & restart' }))
    expect([card().downloadedBytes, card().totalBytes]).toEqual([0, null])
    await act(async () => finishInstall())
    expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(1)
    expect(mockInitPriceScheduler).toHaveBeenCalledTimes(1)
    expect(mockGetAvailableUpdate).toHaveBeenCalledTimes(1)
  })

  it('keeps the pending install lifecycle after unmount and starts fresh on remount', async () => {
    const user = userEvent.setup()
    const update = { available: true, version: '0.2.7', downloadAndInstall: vi.fn() }
    mockGetAvailableUpdate.mockResolvedValue(update)
    let progress!: NonNullable<Parameters<typeof installUpdate>[1]>
    let finishInstall!: () => void
    mockInstallUpdate.mockImplementationOnce(
      (_update, callback) =>
        new Promise<void>((resolve) => {
          progress = callback
          finishInstall = resolve
        })
    )
    const first = render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Update & restart' }))
    first.unmount()
    expect(mockStopPriceScheduler).toHaveBeenCalledTimes(1)
    await act(async () => {
      progress({ event: 'Progress', data: { chunkLength: 5 } })
      finishInstall()
    })
    expect(mockRelaunchToApplyUpdate).toHaveBeenCalledTimes(1)
    render(<App />)
    await screen.findByRole('button', { name: 'Update & restart' })
    const props = observeUpdateCard.mock.lastCall![0] as UpdateCardProps
    expect([props.downloadedBytes, props.totalBytes, props.readyToRestart]).toEqual([
      0,
      null,
      false,
    ])
  })
})
