import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  parse: vi.fn(),
  transactions: vi.fn(),
  accounts: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/database', () => ({ withTransaction: mocks.commit }))
vi.mock('@/lib/statement-parser', () => ({ parseStatement: mocks.parse }))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: mocks.transactions }) },
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: mocks.accounts }) },
}))
vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: mocks.invalidate,
}))

import { importStatementFile } from '../statement-import-actions'

function file() {
  const value = new File(['statement'], 'statement.ofx')
  Object.defineProperty(value, 'text', { value: () => Promise.resolve('statement') })
  return value
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.parse.mockReturnValue([
    { date: '2026-01-01', amount: 1, description: 'Coffee', type: 'expense' },
  ])
  mocks.commit.mockResolvedValue({ imported: 1, skipped: 0 })
  mocks.transactions.mockResolvedValue(undefined)
  mocks.accounts.mockResolvedValue(undefined)
})

describe('statement import completion policy', () => {
  it.each(['transactions', 'accounts'] as const)(
    'settles synchronous %s refresh throws without changing committed success',
    async (target) => {
      const trace: string[] = []
      mocks.commit.mockImplementation(async () => {
        trace.push('commit')
        return { imported: 1, skipped: 0 }
      })
      for (const name of ['transactions', 'accounts'] as const) {
        mocks[name].mockImplementation(() => {
          trace.push(name)
          if (name === target) throw new Error('refresh failed')
          return Promise.resolve()
        })
      }
      const result = await importStatementFile(file(), 'account')
      trace.push('resolve')
      expect(trace).toEqual(['commit', 'transactions', 'accounts', 'resolve'])
      expect(result).toEqual({ imported: 1, skipped: 0, errors: [], mode: 'unreviewed_atomic' })
      expect(mocks.invalidate).not.toHaveBeenCalled()
    }
  )

  it('waits for both refreshes and refreshes even a zero-import commit', async () => {
    const trace: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mocks.commit.mockImplementation(async () => {
      trace.push('commit')
      return { imported: 0, skipped: 1 }
    })
    mocks.transactions.mockImplementation(() => {
      trace.push('transactions')
      return gate
    })
    mocks.accounts.mockImplementation(() => {
      trace.push('accounts')
      return gate
    })
    const pending = importStatementFile(file(), 'account').then((result) => {
      trace.push('resolve')
      return result
    })
    await vi.waitFor(() => expect(trace).toEqual(['commit', 'transactions', 'accounts']))
    release()
    expect(await pending).toEqual({
      imported: 0,
      skipped: 1,
      errors: [],
      mode: 'unreviewed_atomic',
    })
    expect(trace).toEqual(['commit', 'transactions', 'accounts', 'resolve'])
  })

  it.each([new Error('commit failed'), 'not an Error'])(
    'envelopes commit failure %s without refreshing',
    async (error) => {
      mocks.commit.mockRejectedValue(error)
      expect(await importStatementFile(file(), 'account', { previewToken: 'review' })).toEqual({
        imported: 0,
        skipped: 0,
        errors: [error instanceof Error ? 'commit failed' : 'Unknown error'],
        mode: 'reviewed_atomic',
      })
      expect(mocks.transactions).not.toHaveBeenCalled()
      expect(mocks.accounts).not.toHaveBeenCalled()
      expect(mocks.invalidate).not.toHaveBeenCalled()
    }
  )
})
