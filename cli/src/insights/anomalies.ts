import {
  dayjs,
  query,
  generateId,
  formatMoney,
  UNCATEGORIZED,
  toDisplayAmount,
  calculateStdDev,
  type AnomalyType,
  type AnomalyTransactionRow,
  type CategorySpendRow,
  type AnomalySeverity,
} from './shared.js'

export async function detectSpendingAnomaliesSummary(largeTransactionThreshold: number) {
  const thresholdCentavos = Math.round(largeTransactionThreshold * 100)
  const ledgerCurrencies = query<{ currency: string }>(
    `SELECT DISTINCT currency
     FROM transactions
     WHERE type = 'expense' AND currency IS NOT NULL AND TRIM(currency) != ''`
  )
  const hasMixedCurrencies = ledgerCurrencies.length > 1
  const anomalies: Array<{
    id: string
    type: AnomalyType
    severity: AnomalySeverity
    title: string
    description: string
    transactionId?: string
    amount?: number
    detectedAt: string
  }> = []

  const recentExpenseRows = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [dayjs().subtract(30, 'day').format('YYYY-MM-DD')]
  )

  const checkedDescriptions = new Set<string>()
  const historyStart = dayjs().subtract(90, 'day').format('YYYY-MM-DD')
  const recentWindowStart = dayjs().subtract(30, 'day').format('YYYY-MM-DD')

  for (const row of recentExpenseRows) {
    const descriptionKey = `${row.currency}:${row.description}`
    if (checkedDescriptions.has(descriptionKey)) continue
    checkedDescriptions.add(descriptionKey)

    const history = query<{ amount: number }>(
      `SELECT amount FROM transactions
       WHERE description = $1 AND currency = $2 AND type = 'expense' AND date >= $3 AND date < $4`,
      [row.description, row.currency, historyStart, recentWindowStart]
    )

    if (history.length < 3) continue

    const { mean, stdDev } = calculateStdDev(history.map((entry) => entry.amount))
    if (stdDev === 0) continue

    for (const recent of recentExpenseRows.filter(
      (entry) => entry.description === row.description && entry.currency === row.currency
    )) {
      const zScore = (recent.amount - mean) / stdDev
      if (zScore <= 2) continue
      anomalies.push({
        id: generateId(),
        type: 'unusual_amount',
        severity: zScore > 3 ? 'high' : 'medium',
        title: `Unusual charge at ${recent.description}`,
        description: `${formatMoney(recent.amount, recent.currency)} is ${zScore.toFixed(1)} standard deviations above the usual ${formatMoney(Math.round(mean), recent.currency)} for this merchant.`,
        transactionId: recent.id,
        amount: toDisplayAmount(recent.amount),
        detectedAt: new Date().toISOString(),
      })
    }
  }

  const duplicateWindowRows = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [dayjs().subtract(7, 'day').format('YYYY-MM-DD')]
  )
  const duplicateGroups = new Map<string, AnomalyTransactionRow[]>()
  for (const row of duplicateWindowRows) {
    const key = `${row.currency}:${row.amount}:${row.description.toLowerCase()}`
    const group = duplicateGroups.get(key) ?? []
    group.push(row)
    duplicateGroups.set(key, group)
  }
  for (const group of duplicateGroups.values()) {
    if (group.length < 2) continue
    for (let index = 0; index < group.length - 1; index += 1) {
      const current = group[index]
      const next = group[index + 1]
      const diffHours = Math.abs(dayjs(current.date).diff(dayjs(next.date), 'hour'))
      if (diffHours > 48) continue
      anomalies.push({
        id: generateId(),
        type: 'duplicate_charge',
        severity: 'medium',
        title: `Possible duplicate: ${current.description}`,
        description: `Two charges of ${formatMoney(current.amount, current.currency)} at ${current.description} landed within ${diffHours} hours.`,
        transactionId: current.id,
        amount: toDisplayAmount(current.amount),
        detectedAt: new Date().toISOString(),
      })
      break
    }
  }

  const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const today = dayjs().format('YYYY-MM-DD')
  const historicalStart = dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
  const historicalEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')
  const currentCategorySpend = query<CategorySpendRow>(
    `SELECT t.currency, t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name,
            SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, t.category_id`,
    [currentMonthStart, today]
  )
  const historicalCategorySpend = query<CategorySpendRow>(
    `SELECT t.currency, t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') AS category_name,
            SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.currency, t.category_id`,
    [historicalStart, historicalEnd]
  )
  const averagesByCategory = new Map<string, number>()
  for (const row of historicalCategorySpend) {
    averagesByCategory.set(`${row.currency}:${row.category_id ?? 'uncategorized'}`, row.total / 3)
  }
  const projectionFactor = dayjs().daysInMonth() / dayjs().date()
  for (const row of currentCategorySpend) {
    const key = `${row.currency}:${row.category_id ?? 'uncategorized'}`
    const averageMonthly = averagesByCategory.get(key)
    if (!averageMonthly) continue
    const projected = row.total * projectionFactor
    const ratio = projected / averageMonthly
    if (ratio <= 1.5) continue
    anomalies.push({
      id: generateId(),
      type: 'spending_spike',
      severity: ratio > 2 ? 'high' : 'medium',
      title: `${row.category_name} spending spike`,
      description: `Current pace projects ${formatMoney(Math.round(projected), row.currency)} this month, about ${Math.round((ratio - 1) * 100)}% above the recent average.`,
      amount: toDisplayAmount(row.total),
      detectedAt: new Date().toISOString(),
    })
  }

  const recurringAmounts = query<{ description: string; currency: string; amounts: string }>(
    `SELECT description, currency, GROUP_CONCAT(amount, ',') AS amounts
     FROM (
       SELECT description, currency, amount, date
        FROM transactions
        WHERE type = 'expense' AND is_recurring = 1 AND date >= $1
        ORDER BY date ASC
      )
     GROUP BY description, currency
     HAVING COUNT(*) >= 2`,
    [dayjs().subtract(90, 'day').format('YYYY-MM-DD')]
  )
  for (const row of recurringAmounts) {
    const amounts = row.amounts.split(',').map(Number)
    const latest = amounts.at(-1)
    const previous = amounts.at(-2)
    if (latest === undefined || previous === undefined || latest === previous || previous <= 0)
      continue
    const changePct = Math.round(((latest - previous) / previous) * 100)
    anomalies.push({
      id: generateId(),
      type: 'subscription_price_change',
      severity: Math.abs(changePct) > 20 ? 'high' : Math.abs(changePct) > 10 ? 'medium' : 'low',
      title: `${row.description} price ${latest > previous ? 'increase' : 'decrease'}`,
      description: `${row.description} changed from ${formatMoney(previous, row.currency)} to ${formatMoney(latest, row.currency)} (${changePct > 0 ? '+' : ''}${changePct}%).`,
      amount: toDisplayAmount(latest),
      detectedAt: new Date().toISOString(),
    })
  }

  const largeTransactions = query<AnomalyTransactionRow>(
    `SELECT t.id, t.description, t.amount, t.currency, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') AS category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.amount >= $1 AND t.date >= $2
     ORDER BY t.currency ASC, t.amount DESC`,
    [thresholdCentavos, dayjs().subtract(7, 'day').format('YYYY-MM-DD')]
  )
  for (const row of largeTransactions) {
    anomalies.push({
      id: generateId(),
      type: 'large_transaction',
      severity: row.amount >= thresholdCentavos * 2 ? 'high' : 'medium',
      title: `Large transaction: ${row.description}`,
      description: `${formatMoney(row.amount, row.currency)} expense on ${dayjs(row.date).format('MMM D')}.`,
      transactionId: row.id,
      amount: toDisplayAmount(row.amount),
      detectedAt: new Date().toISOString(),
    })
  }

  const severityRank: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 }
  anomalies.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  return {
    success: true,
    totalAnomalies: anomalies.length,
    largeTransactionThresholdCurrencyMode: 'per_transaction_currency' as const,
    bySeverity: {
      high: anomalies.filter((item) => item.severity === 'high').length,
      medium: anomalies.filter((item) => item.severity === 'medium').length,
      low: anomalies.filter((item) => item.severity === 'low').length,
    },
    anomalies,
    message:
      anomalies.length === 0
        ? hasMixedCurrencies
          ? 'No spending anomalies detected. Large-transaction thresholds were evaluated independently within each currency.'
          : 'No spending anomalies detected.'
        : hasMixedCurrencies
          ? `Detected ${anomalies.length} anomaly${anomalies.length === 1 ? '' : 'ies'}. Large-transaction thresholds were evaluated independently within each currency.`
          : `Detected ${anomalies.length} anomaly${anomalies.length === 1 ? '' : 'ies'}.`,
  }
}
