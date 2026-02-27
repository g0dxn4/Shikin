import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { toCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import { useAccountStore } from '@/stores/account-store'
import type { Account } from '@/types/database'

export const updateAccount = tool({
  description:
    'Update an existing account. Use this to change the name, type, currency, balance, credit limit, or billing dates of an account.',
  inputSchema: zodSchema(
    z.object({
      accountId: z.string().describe('The ID of the account to update'),
      name: z.string().optional().describe('New account name'),
      type: z
        .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
        .optional()
        .describe('New account type'),
      currency: z.string().optional().describe('New currency code'),
      balance: z.number().optional().describe('New balance in main currency unit'),
      creditLimit: z.number().optional().describe('New credit limit in main currency unit'),
      statementClosingDay: z.number().int().min(1).max(31).optional().describe('New statement closing day (1-31)'),
      paymentDueDay: z.number().int().min(1).max(31).optional().describe('New payment due day (1-31)'),
    })
  ),
  execute: async ({ accountId, name, type, currency, balance, creditLimit, statementClosingDay, paymentDueDay }) => {
    const existing = await query<Account>(
      'SELECT * FROM accounts WHERE id = $1',
      [accountId]
    )

    if (existing.length === 0) {
      return { success: false, message: `Account ${accountId} not found.` }
    }

    const account = existing[0]
    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1

    if (name !== undefined) {
      setClauses.push(`name = $${paramIdx++}`)
      params.push(name)
    }
    if (type !== undefined) {
      setClauses.push(`type = $${paramIdx++}`)
      params.push(type)
    }
    if (currency !== undefined) {
      setClauses.push(`currency = $${paramIdx++}`)
      params.push(currency)
    }
    if (balance !== undefined) {
      setClauses.push(`balance = $${paramIdx++}`)
      params.push(toCentavos(balance))
    }
    if (creditLimit !== undefined) {
      setClauses.push(`credit_limit = $${paramIdx++}`)
      params.push(toCentavos(creditLimit))
    }
    if (statementClosingDay !== undefined) {
      setClauses.push(`statement_closing_day = $${paramIdx++}`)
      params.push(statementClosingDay)
    }
    if (paymentDueDay !== undefined) {
      setClauses.push(`payment_due_day = $${paramIdx++}`)
      params.push(paymentDueDay)
    }

    if (setClauses.length === 0) {
      return { success: false, message: 'No fields to update.' }
    }

    setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    params.push(accountId)

    await execute(
      `UPDATE accounts SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params
    )

    await useAccountStore.getState().fetch()

    return {
      success: true,
      message: `Updated account "${name ?? account.name}".`,
    }
  },
})
