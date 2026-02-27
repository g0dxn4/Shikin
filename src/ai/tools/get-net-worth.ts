import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos } from '@/lib/money'
import { query } from '@/lib/database'
import type { Account, Investment } from '@/types/database'

export const getNetWorth = tool({
  description:
    'Calculate total net worth by summing all account balances (assets minus credit card debt) plus investment values. Returns a breakdown by account and investment.',
  inputSchema: zodSchema(
    z.object({})
  ),
  execute: async () => {
    // Get all active accounts
    const accounts = await query<Account>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY type, name'
    )

    // Get all investments with latest prices
    const investments = await query<Investment & { latest_price: number | null }>(
      `SELECT i.*,
              (SELECT sp.price FROM stock_prices sp WHERE sp.symbol = i.symbol ORDER BY sp.date DESC LIMIT 1) as latest_price
       FROM investments i
       ORDER BY i.name`
    )

    // Calculate account totals
    let totalAssets = 0
    let totalLiabilities = 0

    const accountBreakdown = accounts.map((acc) => {
      const balance = fromCentavos(acc.balance)
      const isLiability = acc.type === 'credit_card'

      if (isLiability) {
        // Credit card balances are typically negative (debt)
        totalLiabilities += Math.abs(balance)
      } else {
        totalAssets += balance
      }

      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        currency: acc.currency,
        balance,
        isLiability,
      }
    })

    // Calculate investment totals
    let totalInvestments = 0

    const investmentBreakdown = investments.map((inv) => {
      const currentPrice = inv.latest_price ? fromCentavos(inv.latest_price) : fromCentavos(inv.avg_cost_basis)
      const value = inv.shares * currentPrice
      const costBasis = inv.shares * fromCentavos(inv.avg_cost_basis)
      const gainLoss = value - costBasis
      totalInvestments += value

      return {
        id: inv.id,
        name: inv.name,
        symbol: inv.symbol,
        type: inv.type,
        shares: inv.shares,
        currentPrice,
        value,
        costBasis,
        gainLoss,
        gainLossPercent: costBasis > 0 ? Math.round((gainLoss / costBasis) * 100) : 0,
        currency: inv.currency,
      }
    })

    totalAssets += totalInvestments
    const netWorth = totalAssets - totalLiabilities

    return {
      success: true,
      netWorth,
      totalAssets,
      totalLiabilities,
      totalInvestments,
      accounts: accountBreakdown,
      investments: investmentBreakdown,
      message: `Net worth: $${netWorth.toFixed(2)} (Assets: $${totalAssets.toFixed(2)}, Liabilities: $${totalLiabilities.toFixed(2)}, Investments: $${totalInvestments.toFixed(2)}).`,
    }
  },
})
