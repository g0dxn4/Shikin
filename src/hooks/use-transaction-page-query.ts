import { useEffect, useRef, useState } from 'react'
import {
  queryTransactionPage,
  type TransactionPageRequest,
  type TransactionPageResult,
} from '@/lib/transaction-query'
import { getErrorMessage } from '@/lib/errors'
import {
  invalidateTransactionPage,
  TRANSACTION_PAGE_INVALIDATION_EVENT,
} from '@/lib/transaction-query-events'
import { useTransactionStore } from '@/stores/transaction-store'

const EMPTY_RESULT: TransactionPageResult = {
  rows: [],
  total: 0,
  currencies: [],
  reviewCounts: {
    all: 0,
    'needs-category': 0,
    pending: 0,
    placeholder: 0,
    staged: 0,
    unclassified: 0,
  },
}

export function useTransactionPageQuery(request: TransactionPageRequest) {
  const [result, setResult] = useState<TransactionPageResult>(EMPTY_RESULT)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const requestSequence = useRef(0)

  useEffect(() => {
    const handleInvalidation = () => setRevision((value) => value + 1)
    window.addEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, handleInvalidation)
    const unsubscribe = useTransactionStore.subscribe((state, previousState) => {
      if (state.transactions !== previousState.transactions) {
        invalidateTransactionPage('store-refresh')
      }
    })
    return () => {
      unsubscribe()
      window.removeEventListener(TRANSACTION_PAGE_INVALIDATION_EVENT, handleInvalidation)
    }
  }, [])

  useEffect(() => {
    const sequence = ++requestSequence.current
    const requestSnapshot: TransactionPageRequest = {
      account: request.account,
      category: request.category,
      currency: request.currency,
      dateFrom: request.dateFrom,
      dateTo: request.dateTo,
      direction: request.direction,
      page: request.page,
      pageSize: request.pageSize,
      reviewReason: request.reviewReason,
      search: request.search,
      sort: request.sort,
      status: request.status,
      type: request.type,
    }

    void Promise.resolve()
      .then(() => {
        if (sequence !== requestSequence.current) return null
        setIsLoading(true)
        setError(null)
        return queryTransactionPage(requestSnapshot)
      })
      .then((nextResult) => {
        if (!nextResult) return
        if (sequence !== requestSequence.current) return
        setResult(nextResult)
      })
      .catch((queryError) => {
        if (sequence !== requestSequence.current) return
        setError(getErrorMessage(queryError))
      })
      .finally(() => {
        if (sequence === requestSequence.current) setIsLoading(false)
      })

    return () => {
      if (sequence === requestSequence.current) requestSequence.current += 1
    }
  }, [
    request.account,
    request.category,
    request.currency,
    request.dateFrom,
    request.dateTo,
    request.direction,
    request.page,
    request.pageSize,
    request.reviewReason,
    request.search,
    request.sort,
    request.status,
    request.type,
    revision,
  ])

  return { ...result, isLoading, error }
}
