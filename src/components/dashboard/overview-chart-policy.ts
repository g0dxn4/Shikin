/**
 * Date-label budget for overview plots.
 * A 320px card is under 330px wide; 375px is still under the desktop breakpoint.
 * Non-positive widths wait for measurement and use the desktop budget.
 */
export function overviewDateTickBudget(width: number): 2 | 3 | 5 {
  if (!Number.isFinite(width) || width <= 0) return 5
  if (width < 330) return 2
  if (width < 768) return 3
  return 5
}

export function overviewChartLocale(language: string | undefined): string {
  const value = language?.trim()
  return value && value.length > 0 ? value : 'en'
}
