import { query } from '@/lib/database'
import { fromCentavos } from '@/lib/money'
import { generateId } from '@/lib/ulid'
import dayjs from 'dayjs'

// --- Types ---

export type AnomalySeverity = 'low' | 'medium' | 'high'
export type AnomalyType =
  | 'unusual_amount'
  | 'duplicate_charge'
  | 'spending_spike'
  | 'subscription_price_change'
  | 'large_transaction'

export interface Anomaly {
  id: string
  type: AnomalyType
  severity: AnomalySeverity
  title: string
  description: string
  transaction_id?: string
  amount?: number // display dollars, not centavos
  detected_at: string
  dismissed: boolean
}

const UNCATEGORIZED = 'Uncategorized'

// --- Helpers ---

interface TransactionRow {
  id: string
  description: string
  amount: number
  date: string
  category_id: string | null
  category_name: string | null
  type: string
}

interface CategorySpendRow {
  category_id: string
  category_name: string
  total: number
  count: number
}

export function calculateStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length < 3) {
    return { mean: 0, stdDev: 0 }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const squaredDiffs = values.map((v) => (v - mean) ** 2)
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length
  return { mean, stdDev: Math.sqrt(variance) }
}

export async function getMerchantHistory(
  description: string,
  days: number = 90
): Promise<TransactionRow[]> {
  const since = dayjs().subtract(days, 'day').format('YYYY-MM-DD')
  return query<TransactionRow>(
    `SELECT t.id, t.description, t.amount, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') as category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.description = $1 AND t.type = 'expense' AND t.date >= $2
     ORDER BY t.date DESC`,
    [description, since]
  )
}

// --- Detection functions ---

async function detectUnusualAmounts(recentDays: number = 30): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []
  const since = dayjs().subtract(recentDays, 'day').format('YYYY-MM-DD')
  const historyStart = dayjs().subtract(90, 'day').format('YYYY-MM-DD')

  // Get recent expense transactions
  const recentTx = await query<TransactionRow>(
    `SELECT t.id, t.description, t.amount, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') as category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [since]
  )

  // Group by description (merchant) to check against history
  const checked = new Set<string>()
  for (const tx of recentTx) {
    if (checked.has(tx.description)) continue
    checked.add(tx.description)

    // Get 90-day history for this merchant
    const history = await query<{ amount: number }>(
      `SELECT amount FROM transactions
       WHERE description = $1 AND type = 'expense' AND date >= $2 AND date < $3`,
      [tx.description, historyStart, since]
    )

    if (history.length < 3) continue

    const amounts = history.map((h) => h.amount)
    const { mean, stdDev } = calculateStdDev(amounts)
    if (stdDev === 0) continue

    // Check each recent tx against the historical distribution
    for (const recent of recentTx.filter((r) => r.description === tx.description)) {
      const zScore = (recent.amount - mean) / stdDev
      if (zScore > 2) {
        const severity: AnomalySeverity = zScore > 3 ? 'high' : 'medium'
        anomalies.push({
          id: generateId(),
          type: 'unusual_amount',
          severity,
          title: `Unusual charge at ${recent.description}`,
          description: `$${fromCentavos(recent.amount).toFixed(2)} is ${zScore.toFixed(1)} standard deviations above the average of $${fromCentavos(mean).toFixed(2)} for this merchant.`,
          transaction_id: recent.id,
          amount: fromCentavos(recent.amount),
          detected_at: new Date().toISOString(),
          dismissed: false,
        })
      }
    }
  }

  return anomalies
}

async function detectDuplicateCharges(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []
  const since = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

  // Find transactions with same amount and similar description within 48 hours
  const recentTx = await query<TransactionRow>(
    `SELECT t.id, t.description, t.amount, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') as category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1
     ORDER BY t.date DESC`,
    [since]
  )

  const seen = new Map<string, TransactionRow[]>()
  for (const tx of recentTx) {
    // Key: amount + lowercase description
    const key = `${tx.amount}:${tx.description.toLowerCase()}`
    const existing = seen.get(key)
    if (existing) {
      existing.push(tx)
    } else {
      seen.set(key, [tx])
    }
  }

  for (const [, group] of seen) {
    if (group.length < 2) continue

    // Check if any pair is within 48 hours
    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i]
      const b = group[i + 1]
      const diffHours = Math.abs(dayjs(a.date).diff(dayjs(b.date), 'hour'))
      if (diffHours <= 48) {
        anomalies.push({
          id: generateId(),
          type: 'duplicate_charge',
          severity: 'medium',
          title: `Possible duplicate: ${a.description}`,
          description: `Two charges of $${fromCentavos(a.amount).toFixed(2)} at "${a.description}" within ${diffHours}h of each other.`,
          transaction_id: a.id,
          amount: fromCentavos(a.amount),
          detected_at: new Date().toISOString(),
          dismissed: false,
        })
        break // Only flag once per group
      }
    }
  }

  return anomalies
}

async function detectSpendingSpikes(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

  // Compare this month's category spending vs 3-month average
  const thisMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')
  const thisMonthEnd = dayjs().format('YYYY-MM-DD')
  const avgStart = dayjs().subtract(3, 'month').startOf('month').format('YYYY-MM-DD')
  const avgEnd = dayjs().subtract(1, 'month').endOf('month').format('YYYY-MM-DD')

  // Days elapsed ratio for fair comparison
  const daysInMonth = dayjs().daysInMonth()
  const daysElapsed = dayjs().date()
  const projectionFactor = daysInMonth / daysElapsed

  const currentSpending = await query<CategorySpendRow>(
    `SELECT t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') as category_name,
            SUM(t.amount) as total, COUNT(*) as count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.category_id`,
    [thisMonthStart, thisMonthEnd]
  )

  const historicalSpending = await query<CategorySpendRow>(
    `SELECT t.category_id, COALESCE(c.name, '${UNCATEGORIZED}') as category_name,
            SUM(t.amount) as total, COUNT(*) as count
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.date >= $1 AND t.date <= $2
     GROUP BY t.category_id`,
    [avgStart, avgEnd]
  )

  const avgByCategory = new Map<string, number>()
  for (const h of historicalSpending) {
    // Average monthly spending = total / 3 months
    avgByCategory.set(h.category_id || 'uncategorized', h.total / 3)
  }

  for (const current of currentSpending) {
    const catKey = current.category_id || 'uncategorized'
    const avgMonthly = avgByCategory.get(catKey)
    if (!avgMonthly || avgMonthly === 0) continue

    // Project current spending to end of month
    const projected = current.total * projectionFactor
    const ratio = projected / avgMonthly

    if (ratio > 1.5) {
      const severity: AnomalySeverity = ratio > 2 ? 'high' : 'medium'
      anomalies.push({
        id: generateId(),
        type: 'spending_spike',
        severity,
        title: `${current.category_name} spending spike`,
        description: `On pace to spend $${fromCentavos(projected).toFixed(0)} in ${current.category_name} this month, ${Math.round((ratio - 1) * 100)}% above your 3-month average of $${fromCentavos(avgMonthly).toFixed(0)}.`,
        amount: fromCentavos(current.total),
        detected_at: new Date().toISOString(),
        dismissed: false,
      })
    }
  }

  return anomalies
}

async function detectSubscriptionPriceChanges(): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []

  // Look for recurring merchants where the most recent charge differs from prior
  const since = dayjs().subtract(90, 'day').format('YYYY-MM-DD')

  const recurring = await query<{ description: string; amounts: string }>(
    `SELECT description, GROUP_CONCAT(amount, ',') as amounts
     FROM (
       SELECT description, amount, date
       FROM transactions
       WHERE type = 'expense' AND is_recurring = 1 AND date >= $1
       ORDER BY date ASC
     )
     GROUP BY description
     HAVING COUNT(*) >= 2`,
    [since]
  )

  for (const row of recurring) {
    const amounts = row.amounts.split(',').map(Number)
    const latest = amounts[amounts.length - 1]
    const previous = amounts[amounts.length - 2]

    if (latest !== previous && previous > 0) {
      const changePct = Math.round(((latest - previous) / previous) * 100)
      const severity: AnomalySeverity =
        Math.abs(changePct) > 20 ? 'high' : Math.abs(changePct) > 10 ? 'medium' : 'low'

      anomalies.push({
        id: generateId(),
        type: 'subscription_price_change',
        severity,
        title: `${row.description} price ${latest > previous ? 'increase' : 'decrease'}`,
        description: `${row.description} changed from $${fromCentavos(previous).toFixed(2)} to $${fromCentavos(latest).toFixed(2)} (${changePct > 0 ? '+' : ''}${changePct}%).`,
        amount: fromCentavos(latest),
        detected_at: new Date().toISOString(),
        dismissed: false,
      })
    }
  }

  return anomalies
}

async function detectLargeTransactions(thresholdCentavos: number): Promise<Anomaly[]> {
  const anomalies: Anomaly[] = []
  const since = dayjs().subtract(7, 'day').format('YYYY-MM-DD')

  const largeTx = await query<TransactionRow>(
    `SELECT t.id, t.description, t.amount, t.date, t.category_id,
            COALESCE(c.name, '${UNCATEGORIZED}') as category_name, t.type
     FROM transactions t
     LEFT JOIN categories c ON t.category_id = c.id
     WHERE t.type = 'expense' AND t.amount >= $1 AND t.date >= $2
     ORDER BY t.amount DESC`,
    [thresholdCentavos, since]
  )

  for (const tx of largeTx) {
    anomalies.push({
      id: generateId(),
      type: 'large_transaction',
      severity: tx.amount >= thresholdCentavos * 2 ? 'high' : 'medium',
      title: `Large transaction: ${tx.description}`,
      description: `$${fromCentavos(tx.amount).toFixed(2)} expense at ${tx.description} on ${dayjs(tx.date).format('MMM D')}.`,
      transaction_id: tx.id,
      amount: fromCentavos(tx.amount),
      detected_at: new Date().toISOString(),
      dismissed: false,
    })
  }

  return anomalies
}

// --- Main detection entry point ---

export interface AnomalyDetectionOptions {
  largeTransactionThreshold?: number // in dollars, default 500
}

export async function detectAnomalies(
  options: AnomalyDetectionOptions = {}
): Promise<Anomaly[]> {
  const thresholdDollars = options.largeTransactionThreshold ?? 500
  const thresholdCentavos = thresholdDollars * 100

  const results = await Promise.all([
    detectUnusualAmounts(),
    detectDuplicateCharges(),
    detectSpendingSpikes(),
    detectSubscriptionPriceChanges(),
    detectLargeTransactions(thresholdCentavos),
  ])

  // Flatten and sort by severity (high first)
  const severityOrder: Record<AnomalySeverity, number> = { high: 0, medium: 1, low: 2 }
  return results
    .flat()
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])
}
