import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { receivableDueLabel, storedReceivableProgress } from '../receivable-presentation'

const t = (key: 'card.cancelled' | 'card.overdue' | 'card.dueToday' | 'card.due') => key

describe('storedReceivableProgress', () => {
  it('uses only stored received and amount, and does not infer a repayment', () => {
    expect(
      storedReceivableProgress({ status: 'partial', amount: 500000, receivedAmount: 200000 })
    ).toEqual({ shown: true, percent: 40, receivedAmount: 200000, amount: 500000 })
    expect(storedReceivableProgress({ status: 'open', amount: 10000, receivedAmount: 0 })).toEqual({
      shown: true,
      percent: 0,
      receivedAmount: 0,
      amount: 10000,
    })
    expect(
      storedReceivableProgress({ status: 'received', amount: 100, receivedAmount: 250 })
    ).toMatchObject({ shown: true, percent: 100, receivedAmount: 250, amount: 100 })
  })

  it('hides the bar for cancelled or unusable stored figures', () => {
    expect(
      storedReceivableProgress({ status: 'cancelled', amount: 500000, receivedAmount: 200000 })
    ).toEqual({ shown: false })
    expect(storedReceivableProgress({ status: 'open', amount: 0, receivedAmount: 0 })).toEqual({
      shown: false,
    })
    expect(storedReceivableProgress({ status: 'open', amount: 100, receivedAmount: -1 })).toEqual({
      shown: false,
    })
  })
})

describe('receivableDueLabel', () => {
  const now = dayjs('2026-06-15T12:00:00')

  it('keeps cancelled, overdue, and scheduled labels without inventing a date', () => {
    expect(receivableDueLabel({ status: 'cancelled', dueDate: '2026-01-01' }, now, t)).toBe(
      'card.cancelled'
    )
    expect(receivableDueLabel({ status: 'open', dueDate: '2026-06-14' }, now, t)).toBe(
      'card.overdue'
    )
    expect(receivableDueLabel({ status: 'open', dueDate: '2026-06-15' }, now, t)).toBe(
      'card.dueToday'
    )
    expect(receivableDueLabel({ status: 'partial', dueDate: '2026-12-31' }, now, t)).toBe(
      'card.due 2026-12-31'
    )
  })
})
