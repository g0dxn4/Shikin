// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'

const { mockQuery, mockExecute, mockTransaction, mockNoteExists, mockWriteNote } = vi.hoisted(
  () => ({
    mockQuery: vi.fn(),
    mockExecute: vi.fn(),
    mockTransaction: vi.fn((fn: () => unknown) => fn()),
    mockNoteExists: vi.fn(),
    mockWriteNote: vi.fn(),
  })
)

vi.mock('./database.js', () => ({
  query: mockQuery,
  execute: mockExecute,
  transaction: mockTransaction,
  close: vi.fn(),
}))

vi.mock('./ulid.js', () => ({
  generateId: () => 'tx_test_123',
}))

vi.mock('./notebook.js', () => ({
  readNote: vi.fn(),
  writeNote: mockWriteNote,
  appendNote: vi.fn(),
  noteExists: mockNoteExists,
  listNotes: vi.fn(async () => []),
  deleteNote: vi.fn(),
}))

const { tools } = await import('./tools.js')

const addTransaction = tools.find((tool) => tool.name === 'add-transaction')!
const updateTransaction = tools.find((tool) => tool.name === 'update-transaction')!
const deleteTransaction = tools.find((tool) => tool.name === 'delete-transaction')!
const createAccount = tools.find((tool) => tool.name === 'create-account')!
const updateAccount = tools.find((tool) => tool.name === 'update-account')!
const getSpendingSummary = tools.find((tool) => tool.name === 'get-spending-summary')!
const writeNotebook = tools.find((tool) => tool.name === 'write-notebook')!
const listNotebook = tools.find((tool) => tool.name === 'list-notebook')!
const manageRecurringTransaction = tools.find(
  (tool) => tool.name === 'manage-recurring-transaction'
)!
const materializeRecurring = tools.find((tool) => tool.name === 'materialize-recurring')!
const manageCategoryRules = tools.find((tool) => tool.name === 'manage-category-rules')!
const getSpendingAnomalies = tools.find((tool) => tool.name === 'get-spending-anomalies')!
const listSubscriptions = tools.find((tool) => tool.name === 'list-subscriptions')!
const getSubscriptionSpending = tools.find((tool) => tool.name === 'get-subscription-spending')!
const getFinancialNews = tools.find((tool) => tool.name === 'get-financial-news')!
const getCongressionalTrades = tools.find((tool) => tool.name === 'get-congressional-trades')!
const getBalanceOverview = tools.find((tool) => tool.name === 'get-balance-overview')!
const analyzeSpendingTrends = tools.find((tool) => tool.name === 'analyze-spending-trends')!
const getForecastedCashFlow = tools.find((tool) => tool.name === 'get-forecasted-cash-flow')!
const getFinancialHealthScore = tools.find((tool) => tool.name === 'get-financial-health-score')!
const getSpendingRecap = tools.find((tool) => tool.name === 'get-spending-recap')!
const getEducationTip = tools.find((tool) => tool.name === 'get-education-tip')!
const generatePortfolioReview = tools.find((tool) => tool.name === 'generate-portfolio-review')!
const convertCurrency = tools.find((tool) => tool.name === 'convert-currency')!
const lastSixMonthLabels = Array.from({ length: 6 }, (_, index) =>
  dayjs()
    .subtract(5 - index, 'month')
    .format('YYYY-MM')
)

describe('CLI tool validation regressions', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockExecute.mockReset()
    mockTransaction.mockClear()
    mockNoteExists.mockReset()
    mockWriteNote.mockReset()
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
    if (result.success) {
      throw new Error('Expected schema validation to fail for an impossible date')
    }
    expect(result.error.issues[0]?.message).toBe('Date must be a real calendar date')
  })

  it('rejects notebook traversal paths at the schema boundary', () => {
    const result = writeNotebook.schema.safeParse({
      path: '../outside.md',
      content: '# nope',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected notebook path validation to fail for traversal input')
    }
    expect(result.error.issues[0]?.message).toBe('Path must stay within the notebook')
  })

  it('allows root notebook listing but rejects absolute directory inputs', () => {
    expect(listNotebook.schema.safeParse({}).success).toBe(true)

    const result = listNotebook.schema.safeParse({ directory: '/etc' })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected notebook path validation to fail for absolute input')
    }
    expect(result.error.issues[0]?.message).toBe('Path must stay within the notebook')
  })

  it('uses the explicit accountId for add-transaction', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-2', currency: 'EUR' }])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'acct-2',
    })

    const result = await addTransaction.execute(input)

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT id, currency FROM accounts WHERE id = $1 LIMIT 1',
      ['acct-2']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      ['tx_test_123', 'acct-2', null, 'expense', 1000, 'EUR', 'Coffee', null, expect.any(String)]
    )
    expect(result.transaction.accountId).toBe('acct-2')
  })

  it('wraps add-transaction writes in a transaction', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-1', name: 'Primary', currency: 'BRL' }])

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
      ['tx_test_123', 'acct-1', null, 'expense', 1000, 'BRL', 'Coffee', null, expect.any(String)]
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

  it('rejects ambiguous category matches instead of guessing', async () => {
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([
      { id: 'cat-1', name: 'Food' },
      { id: 'cat-2', name: 'Food & Dining' },
    ])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      category: 'Food',
      accountId: 'acct-1',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Category "Food" matches multiple categories (Food, Food & Dining). Use a more specific existing category name.',
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

  it('returns a per-currency spending summary for mixed-currency ledgers', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', category_name: 'Food', total: 12000, count: 3 },
        { currency: 'EUR', category_name: 'Travel', total: 9000, count: 1 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 12000 },
        { currency: 'USD', type: 'income', total: 50000 },
        { currency: 'EUR', type: 'expense', total: 9000 },
        { currency: 'EUR', type: 'income', total: 0 },
      ])

    const result = await getSpendingSummary.execute({ period: 'month' })

    expect(result).toMatchObject({
      mixedCurrency: true,
      totalExpenses: null,
      totalIncome: null,
      netSavings: null,
      totalsByCurrency: [
        { currency: 'EUR', totalExpenses: 90, totalIncome: 0, netSavings: -90 },
        { currency: 'USD', totalExpenses: 120, totalIncome: 500, netSavings: 380 },
      ],
      byCategory: [
        expect.objectContaining({ currency: 'USD', category: 'Food', amount: 120 }),
        expect.objectContaining({ currency: 'EUR', category: 'Travel', amount: 90 }),
      ],
    })
    expect(result.message).toContain('no FX conversion was applied')
  })

  it('fails spending summary when aggregate rows have missing currency', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          currency: null,
          category_id: null,
          category_name: 'Uncategorized',
          total: 1200,
          count: 1,
        },
      ])
      .mockReturnValueOnce([])

    const result = await getSpendingSummary.execute({ period: 'month' })

    expect(result).toEqual({
      success: false,
      reason: 'repair_needed_missing_currency',
      message:
        'Spending summary encountered rows with missing currency. Repair or recreate the affected data before using this summary.',
    })
  })

  it('returns zero top-level spending totals for an empty period', async () => {
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([])

    const result = await getSpendingSummary.execute({ period: 'month' })

    expect(result).toMatchObject({
      mixedCurrency: false,
      totalExpenses: 0,
      totalIncome: 0,
      netSavings: 0,
      totalsByCurrency: [],
      byCategory: [],
    })
    expect(result.message).toContain('No expenses found')
  })

  it('fails fast when a custom spending summary omits one boundary date', async () => {
    const result = await getSpendingSummary.execute({ period: 'custom', startDate: '2026-01-01' })

    expect(result).toEqual({
      success: false,
      message: 'Custom spending summaries require both startDate and endDate.',
    })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('fails fast when a custom spending summary range is inverted', async () => {
    const result = await getSpendingSummary.execute({
      period: 'custom',
      startDate: '2026-02-01',
      endDate: '2026-01-01',
    })

    expect(result).toEqual({
      success: false,
      message: 'Custom spending summaries require startDate to be on or before endDate.',
    })
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('uses an inclusive 7-day window for weekly spending summaries', async () => {
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([])

    const result = await getSpendingSummary.execute({ period: 'week' })

    expect(dayjs(result.period.end).diff(dayjs(result.period.start), 'day')).toBe(6)
  })

  it('keeps real Uncategorized categories distinct from uncategorized transactions', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          currency: 'USD',
          category_id: null,
          category_name: 'Uncategorized',
          total: 1200,
          count: 1,
        },
        {
          currency: 'USD',
          category_id: 'cat-uncat',
          category_name: 'Uncategorized',
          total: 800,
          count: 2,
        },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 2000 },
        { currency: 'USD', type: 'income', total: 0 },
      ])

    const result = await getSpendingSummary.execute({ period: 'month' })

    expect(result.byCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Uncategorized', categoryKey: '__uncategorized__' }),
        expect.objectContaining({
          category: 'Uncategorized (category)',
          categoryKey: 'cat-uncat',
        }),
      ])
    )
  })

  it('returns a per-currency balance overview for mixed-currency ledgers', async () => {
    mockQuery
      .mockReturnValueOnce([
        { id: 'acct-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
        { id: 'acct-eur', name: 'Travel', type: 'cash', currency: 'EUR', balance: 50000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', total_income: 50000, total_expenses: 12000 },
        { currency: 'EUR', total_income: 0, total_expenses: 9000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', total_income: 45000, total_expenses: 15000 },
        { currency: 'EUR', total_income: 0, total_expenses: 7000 },
      ])

    const result = await getBalanceOverview.execute({})

    expect(result).toMatchObject({
      mixedCurrency: true,
      totalBalance: null,
      totalsByCurrency: [
        { currency: 'EUR', totalBalance: 500 },
        { currency: 'USD', totalBalance: 1000 },
      ],
      monthlyChange: {
        current: null,
        previous: null,
        trend: null,
      },
      monthlyChangeByCurrency: [
        { currency: 'EUR', current: -90, previous: -70, trend: 'down' },
        { currency: 'USD', current: 380, previous: 300, trend: 'up' },
      ],
    })
    expect(result.message).toContain('no FX conversion was applied')
  })

  it('does not expose top-level monthlyChange when single balance and monthly-change currencies differ', async () => {
    mockQuery
      .mockReturnValueOnce([
        { id: 'acct-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ])
      .mockReturnValueOnce([{ currency: 'EUR', total_income: 50000, total_expenses: 12000 }])
      .mockReturnValueOnce([])

    const result = await getBalanceOverview.execute({})

    expect(result).toMatchObject({
      mixedCurrency: true,
      totalBalance: 1000,
      monthlyChange: {
        current: null,
        previous: null,
        trend: null,
      },
      totalsByCurrency: [{ currency: 'USD', totalBalance: 1000 }],
    })
    expect(result.monthlyChangeByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EUR', current: 380, previous: 0, trend: 'up' },
        { currency: 'USD', current: 0, previous: 0, trend: 'stable' },
      ])
    )
    expect(result.message).toContain('no FX conversion was applied')
  })

  it('fails balance overview when aggregate rows have missing currency', async () => {
    mockQuery
      .mockReturnValueOnce([
        { id: 'acct-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      ])
      .mockReturnValueOnce([{ currency: null, total_income: 50000, total_expenses: 12000 }])
      .mockReturnValueOnce([])

    const result = await getBalanceOverview.execute({})

    expect(result).toEqual({
      success: false,
      reason: 'repair_needed_missing_currency',
      message:
        'Balance overview encountered rows with missing currency. Repair or recreate the affected data before using this summary.',
    })
  })

  it('returns 0/0/stable monthly change for a single-currency idle ledger', async () => {
    mockQuery.mockReturnValueOnce([
      { id: 'acct-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
    ])
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([])

    const result = await getBalanceOverview.execute({})

    expect(result).toMatchObject({
      mixedCurrency: false,
      totalBalance: 1000,
      monthlyChange: {
        current: 0,
        previous: 0,
        trend: 'stable',
      },
      monthlyChangeByCurrency: [{ currency: 'USD', current: 0, previous: 0, trend: 'stable' }],
    })
  })

  it('includes idle currencies in monthlyChangeByCurrency with 0/0/stable defaults', async () => {
    mockQuery.mockReturnValueOnce([
      { id: 'acct-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
      { id: 'acct-eur', name: 'Travel', type: 'cash', currency: 'EUR', balance: 50000 },
    ])
    mockQuery
      .mockReturnValueOnce([{ currency: 'USD', total_income: 50000, total_expenses: 12000 }])
      .mockReturnValueOnce([{ currency: 'USD', total_income: 45000, total_expenses: 15000 }])

    const result = await getBalanceOverview.execute({})

    expect(result.monthlyChangeByCurrency).toEqual(
      expect.arrayContaining([
        { currency: 'EUR', current: 0, previous: 0, trend: 'stable' },
        { currency: 'USD', current: 380, previous: 300, trend: 'up' },
      ])
    )
  })

  it('ignores archived-account transaction currencies in balance overview monthly change', async () => {
    const currentMonthStart = dayjs().startOf('month').format('YYYY-MM-DD')

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM accounts WHERE is_archived = 0 ORDER BY name')) {
        return [
          { id: 'acct-usd', name: 'Checking', type: 'checking', currency: 'USD', balance: 100000 },
        ]
      }
      if (sql.includes('JOIN accounts a ON a.id = t.account_id') && Array.isArray(params)) {
        if (params[0] === currentMonthStart) {
          return [{ currency: 'USD', total_income: 50000, total_expenses: 12000 }]
        }
        return []
      }

      return []
    })

    const result = await getBalanceOverview.execute({})

    const aggregateQueries = mockQuery.mock.calls
      .map(([sql]) => sql)
      .filter(
        (sql): sql is string =>
          typeof sql === 'string' && sql.includes('JOIN accounts a ON a.id = t.account_id')
      )
    expect(aggregateQueries).toHaveLength(2)
    expect(aggregateQueries[0]).toContain('t.currency')
    expect(aggregateQueries[0]).toContain('t.type')
    expect(aggregateQueries[0]).toContain('t.amount')
    expect(aggregateQueries[0]).toContain('t.date')

    expect(result).toMatchObject({
      mixedCurrency: false,
      totalBalance: 1000,
      monthlyChange: {
        current: 380,
        previous: 0,
        trend: 'up',
      },
      monthlyChangeByCurrency: [{ currency: 'USD', current: 380, previous: 0, trend: 'up' }],
    })
  })

  it('returns per-currency spending trends for mixed-currency ledgers', async () => {
    mockQuery
      .mockReturnValueOnce([
        { month: '2026-03', currency: 'USD', category_name: 'Food', total: 10000 },
        { month: '2026-04', currency: 'USD', category_name: 'Food', total: 13000 },
        { month: '2026-03', currency: 'EUR', category_name: 'Travel', total: 5000 },
        { month: '2026-04', currency: 'EUR', category_name: 'Travel', total: 7000 },
      ])
      .mockReturnValueOnce([
        { month: '2026-03', currency: 'USD', total_expenses: 10000, total_income: 40000 },
        { month: '2026-04', currency: 'USD', total_expenses: 13000, total_income: 42000 },
        { month: '2026-03', currency: 'EUR', total_expenses: 5000, total_income: 0 },
        { month: '2026-04', currency: 'EUR', total_expenses: 7000, total_income: 0 },
      ])

    const result = await analyzeSpendingTrends.execute({ months: 2 })

    expect(result.mixedCurrency).toBe(true)
    expect(result.months).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ month: '2026-03', currency: 'EUR', totalExpenses: 50 }),
        expect.objectContaining({ month: '2026-03', currency: 'USD', totalExpenses: 100 }),
        expect.objectContaining({ month: '2026-04', currency: 'EUR', totalExpenses: 70 }),
        expect.objectContaining({ month: '2026-04', currency: 'USD', totalExpenses: 130 }),
      ])
    )
    expect(result.trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'EUR',
          category: 'Travel',
          direction: 'up',
          changePercent: 40,
        }),
        expect.objectContaining({
          currency: 'USD',
          category: 'Food',
          direction: 'up',
          changePercent: 30,
        }),
      ])
    )
    expect(result.message).toContain('currency field on months and trends')
  })

  it('fails spending trends when aggregate rows have missing currency', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          month: '2026-03',
          currency: null,
          category_id: null,
          category_name: 'Uncategorized',
          total: 10000,
        },
      ])
      .mockReturnValueOnce([])

    const result = await analyzeSpendingTrends.execute({ months: 2 })

    expect(result).toEqual({
      success: false,
      reason: 'repair_needed_missing_currency',
      message:
        'Spending trends encountered rows with missing currency. Repair or recreate the affected data before using this summary.',
    })
  })

  it('does not emit month-over-month trends when months are not consecutive', async () => {
    mockQuery
      .mockReturnValueOnce([
        { month: '2026-02', currency: 'USD', category_name: 'Food', total: 10000 },
        { month: '2026-04', currency: 'USD', category_name: 'Food', total: 13000 },
      ])
      .mockReturnValueOnce([
        { month: '2026-02', currency: 'USD', total_expenses: 10000, total_income: 40000 },
        { month: '2026-04', currency: 'USD', total_expenses: 13000, total_income: 42000 },
      ])

    const result = await analyzeSpendingTrends.execute({ months: 3 })

    expect(result.mixedCurrency).toBe(false)
    expect(result.trends).toEqual([])
  })

  it('ignores a latest month that only contains transfers when selecting trend months', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          month: '2026-03',
          currency: 'USD',
          category_id: 'cat-food',
          category_name: 'Food',
          total: 10000,
        },
        {
          month: '2026-04',
          currency: 'USD',
          category_id: 'cat-food',
          category_name: 'Food',
          total: 13000,
        },
      ])
      .mockReturnValueOnce([
        { month: '2026-03', currency: 'USD', total_expenses: 10000, total_income: 40000 },
        { month: '2026-04', currency: 'USD', total_expenses: 13000, total_income: 42000 },
      ])

    const result = await analyzeSpendingTrends.execute({ months: 3 })

    const aggregateQuery = mockQuery.mock.calls[1]?.[0]
    expect(aggregateQuery).toContain("type IN ('income', 'expense')")
    expect(result.months).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ month: '2026-03', currency: 'USD' }),
        expect.objectContaining({ month: '2026-04', currency: 'USD' }),
      ])
    )
    expect(result.months).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ month: '2026-05' })])
    )
    expect(result.trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'USD',
          category: 'Food',
          direction: 'up',
          changePercent: 30,
        }),
      ])
    )
  })

  it('keeps real Uncategorized categories distinct from null-category rows in spending trends', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          month: '2026-03',
          currency: 'USD',
          category_id: null,
          category_name: 'Uncategorized',
          total: 10000,
        },
        {
          month: '2026-04',
          currency: 'USD',
          category_id: 'cat-uncat',
          category_name: 'Uncategorized',
          total: 13000,
        },
      ])
      .mockReturnValueOnce([
        { month: '2026-03', currency: 'USD', total_expenses: 10000, total_income: 40000 },
        { month: '2026-04', currency: 'USD', total_expenses: 13000, total_income: 42000 },
      ])

    const result = await analyzeSpendingTrends.execute({ months: 2 })

    expect(result.trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'Uncategorized', changeType: 'disappeared' }),
        expect.objectContaining({ category: 'Uncategorized (category)', changeType: 'new' }),
      ])
    )
  })

  it('reports new and disappeared categories in spending trends', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          month: '2026-03',
          currency: 'USD',
          category_id: 'cat-food',
          category_name: 'Food',
          total: 10000,
        },
        {
          month: '2026-04',
          currency: 'USD',
          category_id: 'cat-travel',
          category_name: 'Travel',
          total: 13000,
        },
      ])
      .mockReturnValueOnce([
        { month: '2026-03', currency: 'USD', total_expenses: 10000, total_income: 40000 },
        { month: '2026-04', currency: 'USD', total_expenses: 13000, total_income: 42000 },
      ])

    const result = await analyzeSpendingTrends.execute({ months: 2 })

    expect(result.trends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          currency: 'USD',
          category: 'Travel',
          direction: 'up',
          changePercent: null,
          changeType: 'new',
        }),
        expect.objectContaining({
          currency: 'USD',
          category: 'Food',
          direction: 'down',
          changePercent: null,
          changeType: 'disappeared',
        }),
      ])
    )
    expect(result.message).toContain('Travel is new this month')
    expect(result.message).toContain('Food disappeared this month')
  })

  it('returns active subscriptions with monthly and yearly rollups', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'sub-1',
        name: 'Netflix',
        amount: 1599,
        currency: 'USD',
        billing_cycle: 'monthly',
        next_billing_date: '2026-05-01',
        is_active: 1,
        category_name: 'Subscriptions',
        account_name: 'Checking',
      },
    ])

    const result = await listSubscriptions.execute({ activeOnly: true })

    expect(result).toMatchObject({
      success: true,
      summary: {
        count: 1,
        activeCount: 1,
        inactiveCount: 0,
        monthlyTotal: 15.99,
        yearlyTotal: 191.88,
      },
      subscriptions: [
        expect.objectContaining({
          name: 'Netflix',
          amount: 15.99,
          monthlyAmount: 15.99,
          yearlyAmount: 191.88,
        }),
      ],
    })
  })

  it('aggregates subscription equivalents before rounding totals', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'sub-1',
        name: 'Quarterly A',
        amount: 1000,
        currency: 'USD',
        billing_cycle: 'quarterly',
        next_billing_date: '2026-05-01',
        is_active: 1,
        category_name: 'Subscriptions',
        account_name: 'Checking',
      },
      {
        id: 'sub-2',
        name: 'Quarterly B',
        amount: 1000,
        currency: 'USD',
        billing_cycle: 'quarterly',
        next_billing_date: '2026-05-01',
        is_active: 1,
        category_name: 'Subscriptions',
        account_name: 'Checking',
      },
      {
        id: 'sub-3',
        name: 'Quarterly C',
        amount: 1000,
        currency: 'USD',
        billing_cycle: 'quarterly',
        next_billing_date: '2026-05-01',
        is_active: 1,
        category_name: 'Subscriptions',
        account_name: 'Checking',
      },
    ])

    const result = await listSubscriptions.execute({ activeOnly: true })

    expect(result.summary).toMatchObject({
      monthlyTotal: 10,
      yearlyTotal: 120,
    })
  })

  it('keeps subscription spending rollups partitioned by currency', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'sub-usd',
        name: 'Netflix',
        amount: 1500,
        currency: 'USD',
        billing_cycle: 'monthly',
        next_billing_date: '2026-05-01',
        is_active: 1,
        category_name: 'Entertainment',
        account_name: 'Checking',
      },
      {
        id: 'sub-eur',
        name: 'Spotify',
        amount: 1200,
        currency: 'EUR',
        billing_cycle: 'monthly',
        next_billing_date: '2026-05-02',
        is_active: 1,
        category_name: 'Entertainment',
        account_name: 'Checking',
      },
    ])

    const result = await getSubscriptionSpending.execute({})

    expect(result).toMatchObject({
      success: true,
      categories: [
        expect.objectContaining({ currency: 'EUR', category: 'Entertainment', monthlyTotal: 12 }),
        expect.objectContaining({ currency: 'USD', category: 'Entertainment', monthlyTotal: 15 }),
      ],
      billingCycles: [
        expect.objectContaining({ currency: 'EUR', billingCycle: 'monthly', monthlyTotal: 12 }),
        expect.objectContaining({ currency: 'USD', billingCycle: 'monthly', monthlyTotal: 15 }),
      ],
      summary: {
        monthlyTotal: null,
        yearlyTotal: null,
        totalsByCurrency: [
          expect.objectContaining({ currency: 'EUR', monthlyTotal: 12 }),
          expect.objectContaining({ currency: 'USD', monthlyTotal: 15 }),
        ],
      },
    })
  })

  it('keeps placeholder financial news tool available with a structured unavailable response', async () => {
    const result = await getFinancialNews.execute({ symbol: 'AAPL', days: 7 })

    expect(result).toEqual({
      success: false,
      message:
        'Financial news is not available in this release surface. External news feeds are not configured yet.',
      error:
        'Financial news is not available in this release surface. External news feeds are not configured yet.',
      errorType: 'unavailable_error',
    })
  })

  it('keeps placeholder congressional trades tool available with a structured unavailable response', async () => {
    const result = await getCongressionalTrades.execute({ symbol: 'AAPL', days: 30 })

    expect(result).toEqual({
      success: false,
      message:
        'Congressional trades are not available in this release surface. External data feeds are not configured yet.',
      error:
        'Congressional trades are not available in this release surface. External data feeds are not configured yet.',
      errorType: 'unavailable_error',
    })
  })

  it('detects large transactions as spending anomalies', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('t.amount >= $1')) {
        return [
          {
            id: 'tx-large',
            description: 'Laptop',
            amount: 150000,
            currency: 'USD',
            date: '2026-04-15',
            category_id: null,
            category_name: 'Uncategorized',
            type: 'expense',
          },
        ]
      }
      return []
    })

    const result = await getSpendingAnomalies.execute({ largeTransactionThreshold: 500 })

    expect(result).toMatchObject({
      success: true,
      totalAnomalies: 1,
      largeTransactionThresholdCurrencyMode: 'per_transaction_currency',
      bySeverity: { high: 1, medium: 0, low: 0 },
      anomalies: [
        expect.objectContaining({
          type: 'large_transaction',
          title: 'Large transaction: Laptop',
          amount: 1500,
        }),
      ],
    })
  })

  it('documents large-transaction thresholds as per-currency in the schema', () => {
    expect(getSpendingAnomalies.schema.shape.largeTransactionThreshold.description).toContain(
      'interpreted independently in each transaction’s own currency'
    )
  })

  it('does not group anomalies across currencies and formats anomaly amounts correctly', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT DISTINCT currency')) {
        return [{ currency: 'EUR' }, { currency: 'USD' }]
      }

      if (
        sql.includes("WHERE t.type = 'expense' AND t.date >= $1") &&
        sql.includes('ORDER BY t.date DESC')
      ) {
        return [
          {
            id: 'tx-eur-1',
            description: 'Metro Pass',
            amount: 12000,
            currency: 'EUR',
            date: '2026-04-15',
            category_id: 'cat-1',
            category_name: 'Transport',
            type: 'expense',
          },
        ]
      }

      if (sql.includes("WHERE description = $1 AND currency = $2 AND type = 'expense'")) {
        return [{ amount: 4000 }, { amount: 4100 }, { amount: 3900 }]
      }

      if (sql.includes('GROUP BY t.currency, t.category_id')) {
        return []
      }

      if (sql.includes('GROUP BY description, currency')) {
        return []
      }

      if (sql.includes('t.amount >= $1')) {
        return [
          {
            id: 'tx-eur-2',
            description: 'Bike Repair',
            amount: 90000,
            currency: 'EUR',
            date: '2026-04-16',
            category_id: 'cat-2',
            category_name: 'Transport',
            type: 'expense',
          },
        ]
      }

      return []
    })

    const result = await getSpendingAnomalies.execute({ largeTransactionThreshold: 500 })

    expect(result.anomalies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'unusual_amount',
          description: expect.stringContaining('€120.00'),
        }),
        expect.objectContaining({
          type: 'large_transaction',
          description: expect.stringContaining('€900.00'),
        }),
      ])
    )
    expect(result.largeTransactionThresholdCurrencyMode).toBe('per_transaction_currency')
    expect(result.message).toContain(
      'Large-transaction thresholds were evaluated independently within each currency'
    )
    expect(
      result.anomalies.some((anomaly: { type: string }) => anomaly.type === 'duplicate_charge')
    ).toBe(false)
  })

  it('generates forecast output from balances and daily averages', async () => {
    mockQuery
      .mockReturnValueOnce([{ currency: 'USD', total: 100000 }])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'income', avg_daily: 5000 },
        { currency: 'USD', type: 'expense', avg_daily: 3000 },
      ])
      .mockReturnValueOnce([])

    const result = await getForecastedCashFlow.execute({ days: 2 })

    expect(result).toMatchObject({
      success: true,
      forecast: {
        currentBalance: 1000,
        dailyBurnRate: 30,
        dailyIncome: 50,
      },
    })
    expect(result.forecast.points).toHaveLength(3)
  })

  it('bases cash-flow forecast only on cash-like account balances', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (
        sql.includes('FROM accounts') &&
        sql.includes("type IN ('checking', 'savings', 'cash')")
      ) {
        return [{ currency: 'USD', total: 200000 }]
      }
      if (sql.includes('FROM accounts')) {
        return [{ currency: 'USD', total: 350000 }]
      }
      if (sql.includes('CAST(SUM(amount) AS REAL) / 90.0')) {
        return [
          { currency: 'USD', type: 'income', avg_daily: 5000 },
          { currency: 'USD', type: 'expense', avg_daily: 3000 },
        ]
      }
      if (sql.includes('FROM subscriptions')) {
        return []
      }

      return []
    })

    const result = await getForecastedCashFlow.execute({ days: 1 })

    expect(result).toMatchObject({
      success: true,
      forecast: expect.objectContaining({ currentBalance: 2000 }),
    })
  })

  it('returns a financial health score with weighted subscores', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', type: 'income', total: 500000 },
        { currency: 'USD', type: 'expense', total: 300000 },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ currency: 'USD', total: 900000 }])
      .mockReturnValueOnce([{ currency: 'USD', total: 900000 }])
      .mockReturnValueOnce([
        { month: lastSixMonthLabels[0], currency: 'USD', total: 300000 },
        { month: lastSixMonthLabels[1], currency: 'USD', total: 310000 },
        { month: lastSixMonthLabels[2], currency: 'USD', total: 290000 },
        { month: lastSixMonthLabels[3], currency: 'USD', total: 305000 },
        { month: lastSixMonthLabels[4], currency: 'USD', total: 295000 },
        { month: lastSixMonthLabels[5], currency: 'USD', total: 300000 },
      ])
      .mockReturnValueOnce([])

    const result = await getFinancialHealthScore.execute({})

    expect(result.success).toBe(true)
    expect(result.score.overall).toBeGreaterThanOrEqual(0)
    expect(result.score.overall).toBeLessThanOrEqual(100)
    expect(result.score.subscores).toHaveLength(5)
  })

  it('generates and persists a weekly spending recap', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 12500 },
        { currency: 'USD', type: 'income', total: 50000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 10000 },
        { currency: 'USD', type: 'income', total: 45000 },
      ])
      .mockReturnValueOnce([{ currency: 'USD', category_name: 'Food', total: 12500, count: 3 }])
      .mockReturnValueOnce([
        { currency: 'USD', description: 'Groceries', amount: 7000, category_name: 'Food' },
      ])

    const result = await getSpendingRecap.execute({ type: 'weekly' })

    expect(result).toMatchObject({
      success: true,
      recap: expect.objectContaining({
        type: 'weekly',
        title: expect.stringContaining('Weekly Recap:'),
      }),
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO recaps'),
      expect.any(Array)
    )
  })

  it('returns per-currency cash-flow forecasts when balances span currencies', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', total: 100000 },
        { currency: 'EUR', total: 50000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'income', avg_daily: 5000 },
        { currency: 'USD', type: 'expense', avg_daily: 3000 },
        { currency: 'EUR', type: 'income', avg_daily: 1500 },
        { currency: 'EUR', type: 'expense', avg_daily: 1000 },
      ])
      .mockReturnValueOnce([{ currency: 'EUR', amount: 3000, billing_cycle: 'monthly' }])

    const result = await getForecastedCashFlow.execute({ days: 2 })

    expect(result).toMatchObject({
      success: true,
      forecast: null,
      forecastsByCurrency: [
        expect.objectContaining({ currency: 'EUR', currentBalance: 500, dailyIncome: 15 }),
        expect.objectContaining({ currency: 'USD', currentBalance: 1000, dailyIncome: 50 }),
      ],
    })
    expect(result.message).toContain('no FX conversion was applied')
  })

  it('returns per-currency financial health scores for mixed currencies', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', type: 'income', total: 500000 },
        { currency: 'USD', type: 'expense', total: 300000 },
        { currency: 'EUR', type: 'income', total: 200000 },
        { currency: 'EUR', type: 'expense', total: 150000 },
      ])
      .mockReturnValueOnce([{ currency: 'EUR', total_balance: 10000 }])
      .mockReturnValueOnce([
        { currency: 'USD', total: 900000 },
        { currency: 'EUR', total: 200000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', total: 900000 },
        { currency: 'EUR', total: 450000 },
      ])
      .mockReturnValueOnce([
        { month: lastSixMonthLabels[0], currency: 'USD', total: 300000 },
        { month: lastSixMonthLabels[1], currency: 'USD', total: 310000 },
        { month: lastSixMonthLabels[2], currency: 'USD', total: 290000 },
        { month: lastSixMonthLabels[3], currency: 'USD', total: 305000 },
        { month: lastSixMonthLabels[4], currency: 'USD', total: 295000 },
        { month: lastSixMonthLabels[5], currency: 'USD', total: 300000 },
        { month: lastSixMonthLabels[0], currency: 'EUR', total: 120000 },
        { month: lastSixMonthLabels[1], currency: 'EUR', total: 130000 },
        { month: lastSixMonthLabels[2], currency: 'EUR', total: 125000 },
        { month: lastSixMonthLabels[3], currency: 'EUR', total: 135000 },
        { month: lastSixMonthLabels[4], currency: 'EUR', total: 140000 },
        { month: lastSixMonthLabels[5], currency: 'EUR', total: 150000 },
      ])

    const result = await getFinancialHealthScore.execute({})

    expect(result).toMatchObject({
      success: true,
      score: {
        overall: null,
        mixedCurrency: true,
        omittedSubscores: ['Budget Adherence'],
        scoresByCurrency: [
          expect.objectContaining({ currency: 'EUR' }),
          expect.objectContaining({ currency: 'USD' }),
        ],
      },
    })
    expect(result.message).toContain('Budget adherence is omitted')
  })

  it('generates a weekly mixed-currency recap without cross-currency aggregation', async () => {
    mockQuery
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 12500 },
        { currency: 'USD', type: 'income', total: 50000 },
        { currency: 'EUR', type: 'expense', total: 9000 },
        { currency: 'EUR', type: 'income', total: 0 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', type: 'expense', total: 10000 },
        { currency: 'USD', type: 'income', total: 45000 },
        { currency: 'EUR', type: 'expense', total: 7000 },
      ])
      .mockReturnValueOnce([
        { currency: 'USD', category_name: 'Food', total: 12500, count: 3 },
        { currency: 'EUR', category_name: 'Travel', total: 9000, count: 1 },
      ])
      .mockReturnValueOnce([
        { currency: 'EUR', description: 'Train', amount: 9000, category_name: 'Travel' },
        { currency: 'USD', description: 'Groceries', amount: 7000, category_name: 'Food' },
      ])

    const result = await getSpendingRecap.execute({ type: 'weekly' })

    expect(result).toMatchObject({
      success: true,
      totalsByCurrency: [
        expect.objectContaining({ currency: 'EUR', totalExpenses: 90 }),
        expect.objectContaining({ currency: 'USD', totalExpenses: 125, totalIncome: 500 }),
      ],
    })
    expect(result.recap.summary).toContain('no FX conversion')
  })

  it('returns contextual education tips from action mappings', async () => {
    const result = await getEducationTip.execute({ action: 'first-budget' })

    expect(result).toMatchObject({
      success: true,
      source: 'action',
      tip: expect.objectContaining({
        id: 'budget-50-30-20',
        topic: 'budgeting',
      }),
    })
  })

  it('rejects impossible recap period dates at the schema boundary', () => {
    const result = getSpendingRecap.schema.safeParse({
      type: 'monthly',
      period: '2026-02-31',
    })

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected invalid recap date to fail schema validation')
    }
    expect(result.error.issues[0]?.message).toBe('Date must be a real calendar date')
  })

  it('writes a portfolio review into the notebook', async () => {
    mockNoteExists.mockResolvedValueOnce(false)
    mockQuery
      .mockReturnValueOnce([
        {
          symbol: 'AAPL',
          name: 'Apple',
          shares: 2,
          avg_cost_basis: 10000,
        },
      ])
      .mockReturnValueOnce([{ price: 15000 }])

    const result = await generatePortfolioReview.execute({ force: false })

    expect(result).toMatchObject({
      success: true,
      summary: expect.objectContaining({
        holdingsCount: 1,
        portfolioValue: 300,
      }),
    })
    expect(mockWriteNote).toHaveBeenCalledTimes(1)
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
        currency: 'GBP',
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
      'GBP',
      'tx-1',
    ])
  })

  it('preserves a stored historical transaction currency on metadata-only edits', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-legacy',
        amount: 2500,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        currency: 'MXN',
        description: 'Museum ticket',
        date: '2025-01-10',
        notes: 'old note',
      },
    ])

    const result = await updateTransaction.execute(
      updateTransaction.schema.parse({
        transactionId: 'tx-legacy',
        notes: 'updated note',
      })
    )

    expect(mockQuery).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(3, expect.stringContaining('UPDATE transactions'), [
      2500,
      'expense',
      'Museum ticket',
      null,
      '2025-01-10',
      'updated note',
      'acct-1',
      'MXN',
      'tx-legacy',
    ])
    expect(result.success).toBe(true)
  })

  it('fails transaction edits when stored currency is unknown', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-legacy',
        amount: 2500,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        currency: null,
        description: 'Museum ticket',
        date: '2025-01-10',
        notes: 'old note',
      },
    ])

    const result = await updateTransaction.execute(
      updateTransaction.schema.parse({
        transactionId: 'tx-legacy',
        notes: 'updated note',
      })
    )

    expect(result).toEqual({
      success: false,
      reason: 'unknown_transaction_currency',
      message:
        'Transaction "Museum ticket" has no stored currency. Repair or recreate the transaction before editing it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
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
          currency: 'USD',
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
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'SELECT id, currency FROM accounts WHERE id = $1 LIMIT 1',
      ['missing-account']
    )
    expect(result).toEqual({
      success: false,
      message: 'Account missing-account not found.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects moving a transaction to an account with a different currency', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-1',
          amount: 1000,
          type: 'expense',
          account_id: 'acct-1',
          category_id: null,
          currency: 'USD',
          description: 'Coffee',
          date: '2026-04-14',
          notes: 'old notes',
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-2', currency: 'EUR' }])

    const result = await updateTransaction.execute(
      updateTransaction.schema.parse({ transactionId: 'tx-1', accountId: 'acct-2' })
    )

    expect(result).toEqual({
      success: false,
      message:
        'Cannot move this transaction from USD to EUR. Cross-currency moves are not supported because they would change amount semantics without FX conversion.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects unknown categories on update before applying writes', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-1',
          amount: 1000,
          type: 'expense',
          account_id: 'acct-1',
          category_id: null,
          currency: 'USD',
          description: 'Coffee',
          date: '2026-04-14',
          notes: null,
        },
      ])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])

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
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-2', currency: ' usd ' }])
      .mockReturnValueOnce([{ name: 'currency' }])

    const input = manageRecurringTransaction.schema.parse({
      action: 'create',
      description: 'Rent',
      amount: 1000,
      type: 'expense',
      frequency: 'monthly',
      accountId: 'acct-2',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT id, currency FROM accounts WHERE id = $1 LIMIT 1',
      ['acct-2']
    )
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
        'USD',
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

  it('resolves accountId and category when updating a recurring rule', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-1',
          description: 'Rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          account_id: 'acct-1',
          currency: 'USD',
        },
      ])
      .mockReturnValueOnce([{ id: 'cat-rent', name: 'Rent' }])
      .mockReturnValueOnce([{ id: 'acct-2', currency: 'USD' }])
      .mockReturnValueOnce([{ name: 'currency' }])

    const input = manageRecurringTransaction.schema.parse({
      action: 'update',
      ruleId: 'rule-1',
      category: 'Rent',
      accountId: 'acct-2',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining(
        'UPDATE recurring_rules SET category_id = $1, account_id = $2, currency = $3'
      ),
      ['cat-rent', 'acct-2', 'USD', 'rule-1']
    )
    expect(result).toEqual({
      success: true,
      message: 'Updated recurring rule "Rent".',
    })
  })

  it('rejects moving a recurring rule to an account with a different currency', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-1',
          description: 'Rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          account_id: 'acct-1',
          currency: 'USD',
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-2', currency: 'BRL' }])

    const result = await manageRecurringTransaction.execute(
      manageRecurringTransaction.schema.parse({
        action: 'update',
        ruleId: 'rule-1',
        accountId: 'acct-2',
      })
    )

    expect(result).toEqual({
      success: false,
      message:
        'Cannot move this recurring rule from USD to BRL. Cross-currency moves are not supported because they would change amount semantics without FX conversion.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('fails recurring-rule account moves when the stored rule currency is unknown', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-legacy',
          description: 'Legacy rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          account_id: 'acct-1',
          currency: null,
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-2', currency: 'USD' }])

    const result = await manageRecurringTransaction.execute(
      manageRecurringTransaction.schema.parse({
        action: 'update',
        ruleId: 'rule-legacy',
        accountId: 'acct-2',
      })
    )

    expect(result).toEqual({
      success: false,
      reason: 'unknown_rule_currency',
      message:
        'Recurring rule "Legacy rent" has no stored currency. Repair or recreate the rule before moving or materializing it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects recurring-rule updates when stored currency is unknown even without an account move', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-legacy',
        description: 'Legacy rent',
        amount: 100000,
        type: 'expense',
        frequency: 'monthly',
        account_id: 'acct-1',
        currency: null,
      },
    ])

    const result = await manageRecurringTransaction.execute(
      manageRecurringTransaction.schema.parse({
        action: 'update',
        ruleId: 'rule-legacy',
        notes: 'updated',
      })
    )

    expect(result).toEqual({
      success: false,
      reason: 'unknown_rule_currency',
      message:
        'Recurring rule "Legacy rent" has no stored currency. Repair or recreate the rule before moving or materializing it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('lists category rules from the migrated category_rules table', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        pattern: 'coffee',
        category_id: 'cat-1',
        subcategory_id: null,
        confidence: 0.9,
        hit_count: 12,
        category_name: 'Food & Dining',
      },
    ])

    const input = manageCategoryRules.schema.parse({ action: 'list' })
    const result = await manageCategoryRules.execute(input)

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM category_rules r'))
    expect(result).toEqual({
      success: true,
      rules: [
        {
          id: 'rule-1',
          pattern: 'coffee',
          category_name: 'Food & Dining',
          category_id: 'cat-1',
          hit_count: 12,
          confidence: 0.9,
        },
      ],
      count: 1,
      message: 'Found 1 auto-categorization rule(s).',
    })
  })

  it('creates category rules in the migrated category_rules table', async () => {
    mockQuery.mockReturnValueOnce([])

    const input = manageCategoryRules.schema.parse({
      action: 'create',
      pattern: 'Coffee Shop',
      categoryId: 'cat-1',
    })
    const result = await manageCategoryRules.execute(input)

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT id FROM category_rules WHERE LOWER(pattern) = LOWER($1)',
      ['Coffee Shop']
    )
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO category_rules'),
      ['tx_test_123', 'coffee shop', 'cat-1', null]
    )
    expect(result).toEqual({
      success: true,
      message: 'Learned rule: "Coffee Shop" will be categorized automatically.',
    })
  })

  it('deletes category rules from the migrated category_rules table', async () => {
    const input = manageCategoryRules.schema.parse({
      action: 'delete',
      ruleId: 'rule-1',
    })
    const result = await manageCategoryRules.execute(input)

    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM category_rules WHERE id = $1', ['rule-1'])
    expect(result).toEqual({ success: true, message: 'Rule deleted successfully.' })
  })

  it('suggests categories from the migrated category_rules table', async () => {
    mockQuery.mockReturnValueOnce([
      {
        category_id: 'cat-1',
        category_name: 'Food & Dining',
        confidence: 0.91,
      },
    ])

    const input = manageCategoryRules.schema.parse({
      action: 'suggest',
      pattern: 'Coffee Shop Downtown',
    })
    const result = await manageCategoryRules.execute(input)

    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('FROM category_rules r'), [
      'coffee shop downtown',
    ])
    expect(result).toEqual({
      success: true,
      suggestion: {
        categoryId: 'cat-1',
        categoryName: 'Food & Dining',
        confidence: 0.91,
      },
      message: 'Suggested category for "Coffee Shop Downtown" with 91% confidence.',
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

  it('materializes due recurring transactions, updates balances, and advances next_date', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        account_id: 'acct-1',
        currency: 'CAD',
        account_currency: 'CAD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Coffee subscription',
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE recurring_rules SET active = $1, next_date = $2'),
      [1, '2026-05-15', 'rule-1', '2026-04-15']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-1',
        'cat-1',
        'expense',
        1250,
        'CAD',
        'Coffee subscription',
        'monthly',
        '2026-04-15',
      ]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-1250, 'acct-1']
    )
    expect(result).toEqual({
      success: true,
      created: 1,
      message: 'Created 1 transaction(s) from recurring rules.',
    })
  })

  it('treats recurring rule and account currencies with casing or whitespace drift as equivalent', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        account_id: 'acct-1',
        currency: ' cad ',
        account_currency: 'CAD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Coffee subscription',
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(result).toEqual({
      success: true,
      created: 1,
      message: 'Created 1 transaction(s) from recurring rules.',
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-1',
        'cat-1',
        'expense',
        1250,
        'CAD',
        'Coffee subscription',
        'monthly',
        '2026-04-15',
      ]
    )
  })

  it('blocks account currency changes while recurring rules still depend on the account', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-1', name: 'Checking', currency: 'USD' }])
      .mockReturnValueOnce([{ currency: 'USD' }, { currency: 'BRL' }])

    const input = updateAccount.schema.parse({
      accountId: 'acct-1',
      currency: 'EUR',
    })

    const result = await updateAccount.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Cannot change this account currency while 2 recurring rule(s) still point at the account. Repair, move, or recreate those recurring rules first so scheduled amounts do not silently change meaning.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('allows account currency repair when dependent recurring rules already match the target currency', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-1', name: 'Checking', currency: 'EUR' }])
      .mockReturnValueOnce([{ currency: 'USD' }, { currency: ' usd ' }])

    const input = updateAccount.schema.parse({
      accountId: 'acct-1',
      currency: 'USD',
    })

    const result = await updateAccount.execute(input)

    expect(result).toEqual({
      success: true,
      message: 'Updated account "Checking".',
    })
    expect(mockExecute).toHaveBeenCalledTimes(1)
  })

  it('rejects recurring-rule creation when the linked account currency is invalid after normalization', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-2', currency: '   ' }])
      .mockReturnValueOnce([{ name: 'currency' }])

    const input = manageRecurringTransaction.schema.parse({
      action: 'create',
      description: 'Rent',
      amount: 1000,
      type: 'expense',
      frequency: 'monthly',
      accountId: 'acct-2',
    })

    const result = await manageRecurringTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Account acct-2 has no valid stored currency. Repair the account currency before creating or updating recurring rules.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('fails materialization when a due recurring rule has unknown currency', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-legacy',
        description: 'Legacy rent',
        account_id: 'acct-1',
        currency: null,
        account_currency: 'USD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(result).toEqual({
      success: false,
      reason: 'unknown_rule_currency',
      message:
        'Recurring rule "Legacy rent" has no stored currency. Repair or recreate the rule before moving or materializing it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('fails materialization for any due transfer recurring rule', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-transfer',
        description: 'Move to savings',
        account_id: 'acct-1',
        currency: 'USD',
        account_currency: 'USD',
        to_account_id: 'acct-2',
        category_id: null,
        type: 'transfer',
        amount: 1250,
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(result).toEqual({
      success: false,
      reason: 'unsupported_recurring_transfer',
      message:
        'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('fails materialization when stored rule currency no longer matches the linked account currency', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        description: 'Coffee subscription',
        account_id: 'acct-1',
        currency: 'USD',
        account_currency: 'EUR',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(result).toEqual({
      success: false,
      reason: 'rule_account_currency_mismatch',
      message:
        'Recurring rule "Coffee subscription" has stored currency USD but the linked account is now EUR. Repair or recreate the rule before materializing it.',
    })
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('skips materialization when another runner already claimed the due occurrence', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        account_id: 'acct-1',
        currency: 'CAD',
        account_currency: 'CAD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Coffee subscription',
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])
    mockExecute.mockReturnValueOnce({ rowsAffected: 0, lastInsertId: 1 })

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('WHERE id = $3 AND active = 1 AND next_date = $4'),
      [1, '2026-05-15', 'rule-1', '2026-04-15']
    )
    expect(result).toEqual({
      success: true,
      created: 0,
      message: 'No recurring transactions were due.',
    })
  })

  it('materializes recurring transactions with the stored rule currency when the linked account still matches', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        account_id: 'acct-1',
        currency: 'USD',
        account_currency: 'USD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Coffee subscription',
        notes: 'monthly',
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE recurring_rules SET active = $1, next_date = $2'),
      [1, '2026-05-15', 'rule-1', '2026-04-15']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-1',
        'cat-1',
        'expense',
        1250,
        'USD',
        'Coffee subscription',
        'monthly',
        '2026-04-15',
      ]
    )
    expect(result).toMatchObject({ success: true, created: 1 })
  })

  it('deactivates recurring rules past their end date without creating transactions', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-1',
        account_id: 'acct-1',
        currency: 'USD',
        account_currency: 'USD',
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Expired rule',
        notes: null,
        next_date: '2026-04-01',
        frequency: 'monthly',
        end_date: '2026-03-01',
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE recurring_rules SET active = 0'),
      ['rule-1', '2026-04-01']
    )
    expect(result).toEqual({
      success: true,
      created: 0,
      message: 'No recurring transactions were due.',
    })
  })

  it('wraps update-transaction balance and row writes in a transaction', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-1',
        amount: 1000,
        type: 'expense',
        account_id: 'acct-1',
        category_id: null,
        currency: 'JPY',
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
      'JPY',
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
        currency: 'USD',
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

  it('uses the real exchange_rates currency columns for currency conversion', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM exchange_rates') &&
        sql.includes('from_currency = $1') &&
        sql.includes('to_currency = $2') &&
        Array.isArray(params) &&
        params[0] === 'USD' &&
        params[1] === 'BRL'
      ) {
        return [{ rate: 5.1 }]
      }

      return []
    })

    const result = await convertCurrency.execute({ amount: 10, from: 'usd', to: 'brl' })

    expect(result).toMatchObject({
      amount: 10,
      from: 'USD',
      to: 'BRL',
      convertedAmount: 51,
      rate: 5.1,
    })
  })

  it('rejects stored non-positive exchange rates safely', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (
        sql.includes('FROM exchange_rates') &&
        Array.isArray(params) &&
        params[0] === 'USD' &&
        params[1] === 'BRL'
      ) {
        return [{ rate: 0 }]
      }

      return []
    })

    const result = await convertCurrency.execute({ amount: 10, from: 'USD', to: 'BRL' })

    expect(result).toEqual({
      amount: 10,
      from: 'USD',
      to: 'BRL',
      convertedAmount: null,
      rate: null,
      message: 'Stored exchange rate for USD to BRL is invalid. Refresh exchange rates first.',
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
