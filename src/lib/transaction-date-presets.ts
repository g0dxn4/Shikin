import dayjs from 'dayjs'

export type TransactionDatePreset =
  | 'all'
  | 'this-month'
  | 'three-months'
  | 'six-months'
  | 'this-year'
  | 'month'
  | '30-days'
  | '90-days'
  | 'custom'

export function transactionDateBounds(
  preset: TransactionDatePreset,
  today = dayjs()
): { dateFrom: string; dateTo: string } {
  const dateTo = today.format('YYYY-MM-DD')
  switch (preset) {
    case 'this-month':
      return { dateFrom: today.startOf('month').format('YYYY-MM-DD'), dateTo }
    case 'three-months':
      return { dateFrom: today.subtract(2, 'month').startOf('month').format('YYYY-MM-DD'), dateTo }
    case 'six-months':
      return { dateFrom: today.subtract(5, 'month').startOf('month').format('YYYY-MM-DD'), dateTo }
    case 'this-year':
      return { dateFrom: today.startOf('year').format('YYYY-MM-DD'), dateTo }
    case 'month':
      return {
        dateFrom: today.startOf('month').format('YYYY-MM-DD'),
        dateTo: today.endOf('month').format('YYYY-MM-DD'),
      }
    case '30-days':
      return { dateFrom: today.subtract(29, 'day').format('YYYY-MM-DD'), dateTo }
    case '90-days':
      return { dateFrom: today.subtract(89, 'day').format('YYYY-MM-DD'), dateTo }
    default:
      return { dateFrom: '', dateTo: '' }
  }
}

export function getTransactionDatePreset(
  dateFrom: string,
  dateTo: string,
  today = dayjs()
): TransactionDatePreset {
  if (!dateFrom && !dateTo) return 'all'
  // Keep legacy ranges first where an old link overlaps a newly requested range.
  for (const preset of [
    'month',
    '30-days',
    '90-days',
    'this-month',
    'three-months',
    'six-months',
    'this-year',
  ] as const) {
    const bounds = transactionDateBounds(preset, today)
    if (bounds.dateFrom === dateFrom && bounds.dateTo === dateTo) return preset
  }
  return 'custom'
}
