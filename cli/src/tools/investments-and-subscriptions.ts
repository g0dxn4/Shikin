import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  positiveMoneyAmount,
  isoDate,
  assetCode,
  isAccountWriteEligible,
  resolveAccountId,
  resolveCategoryId,
  normalizeCurrencyCode,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

import { listSubscriptionsSummary, getSubscriptionSpendingSummary } from '../insights.js'
import { getCreditCardBillEntries, type CreditCardBillEntry } from './credit-cards.js'

type InvestmentRow = {
  id: string
  name: string
  symbol: string
  type: InvestmentType
  shares: number
  avg_cost_basis: number
  currency: string
  account_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

const INVESTMENT_TYPES = [
  'stock',
  'etf',
  'crypto',
  'bond',
  'mutual_fund',
  'cetes',
  'other',
] as const
type InvestmentType = (typeof INVESTMENT_TYPES)[number]

type InvestmentWithPriceRow = InvestmentRow & {
  account_name: string | null
  latest_price: number | null
  latest_price_currency: string | null
  latest_price_date: string | null
}

type RecurringBillRow = {
  description: string
  amount: number
  currency: string
  date: string
  count: number
}

type UpcomingBillEntry = {
  name: string
  amount: number
  currency: string
  dueDate: string
  source: string
  daysUntilDue: number
}

type SubscriptionRow = {
  id: string
  account_id: string | null
  category_id: string | null
  name: string
  amount: number
  currency: string
  billing_cycle: 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  next_billing_date: string
  icon: string | null
  color: string | null
  url: string | null
  notes: string | null
  is_active: number
}

type SubscriptionAccountRow = {
  id: string
  currency: string
  is_archived: number
}

type TransactionSubscriptionSourceRow = {
  id: string
  account_id: string | null
  category_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  date: string
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

function subscriptionSnapshot(subscription: SubscriptionRow) {
  return {
    id: subscription.id,
    accountId: subscription.account_id,
    categoryId: subscription.category_id,
    name: subscription.name,
    amount: fromCentavos(subscription.amount),
    amountCentavos: subscription.amount,
    currency: subscription.currency,
    billingCycle: subscription.billing_cycle,
    nextBillingDate: subscription.next_billing_date,
    icon: subscription.icon,
    color: subscription.color,
    url: subscription.url,
    notes: subscription.notes,
    isActive: subscription.is_active === 1,
  }
}

function getSubscription(subscriptionId: string): SubscriptionRow | null {
  const rows = query<SubscriptionRow>('SELECT * FROM subscriptions WHERE id = $1 LIMIT 1', [
    subscriptionId,
  ]) as SubscriptionRow[] | undefined
  return rows?.[0] ?? null
}

function resolveOptionalSubscriptionAccount(accountId?: string, account?: string) {
  if (!accountId && !account) return { success: true as const, id: null, currency: null }
  return resolveAccountId(accountId, account)
}

function getSubscriptionAccount(accountId: string) {
  const account = query<SubscriptionAccountRow>(
    'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  )[0]
  if (!account) return { success: false as const, message: `Account ${accountId} not found.` }
  if (!isAccountWriteEligible(account)) {
    return {
      success: false as const,
      message: `Account ${accountId} is archived. Unarchive it before using it for new writes.`,
    }
  }
  return { success: true as const, id: account.id, currency: account.currency }
}

function resolveOptionalSubscriptionCategory(categoryId?: string, category?: string) {
  if (categoryId) {
    const rows = query<{ id: string; name: string }>(
      'SELECT id, name FROM categories WHERE id = $1 LIMIT 1',
      [categoryId]
    )
    if (rows.length === 0) {
      return { success: false as const, message: `Category ${categoryId} not found.` }
    }
    return { success: true as const, id: rows[0].id, name: rows[0].name }
  }
  return resolveCategoryId(category)
}

function subscriptionCurrencyFailure(accountCurrency: string | null, currency: string) {
  if (!accountCurrency) return null
  return normalizeCurrencyCode(accountCurrency) === normalizeCurrencyCode(currency)
    ? null
    : {
        success: false as const,
        reason: 'subscription_currency_mismatch' as const,
        message: `Subscription currency ${currency} does not match linked account currency ${accountCurrency}. Use an account with matching currency or omit the account link.`,
      }
}

function nextSubscriptionDateFromTransactionDate(
  transactionDate: string,
  billingCycle: SubscriptionRow['billing_cycle']
): string {
  const baseDate = dayjs(transactionDate)
  switch (billingCycle) {
    case 'weekly':
      return baseDate.add(1, 'week').format('YYYY-MM-DD')
    case 'quarterly':
      return baseDate.add(3, 'month').format('YYYY-MM-DD')
    case 'yearly':
      return baseDate.add(1, 'year').format('YYYY-MM-DD')
    case 'monthly':
    default:
      return baseDate.add(1, 'month').format('YYYY-MM-DD')
  }
}

function transactionSourceSnapshot(transactionRow: TransactionSubscriptionSourceRow) {
  return {
    id: transactionRow.id,
    accountId: transactionRow.account_id,
    categoryId: transactionRow.category_id,
    type: transactionRow.type,
    amount: fromCentavos(transactionRow.amount),
    amountCentavos: transactionRow.amount,
    currency: transactionRow.currency,
    description: transactionRow.description,
    notes: transactionRow.notes,
    date: transactionRow.date,
  }
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized || null
}

function normalizeInvestmentSymbol(value: string): string {
  return value.trim().toUpperCase()
}

function redactInvestmentText(value: string | null, redacted: boolean): string | null {
  if (!redacted) return value
  return value === null ? null : '[REDACTED]'
}

function resolveOptionalInvestmentAccount(accountId?: string, account?: string) {
  const normalizedAccountId = normalizeOptionalText(accountId)
  const normalizedAccount = normalizeOptionalText(account)

  if (!normalizedAccountId && !normalizedAccount) {
    return { success: true as const, id: null, currency: null, name: null }
  }

  const resolved = resolveAccountId(
    normalizedAccountId ?? undefined,
    normalizedAccount ?? undefined
  )
  if (!resolved.success) return resolved

  const accountRow = query<{ name: string | null }>(
    'SELECT name FROM accounts WHERE id = $1 LIMIT 1',
    [resolved.id]
  )[0]

  return {
    success: true as const,
    id: resolved.id,
    currency: resolved.currency,
    name: accountRow?.name ?? null,
  }
}

function investmentSnapshot(
  investment: InvestmentWithPriceRow,
  options: { redacted?: boolean } = {}
) {
  const redacted = options.redacted ?? false
  const avgCostCentavos = investment.avg_cost_basis
  const costBasisCentavos = Math.round(investment.shares * investment.avg_cost_basis)
  const currentPriceCentavos = investment.latest_price ?? null
  const marketValueCentavos =
    currentPriceCentavos === null ? null : Math.round(investment.shares * currentPriceCentavos)
  const priceCurrency = investment.latest_price_currency
  const comparableCurrencies =
    priceCurrency !== null &&
    normalizeCurrencyCode(priceCurrency) === normalizeCurrencyCode(investment.currency)
  const gainLossCentavos =
    marketValueCentavos === null || !comparableCurrencies
      ? null
      : marketValueCentavos - costBasisCentavos
  const gainLossPercent =
    gainLossCentavos === null || costBasisCentavos <= 0
      ? null
      : Math.round((gainLossCentavos / costBasisCentavos) * 10000) / 100

  return {
    id: investment.id,
    accountId: investment.account_id,
    accountName: redactInvestmentText(investment.account_name, redacted),
    symbol: investment.symbol,
    name: redactInvestmentText(investment.name, redacted),
    type: investment.type,
    shares: investment.shares,
    avgCost: fromCentavos(avgCostCentavos),
    avgCostCentavos,
    costBasis: fromCentavos(costBasisCentavos),
    costBasisCentavos,
    currency: investment.currency,
    notes: redactInvestmentText(investment.notes, redacted),
    createdAt: investment.created_at,
    updatedAt: investment.updated_at,
    currentPrice: currentPriceCentavos === null ? null : fromCentavos(currentPriceCentavos),
    currentPriceCentavos,
    priceCurrency,
    priceDate: investment.latest_price_date,
    lastPriceDate: investment.latest_price_date,
    marketValue: marketValueCentavos === null ? null : fromCentavos(marketValueCentavos),
    marketValueCentavos,
    gainLoss: gainLossCentavos === null ? null : fromCentavos(gainLossCentavos),
    gainLossCentavos,
    gainLossPercent,
  }
}

function getInvestment(investmentId: string): InvestmentWithPriceRow | null {
  const rows = query<InvestmentWithPriceRow>(
    `SELECT i.id, i.account_id, i.symbol, i.name, i.type, i.shares, i.avg_cost_basis, i.currency, i.notes, i.created_at, i.updated_at,
            a.name as account_name,
            sp.price as latest_price,
            COALESCE(sp.quote_currency, sp.currency) as latest_price_currency,
            sp.date as latest_price_date
     FROM investments i
     LEFT JOIN accounts a ON a.id = i.account_id
     LEFT JOIN (
       SELECT symbol, price, currency, quote_currency, date,
              ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC, created_at DESC, id DESC) as rn
       FROM stock_prices
     ) sp ON sp.symbol = i.symbol AND sp.rn = 1
     WHERE i.id = $1
     LIMIT 1`,
    [investmentId]
  )

  return rows[0] ?? null
}

const manageInvestment: ToolDefinition = {
  name: 'manage-investment',
  description:
    'Add, update, or delete an investment holding. Use this to track US/MX stocks, ETFs, crypto, bonds, CETES, mutual funds, and other investments.',
  schema: z.object({
    action: z.enum(['add', 'update', 'delete']).describe('The action to perform'),
    investmentId: boundedText(
      'Investment ID',
      'Required for update/delete. The investment ID.',
      128
    ).optional(),
    name: boundedText('Investment name', 'Investment name (e.g. "Apple Inc.")', 200).optional(),
    symbol: assetCode('Ticker symbol (e.g. "AAPL")').optional(),
    type: z
      .enum(INVESTMENT_TYPES)
      .optional()
      .describe('Investment type, including CETES for Mexican treasury holdings'),
    shares: z.number().finite().min(0).optional().describe('Number of shares/units'),
    avgCost: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe('Average cost basis per share in main currency unit'),
    currentPrice: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe('Current price per share (will be saved to price history)'),
    currency: assetCode('Currency code').optional(),
    accountId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('Link to an account by ID. Pass an empty string on update to clear.'),
    account: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('Account alias, exact account ID, or exact account name'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Notes about the investment. Pass an empty string on update to clear.'),
    source: boundedText(
      'Source',
      'Automation source or origin label for audit provenance',
      120
    ).optional(),
    note: boundedText('Note', 'Workflow changelog note for audit provenance', 500).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the investment change without writing it'),
  }),
  execute: async ({
    action,
    investmentId,
    name,
    symbol,
    type,
    shares,
    avgCost,
    currentPrice,
    currency,
    accountId,
    account,
    notes,
    source,
    note,
    dryRun,
  }) => {
    if (action === 'add') {
      if (!name || !symbol) {
        return {
          success: false,
          reason: 'missing_required_fields',
          message: 'Name and symbol are required when adding an investment.',
        }
      }

      const id = generateId()
      const normalizedSymbol = normalizeInvestmentSymbol(symbol)
      const resolvedCurrency = normalizeCurrencyCode(currency) || 'USD'
      const avgCostCentavos = avgCost !== undefined ? toCentavos(avgCost) : 0
      const resolvedAccount = resolveOptionalInvestmentAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      const now = dayjs().toISOString()
      const today = dayjs().format('YYYY-MM-DD')
      const priceCentavos = currentPrice !== undefined ? toCentavos(currentPrice) : null
      const investment: InvestmentWithPriceRow = {
        id,
        account_id: resolvedAccount.id,
        account_name: resolvedAccount.name,
        symbol: normalizedSymbol,
        name,
        type: type ?? 'stock',
        shares: shares ?? 0,
        avg_cost_basis: avgCostCentavos,
        currency: resolvedCurrency,
        notes: normalizeOptionalText(notes),
        created_at: now,
        updated_at: now,
        latest_price: priceCentavos,
        latest_price_currency: priceCentavos === null ? null : resolvedCurrency,
        latest_price_date: priceCentavos === null ? null : today,
      }
      const snapshot = investmentSnapshot(investment)

      if (dryRun) {
        return {
          success: true,
          action: 'added' as const,
          dryRun: true,
          wouldCreate: snapshot,
          message: `Dry run: investment ${name} (${normalizedSymbol}) would be added.`,
        }
      }

      transaction(() => {
        execute(
          `INSERT INTO investments (id, account_id, symbol, name, type, shares, avg_cost_basis, currency, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id,
            investment.account_id,
            investment.symbol,
            investment.name,
            investment.type,
            investment.shares,
            investment.avg_cost_basis,
            investment.currency,
            investment.notes,
            investment.created_at,
            investment.updated_at,
          ]
        )

        if (priceCentavos !== null) {
          execute(
            `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, quote_currency, date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              generateId(),
              investment.symbol,
              priceCentavos,
              investment.currency,
              investment.currency,
              today,
              now,
            ]
          )
        }

        writeAuditLog({
          entity: 'investment',
          entityId: id,
          action: 'add',
          before: null,
          after: { investment: snapshot },
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'added' as const,
        dryRun: false,
        investment: snapshot,
        message: `Added investment: ${name} (${normalizedSymbol}) — ${shares ?? 0} shares at ${resolvedCurrency} ${(avgCost ?? 0).toFixed(2)} avg cost.`,
      }
    }

    if (action === 'update') {
      if (!investmentId) {
        return {
          success: false,
          reason: 'investment_id_required',
          message: 'investmentId is required for update.',
        }
      }

      const existing = getInvestment(investmentId)
      if (!existing) {
        return {
          success: false,
          reason: 'investment_not_found',
          message: `Investment ${investmentId} not found.`,
        }
      }

      const accountWasProvided = accountId !== undefined || account !== undefined
      const resolvedAccount = accountWasProvided
        ? resolveOptionalInvestmentAccount(accountId, account)
        : null
      if (resolvedAccount && !resolvedAccount.success) return resolvedAccount

      const normalizedSymbol =
        symbol !== undefined ? normalizeInvestmentSymbol(symbol) : existing.symbol
      const symbolChanged = normalizedSymbol !== existing.symbol
      const resolvedCurrency =
        currency !== undefined ? normalizeCurrencyCode(currency) : existing.currency
      const investmentFieldsChanged =
        name !== undefined ||
        symbol !== undefined ||
        type !== undefined ||
        shares !== undefined ||
        avgCost !== undefined ||
        currency !== undefined ||
        accountWasProvided ||
        notes !== undefined

      if (!investmentFieldsChanged && currentPrice === undefined) {
        return {
          success: false,
          reason: 'no_investment_changes',
          message: 'No fields to update.',
        }
      }

      const now = dayjs().toISOString()
      const today = dayjs().format('YYYY-MM-DD')
      const priceCentavos = currentPrice !== undefined ? toCentavos(currentPrice) : null
      const updated: InvestmentWithPriceRow = {
        ...existing,
        account_id:
          resolvedAccount && resolvedAccount.success ? resolvedAccount.id : existing.account_id,
        account_name:
          resolvedAccount && resolvedAccount.success ? resolvedAccount.name : existing.account_name,
        symbol: normalizedSymbol,
        name: name ?? existing.name,
        type: type ?? existing.type,
        shares: shares ?? existing.shares,
        avg_cost_basis: avgCost !== undefined ? toCentavos(avgCost) : existing.avg_cost_basis,
        currency: resolvedCurrency,
        notes: notes !== undefined ? normalizeOptionalText(notes) : existing.notes,
        updated_at: investmentFieldsChanged ? now : existing.updated_at,
        latest_price:
          priceCentavos !== null ? priceCentavos : symbolChanged ? null : existing.latest_price,
        latest_price_currency:
          priceCentavos !== null
            ? resolvedCurrency
            : symbolChanged
              ? null
              : existing.latest_price_currency,
        latest_price_date:
          priceCentavos !== null ? today : symbolChanged ? null : existing.latest_price_date,
      }
      const beforeSnapshot = investmentSnapshot(existing)
      const afterSnapshot = investmentSnapshot(updated)
      const setClauses: string[] = []
      const params: unknown[] = []
      let paramIdx = 1

      if (name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`)
        params.push(name)
      }
      if (symbol !== undefined) {
        setClauses.push(`symbol = $${paramIdx++}`)
        params.push(updated.symbol)
      }
      if (type !== undefined) {
        setClauses.push(`type = $${paramIdx++}`)
        params.push(updated.type)
      }
      if (shares !== undefined) {
        setClauses.push(`shares = $${paramIdx++}`)
        params.push(updated.shares)
      }
      if (avgCost !== undefined) {
        setClauses.push(`avg_cost_basis = $${paramIdx++}`)
        params.push(updated.avg_cost_basis)
      }
      if (currency !== undefined) {
        setClauses.push(`currency = $${paramIdx++}`)
        params.push(updated.currency)
      }
      if (accountWasProvided) {
        setClauses.push(`account_id = $${paramIdx++}`)
        params.push(updated.account_id)
      }
      if (notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`)
        params.push(updated.notes)
      }

      if (dryRun) {
        return {
          success: true,
          action: 'updated' as const,
          dryRun: true,
          wouldUpdate: {
            investmentId,
            before: beforeSnapshot,
            after: afterSnapshot,
          },
          message: `Dry run: investment "${updated.name}" would be updated.`,
        }
      }

      transaction(() => {
        if (setClauses.length > 0) {
          setClauses.push(`updated_at = $${paramIdx++}`)
          params.push(updated.updated_at)
          params.push(investmentId)
          const updateResult = execute(
            `UPDATE investments SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
            params
          )
          assertSingleRowUpdated(
            updateResult,
            `Investment ${investmentId} could not be updated safely.`
          )
        }

        if (priceCentavos !== null) {
          execute(
            `INSERT OR REPLACE INTO stock_prices (id, symbol, price, currency, quote_currency, date, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              generateId(),
              updated.symbol,
              priceCentavos,
              updated.currency,
              updated.currency,
              today,
              now,
            ]
          )
        }

        writeAuditLog({
          entity: 'investment',
          entityId: investmentId,
          action: 'update',
          before: { investment: beforeSnapshot },
          after: { investment: afterSnapshot },
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'updated' as const,
        dryRun: false,
        investment: afterSnapshot,
        message: `Updated investment "${updated.name}".`,
      }
    }

    if (action === 'delete') {
      if (!investmentId) {
        return {
          success: false,
          reason: 'investment_id_required',
          message: 'investmentId is required for delete.',
        }
      }

      const existing = getInvestment(investmentId)
      if (!existing) {
        return {
          success: false,
          reason: 'investment_not_found',
          message: `Investment ${investmentId} not found.`,
        }
      }
      const beforeSnapshot = investmentSnapshot(existing)

      if (dryRun) {
        return {
          success: true,
          action: 'deleted' as const,
          dryRun: true,
          wouldDelete: beforeSnapshot,
          message: `Dry run: investment "${existing.name}" (${existing.symbol}) would be deleted.`,
        }
      }

      transaction(() => {
        const deleteResult = execute('DELETE FROM investments WHERE id = $1', [investmentId])
        assertSingleRowUpdated(
          deleteResult,
          `Investment ${investmentId} could not be deleted safely.`
        )
        writeAuditLog({
          entity: 'investment',
          entityId: investmentId,
          action: 'delete',
          before: { investment: beforeSnapshot },
          after: null,
          source: source ?? null,
          note: note ?? null,
        })
      })

      return {
        success: true,
        action: 'deleted' as const,
        dryRun: false,
        investment: beforeSnapshot,
        message: `Deleted investment "${existing.name}" (${existing.symbol}).`,
      }
    }

    return { success: false, message: `Unknown action: ${action}` }
  },
}

const listInvestments: ToolDefinition = {
  name: 'list-investments',
  description:
    'List investment holdings with optional type, account, symbol, and text filters. Returns stable holding snapshots for CLI and MCP automation.',
  schema: z.object({
    type: z.enum(INVESTMENT_TYPES).optional().describe('Filter by investment type'),
    accountId: boundedText('Account ID', 'Filter by linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Filter by account alias, exact account ID, or exact account name',
      128
    ).optional(),
    symbol: assetCode('Filter by exact ticker symbol').optional(),
    search: boundedText('Search term', 'Search symbol, investment name, or notes', 200).optional(),
    redacted: z
      .boolean()
      .optional()
      .default(false)
      .describe('Redact investment names, account names, and notes in output'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  execute: async ({ type, accountId, account, symbol, search, redacted, limit }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    let resolvedAccountId: string | null = null

    if (type) {
      conditions.push(`i.type = $${paramIdx++}`)
      params.push(type)
    }

    if (accountId || account) {
      const resolvedAccount = resolveOptionalInvestmentAccount(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      resolvedAccountId = resolvedAccount.id
      conditions.push(`i.account_id = $${paramIdx++}`)
      params.push(resolvedAccount.id)
    }

    if (symbol) {
      conditions.push(`i.symbol = $${paramIdx++}`)
      params.push(normalizeInvestmentSymbol(symbol))
    }

    if (search) {
      const searchPattern = `%${search}%`
      conditions.push(
        `(LOWER(i.symbol) LIKE LOWER($${paramIdx}) OR LOWER(i.name) LIKE LOWER($${paramIdx}) OR LOWER(COALESCE(i.notes, '')) LIKE LOWER($${paramIdx}))`
      )
      params.push(searchPattern, searchPattern, searchPattern)
      paramIdx++
    }

    params.push(limit)
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const investments = query<InvestmentWithPriceRow>(
      `SELECT i.id, i.account_id, i.symbol, i.name, i.type, i.shares, i.avg_cost_basis, i.currency, i.notes, i.created_at, i.updated_at,
              a.name as account_name,
              sp.price as latest_price,
              COALESCE(sp.quote_currency, sp.currency) as latest_price_currency,
              sp.date as latest_price_date
       FROM investments i
       LEFT JOIN accounts a ON a.id = i.account_id
       LEFT JOIN (
         SELECT symbol, price, currency, quote_currency, date,
                ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY date DESC, created_at DESC, id DESC) as rn
         FROM stock_prices
       ) sp ON sp.symbol = i.symbol AND sp.rn = 1
       ${whereClause}
       ORDER BY i.symbol ASC, i.id ASC
       LIMIT $${paramIdx}`,
      params
    )

    const snapshots = investments.map((investment) => investmentSnapshot(investment, { redacted }))
    return {
      success: true,
      investments: snapshots,
      count: snapshots.length,
      redacted,
      filters: {
        type: type ?? null,
        accountId: resolvedAccountId,
        symbol: symbol ? normalizeInvestmentSymbol(symbol) : null,
        search: search ?? null,
      },
      message:
        snapshots.length === 0
          ? 'No investments found.'
          : `Found ${snapshots.length} investment${snapshots.length === 1 ? '' : 's'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 22. get-upcoming-bills
// ---------------------------------------------------------------------------

const getUpcomingBills: ToolDefinition = {
  name: 'get-upcoming-bills',
  description:
    'Get upcoming bills from credit card due dates and recurring transactions. Returns a sorted list of bills due within the specified number of days.',
  schema: z.object({
    daysAhead: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .default(30)
      .describe('Number of days to look ahead (default: 30)'),
  }),
  execute: async ({ daysAhead }) => {
    const today = dayjs()
    const cutoff = today.add(daysAhead, 'day')
    const bills: Array<CreditCardBillEntry | UpcomingBillEntry> = []

    bills.push(...getCreditCardBillEntries(daysAhead))

    // Recurring transactions
    const recurringTx = await query<RecurringBillRow>(
      `SELECT description, amount, currency, MAX(date) as date, COUNT(*) as count
       FROM transactions
       WHERE is_recurring = 1 AND type = 'expense'
          AND COALESCE(reporting_treatment, 'normal') = 'normal'
          AND COALESCE(is_archived, 0) = 0
          AND date >= $1
         AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
       GROUP BY description, amount
       HAVING count >= 1
       ORDER BY date DESC`,
      [today.subtract(60, 'day').format('YYYY-MM-DD')]
    )

    for (const tx of recurringTx) {
      const lastDate = dayjs(tx.date)
      const estimatedNext = lastDate.add(30, 'day')
      if (
        (estimatedNext.isAfter(today) || estimatedNext.isSame(today, 'day')) &&
        (estimatedNext.isBefore(cutoff) || estimatedNext.isSame(cutoff, 'day'))
      ) {
        const isDuplicate = bills.some(
          (b) =>
            b.name.toLowerCase() === tx.description.toLowerCase() &&
            Math.abs(b.amount - fromCentavos(tx.amount)) < 1
        )
        if (!isDuplicate) {
          bills.push({
            name: tx.description,
            amount: fromCentavos(tx.amount),
            currency: tx.currency,
            dueDate: estimatedNext.format('YYYY-MM-DD'),
            source: 'recurring',
            daysUntilDue: estimatedNext.diff(today, 'day'),
          })
        }
      }
    }

    bills.sort((a, b) => a.daysUntilDue - b.daysUntilDue)

    const totalDue = bills.reduce((sum, b) => sum + b.amount, 0)

    return {
      success: true,
      bills,
      summary: {
        count: bills.length,
        totalAmount: Math.round(totalDue * 100) / 100,
        daysAhead,
        bySource: {
          creditCard: bills.filter((b) => b.source === 'credit_card').length,
          subscription: bills.filter((b) => b.source === 'subscription').length,
          recurring: bills.filter((b) => b.source === 'recurring').length,
        },
      },
      message:
        bills.length === 0
          ? `No upcoming bills in the next ${daysAhead} days.`
          : `${bills.length} upcoming bill(s) in the next ${daysAhead} days, totaling $${totalDue.toFixed(2)}.`,
    }
  },
}

const createSubscription: ToolDefinition = {
  name: 'create-subscription',
  description:
    'Create a subscription with optional account/category resolution and a dry-run preview.',
  schema: z.object({
    name: boundedText('Subscription name', 'Subscription name', 160),
    amount: positiveMoneyAmount('Subscription amount in the main currency unit'),
    billingCycle: z
      .enum(['weekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('Billing cycle'),
    nextBillingDate: isoDate('Next billing date in YYYY-MM-DD format'),
    currency: assetCode(
      'Currency or asset code. Defaults to the linked account currency or USD'
    ).optional(),
    accountId: boundedText('Account ID', 'Optional linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional linked account alias, exact account ID, or exact account name',
      128
    ).optional(),
    categoryId: boundedText('Category ID', 'Optional linked category ID', 128).optional(),
    category: boundedText('Category', 'Optional category name to resolve', 120).optional(),
    icon: boundedText('Icon', 'Optional icon name', 80).optional(),
    color: boundedText('Color', 'Optional display color', 80).optional(),
    url: z.string().trim().max(500).optional().describe('Optional subscription URL'),
    notes: z.string().trim().max(1000).optional().describe('Optional notes'),
    active: z.boolean().optional().default(true).describe('Whether the subscription is active'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription without writing it'),
  }),
  execute: async ({
    name,
    amount,
    billingCycle,
    nextBillingDate,
    currency,
    accountId,
    account,
    categoryId,
    category,
    icon,
    color,
    url,
    notes,
    active,
    dryRun,
  }) => {
    const resolvedAccount = resolveOptionalSubscriptionAccount(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount
    const resolvedCategory = resolveOptionalSubscriptionCategory(categoryId, category)
    if (!resolvedCategory.success) return resolvedCategory

    const resolvedCurrency = currency ?? resolvedAccount.currency ?? 'USD'
    const currencyFailure = subscriptionCurrencyFailure(resolvedAccount.currency, resolvedCurrency)
    if (currencyFailure) return currencyFailure

    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const subscription: SubscriptionRow = {
      id,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name,
      amount: amountCentavos,
      currency: resolvedCurrency,
      billing_cycle: billingCycle,
      next_billing_date: nextBillingDate,
      icon: icon ?? null,
      color: color ?? null,
      url: url ?? null,
      notes: notes ?? null,
      is_active: active ? 1 : 0,
    }

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreate: subscriptionSnapshot(subscription),
        message: `Dry run: subscription "${name}" would be created.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO subscriptions (id, account_id, category_id, name, amount, currency, billing_cycle, next_billing_date, icon, color, url, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          subscription.account_id,
          subscription.category_id,
          name,
          amountCentavos,
          resolvedCurrency,
          billingCycle,
          nextBillingDate,
          icon ?? null,
          color ?? null,
          url ?? null,
          notes ?? null,
          active ? 1 : 0,
        ]
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: id,
        action: 'create',
        before: null,
        after: { subscription: subscriptionSnapshot(subscription) },
      })
    })

    return {
      success: true,
      action: 'created' as const,
      dryRun: false,
      subscription: subscriptionSnapshot(subscription),
      message: `Created subscription "${name}".`,
    }
  },
}

const createSubscriptionFromTransaction: ToolDefinition = {
  name: 'create-subscription-from-transaction',
  description:
    'Create a subscription using an existing transaction as the default source for amount, account, category, name, and currency.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Transaction to use as subscription source', 128),
    name: boundedText(
      'Subscription name',
      'Optional subscription name. Defaults to transaction description',
      160
    ).optional(),
    billingCycle: z
      .enum(['weekly', 'monthly', 'quarterly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('Billing cycle'),
    nextDate: isoDate('Next billing date in YYYY-MM-DD format').optional(),
    nextBillingDate: isoDate('Next billing date in YYYY-MM-DD format').optional(),
    amount: positiveMoneyAmount(
      'Subscription amount override in the main currency unit'
    ).optional(),
    accountId: boundedText('Account ID', 'Optional linked account ID override', 128).optional(),
    account: boundedText(
      'Account reference',
      'Optional linked account alias, exact account ID, or exact account name override',
      128
    ).optional(),
    categoryId: boundedText('Category ID', 'Optional linked category ID override', 128).optional(),
    category: boundedText('Category', 'Optional category name override', 120).optional(),
    notes: z.string().trim().max(1000).optional().describe('Optional subscription notes'),
    source: boundedText(
      'Source',
      'Automation source or origin label for audit provenance',
      120
    ).optional(),
    note: boundedText('Note', 'Workflow changelog note for audit provenance', 500).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription without writing it'),
  }),
  execute: async ({
    transactionId,
    name,
    billingCycle,
    nextDate,
    nextBillingDate,
    amount,
    accountId,
    account,
    categoryId,
    category,
    notes,
    source,
    note,
    dryRun,
  }) => {
    if (nextDate && nextBillingDate && nextDate !== nextBillingDate) {
      return {
        success: false,
        reason: 'conflicting_next_billing_date',
        message: 'Use either nextDate or nextBillingDate, not both with different values.',
      }
    }

    const sourceRows = query<TransactionSubscriptionSourceRow>(
      'SELECT id, account_id, category_id, type, amount, currency, description, notes, date FROM transactions WHERE id = $1 LIMIT 1',
      [transactionId]
    )
    if (sourceRows.length === 0) {
      return {
        success: false,
        reason: 'transaction_not_found',
        message: `Transaction ${transactionId} not found.`,
      }
    }

    const sourceTransaction = sourceRows[0]
    if (sourceTransaction.type === 'transfer') {
      return {
        success: false,
        reason: 'subscription_transaction_type_unsupported',
        message: 'Transfer transactions cannot be converted into subscriptions.',
      }
    }
    if (!sourceTransaction.currency) {
      return {
        success: false,
        reason: 'transaction_currency_missing',
        message: `Transaction ${transactionId} has no currency. Repair it before creating a subscription from it.`,
      }
    }

    const resolvedAccount =
      accountId || account
        ? resolveOptionalSubscriptionAccount(accountId, account)
        : sourceTransaction.account_id
          ? getSubscriptionAccount(sourceTransaction.account_id)
          : { success: true as const, id: null, currency: null }
    if (!resolvedAccount.success) return resolvedAccount

    const resolvedCategory =
      categoryId || category
        ? resolveOptionalSubscriptionCategory(categoryId, category)
        : { success: true as const, id: sourceTransaction.category_id, name: null }
    if (!resolvedCategory.success) return resolvedCategory

    const currencyFailure = subscriptionCurrencyFailure(
      resolvedAccount.currency,
      sourceTransaction.currency
    )
    if (currencyFailure) return currencyFailure

    const id = generateId()
    const amountCentavos = amount !== undefined ? toCentavos(amount) : sourceTransaction.amount
    const resolvedNextBillingDate =
      nextDate ??
      nextBillingDate ??
      nextSubscriptionDateFromTransactionDate(sourceTransaction.date, billingCycle)
    const subscription: SubscriptionRow = {
      id,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name: name ?? sourceTransaction.description,
      amount: amountCentavos,
      currency: sourceTransaction.currency,
      billing_cycle: billingCycle,
      next_billing_date: resolvedNextBillingDate,
      icon: null,
      color: null,
      url: null,
      notes: notes ?? sourceTransaction.notes,
      is_active: 1,
    }
    const sourceSnapshot = transactionSourceSnapshot(sourceTransaction)
    const subscriptionOutput = subscriptionSnapshot(subscription)

    if (dryRun) {
      return {
        success: true,
        action: 'created' as const,
        dryRun: true,
        wouldCreateSubscription: subscriptionOutput,
        wouldLinkTransactionId: transactionId,
        sourceTransaction: sourceSnapshot,
        message: `Dry run: subscription "${subscription.name}" would be created from transaction ${transactionId}.`,
      }
    }

    transaction(() => {
      execute(
        `INSERT INTO subscriptions (id, account_id, category_id, name, amount, currency, billing_cycle, next_billing_date, icon, color, url, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          id,
          subscription.account_id,
          subscription.category_id,
          subscription.name,
          subscription.amount,
          subscription.currency,
          subscription.billing_cycle,
          subscription.next_billing_date,
          subscription.icon,
          subscription.color,
          subscription.url,
          subscription.notes,
          subscription.is_active,
        ]
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: id,
        action: 'create-from-transaction',
        before: { transaction: sourceSnapshot },
        after: { subscription: subscriptionOutput, linkedTransactionId: transactionId },
        source: source ?? null,
        note: note ?? null,
      })
    })

    return {
      success: true,
      action: 'created' as const,
      dryRun: false,
      subscription: subscriptionOutput,
      linkedTransactionId: transactionId,
      sourceTransaction: sourceSnapshot,
      message: `Created subscription "${subscription.name}" from transaction ${transactionId}.`,
    }
  },
}

const updateSubscription: ToolDefinition = {
  name: 'update-subscription',
  description:
    'Update a subscription by ID with optional account/category resolution and a dry-run preview.',
  schema: z.object({
    subscriptionId: boundedText('Subscription ID', 'Subscription ID to update', 128),
    name: boundedText('Subscription name', 'New subscription name', 160).optional(),
    amount: positiveMoneyAmount('New subscription amount in the main currency unit').optional(),
    billingCycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).optional(),
    nextBillingDate: isoDate('New next billing date in YYYY-MM-DD format').optional(),
    currency: assetCode('New currency or asset code').optional(),
    accountId: boundedText('Account ID', 'New linked account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'New linked account alias, exact account ID, or exact account name',
      128
    ).optional(),
    clearAccount: z.boolean().optional().default(false).describe('Clear the linked account'),
    categoryId: boundedText('Category ID', 'New linked category ID', 128).optional(),
    category: boundedText('Category', 'New category name to resolve', 120).optional(),
    clearCategory: z.boolean().optional().default(false).describe('Clear the linked category'),
    icon: z.string().trim().max(80).optional().describe('New icon. Pass an empty string to clear.'),
    color: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe('New color. Pass an empty string to clear.'),
    url: z.string().trim().max(500).optional().describe('New URL. Pass an empty string to clear.'),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('New notes. Pass an empty string to clear.'),
    active: z.boolean().optional().describe('Whether the subscription is active'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription update without writing it'),
  }),
  execute: async ({
    subscriptionId,
    name,
    amount,
    billingCycle,
    nextBillingDate,
    currency,
    accountId,
    account,
    clearAccount,
    categoryId,
    category,
    clearCategory,
    icon,
    color,
    url,
    notes,
    active,
    dryRun,
  }) => {
    const existing = getSubscription(subscriptionId)
    if (!existing) {
      return {
        success: false,
        reason: 'subscription_not_found',
        message: `Subscription ${subscriptionId} not found.`,
      }
    }

    if (clearAccount && (accountId || account)) {
      return { success: false, message: 'Use either clearAccount or account/accountId, not both.' }
    }
    if (clearCategory && (categoryId || category)) {
      return {
        success: false,
        message: 'Use either clearCategory or category/categoryId, not both.',
      }
    }

    const resolvedAccount = clearAccount
      ? { success: true as const, id: null, currency: null }
      : accountId || account
        ? resolveOptionalSubscriptionAccount(accountId, account)
        : existing.account_id
          ? getSubscriptionAccount(existing.account_id)
          : { success: true as const, id: null, currency: null }
    if (!resolvedAccount.success) return resolvedAccount

    const resolvedCategory = clearCategory
      ? { success: true as const, id: null, name: null }
      : categoryId || category
        ? resolveOptionalSubscriptionCategory(categoryId, category)
        : { success: true as const, id: existing.category_id, name: null }
    if (!resolvedCategory.success) return resolvedCategory

    const nextCurrency = currency ?? existing.currency
    const accountCurrency = resolvedAccount.currency
    const currencyFailure = subscriptionCurrencyFailure(accountCurrency, nextCurrency)
    if (currencyFailure) return currencyFailure

    const updated: SubscriptionRow = {
      ...existing,
      account_id: resolvedAccount.id,
      category_id: resolvedCategory.id,
      name: name ?? existing.name,
      amount: amount !== undefined ? toCentavos(amount) : existing.amount,
      currency: nextCurrency,
      billing_cycle: billingCycle ?? existing.billing_cycle,
      next_billing_date: nextBillingDate ?? existing.next_billing_date,
      icon: icon !== undefined ? (icon === '' ? null : icon) : existing.icon,
      color: color !== undefined ? (color === '' ? null : color) : existing.color,
      url: url !== undefined ? (url === '' ? null : url) : existing.url,
      notes: notes !== undefined ? (notes === '' ? null : notes) : existing.notes,
      is_active: active !== undefined ? (active ? 1 : 0) : existing.is_active,
    }

    const setClauses: string[] = []
    const params: unknown[] = []
    let paramIdx = 1
    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${paramIdx++}`)
      params.push(value)
    }

    if (updated.account_id !== existing.account_id) addSet('account_id', updated.account_id)
    if (updated.category_id !== existing.category_id) addSet('category_id', updated.category_id)
    if (updated.name !== existing.name) addSet('name', updated.name)
    if (updated.amount !== existing.amount) addSet('amount', updated.amount)
    if (normalizeCurrencyCode(updated.currency) !== normalizeCurrencyCode(existing.currency)) {
      addSet('currency', updated.currency)
    }
    if (updated.billing_cycle !== existing.billing_cycle)
      addSet('billing_cycle', updated.billing_cycle)
    if (updated.next_billing_date !== existing.next_billing_date) {
      addSet('next_billing_date', updated.next_billing_date)
    }
    if (updated.icon !== existing.icon) addSet('icon', updated.icon)
    if (updated.color !== existing.color) addSet('color', updated.color)
    if (updated.url !== existing.url) addSet('url', updated.url)
    if (updated.notes !== existing.notes) addSet('notes', updated.notes)
    if (updated.is_active !== existing.is_active) addSet('is_active', updated.is_active)

    if (setClauses.length === 0) {
      return {
        success: true,
        action: 'updated' as const,
        ...(dryRun ? { dryRun: true } : {}),
        changed: false,
        subscription: subscriptionSnapshot(existing),
        message: dryRun
          ? `Dry run: subscription "${existing.name}" already matches the requested values.`
          : `Subscription "${existing.name}" already matches the requested values.`,
      }
    }

    if (dryRun) {
      return {
        success: true,
        action: 'updated' as const,
        dryRun: true,
        changed: true,
        wouldUpdate: {
          subscriptionId,
          before: subscriptionSnapshot(existing),
          after: subscriptionSnapshot(updated),
        },
        message: `Dry run: subscription "${updated.name}" would be updated.`,
      }
    }

    transaction(() => {
      setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      params.push(subscriptionId)
      const updateResult = execute(
        `UPDATE subscriptions SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
        params
      )
      assertSingleRowUpdated(
        updateResult,
        `Subscription ${subscriptionId} could not be updated safely.`
      )
      writeAuditLog({
        entity: 'subscription',
        entityId: subscriptionId,
        action: 'update',
        before: { subscription: subscriptionSnapshot(existing) },
        after: { subscription: subscriptionSnapshot(updated) },
      })
    })

    return {
      success: true,
      action: 'updated' as const,
      changed: true,
      subscription: subscriptionSnapshot(updated),
      message: `Updated subscription "${updated.name}".`,
    }
  },
}

const deleteSubscription: ToolDefinition = {
  name: 'delete-subscription',
  description: 'Delete a subscription by ID with a dry-run preview.',
  schema: z.object({
    subscriptionId: boundedText('Subscription ID', 'Subscription ID to delete', 128),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the subscription deletion without writing it'),
  }),
  execute: async ({ subscriptionId, dryRun }) => {
    const existing = getSubscription(subscriptionId)
    if (!existing) {
      return {
        success: false,
        reason: 'subscription_not_found',
        message: `Subscription ${subscriptionId} not found.`,
      }
    }

    if (dryRun) {
      return {
        success: true,
        action: 'deleted' as const,
        dryRun: true,
        wouldDelete: subscriptionSnapshot(existing),
        message: `Dry run: subscription "${existing.name}" would be deleted.`,
      }
    }

    transaction(() => {
      execute('DELETE FROM subscriptions WHERE id = $1', [subscriptionId])
      writeAuditLog({
        entity: 'subscription',
        entityId: subscriptionId,
        action: 'delete',
        before: { subscription: subscriptionSnapshot(existing) },
        after: null,
      })
    })

    return {
      success: true,
      action: 'deleted' as const,
      subscription: subscriptionSnapshot(existing),
      message: `Deleted subscription "${existing.name}".`,
    }
  },
}

// ---------------------------------------------------------------------------
// 23. list-subscriptions
// ---------------------------------------------------------------------------

const listSubscriptions: ToolDefinition = {
  name: 'list-subscriptions',
  description:
    'List subscriptions stored in Shikin. Shows amounts, billing cycles, next payment dates, and monthly/yearly cost equivalents.',
  schema: z.object({
    activeOnly: z
      .boolean()
      .optional()
      .default(true)
      .describe('Only show active subscriptions (default: true)'),
  }),
  execute: async ({ activeOnly }) => listSubscriptionsSummary(activeOnly),
}

// ---------------------------------------------------------------------------
// 24. get-subscription-spending
// ---------------------------------------------------------------------------

const getSubscriptionSpending: ToolDefinition = {
  name: 'get-subscription-spending',
  description:
    'Analyze subscription spending from Shikin data. Groups active subscriptions by category and billing cycle with monthly/yearly totals.',
  schema: z.object({}),
  execute: async () => getSubscriptionSpendingSummary(),
}

// ---------------------------------------------------------------------------
// 25. write-notebook
// ---------------------------------------------------------------------------

export const investmentsandsubscriptionsTools: ToolDefinition[] = [
  manageInvestment,
  listInvestments,
  getUpcomingBills,
  createSubscription,
  createSubscriptionFromTransaction,
  updateSubscription,
  deleteSubscription,
  listSubscriptions,
  getSubscriptionSpending,
]
