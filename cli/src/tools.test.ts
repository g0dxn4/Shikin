// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import dayjs from 'dayjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
const queryTransactions = tools.find((tool) => tool.name === 'query-transactions')!
const createAccount = tools.find((tool) => tool.name === 'create-account')!
const upsertAccount = tools.find((tool) => tool.name === 'upsert-account')!
const updateAccount = tools.find((tool) => tool.name === 'update-account')!
const setAccountAlias = tools.find((tool) => tool.name === 'set-account-alias')!
const deleteAccount = tools.find((tool) => tool.name === 'delete-account')!
const getSpendingSummary = tools.find((tool) => tool.name === 'get-spending-summary')!
const writeNotebook = tools.find((tool) => tool.name === 'write-notebook')!
const listNotebook = tools.find((tool) => tool.name === 'list-notebook')!
const manageRecurringTransaction = tools.find(
  (tool) => tool.name === 'manage-recurring-transaction'
)!
const materializeRecurring = tools.find((tool) => tool.name === 'materialize-recurring')!
const getRecurringExpectedVsPaid = tools.find(
  (tool) => tool.name === 'get-recurring-expected-vs-paid'
)!
const manageCategoryRules = tools.find((tool) => tool.name === 'manage-category-rules')!
const suggestCategory = tools.find((tool) => tool.name === 'suggest-category')!
const reviewSuggestions = tools.find((tool) => tool.name === 'review-suggestions')!
const approveSuggestion = tools.find((tool) => tool.name === 'approve-suggestion')!
const rejectSuggestion = tools.find((tool) => tool.name === 'reject-suggestion')!
const getSpendingAnomalies = tools.find((tool) => tool.name === 'get-spending-anomalies')!
const listSubscriptions = tools.find((tool) => tool.name === 'list-subscriptions')!
const getUpcomingBills = tools.find((tool) => tool.name === 'get-upcoming-bills')!
const createSubscription = tools.find((tool) => tool.name === 'create-subscription')!
const updateSubscription = tools.find((tool) => tool.name === 'update-subscription')!
const deleteSubscription = tools.find((tool) => tool.name === 'delete-subscription')!
const getSubscriptionSpending = tools.find((tool) => tool.name === 'get-subscription-spending')!
const getBalanceOverview = tools.find((tool) => tool.name === 'get-balance-overview')!
const analyzeSpendingTrends = tools.find((tool) => tool.name === 'analyze-spending-trends')!
const getForecastedCashFlow = tools.find((tool) => tool.name === 'get-forecasted-cash-flow')!
const getFinancialHealthScore = tools.find((tool) => tool.name === 'get-financial-health-score')!
const getSpendingRecap = tools.find((tool) => tool.name === 'get-spending-recap')!
const getEducationTip = tools.find((tool) => tool.name === 'get-education-tip')!
const generatePortfolioReview = tools.find((tool) => tool.name === 'generate-portfolio-review')!
const convertCurrency = tools.find((tool) => tool.name === 'convert-currency')!
const createBudget = tools.find((tool) => tool.name === 'create-budget')!
const upsertBudget = tools.find((tool) => tool.name === 'upsert-budget')!
const deleteBudget = tools.find((tool) => tool.name === 'delete-budget')!
const financeProfile = tools.find((tool) => tool.name === 'finance-profile')!
const importTransactions = tools.find((tool) => tool.name === 'import-transactions')!
const exportData = tools.find((tool) => tool.name === 'export-data')!
const setupStatus = tools.find((tool) => tool.name === 'setup-status')!
const getCreditCardStatus = tools.find((tool) => tool.name === 'get-credit-card-status')!
const createCreditCardStatement = tools.find(
  (tool) => tool.name === 'create-credit-card-statement'
)!
const updateCreditCardStatement = tools.find(
  (tool) => tool.name === 'update-credit-card-statement'
)!
const listCreditCardStatements = tools.find((tool) => tool.name === 'list-credit-card-statements')!
const deleteCreditCardStatement = tools.find(
  (tool) => tool.name === 'delete-credit-card-statement'
)!
const createBucket = tools.find((tool) => tool.name === 'create-bucket')!
const listBuckets = tools.find((tool) => tool.name === 'list-buckets')!
const allocateIncome = tools.find((tool) => tool.name === 'allocate-income')!
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

    expect(mockQuery).toHaveBeenCalledTimes(2)
    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
      ['acct-2']
    )
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      'SELECT id, balance FROM accounts WHERE id IN ($1)',
      ['acct-2']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-2',
        null,
        null,
        'expense',
        1000,
        'EUR',
        'Coffee',
        null,
        'posted',
        null,
        null,
        null,
        expect.any(String),
      ]
    )
    expect(result.transaction.accountId).toBe('acct-2')
  })

  it('validates recurringRuleId during add-transaction dry-runs', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-1', currency: 'USD' }]).mockReturnValueOnce([])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'acct-1',
      recurringRuleId: 'missing-rule',
      dryRun: true,
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message: 'Recurring rule missing-rule not found.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects recurringRuleId links for a different account', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-1', currency: 'USD' }])
      .mockReturnValueOnce([
        { id: 'rule-1', account_id: 'acct-2', type: 'expense', currency: 'USD' },
      ])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'acct-1',
      recurringRuleId: 'rule-1',
      dryRun: true,
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message: 'Recurring rule rule-1 belongs to account acct-2, not acct-1.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects archived explicit accounts for new transactions', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-archived', currency: 'USD', is_archived: 1 }])

    const input = addTransaction.schema.parse({
      amount: 10,
      type: 'expense',
      description: 'Coffee',
      accountId: 'acct-archived',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message: 'Account acct-archived is archived. Unarchive it before using it for new writes.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
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
    expect(mockExecute).toHaveBeenCalledTimes(3)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-1',
        null,
        null,
        'expense',
        1000,
        'BRL',
        'Coffee',
        null,
        'posted',
        null,
        null,
        null,
        expect.any(String),
      ]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-1000, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.any(Array)
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

  it('creates transfer transactions and updates both account balances', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-checking', currency: 'USD' }])
      .mockReturnValueOnce([{ id: 'acct-savings', currency: 'USD' }])

    const input = addTransaction.schema.parse({
      amount: 25,
      type: 'transfer',
      description: 'Move cash',
      accountId: 'acct-checking',
      transferToAccountId: 'acct-savings',
    })

    const result = await addTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO transactions'),
      [
        'tx_test_123',
        'acct-checking',
        null,
        'acct-savings',
        'transfer',
        2500,
        'USD',
        'Move cash',
        null,
        'posted',
        null,
        null,
        null,
        expect.any(String),
      ]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-2500, 'acct-checking']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [2500, 'acct-savings']
    )
    expect(result).toMatchObject({
      success: true,
      transaction: {
        accountId: 'acct-checking',
        transferToAccountId: 'acct-savings',
        type: 'transfer',
      },
    })
  })

  it('requires a destination account for transfer creation', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'acct-checking', currency: 'USD' }])

    const input = addTransaction.schema.parse({
      amount: 25,
      type: 'transfer',
      description: 'Move cash',
      accountId: 'acct-checking',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message: 'transferToAccountId is required for transfer transactions.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects cross-currency transfer creation', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-usd', currency: 'USD' }])
      .mockReturnValueOnce([{ id: 'acct-eur', currency: 'EUR' }])

    const input = addTransaction.schema.parse({
      amount: 25,
      type: 'transfer',
      description: 'Move cash',
      accountId: 'acct-usd',
      transferToAccountId: 'acct-eur',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Cannot transfer from USD to EUR. Cross-currency transfers are not supported because no FX conversion is applied.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects archived transfer destination accounts', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-usd', currency: 'USD' }])
      .mockReturnValueOnce([{ id: 'acct-old', currency: 'USD', is_archived: 1 }])

    const input = addTransaction.schema.parse({
      amount: 25,
      type: 'transfer',
      description: 'Move cash',
      accountId: 'acct-usd',
      transferToAccountId: 'acct-old',
    })

    const result = await addTransaction.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Transfer destination account acct-old is archived. Unarchive it before using it for new writes.',
    })
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

  it('previews account upserts by alias without writing', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM settings') && params?.[0] === 'account_aliases') {
        return [{ value: JSON.stringify({ main: 'acct-1' }) }]
      }
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [
          {
            id: 'acct-1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            balance: 1000,
            is_archived: 0,
            credit_limit: null,
            statement_closing_day: null,
            payment_due_day: null,
          },
        ]
      }
      return []
    })

    const result = await upsertAccount.execute(
      upsertAccount.schema.parse({ alias: 'main', balance: 42, dryRun: true })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'updated',
      dryRun: true,
      matchedBy: 'alias',
      wouldUpdate: {
        after: expect.objectContaining({ id: 'acct-1', balance: 42 }),
      },
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects account upserts that would reassign an existing alias', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM accounts WHERE id = $1 LIMIT 1') && params?.[0] === 'acct-1') {
        return [
          {
            id: 'acct-1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            balance: 0,
            is_archived: 0,
            credit_limit: null,
            statement_closing_day: null,
            payment_due_day: null,
          },
        ]
      }
      if (sql.includes('FROM settings') && params?.[0] === 'account_aliases') {
        return [{ value: JSON.stringify({ main: 'acct-2' }) }]
      }
      return []
    })

    const result = await upsertAccount.execute(
      upsertAccount.schema.parse({ accountId: 'acct-1', alias: 'main', dryRun: true })
    )

    expect(result).toEqual({
      success: false,
      reason: 'alias_conflict',
      message:
        'Alias "main" already points to account acct-2. Remove or choose a different alias before reassigning it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects aliases for archived accounts', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'acct-archived',
        name: 'Old Checking',
        type: 'checking',
        currency: 'USD',
        balance: 0,
        is_archived: 1,
        credit_limit: null,
        statement_closing_day: null,
        payment_due_day: null,
      },
    ])

    const result = await setAccountAlias.execute(
      setAccountAlias.schema.parse({
        accountId: 'acct-archived',
        alias: 'old-checking',
        dryRun: true,
      })
    )

    expect(result).toEqual({
      success: false,
      message:
        'Account "Old Checking" (acct-archived) is archived. Unarchive it before using it for new writes.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('removes aliases when deleting otherwise unreferenced accounts', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT * FROM accounts WHERE id = $1')) {
        return [
          {
            id: 'acct-1',
            name: 'Checking',
            type: 'checking',
            currency: 'USD',
            balance: 0,
            is_archived: 0,
            credit_limit: null,
            statement_closing_day: null,
            payment_due_day: null,
          },
        ]
      }
      if (sql.includes('FROM settings') && params?.[0] === 'account_aliases') {
        return [{ value: JSON.stringify({ main: 'acct-1', savings: 'acct-2' }) }]
      }
      if (sql.includes('COUNT(*) as count')) return [{ count: 0 }]
      return []
    })

    const result = await deleteAccount.execute(deleteAccount.schema.parse({ accountId: 'acct-1' }))

    expect(result).toMatchObject({ success: true, action: 'deleted', aliasesRemoved: ['main'] })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO settings (key, value, updated_at)'),
      ['account_aliases', JSON.stringify({ savings: 'acct-2' })]
    )
    expect(mockExecute).toHaveBeenCalledWith('DELETE FROM accounts WHERE id = $1', ['acct-1'])
  })

  it('writes account audit rows for metadata-only updates', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'acct-1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 1000,
        is_archived: 0,
        credit_limit: null,
        statement_closing_day: null,
        payment_due_day: null,
      },
    ])

    const result = await updateAccount.execute(
      updateAccount.schema.parse({
        accountId: 'acct-1',
        name: 'Everyday Checking',
        type: 'savings',
      })
    )

    expect(result).toMatchObject({ success: true })
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['account', 'acct-1', 'update'])
    )
    const auditParams = mockExecute.mock.calls[1]?.[1] as unknown[]
    const before = JSON.parse(String(auditParams[4]))
    const after = JSON.parse(String(auditParams[5]))
    expect(before.account).toMatchObject({ name: 'Checking', type: 'checking' })
    expect(after.account).toMatchObject({ name: 'Everyday Checking', type: 'savings' })
  })

  it('previews budget upserts by category and default monthly period', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }]).mockReturnValueOnce([])

    const result = await upsertBudget.execute(
      upsertBudget.schema.parse({ categoryName: 'Food', amount: 500, dryRun: true })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'created',
      dryRun: true,
      wouldCreate: expect.objectContaining({
        name: 'Food Budget',
        amount: 500,
        period: 'monthly',
        categoryId: 'cat-food',
      }),
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('matches category budgets without defaulting the lookup period', async () => {
    mockQuery.mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }]).mockReturnValueOnce([
      {
        id: 'budget-yearly',
        name: 'Annual Food',
        amount: 120000,
        period: 'yearly',
        category_id: 'cat-food',
        category_name: 'Food',
        is_active: 1,
      },
    ])

    const result = await upsertBudget.execute(
      upsertBudget.schema.parse({ categoryName: 'Food', amount: 1500, dryRun: true })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'updated',
      dryRun: true,
      matchedBy: 'category',
      wouldUpdate: {
        budgetId: 'budget-yearly',
        after: expect.objectContaining({ period: 'yearly', amount: 1500 }),
      },
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('writes audit rows for budget create, update, and delete writes', async () => {
    await createBudget.execute(
      createBudget.schema.parse({ name: 'Monthly Food', amount: 500, period: 'monthly' })
    )
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['budget', 'tx_test_123', 'create'])
    )

    mockExecute.mockClear()
    mockQuery.mockReset()
    mockQuery.mockReturnValueOnce([
      {
        id: 'budget-1',
        name: 'Monthly Food',
        amount: 50000,
        period: 'monthly',
        category_id: null,
        category_name: null,
        is_active: 1,
      },
    ])
    await upsertBudget.execute(upsertBudget.schema.parse({ name: 'Monthly Food', amount: 600 }))
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['budget', 'budget-1', 'update'])
    )

    mockExecute.mockClear()
    mockQuery.mockReset()
    mockQuery.mockReturnValueOnce([
      {
        id: 'budget-1',
        name: 'Monthly Food',
        amount: 60000,
        period: 'monthly',
        category_id: null,
        category_name: null,
        is_active: 1,
      },
    ])
    await deleteBudget.execute(deleteBudget.schema.parse({ budgetId: 'budget-1' }))
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['budget', 'budget-1', 'delete'])
    )
  })

  it('requires a stable match key for budget upserts', async () => {
    const result = await upsertBudget.execute(upsertBudget.schema.parse({ amount: 500 }))

    expect(result).toEqual({
      success: false,
      reason: 'budget_stable_match_required',
      message:
        'Provide budgetId, name, categoryId, or categoryName so upsert-budget has a stable match key.',
    })
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('previews credit-card statement creation and rejects duplicate statement periods', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'cc-1',
          name: 'Rewards Card',
          type: 'credit_card',
          currency: 'USD',
          balance: -12345,
          credit_limit: 500000,
          statement_closing_day: 15,
          payment_due_day: 5,
          is_archived: 0,
        },
      ])
      .mockReturnValueOnce([])

    const preview = await createCreditCardStatement.execute(
      createCreditCardStatement.schema.parse({
        accountId: 'cc-1',
        statementStartDate: '2026-04-16',
        closingDate: '2026-05-15',
        dueDate: '2026-06-05',
        statementBalance: 123.45,
        minimumPayment: 25,
        dryRun: true,
      })
    )

    expect(preview).toMatchObject({
      success: true,
      action: 'created',
      dryRun: true,
      wouldCreate: expect.objectContaining({
        accountId: 'cc-1',
        statementBalance: 123.45,
        minimumPayment: 25,
        amountToPay: 123.45,
        paymentStatus: 'open',
      }),
    })
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockReset()
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'cc-1',
          name: 'Rewards Card',
          type: 'credit_card',
          currency: 'USD',
          balance: -12345,
          credit_limit: 500000,
          statement_closing_day: 15,
          payment_due_day: 5,
          is_archived: 0,
        },
      ])
      .mockReturnValueOnce([{ id: 'stmt-existing' }])

    const duplicate = await createCreditCardStatement.execute(
      createCreditCardStatement.schema.parse({
        accountId: 'cc-1',
        statementEndDate: '2026-05-15',
        dueDate: '2026-06-05',
        statementBalance: 123.45,
      })
    )

    expect(duplicate).toEqual({
      success: false,
      reason: 'statement_exists',
      message:
        'A statement already exists for account cc-1 ending 2026-05-15. Update stmt-existing instead.',
      statementId: 'stmt-existing',
    })
  })

  it('updates credit-card statement paid amounts and writes an audit row', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'stmt-1',
          account_id: 'cc-1',
          statement_start_date: '2026-04-16',
          statement_end_date: '2026-05-15',
          due_date: '2026-06-05',
          statement_balance: 12345,
          minimum_payment: 2500,
          paid_amount: 0,
          currency: 'USD',
          status: 'open',
          source: null,
          note: null,
          account_name: 'Rewards Card',
          account_currency: 'USD',
          account_type: 'credit_card',
          account_is_archived: 0,
        },
      ])
      .mockReturnValueOnce([])

    const result = await updateCreditCardStatement.execute(
      updateCreditCardStatement.schema.parse({
        statementId: 'stmt-1',
        paidAmount: 25,
        source: 'bank-import',
      })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'updated',
      changed: true,
      statement: expect.objectContaining({
        paidAmount: 25,
        amountToPay: 98.45,
        minimumPaymentDue: 0,
        paymentStatus: 'partial',
      }),
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE credit_card_statements SET'),
      [2500, 'partial', 'bank-import', 'stmt-1']
    )
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['credit_card_statement', 'stmt-1', 'update'])
    )
  })

  it('rejects paid credit-card statement status while money remains unpaid', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'stmt-1',
        account_id: 'cc-1',
        statement_start_date: '2026-04-16',
        statement_end_date: '2026-05-15',
        due_date: '2026-06-05',
        statement_balance: 12345,
        minimum_payment: 2500,
        paid_amount: 0,
        currency: 'USD',
        status: 'open',
        source: null,
        note: null,
        account_name: 'Rewards Card',
        account_currency: 'USD',
        account_type: 'credit_card',
        account_is_archived: 0,
      },
    ])

    const result = await updateCreditCardStatement.execute(
      updateCreditCardStatement.schema.parse({
        statementId: 'stmt-1',
        status: 'paid',
        dryRun: true,
      })
    )

    expect(result).toEqual({
      success: false,
      reason: 'statement_status_inconsistent',
      message: 'Statement status cannot be paid while 123.45 USD remains unpaid.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('reports no-op credit-card statement dry-runs as unchanged', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'stmt-1',
        account_id: 'cc-1',
        statement_start_date: '2026-04-16',
        statement_end_date: '2026-05-15',
        due_date: '2026-06-05',
        statement_balance: 12345,
        minimum_payment: 2500,
        paid_amount: 0,
        currency: 'USD',
        status: 'open',
        source: null,
        note: null,
        account_name: 'Rewards Card',
        account_currency: 'USD',
        account_type: 'credit_card',
        account_is_archived: 0,
      },
    ])

    const result = await updateCreditCardStatement.execute(
      updateCreditCardStatement.schema.parse({ statementId: 'stmt-1', dryRun: true })
    )

    expect(result).toMatchObject({ success: true, dryRun: true, changed: false })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('lists and deletes credit-card statements with stable action metadata', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'stmt-1',
        account_id: 'cc-1',
        statement_start_date: null,
        statement_end_date: '2026-05-15',
        due_date: '2026-06-05',
        statement_balance: 10000,
        minimum_payment: 2000,
        paid_amount: 0,
        currency: 'USD',
        status: 'open',
        source: null,
        note: null,
        account_name: 'Rewards Card',
      },
    ])

    const listResult = await listCreditCardStatements.execute(
      listCreditCardStatements.schema.parse({ status: 'open', limit: 10 })
    )
    expect(listResult).toMatchObject({
      success: true,
      count: 1,
      statements: [expect.objectContaining({ id: 'stmt-1', amountToPay: 100 })],
    })

    mockQuery.mockReset()
    mockQuery.mockReturnValueOnce([
      {
        id: 'stmt-1',
        account_id: 'cc-1',
        statement_start_date: null,
        statement_end_date: '2026-05-15',
        due_date: '2026-06-05',
        statement_balance: 10000,
        minimum_payment: 2000,
        paid_amount: 0,
        currency: 'USD',
        status: 'open',
        source: null,
        note: null,
        account_name: 'Rewards Card',
      },
    ])

    const deleteResult = await deleteCreditCardStatement.execute(
      deleteCreditCardStatement.schema.parse({ statementId: 'stmt-1', dryRun: true })
    )
    expect(deleteResult).toMatchObject({ success: true, action: 'deleted', dryRun: true })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('filters credit-card statements by effective overdue status', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'stmt-overdue',
        account_id: 'cc-1',
        statement_start_date: null,
        statement_end_date: '2026-01-15',
        due_date: '2000-01-01',
        statement_balance: 10000,
        minimum_payment: 2000,
        paid_amount: 0,
        currency: 'USD',
        status: 'open',
        source: null,
        note: null,
        account_name: 'Rewards Card',
      },
    ])

    const result = await listCreditCardStatements.execute(
      listCreditCardStatements.schema.parse({ status: 'overdue', limit: 10 })
    )

    expect(result).toMatchObject({
      success: true,
      count: 1,
      statements: [expect.objectContaining({ id: 'stmt-overdue', paymentStatus: 'overdue' })],
    })
    expect(mockQuery.mock.calls[0]?.[0]).not.toContain('s.status =')
  })

  it('can list statements for archived credit-card accounts when explicitly included', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'cc-archived', type: 'credit_card', is_archived: 1 }])
      .mockReturnValueOnce([
        {
          id: 'stmt-archived',
          account_id: 'cc-archived',
          statement_start_date: null,
          statement_end_date: '2026-05-15',
          due_date: '2026-06-05',
          statement_balance: 10000,
          minimum_payment: 2000,
          paid_amount: 0,
          currency: 'USD',
          status: 'open',
          source: null,
          note: null,
          account_name: 'Archived Rewards Card',
          account_is_archived: 1,
        },
      ])

    const result = await listCreditCardStatements.execute(
      listCreditCardStatements.schema.parse({
        accountId: 'cc-archived',
        includeArchivedAccounts: true,
      })
    )

    expect(result).toMatchObject({
      success: true,
      count: 1,
      statements: [expect.objectContaining({ id: 'stmt-archived', accountId: 'cc-archived' })],
    })
  })

  it('integrates statement data into credit-card status and upcoming bills', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM accounts WHERE type = 'credit_card'")) {
        return [
          {
            id: 'cc-1',
            name: 'Rewards Card',
            type: 'credit_card',
            currency: 'USD',
            balance: -20000,
            credit_limit: 500000,
            statement_closing_day: 15,
            payment_due_day: 5,
            is_archived: 0,
          },
        ]
      }
      if (
        sql.includes('FROM credit_card_statements s') &&
        sql.includes('WHERE s.account_id = $1')
      ) {
        return [
          {
            id: 'stmt-1',
            account_id: 'cc-1',
            statement_start_date: '2026-04-16',
            statement_end_date: '2026-05-15',
            due_date: dayjs().add(5, 'day').format('YYYY-MM-DD'),
            statement_balance: 12345,
            minimum_payment: 2500,
            paid_amount: 500,
            currency: 'USD',
            status: 'partial',
            source: 'import',
            note: 'May statement',
          },
        ]
      }
      if (sql.includes('FROM transactions') && sql.includes('account_id = $1')) {
        return [{ total: 4567 }]
      }
      if (sql.includes('JOIN accounts a ON s.account_id = a.id')) {
        return [
          {
            id: 'stmt-1',
            account_id: 'cc-1',
            account_name: 'Rewards Card',
            statement_start_date: '2026-04-16',
            statement_end_date: '2026-05-15',
            due_date: dayjs().add(5, 'day').format('YYYY-MM-DD'),
            statement_balance: 12345,
            minimum_payment: 2500,
            paid_amount: 500,
            currency: 'USD',
            status: 'partial',
            source: 'import',
            note: 'May statement',
          },
        ]
      }
      if (sql.includes('payment_due_day IS NOT NULL')) return []
      if (sql.includes('FROM transactions') && sql.includes('is_recurring = 1')) return []
      return []
    })

    const statusResult = await getCreditCardStatus.execute(getCreditCardStatus.schema.parse({}))
    const billsResult = await getUpcomingBills.execute(
      getUpcomingBills.schema.parse({ daysAhead: 30 })
    )

    expect(statusResult).toMatchObject({
      success: true,
      cards: [
        expect.objectContaining({
          statementBalance: 123.45,
          minimumPayment: 25,
          minimumPaymentDue: 20,
          amountToPay: 118.45,
          paymentStatus: 'partial',
          currentPeriodSpending: 45.67,
        }),
      ],
      summary: expect.objectContaining({ totalAmountToPay: 118.45, totalMinimumDue: 20 }),
    })
    expect(billsResult).toMatchObject({
      success: true,
      bills: [
        expect.objectContaining({
          source: 'credit_card',
          statementId: 'stmt-1',
          amount: 118.45,
          minimumPaymentDue: 20,
          paymentStatus: 'partial',
        }),
      ],
    })
  })

  it('reports expected recurring bills with linked and fallback paid matches', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-linked',
          description: 'Rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-05-01',
          end_date: null,
          account_id: 'acct-1',
          category_id: null,
          notes: null,
          active: 1,
          currency: 'USD',
          account_name: 'Checking',
          account_currency: 'USD',
          category_name: null,
        },
        {
          id: 'rule-fallback',
          description: 'Gym Membership',
          amount: 3000,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-05-10',
          end_date: null,
          account_id: 'acct-1',
          category_id: null,
          notes: null,
          active: 1,
          currency: 'USD',
          account_name: 'Checking',
          account_currency: 'USD',
          category_name: null,
        },
      ])
      .mockReturnValueOnce([
        {
          id: 'tx-rent',
          recurring_rule_id: 'rule-linked',
          account_id: 'acct-1',
          type: 'expense',
          amount: 100000,
          currency: 'USD',
          description: 'Rent',
          date: '2026-05-01',
          status: 'posted',
        },
        {
          id: 'tx-gym',
          recurring_rule_id: null,
          account_id: 'acct-1',
          type: 'expense',
          amount: 3000,
          currency: 'USD',
          description: 'Gym Membership May',
          date: '2026-05-11',
          status: 'cleared',
        },
      ])

    const result = await getRecurringExpectedVsPaid.execute(
      getRecurringExpectedVsPaid.schema.parse({
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        asOfDate: '2026-05-31',
      })
    )

    expect(result).toMatchObject({
      success: true,
      summary: { expectedCount: 2, paidCount: 2, linkedMatches: 1, fallbackMatches: 1 },
      expected: expect.arrayContaining([
        expect.objectContaining({ ruleId: 'rule-linked', status: 'paid', fallbackMatched: false }),
        expect.objectContaining({
          ruleId: 'rule-fallback',
          status: 'paid',
          fallbackMatched: true,
          match: expect.objectContaining({ method: 'fallback_heuristic', fallback: true }),
        }),
      ]),
    })
  })

  it('allocates income to cashflow buckets with source transaction validation and audit', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'bucket-1',
          name: 'Rent',
          description: null,
          target_amount: 150000,
          balance: 10000,
          currency: 'USD',
          sort_order: 1,
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([
        {
          id: 'tx-income',
          account_id: 'acct-1',
          type: 'income',
          amount: 200000,
          currency: 'USD',
          description: 'Paycheck',
          date: '2026-05-01',
          status: 'posted',
          account_name: 'Checking',
          account_is_archived: 0,
        },
      ])
      .mockReturnValueOnce([{ total: 25000 }])
      .mockReturnValueOnce([
        {
          id: 'tx-income',
          account_id: 'acct-1',
          type: 'income',
          amount: 200000,
          currency: 'USD',
          description: 'Paycheck',
          date: '2026-05-01',
          status: 'posted',
          account_name: 'Checking',
          account_is_archived: 0,
        },
      ])
      .mockReturnValueOnce([{ total: 25000 }])

    const result = await allocateIncome.execute(
      allocateIncome.schema.parse({
        bucketId: 'bucket-1',
        transactionId: 'tx-income',
        amount: 50,
        allocationDate: '2026-05-02',
        source: 'paycheck-plan',
      })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'allocated',
      allocation: expect.objectContaining({
        bucketId: 'bucket-1',
        transactionId: 'tx-income',
        amount: 50,
      }),
      bucket: expect.objectContaining({ balance: 150 }),
    })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO cashflow_bucket_allocations'),
      ['tx_test_123', 'bucket-1', 'tx-income', 5000, 'USD', '2026-05-02', 'paycheck-plan', null]
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE cashflow_buckets SET balance = balance + $1'),
      [5000, 'bucket-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.arrayContaining(['cashflow_bucket_allocation', 'tx_test_123', 'allocate'])
    )
  })

  it('rechecks source income allocation limits inside the write transaction', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'bucket-1',
          name: 'Rent',
          description: null,
          target_amount: 150000,
          balance: 10000,
          currency: 'USD',
          sort_order: 1,
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([
        {
          id: 'tx-income',
          account_id: 'acct-1',
          type: 'income',
          amount: 10000,
          currency: 'USD',
          description: 'Paycheck',
          date: '2026-05-01',
          status: 'posted',
          account_name: 'Checking',
          account_is_archived: 0,
        },
      ])
      .mockReturnValueOnce([{ total: 0 }])
      .mockReturnValueOnce([
        {
          id: 'tx-income',
          account_id: 'acct-1',
          type: 'income',
          amount: 10000,
          currency: 'USD',
          description: 'Paycheck',
          date: '2026-05-01',
          status: 'posted',
          account_name: 'Checking',
          account_is_archived: 0,
        },
      ])
      .mockReturnValueOnce([{ total: 9000 }])

    const result = await allocateIncome.execute(
      allocateIncome.schema.parse({ bucketId: 'bucket-1', transactionId: 'tx-income', amount: 20 })
    )

    expect(result).toEqual({
      success: false,
      reason: 'source_transaction_overallocated',
      message: 'Source transaction tx-income has 10.00 USD remaining to allocate.',
      remainingAmount: 10,
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('previews and lists cashflow buckets without writes', async () => {
    mockQuery.mockReturnValueOnce([])

    const preview = await createBucket.execute(
      createBucket.schema.parse({ name: 'Taxes', targetAmount: 500, dryRun: true })
    )
    expect(preview).toMatchObject({
      success: true,
      action: 'created',
      dryRun: true,
      wouldCreate: expect.objectContaining({ name: 'Taxes', targetAmount: 500, balance: 0 }),
    })
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockReset()
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'bucket-1',
          name: 'Taxes',
          description: null,
          target_amount: 50000,
          balance: 10000,
          currency: 'USD',
          sort_order: 0,
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([
        {
          bucket_id: 'bucket-1',
          allocation_count: 2,
          allocated_amount: 10000,
          last_allocation_date: '2026-05-01',
        },
      ])

    const listResult = await listBuckets.execute(listBuckets.schema.parse({}))
    expect(listResult).toMatchObject({
      success: true,
      buckets: [
        expect.objectContaining({
          name: 'Taxes',
          balance: 100,
          allocationSummary: expect.objectContaining({ count: 2, allocatedAmount: 100 }),
        }),
      ],
    })
  })

  it('queues, reviews, approves, and rejects category suggestions', async () => {
    mockQuery.mockReturnValueOnce([]).mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }])

    const queued = await suggestCategory.execute(
      suggestCategory.schema.parse({
        description: 'Coffee Shop',
        enqueue: true,
        categoryId: 'cat-food',
        confidence: 0.72,
        dryRun: true,
      })
    )
    expect(queued).toMatchObject({
      success: true,
      action: 'enqueued',
      dryRun: true,
      wouldEnqueue: expect.objectContaining({ suggestedCategoryId: 'cat-food', confidence: 0.72 }),
    })
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockReset()
    mockQuery.mockReturnValueOnce([
      {
        id: 'suggestion-1',
        transaction_id: null,
        description: 'Coffee Shop',
        suggested_category_id: 'cat-food',
        suggested_subcategory_id: null,
        confidence: 0.72,
        status: 'pending',
        source: 'ai',
        note: null,
        created_at: '2026-05-01T00:00:00.000Z',
        reviewed_at: null,
        category_name: 'Food',
        subcategory_name: null,
      },
    ])

    const review = await reviewSuggestions.execute(reviewSuggestions.schema.parse({}))
    expect(review).toMatchObject({
      success: true,
      count: 1,
      suggestions: [expect.objectContaining({ id: 'suggestion-1', status: 'pending' })],
    })

    mockQuery.mockReset()
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'suggestion-1',
          transaction_id: null,
          description: 'Coffee Shop',
          suggested_category_id: 'cat-food',
          suggested_subcategory_id: null,
          confidence: 0.72,
          status: 'pending',
          source: 'ai',
          note: null,
          created_at: '2026-05-01T00:00:00.000Z',
          reviewed_at: null,
          category_name: 'Food',
          subcategory_name: null,
        },
      ])
      .mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }])
      .mockReturnValueOnce([])

    const approved = await approveSuggestion.execute(
      approveSuggestion.schema.parse({ id: 'suggestion-1', createRule: true, source: 'reviewer' })
    )
    expect(approved).toMatchObject({
      success: true,
      action: 'approved',
      rule: { action: 'created' },
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE category_suggestions'),
      ['cat-food', null, 'reviewer', null, expect.any(String), 'suggestion-1']
    )
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO category_rules'),
      ['tx_test_123', 'coffee shop', 'cat-food', null]
    )

    mockQuery.mockReset()
    mockExecute.mockReset()
    mockQuery.mockReturnValueOnce([
      {
        id: 'suggestion-2',
        transaction_id: null,
        description: 'Unknown shop',
        suggested_category_id: null,
        suggested_subcategory_id: null,
        confidence: 0.2,
        status: 'pending',
        source: null,
        note: null,
        created_at: '2026-05-01T00:00:00.000Z',
        reviewed_at: null,
        category_name: null,
        subcategory_name: null,
      },
    ])

    const rejected = await rejectSuggestion.execute(
      rejectSuggestion.schema.parse({ id: 'suggestion-2', note: 'too vague', dryRun: true })
    )
    expect(rejected).toMatchObject({
      success: true,
      action: 'rejected',
      dryRun: true,
      wouldReject: { after: expect.objectContaining({ status: 'rejected', note: 'too vague' }) },
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects stale category suggestion approvals inside the write transaction', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'suggestion-1',
          transaction_id: null,
          description: 'Coffee Shop',
          suggested_category_id: 'cat-food',
          suggested_subcategory_id: null,
          confidence: 0.72,
          status: 'pending',
          source: 'ai',
          note: null,
          created_at: '2026-05-01T00:00:00.000Z',
          reviewed_at: null,
          category_name: 'Food',
          subcategory_name: null,
        },
      ])
      .mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }])
      .mockReturnValueOnce([])
    mockExecute.mockReturnValueOnce({ rowsAffected: 0, lastInsertId: 0 })

    await expect(
      approveSuggestion.execute(approveSuggestion.schema.parse({ id: 'suggestion-1' }))
    ).rejects.toThrow(
      'Category suggestion suggestion-1 could not be approved because it was already reviewed.'
    )
  })

  it('validates queued category suggestion subcategory and transaction references', async () => {
    mockQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }])
      .mockReturnValueOnce([{ id: 'sub-travel', category_id: 'cat-travel', name: 'Flights' }])

    const mismatch = await suggestCategory.execute(
      suggestCategory.schema.parse({
        description: 'Coffee Shop',
        enqueue: true,
        categoryId: 'cat-food',
        subcategoryId: 'sub-travel',
        dryRun: true,
      })
    )

    expect(mismatch).toEqual({
      success: false,
      reason: 'subcategory_category_mismatch',
      message: 'Subcategory sub-travel belongs to category cat-travel, not cat-food.',
    })
    expect(mockExecute).not.toHaveBeenCalled()

    mockQuery.mockReset()
    mockQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ id: 'cat-food', name: 'Food' }])
      .mockReturnValueOnce([])

    const missingTransaction = await suggestCategory.execute(
      suggestCategory.schema.parse({
        description: 'Coffee Shop',
        enqueue: true,
        categoryId: 'cat-food',
        transactionId: 'tx-missing',
        dryRun: true,
      })
    )

    expect(missingTransaction).toEqual({
      success: false,
      reason: 'transaction_not_found',
      message: 'Transaction tx-missing not found.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('previews subscription creation with account and category resolution', async () => {
    mockQuery
      .mockReturnValueOnce([{ id: 'acct-1', currency: 'USD', is_archived: 0 }])
      .mockReturnValueOnce([{ id: 'cat-streaming', name: 'Streaming' }])

    const result = await createSubscription.execute(
      createSubscription.schema.parse({
        name: 'Netflix',
        amount: 15.99,
        nextBillingDate: '2026-06-01',
        accountId: 'acct-1',
        categoryId: 'cat-streaming',
        dryRun: true,
      })
    )

    expect(result).toMatchObject({
      success: true,
      action: 'created',
      dryRun: true,
      wouldCreate: expect.objectContaining({
        accountId: 'acct-1',
        categoryId: 'cat-streaming',
        amount: 15.99,
        currency: 'USD',
      }),
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('updates and deletes subscriptions with action metadata', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'sub-1',
          account_id: 'acct-1',
          category_id: null,
          name: 'Old plan',
          amount: 999,
          currency: 'USD',
          billing_cycle: 'monthly',
          next_billing_date: '2026-06-01',
          icon: null,
          color: null,
          url: null,
          notes: 'old',
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-1', currency: 'USD', is_archived: 0 }])
      .mockReturnValueOnce([
        {
          id: 'sub-1',
          account_id: 'acct-1',
          category_id: null,
          name: 'New plan',
          amount: 1299,
          currency: 'USD',
          billing_cycle: 'monthly',
          next_billing_date: '2026-06-01',
          icon: null,
          color: null,
          url: null,
          notes: null,
          is_active: 1,
        },
      ])

    const updateResult = await updateSubscription.execute(
      updateSubscription.schema.parse({ subscriptionId: 'sub-1', name: 'New plan', amount: 12.99 })
    )
    const deleteResult = await deleteSubscription.execute(
      deleteSubscription.schema.parse({ subscriptionId: 'sub-1', dryRun: true })
    )

    expect(updateResult).toMatchObject({ success: true, action: 'updated', changed: true })
    expect(deleteResult).toMatchObject({ success: true, action: 'deleted', dryRun: true })
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('UPDATE subscriptions SET'), [
      'New plan',
      1299,
      'sub-1',
    ])
  })

  it('reports no-op subscription dry-runs as unchanged', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'sub-1',
          account_id: 'acct-1',
          category_id: null,
          name: 'Plan',
          amount: 999,
          currency: 'USD',
          billing_cycle: 'monthly',
          next_billing_date: '2026-06-01',
          icon: null,
          color: null,
          url: null,
          notes: null,
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-1', currency: 'USD', is_archived: 0 }])

    const result = await updateSubscription.execute(
      updateSubscription.schema.parse({ subscriptionId: 'sub-1', dryRun: true })
    )

    expect(result).toMatchObject({ success: true, action: 'updated', dryRun: true, changed: false })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('validates retained subscription account currency on updates', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'sub-1',
          account_id: 'acct-1',
          category_id: null,
          name: 'Plan',
          amount: 999,
          currency: 'USD',
          billing_cycle: 'monthly',
          next_billing_date: '2026-06-01',
          icon: null,
          color: null,
          url: null,
          notes: null,
          is_active: 1,
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-1', currency: 'USD', is_archived: 0 }])

    const result = await updateSubscription.execute(
      updateSubscription.schema.parse({ subscriptionId: 'sub-1', currency: 'EUR', dryRun: true })
    )

    expect(result).toEqual({
      success: false,
      reason: 'subscription_currency_mismatch',
      message:
        'Subscription currency EUR does not match linked account currency USD. Use an account with matching currency or omit the account link.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('stores finance profile preferences as stable JSON and reports setup presence', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM settings') && params?.[0] === 'finance_profile') {
        return [{ value: JSON.stringify({ currency: 'USD' }) }]
      }
      if (sql.includes('FROM settings') && params?.[0] === 'account_aliases') {
        return [{ value: '{}' }]
      }
      if (sql.includes('COUNT(*) as count FROM accounts')) return [{ count: 1 }]
      if (sql.includes('COUNT(*) as count FROM categories')) return [{ count: 1 }]
      return [{ count: 0 }]
    })

    const profileResult = await financeProfile.execute(
      financeProfile.schema.parse({ action: 'set', profile: { risk: 'low' } })
    )
    const statusResult = await setupStatus.execute(setupStatus.schema.parse({}))

    expect(profileResult).toMatchObject({
      success: true,
      action: 'updated',
      profile: { currency: 'USD', risk: 'low' },
    })
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO settings'), [
      'finance_profile',
      '{"currency":"USD","risk":"low"}',
    ])
    expect(statusResult.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'finance_profile', ok: true, count: 1 }),
      ])
    )
  })

  it('deep-merges nested finance profile preferences by default', async () => {
    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM settings') && params?.[0] === 'finance_profile') {
        return [
          {
            value: JSON.stringify({
              preferences: { currency: 'USD', language: 'en' },
              risk: 'medium',
            }),
          },
        ]
      }
      return []
    })

    const result = await financeProfile.execute(
      financeProfile.schema.parse({ action: 'set', profile: { preferences: { language: 'es' } } })
    )

    expect(result).toMatchObject({
      success: true,
      profile: {
        preferences: { currency: 'USD', language: 'es' },
        risk: 'medium',
      },
    })
    expect(mockExecute).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO settings'), [
      'finance_profile',
      '{"preferences":{"currency":"USD","language":"es"},"risk":"medium"}',
    ])
  })

  it('reports CSV validation failures without pretending explicit apply was a dry-run', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shikin-csv-invalid-'))
    const file = join(dir, 'transactions.csv')
    writeFileSync(file, 'date,description,amount\n2026-05-01,Coffee,\n', 'utf8')

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', currency: 'USD', is_archived: 0 }]
      }
      return []
    })

    try {
      const result = await importTransactions.execute(
        importTransactions.schema.parse({ file, accountId: 'acct-1', apply: true })
      )

      expect(result).toMatchObject({
        success: false,
        reason: 'csv_validation_failed',
        applyRequested: true,
        dryRun: false,
        summary: { invalidRows: 1, importedRows: 0 },
      })
      expect(mockExecute).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('previews CSV transaction imports by default with row-level metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shikin-csv-preview-'))
    const file = join(dir, 'transactions.csv')
    writeFileSync(
      file,
      'date,description,amount,category,status,currency,externalId\n2026-05-01,Coffee,-4.50,Food,posted,USD,bank-1\n',
      'utf8'
    )

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', currency: 'USD', is_archived: 0 }]
      }
      if (sql.includes('FROM categories WHERE LOWER(name) = LOWER($1)')) {
        return [{ id: 'cat-food', name: 'Food' }]
      }
      return []
    })

    try {
      const result = await importTransactions.execute(
        importTransactions.schema.parse({ file, accountId: 'acct-1' })
      )

      expect(result).toMatchObject({
        success: true,
        dryRun: true,
        summary: { totalRows: 1, validRows: 1, importedRows: 0 },
        rows: [
          expect.objectContaining({
            status: 'valid',
            input: expect.objectContaining({
              amount: 4.5,
              type: 'expense',
              note: 'externalId=bank-1',
            }),
          }),
        ],
      })
      expect(mockExecute).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips duplicate CSV import rows by external ID metadata', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shikin-csv-duplicate-'))
    const file = join(dir, 'transactions.csv')
    writeFileSync(
      file,
      'date,description,amount,externalId\n2026-05-01,Coffee,-4.50,bank-1\n',
      'utf8'
    )

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', currency: 'USD', is_archived: 0 }]
      }
      if (sql.includes('FROM transactions') && params?.includes('externalId=')) {
        return [{ id: 'tx-existing', note: 'externalId=bank-1' }]
      }
      return []
    })

    try {
      const result = await importTransactions.execute(
        importTransactions.schema.parse({ file, accountId: 'acct-1' })
      )

      expect(result).toMatchObject({
        success: true,
        dryRun: true,
        summary: { totalRows: 1, validRows: 0, skippedRows: 1, importedRows: 0 },
        rows: [
          expect.objectContaining({
            status: 'skipped',
            reason: 'duplicate',
            existingTransactionId: 'tx-existing',
          }),
        ],
      })
      expect(mockExecute).not.toHaveBeenCalled()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses exact externalId duplicate matching for CSV imports', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shikin-csv-externalid-exact-'))
    const file = join(dir, 'transactions.csv')
    writeFileSync(file, 'date,description,amount,externalId\n2026-05-01,Coffee,-4.50,12\n', 'utf8')

    mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', currency: 'USD', is_archived: 0 }]
      }
      if (sql.includes('FROM transactions') && params?.includes('externalId=')) {
        return [{ id: 'tx-existing', note: 'externalId=123' }]
      }
      return []
    })

    try {
      const result = await importTransactions.execute(
        importTransactions.schema.parse({ file, accountId: 'acct-1' })
      )

      expect(result).toMatchObject({
        success: true,
        dryRun: true,
        summary: { totalRows: 1, validRows: 1, skippedRows: 0 },
        rows: [expect.objectContaining({ status: 'valid', externalId: '12' })],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns a structured failure when a CSV import file cannot be read', async () => {
    const missingFile = join(tmpdir(), 'shikin-missing-import-file.csv')
    mockQuery.mockReturnValueOnce([{ id: 'acct-1', currency: 'USD', is_archived: 0 }])

    const result = await importTransactions.execute(
      importTransactions.schema.parse({ file: missingFile, accountId: 'acct-1' })
    )

    expect(result).toMatchObject({
      success: false,
      reason: 'csv_file_read_failed',
      file: missingFile,
      message: `Could not read CSV file "${missingFile}".`,
      error: expect.any(String),
    })
  })

  it('rejects conflicting CSV apply and dryRun flags', async () => {
    const result = await importTransactions.execute(
      importTransactions.schema.parse({
        file: '/tmp/does-not-need-to-exist.csv',
        accountId: 'acct-1',
        apply: true,
        dryRun: true,
      })
    )

    expect(result).toEqual({
      success: false,
      reason: 'import_flag_conflict',
      message: 'Use either apply or dryRun, not both.',
    })
    expect(mockQuery).not.toHaveBeenCalled()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('applies CSV transaction imports only when apply is explicit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shikin-csv-apply-'))
    const file = join(dir, 'transactions.csv')
    writeFileSync(file, 'date,description,amount\n2026-05-01,Paycheck,100.00\n', 'utf8')

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', currency: 'USD', is_archived: 0 }]
      }
      if (sql.includes('SELECT id, balance FROM accounts')) {
        return [{ id: 'acct-1', balance: 5000 }]
      }
      return []
    })

    try {
      const result = await importTransactions.execute(
        importTransactions.schema.parse({ file, accountId: 'acct-1', apply: true })
      )

      expect(result).toMatchObject({
        success: true,
        dryRun: false,
        summary: { totalRows: 1, importedRows: 1 },
      })
      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO transactions'),
        [
          'tx_test_123',
          'acct-1',
          null,
          null,
          'income',
          10000,
          'USD',
          'Paycheck',
          null,
          'posted',
          'csv-import',
          null,
          null,
          '2026-05-01',
        ]
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exports deterministic table data with best-effort redaction', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM transactions ')) {
        return [
          {
            id: 'tx-1',
            description: 'Secret purchase',
            notes: 'private note',
            amount: 1234,
          },
        ]
      }
      if (sql.includes('FROM investments ')) {
        return [{ id: 'inv-1', symbol: 'VT', notes: 'broker memo' }]
      }
      if (sql.includes('FROM settings ')) {
        return [
          { key: 'finance_profile', value: '{"monthlyIncome":1000}' },
          { key: 'account_aliases', value: '{"main":"acct-1"}' },
        ]
      }
      return []
    })

    const result = await exportData.execute(
      exportData.schema.parse({ format: 'json', redacted: true })
    )

    expect(result).toMatchObject({
      success: true,
      format: 'json',
      redacted: true,
      data: {
        transactions: [expect.objectContaining({ description: '[REDACTED]', notes: '[REDACTED]' })],
        investments: [expect.objectContaining({ symbol: 'VT', notes: '[REDACTED]' })],
        settings: [
          expect.objectContaining({ key: 'finance_profile', value: '[REDACTED]' }),
          expect.objectContaining({ key: 'account_aliases', value: '[REDACTED]' }),
        ],
      },
    })
    expect(result.tables).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'cashflow_buckets' })])
    )
  })

  it('protects CSV exports from formula-leading string cells', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM accounts ')) {
        return [{ id: 'acct-1', name: '=HYPERLINK("http://example.test")', currency: 'USD' }]
      }
      return []
    })

    const result = await exportData.execute(exportData.schema.parse({ format: 'csv' }))

    expect(result.files.accounts).toContain('\t=HYPERLINK')
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
    expect(mockExecute).toHaveBeenCalledTimes(2)
    expect(mockExecute.mock.calls[0]?.[1]).toEqual([
      1000,
      'expense',
      'Coffee',
      null,
      '2026-04-14',
      null,
      'acct-1',
      'GBP',
      null,
      'posted',
      null,
      null,
      null,
      'tx-1',
    ])
    expect(mockExecute.mock.calls[1]?.[0]).toContain('INSERT INTO audit_log')
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
    expect(mockExecute).toHaveBeenNthCalledWith(1, expect.stringContaining('UPDATE transactions'), [
      2500,
      'expense',
      'Museum ticket',
      null,
      '2025-01-10',
      'updated note',
      'acct-1',
      'MXN',
      null,
      'posted',
      null,
      null,
      null,
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
      'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
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

  it('rejects balance-affecting transaction updates against archived accounts', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-archived-account',
          amount: 1000,
          type: 'expense',
          account_id: 'acct-archived',
          category_id: null,
          currency: 'USD',
          description: 'Old coffee',
          date: '2026-04-14',
          notes: null,
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-archived', name: 'Archived Checking' }])

    const result = await updateTransaction.execute(
      updateTransaction.schema.parse({ transactionId: 'tx-archived-account', amount: 12 })
    )

    expect(result).toEqual({
      success: false,
      reason: 'archived_account_balance_mutation',
      accountIds: ['acct-archived'],
      message:
        'Cannot mutate balances for archived account Archived Checking (acct-archived). Unarchive affected accounts before editing or deleting balance-affecting transactions.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects balance-affecting transaction deletes against archived accounts', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-archived-delete',
          amount: 1000,
          type: 'expense',
          account_id: 'acct-archived',
          description: 'Old coffee',
          date: '2026-04-14',
        },
      ])
      .mockReturnValueOnce([{ id: 'acct-archived', name: 'Archived Checking' }])

    const result = await deleteTransaction.execute(
      deleteTransaction.schema.parse({ transactionId: 'tx-archived-delete' })
    )

    expect(result).toMatchObject({
      success: false,
      reason: 'archived_account_balance_mutation',
      accountIds: ['acct-archived'],
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('revalidates retained recurringRuleId links against the final transaction shape', async () => {
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
          recurring_rule_id: 'rule-1',
        },
      ])
      .mockReturnValueOnce([
        { id: 'rule-1', account_id: 'acct-1', type: 'expense', currency: 'USD' },
      ])

    const result = await updateTransaction.execute(
      updateTransaction.schema.parse({ transactionId: 'tx-1', type: 'income' })
    )

    expect(result).toEqual({
      success: false,
      message: 'Recurring rule rule-1 is for expense transactions, not income.',
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
      'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
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

  it('blocks recurring-rule identity changes when transactions are linked', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-linked',
          description: 'Linked rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          account_id: 'acct-1',
          currency: 'USD',
        },
      ])
      .mockReturnValueOnce([{ name: 'currency' }])
      .mockReturnValueOnce([{ count: 2 }])

    const result = await manageRecurringTransaction.execute(
      manageRecurringTransaction.schema.parse({
        action: 'update',
        ruleId: 'rule-linked',
        type: 'income',
      })
    )

    expect(result).toEqual({
      success: false,
      message:
        'Recurring rule rule-linked has 2 linked transactions. Clear or migrate those links before changing the rule account or type.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('unlinks historical transactions before deleting a recurring rule', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'rule-delete',
          description: 'Old rent',
          amount: 100000,
          type: 'expense',
          frequency: 'monthly',
          next_date: '2026-01-01',
          active: 1,
        },
      ])
      .mockReturnValueOnce([{ count: 1 }])

    const result = await manageRecurringTransaction.execute(
      manageRecurringTransaction.schema.parse({ action: 'delete', ruleId: 'rule-delete' })
    )

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      'UPDATE transactions SET recurring_rule_id = NULL WHERE recurring_rule_id = $1',
      ['rule-delete']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'DELETE FROM recurring_rules WHERE id = $1', [
      'rule-delete',
    ])
    expect(result).toEqual({
      success: true,
      message: 'Deleted recurring rule "Old rent" and unlinked 1 transaction.',
    })
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
      reason: 'unsupported_recurring_transfer',
      message:
        'Recurring transfers are not supported yet. Create separate recurring income/expense rules until destination-account support is fully implemented.',
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
        'rule-1',
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

  it('rejects materializing recurring rules attached to archived accounts', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'rule-archived',
        account_id: 'acct-old',
        currency: 'USD',
        account_currency: 'USD',
        account_is_archived: 1,
        category_id: 'cat-1',
        type: 'expense',
        amount: 1250,
        description: 'Old account subscription',
        notes: null,
        next_date: '2026-04-15',
        frequency: 'monthly',
        end_date: null,
      },
    ])

    const result = await materializeRecurring.execute(materializeRecurring.schema.parse({}))

    expect(result).toEqual({
      success: false,
      reason: 'account_archived',
      message:
        'Recurring rule "Old account subscription" points at archived account acct-old. Unarchive the account or pause the rule before materializing it.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
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
        'rule-1',
      ]
    )
  })

  it('blocks account currency changes while linked monetary rows still depend on the account', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', name: 'Checking', currency: 'USD', is_archived: 0 }]
      }
      if (sql.includes('FROM recurring_rules')) return [{ count: 2 }]
      if (sql.includes('SELECT balance FROM accounts')) return [{ balance: 0 }]
      if (sql.includes('COUNT(*) as count')) return [{ count: 0 }]
      return []
    })

    const input = updateAccount.schema.parse({
      accountId: 'acct-1',
      currency: 'EUR',
    })

    const result = await updateAccount.execute(input)

    expect(result).toEqual({
      success: false,
      message:
        'Cannot change this account currency while 2 linked monetary references still point at the account. Create a new account or explicitly migrate the referenced data so amounts do not silently change meaning.',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('allows account currency updates when no linked monetary rows exist', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('SELECT * FROM accounts WHERE id = $1')) {
        return [{ id: 'acct-1', name: 'Checking', currency: 'EUR', is_archived: 0 }]
      }
      if (sql.includes('SELECT balance FROM accounts')) return [{ balance: 0 }]
      if (sql.includes('COUNT(*) as count')) return [{ count: 0 }]
      return []
    })

    const input = updateAccount.schema.parse({
      accountId: 'acct-1',
      currency: 'USD',
    })

    const result = await updateAccount.execute(input)

    expect(result).toEqual({
      success: true,
      message: 'Updated account "Checking".',
    })
    expect(mockExecute).toHaveBeenCalledTimes(2)
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
        'rule-1',
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
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-200, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(2, expect.stringContaining('UPDATE transactions'), [
      1200,
      'expense',
      'Lunch',
      null,
      '2026-04-14',
      'old notes',
      'acct-1',
      'JPY',
      null,
      'posted',
      null,
      null,
      null,
      'tx-1',
    ])
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.any(Array)
    )
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
      .mockReturnValueOnce({ rowsAffected: 0, lastInsertId: 1 })

    const input = updateTransaction.schema.parse({
      transactionId: 'tx-1',
      amount: 12,
    })

    await expect(updateTransaction.execute(input)).rejects.toThrow(
      'Transaction tx-1 could not be updated safely.'
    )
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(2)
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
    expect(mockExecute).toHaveBeenCalledTimes(3)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [1000, 'acct-1']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(2, 'DELETE FROM transactions WHERE id = $1', [
      'tx-1',
    ])
    expect(mockExecute).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.any(Array)
    )
    expect(result).toEqual({
      success: true,
      message: 'Deleted expense: $10.00 "Coffee" from 2026-04-14',
    })
  })

  it('reverses both accounts when deleting a transfer transaction', async () => {
    mockQuery.mockReturnValueOnce([
      {
        id: 'tx-transfer',
        amount: 2500,
        type: 'transfer',
        account_id: 'acct-checking',
        transfer_to_account_id: 'acct-savings',
        description: 'Move cash',
        date: '2026-04-14',
      },
    ])

    const input = deleteTransaction.schema.parse({
      transactionId: 'tx-transfer',
    })

    const result = await deleteTransaction.execute(input)

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockExecute).toHaveBeenCalledTimes(4)
    expect(mockExecute).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [2500, 'acct-checking']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('UPDATE accounts SET balance = balance + $1'),
      [-2500, 'acct-savings']
    )
    expect(mockExecute).toHaveBeenNthCalledWith(3, 'DELETE FROM transactions WHERE id = $1', [
      'tx-transfer',
    ])
    expect(mockExecute).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('INSERT INTO audit_log'),
      expect.any(Array)
    )
    expect(result).toEqual({
      success: true,
      message: 'Deleted transfer: $25.00 "Move cash" from 2026-04-14',
    })
  })

  it('filters query-transactions by source or destination transfer account', async () => {
    mockQuery
      .mockReturnValueOnce([
        {
          id: 'tx-transfer',
          description: 'Card payment',
          amount: 5000,
          type: 'transfer',
          date: '2026-04-14',
          notes: null,
          category_name: 'Uncategorized',
          account_name: 'Checking',
          transfer_to_account_id: 'acct-card',
          transfer_to_account_name: 'Visa',
        },
      ])
      .mockReturnValueOnce([{ count: 1 }])

    const input = queryTransactions.schema.parse({ accountId: 'acct-card', limit: 5 })

    const result = await queryTransactions.execute(input)

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('(t.account_id = $1 OR t.transfer_to_account_id = $2)'),
      ['acct-card', 'acct-card', 5]
    )
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('(t.account_id = $1 OR t.transfer_to_account_id = $2)'),
      ['acct-card', 'acct-card']
    )
    expect(result).toMatchObject({
      count: 1,
      totalMatched: 1,
      transactions: [
        {
          id: 'tx-transfer',
          transferToAccountId: 'acct-card',
          transferToAccount: 'Visa',
        },
      ],
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
