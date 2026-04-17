import {
  dayjs,
  query,
  formatMoney,
  UNCATEGORIZED,
  toDisplayAmount,
  uniqueCurrencies,
  buildRecapRecord,
  saveRecap,
  percentageChange,
  type RecapHighlight,
  type RecapType,
} from './shared.js'

export async function generateSpendingRecapSummary(type: RecapType, period?: string) {
  const anchor = period ? dayjs(period) : dayjs()
  if (!anchor.isValid()) {
    return {
      success: false,
      message: 'Period must be a valid ISO date in YYYY-MM-DD format.',
    }
  }

  const end =
    type === 'weekly' ? anchor.format('YYYY-MM-DD') : anchor.endOf('month').format('YYYY-MM-DD')
  const start =
    type === 'weekly'
      ? anchor.subtract(6, 'day').format('YYYY-MM-DD')
      : anchor.startOf('month').format('YYYY-MM-DD')

  const previousStart =
    type === 'weekly'
      ? anchor.subtract(13, 'day').format('YYYY-MM-DD')
      : anchor.subtract(1, 'month').startOf('month').format('YYYY-MM-DD')
  const previousEnd =
    type === 'weekly'
      ? anchor.subtract(7, 'day').format('YYYY-MM-DD')
      : anchor.subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

  const currentTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT currency, type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type IN ('expense', 'income') AND date >= $1 AND date <= $2
     GROUP BY currency, type`,
    [start, end]
  )
  const previousTotals = query<{ currency: string; type: string; total: number }>(
    `SELECT currency, type, COALESCE(SUM(amount), 0) AS total
     FROM transactions
     WHERE type IN ('expense', 'income') AND date >= $1 AND date <= $2
     GROUP BY currency, type`,
    [previousStart, previousEnd]
  )
  const categories = query<{
    currency: string
    category_name: string
    total: number
    count: number
  }>(
    `SELECT t.currency, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, c.name
     ORDER BY t.currency ASC, total DESC`,
    [start, end]
  )
  const biggestExpenseRows = query<{
    currency: string
    description: string
    amount: number
    category_name: string
  }>(
    `SELECT t.currency, t.description, t.amount, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     ORDER BY t.currency ASC, t.amount DESC`,
    [start, end]
  )

  const currencies = uniqueCurrencies(currentTotals, previousTotals, categories, biggestExpenseRows)
  const currentTotalsByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of currentTotals) {
    const totals = currentTotalsByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'income') totals.income = row.total
    if (row.type === 'expense') totals.expense = row.total
    currentTotalsByCurrency.set(row.currency, totals)
  }
  const previousTotalsByCurrency = new Map<string, { income: number; expense: number }>()
  for (const row of previousTotals) {
    const totals = previousTotalsByCurrency.get(row.currency) ?? { income: 0, expense: 0 }
    if (row.type === 'income') totals.income = row.total
    if (row.type === 'expense') totals.expense = row.total
    previousTotalsByCurrency.set(row.currency, totals)
  }
  const biggestExpenseByCurrency = new Map<string, (typeof biggestExpenseRows)[number]>()
  for (const row of biggestExpenseRows) {
    if (!biggestExpenseByCurrency.has(row.currency)) {
      biggestExpenseByCurrency.set(row.currency, row)
    }
  }

  const summaryParts: string[] = []
  const highlights: RecapHighlight[] = []
  const weeklyLabel = `${dayjs(start).format('MMM D')} - ${dayjs(end).format('MMM D')}`
  const monthLabel = anchor.format('MMMM YYYY')

  if (currencies.length > 1) {
    const totalsByCurrency = currencies.map((currency) => {
      const current = currentTotalsByCurrency.get(currency) ?? { income: 0, expense: 0 }
      const previous = previousTotalsByCurrency.get(currency) ?? { income: 0, expense: 0 }
      const topCategories = categories
        .filter((category) => category.currency === currency)
        .slice(0, type === 'weekly' ? 3 : 5)
        .map((category) => ({
          category: category.category_name,
          total: toDisplayAmount(category.total),
          count: category.count,
        }))
      const biggestExpense = biggestExpenseByCurrency.get(currency)
      const savings = current.income - current.expense
      const savingsRate = current.income > 0 ? Math.round((savings / current.income) * 100) : 0

      return {
        currency,
        totalExpenses: toDisplayAmount(current.expense),
        totalIncome: toDisplayAmount(current.income),
        previousExpenses: toDisplayAmount(previous.expense),
        previousIncome: toDisplayAmount(previous.income),
        expenseChange: percentageChange(current.expense, previous.expense),
        incomeChange: percentageChange(current.income, previous.income),
        savings: type === 'monthly' ? toDisplayAmount(Math.max(savings, 0)) : undefined,
        savingsRate: type === 'monthly' ? savingsRate : undefined,
        topCategories,
        biggestExpense: biggestExpense
          ? {
              description: biggestExpense.description,
              amount: toDisplayAmount(biggestExpense.amount),
              category: biggestExpense.category_name,
            }
          : null,
      }
    })
    const hasCurrentActivity = totalsByCurrency.some(
      (totals) => totals.totalExpenses > 0 || totals.totalIncome > 0
    )

    if (!hasCurrentActivity) {
      summaryParts.push(
        type === 'weekly'
          ? 'No transactions recorded during this week.'
          : `No transactions recorded for ${monthLabel}.`
      )
    } else {
      summaryParts.push(
        `This ${type === 'weekly' ? 'period' : 'month'} spans ${totalsByCurrency.length} currencies, so amounts are shown separately with no FX conversion.`
      )
      for (const totals of totalsByCurrency) {
        if (type === 'weekly') {
          summaryParts.push(
            `${totals.currency}: spent ${formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)} and earned ${formatMoney(Math.round(totals.totalIncome * 100), totals.currency)}.`
          )
        } else {
          summaryParts.push(
            `${totals.currency}: earned ${formatMoney(Math.round(totals.totalIncome * 100), totals.currency)} and spent ${formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)}, saving ${formatMoney(Math.round((totals.savings ?? 0) * 100), totals.currency)} (${totals.savingsRate ?? 0}% savings rate).`
          )
        }

        if (totals.topCategories.length > 0) {
          summaryParts.push(
            `${totals.currency} top categories: ${totals.topCategories
              .map(
                (category) =>
                  `${category.category} (${formatMoney(Math.round(category.total * 100), totals.currency)})`
              )
              .join(type === 'weekly' ? ', ' : '; ')}.`
          )
        }
        if (totals.biggestExpense) {
          summaryParts.push(
            `${totals.currency} biggest expense: ${totals.biggestExpense.description} at ${formatMoney(Math.round(totals.biggestExpense.amount * 100), totals.currency)}.`
          )
        }

        highlights.push({
          label: `${totals.currency} ${type === 'weekly' ? 'Spent' : 'Income'}`,
          value:
            type === 'weekly'
              ? formatMoney(Math.round(totals.totalExpenses * 100), totals.currency)
              : formatMoney(Math.round(totals.totalIncome * 100), totals.currency),
          change: type === 'weekly' ? totals.expenseChange : totals.incomeChange,
        })
        highlights.push({
          label: `${totals.currency} ${type === 'weekly' ? 'Earned' : 'Expenses'}`,
          value:
            type === 'weekly'
              ? formatMoney(Math.round(totals.totalIncome * 100), totals.currency)
              : formatMoney(Math.round(totals.totalExpenses * 100), totals.currency),
          change: type === 'weekly' ? totals.incomeChange : totals.expenseChange,
        })
        if (type === 'monthly') {
          highlights.push({
            label: `${totals.currency} Savings Rate`,
            value: `${totals.savingsRate ?? 0}%`,
          })
        }
      }
    }

    const record = buildRecapRecord(
      type,
      start,
      end,
      type === 'weekly' ? `Weekly Recap: ${weeklyLabel}` : `Monthly Recap: ${monthLabel}`,
      summaryParts.join(' '),
      highlights
    )
    await saveRecap(record)

    return {
      success: true,
      recap: record,
      totalsByCurrency,
      message: `Generated ${type} recap with per-currency totals. See totalsByCurrency for exact figures; no FX conversion was applied.`,
    }
  }

  const summaryCurrency = currencies[0] ?? 'USD'
  const totals = currentTotalsByCurrency.get(summaryCurrency) ?? { income: 0, expense: 0 }
  const previous = previousTotalsByCurrency.get(summaryCurrency) ?? { income: 0, expense: 0 }
  const totalExpenses = totals.expense
  const totalIncome = totals.income
  const previousExpenses = previous.expense
  const previousIncome = previous.income
  const categoriesForCurrency = categories.filter(
    (category) => category.currency === summaryCurrency
  )
  const biggestExpense = biggestExpenseByCurrency.get(summaryCurrency)
  const expenseChange = percentageChange(totalExpenses, previousExpenses)
  const incomeChange = percentageChange(totalIncome, previousIncome)

  if (type === 'weekly') {
    if (totalExpenses === 0 && totalIncome === 0) {
      summaryParts.push('No transactions recorded during this week.')
    } else {
      summaryParts.push(
        `This week you spent ${formatMoney(totalExpenses, summaryCurrency)} and earned ${formatMoney(totalIncome, summaryCurrency)}.`
      )
      if (categoriesForCurrency.length > 0) {
        summaryParts.push(
          `Top categories: ${categoriesForCurrency
            .slice(0, 3)
            .map(
              (category) =>
                `${category.category_name} (${formatMoney(category.total, summaryCurrency)})`
            )
            .join(', ')}.`
        )
      }
      if (biggestExpense) {
        summaryParts.push(
          `Biggest expense: ${biggestExpense.description} at ${formatMoney(biggestExpense.amount, summaryCurrency)}.`
        )
      }
    }

    highlights.push({
      label: 'Total Spent',
      value: formatMoney(totalExpenses, summaryCurrency),
      change: expenseChange,
    })
    highlights.push({
      label: 'Total Earned',
      value: formatMoney(totalIncome, summaryCurrency),
      change: incomeChange,
    })
    if (categoriesForCurrency[0]) {
      highlights.push({
        label: 'Top Category',
        value: `${categoriesForCurrency[0].category_name} ${formatMoney(categoriesForCurrency[0].total, summaryCurrency)}`,
      })
    }

    const record = buildRecapRecord(
      'weekly',
      start,
      end,
      `Weekly Recap: ${weeklyLabel}`,
      summaryParts.join(' '),
      highlights
    )
    await saveRecap(record)
    return {
      success: true,
      recap: record,
      message: `Generated weekly recap for ${weeklyLabel}.`,
    }
  }

  const budgets = query<{ name: string; budget_amount: number; spent: number }>(
    `SELECT b.name, b.amount AS budget_amount,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
              WHERE t.category_id = b.category_id AND t.type = 'expense'
              AND t.date >= $1 AND t.date <= $2), 0) AS spent
     FROM budgets b WHERE b.is_active = 1`,
    [start, end]
  )
  const savings = totalIncome - totalExpenses
  const savingsRate = totalIncome > 0 ? Math.round((savings / totalIncome) * 100) : 0

  if (totalExpenses === 0 && totalIncome === 0) {
    summaryParts.push(`No transactions recorded for ${monthLabel}.`)
  } else {
    summaryParts.push(
      `In ${monthLabel}, you earned ${formatMoney(totalIncome, summaryCurrency)} and spent ${formatMoney(totalExpenses, summaryCurrency)}, saving ${formatMoney(Math.max(savings, 0), summaryCurrency)} (${savingsRate}% savings rate).`
    )
    if (categoriesForCurrency.length > 0) {
      summaryParts.push(
        `Top spending categories: ${categoriesForCurrency
          .slice(0, 5)
          .map(
            (category) =>
              `${category.category_name} (${formatMoney(category.total, summaryCurrency)})`
          )
          .join('; ')}.`
      )
    }
    if (biggestExpense) {
      summaryParts.push(
        `Largest single expense was ${biggestExpense.description} at ${formatMoney(biggestExpense.amount, summaryCurrency)}.`
      )
    }
    const overBudget = budgets.filter((budget) => budget.spent > budget.budget_amount)
    if (overBudget.length > 0) {
      summaryParts.push(`Over budget on: ${overBudget.map((budget) => budget.name).join(', ')}.`)
    }
  }

  highlights.push({
    label: 'Total Income',
    value: formatMoney(totalIncome, summaryCurrency),
    change: incomeChange,
  })
  highlights.push({
    label: 'Total Expenses',
    value: formatMoney(totalExpenses, summaryCurrency),
    change: expenseChange,
  })
  highlights.push({ label: 'Savings Rate', value: `${savingsRate}%` })
  if (categoriesForCurrency[0]) {
    highlights.push({
      label: 'Top Category',
      value: `${categoriesForCurrency[0].category_name} ${formatMoney(categoriesForCurrency[0].total, summaryCurrency)}`,
    })
  }

  const record = buildRecapRecord(
    'monthly',
    start,
    end,
    `Monthly Recap: ${monthLabel}`,
    summaryParts.join(' '),
    highlights
  )
  await saveRecap(record)
  return {
    success: true,
    recap: record,
    message: `Generated monthly recap for ${monthLabel}.`,
  }
}
