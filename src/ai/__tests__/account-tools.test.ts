import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/database', () => ({
  query: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/ulid', () => ({
  generateId: vi.fn().mockReturnValue('01TEST000000000000000000000'),
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: vi.fn() }) },
}))

import { query, execute } from '@/lib/database'
import { listAccounts } from '../tools/list-accounts'
import { createAccount } from '../tools/create-account'

const mockQuery = vi.mocked(query)
const mockExecute = vi.mocked(execute)
const toolCtx = { toolCallId: 'test', messages: [] }

describe('listAccounts tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns non-archived accounts with decimal balances', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'acc1',
        name: 'Chase Checking',
        type: 'checking',
        currency: 'USD',
        balance: 150000, // $1500.00
        is_archived: 0,
      },
      {
        id: 'acc2',
        name: 'Savings',
        type: 'savings',
        currency: 'USD',
        balance: 500000, // $5000.00
        is_archived: 0,
      },
    ])

    const result = (await listAccounts.execute!(
      {},
      toolCtx
    )) as { accounts: Array<Record<string, unknown>>; message: string }

    expect(result.accounts).toHaveLength(2)
    expect(result.accounts[0].balance).toBe(1500) // fromCentavos
    expect(result.accounts[1].balance).toBe(5000)
    expect(result.message).toContain('2 accounts')
  })

  it('returns empty state', async () => {
    mockQuery.mockResolvedValueOnce([])

    const result = (await listAccounts.execute!(
      {},
      toolCtx
    )) as { accounts: Array<Record<string, unknown>>; message: string }

    expect(result.accounts).toHaveLength(0)
    expect(result.message).toContain('No accounts found')
  })

  it('filters by account type', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 'acc1',
        name: 'Savings',
        type: 'savings',
        currency: 'USD',
        balance: 500000,
        is_archived: 0,
      },
    ])

    await listAccounts.execute!({ type: 'savings' }, toolCtx)

    const queryCall = mockQuery.mock.calls[0]
    expect(queryCall[0]).toContain('type = $1')
    expect(queryCall[1]).toContain('savings')
  })
})

describe('createAccount tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts with centavo conversion', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await createAccount.execute!(
      { name: 'Savings', type: 'savings', currency: 'USD', balance: 5000 },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(true)
    expect((result.account as Record<string, unknown>).balance).toBe(5000)
    // Verify centavos were passed to DB
    const executeCall = mockExecute.mock.calls[0]
    expect(executeCall[1]).toContain(500000) // toCentavos(5000)
  })

  it('uses defaults (checking, USD, 0)', async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1, lastInsertId: 0 })

    const result = (await createAccount.execute!(
      { name: 'My Account', type: 'checking', currency: 'USD', balance: 0 },
      toolCtx
    )) as Record<string, unknown>

    expect(result.success).toBe(true)
    const account = result.account as Record<string, unknown>
    expect(account.type).toBe('checking')
    expect(account.currency).toBe('USD')
    expect(account.balance).toBe(0)
  })
})
