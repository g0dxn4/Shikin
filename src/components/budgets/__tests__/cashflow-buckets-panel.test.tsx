import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
  reverse: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/cashflow-bucket-service', () => ({
  listCashflowBuckets: mocks.list,
  deleteCashflowBucket: mocks.remove,
  reverseCashflowAllocation: mocks.reverse,
  updateCashflowBucket: mocks.update,
}))
vi.mock('@/components/budgets/cashflow-bucket-dialogs', () => ({
  CashflowBucketEditorDialog: ({ open, onSaved }: { open: boolean; onSaved: () => void }) =>
    open ? (
      <div role="dialog">
        bucket-editor
        <button onClick={onSaved}>save-bucket</button>
      </div>
    ) : null,
  CashflowAllocationDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">bucket-allocation</div> : null,
  CashflowCorrectionDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">bucket-correction</div> : null,
}))
vi.mock('@/components/shared/confirm-dialog', () => ({
  ConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? <button onClick={onConfirm}>confirm-bucket-action</button> : null,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}))

import { CashflowBucketsPanel } from '../cashflow-buckets-panel'

const bucket = {
  id: 'rent',
  name: 'Rent',
  description: 'Monthly reserve',
  targetAmountCentavos: 100_00,
  balanceCentavos: 40_00,
  currency: 'USD',
  sortOrder: 0,
  isActive: true,
  createdAt: null,
  updatedAt: null,
  allocationCount: 1,
}
const allocation = {
  id: 'allocation-1',
  bucketId: 'rent',
  transactionId: 'income-1',
  amountCentavos: 40_00,
  currency: 'USD',
  allocationDate: '2026-05-01',
  source: 'income-transaction',
  note: null,
  reversesAllocationId: null,
  replacesAllocationId: null,
  createdAt: null,
}

function view() {
  return {
    buckets: [
      bucket,
      {
        ...bucket,
        id: 'travel',
        name: 'Travel',
        currency: 'EUR',
        targetAmountCentavos: null,
        balanceCentavos: 0,
        allocationCount: 0,
      },
    ],
    allocations: [allocation],
    incomeSources: [],
  }
}

const originalHref = window.location.href

describe('CashflowBucketsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', originalHref)
    mocks.list.mockResolvedValue(view())
    mocks.remove.mockResolvedValue(undefined)
    mocks.reverse.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue(undefined)
  })

  afterEach(() => {
    window.history.replaceState({}, '', originalHref)
  })

  it('groups native currencies, states the ledger boundary and exposes wrapped 44px controls', async () => {
    render(<CashflowBucketsPanel />)
    expect(await screen.findByText('Rent')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    )
    expect(screen.getByText('Travel')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'USD' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EUR' })).toBeInTheDocument()
    expect(screen.getByText('buckets.disclaimer')).toBeInTheDocument()
    expect(screen.getByText('buckets.count {"count":2}')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    expect(screen.getByRole('button', { name: 'buckets.actions.create' })).toHaveClass('min-h-11')
    expect(screen.getAllByRole('button', { name: 'buckets.actions.allocate' })[0]).toHaveClass(
      'min-h-11'
    )
    expect(
      screen.getByRole('button', { name: 'buckets.actions.create' }).parentElement
    ).toHaveClass('gap-3')
  })

  it('supports keyboard opening and reports/retries load errors', async () => {
    const user = userEvent.setup()
    mocks.list.mockRejectedValue(new Error('offline'))
    render(<CashflowBucketsPanel />)
    expect(await screen.findByRole('alert')).toHaveTextContent('offline')
    expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
      'aria-expanded',
      'true'
    )
    mocks.list.mockResolvedValue(view())
    await user.click(screen.getByRole('button', { name: 'buckets.actions.retry' }))
    expect(await screen.findByText('Rent')).toBeInTheDocument()

    const create = screen.getByRole('button', { name: 'buckets.actions.create' })
    create.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toHaveTextContent('bucket-editor')
  })

  it('stays collapsed and discoverable when there are zero buckets', async () => {
    const user = userEvent.setup()
    mocks.list.mockResolvedValue({ buckets: [], allocations: [], incomeSources: [] })
    render(<CashflowBucketsPanel />)
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1))
    const toggle = screen.getByRole('button', { name: 'buckets.title' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByText('buckets.count {"count":0}')).toBeInTheDocument()
    expect(screen.getByText('buckets.disclaimer')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'buckets.actions.create' })).toBeEnabled()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('buckets.empty.title')).toBeInTheDocument()
  })

  it('opens on a buckets deep link even with zero buckets', async () => {
    window.history.pushState({}, '', '/budgets?section=buckets')
    mocks.list.mockResolvedValue({ buckets: [], allocations: [], incomeSources: [] })
    render(<CashflowBucketsPanel />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    )
    expect(screen.getByRole('button', { name: 'buckets.actions.create' })).toBeEnabled()
  })

  it('opens on a buckets hash deep link even with zero buckets', async () => {
    window.history.pushState({}, '', '/budgets#cashflow-buckets')
    mocks.list.mockResolvedValue({ buckets: [], allocations: [], incomeSources: [] })
    render(<CashflowBucketsPanel />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    )
  })

  it('lets the user collapse without refetching', async () => {
    const user = userEvent.setup()
    render(<CashflowBucketsPanel />)
    await screen.findByText('Rent')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
        'aria-expanded',
        'true'
      )
    )
    const calls = mocks.list.mock.calls.length
    await user.click(screen.getByRole('button', { name: 'buckets.title' }))
    expect(screen.getByRole('button', { name: 'buckets.title' })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
    expect(mocks.list).toHaveBeenCalledTimes(calls)
    expect(screen.getByRole('button', { name: 'buckets.actions.create' })).toBeEnabled()
  })

  it('reopens a user-collapsed panel when a save refresh fails', async () => {
    const user = userEvent.setup()
    render(<CashflowBucketsPanel />)
    await screen.findByText('Rent')
    const toggle = screen.getByRole('button', { name: 'buckets.title' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'))

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    mocks.list.mockRejectedValueOnce(new Error('refresh offline'))
    await user.click(screen.getByRole('button', { name: 'buckets.actions.create' }))
    await user.click(screen.getByRole('button', { name: 'save-bucket' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toBeVisible()
    expect(alert).toHaveTextContent('refresh offline')
    expect(screen.getByRole('button', { name: 'buckets.actions.retry' })).toBeVisible()
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows delete only for empty unreferenced buckets and confirms one reversal', async () => {
    const user = userEvent.setup()
    render(<CashflowBucketsPanel />)
    await screen.findByText('Rent')
    const deletes = screen.getAllByRole('button', { name: 'buckets.actions.delete' })
    expect(deletes).toHaveLength(1)

    await user.click(screen.getByText(/buckets\.history\.title/))
    await user.click(screen.getByRole('button', { name: 'buckets.actions.reverse' }))
    await user.click(await screen.findByText('confirm-bucket-action'))
    await waitFor(() => expect(mocks.reverse).toHaveBeenCalledWith('allocation-1'))
  })
})
