import { useEffect, useMemo, useState } from 'react'
import { query } from '@/lib/database'
import {
  accountHistoryWindowStart,
  buildAccountHistoryBatchQuery,
  groupAccountHistoryRows,
  type AccountHistoryPoint,
  type AccountHistoryRow,
} from '@/components/accounts/account-history-batch'

export type AccountHistoryBatchStatus = 'loading' | 'ready' | 'error'

export type AccountHistoryBatch = {
  status: AccountHistoryBatchStatus
  series: ReadonlyMap<string, AccountHistoryPoint[]>
}

const EMPTY_SERIES = new Map<string, AccountHistoryPoint[]>()

/**
 * One read for the visible account set. The list renders immediately. A newer
 * request ignores older responses; a failed read does not throw into the page.
 */
export function useAccountHistoryBatch(
  accountIds: readonly string[],
  refreshKey = ''
): AccountHistoryBatch {
  const idKey = useMemo(
    () => [...new Set(accountIds.filter(Boolean))].sort().join('\0'),
    [accountIds]
  )
  const requestKey = `${idKey}#${refreshKey}`
  const [snapshot, setSnapshot] = useState<{
    requestKey: string
    status: AccountHistoryBatchStatus
    series: ReadonlyMap<string, AccountHistoryPoint[]>
  }>({ requestKey: '', status: 'ready', series: EMPTY_SERIES })

  useEffect(() => {
    if (!idKey) return
    const built = buildAccountHistoryBatchQuery(idKey.split('\0'), accountHistoryWindowStart())
    if (!built) return

    let cancelled = false
    void query<AccountHistoryRow>(built.sql, built.params)
      .then((rows) => {
        if (cancelled) return
        setSnapshot({ requestKey, status: 'ready', series: groupAccountHistoryRows(rows) })
      })
      .catch(() => {
        if (cancelled) return
        setSnapshot({ requestKey, status: 'error', series: EMPTY_SERIES })
      })

    return () => {
      cancelled = true
    }
  }, [idKey, requestKey])

  if (!idKey) return { status: 'ready', series: EMPTY_SERIES }
  if (snapshot.requestKey !== requestKey) {
    return {
      status: 'loading',
      series: snapshot.requestKey.startsWith(`${idKey}#`) ? snapshot.series : EMPTY_SERIES,
    }
  }
  return { status: snapshot.status, series: snapshot.series }
}
