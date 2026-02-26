import { Suspense } from 'react'
import { Outlet } from 'react-router'
import { Sidebar } from './sidebar'
import { AIPanel } from './ai-panel'
import { LoadingSpinner } from '@/components/ui/loading-spinner'

export function AppShell() {
  return (
    <div className="bg-background flex h-screen overflow-hidden">
      <Sidebar />
      <main className="grid-bg flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-6">
          <Suspense fallback={<LoadingSpinner className="h-full" />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <AIPanel />
    </div>
  )
}
