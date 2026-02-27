import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos, fromCentavos } from '@/lib/money'
import { execute } from '@/lib/database'
import { useAccountStore } from '@/stores/account-store'

export const createAccount = tool({
  description:
    'Create a new financial account. Use this when the user wants to add a bank account, credit card, cash wallet, or other account. For credit cards, you can also set the credit limit and billing dates.',
  inputSchema: zodSchema(
    z.object({
      name: z.string().describe('Account name (e.g. "Chase Checking", "BBVA Credit Card")'),
      type: z
        .enum(['checking', 'savings', 'credit_card', 'cash', 'investment', 'crypto', 'other'])
        .optional()
        .default('checking')
        .describe('Account type (default: checking)'),
      currency: z
        .string()
        .optional()
        .default('USD')
        .describe('Currency code (default: USD)'),
      balance: z
        .number()
        .optional()
        .default(0)
        .describe('Initial balance in the main currency unit (default: 0)'),
      creditLimit: z
        .number()
        .optional()
        .describe('Credit limit in the main currency unit (only for credit_card type)'),
      statementClosingDay: z
        .number()
        .int()
        .min(1)
        .max(31)
        .optional()
        .describe('Day of the month the statement closes (1-31, only for credit_card type)'),
      paymentDueDay: z
        .number()
        .int()
        .min(1)
        .max(31)
        .optional()
        .describe('Day of the month payment is due (1-31, only for credit_card type)'),
    })
  ),
  execute: async ({ name, type, currency, balance, creditLimit, statementClosingDay, paymentDueDay }) => {
    const id = generateId()
    const balanceCentavos = toCentavos(balance)
    const creditLimitCentavos = creditLimit !== undefined ? toCentavos(creditLimit) : null

    await execute(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived, credit_limit, statement_closing_day, payment_due_day)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
      [id, name, type, currency, balanceCentavos, creditLimitCentavos, statementClosingDay ?? null, paymentDueDay ?? null]
    )

    await useAccountStore.getState().fetch()

    const parts = [`Created ${type} account "${name}" with balance $${fromCentavos(balanceCentavos).toFixed(2)}`]
    if (creditLimit !== undefined) parts.push(`credit limit: $${creditLimit.toFixed(2)}`)
    if (statementClosingDay !== undefined) parts.push(`closing day: ${statementClosingDay}`)
    if (paymentDueDay !== undefined) parts.push(`payment due day: ${paymentDueDay}`)

    return {
      success: true,
      account: {
        id,
        name,
        type,
        currency,
        balance: fromCentavos(balanceCentavos),
        creditLimit: creditLimit ?? undefined,
        statementClosingDay: statementClosingDay ?? undefined,
        paymentDueDay: paymentDueDay ?? undefined,
      },
      message: parts.join(', '),
    }
  },
})
