import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router'
import type { DashboardAnalyticsResult } from '@/lib/dashboard-analytics'
import { formatDashboardNotice } from '@/lib/dashboard-analytics'
import { SpendingPacePanel } from './spending-pace-panel'
import { SpendingTrendPanel } from './spending-trend-panel'
import { SpendingCategoriesPanel } from './spending-categories-panel'

type SpendingMode = 'pace' | 'trend' | 'categories'

const STORAGE_KEY = 'shikin_dashboard_spending_mode'

function readStoredMode(): SpendingMode | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === 'pace' || raw === 'trend' || raw === 'categories') return raw
  } catch {
    // Guarded access: ignore storage failures.
  }
  return null
}

function writeStoredMode(mode: SpendingMode): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Guarded access: ignore storage failures.
  }
}

interface SpendingAnalyticsProps {
  analytics: DashboardAnalyticsResult | null
  isLoading: boolean
  categoriesError?: string | null
}

export function SpendingAnalytics({
  analytics,
  isLoading,
  categoriesError = null,
}: SpendingAnalyticsProps) {
  const { t } = useTranslation('dashboard')
  const [mode, setMode] = useState<SpendingMode>(() => readStoredMode() ?? 'pace')

  const handleSetMode = (next: SpendingMode) => {
    setMode(next)
    writeStoredMode(next)
  }

  const tabs: Array<[SpendingMode, string]> = [
    ['pace', t('analytics.pace')],
    ['trend', t('analytics.trend')],
    ['categories', t('analytics.categories')],
  ]

  if (isLoading || !analytics) {
    return (
      <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.035] p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase">
            {t('analytics.spendingPace')}
          </p>
          <div className="flex rounded-full border border-white/[0.08] bg-black/20 p-1">
            {tabs.map(([tabMode]) => (
              <button
                key={tabMode}
                type="button"
                disabled
                className="text-muted-foreground rounded-full px-2.5 py-1 font-mono text-[10px] font-bold"
              >
                {tabs.find(([m]) => m === tabMode)?.[1]}
              </button>
            ))}
          </div>
        </div>
        <div className="bg-muted/30 h-64 animate-pulse rounded-2xl" />
      </div>
    )
  }

  const conversion =
    mode === 'pace'
      ? analytics.pace.conversion
      : mode === 'trend'
        ? analytics.trend.conversion
        : analytics.categories.conversion
  const conversionNotice = formatDashboardNotice(conversion)
  const displayCurrency = conversion.currency
  const hasEligibleData =
    mode === 'pace'
      ? analytics.pace.points.some(
          (point) =>
            (point.current ?? 0) > 0 || (point.previous ?? 0) > 0 || (point.priorAverage ?? 0) > 0
        )
      : mode === 'trend'
        ? analytics.trend.totalExpenses > 0 || analytics.trend.totalIncome > 0
        : analytics.categories.months.some((month) =>
            Object.values(month.byCategoryId).some((amount) => amount > 0)
          )
  const categoriesUnavailable = mode === 'categories' && categoriesError

  return (
    <div className="rounded-[22px] border border-white/[0.06] bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs font-bold tracking-[0.14em] uppercase">
          {t('analytics.spendingPace')}
        </p>
        <div
          className="flex rounded-full border border-white/[0.08] bg-black/20 p-1"
          role="tablist"
          aria-label={t('analytics.spendingModes')}
        >
          {tabs.map(([tabMode, label]) => (
            <button
              key={tabMode}
              type="button"
              role="tab"
              aria-selected={mode === tabMode}
              onClick={() => handleSetMode(tabMode)}
              className={cn(
                'rounded-full px-2.5 py-1 font-mono text-[10px] font-bold transition-colors',
                mode === tabMode
                  ? 'bg-accent-hover text-white'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {categoriesUnavailable && (
        <div
          className="border-warning/30 bg-warning/8 text-warning rounded-2xl border p-4 text-center text-sm"
          role="alert"
        >
          {t('analytics.categoriesUnavailable')}: {categoriesError}
        </div>
      )}

      {!categoriesUnavailable && conversion.kind === 'incomplete' && !hasEligibleData && (
        <div
          className="border-warning/30 bg-warning/8 text-warning rounded-2xl border p-4 text-center text-sm"
          role="status"
        >
          {conversionNotice ?? t('analytics.noEligibleData')}
        </div>
      )}

      {!categoriesUnavailable && conversion.kind === 'incomplete' && hasEligibleData && (
        <div
          className="border-warning/30 bg-warning/8 text-warning rounded-2xl border p-4 text-center text-sm"
          role="alert"
        >
          {conversionNotice}
        </div>
      )}

      {!categoriesUnavailable &&
        (conversion.kind === 'complete' || conversion.kind === 'fallback') && (
          <div role="tabpanel">
            {mode === 'pace' && (
              <SpendingPacePanel
                pace={analytics.pace}
                displayCurrency={displayCurrency}
                notice={conversionNotice}
              />
            )}
            {mode === 'trend' && (
              <SpendingTrendPanel
                trend={analytics.trend}
                displayCurrency={displayCurrency}
                notice={conversionNotice}
              />
            )}
            {mode === 'categories' && (
              <SpendingCategoriesPanel
                categories={analytics.categories}
                displayCurrency={displayCurrency}
                notice={conversionNotice}
              />
            )}
          </div>
        )}

      <div className="mt-5 flex justify-end">
        <Button variant="outline" size="sm" asChild>
          <Link to="/budgets">{t('analytics.viewBudgets')}</Link>
        </Button>
      </div>
    </div>
  )
}
