import { savePricesToDB, type PriceRefreshResult } from '@/lib/price-service'
import { useInvestmentStore } from '@/stores/investment-store'

/** Callers retain their captured or live callback lookup at each publication stage. */
export async function publishInvestmentPriceRefresh(
  result: PriceRefreshResult,
  reportFailures: (failures: Record<string, string>) => void,
  refreshHoldings: () => Promise<void>
): Promise<boolean> {
  reportFailures(
    Object.fromEntries(result.failures.map((failure) => [failure.investmentId, failure.reason]))
  )
  if (result.quotes.size === 0) return false
  await savePricesToDB(result.quotes)
  useInvestmentStore.getState().setLastPriceFetch(new Date().toISOString())
  await refreshHoldings()
  return true
}
