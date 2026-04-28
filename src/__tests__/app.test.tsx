import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'

const {
  mockMaterializeTransactions,
  mockAutoRefreshRates,
  mockFetchAccounts,
  mockSnapshotBalances,
  mockRefreshNetWorth,
  mockInitPriceScheduler,
  mockStopPriceScheduler,
  mockCheckForUpdates,
} = vi.hoisted(() => ({
  mockMaterializeTransactions: vi.fn(),
  mockAutoRefreshRates: vi.fn(),
  mockFetchAccounts: vi.fn(),
  mockSnapshotBalances: vi.fn(),
  mockRefreshNetWorth: vi.fn(),
  mockInitPriceScheduler: vi.fn(),
  mockStopPriceScheduler: vi.fn(),
  mockCheckForUpdates: vi.fn(),
}))

vi.mock('react-router', () => ({
  BrowserRouter: ({ children }: { children: ReactNode }) => <>{children}</>,
  Navigate: ({ to }: { to: string }) => <div>Navigate to {to}</div>,
  Routes: ({ children }: { children: ReactNode }) => <>{children}</>,
  Route: ({ element }: { element?: ReactNode }) => <>{element ?? null}</>,
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
}))

vi.mock('@/components/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock('@/components/layout/app-shell', () => ({
  AppShell: () => <div>App shell</div>,
}))

vi.mock('@/components/ui/loading-spinner', () => ({
  LoadingSpinner: () => <div>Loading…</div>,
}))

vi.mock('@/stores/recurring-store', () => ({
  useRecurringStore: (
    selector: (state: { materializeTransactions: typeof mockMaterializeTransactions }) => unknown
  ) => selector({ materializeTransactions: mockMaterializeTransactions }),
}))

vi.mock('@/stores/currency-store', () => ({
  useCurrencyStore: (
    selector: (state: { autoRefreshIfStale: typeof mockAutoRefreshRates }) => unknown
  ) => selector({ autoRefreshIfStale: mockAutoRefreshRates }),
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
  checkForUpdates: mockCheckForUpdates,
}))

import App from '../App'

describe('App startup orchestration', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    mockMaterializeTransactions.mockResolvedValue(undefined)
    mockAutoRefreshRates.mockResolvedValue(undefined)
    mockFetchAccounts.mockResolvedValue(undefined)
    mockSnapshotBalances.mockResolvedValue(undefined)
    mockRefreshNetWorth.mockResolvedValue(undefined)
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  it('surfaces startup failures and skips dependent account tasks when accounts fail', async () => {
    mockMaterializeTransactions.mockRejectedValueOnce(new Error('Recurring down'))
    mockAutoRefreshRates.mockRejectedValueOnce(new Error('Rates down'))
    mockFetchAccounts.mockRejectedValueOnce(new Error('Accounts down'))

    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()
    expect(
      screen.getByText('Recurring transactions could not be prepared: Recurring down')
    ).toBeInTheDocument()
    expect(
      screen.getByText('Exchange rates could not be refreshed: Rates down')
    ).toBeInTheDocument()
    expect(screen.getByText('Accounts could not be loaded: Accounts down')).toBeInTheDocument()
    expect(mockSnapshotBalances).not.toHaveBeenCalled()
    expect(mockRefreshNetWorth).not.toHaveBeenCalled()
    expect(mockInitPriceScheduler).toHaveBeenCalledTimes(1)
    expect(mockCheckForUpdates).toHaveBeenCalledTimes(1)
  })

  it('retries startup tasks and clears the banner after recovery', async () => {
    mockMaterializeTransactions.mockRejectedValueOnce(new Error('Recurring down'))
    mockAutoRefreshRates.mockRejectedValueOnce(new Error('Rates down'))
    mockFetchAccounts.mockRejectedValueOnce(new Error('Accounts down'))

    const user = userEvent.setup()
    render(<App />)

    expect(await screen.findByText('Startup tasks need attention')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry startup' }))

    await waitFor(() => {
      expect(mockMaterializeTransactions).toHaveBeenCalledTimes(2)
      expect(mockAutoRefreshRates).toHaveBeenCalledTimes(2)
      expect(mockFetchAccounts).toHaveBeenCalledTimes(2)
      expect(mockSnapshotBalances).toHaveBeenCalledTimes(1)
      expect(mockRefreshNetWorth).toHaveBeenCalledTimes(1)
    })

    await waitFor(() => {
      expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    })
  })

  it('aggregates dependent startup failures and clears them after retry', async () => {
    mockMaterializeTransactions.mockResolvedValue(undefined)
    mockAutoRefreshRates.mockResolvedValue(undefined)
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
      expect(mockAutoRefreshRates).toHaveBeenCalledTimes(2)
      expect(mockFetchAccounts).toHaveBeenCalledTimes(2)
      expect(mockSnapshotBalances).toHaveBeenCalledTimes(2)
      expect(mockRefreshNetWorth).toHaveBeenCalledTimes(2)
    })

    await waitFor(() => {
      expect(screen.queryByText('Startup tasks need attention')).not.toBeInTheDocument()
    })
  })
})
