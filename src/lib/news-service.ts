import { getFinnhubKey } from '@/lib/price-service'
import { load } from '@tauri-apps/plugin-store'

export interface NewsArticle {
  title: string
  summary: string
  url: string
  source: string
  publishedAt: string
  relatedSymbols: string[]
}

async function getNewsApiKey(): Promise<string | null> {
  try {
    const store = await load('settings.json')
    return ((await store.get('newsapi_key')) as string) || null
  } catch {
    return null
  }
}

export async function fetchNewsForSymbol(
  symbol: string,
  days: number = 7
): Promise<NewsArticle[]> {
  // Try Finnhub first
  const finnhubKey = await getFinnhubKey()
  if (finnhubKey) {
    try {
      return await fetchFinnhubCompanyNews(symbol, days, finnhubKey)
    } catch (err) {
      console.warn(`[NewsService] Finnhub failed for ${symbol}:`, err)
    }
  }

  // Fallback to NewsAPI
  const newsApiKey = await getNewsApiKey()
  if (newsApiKey) {
    return fetchNewsApiArticles(symbol, newsApiKey)
  }

  return []
}

export async function fetchMarketNews(limit: number = 10): Promise<NewsArticle[]> {
  const finnhubKey = await getFinnhubKey()
  if (!finnhubKey) return []

  const url = `https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`)

  const data = await res.json()
  return (data as FinnhubNewsItem[]).slice(0, limit).map(mapFinnhubArticle)
}

export async function fetchNewsForPortfolio(symbols: string[]): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = []

  for (const symbol of symbols.slice(0, 5)) {
    try {
      const news = await fetchNewsForSymbol(symbol, 3)
      articles.push(...news.slice(0, 3))
      // Rate limit
      await new Promise((r) => setTimeout(r, 200))
    } catch (err) {
      console.warn(`[NewsService] Failed for ${symbol}:`, err)
    }
  }

  // Sort by date descending and deduplicate by title
  const seen = new Set<string>()
  return articles
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter((a) => {
      if (seen.has(a.title)) return false
      seen.add(a.title)
      return true
    })
}

interface FinnhubNewsItem {
  headline: string
  summary: string
  url: string
  source: string
  datetime: number
  related: string
}

function mapFinnhubArticle(item: FinnhubNewsItem): NewsArticle {
  return {
    title: item.headline,
    summary: item.summary,
    url: item.url,
    source: item.source,
    publishedAt: new Date(item.datetime * 1000).toISOString(),
    relatedSymbols: item.related ? item.related.split(',').map((s) => s.trim()) : [],
  }
}

async function fetchFinnhubCompanyNews(
  symbol: string,
  days: number,
  apiKey: string
): Promise<NewsArticle[]> {
  const to = new Date().toISOString().split('T')[0]
  const from = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Finnhub error: ${res.status}`)

  const data = (await res.json()) as FinnhubNewsItem[]
  return data.slice(0, 10).map((item) => ({
    ...mapFinnhubArticle(item),
    relatedSymbols: [symbol],
  }))
}

async function fetchNewsApiArticles(
  query: string,
  apiKey: string
): Promise<NewsArticle[]> {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=relevancy&pageSize=10&apiKey=${apiKey}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`NewsAPI error: ${res.status}`)

  const data = await res.json()
  return (data.articles || []).map(
    (a: { title: string; description: string; url: string; source: { name: string }; publishedAt: string }) => ({
      title: a.title,
      summary: a.description || '',
      url: a.url,
      source: a.source?.name || 'Unknown',
      publishedAt: a.publishedAt,
      relatedSymbols: [query],
    })
  )
}
