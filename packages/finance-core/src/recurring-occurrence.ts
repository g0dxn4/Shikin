import { advanceAnchoredRecurrence, advanceLegacyRecurrence } from './recurrence.js'
import { calculateSignedLedgerDeltas, type LedgerEntry } from './ledger.js'

/** Stored rule and joined account evidence; adapters retain SQL, IDs, and transaction ownership. */
export interface RecurringOccurrenceRule {
  id: string
  description: string
  amount: number
  type: string
  currency: string | null
  frequency: string
  next_date: string
  end_date: string | null
  anchor_kind?: string | null
  anchor_day?: number | null
  account_id: string
  account_currency?: string | null
  account_is_archived?: number | null
  account_mode?: string | null
  category_id: string | null
  subcategory_id?: string | null
  tags?: string | null
  to_account_id?: string | null
  notes: string | null
}

export interface RecurringOccurrenceFailure {
  reason:
    | 'unsupported_recurring_transfer'
    | 'account_archived'
    | 'snapshot_only_account'
    | 'unknown_rule_currency'
    | 'rule_account_currency_mismatch'
    | 'invalid_ledger_evidence'
  rule: RecurringOccurrenceRule
  detail?: string
}

/** Scan the whole due set in the established first-error order, before any claims or writes. */
export function validateRecurringOccurrences(
  rules: readonly RecurringOccurrenceRule[]
): RecurringOccurrenceFailure | null {
  const transfer = rules.find((rule) => rule.type === 'transfer')
  if (transfer) return { reason: 'unsupported_recurring_transfer', rule: transfer }
  const archived = rules.find((rule) => rule.account_is_archived !== 0)
  if (archived) return { reason: 'account_archived', rule: archived }
  const snapshot = rules.find((rule) => (rule.account_mode ?? 'transactional') === 'snapshot_only')
  if (snapshot) return { reason: 'snapshot_only_account', rule: snapshot }
  const unknownCurrency = rules.find((rule) => normalizeCurrency(rule.currency) === '')
  if (unknownCurrency) return { reason: 'unknown_rule_currency', rule: unknownCurrency }
  const mismatch = rules.find(
    (rule) => normalizeCurrency(rule.currency) !== normalizeCurrency(rule.account_currency)
  )
  if (mismatch) return { reason: 'rule_account_currency_mismatch', rule: mismatch }
  for (const rule of rules) {
    try {
      recurringLedgerDelta(rule)
    } catch (error) {
      return {
        reason: 'invalid_ledger_evidence',
        rule,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }
  return null
}

export function recurringOccurrenceFailureMessage({
  reason,
  rule,
  detail,
}: RecurringOccurrenceFailure): string {
  switch (reason) {
    case 'unsupported_recurring_transfer':
      return 'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
    case 'account_archived':
      return `Recurring rule "${rule.description}" points at archived account ${rule.account_id}. Unarchive the account or pause the rule before materializing it.`
    case 'snapshot_only_account':
      return `Recurring rule "${rule.description}" points at snapshot-only account ${rule.account_id}. Snapshot-only accounts do not accept transaction ledger writes.`
    case 'unknown_rule_currency':
      return `${rule.description ? `Recurring rule "${rule.description}"` : `Recurring rule ${rule.id}`} has no stored currency. Repair or recreate the rule before moving or materializing it.`
    case 'rule_account_currency_mismatch':
      return `Recurring rule "${rule.description ?? 'Unknown rule'}" has stored currency ${rule.currency ?? 'unknown'} but the linked account is now ${rule.account_currency ?? 'unknown'}. Repair or recreate the rule before materializing it.`
    case 'invalid_ledger_evidence':
      return `Recurring rule "${rule.description}" has invalid ledger evidence: ${detail}. Correct the rule and account evidence before materializing it.`
  }
}

export class RecurringAnchorRequiredError extends Error {
  readonly date: string

  constructor(date: string) {
    super(
      `Recurring date ${date} needs an explicit fixed-day or end-of-month anchor. Edit and save the rule before materializing it.`
    )
    this.date = date
  }
}

export type RecurringOccurrencePlan =
  | { kind: 'deactivate'; date: string }
  | {
      kind: 'occurrence'
      date: string
      nextDate: string
      active: 0 | 1
      transaction: {
        account_id: string
        category_id: string | null
        subcategory_id: string | null
        type: string
        amount: number
        currency: string
        description: string
        notes: string | null
        date: string
        tags: string
        transfer_to_account_id: string | null
        recurring_rule_id: string
      }
      balanceDelta: number
    }

/** Plan one guarded step. Short-frequency dates are advanced by the adapter's local calendar. */
export function planRecurringOccurrence(
  rule: RecurringOccurrenceRule,
  date: string,
  today: string,
  advancedDate?: string
): RecurringOccurrencePlan | null {
  if (date > today) return null
  if (rule.end_date && date > rule.end_date) return { kind: 'deactivate', date }

  let nextDate: string
  switch (rule.frequency) {
    case 'daily':
    case 'weekly':
    case 'biweekly': {
      if (advancedDate === undefined) {
        throw new TypeError('Short recurring frequencies require an adapter-advanced date.')
      }
      nextDate = advancedDate
      break
    }
    case 'monthly':
    case 'quarterly':
    case 'yearly': {
      if (rule.anchor_kind === 'end_of_month') {
        nextDate = advanceAnchoredRecurrence(date, rule.frequency, { kind: 'end_of_month' }).date
      } else if (rule.anchor_kind === 'fixed_day') {
        if (rule.anchor_day === null || rule.anchor_day === undefined) {
          throw new RangeError(
            'day-of-month recurrence anchor must be an integer from 1 through 31'
          )
        }
        nextDate = advanceAnchoredRecurrence(date, rule.frequency, {
          kind: 'day_of_month',
          day: rule.anchor_day,
        }).date
      } else if (rule.anchor_kind === null || rule.anchor_kind === undefined) {
        const legacy = advanceLegacyRecurrence(date, rule.frequency)
        if (legacy.status === 'unresolved') throw new RecurringAnchorRequiredError(date)
        nextDate = legacy.date
      } else {
        throw new TypeError(`Unsupported recurrence anchor kind: ${rule.anchor_kind}`)
      }
      break
    }
    default:
      throw new Error(`Unsupported recurring frequency: ${rule.frequency}`)
  }

  return {
    kind: 'occurrence',
    date,
    nextDate,
    active: rule.end_date && nextDate > rule.end_date ? 0 : 1,
    transaction: {
      account_id: rule.account_id,
      category_id: rule.category_id,
      subcategory_id: rule.subcategory_id ?? null,
      type: rule.type,
      amount: rule.amount,
      currency: normalizeCurrency(rule.currency),
      description: rule.description,
      notes: rule.notes,
      date,
      tags: rule.tags || '[]',
      transfer_to_account_id: rule.to_account_id ?? null,
      recurring_rule_id: rule.id,
    },
    balanceDelta: recurringLedgerDelta(rule),
  }
}

function recurringLedgerDelta(rule: RecurringOccurrenceRule): number {
  const result = calculateSignedLedgerDeltas({
    type: rule.type as LedgerEntry['type'],
    amountCentavos: rule.amount,
    currency: rule.currency as string,
    account: {
      accountId: rule.account_id,
      currency: rule.account_currency as string,
      accountMode: (rule.account_mode ?? 'transactional') as LedgerEntry['account']['accountMode'],
    },
    status: 'posted',
  })
  if (result.status !== 'applied') {
    throw new Error(result.status === 'excluded' ? result.effectiveStatus.reason : result.reason)
  }
  return result.deltas[0]!.deltaCentavos
}

function normalizeCurrency(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}
