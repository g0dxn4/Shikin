import dayjs, { type Dayjs } from 'dayjs'

export type StoredReceivableProgress =
  | { shown: false }
  | { shown: true; percent: number; receivedAmount: number; amount: number }

/**
 * Visual width comes only from stored received_amount / amount.
 * Remaining amount is not an input, so it cannot invent a repayment.
 */
export function storedReceivableProgress(input: {
  status: string
  amount: number
  receivedAmount: number
}): StoredReceivableProgress {
  if (input.status === 'cancelled') return { shown: false }
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) return { shown: false }
  if (!Number.isSafeInteger(input.receivedAmount) || input.receivedAmount < 0) {
    return { shown: false }
  }
  const percent = Math.min(100, Math.round((input.receivedAmount / input.amount) * 100))
  return {
    shown: true,
    percent,
    receivedAmount: input.receivedAmount,
    amount: input.amount,
  }
}

export function receivableDueLabel(
  input: { status: string; dueDate: string },
  now: Dayjs,
  translate: (key: 'card.cancelled' | 'card.overdue' | 'card.dueToday' | 'card.due') => string
): string {
  if (input.status === 'cancelled') return translate('card.cancelled')
  const due = dayjs(input.dueDate)
  const diff = due.diff(now, 'day')
  if (diff < 0) return translate('card.overdue')
  if (diff === 0) return translate('card.dueToday')
  return `${translate('card.due')} ${input.dueDate}`
}
