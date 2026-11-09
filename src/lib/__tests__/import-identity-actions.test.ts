import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  commit: vi.fn(),
  transactions: vi.fn(),
  accounts: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/database', () => ({ withTransaction: mocks.commit, query: vi.fn() }))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: { getState: () => ({ fetch: mocks.transactions }) },
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: { getState: () => ({ fetch: mocks.accounts }) },
}))
vi.mock('@/lib/transaction-query-events', () => ({ invalidateTransactionPage: mocks.invalidate }))

import { bindLegacyImportIdentity } from '../import-identity-actions'

const input = {
  transactionId: 't',
  sourceNamespace: 'Bank',
  externalId: '007',
  previewToken: 'preview',
}
const committed = {
  binding: {
    transactionId: 't',
    importSource: 'Bank',
    importExternalId: '007',
    importContentFingerprint: null,
    originalContentVerified: false,
  },
  limitation: 'Original source content is unknown.',
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.commit.mockResolvedValue(committed)
  mocks.transactions.mockResolvedValue(undefined)
})

describe('legacy import identity completion policy', () => {
  it('invalidates after commit before its transaction-only delayed refresh', async () => {
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
    mocks.transactions.mockImplementation(() => {
      trace.push('transactions')
      return gate
    })
    const pending = bindLegacyImportIdentity(input).then((value) => {
      trace.push('resolve')
      return value
    })
    await vi.waitFor(() => expect(trace).toEqual(['commit', 'import', 'transactions']))
    release()
    expect(await pending).toEqual({ ...committed, refreshIncomplete: false })
    expect(trace).toEqual(['commit', 'import', 'transactions', 'resolve'])
    expect(mocks.accounts).not.toHaveBeenCalled()
  })

  it('retains committed identity with a separate warning when refresh rejects', async () => {
    mocks.transactions.mockRejectedValue(new Error('refresh failed'))
    expect(await bindLegacyImportIdentity(input)).toEqual({ ...committed, refreshIncomplete: true })
    expect(mocks.invalidate.mock.calls).toEqual([['import']])
    expect(mocks.accounts).not.toHaveBeenCalled()
  })

  it('retains the committed identity after a synchronous refresh throw', async () => {
    mocks.transactions.mockImplementation(() => {
      throw new Error('synchronous refresh failed')
    })
    await expect(bindLegacyImportIdentity(input)).resolves.toEqual({
      ...committed,
      refreshIncomplete: true,
    })
    expect(mocks.invalidate.mock.calls).toEqual([['import']])
    expect(mocks.accounts).not.toHaveBeenCalled()
  })

  it('does not invalidate or refresh a failed commit', async () => {
    mocks.commit.mockRejectedValue(new Error('commit failed'))
    await expect(bindLegacyImportIdentity(input)).rejects.toThrow('commit failed')
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(mocks.transactions).not.toHaveBeenCalled()
    expect(mocks.accounts).not.toHaveBeenCalled()
  })
})
