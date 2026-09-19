import { valueHolding } from '@shikin/finance-core/valuation'
import {
  readInvestmentValuationRows,
  readValuationRates,
  rowToHoldingInput,
} from '../valuation-read.js'
import { writeNoteIfAbsent } from '../notebook.js'
import { dayjs, formatMoney, noteExists, writeNote, toDisplayAmount } from './shared.js'

function addCentavos(left: number, right: number): number {
  const total = left + right
  if (!Number.isSafeInteger(total))
    throw new RangeError('Portfolio total exceeds safe integer range')
  return total
}

export async function generatePortfolioReview(force: boolean) {
  const weekNum = dayjs().week()
  const year = dayjs().year()
  const weekLabel = `Week ${weekNum}, ${year}`
  const path = `weekly-reviews/${year}-W${String(weekNum).padStart(2, '0')}-review.md`

  const alreadyExistsResult = {
    success: true,
    skipped: true,
    path,
    message: `Portfolio review already exists for ${weekLabel}. Use --force to overwrite it.`,
  }

  if (!force && (await noteExists(path))) return alreadyExistsResult

  const investments = readInvestmentValuationRows('ORDER BY i.name ASC, i.id ASC')
  if (investments.length === 0) {
    return {
      success: false,
      message: 'No investments found. Add investments before generating a portfolio review.',
    }
  }

  const totalsByCurrency = new Map<string, { value: number; costBasis: number | null }>()
  const holdings = investments.map((investment) => {
    const targetCurrency = investment.price_quote_currency ?? investment.currency
    const valuation = valueHolding(
      rowToHoldingInput(investment),
      targetCurrency,
      readValuationRates(targetCurrency)
    )
    const gainLossPercent =
      valuation.gainLossCentavos !== null &&
      valuation.convertedCostBasisCentavos !== null &&
      valuation.convertedCostBasisCentavos !== 0
        ? Math.round(
            (valuation.gainLossCentavos / Math.abs(valuation.convertedCostBasisCentavos)) * 10000
          ) / 100
        : null

    if (valuation.valueCentavos !== null && valuation.valueCurrency !== null) {
      const existing = totalsByCurrency.get(valuation.valueCurrency) ?? {
        value: 0,
        costBasis: 0,
      }
      existing.value = addCentavos(existing.value, valuation.valueCentavos)
      if (valuation.convertedCostBasisCentavos === null) existing.costBasis = null
      else if (existing.costBasis !== null)
        existing.costBasis = addCentavos(existing.costBasis, valuation.convertedCostBasisCentavos)
      totalsByCurrency.set(valuation.valueCurrency, existing)
    }

    return {
      id: investment.id,
      symbol: investment.symbol,
      name: investment.name,
      quantityDecimal: valuation.quantityDecimal,
      currency: valuation.valueCurrency,
      value: valuation.valueCentavos,
      costBasis: valuation.convertedCostBasisCentavos,
      gainLossPercent,
      complete: valuation.complete,
      reasons: valuation.reasons,
    }
  })

  const incompleteHoldingIds = holdings
    .filter((holding) => !holding.complete)
    .map((holding) => holding.id)
  const unknownCostBasisIds = holdings
    .filter((holding) => holding.costBasis === null)
    .map((holding) => holding.id)
  const totalsByCurrencyList = [...totalsByCurrency.entries()]
    .map(([currency, totals]) => {
      const costBasis = totals.costBasis
      const gainLoss = costBasis === null ? null : totals.value - costBasis
      const gainLossPercent =
        gainLoss !== null && costBasis !== null && costBasis !== 0
          ? Math.round((gainLoss / Math.abs(costBasis)) * 10000) / 100
          : null
      return {
        currency,
        portfolioValue: toDisplayAmount(totals.value),
        costBasis: costBasis === null ? null : toDisplayAmount(costBasis),
        gainLoss: gainLoss === null ? null : toDisplayAmount(gainLoss),
        gainLossPercent,
      }
    })
    .sort((left, right) => left.currency.localeCompare(right.currency))

  const comparable = holdings
    .filter((holding) => holding.gainLossPercent !== null)
    .sort((left, right) => (right.gainLossPercent ?? 0) - (left.gainLossPercent ?? 0))
  const topPerformer = comparable[0] ?? null
  const worstPerformer = comparable[comparable.length - 1] ?? null
  const complete = incompleteHoldingIds.length === 0
  const lines = [`# Portfolio Review — ${weekLabel}`, '', '## Performance']

  lines.push(`- **Valuation completeness:** ${complete ? 'complete' : 'incomplete'}`)
  if (incompleteHoldingIds.length > 0) {
    lines.push(`- **Holdings missing verified price/FX:** ${incompleteHoldingIds.join(', ')}`)
  }
  if (unknownCostBasisIds.length > 0) {
    lines.push(`- **Holdings with unknown cost basis:** ${unknownCostBasisIds.join(', ')}`)
  }
  lines.push('- **Native-currency totals:**')
  for (const total of totalsByCurrencyList) {
    const gain =
      total.gainLoss === null
        ? 'gain/loss unavailable'
        : `${total.gainLoss >= 0 ? '+' : ''}${total.gainLoss.toFixed(2)} gain/loss`
    lines.push(
      `  - ${total.currency}: ${total.portfolioValue.toFixed(2)} value, ${total.costBasis === null ? 'unknown' : total.costBasis.toFixed(2)} cost basis, ${gain}`
    )
  }

  if (topPerformer?.gainLossPercent !== null) {
    lines.push(
      `- **Top performer:** ${topPerformer.symbol} (${topPerformer.gainLossPercent >= 0 ? '+' : ''}${topPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }
  if (worstPerformer?.gainLossPercent !== null && worstPerformer.symbol !== topPerformer?.symbol) {
    lines.push(
      `- **Worst performer:** ${worstPerformer.symbol} (${worstPerformer.gainLossPercent >= 0 ? '+' : ''}${worstPerformer.gainLossPercent.toFixed(2)}%)`
    )
  }

  lines.push('', '## Holdings', '', '| Symbol | Name | Quantity | Value | Gain/Loss | Status |')
  lines.push('|--------|------|----------|-------|-----------|--------|')
  for (const holding of holdings) {
    const value =
      holding.value === null || holding.currency === null
        ? '—'
        : formatMoney(holding.value, holding.currency)
    const gain =
      holding.gainLossPercent === null
        ? '—'
        : `${holding.gainLossPercent >= 0 ? '+' : ''}${holding.gainLossPercent.toFixed(2)}%`
    lines.push(
      `| ${holding.symbol} | ${holding.name} | ${holding.quantityDecimal} | ${value} | ${gain} | ${holding.complete ? 'verified' : holding.reasons.join(', ')} |`
    )
  }

  lines.push(
    '',
    '## Notes',
    '',
    '*Auto-generated from exact quantities and identity-verified saved prices. No nominal FX sums are used.*',
    '',
    '---',
    `*Generated on ${dayjs().format('YYYY-MM-DD HH:mm')}*`
  )
  const content = lines.join('\n')

  // The first valuation query may initialize/migrate a custom-root notebook.
  // Keep this post-initialization check, then use exclusive creation to close the race.
  if (!force && (await noteExists(path))) return alreadyExistsResult
  if (force) await writeNote(path, content)
  else if (!(await writeNoteIfAbsent(path, content))) return alreadyExistsResult

  return {
    success: true,
    path,
    summary: {
      complete,
      portfolioValue:
        complete && totalsByCurrencyList.length === 1
          ? totalsByCurrencyList[0].portfolioValue
          : null,
      costBasis:
        complete && totalsByCurrencyList.length === 1 ? totalsByCurrencyList[0].costBasis : null,
      gainLoss:
        complete && totalsByCurrencyList.length === 1 ? totalsByCurrencyList[0].gainLoss : null,
      gainLossPercent:
        complete && totalsByCurrencyList.length === 1
          ? totalsByCurrencyList[0].gainLossPercent
          : null,
      totalsByCurrency: totalsByCurrencyList,
      incompleteHoldingIds,
      unknownCostBasisIds,
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
