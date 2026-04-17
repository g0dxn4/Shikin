import {
  dayjs,
  query,
  formatMoney,
  noteExists,
  writeNote,
  toDisplayAmount,
  type ReviewHolding,
} from './shared.js'

export async function generatePortfolioReview(force: boolean) {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  const weekLabel = `Week ${weekNum}, ${year}`
  const path = `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`

  if (!force && (await noteExists(path))) {
    return {
      success: true,
      skipped: true,
      path,
      message: `Portfolio review already exists for ${weekLabel}. Use --force to overwrite it.`,
    }
  }

  const investments = query<{
    symbol: string
    name: string
    shares: number
    avg_cost_basis: number
    currency: string
  }>('SELECT symbol, name, shares, avg_cost_basis, currency FROM investments ORDER BY name ASC')

  if (investments.length === 0) {
    return {
      success: false,
      message: 'No investments found. Add investments before generating a portfolio review.',
    }
  }

  let totalValue = 0
  let totalCostBasis = 0
  const totalsByCurrency = new Map<string, { value: number; costBasis: number }>()
  const holdings: ReviewHolding[] = []

  for (const investment of investments) {
    const latestPrice = query<{ price: number; currency: string }>(
      'SELECT price, currency FROM stock_prices WHERE symbol = $1 ORDER BY date DESC LIMIT 1',
      [investment.symbol]
    )[0]
    const currentPrice = latestPrice?.price ?? investment.avg_cost_basis
    const currentCurrency = latestPrice?.currency ?? investment.currency
    if (currentCurrency !== investment.currency) {
      return {
        success: false,
        message: `Investment ${investment.symbol} mixes ${investment.currency} cost basis with ${currentCurrency} price data. Normalize currencies before generating a portfolio review.`,
      }
    }
    const value = Math.round(investment.shares * currentPrice)
    const costBasis = Math.round(investment.shares * investment.avg_cost_basis)
    const gainLossPercent =
      costBasis > 0 ? Math.round(((value - costBasis) / costBasis) * 10000) / 100 : 0

    totalValue += value
    totalCostBasis += costBasis
    const currencyTotals = totalsByCurrency.get(investment.currency) ?? { value: 0, costBasis: 0 }
    currencyTotals.value += value
    currencyTotals.costBasis += costBasis
    totalsByCurrency.set(investment.currency, currencyTotals)
    holdings.push({
      symbol: investment.symbol,
      name: investment.name,
      shares: investment.shares,
      currency: investment.currency,
      value,
      gainLossPercent,
    })
  }

  const totalsByCurrencyList = [...totalsByCurrency.entries()]
    .map(([currency, totals]) => {
      const gainLoss = totals.value - totals.costBasis
      const gainLossPercent =
        totals.costBasis > 0 ? Math.round((gainLoss / totals.costBasis) * 10000) / 100 : 0
      return {
        currency,
        portfolioValue: toDisplayAmount(totals.value),
        costBasis: toDisplayAmount(totals.costBasis),
        gainLoss: toDisplayAmount(gainLoss),
        gainLossPercent,
      }
    })
    .sort((a, b) => a.currency.localeCompare(b.currency))
  const singleCurrency = totalsByCurrencyList.length === 1

  const sortedByPerformance = [...holdings].sort((a, b) => b.gainLossPercent - a.gainLossPercent)
  const topPerformer = sortedByPerformance[0] ?? null
  const worstPerformer = sortedByPerformance[sortedByPerformance.length - 1] ?? null
  const gainLoss = totalValue - totalCostBasis
  const gainLossPercent =
    totalCostBasis > 0 ? Math.round((gainLoss / totalCostBasis) * 10000) / 100 : 0

  const lines = [`# Portfolio Review — ${weekLabel}`, '', '## Performance']

  if (singleCurrency) {
    lines.push(
      `- **Portfolio value:** ${formatMoney(totalValue, totalsByCurrencyList[0].currency)}`
    )
    lines.push(`- **Cost basis:** ${formatMoney(totalCostBasis, totalsByCurrencyList[0].currency)}`)
    lines.push(
      `- **Total gain/loss:** ${gainLoss >= 0 ? '+' : ''}${formatMoney(gainLoss, totalsByCurrencyList[0].currency)} (${gainLossPercent >= 0 ? '+' : ''}${gainLossPercent.toFixed(2)}%)`
    )
  } else {
    lines.push('- **Totals by currency:**')
    for (const currencyTotal of totalsByCurrencyList) {
      lines.push(
        `  - ${currencyTotal.currency}: ${currencyTotal.portfolioValue.toFixed(2)} value, ${currencyTotal.costBasis.toFixed(2)} cost basis, ${currencyTotal.gainLoss >= 0 ? '+' : ''}${currencyTotal.gainLoss.toFixed(2)} (${currencyTotal.gainLossPercent >= 0 ? '+' : ''}${currencyTotal.gainLossPercent.toFixed(2)}%)`
      )
    }
  }

  if (topPerformer) {
    lines.push(
      `- **Top performer:** ${topPerformer.symbol} (${topPerformer.gainLossPercent >= 0 ? '+' : ''}${topPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }

  if (worstPerformer && worstPerformer.symbol !== topPerformer?.symbol) {
    lines.push(
      `- **Worst performer:** ${worstPerformer.symbol} (${worstPerformer.gainLossPercent >= 0 ? '+' : ''}${worstPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }

  lines.push('', '## Holdings', '', '| Symbol | Name | Shares | Value | Gain/Loss |')
  lines.push('|--------|------|--------|-------|-----------|')

  for (const holding of holdings) {
    lines.push(
      `| ${holding.symbol} | ${holding.name} | ${holding.shares} | ${formatMoney(holding.value, holding.currency)} | ${holding.gainLossPercent >= 0 ? '+' : ''}${holding.gainLossPercent.toFixed(2)}% |`
    )
  }

  lines.push(
    '',
    '## Notes',
    '',
    '*Auto-generated from current holdings and latest saved prices.*',
    '',
    '---',
    `*Generated on ${dayjs().format('YYYY-MM-DD HH:mm')}*`
  )

  await writeNote(path, lines.join('\n'))

  return {
    success: true,
    path,
    summary: {
      portfolioValue: singleCurrency ? toDisplayAmount(totalValue) : null,
      costBasis: singleCurrency ? toDisplayAmount(totalCostBasis) : null,
      gainLoss: singleCurrency ? toDisplayAmount(gainLoss) : null,
      gainLossPercent: singleCurrency ? gainLossPercent : null,
      totalsByCurrency: totalsByCurrencyList,
      holdingsCount: holdings.length,
      topPerformer: topPerformer
        ? { symbol: topPerformer.symbol, gainLossPercent: topPerformer.gainLossPercent }
        : null,
      worstPerformer: worstPerformer
        ? { symbol: worstPerformer.symbol, gainLossPercent: worstPerformer.gainLossPercent }
        : null,
    },
    message: `Generated portfolio review for ${weekLabel} at ${path}.`,
  }
}
