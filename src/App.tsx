import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/error-boundary'
import { AppShell } from '@/components/layout/app-shell'
import { ErrorBanner } from '@/components/ui/error-banner'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { getErrorMessage } from '@/lib/errors'
import { useRecurringStore } from '@/stores/recurring-store'
import { useCurrencyStore } from '@/stores/currency-store'
import { useAccountStore } from '@/stores/account-store'
import { useNetWorthStore } from '@/stores/net-worth-store'
import { initPriceScheduler, stopPriceScheduler } from '@/lib/price-scheduler'
import { checkForUpdates } from '@/lib/updater'
import '@/i18n'
import '@/styles/globals.css'

const Dashboard = lazy(() => import('@/pages/dashboard').then((m) => ({ default: m.Dashboard })))
const Transactions = lazy(() =>
  import('@/pages/transactions').then((m) => ({ default: m.Transactions }))
)
const Accounts = lazy(() => import('@/pages/accounts').then((m) => ({ default: m.Accounts })))
const Budgets = lazy(() => import('@/pages/budgets').then((m) => ({ default: m.Budgets })))
const Investments = lazy(() =>
  import('@/pages/investments').then((m) => ({ default: m.Investments }))
)
const Subscriptions = lazy(() =>
  import('@/pages/subscriptions').then((m) => ({ default: m.Subscriptions }))
)
const Goals = lazy(() => import('@/pages/goals').then((m) => ({ default: m.Goals })))
const DebtPayoff = lazy(() =>
  import('@/pages/debt-payoff').then((m) => ({ default: m.DebtPayoff }))
)
const Forecast = lazy(() => import('@/pages/forecast').then((m) => ({ default: m.Forecast })))
const Memories = lazy(() => import('@/pages/memories').then((m) => ({ default: m.Memories })))
const NetWorth = lazy(() => import('@/pages/net-worth').then((m) => ({ default: m.NetWorth })))
const SpendingHeatmap = lazy(() =>
  import('@/pages/spending-heatmap').then((m) => ({ default: m.SpendingHeatmap }))
)
const SpendingInsights = lazy(() =>
  import('@/pages/spending-insights').then((m) => ({ default: m.SpendingInsights }))
)
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage }))
)
const BillsPage = lazy(() => import('@/pages/bills').then((m) => ({ default: m.BillsPage })))
const ReportsPage = lazy(() => import('@/pages/reports').then((m) => ({ default: m.ReportsPage })))
const ExtensionsPage = lazy(() =>
  import('@/pages/extensions').then((m) => ({ default: m.ExtensionsPage }))
)

export default function App() {
  const [startupErrors, setStartupErrors] = useState<Record<string, string>>({})
  const [startupInProgress, setStartupInProgress] = useState(false)
  const startupInFlightRef = useRef(false)
  const materializeTransactions = useRecurringStore((s) => s.materializeTransactions)
  const autoRefreshRates = useCurrencyStore((s) => s.autoRefreshIfStale)
  const fetchAccounts = useAccountStore((s) => s.fetch)
  const snapshotBalances = useAccountStore((s) => s.snapshotBalances)
  const refreshNetWorth = useNetWorthStore((s) => s.refresh)

  const clearStartupError = useCallback((key: string) => {
    setStartupErrors((current) => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  const reportStartupError = useCallback((key: string, label: string, error: unknown) => {
    const message = `${label}: ${getErrorMessage(error)}`
    console.warn(`[startup] ${label}`, error)
    setStartupErrors((current) => {
      if (current[key] === message) return current
      return { ...current, [key]: message }
    })
  }, [])

  const runStartupTasks = useCallback(() => {
    if (startupInFlightRef.current) return
    startupInFlightRef.current = true
    setStartupInProgress(true)

    const recurringTask = materializeTransactions()
      .then(() => clearStartupError('recurring'))
      .catch((error) =>
        reportStartupError('recurring', 'Recurring transactions could not be prepared', error)
      )

    const rateTask = autoRefreshRates()
      .then(() => clearStartupError('rates'))
      .catch((error) => reportStartupError('rates', 'Exchange rates could not be refreshed', error))

    const accountTask = recurringTask
      .then(() => fetchAccounts())
      .then(() => {
        clearStartupError('accounts')

        return Promise.allSettled([
          snapshotBalances()
            .then(() => clearStartupError('snapshots'))
            .catch((error) =>
              reportStartupError('snapshots', 'Balance snapshots could not be updated', error)
            ),
          refreshNetWorth()
            .then(() => clearStartupError('netWorth'))
            .catch((error) =>
              reportStartupError('netWorth', 'Net worth data could not be refreshed', error)
            ),
        ])
      })
      .catch((error) => reportStartupError('accounts', 'Accounts could not be loaded', error))

    void Promise.allSettled([recurringTask, rateTask, accountTask]).finally(() => {
      startupInFlightRef.current = false
      setStartupInProgress(false)
    })

    checkForUpdates()
  }, [
    autoRefreshRates,
    clearStartupError,
    fetchAccounts,
    materializeTransactions,
    refreshNetWorth,
    reportStartupError,
    snapshotBalances,
  ])

  useEffect(() => {
    initPriceScheduler()
    const startupTimer = window.setTimeout(() => {
      void runStartupTasks()
    }, 0)

    return () => {
      window.clearTimeout(startupTimer)
      stopPriceScheduler()
    }
  }, [runStartupTasks])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <div className="relative min-h-screen">
          <div className="pointer-events-none fixed inset-x-0 top-4 z-50 px-4">
            <div className="pointer-events-auto mx-auto max-w-3xl">
              <ErrorBanner
                title="Startup tasks need attention"
                messages={Object.values(startupErrors)}
                retryLabel={startupInProgress ? 'Retrying...' : 'Retry startup'}
                onRetry={startupInProgress ? undefined : runStartupTasks}
              />
            </div>
          </div>

          <Suspense fallback={<LoadingSpinner />}>
            <Routes>
              <Route element={<AppShell />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/budgets" element={<Budgets />} />
                <Route path="/goals" element={<Goals />} />
                <Route path="/investments" element={<Investments />} />
                <Route path="/subscriptions" element={<Subscriptions />} />
                <Route path="/debt-payoff" element={<DebtPayoff />} />
                <Route path="/forecast" element={<Forecast />} />
                <Route path="/net-worth" element={<NetWorth />} />
                <Route path="/spending-insights" element={<SpendingInsights />} />
                <Route path="/spending-heatmap" element={<SpendingHeatmap />} />
                <Route path="/memories" element={<Memories />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="/bills" element={<BillsPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/extensions" element={<ExtensionsPage />} />
              </Route>
            </Routes>
          </Suspense>
        </div>
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#18181B',
            border: '1px solid #FFFFFF12',
            color: '#FAFAFA',
          },
        }}
      />
    </ErrorBoundary>
  )
}
