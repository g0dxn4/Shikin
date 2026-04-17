import { create } from 'zustand'
import {
  query,
  execute,
  withTransaction,
  materializeRecurringTransactionsBrowser,
} from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { isTauri } from '@/lib/runtime'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { useAccountStore } from './account-store'
import { useTransactionStore } from './transaction-store'
import type { RecurringRule } from '@/types/database'
import type { TransactionType, RecurringFrequency, CurrencyCode } from '@/types/common'
import dayjs from 'dayjs'

export interface RecurringRuleWithDetails extends RecurringRule {
  account_name?: string
  account_currency?: CurrencyCode
  category_name?: string
  category_color?: string
}

export interface RecurringRuleFormData {
  description: string
  amount: number
  type: TransactionType
  frequency: RecurringFrequency
  nextDate: string
  endDate: string | null
  accountId: string
  toAccountId: string | null
  categoryId: string | null
  subcategoryId: string | null
  tags: string
  notes: string | null
}

interface RecurringState {
  rules: RecurringRuleWithDetails[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  create: (data: RecurringRuleFormData) => Promise<void>
  update: (id: string, data: RecurringRuleFormData) => Promise<void>
  remove: (id: string) => Promise<void>
  toggleActive: (id: string) => Promise<void>
  getById: (id: string) => RecurringRuleWithDetails | undefined
  materializeTransactions: () => Promise<number>
}

/**
 * Advance a date by the given frequency.
 */
function advanceDate(date: string, frequency: RecurringFrequency): string {
  const d = dayjs(date)
  switch (frequency) {
    case 'daily':
      return d.add(1, 'day').format('YYYY-MM-DD')
    case 'weekly':
      return d.add(7, 'day').format('YYYY-MM-DD')
    case 'biweekly':
      return d.add(14, 'day').format('YYYY-MM-DD')
    case 'monthly':
      return d.add(1, 'month').format('YYYY-MM-DD')
    case 'quarterly':
      return d.add(3, 'month').format('YYYY-MM-DD')
    case 'yearly':
      return d.add(1, 'year').format('YYYY-MM-DD')
  }
}

async function resolveAccountCurrency(accountId: string): Promise<CurrencyCode> {
  const accounts = await query<{ currency: CurrencyCode }>(
    'SELECT currency FROM accounts WHERE id = ? LIMIT 1',
    [accountId]
  )
  if (accounts.length === 0) {
    throw new Error(`Account ${accountId} not found.`)
  }

  return accounts[0].currency
}

function unknownRecurringRuleCurrencyMessage(rule: { id: string; description?: string | null }) {
  return `${rule.description ? `Recurring rule "${rule.description}"` : `Recurring rule ${rule.id}`} has no stored currency. Repair or recreate the rule before moving or materializing it.`
}

function normalizeRecurringCurrency(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function invalidAccountCurrencyMessage(accountId: string) {
  return `Account ${accountId} has no valid stored currency. Repair the account currency before creating or updating recurring rules.`
}

function crossCurrencyRecurringRuleMoveMessage(from: string, to: string) {
  return `Cannot move this recurring rule from ${from} to ${to}. Cross-currency moves are not supported because they would change amount semantics without FX conversion.`
}

function recurringRuleAccountCurrencyMismatchMessage(rule: {
  description?: string | null
  currency: string | null
  account_currency?: string
}) {
  return `Recurring rule "${rule.description ?? 'Unknown rule'}" has stored currency ${rule.currency ?? 'unknown'} but the linked account is now ${rule.account_currency ?? 'unknown'}. Repair or recreate the rule before materializing it.`
}

function unsupportedRecurringTransferMessage() {
  return 'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.'
}

export const useRecurringStore = create<RecurringState>((set, get) => ({
  rules: [],
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const rules = await query<RecurringRuleWithDetails>(
        `SELECT r.*, a.name as account_name, a.currency as account_currency, c.name as category_name, c.color as category_color
          FROM recurring_rules r
          LEFT JOIN accounts a ON r.account_id = a.id
          LEFT JOIN categories c ON r.category_id = c.id
         ORDER BY r.active DESC, r.next_date ASC`
      )
      set({ rules, fetchError: null })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  create: async (data) => {
    set({ error: null })
    try {
      if (data.type === 'transfer') {
        throw new Error(unsupportedRecurringTransferMessage())
      }

      const id = generateId()
      const now = new Date().toISOString()
      const amountCentavos = toCentavos(data.amount)
      const currency = normalizeRecurringCurrency(await resolveAccountCurrency(data.accountId))
      if (currency === '') {
        throw new Error(invalidAccountCurrencyMessage(data.accountId))
      }

      await execute(
        `INSERT INTO recurring_rules (id, description, amount, currency, type, frequency, next_date, end_date, account_id, to_account_id, category_id, subcategory_id, tags, notes, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          id,
          data.description,
          amountCentavos,
          currency,
          data.type,
          data.frequency,
          data.nextDate,
          data.endDate,
          data.accountId,
          data.toAccountId,
          data.categoryId,
          data.subcategoryId,
          data.tags || '',
          data.notes,
          now,
          now,
        ]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      if (data.type === 'transfer') {
        throw new Error(unsupportedRecurringTransferMessage())
      }

      const existing = await query<RecurringRule>(
        'SELECT * FROM recurring_rules WHERE id = ? LIMIT 1',
        [id]
      )
      if (existing.length === 0) {
        throw new Error(`Recurring rule ${id} not found.`)
      }

      const rule = existing[0]
      if (normalizeRecurringCurrency(rule.currency) === '') {
        throw new Error(unknownRecurringRuleCurrencyMessage(rule))
      }

      const now = new Date().toISOString()
      const amountCentavos = toCentavos(data.amount)
      const isMovingAccounts = data.accountId !== rule.account_id
      let currency = normalizeRecurringCurrency(rule.currency)

      if (isMovingAccounts) {
        const targetCurrency = normalizeRecurringCurrency(
          await resolveAccountCurrency(data.accountId)
        )
        if (targetCurrency !== normalizeRecurringCurrency(rule.currency)) {
          throw new Error(crossCurrencyRecurringRuleMoveMessage(currency, targetCurrency))
        }
        currency = targetCurrency
      }

      await execute(
        `UPDATE recurring_rules SET description = ?, amount = ?, currency = ?, type = ?, frequency = ?, next_date = ?, end_date = ?, account_id = ?, to_account_id = ?, category_id = ?, subcategory_id = ?, tags = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          data.description,
          amountCentavos,
          currency,
          data.type,
          data.frequency,
          data.nextDate,
          data.endDate,
          data.accountId,
          data.toAccountId,
          data.categoryId,
          data.subcategoryId,
          data.tags || '',
          data.notes,
          now,
          id,
        ]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await execute('DELETE FROM recurring_rules WHERE id = ?', [id])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  toggleActive: async (id) => {
    set({ error: null })
    try {
      const rule = get().getById(id)
      if (!rule) return
      const now = new Date().toISOString()
      const newActive = rule.active ? 0 : 1
      await execute('UPDATE recurring_rules SET active = ?, updated_at = ? WHERE id = ?', [
        newActive,
        now,
        id,
      ])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  getById: (id) => {
    return get().rules.find((r) => r.id === id)
  },

  materializeTransactions: async () => {
    set({ error: null })
    try {
      if (!isTauri) {
        const result = await materializeRecurringTransactionsBrowser()

        if (result.created > 0) {
          await useTransactionStore.getState().fetch()
          await useAccountStore.getState().fetch()
          await get().fetch()
        }

        return result.created
      }

      const today = dayjs().format('YYYY-MM-DD')

      // Get all active rules where next_date <= today
      const dueRules = await query<RecurringRuleWithDetails>(
        `SELECT r.*, a.currency as account_currency
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         WHERE r.active = 1 AND r.next_date <= ?`,
        [today]
      )

      let created = 0

      const unsupportedTransferRule = dueRules.find((rule) => rule.type === 'transfer')
      if (unsupportedTransferRule) {
        throw new Error(unsupportedRecurringTransferMessage())
      }

      const unknownCurrencyRule = dueRules.find(
        (rule) => normalizeRecurringCurrency(rule.currency) === ''
      )
      if (unknownCurrencyRule) {
        throw new Error(unknownRecurringRuleCurrencyMessage(unknownCurrencyRule))
      }

      const accountCurrencyMismatchRule = dueRules.find((rule) => {
        const ruleCurrency = normalizeRecurringCurrency(rule.currency)
        const accountCurrency = normalizeRecurringCurrency(rule.account_currency)
        return ruleCurrency !== '' && (accountCurrency === '' || ruleCurrency !== accountCurrency)
      })
      if (accountCurrencyMismatchRule) {
        throw new Error(recurringRuleAccountCurrencyMismatchMessage(accountCurrencyMismatchRule))
      }

      for (const rule of dueRules) {
        const createdForRule = await withTransaction(async (tx) => {
          let nextDate = rule.next_date
          let ruleCreated = 0

          // Create transactions for all due dates (handle missed dates)
          while (nextDate <= today) {
            // Check end_date
            if (rule.end_date && nextDate > rule.end_date) {
              const deactivateResult = await tx.execute(
                "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND active = 1 AND next_date = ?",
                [rule.id, nextDate]
              )
              if (deactivateResult.rowsAffected !== 1) {
                return ruleCreated
              }
              break
            }

            const newNextDate = advanceDate(nextDate, rule.frequency as RecurringFrequency)
            const shouldDeactivate = !!rule.end_date && newNextDate > rule.end_date
            const claimResult = await tx.execute(
              "UPDATE recurring_rules SET active = ?, next_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND active = 1 AND next_date = ?",
              [shouldDeactivate ? 0 : 1, newNextDate, rule.id, nextDate]
            )
            if (claimResult.rowsAffected !== 1) {
              return ruleCreated
            }

            const txId = generateId()
            await tx.execute(
              `INSERT INTO transactions (id, account_id, category_id, subcategory_id, type, amount, currency, description, notes, date, tags, is_recurring, transfer_to_account_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
              [
                txId,
                rule.account_id,
                rule.category_id,
                rule.subcategory_id,
                rule.type,
                rule.amount,
                normalizeRecurringCurrency(rule.currency),
                rule.description,
                rule.notes,
                nextDate,
                rule.tags || '[]',
                rule.to_account_id,
              ]
            )

            // Update account balance
            const balanceDelta = rule.type === 'income' ? rule.amount : -rule.amount
            await tx.execute(
              "UPDATE accounts SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
              [balanceDelta, rule.account_id]
            )

            ruleCreated++
            nextDate = newNextDate
            if (shouldDeactivate) {
              break
            }
          }

          return ruleCreated
        })

        created += createdForRule
      }

      if (created > 0) {
        // Refresh related stores
        await useTransactionStore.getState().fetch()
        await useAccountStore.getState().fetch()
        await get().fetch()
      }

      return created
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
}))
