import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  accounts: vi.fn(),
  transactions: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/database', () => ({ withTransaction: mocks.commit, query: vi.fn() }))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: mocks.accounts }) },
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: mocks.transactions }) },
}))
vi.mock('@/lib/transaction-query-events', () => ({ invalidateTransactionPage: mocks.invalidate }))

import {
  setAccountSourceCoverage,
  settleAccountStagedTransactions,
  finalizeAccountStatementHistory,
  supersedeAccountReconciliationBridge,
} from '../account-maintenance-actions'

const operations = [
  {
    name: 'coverage',
    run: () =>
      setAccountSourceCoverage({
        accountId: 'a',
        sourceNamespace: 'Bank',
        periodStart: '2025-01-01',
        periodEnd: '2025-01-31',
        status: 'verified',
      }),
    committed: { id: 'coverage' },
    result: { coverage: { id: 'coverage' } },
  },
  {
    name: 'settlement',
    run: () =>
      settleAccountStagedTransactions({ accountId: 'a', transactionIds: ['t'], status: 'posted' }),
    committed: ['t'],
    result: { transactionIds: ['t'] },
  },
  {
    name: 'finalization',
    run: () =>
      finalizeAccountStatementHistory({
        accountId: 'a',
        coverageIds: ['coverage'],
        statementStartDate: '2025-01-01',
        statementEndDate: '2025-01-31',
        actualBalanceCentavos: 100,
        previewToken: 'preview',
      }),
    committed: { reconciliationId: 'r', adjustmentTransactionId: null },
    result: { reconciliationId: 'r', adjustmentTransactionId: null },
  },
  {
    name: 'supersession',
    run: () =>
      supersedeAccountReconciliationBridge({
        accountId: 'a',
        reconciliationId: 'r',
        bridgeId: 'bridge',
        transactionIds: ['t'],
        coverageIds: ['coverage'],
        previewToken: 'preview',
      }),
    committed: { correctionId: 'correction', successorBridgeId: null },
    result: { correctionId: 'correction', successorBridgeId: null },
  },
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.accounts.mockResolvedValue(undefined)
  mocks.transactions.mockResolvedValue(undefined)
})

describe.each(operations)('$name completion policy', ({ run, committed, result }) => {
  it('invalidates after commit before starting either delayed refresh', async () => {
    const trace: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.commit.mockImplementation(async () => {
      trace.push('commit')
      return committed
    })
    mocks.invalidate.mockImplementation((reason) => trace.push(reason))
    mocks.accounts.mockImplementation(() => {
      trace.push('accounts')
      return gate
    })
    mocks.transactions.mockImplementation(() => {
      trace.push('transactions')
      return gate
    })
    const pending = run().then((value) => {
      trace.push('resolve')
      return value
    })
    await vi.waitFor(() =>
      expect(trace).toEqual(['commit', 'store-refresh', 'accounts', 'transactions'])
    )
    release()
    expect(await pending).toEqual({ ...result, refreshIncomplete: false })
    expect(trace).toEqual(['commit', 'store-refresh', 'accounts', 'transactions', 'resolve'])
  })

  it.each(['accounts', 'transactions'] as const)(
    'retains committed data when %s refresh rejects',
    async (target) => {
      mocks.commit.mockResolvedValue(committed)
      mocks[target].mockRejectedValue(new Error('refresh failed'))
      expect(await run()).toEqual({ ...result, refreshIncomplete: true })
      expect(mocks.accounts).toHaveBeenCalledOnce()
      expect(mocks.transactions).toHaveBeenCalledOnce()
      expect(mocks.invalidate.mock.calls).toEqual([['store-refresh']])
    }
  )

  it.each(['accounts', 'transactions'] as const)(
    'still rejects a synchronous %s refresh throw after invalidating',
    async (target) => {
      mocks.commit.mockResolvedValue(committed)
      mocks[target].mockImplementation(() => {
        throw new Error('synchronous refresh failed')
      })
      await expect(run()).rejects.toThrow('synchronous refresh failed')
      expect(mocks.invalidate.mock.calls).toEqual([['store-refresh']])
      expect(mocks.accounts).toHaveBeenCalledOnce()
      expect(mocks.transactions).toHaveBeenCalledTimes(target === 'accounts' ? 0 : 1)
    }
  )

  it('does not invalidate or refresh a failed commit', async () => {
    mocks.commit.mockRejectedValue(new Error('commit failed'))
    await expect(run()).rejects.toThrow('commit failed')
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(mocks.accounts).not.toHaveBeenCalled()
    expect(mocks.transactions).not.toHaveBeenCalled()
  })
})
