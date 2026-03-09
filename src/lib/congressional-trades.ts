export interface CongressionalTrade {
  politician: string
  party: string
  chamber: 'senate' | 'house'
  ticker: string
  type: 'buy' | 'sell'
  amount: string
  date: string
}

export const DISCLAIMER =
  'This is public disclosure data. Congressional trades are informational and do not constitute investment advice.'

/**
 * Fetch recent congressional trades from the public House Stock Watcher API.
 * This is a free, open-source dataset maintained by the community.
 * See: https://housestockwatcher.com
 */
export async function fetchRecentTrades(days: number = 30): Promise<CongressionalTrade[]> {
  try {
    // House Stock Watcher — free public API
    const res = await fetch(
      'https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json'
    )
    if (!res.ok) throw new Error(`House Stock Watcher error: ${res.status}`)

    const data = (await res.json()) as HouseTransaction[]
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

    return data
      .filter((t) => t.transaction_date >= cutoff)
      .map(mapHouseTransaction)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 100)
  } catch (err) {
    console.warn('[CongressionalTrades] House data failed, trying Senate:', err)
    return fetchSenateTrades(days)
  }
}

export async function fetchTradesForSymbol(symbol: string): Promise<CongressionalTrade[]> {
  const trades = await fetchRecentTrades(90)
  return trades.filter(
    (t) => t.ticker.toUpperCase() === symbol.toUpperCase()
  )
}

interface HouseTransaction {
  transaction_date: string
  disclosure_date: string
  owner: string
  ticker: string
  asset_description: string
  type: string
  amount: string
  representative: string
  district: string
  party?: string
}

function mapHouseTransaction(t: HouseTransaction): CongressionalTrade {
  const txType = t.type.toLowerCase()
  return {
    politician: t.representative,
    party: t.party || 'Unknown',
    chamber: 'house',
    ticker: t.ticker || 'N/A',
    type: txType.includes('sale') ? 'sell' : 'buy',
    amount: t.amount,
    date: t.transaction_date,
  }
}

async function fetchSenateTrades(days: number): Promise<CongressionalTrade[]> {
  try {
    const res = await fetch(
      'https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json'
    )
    if (!res.ok) throw new Error(`Senate Stock Watcher error: ${res.status}`)

    const data = (await res.json()) as SenateTransaction[]
    const cutoff = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

    return data
      .filter((t) => t.transaction_date >= cutoff)
      .map(mapSenateTransaction)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 100)
  } catch (err) {
    console.warn('[CongressionalTrades] Senate data also failed:', err)
    return []
  }
}

interface SenateTransaction {
  transaction_date: string
  disclosure_date: string
  owner: string
  ticker: string
  asset_description: string
  type: string
  amount: string
  senator: string
  party?: string
}

function mapSenateTransaction(t: SenateTransaction): CongressionalTrade {
  const txType = t.type.toLowerCase()
  return {
    politician: t.senator,
    party: t.party || 'Unknown',
    chamber: 'senate',
    ticker: t.ticker || 'N/A',
    type: txType.includes('sale') ? 'sell' : 'buy',
    amount: t.amount,
    date: t.transaction_date,
  }
}
