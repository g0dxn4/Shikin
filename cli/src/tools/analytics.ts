import {
  z,
  query,
  fromCentavos,
  dayjs,
  getDistinctCurrencies,
  getCategoryIdentity,
  missingCurrencyRepairFailure,
  hasMissingCurrency,
  type ToolDefinition,
} from './shared.js'

type AccountBalanceRow = {
  id: string
  name: string
  type: string
  currency: string
  balance: number
}

const getBalanceOverview: ToolDefinition = {
  name: 'get-balance-overview',
  description:
    'Get a complete balance overview including total balance, per-account breakdown, and month-over-month change.',
  schema: z.object({}),
  execute: async () => {
    const accounts = await query<AccountBalanceRow>(
      'SELECT * FROM accounts WHERE is_archived = 0 ORDER BY name'
    )
    const balanceCurrencies = getDistinctCurrencies(accounts)
    const totalsByCurrency = balanceCurrencies.map((currency) => ({
      currency,
      totalBalance: fromCentavos(
        accounts
          .filter((account) => account.currency === currency)
          .reduce((sum, account) => sum + account.balance, 0)
      ),
    }))

    const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const currentMonthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

    const currentMonth = await query<{
      currency: string
      total_income: number
      total_expenses: number
    }>(
      `SELECT
         t.currency,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as total_expenses
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.is_archived = 0 AND t.date >= $1 AND t.date <= $2
       GROUP BY t.currency`,
      [currentMonthStart, currentMonthEnd]
    )

    const prevMonthStart = dayjs().subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
    const prevMonthEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

    const prevMonth = await query<{
      currency: string
      total_income: number
      total_expenses: number
    }>(
      `SELECT
         t.currency,
         COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END), 0) as total_income,
         COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END), 0) as total_expenses
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.is_archived = 0 AND t.date >= $1 AND t.date <= $2
       GROUP BY t.currency`,
      [prevMonthStart, prevMonthEnd]
    )

    if (hasMissingCurrency([...accounts, ...currentMonth, ...prevMonth])) {
      return missingCurrencyRepairFailure('Balance overview')
    }

    const monthCurrencies = getDistinctCurrencies([...currentMonth, ...prevMonth, ...accounts])
    const monthlyChangeByCurrency = monthCurrencies.map((currency) => {
      const currentNet =
        (currentMonth.find((row) => row.currency === currency)?.total_income || 0) -
        (currentMonth.find((row) => row.currency === currency)?.total_expenses || 0)
      const previousNet =
        (prevMonth.find((row) => row.currency === currency)?.total_income || 0) -
        (prevMonth.find((row) => row.currency === currency)?.total_expenses || 0)

      let trend: 'up' | 'down' | 'stable' = 'stable'
      if (currentNet > previousNet) trend = 'up'
      else if (currentNet < previousNet) trend = 'down'

      return {
        currency,
        current: fromCentavos(currentNet),
        previous: fromCentavos(previousNet),
        trend,
      }
    })
    const normalizedMonthlyChangeByCurrency =
      totalsByCurrency.length === 1 && monthlyChangeByCurrency.length === 0
        ? [
            {
              currency: totalsByCurrency[0].currency,
              current: 0,
              previous: 0,
              trend: 'stable' as const,
            },
          ]
        : monthlyChangeByCurrency
    const singleBalanceCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null
    const singleMonthlyChangeCandidate =
      normalizedMonthlyChangeByCurrency.length === 1 ? normalizedMonthlyChangeByCurrency[0] : null
    const singleMonthlyChange =
      singleBalanceCurrency &&
      singleMonthlyChangeCandidate &&
      singleBalanceCurrency.currency === singleMonthlyChangeCandidate.currency
        ? singleMonthlyChangeCandidate
        : null

    return {
      mixedCurrency:
        balanceCurrencies.length > 1 ||
        monthCurrencies.length > 1 ||
        Boolean(
          singleBalanceCurrency &&
          singleMonthlyChangeCandidate &&
          singleBalanceCurrency.currency !== singleMonthlyChangeCandidate.currency
        ),
      totalBalance: singleBalanceCurrency?.totalBalance ?? null,
      totalsByCurrency,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        currency: a.currency,
        balance: fromCentavos(a.balance),
      })),
      monthlyChange: {
        current: singleMonthlyChange?.current ?? null,
        previous: singleMonthlyChange?.previous ?? null,
        trend: singleMonthlyChange?.trend ?? null,
      },
      monthlyChangeByCurrency: normalizedMonthlyChangeByCurrency,
      message:
        accounts.length === 0
          ? 'No accounts found. Create an account to get started.'
          : singleBalanceCurrency && singleMonthlyChange
            ? `Total balance: ${singleBalanceCurrency.currency} ${singleBalanceCurrency.totalBalance.toFixed(2)} across ${accounts.length} account${accounts.length !== 1 ? 's' : ''}. This month's net: ${singleBalanceCurrency.currency} ${singleMonthlyChange.current.toFixed(2)} (${singleMonthlyChange.trend} vs last month).`
            : `Found ${accounts.length} account${accounts.length !== 1 ? 's' : ''} across ${Math.max(totalsByCurrency.length, monthlyChangeByCurrency.length)} currencies. See totalsByCurrency and monthlyChangeByCurrency for per-currency balances and net changes; no FX conversion was applied.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 12. analyze-spending-trends
// ---------------------------------------------------------------------------
const analyzeSpendingTrends: ToolDefinition = {
  name: 'analyze-spending-trends',
  description:
    'Analyze spending trends over multiple months with category breakdowns and trend detection.',
  schema: z.object({
    months: z
      .number()
      .int()
      .min(2)
      .max(12)
      .optional()
      .default(3)
      .describe('Number of months to analyze (default 3, max 12)'),
  }),
  execute: async ({ months }) => {
    const startDate = dayjs()
      .subtract(months - 1, 'month')
      .startOf('month')
      .format('YYYY-MM-DD')
    const endDate = dayjs().endOf('month').format('YYYY-MM-DD')

    const breakdown = await query<{
      month: string
      currency: string
      category_id: string | null
      category_name: string
      total: number
    }>(
      `SELECT
         strftime('%Y-%m', t.date) as month,
         t.currency as currency,
         t.category_id as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
        GROUP BY month, t.currency, t.category_id, category_name
        ORDER BY month, t.currency, total DESC`,
      [startDate, endDate]
    )

    const aggregates = await query<{
      month: string
      currency: string
      total_expenses: number
      total_income: number
    }>(
      `SELECT
         strftime('%Y-%m', date) as month,
         currency,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
         COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income
       FROM transactions
       WHERE type IN ('income', 'expense') AND date >= $1 AND date <= $2
        GROUP BY month, currency
        ORDER BY month, currency`,
      [startDate, endDate]
    )

    if (hasMissingCurrency([...breakdown, ...aggregates])) {
      return missingCurrencyRepairFailure('Spending trends')
    }

    const currencies = getDistinctCurrencies([...breakdown, ...aggregates])

    const monthlyData = aggregates.map((agg) => {
      const monthCategories = breakdown
        .filter((b) => b.month === agg.month && b.currency === agg.currency)
        .slice(0, 3)
        .map((b) => ({
          ...getCategoryIdentity(b.category_id, b.category_name),
          amount: fromCentavos(b.total),
        }))

      return {
        month: agg.month,
        currency: agg.currency,
        totalExpenses: fromCentavos(agg.total_expenses),
        totalIncome: fromCentavos(agg.total_income),
        net: fromCentavos(agg.total_income - agg.total_expenses),
        topCategories: monthCategories,
      }
    })

    const trends: Array<{
      currency: string
      category: string
      direction: 'up' | 'down'
      changePercent: number | null
      changeType: 'changed' | 'new' | 'disappeared'
    }> = []

    if (aggregates.length >= 2) {
      for (const currency of currencies) {
        const aggregateMonths = aggregates
          .filter((agg) => agg.currency === currency)
          .map((agg) => agg.month)
          .sort()
        if (aggregateMonths.length < 2) continue

        let latestMonth: string | null = null
        let prevMonth: string | null = null
        for (let index = aggregateMonths.length - 1; index > 0; index -= 1) {
          const currentMonth = aggregateMonths[index]
          const previousMonth = aggregateMonths[index - 1]
          const isConsecutive =
            dayjs(`${currentMonth}-01`).diff(dayjs(`${previousMonth}-01`), 'month') === 1
          if (isConsecutive) {
            latestMonth = currentMonth
            prevMonth = previousMonth
            break
          }
        }
        if (!latestMonth || !prevMonth) continue

        const latestCategories = new Map<string, { total: number; label: string }>()
        const prevCategories = new Map<string, { total: number; label: string }>()

        for (const b of breakdown) {
          if (b.currency !== currency) continue
          const identity = getCategoryIdentity(b.category_id, b.category_name)
          if (b.month === latestMonth) {
            latestCategories.set(identity.categoryKey, { total: b.total, label: identity.category })
          }
          if (b.month === prevMonth) {
            prevCategories.set(identity.categoryKey, { total: b.total, label: identity.category })
          }
        }

        const allCategories = new Set([...latestCategories.keys(), ...prevCategories.keys()])

        for (const cat of allCategories) {
          const latestEntry = latestCategories.get(cat)
          const prevEntry = prevCategories.get(cat)
          const latest = latestEntry?.total || 0
          const prev = prevEntry?.total || 0
          const categoryLabel = latestEntry?.label ?? prevEntry?.label ?? cat
          if (prev === 0 && latest > 0) {
            trends.push({
              currency,
              category: categoryLabel,
              direction: 'up',
              changePercent: null,
              changeType: 'new',
            })
            continue
          }
          if (latest === 0 && prev > 0) {
            trends.push({
              currency,
              category: categoryLabel,
              direction: 'down',
              changePercent: null,
              changeType: 'disappeared',
            })
            continue
          }
          const changePercent = Math.round(((latest - prev) / prev) * 100)
          if (Math.abs(changePercent) >= 10) {
            trends.push({
              currency,
              category: categoryLabel,
              direction: changePercent > 0 ? 'up' : 'down',
              changePercent: Math.abs(changePercent),
              changeType: 'changed',
            })
          }
        }
      }

      trends.sort((a, b) => {
        const aValue = a.changePercent ?? 101
        const bValue = b.changePercent ?? 101
        return bValue - aValue
      })
    }

    return {
      mixedCurrency: currencies.length > 1,
      months: monthlyData,
      trends,
      message:
        monthlyData.length === 0
          ? 'No transaction data found for the requested period.'
          : currencies.length === 1
            ? `Analyzed ${monthlyData.length} month${monthlyData.length !== 1 ? 's' : ''} of spending data.${trends.length > 0 ? ` Notable trends: ${trends.map((t) => (t.changeType === 'changed' ? `${t.category} ${t.direction} ${t.changePercent}%` : t.changeType === 'new' ? `${t.category} is new this month` : `${t.category} disappeared this month`)).join(', ')}.` : ''}`
            : `Analyzed ${monthlyData.length} month/currency buckets across ${currencies.length} currencies. See the currency field on months and trends for per-currency results; no FX conversion was applied.${trends.length > 0 ? ` Notable trends: ${trends.map((t) => (t.changeType === 'changed' ? `${t.currency} ${t.category} ${t.direction} ${t.changePercent}%` : t.changeType === 'new' ? `${t.currency} ${t.category} is new this month` : `${t.currency} ${t.category} disappeared this month`)).join(', ')}.` : ''}`,
    }
  },
}

// ---------------------------------------------------------------------------
// 13. save-memory
// ---------------------------------------------------------------------------

export const analyticsTools: ToolDefinition[] = [getBalanceOverview, analyzeSpendingTrends]
