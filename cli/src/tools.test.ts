// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQuery, mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecute: vi.fn(),
  mockTransaction: vi.fn((fn: () => unknown) => fn()),
}))

vi.mock('./database.js', () => ({
  query: mockQuery,
  execute: mockExecute,
  transaction: mockTransaction,
  close: vi.fn(),
}))

vi.mock('./ulid.js', () => ({
  generateId: () => 'tx_test_123',
}))

const { tools } = await import('./tools.js')

const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!
const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!
const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
const createAccount = tools.find((tool) => tool.name === 'create-account')!
const writeNotebook = tools.find((tool) => tool.name === 'write-notebook')!
const listNotebook = tools.find((tool) => tool.name === 'list-notebook')!
const manageRecurringTransaction = tools.find(
  (tool) => tool.name === 'manage-recurring-transaction'
)!

describe('CLI tool validation regressions', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockExecute.mockReset()
    mockTransaction.mockClear()
    mockTransaction.mockImplementation((fn: () => unknown) => fn())
    mockExecute.mockReturnValue({ rowsAffected: 1, lastInsertId: 1 })
  })

  it('rejects impossible calendar dates', () => {
    const result = addTransaction.schema.safeParse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      date: '2024-02-30',
    })

    expect(result.success).toBe(false)
    expect(result.error.issues[0]?.message).toBe('Date must be a real calendar date')
  })

  it('rejects notebook traversal paths at the schema boundary', () => {
    const result = writeNotebook.schema.safeParse({
      path: '../outside.md',
      content: '# nope',
    })

    expect(result.success).toBe(false)
    expect(result.error.issues[0]?.message).toBe('Path must stay within the notebook')
  })

  it('allows root notebook listing but rejects absolute directory inputs', () => {
    expect(listNotebook.schema.safeParse({}).success).toBe(true)

    const result = listNotebook.schema.safeParse({ directory: '/etc' })

    expect(result.success).toBe(false)
    expect(result.error.issues[0]?.message).toBe('Path must stay within the notebook')
  })

  it('uses the explicit accountId for add-transaction', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-2' }])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'acct-2',
    })

    const result = await addTransaction.execute(input)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledWith('SELECT id FROM accounts WHERE id = $1 LIMIT 1', [
      'acct-2',
    ])
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      ['tx_test_123', 'acct-2', null, 'expense', 1000, 'Coffee', null, expect.any(String)]
    )
    expect(result.transaction.accountId).toBe('acct-2')
  })

  it('wraps add-transaction writes in a transaction', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-1', name: 'Primary' }])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
    })

    const result = await addTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      ['tx_test_123', 'acct-1', null, 'expense', 1000, 'Coffee', null, expect.any(String)]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-1000, 'acct-1']
    )
    expect(result).toMatchObject({
      success: true,
      transaction: {
        id: 'tx_test_123',
        accountId: 'acct-1',
        amount: 10,
        type: 'expense',
        description: 'Coffee',
      },
    })
  })

  it('requires accountId when multiple accounts exist for add-transaction', async () => {
    mockQuery.mockReturnValueOnce([
      { id: 'acct-1', name: 'Checking' },
      { id: 'acct-2', name: 'Savings' },
    ])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Multiple accounts found. Provide accountId explicitly so Shikin does not guess the wrong account.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects unknown categories instead of silently using Uncategorized', async () => {
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      category: 'Missing category',
      accountId: 'acct-1',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Category "Missing category" not found. Use list-categories to pick an existing category name.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects unsupported transfer creation in add-transaction', async () => {
    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'transfer',
      description: 'Move cash',
      accountId: 'acct-1',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Transfer transactions are not fully supported in the CLI yet. Record the withdrawal and deposit as separate entries with explicit account IDs.',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('returns account-not-found and performs no writes for missing explicit accountId', async () => {
    mockQuery.mockReturnValueOnce([])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'missing-account',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message: 'Account missing-account not found.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('allows update-transaction notes to be cleared with an empty string', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        description: 'Coffee',
        date: '2026-04-14',
        notes: 'old notes',
      },
    ])

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      notes: '',
    })

    await updateTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[0]
    )
    expect(mockExecute).toHaveBeenCalledTimes(3)
    expect(mockExecute.mock.calls[2]?.[1]).toEqual([
      1000,
      'expense',
      'Coffee',
      null,
      '2026-04-14',
      null,
      'acct-1',
      'tx-1',
    ])
  })

  it('rejects an invalid destination account before applying balance changes', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-1',
          amount: 1000,
          type: 'expense',
          account_id: 'acct-1',
          category_id: null,
          description: 'Coffee',
          date: '2026-04-14',
          notes: 'old notes',
        },
      ])
      .mockReturnValueOnce([])

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      accountId: 'missing-account',
    })

    const result = await updateTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[0]
    )
    expect(mockQuery).toHaveBeenNthCalledWith(2, 'SELECT id FROM accounts WHERE id = $1 LIMIT 1', [
      'missing-account',
    ])
    expect(result).toEqual({
      success: false,
      message: 'Account missing-account not found.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects unknown categories on update before applying writes', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        description: 'Coffee',
        date: '2026-04-14',
        notes: null,
      },
    ])
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([])

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      category: 'Missing category',
    })

    const result = await updateTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Category "Missing category" not found. Use list-categories to pick an existing category name.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('requires explicit accountId when creating a recurring rule with multiple accounts', async () => {
    mockQuery.mockReturnValueOnce([
      { id: 'acct-1', name: 'Checking' },
      { id: 'acct-2', name: 'Savings' },
    ])

    const input = manageRecurringTransaction.schema.parse({
      action: 'create',
      description: 'Rent',
      amount: 1000,
      type: 'expense',
      frequency: 'monthly',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Multiple accounts found. Provide accountId explicitly so Shikin does not guess the wrong account.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('uses the explicit accountId when creating a recurring rule', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-2' }])

    const input = manageRecurringTransaction.schema.parse({
      action: 'create',
      description: 'Rent',
      amount: 1000,
      type: 'expense',
      frequency: 'monthly',
      accountId: 'acct-2',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(mockQuery).toHaveBeenCalledWith('SELECT id FROM accounts WHERE id = $1 LIMIT 1', [
      'acct-2',
    ])
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO recurring_rules'),
      [
        'tx_test_123',
        'Rent',
        100000,
        'expense',
        'monthly',
        expect.any(String),
        null,
        'acct-2',
        null,
        null,
      ]
    )
    expect(result).toMatchObject({
      success: true,
      rule: {
        id: 'tx_test_123',
        description: 'Rent',
        amount: 1000,
        type: 'expense',
        frequency: 'monthly',
      },
    })
  })

  it('rejects unsupported transfer recurring rules', async () => {
    const input = manageRecurringTransaction.schema.parse({
      action: 'create',
      description: 'Move to savings',
      amount: 100,
      type: 'transfer',
      frequency: 'monthly',
      accountId: 'acct-1',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Transfer transactions are not fully supported in the CLI yet. Record the withdrawal and deposit as separate entries with explicit account IDs.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('wraps update-transaction balance and row writes in a transaction', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        description: 'Coffee',
        date: '2026-04-14',
        notes: 'old notes',
      },
    ])

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      amount: 12,
      description: 'Lunch',
    })

    const result = await updateTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      mockQuery.mock.invocationCallOrder[0]
    )
    expect(mockExecute).toHaveBeenCalledTimes(3)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE accounts SET balance = balance - $1'),
      [-1000, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-1200, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE transactions'), [
      1200,
      'expense',
      'Lunch',
      null,
      '2026-04-14',
      'old notes',
      'acct-1',
      'tx-1',
    ])
    expect(result).toMatchObject({
      success: true,
      transaction: {
        id: 'tx-1',
        amount: 12,
        type: 'expense',
        description: 'Lunch',
        date: '2026-04-14',
      },
    })
  })

  it('aborts update-transaction when the final row update does not affect exactly one row', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        description: 'Coffee',
        date: '2026-04-14',
        notes: 'old notes',
      },
    ])
    mockExecute
      .mockReturnValueOnce({ rowsAffected: 1, lastInsertId: 1 })
      .mockReturnValueOnce({ rowsAffected: 1, lastInsertId: 1 })
      .mockReturnValueOnce({ rowsAffected: 0, lastInsertId: 1 })

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      amount: 12,
    })

    await expect(updateTransaction.execute(input)).rejects.toThrow(
      'Transaction tx-1 could not be updated safely.'
    )
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(3)
  })

  it('wraps delete-transaction balance and row deletion in a transaction', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        description: 'Coffee',
        date: '2026-04-14',
      },
    ])

    const input = deleteTransaction.schema.parse({
      transactionId: 'tx-1',
    })

    const result = await deleteTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM transactions WHERE id = $1', ['tx-1'])
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE accounts SET balance = balance - $1'),
      [-1000, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'DELETE FROM transactions WHERE id = $1', [
      'tx-1',
    ])
    expect(result).toEqual({
      success: true,
      message: 'Deleted expense: $10.00 "Coffee" from 2026-04-14',
    })
  })

  it('still accepts non-fiat account asset codes like USDT', () => {
    const parsed = createAccount.schema.parse({
      name: 'Crypto Wallet',
      type: 'crypto',
      currency: 'usdt',
    })

    expect(parsed.currency).toBe('USDT')
  })
})
