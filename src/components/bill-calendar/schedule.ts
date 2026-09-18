import dayjs from 'dayjs'
import {
  advanceAnchoredRecurrence,
  advanceLegacyRecurrence,
  isCashFlowEligible,
  normalizePostingStatus,
} from '@shikin/finance-core'
import type { RecurringRuleWithDetails } from '@/stores/recurring-store'
import type { Transaction } from '@/types/database'

export interface ScheduledBill {
  id: string
  date: string
  description: string
  amount: number
  currency: string
  paid: boolean
}

/** Read-only schedule: recorded payments win over projected occurrences. Never infer payment from age. */
export function buildBillSchedule(
  rules: RecurringRuleWithDetails[],
  transactions: Transaction[],
  month: string
) {
  const entries = new Map<string, ScheduledBill>()
  const end = dayjs(`${month}-01`).endOf('month').format('YYYY-MM-DD')
  let unresolved = false
  for (const rule of rules) {
    if (rule.active !== 1 || rule.type !== 'expense' || rule.account_is_archived === 1) continue
    let date = rule.next_date
    // Bound old daily rules without changing their stored anchor or next date.
    for (let count = 0; date <= end && count < 40000; count++) {
      if (rule.end_date && date > rule.end_date) break
      if (date.startsWith(month))
        entries.set(`${rule.id}:${date}`, {
          id: `${rule.id}:${date}`,
          date,
          description: rule.description,
          amount: rule.amount,
          currency: rule.currency ?? rule.account_currency ?? 'USD',
          paid: false,
        })
      let next: string
      if (
        rule.frequency === 'daily' ||
        rule.frequency === 'weekly' ||
        rule.frequency === 'biweekly'
      ) {
        next = dayjs(date)
          .add(rule.frequency === 'daily' ? 1 : rule.frequency === 'weekly' ? 7 : 14, 'day')
          .format('YYYY-MM-DD')
      } else {
        const result =
          rule.anchor_kind === 'end_of_month'
            ? advanceAnchoredRecurrence(date, rule.frequency, { kind: 'end_of_month' })
            : rule.anchor_kind === 'fixed_day' && rule.anchor_day
              ? advanceAnchoredRecurrence(date, rule.frequency, {
                  kind: 'day_of_month',
                  day: rule.anchor_day,
                })
              : advanceLegacyRecurrence(date, rule.frequency)
        if (result.status !== 'resolved') {
          // The known next date is sufficient for its own month, but not later months.
          unresolved ||= !date.startsWith(month)
          break
        }
        next = result.date
      }
      if (next <= date) break
      date = next
    }
  }
  for (const transaction of transactions) {
    if (!transaction.recurring_rule_id || !transaction.date.startsWith(month)) continue
    // Pending scheduled expenses remain due; ineligible provenance is never shown as cash flow.
    const status = normalizePostingStatus(transaction.status)
    if (
      !isCashFlowEligible({
        type: transaction.type,
        status: status === 'pending' ? 'posted' : transaction.status,
        ledgerTreatment: transaction.ledger_treatment,
        reportingTreatment: transaction.reporting_treatment,
        transactionKind: transaction.transaction_kind,
        isArchived: transaction.is_archived,
      })
    )
      continue
    const key = `${transaction.recurring_rule_id}:${transaction.date}`
    entries.set(key, {
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      amount: transaction.amount,
      currency: transaction.currency,
      paid: status === 'posted' || status === 'cleared',
    })
  }
  return {
    bills: [...entries.values()].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
    ),
    unresolved,
  }
}
