import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  budgetHistoryPreviewToken,
  budgetHistorySummary,
  planBudgetHistory,
  type BudgetHistoryRequest,
} from '@shikin/finance-core/budget-history'
import type { ScopedReportDataset } from '@shikin/finance-core'

const mocks = vi.hoisted(() => ({ list: vi.fn(), record: vi.fn() }))
vi.mock('@/lib/budget-history', () => ({
  listBudgetHistory: mocks.list,
  recordBudgetHistory: mocks.record,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/budget-store', () => ({
  useBudgetStore: (
    selector: (state: {
      references: {
        accounts: { id: string; name: string }[]
        categories: { id: string; name: string; color: null }[]
      }
    }) => unknown
  ) =>
    selector({
      references: {
        accounts: [{ id: 'bank', name: 'Bank' }],
        categories: [{ id: 'home', name: 'Home', color: null }],
      },
    }),
}))

import { BudgetHistoryPanel } from '@/components/budgets/budget-history-panel'

const now = new Date('2026-03-05T12:00:00Z')
const dataset: ScopedReportDataset = {
  accounts: [{ id: 'bank', type: 'checking', currency: 'MXN', account_mode: 'transactional' }],
  categories: [{ id: 'home' }],
  transactions: [
    {
      id: 'purchase',
      account_id: 'bank',
      category_id: 'home',
      type: 'expense',
      amount: 1234,
      currency: 'MXN',
      date: '2026-03-02',
      status: 'posted',
    },
  ],
  splits: [],
  classifications: [],
  coverage: [],
  rates: [],
  activePaymentLinks: [],
}
const budget = {
  id: 'home-budget',
  name: 'Home',
  amount: 10000,
  currency: 'MXN',
  period: 'monthly' as const,
  category_id: 'home',
  scope_json: '{"categoryIds":["home"]}',
  basis: 'net_consumption' as const,
  is_active: 1,
}
const original = planBudgetHistory({
  request: {
    budgetId: budget.id,
    month: '2026-03',
    expectedRevision: 0,
    idempotencyKey: 'original',
    reason: 'Original March capture',
    source: 'app',
    timeZone: 'UTC',
  },
  budget,
  dataset,
  latest: null,
  id: 'original-history',
  now,
  sourceState: { databaseId: 'synthetic', dataRevision: 40 },
})
function result(request: BudgetHistoryRequest, dryRun: boolean) {
  const row = planBudgetHistory({
    request: { ...request, source: 'app' },
    budget,
    dataset,
    latest: request.month === original.month ? original : null,
    id: 'reviewed-history',
    now,
    sourceState: { databaseId: 'synthetic', dataRevision: 42 },
  })
  return {
    history: budgetHistorySummary(row),
    previewToken: budgetHistoryPreviewToken(row),
    changed: !dryRun,
    replayed: false,
    dryRun,
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  mocks.list.mockReset().mockResolvedValue({
    budgets: [
      { id: budget.id, name: budget.name, currency: budget.currency, amount: budget.amount },
    ],
    history: [budgetHistorySummary(original)],
    truncated: false,
  })
  mocks.record
    .mockReset()
    .mockImplementation(async (request: BudgetHistoryRequest, dryRun = false) =>
      result(request, dryRun)
    )
})
afterEach(() => vi.useRealTimers())

async function prepare() {
  render(<BudgetHistoryPanel initialBudgetId={budget.id} />)
  await waitFor(() => expect(screen.queryByText('scoped.loading')).not.toBeInTheDocument())
  fireEvent.change(screen.getByLabelText('history.reason'), {
    target: { value: 'Correct the limit using the original worksheet' },
  })
  fireEvent.change(screen.getByLabelText('history.limitCorrection'), { target: { value: '150' } })
  fireEvent.click(screen.getByRole('button', { name: 'history.previewCorrection' }))
  await screen.findByRole('button', { name: 'history.save' })
}

describe('reviewed budget-history writes', () => {
  it('renders unknown net totals and invalidates a preview when amount or month changes before apply', async () => {
    await prepare()
    expect(screen.getAllByText('history.unknown').length).toBeGreaterThan(1)
    expect(screen.getAllByText('history.incompleteNet').length).toBeGreaterThan(0)
    expect(mocks.record).toHaveBeenCalledTimes(1)
    expect(mocks.record.mock.calls[0][1]).toBe(true)

    fireEvent.change(screen.getByLabelText('history.limitCorrection'), { target: { value: '175' } })
    expect(screen.queryByRole('button', { name: 'history.save' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('history.month'), { target: { value: '2026-02' } })
    expect(mocks.record).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'history.previewCapture' }))
    fireEvent.click(await screen.findByRole('button', { name: 'history.save' }))
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(3))
    const reviewed = mocks.record.mock.calls[1][0]
    const applied = mocks.record.mock.calls[2][0]
    expect(applied).toMatchObject({
      month: '2026-02',
      expectedRevision: 0,
      correction: { amountCentavos: 17500 },
      expectedDataRevision: 42,
      expectedToken: result(reviewed, true).previewToken,
      idempotencyKey: reviewed.idempotencyKey,
    })
    expect(mocks.record.mock.calls.filter((call) => call[1] !== true)).toHaveLength(1)
  })

  it('retains the exact reviewed request and idempotency key after a failed save for a safe retry', async () => {
    let failed = false
    mocks.record.mockImplementation(async (request: BudgetHistoryRequest, dryRun = false) => {
      if (!dryRun && !failed) {
        failed = true
        throw new Error('Connection lost after submit')
      }
      return result(request, dryRun)
    })
    await prepare()
    fireEvent.click(screen.getByRole('button', { name: 'history.save' }))
    await screen.findByText('Connection lost after submit')
    const firstApply = mocks.record.mock.calls[1][0]
    const retry = screen.getByRole('button', { name: 'history.save' })
    await waitFor(() => expect(retry).toBeEnabled())
    fireEvent.click(retry)
    await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(3))
    expect(mocks.record.mock.calls[2][0]).toEqual(firstApply)
    expect(firstApply).toMatchObject({
      expectedRevision: 1,
      expectedDataRevision: 42,
      expectedToken: result(mocks.record.mock.calls[0][0], true).previewToken,
      correction: { amountCentavos: 15000 },
      idempotencyKey: mocks.record.mock.calls[0][0].idempotencyKey,
    })
  })
})
