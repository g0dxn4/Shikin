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
  /**
   * Start date actually bound in the query that produced `series`.
   * Null when the series must not be read (loading a new window/currency, error, or no accounts).
   * Captions use this value, not a later clock read.
   */
  windowStart: string | null
}

const EMPTY_SERIES = new Map<string, AccountHistoryPoint[]>()

type HistorySnapshot = {
  requestKey: string
  idKey: string
  scopeKey: string
  windowStart: string
  status: AccountHistoryBatchStatus
  series: ReadonlyMap<string, AccountHistoryPoint[]>
}

const EMPTY_SNAPSHOT: HistorySnapshot = {
  requestKey: '',
  idKey: '',
  scopeKey: '',
  windowStart: '',
  status: 'ready',
  series: EMPTY_SERIES,
}

/**
 * One read for the visible account set. The list renders immediately. A newer
 * request ignores older responses; a failed read does not throw into the page.
 *
 * `scopeKey` is the visible account currency identity. A new window or currency
 * does not keep the previous series on screen. A balance refresh of the same
 * window and currency may.
 */
export function useAccountHistoryBatch(
  accountIds: readonly string[],
  refreshKey = '',
  scopeKey = ''
): AccountHistoryBatch {
  const idKey = useMemo(
    () => [...new Set(accountIds.filter(Boolean))].sort().join('\0'),
    [accountIds]
  )
  const requestedWindow = accountHistoryWindowStart()
  const requestKey = `${idKey}#${refreshKey}#${scopeKey}#${requestedWindow}`
  const [snapshot, setSnapshot] = useState<HistorySnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    if (!idKey) return
    const windowStart = requestedWindow
    const built = buildAccountHistoryBatchQuery(idKey.split('\0'), windowStart)
    if (!built) return

    let cancelled = false
    void query<AccountHistoryRow>(built.sql, built.params)
      .then((rows) => {
        if (cancelled) return
        setSnapshot({
          requestKey,
          idKey,
          scopeKey,
          windowStart,
          status: 'ready',
          series: groupAccountHistoryRows(rows),
        })
      })
      .catch(() => {
        if (cancelled) return
        setSnapshot({
          requestKey,
          idKey,
          scopeKey,
          windowStart,
          status: 'error',
          series: EMPTY_SERIES,
        })
      })

    return () => {
      cancelled = true
    }
  }, [idKey, requestKey, requestedWindow, scopeKey])

  if (!idKey) return { status: 'ready', series: EMPTY_SERIES, windowStart: null }

  const sameDataset =
    snapshot.status === 'ready' &&
    snapshot.idKey === idKey &&
    snapshot.scopeKey === scopeKey &&
    snapshot.windowStart === requestedWindow &&
    snapshot.windowStart.length > 0

  if (snapshot.requestKey !== requestKey) {
    return {
      status: 'loading',
      series: sameDataset ? snapshot.series : EMPTY_SERIES,
      windowStart: sameDataset ? snapshot.windowStart : null,
    }
  }

  if (snapshot.status !== 'ready') {
    return { status: snapshot.status, series: EMPTY_SERIES, windowStart: null }
  }

  return {
    status: 'ready',
    series: snapshot.series,
    windowStart: snapshot.windowStart,
  }
}
