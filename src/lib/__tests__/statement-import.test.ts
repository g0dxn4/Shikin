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

    expect(result).toMatchObject({ success: false, previewToken: null, imported: 0, skipped: 0 })
    expect(result.errors).toEqual(['database unavailable'])
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
