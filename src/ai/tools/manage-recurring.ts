import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos, fromCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import { useRecurringStore } from '@/stores/recurring-store'
import type { RecurringRule, Category } from '@/types/database'

export const manageRecurringTransaction = tool({
  description:
    'Create, update, delete, list, or toggle recurring transaction rules. Recurring rules automatically generate transactions on a schedule (daily, weekly, biweekly, monthly, quarterly, yearly).',
  inputSchema: zodSchema(
    z.object({
      action: z
        .enum(['create', 'update', 'delete', 'list', 'toggle'])
        .describe('The action to perform on recurring rules'),
      ruleId: z
        .string()
        .optional()
        .describe('Required for update/delete/toggle. The recurring rule ID.'),
      description: z
        .string()
        .optional()
        .describe('Description of the recurring transaction (e.g. "Monthly rent")'),
      amount: z
        .number()
        .positive()
        .optional()
        .describe('Amount in the main currency unit (e.g. 1200.00)'),
      type: z
        .enum(['expense', 'income', 'transfer'])
        .optional()
        .describe('Transaction type'),
      frequency: z
        .enum(['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'])
        .optional()
        .describe('How often this recurs'),
      nextDate: z
        .string()
        .optional()
        .describe('Next occurrence date in YYYY-MM-DD format'),
      endDate: z
        .string()
        .optional()
        .describe('Optional end date in YYYY-MM-DD format. Rule deactivates after this date.'),
      category: z
        .string()
        .optional()
        .describe('Category name to match (e.g. "Housing", "Salary")'),
      notes: z.string().optional().describe('Optional notes'),
    })
  ),
  execute: async ({
    action,
    ruleId,
    description,
    amount,
    type,
    frequency,
    nextDate,
    endDate,
    category,
    notes,
  }) => {
    if (action === 'list') {
      const rules = await query<RecurringRule & { account_name?: string; category_name?: string }>(
        `SELECT r.*, a.name as account_name, c.name as category_name
         FROM recurring_rules r
         LEFT JOIN accounts a ON r.account_id = a.id
         LEFT JOIN categories c ON r.category_id = c.id
         ORDER BY r.active DESC, r.next_date ASC`
      )

      if (rules.length === 0) {
        return { success: true, rules: [], message: 'No recurring rules found.' }
      }

      return {
        success: true,
        rules: rules.map((r) => ({
          id: r.id,
          description: r.description,
          amount: fromCentavos(r.amount),
          type: r.type,
          frequency: r.frequency,
          nextDate: r.next_date,
          endDate: r.end_date,
          active: !!r.active,
          account: r.account_name,
          category: r.category_name,
        })),
        message: `Found ${rules.length} recurring rule(s).`,
      }
    }

    if (action === 'create') {
      if (!description || !amount || !type || !frequency) {
        return {
          success: false,
          message: 'description, amount, type, and frequency are required to create a recurring rule.',
        }
      }

      // Find category
      let categoryId: string | null = null
      if (category) {
        const categories = await query<Category>(
          'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
          [`%${category}%`]
        )
        if (categories.length > 0) categoryId = categories[0].id
      }

      // Find first account (default)
      const accounts = await query<{ id: string }>('SELECT id FROM accounts LIMIT 1')
      if (accounts.length === 0) {
        return { success: false, message: 'No accounts found. Please create an account first.' }
      }

      const id = generateId()
      const amountCentavos = toCentavos(amount)
      const resolvedNextDate = nextDate || new Date().toISOString().split('T')[0]

      await execute(
        `INSERT INTO recurring_rules (id, description, amount, type, frequency, next_date, end_date, account_id, category_id, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          description,
          amountCentavos,
          type,
          frequency,
          resolvedNextDate,
          endDate ?? null,
          accounts[0].id,
          categoryId,
          notes ?? null,
        ]
      )

      await useRecurringStore.getState().fetch()

      return {
        success: true,
        rule: { id, description, amount, type, frequency, nextDate: resolvedNextDate },
        message: `Created ${frequency} recurring ${type}: "$${amount.toFixed(2)} — ${description}" starting ${resolvedNextDate}.`,
      }
    }

    if (action === 'update') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for update.' }
      }

      const existing = await query<RecurringRule>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const rule = existing[0]
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (description !== undefined) {
        setClauses.push(`description = $${paramIdx++}`)
        params.push(description)
      }
      if (amount !== undefined) {
        setClauses.push(`amount = $${paramIdx++}`)
        params.push(toCentavos(amount))
      }
      if (type !== undefined) {
        setClauses.push(`type = $${paramIdx++}`)
        params.push(type)
      }
      if (frequency !== undefined) {
        setClauses.push(`frequency = $${paramIdx++}`)
        params.push(frequency)
      }
      if (nextDate !== undefined) {
        setClauses.push(`next_date = $${paramIdx++}`)
        params.push(nextDate)
      }
      if (endDate !== undefined) {
        setClauses.push(`end_date = $${paramIdx++}`)
        params.push(endDate)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(notes)
      }

      // Find category if provided
      if (category !== undefined) {
        let categoryId: string | null = null
        if (category) {
          const categories = await query<Category>(
            'SELECT id FROM categories WHERE LOWER(name) LIKE LOWER($1) LIMIT 1',
            [`%${category}%`]
          )
          if (categories.length > 0) categoryId = categories[0].id
        }
        setClauses.push(`category_id = $${paramIdx++}`)
        params.push(categoryId)
      }

      if (setClauses.length === 0) {
        return { success: false, message: 'No fields to update.' }
      }

      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(ruleId)

      await execute(
        `UPDATE recurring_rules SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )

      await useRecurringStore.getState().fetch()

      return {
        success: true,
        message: `Updated recurring rule "${description ?? rule.description}".`,
      }
    }

    if (action === 'delete') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for delete.' }
      }

      const existing = await query<RecurringRule>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      await execute('DELETE FROM recurring_rules WHERE id = $1', [ruleId])
      await useRecurringStore.getState().fetch()

      return {
        success: true,
        message: `Deleted recurring rule "${existing[0].description}".`,
      }
    }

    if (action === 'toggle') {
      if (!ruleId) {
        return { success: false, message: 'ruleId is required for toggle.' }
      }

      const existing = await query<RecurringRule>(
        'SELECT * FROM recurring_rules WHERE id = $1',
        [ruleId]
      )
      if (existing.length === 0) {
        return { success: false, message: `Recurring rule ${ruleId} not found.` }
      }

      const newActive = existing[0].active ? 0 : 1
      await execute(
        "UPDATE recurring_rules SET active = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
        [newActive, ruleId]
      )

      await useRecurringStore.getState().fetch()

      return {
        success: true,
        message: `${newActive ? 'Activated' : 'Paused'} recurring rule "${existing[0].description}".`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
})

export const materializeRecurring = tool({
  description:
    'Manually trigger materialization of due recurring transactions. This creates actual transactions for any recurring rules whose next_date has passed.',
  inputSchema: zodSchema(z.object({})),
  execute: async () => {
    const count = await useRecurringStore.getState().materializeTransactions()
    return {
      success: true,
      created: count,
      message:
        count > 0
          ? `Created ${count} transaction(s) from recurring rules.`
          : 'No recurring transactions were due.',
    }
  },
})
