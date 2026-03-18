import { create } from 'zustand'
import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { useAccountStore } from './account-store'
import { useTransactionStore } from './transaction-store'
import type { RecurringRule } from '@/types/database'
import type { TransactionType, RecurringFrequency } from '@/types/common'
import dayjs from 'dayjs'

export interface RecurringRuleWithDetails extends RecurringRule {
  account_name?: string
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

export const useRecurringStore = create<RecurringState>((set, get) => ({
  rules: [],
  isLoading: false,

  fetch: async () => {
    set({ isLoading: true })
    try {
      const rules = await query<RecurringRuleWithDetails>(
        `SELECT r.*, a.name as account_name, c.name as category_name, c.color as category_color
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         LEFT JOIN categories c ON r.category_id = c.id
         ORDER BY r.active DESC, r.next_date ASC`
      )
      set({ rules })
    } finally {
      set({ isLoading: false })
    }
  },

  create: async (data) => {
    const id = generateId()
    const now = new Date().toISOString()
    const amountCentavos = toCentavos(data.amount)

    await execute(
      `INSERT INTO recurring_rules (id, description, amount, type, frequency, next_date, end_date, account_id, to_account_id, category_id, subcategory_id, tags, notes, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [
        id,
        data.description,
        amountCentavos,
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

    await get().fetch()
  },

  update: async (id, data) => {
    const now = new Date().toISOString()
    const amountCentavos = toCentavos(data.amount)

    await execute(
      `UPDATE recurring_rules SET description = ?, amount = ?, type = ?, frequency = ?, next_date = ?, end_date = ?, account_id = ?, to_account_id = ?, category_id = ?, subcategory_id = ?, tags = ?, notes = ?, updated_at = ?
       WHERE id = ?`,
      [
        data.description,
        amountCentavos,
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

    await get().fetch()
  },

  remove: async (id) => {
    await execute('DELETE FROM recurring_rules WHERE id = ?', [id])
    await get().fetch()
  },

  toggleActive: async (id) => {
    const rule = get().getById(id)
    if (!rule) return
    const now = new Date().toISOString()
    const newActive = rule.active ? 0 : 1
    await execute('UPDATE recurring_rules SET active = ?, updated_at = ? WHERE id = ?', [
      newActive,
      now,
      id,
    ])
    await get().fetch()
  },

  getById: (id) => {
    return get().rules.find((r) => r.id === id)
  },

  materializeTransactions: async () => {
    const today = dayjs().format('YYYY-MM-DD')

    // Get all active rules where next_date <= today
    const dueRules = await query<RecurringRule>(
      `SELECT * FROM recurring_rules WHERE active = 1 AND next_date <= ?`,
      [today]
    )

    let created = 0

    for (const rule of dueRules) {
      let nextDate = rule.next_date

      // Create transactions for all due dates (handle missed dates)
      while (nextDate <= today) {
        // Check end_date
        if (rule.end_date && nextDate > rule.end_date) {
          // Deactivate the rule
          await execute(
            "UPDATE recurring_rules SET active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [rule.id]
          )
          break
        }

        const txId = generateId()
        await execute(
          `INSERT INTO transactions (id, account_id, category_id, subcategory_id, type, amount, description, notes, date, tags, is_recurring, transfer_to_account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            txId,
            rule.account_id,
            rule.category_id,
            rule.subcategory_id,
            rule.type,
            rule.amount,
            rule.description,
            rule.notes,
            nextDate,
            rule.tags || '[]',
            rule.to_account_id,
          ]
        )

        // Update account balance
        const balanceDelta = rule.type === 'income' ? rule.amount : -rule.amount
        await execute(
          "UPDATE accounts SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          [balanceDelta, rule.account_id]
        )

        // Handle transfer: credit the destination account
        if (rule.type === 'transfer' && rule.to_account_id) {
          await execute(
            "UPDATE accounts SET balance = balance + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [rule.amount, rule.to_account_id]
          )
        }

        created++
        nextDate = advanceDate(nextDate, rule.frequency as RecurringFrequency)
      }

      // Update the rule's next_date
      // Check if the rule should be deactivated
      if (rule.end_date && nextDate > rule.end_date) {
        await execute(
          "UPDATE recurring_rules SET active = 0, next_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          [nextDate, rule.id]
        )
      } else {
        await execute(
          "UPDATE recurring_rules SET next_date = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
          [nextDate, rule.id]
        )
      }
    }

    if (created > 0) {
      // Refresh related stores
      await useTransactionStore.getState().fetch()
      await useAccountStore.getState().fetch()
      await get().fetch()
    }

    return created
  },
}))
