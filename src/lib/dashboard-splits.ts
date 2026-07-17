import { query } from '@/lib/database'
import type { DashboardSplit } from './dashboard-analytics'

export async function getDashboardSplitRows(
  startDate: string,
  endDate: string
): Promise<DashboardSplit[]> {
  return query<DashboardSplit>(
    `SELECT ts.transaction_id,
            ts.category_id,
            ts.amount,
            c.name as category_name,
            c.color as category_color,
            t.date
     FROM transaction_splits ts
     JOIN transactions t ON t.id = ts.transaction_id
     LEFT JOIN categories c ON c.id = ts.category_id
     WHERE t.date >= ? AND t.date <= ? AND COALESCE(t.is_archived, 0) = 0
     ORDER BY t.date, ts.amount DESC`,
    [startDate, endDate]
  )
}
