import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TransactionClient } from '@/lib/database'

const mocks = vi.hoisted(() => ({
  withTransaction: vi.fn(),
  parseStatement: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchAccounts: vi.fn(),
}))

vi.mock('@/lib/database', () => ({ withTransaction: mocks.withTransaction }))
vi.mock('@/lib/statement-parser', () => ({ parseStatement: mocks.parseStatement }))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: mocks.fetchTransactions }) },
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: mocks.fetchAccounts }) },
}))

import { importStatementFile, previewStatementFile } from '../statement-import'

function file(): File {
  const value = new File(['statement'], 'statement.ofx')
  Object.defineProperty(value, 'text', { value: vi.fn().mockResolvedValue('statement') })
  return value
}

describe('statement import service boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchTransactions.mockResolvedValue(undefined)
    mocks.fetchAccounts.mockResolvedValue(undefined)
  })

  it('rejects unsupported parser rows inside the transactional plan', async () => {
    mocks.parseStatement.mockReturnValue([
      { date: '2026-01-01', amount: 1, description: 'Transfer', type: 'transfer' },
    ])
    mocks.withTransaction.mockImplementation(
      (callback: (tx: TransactionClient) => Promise<unknown>) =>
        callback({ query: vi.fn(), execute: vi.fn() } as unknown as TransactionClient)
    )

    const result = await importStatementFile(file(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0, mode: 'unreviewed_atomic' })
    expect(result.errors[0]).toContain('Unsupported imported transaction type')
    expect(mocks.fetchTransactions).not.toHaveBeenCalled()
  })

  it('reports planning database failures without claiming a preview token', async () => {
    mocks.parseStatement.mockReturnValue([
      { date: '2026-01-01', amount: 1, description: 'Coffee', type: 'expense' },
    ])
    mocks.withTransaction.mockRejectedValue(new Error('database unavailable'))

    const result = await previewStatementFile(file(), 'account-1')

    expect(result).toMatchObject({
      success: false,
      previewToken: null,
      imported: 0,
      skipped: 0,
      reviewCandidates: [],
      limitations: [],
    })
    expect(result.errors).toEqual(['database unavailable'])
  })

  it('reports a duplicate lookup failure without attempting a write', async () => {
    mocks.parseStatement.mockReturnValue([
      { date: '2026-01-01', amount: 1, description: 'Coffee', type: 'expense' },
    ])
    const execute = vi.fn()
    mocks.withTransaction.mockImplementation(
      (callback: (tx: TransactionClient) => Promise<unknown>) =>
        callback({
          query: vi.fn(async (sql: string) => {
            if (sql.includes('FROM accounts')) {
              return [
                {
                  currency: 'USD',
                  balance: 0,
                  account_mode: 'transactional',
                  is_archived: 0,
                },
              ]
            }
            if (sql.includes('FROM app_data_state')) {
              return [{ database_id: 'test-db', data_revision: 0 }]
            }
            throw new Error('duplicate lookup exploded')
          }),
          execute,
        } as unknown as TransactionClient)
    )

    const result = await importStatementFile(file(), 'account-1')

    expect(result).toMatchObject({ imported: 0, skipped: 0 })
    expect(result.errors).toEqual(['duplicate lookup exploded'])
    expect(execute).not.toHaveBeenCalled()
    expect(mocks.fetchTransactions).not.toHaveBeenCalled()
  })

  it('keeps a committed import successful when post-commit refresh fails', async () => {
    mocks.parseStatement.mockReturnValue([
      { date: '2026-01-01', amount: 1, description: 'Coffee', type: 'expense' },
    ])
    mocks.withTransaction.mockResolvedValue({ imported: 1, skipped: 0 })
    mocks.fetchTransactions.mockRejectedValue(new Error('refresh exploded'))

    const result = await importStatementFile(file(), 'account-1')

    expect(result).toEqual({
      imported: 1,
      skipped: 0,
      errors: [],
      mode: 'unreviewed_atomic',
    })
    expect(mocks.fetchTransactions).toHaveBeenCalledOnce()
    expect(mocks.fetchAccounts).toHaveBeenCalledOnce()
  })

  it('labels a failed token-bound apply as reviewed atomic', async () => {
    mocks.parseStatement.mockReturnValue([
      { date: '2026-01-01', amount: 1, description: 'Coffee', type: 'expense' },
    ])
    mocks.withTransaction.mockRejectedValue(new Error('stale revision'))

    const result = await importStatementFile(file(), 'account-1', {
      previewToken: 'sha256:stale',
    })

    expect(result).toEqual({
      imported: 0,
      skipped: 0,
      errors: ['stale revision'],
      mode: 'reviewed_atomic',
    })
  })
})
