import { query } from '@/lib/database'
import { formatMoney } from '@/lib/money'
import { writeNote, noteExists } from '@/lib/notebook'
import type { Investment, StockPrice } from '@/types/database'
import dayjs from 'dayjs'
import weekOfYear from 'dayjs/plugin/weekOfYear'

dayjs.extend(weekOfYear)

export async function shouldGenerateReview(): Promise<boolean> {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  const filename = `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`

  return !(await noteExists(filename))
}

export async function getLastReviewDate(): Promise<string | null> {
  try {
    // Check if we have any reviews at all
    const { readDir, join, exists } = await import('@/lib/virtual-fs')
    const { getNotebookPath } = await import('@/lib/notebook')
    const base = await getNotebookPath()
    const reviewsPath = await join(base, 'weekly-reviews')

    if (!(await exists(reviewsPath))) return null

    const entries = await readDir(reviewsPath)
    const reviews = entries
      .filter((e) => e.name.endsWith('-review.md'))
      .map((e) => e.name)
      .sort()

    if (reviews.length === 0) return null

    // Parse date from most recent review filename
    const latest = reviews[reviews.length - 1]
    // Format: YYYY-WNN-review.md
    const match = latest.match(/(\d{4})-W(\d{2})/)
    if (!match) return null

    return `${match[1]}-W${match[2]}`
  } catch {
    return null
  }
}

export interface ReviewData {
  portfolioValue: number
  costBasis: number
  gainLoss: number
  gainLossPercent: number
  topPerformer: { symbol: string; percent: number } | null
  worstPerformer: { symbol: string; percent: number } | null
  holdings: {
    symbol: string
    name: string
    shares: number
    value: number
    gainLossPercent: number
  }[]
}

export async function gatherReviewData(): Promise<ReviewData> {
  const investments = await query<Investment>('SELECT * FROM investments ORDER BY name')

  let totalValue = 0
  let totalCostBasis = 0
  const holdings: ReviewData['holdings'] = []

  for (const inv of investments) {
    const prices = await query<StockPrice>(
      'SELECT * FROM stock_prices WHERE symbol = ? ORDER BY date DESC LIMIT 1',
      [inv.symbol]
    )
    const currentPrice = prices.length > 0 ? prices[0].price : inv.avg_cost_basis
    const value = Math.round(inv.shares * currentPrice)
    const costBasis = Math.round(inv.shares * inv.avg_cost_basis)
    const gainLossPercent =
      costBasis > 0 ? Math.round(((value - costBasis) / costBasis) * 10000) / 100 : 0

    totalValue += value
    totalCostBasis += costBasis

    holdings.push({
      symbol: inv.symbol,
      name: inv.name,
      shares: inv.shares,
      value,
      gainLossPercent,
    })
  }

  const totalGainLoss = totalValue - totalCostBasis
  const totalGainLossPercent =
    totalCostBasis > 0 ? Math.round((totalGainLoss / totalCostBasis) * 10000) / 100 : 0

  const sorted = [...holdings].sort((a, b) => b.gainLossPercent - a.gainLossPercent)
  const topPerformer =
    sorted.length > 0 ? { symbol: sorted[0].symbol, percent: sorted[0].gainLossPercent } : null
  const worstPerformer =
    sorted.length > 0
      ? {
          symbol: sorted[sorted.length - 1].symbol,
          percent: sorted[sorted.length - 1].gainLossPercent,
        }
      : null

  return {
    portfolioValue: totalValue,
    costBasis: totalCostBasis,
    gainLoss: totalGainLoss,
    gainLossPercent: totalGainLossPercent,
    topPerformer,
    worstPerformer,
    holdings,
  }
}

export function generateReviewMarkdown(data: ReviewData, weekLabel: string): string {
  const lines: string[] = [
    `# Portfolio Review — ${weekLabel}`,
    '',
    '## Performance',
    `- **Portfolio value:** ${formatMoney(data.portfolioValue)}`,
    `- **Cost basis:** ${formatMoney(data.costBasis)}`,
    `- **Total gain/loss:** ${data.gainLoss >= 0 ? '+' : ''}${formatMoney(data.gainLoss)} (${data.gainLossPercent >= 0 ? '+' : ''}${data.gainLossPercent.toFixed(2)}%)`,
  ]

  if (data.topPerformer) {
    lines.push(
      `- **Top performer:** ${data.topPerformer.symbol} (${data.topPerformer.percent >= 0 ? '+' : ''}${data.topPerformer.percent.toFixed(2)}%)`
    )
  }
  if (data.worstPerformer && data.worstPerformer.symbol !== data.topPerformer?.symbol) {
    lines.push(
      `- **Worst performer:** ${data.worstPerformer.symbol} (${data.worstPerformer.percent >= 0 ? '+' : ''}${data.worstPerformer.percent.toFixed(2)}%)`
    )
  }

  lines.push('', '## Holdings', '')
  lines.push('| Symbol | Name | Shares | Value | Gain/Loss |')
  lines.push('|--------|------|--------|-------|-----------|')

  for (const h of data.holdings) {
    lines.push(
      `| ${h.symbol} | ${h.name} | ${h.shares} | ${formatMoney(h.value)} | ${h.gainLossPercent >= 0 ? '+' : ''}${h.gainLossPercent.toFixed(2)}% |`
    )
  }

  lines.push(
    '',
    '## Notes',
    '',
    '*Review auto-generated from local portfolio data.*',
    '',
    '---',
    `*Generated on ${dayjs().format('YYYY-MM-DD HH:mm')}*`
  )

  return lines.join('\n')
}

export async function writeWeeklyReview(): Promise<string> {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  const weekLabel = `Week ${weekNum}, ${year}`
  const filename = `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`

  const data = await gatherReviewData()
  const markdown = generateReviewMarkdown(data, weekLabel)

  await writeNote(filename, markdown)
  return filename
}
