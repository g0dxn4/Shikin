import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/error-boundary'
import { AppShell } from '@/components/layout/app-shell'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
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
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((m) => ({ default: m.SettingsPage }))
)

export default function App() {
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
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
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
