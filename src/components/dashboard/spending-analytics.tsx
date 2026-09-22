import { useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import type { ConversionState, DashboardAnalyticsResult } from '@/lib/dashboard-analytics'
import { SpendingPacePanel } from './spending-pace-panel'
import { SpendingTrendPanel } from './spending-trend-panel'
import { SpendingCategoriesPanel } from './spending-categories-panel'

type SpendingMode = 'pace' | 'trend' | 'categories'

const STORAGE_KEY = 'shikin_dashboard_spending_mode'
const MODES: SpendingMode[] = ['pace', 'trend', 'categories']

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
  dataError?: string | null
  categoriesError?: string | null
}

export function SpendingAnalytics({
  analytics,
  isLoading,
  dataError = null,
  categoriesError = null,
}: SpendingAnalyticsProps) {
  const { t } = useTranslation('dashboard')
  const [mode, setMode] = useState<SpendingMode>(() => readStoredMode() ?? 'pace')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])

  const handleSetMode = (next: SpendingMode) => {
    setMode(next)
    writeStoredMode(next)
  }

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % MODES.length
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + MODES.length) % MODES.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = MODES.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    handleSetMode(MODES[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  const conversion = analytics
    ? mode === 'pace'
      ? analytics.pace.conversion
      : mode === 'trend'
        ? analytics.trend.conversion
        : analytics.categories.conversion
    : null
  const displayCurrency = conversion?.currency ?? ''
  const categoriesUnavailable = mode === 'categories' && categoriesError
  const conversionNotice = conversion ? getLocalizedConversionNotice(conversion, t) : null

  return (
    <section aria-labelledby="spending-analytics-heading">
      <div className="border-border mb-3 grid gap-3 border-b pb-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 lg:block">
            <h2 id="spending-analytics-heading" className="text-base font-semibold">
              {t('analytics.spendingPace')}
            </h2>
            <Link
              to="/transactions"
              className="text-accent hover:text-accent/80 focus-visible:ring-ring shrink-0 rounded-sm text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none lg:hidden"
            >
              {t('charts.drilldownTransactions')}
            </Link>
          </div>
          <p className="text-muted-foreground mt-1 max-w-2xl text-[11px] leading-relaxed">
            {analytics?.preferredCurrency
              ? t('analytics.datedManualFx', { currency: analytics.preferredCurrency })
              : t('analytics.datedManualFxUnconfigured')}
          </p>
        </div>

        <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
          <Link
            to="/transactions"
            className="text-accent hover:text-accent/80 focus-visible:ring-ring hidden shrink-0 rounded-sm text-xs font-semibold underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:outline-none lg:block"
          >
            {t('charts.drilldownTransactions')}
          </Link>
          <div
            className="border-border bg-muted grid min-w-0 grid-cols-3 rounded-lg border p-0.5"
            role="tablist"
            aria-label={t('analytics.spendingModes')}
          >
            {MODES.map((tabMode, index) => (
              <button
                key={tabMode}
                ref={(element) => {
                  tabRefs.current[index] = element
                }}
                id={`spending-${tabMode}-tab`}
                type="button"
                role="tab"
                aria-selected={mode === tabMode}
                aria-controls={`spending-${tabMode}-panel`}
                tabIndex={mode === tabMode ? 0 : -1}
                disabled={isLoading || !analytics}
                onClick={() => handleSetMode(tabMode)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={cn(
                  'min-h-10 min-w-0 rounded-md px-2.5 py-2 text-[11px] font-semibold transition-colors sm:min-h-8 sm:py-1',
                  mode === tabMode
                    ? 'bg-surface text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                  (isLoading || !analytics) && 'cursor-not-allowed opacity-60'
                )}
              >
                <span className="block [overflow-wrap:anywhere]">{t(`analytics.${tabMode}`)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div
        id={`spending-${mode}-panel`}
        role="tabpanel"
        aria-labelledby={`spending-${mode}-tab`}
        className="min-w-0"
      >
        {isLoading || !analytics ? (
          <div className="bg-muted h-60 animate-pulse rounded-xl" role="status">
            <span className="sr-only">{t('analytics.loading')}</span>
          </div>
        ) : dataError ? (
          <PanelMessage role="alert">
            {t('analytics.sourceUnavailable')}: {dataError}
          </PanelMessage>
        ) : categoriesUnavailable ? (
          <PanelMessage role="alert">
            {t('analytics.categoriesUnavailable')}: {categoriesError}
          </PanelMessage>
        ) : conversion?.kind !== 'complete' ? (
          <PanelMessage role="alert">
            {conversionNotice ?? t('analytics.noEligibleData')}
          </PanelMessage>
        ) : mode === 'pace' ? (
          <SpendingPacePanel
            pace={analytics.pace}
            displayCurrency={displayCurrency}
            notice={null}
          />
        ) : mode === 'trend' ? (
          <SpendingTrendPanel
            trend={analytics.trend}
            displayCurrency={displayCurrency}
            notice={null}
          />
        ) : (
          <SpendingCategoriesPanel
            categories={analytics.categories}
            displayCurrency={displayCurrency}
            notice={null}
          />
        )}
      </div>
    </section>
  )
}

function PanelMessage({ children, role }: { children: React.ReactNode; role: 'alert' | 'status' }) {
  return (
    <div
      className="border-warning/30 bg-warning/10 text-warning flex min-h-44 items-center justify-center rounded-xl border p-4 text-center text-sm"
      role={role}
    >
      <p className="max-w-lg">{children}</p>
    </div>
  )
}

function getLocalizedConversionNotice(
  conversion: ConversionState,
  t: TFunction<'dashboard'>
): string | null {
  if (conversion.kind === 'complete') return null
  if (conversion.kind === 'fallback') {
    return t('analytics.fallbackCurrency', {
      currency: conversion.currency,
      target: conversion.missingTarget,
    })
  }
  if (conversion.reason === 'main_currency_unconfigured') return t('currency.mainRequired')
  if (conversion.reason === 'invalid_currency_data') return t('currency.invalidEvidence')
  if (conversion.reason === 'invalid_category_allocations') {
    return t('analytics.invalidCategoryAllocations')
  }
  if (conversion.missingCurrencies.length > 0) {
    return t('currency.missingDatedRates', {
      currencies: conversion.missingCurrencies.join(', '),
    })
  }
  return t('currency.derivedUnavailable')
}
