import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos, fromCentavos } from '@/lib/money'
import { execute } from '@/lib/database'

export const createAccount = tool({
  description:
    'Create a new financial account. Use this when the user wants to add a bank account, credit card, cash wallet, or other account.',
  inputSchema: zodSchema(
    z.object({
      name: z.string().describe('Account name (e.g. "Chase Checking", "Cash Wallet")'),
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
    })
  ),
  execute: async ({ name, type, currency, balance }) => {
    const id = generateId()
    const balanceCentavos = toCentavos(balance)

    await execute(
      `INSERT INTO accounts (id, name, type, currency, balance, is_archived)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [id, name, type, currency, balanceCentavos]
    )

    return {
      success: true,
      account: {
        id,
        name,
        type,
        currency,
        balance: fromCentavos(balanceCentavos),
      },
      message: `Created ${type} account "${name}" with balance $${fromCentavos(balanceCentavos).toFixed(2)}`,
    }
  },
})
