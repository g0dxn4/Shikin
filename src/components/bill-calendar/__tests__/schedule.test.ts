import { describe, expect, it } from 'vitest'
import { buildBillSchedule } from '../schedule'
import type { RecurringRuleWithDetails } from '@/stores/recurring-store'
import type { Transaction } from '@/types/database'
const rule = {
  id: 'rent',
  description: 'Rent',
  type: 'expense',
  active: 1,
  amount: 10000,
  currency: 'EUR',
  frequency: 'monthly',
  next_date: '2028-01-31',
  anchor_kind: 'fixed_day',
  anchor_day: 31,
} as RecurringRuleWithDetails

describe('read-only monthly bill schedule', () => {
  it('preserves fixed-day anchors across leap February and March', () => {
    expect(buildBillSchedule([rule], [], '2028-02').bills[0]).toMatchObject({
      date: '2028-02-29',
      currency: 'EUR',
      paid: false,
    })
    expect(buildBillSchedule([rule], [], '2028-03').bills[0].date).toBe('2028-03-31')
  })
  it('preserves year boundaries and end-of-month anchors', () => {
    expect(
      buildBillSchedule(
        [{ ...rule, next_date: '2027-12-31', anchor_kind: 'end_of_month' }],
        [],
        '2028-01'
      ).bills[0].date
    ).toBe('2028-01-31')
  })
  it('honors end dates, inactive rules, and transfer eligibility', () => {
    expect(
      buildBillSchedule(
        [
          { ...rule, end_date: '2028-02-01' },
          { ...rule, id: 'inactive', active: 0 },
          { ...rule, id: 'transfer', type: 'transfer' },
        ],
        [],
        '2028-03'
      ).bills
    ).toEqual([])
  })
  it('does not invent an anchor for ambiguous legacy month-end rules', () => {
    const result = buildBillSchedule(
      [{ ...rule, anchor_kind: null, anchor_day: null }],
      [],
      '2028-02'
    )
    expect(result).toEqual({ bills: [], unresolved: true })
  })
  it('uses actual posted payments rather than treating overdue bills as paid', () => {
    const payment = {
      id: 'posted',
      recurring_rule_id: 'rent',
      date: '2028-02-29',
      type: 'expense',
      status: ' ',
      amount: 12345,
      currency: 'EUR',
      description: 'Actual rent',
    } as unknown as Transaction
    const result = buildBillSchedule([rule], [payment], '2028-02')
    expect(result.bills).toHaveLength(1)
    expect(result.bills[0]).toMatchObject({ amount: 12345, paid: true })
    expect(
      buildBillSchedule([rule], [{ ...payment, status: 'pending' }], '2028-02').bills[0].paid
    ).toBe(false)
    expect(
      buildBillSchedule(
        [rule],
        [{ ...payment, reporting_treatment: 'exclude_from_cashflow' }],
        '2028-02'
      ).bills[0].paid
    ).toBe(false)
    expect(
      buildBillSchedule(
        [rule],
        [{ ...payment, ledger_treatment: 'staged_no_balance_impact' }],
        '2028-02'
      ).bills[0].paid
    ).toBe(false)
    expect(buildBillSchedule([rule], [], '2028-01').bills[0].paid).toBe(false)
  })
  it('includes every weekly occurrence within the displayed month', () => {
    const result = buildBillSchedule(
      [{ ...rule, frequency: 'weekly', next_date: '2028-02-01' }],
      [],
      '2028-02'
    )
    expect(result.bills.map((bill) => bill.date)).toEqual([
      '2028-02-01',
      '2028-02-08',
      '2028-02-15',
      '2028-02-22',
      '2028-02-29',
    ])
  })
  it('retains ambiguity diagnostics when another legacy rule has a known date in the month', () => {
    expect(
      buildBillSchedule(
        [
          { ...rule, anchor_kind: null, anchor_day: null },
          { ...rule, id: 'known', next_date: '2028-02-29', anchor_kind: null, anchor_day: null },
        ],
        [],
        '2028-02'
      ).unresolved
    ).toBe(true)
  })
})
