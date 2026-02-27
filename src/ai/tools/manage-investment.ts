import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { execute, query } from '@/lib/database'
import type { Investment } from '@/types/database'

export const manageInvestment = tool({
  description:
    'Add, update, or delete an investment holding. Use this to track stocks, ETFs, crypto, bonds, and other investments.',
  inputSchema: zodSchema(
    z.object({
      action: z.enum(['add', 'update', 'delete']).describe('The action to perform'),
      investmentId: z
        .string()
        .optional()
        .describe('Required for update/delete. The investment ID.'),
      name: z.string().optional().describe('Investment name (e.g. "Apple Inc.")'),
      symbol: z.string().optional().describe('Ticker symbol (e.g. "AAPL")'),
      type: z
        .enum(['stock', 'etf', 'crypto', 'bond', 'mutual_fund', 'other'])
        .optional()
        .describe('Investment type'),
      shares: z.number().optional().describe('Number of shares/units'),
      avgCost: z
        .number()
        .optional()
        .describe('Average cost basis per share in main currency unit'),
      currentPrice: z
        .number()
        .optional()
        .describe('Current price per share (will be saved to price history)'),
      currency: z.string().optional().default('USD').describe('Currency code'),
      accountId: z.string().optional().describe('Link to an account'),
      notes: z.string().optional().describe('Notes about the investment'),
    })
  ),
  execute: async ({ action, investmentId, name, symbol, type, shares, avgCost, currentPrice, currency, accountId, notes }) => {
    if (action === 'add') {
      if (!name || !symbol) {
        return { success: false, message: 'Name and symbol are required when adding an investment.' }
      }

      const id = generateId()
      const avgCostCentavos = avgCost !== undefined ? toCentavos(avgCost) : 0

      await execute(
        `INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, accountId ?? null, symbol.toUpperCase(), name, type ?? 'stock', shares ?? 0, avgCostCentavos, currency, notes ?? null]
      )

      // Save current price if provided
      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = new Date().toISOString().split('T')[0]
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, symbol.toUpperCase(), toCentavos(currentPrice), currency, today]
        )
      }

      return {
        success: true,
        investment: { id, name, symbol: symbol.toUpperCase(), type: type ?? 'stock', shares: shares ?? 0, avgCost: avgCost ?? 0 },
        message: `Added investment: ${name} (${symbol.toUpperCase()}) — ${shares ?? 0} shares at $${(avgCost ?? 0).toFixed(2)} avg cost.`,
      }
    }

    if (action === 'update') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for update.' }
      }

      const existing = await query<Investment>(
        'SELECT * FROM investments WHERE id = $1',
        [investmentId]
      )

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      const inv = existing[0]
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (name !== undefined) { setClauses.push(`name = $${paramIdx++}`); params.push(name) }
      if (symbol !== undefined) { setClauses.push(`symbol = $${paramIdx++}`); params.push(symbol.toUpperCase()) }
      if (type !== undefined) { setClauses.push(`type = $${paramIdx++}`); params.push(type) }
      if (shares !== undefined) { setClauses.push(`shares = $${paramIdx++}`); params.push(shares) }
      if (avgCost !== undefined) { setClauses.push(`avg_cost_basis = $${paramIdx++}`); params.push(toCentavos(avgCost)) }
      if (currency !== undefined) { setClauses.push(`currency = $${paramIdx++}`); params.push(currency) }
      if (accountId !== undefined) { setClauses.push(`account_id = $${paramIdx++}`); params.push(accountId) }
      if (notes !== undefined) { setClauses.push(`notes = $${paramIdx++}`); params.push(notes) }

      if (setClauses.length === 0 && currentPrice === undefined) {
        return { success: false, message: 'No fields to update.' }
      }

      if (setClauses.length > 0) {
        setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        params.push(investmentId)
        await execute(
          `UPDATE investments SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
          params
        )
      }

      // Save current price if provided
      if (currentPrice !== undefined) {
        const priceId = generateId()
        const today = new Date().toISOString().split('T')[0]
        const sym = symbol?.toUpperCase() ?? inv.symbol
        await execute(
          `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, date)
           VALUES ($1, $2, $3, $4, $5)`,
          [priceId, sym, toCentavos(currentPrice), currency ?? inv.currency, today]
        )
      }

      return {
        success: true,
        message: `Updated investment "${name ?? inv.name}".`,
      }
    }

    if (action === 'delete') {
      if (!investmentId) {
        return { success: false, message: 'investmentId is required for delete.' }
      }

      const existing = await query<Investment>(
        'SELECT * FROM investments WHERE id = $1',
        [investmentId]
      )

      if (existing.length === 0) {
        return { success: false, message: `Investment ${investmentId} not found.` }
      }

      await execute('DELETE FROM investments WHERE id = $1', [investmentId])

      return {
        success: true,
        message: `Deleted investment "${existing[0].name}" (${existing[0].symbol}).`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
})
