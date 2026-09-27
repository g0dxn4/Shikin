import { useEffect, useState } from 'react'
import { readScopedReport, type ScopedRead, type ScopedReadInput } from '@/lib/scoped-report-read'
import { TRANSACTION_PAGE_INVALIDATION_EVENT } from '@/lib/transaction-query-events'
import { getErrorMessage } from '@/lib/errors'
import { useCurrencyStore } from '@/stores/currency-store'
import { currencyAuthorityKey } from '@/stores/currency-authority'

/** Request identity also gates render, so a previous result never flashes under new filters. */
export function useScopedReport(input: ScopedReadInput) {
  const authority = useCurrencyStore(currencyAuthorityKey)
  const [nonce, setNonce] = useState(0)
  const [loaded, setLoaded] = useState<{
    key: string
    data: ScopedRead | null
    error: string | null
  } | null>(null)
  const inputKey = JSON.stringify(input)
  const key = JSON.stringify([inputKey, authority, nonce])
  useEffect(() => {
    const refresh = () => setNonce((n) => n + 1)
    window.addEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
    return () => window.removeEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, refresh)
  }, [])
  useEffect(() => {
    let cancelled = false
    void readScopedReport(JSON.parse(inputKey))
      .then((data) => {
        if (!cancelled) setLoaded({ key, data, error: null })
      })
      .catch((error) => {
        if (!cancelled) setLoaded({ key, data: null, error: getErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [key, inputKey])
  const current = loaded?.key === key ? loaded : null
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: !current,
    refresh: () => setNonce((n) => n + 1),
  }
}
