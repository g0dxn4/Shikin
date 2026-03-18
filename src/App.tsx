import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/error-boundary'
import { AppShell } from '@/components/layout/app-shell'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { useAIStore } from '@/stores/ai-store'
import { useRecurringStore } from '@/stores/recurring-store'
import { initPriceScheduler, stopPriceScheduler } from '@/lib/price-scheduler'
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
const Notebook = lazy(() => import('@/pages/notebook').then((m) => ({ default: m.Notebook })))
const Forecast = lazy(() => import('@/pages/forecast').then((m) => ({ default: m.Forecast })))
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage }))
)
const OAuthCallback = lazy(() =>
  import('@/pages/oauth-callback').then((m) => ({ default: m.OAuthCallback }))
)

export default function App() {
  const loadSettings = useAIStore((s) => s.loadSettings)
  const materializeTransactions = useRecurringStore((s) => s.materializeTransactions)

  useEffect(() => {
    loadSettings()
    initPriceScheduler()
    // Auto-materialize due recurring transactions on startup
    materializeTransactions().catch((err) =>
      console.warn('[Recurring] Failed to materialize transactions:', err)
    )
    return () => stopPriceScheduler()
  }, [loadSettings, materializeTransactions])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<LoadingSpinner />}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/transactions" element={<Transactions />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/investments" element={<Investments />} />
              <Route path="/subscriptions" element={<Subscriptions />} />
              <Route path="/notebook" element={<Notebook />} />
              <Route path="/forecast" element={<Forecast />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="/oauth/callback" element={<OAuthCallback />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#0a0a0a',
            border: '1px solid rgba(255, 255, 255, 0.06)',
            color: '#f0f0f0',
          },
        }}
      />
    </ErrorBoundary>
  )
}
