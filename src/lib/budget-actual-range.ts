import dayjs from 'dayjs'

export type BudgetRangePreset = 'this-month' | '3-months' | '6-months' | 'this-year' | 'all-time'

/** Inclusive transaction dates in local calendar time; null means no lower bound. */
export function budgetActualRange(
  preset: BudgetRangePreset,
  today = dayjs()
): {
  start: string | null
  end: string
} {
  const end = today.format('YYYY-MM-DD')
  switch (preset) {
    case 'this-month':
      return { start: today.startOf('month').format('YYYY-MM-DD'), end }
    case '3-months':
      return { start: today.subtract(2, 'month').startOf('month').format('YYYY-MM-DD'), end }
    case '6-months':
      return { start: today.subtract(5, 'month').startOf('month').format('YYYY-MM-DD'), end }
    case 'this-year':
      return { start: today.startOf('year').format('YYYY-MM-DD'), end }
    case 'all-time':
      return { start: null, end }
  }
}
