import { describe, expect, it } from 'vitest'
import {
  planRecurringOccurrence,
  recurringOccurrenceFailureMessage,
  validateRecurringOccurrences,
  type RecurringOccurrenceRule,
} from './recurring-occurrence.js'

const rule: RecurringOccurrenceRule = {
  id: 'r',
  description: 'R',
  type: 'expense',
  amount: 100,
  currency: ' usd ',
  frequency: 'monthly',
  next_date: '2026-11-08',
  end_date: null,
  anchor_kind: 'fixed_day',
  anchor_day: 8,
  account_id: 'a',
  account_currency: 'USD',
  account_is_archived: 0,
  account_mode: 'transactional',
  category_id: 'c',
  subcategory_id: 's',
  tags: '["x"]',
  to_account_id: 'b',
  notes: 'note',
}

describe('recurring occurrence policy', () => {
  it.each([
    [{ amount: -1 }, 'amountCentavos must be a non-negative safe integer'],
    [{ amount: 0.5 }, 'amountCentavos must be a non-negative safe integer'],
    [{ amount: 9007199254740992 }, 'amountCentavos must be a non-negative safe integer'],
    [{ type: 'refund' }, 'Unsupported transaction type: refund'],
    [{ account_mode: 'hybrid' }, 'Unsupported account mode: hybrid'],
    [
      { currency: 'US-D', account_currency: 'US-D' },
      'account.currency must be a 2-10 character asset or currency code',
    ],
  ] as const)('refuses invalid financial shape %j before posting', (patch, message) => {
    const input = { ...rule, ...patch }
    expect(validateRecurringOccurrences([input])).toMatchObject({
      reason: 'invalid_ledger_evidence',
      detail: message,
    })
    expect(() => planRecurringOccurrence(input, rule.next_date, rule.next_date)).toThrow(message)
  })
  it('plans exact occurrence fields without mutating the rule or supplying clocks and IDs', () => {
    const input = Object.freeze({ ...rule })
    expect(validateRecurringOccurrences([input])).toBeNull()
    expect(planRecurringOccurrence(input, '2026-11-08', '2026-11-08')).toEqual({
      kind: 'occurrence',
      date: '2026-11-08',
      nextDate: '2026-12-08',
      active: 1,
      transaction: {
        account_id: 'a',
        category_id: 'c',
        subcategory_id: 's',
        type: 'expense',
        amount: 100,
        currency: 'USD',
        description: 'R',
        notes: 'note',
        date: '2026-11-08',
        tags: '["x"]',
        transfer_to_account_id: 'b',
        recurring_rule_id: 'r',
      },
      balanceDelta: -100,
    })
    expect(input).toEqual(rule)
  })

  it.each([1, 2, null, undefined])(
    'rejects nonzero or missing archive evidence %s',
    (account_is_archived) => {
      const failure = validateRecurringOccurrences([{ ...rule, account_is_archived }])!
      expect(failure.reason).toBe('account_archived')
      expect(recurringOccurrenceFailureMessage(failure)).toBe(
        'Recurring rule "R" points at archived account a. Unarchive the account or pause the rule before materializing it.'
      )
    }
  )

  it('keeps whole-array transfer, archive, snapshot, currency, mismatch precedence', () => {
    const invalid = [
      { ...rule, account_currency: 'EUR' },
      { ...rule, currency: null },
      { ...rule, account_mode: 'snapshot_only' },
      { ...rule, account_is_archived: 2 },
      { ...rule, type: 'transfer' },
    ]
    for (const reason of [
      'unsupported_recurring_transfer',
      'account_archived',
      'snapshot_only_account',
      'unknown_rule_currency',
      'rule_account_currency_mismatch',
    ]) {
      expect(validateRecurringOccurrences(invalid)?.reason).toBe(reason)
      invalid.pop()
    }
  })

  it.each(['bogus', '', 'toString'])('rejects unsupported frequency %s', (frequency) => {
    expect(() =>
      planRecurringOccurrence({ ...rule, frequency }, rule.next_date, rule.next_date)
    ).toThrow(`Unsupported recurring frequency: ${frequency}`)
  })

  it.each([8.5, 0, 32, null, undefined, NaN])(
    'rejects malformed explicit fixed day %s',
    (anchor_day) => {
      expect(() =>
        planRecurringOccurrence({ ...rule, anchor_day }, rule.next_date, rule.next_date)
      ).toThrow('day-of-month recurrence anchor must be an integer from 1 through 31')
    }
  )

  it('rejects unsupported anchor kinds rather than interpreting them as legacy', () => {
    expect(() =>
      planRecurringOccurrence({ ...rule, anchor_kind: 'bogus' }, rule.next_date, rule.next_date)
    ).toThrow('Unsupported recurrence anchor kind: bogus')
  })

  it('retains ambiguous legacy refusal and explicit end-of-month intent', () => {
    expect(() =>
      planRecurringOccurrence(
        { ...rule, anchor_kind: null, anchor_day: null },
        '2026-10-28',
        '2026-11-08'
      )
    ).toThrow(
      'Recurring date 2026-10-28 needs an explicit fixed-day or end-of-month anchor. Edit and save the rule before materializing it.'
    )
    expect(
      planRecurringOccurrence(
        { ...rule, anchor_kind: 'end_of_month', anchor_day: null },
        '2026-10-31',
        '2026-11-08'
      )
    ).toMatchObject({ nextDate: '2026-11-30' })
  })

  it.each([
    ['monthly', '2026-12-08'],
    ['quarterly', '2027-02-08'],
    ['yearly', '2027-11-08'],
  ])('advances %s without inventing an anchor', (frequency, nextDate) => {
    expect(
      planRecurringOccurrence({ ...rule, frequency }, rule.next_date, rule.next_date)
    ).toMatchObject({ nextDate })
  })

  it.each(['daily', 'weekly', 'biweekly'])(
    'uses the adapter-advanced date verbatim for %s',
    (frequency) => {
      expect(
        planRecurringOccurrence(
          { ...rule, frequency },
          '2026-11-01T00:00:00Z',
          '2026-11-08',
          '2026-11-02'
        )
      ).toMatchObject({
        date: '2026-11-01T00:00:00Z',
        nextDate: '2026-11-02',
        transaction: { date: '2026-11-01T00:00:00Z' },
      })
      expect(() =>
        planRecurringOccurrence({ ...rule, frequency }, rule.next_date, rule.next_date)
      ).toThrow('Short recurring frequencies require an adapter-advanced date.')
    }
  )

  it('preserves future, expiry, end-date deactivation, income, and empty-tag behavior', () => {
    expect(planRecurringOccurrence(rule, '2026-12-08', '2026-11-08')).toBeNull()
    expect(
      planRecurringOccurrence({ ...rule, end_date: '2026-11-07' }, rule.next_date, rule.next_date)
    ).toEqual({ kind: 'deactivate', date: '2026-11-08' })
    expect(
      planRecurringOccurrence(
        { ...rule, type: 'income', tags: '', end_date: '2026-11-08' },
        rule.next_date,
        rule.next_date
      )
    ).toMatchObject({ active: 0, balanceDelta: 100, transaction: { tags: '[]' } })
  })
})
