import { useEffect, useState } from 'react'
import { getDashboardSplitRows } from '@/lib/dashboard-splits'
import { getErrorMessage } from '@/lib/errors'
import type { DashboardSplit } from '@/lib/dashboard-analytics'

export interface UseDashboardSplitsResult {
  splits: DashboardSplit[]
  isLoading: boolean
  error: string | null
}

export function useDashboardSplits(
  dateRange: { start: string; end: string } | null
): UseDashboardSplitsResult {
  const [splits, setSplits] = useState<DashboardSplit[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dateRange) return

    let cancelled = false

    const doFetch = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await getDashboardSplitRows(dateRange.start, dateRange.end)
        if (!cancelled) {
          setSplits(rows)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err))
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void doFetch()

    return () => {
      cancelled = true
    }
  }, [dateRange])

  return { splits, isLoading, error }
}
