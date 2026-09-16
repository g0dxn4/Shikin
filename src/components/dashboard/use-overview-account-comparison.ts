import { useEffect, useMemo, useRef, useState } from 'react'
import { query } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import type { NetWorthPeriod } from '@/components/dashboard/overview-net-worth'
import {
  getOverviewComparisonDateRange,
  type AccountBalanceSnapshot,
} from '@/components/dashboard/overview-account-comparison-helpers'

interface ComparisonHistoryState {
  requestKey: string
  firstHistory: AccountBalanceSnapshot[]
  secondHistory: AccountBalanceSnapshot[]
  isLoading: boolean
  error: string | null
}

const EMPTY_STATE: ComparisonHistoryState = {
  requestKey: '',
  firstHistory: [],
  secondHistory: [],
  isLoading: false,
  error: null,
}

export async function loadOverviewAccountHistory(
  accountId: string,
  period: NetWorthPeriod,
  endDate: string
): Promise<AccountBalanceSnapshot[]> {
  const { startDate } = getOverviewComparisonDateRange(period)
  if (startDate) {
    return query<AccountBalanceSnapshot>(
      'SELECT date, balance FROM account_balance_history WHERE account_id = ? AND date >= ? AND date <= ? ORDER BY date ASC',
      [accountId, startDate, endDate]
    )
  }
  return query<AccountBalanceSnapshot>(
    'SELECT date, balance FROM account_balance_history WHERE account_id = ? AND date <= ? ORDER BY date ASC',
    [accountId, endDate]
  )
}

export function useOverviewAccountComparison(
  firstAccountId: string,
  secondAccountId: string,
  period: NetWorthPeriod
) {
  const endDate = useMemo(() => getOverviewComparisonDateRange(period).endDate, [period])
  const requestKey = `${firstAccountId}:${secondAccountId}:${period}:${endDate}`
  const requestId = useRef(0)
  const [state, setState] = useState<ComparisonHistoryState>(EMPTY_STATE)

  useEffect(() => {
    if (!firstAccountId || !secondAccountId || firstAccountId === secondAccountId) return

    const currentRequestId = ++requestId.current

    void Promise.all([
      loadOverviewAccountHistory(firstAccountId, period, endDate),
      loadOverviewAccountHistory(secondAccountId, period, endDate),
    ])
      .then(([firstHistory, secondHistory]) => {
        if (requestId.current !== currentRequestId) return
        setState({ requestKey, firstHistory, secondHistory, isLoading: false, error: null })
      })
      .catch((error) => {
        if (requestId.current !== currentRequestId) return
        setState({
          requestKey,
          firstHistory: [],
          secondHistory: [],
          isLoading: false,
          error: getErrorMessage(error),
        })
      })

    return () => {
      if (requestId.current === currentRequestId) requestId.current += 1
    }
  }, [endDate, firstAccountId, period, requestKey, secondAccountId])

  if (
    !firstAccountId ||
    !secondAccountId ||
    firstAccountId === secondAccountId ||
    state.requestKey !== requestKey
  ) {
    return {
      firstHistory: [] as AccountBalanceSnapshot[],
      secondHistory: [] as AccountBalanceSnapshot[],
      isLoading: Boolean(firstAccountId && secondAccountId && firstAccountId !== secondAccountId),
      error: null,
    }
  }

  return state
}
