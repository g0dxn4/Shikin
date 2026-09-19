import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { TransactionDialog } from '../transaction-dialog'
import type { TransactionPageRow } from '@/lib/transaction-query'
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  splits: vi.fn(),
  correct: vi.fn(),
  update: vi.fn(),
  close: vi.fn(),
  fetch: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue([]),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/database', () => ({ query: mocks.query }))
vi.mock('@/lib/transaction-query', () => ({ getTransactionById: mocks.get }))
vi.mock('@/lib/split-service', () => ({ getSplits: mocks.splits }))
vi.mock('@/lib/transaction-query-events', () => ({ invalidateTransactionPage: vi.fn() }))
vi.mock('@/stores/ui-store', () => ({
  useUIStore: () => ({
    transactionDialogOpen: true,
    editingTransactionId: 'tx',
    closeTransactionDialog: mocks.close,
  }),
}))
vi.mock('@/stores/transaction-store', () => ({
  useTransactionStore: () => ({ correctMetadata: mocks.correct, update: mocks.update }),
}))
vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [{ id: 'a', name: 'Synthetic', currency: 'USD' }],
    fetch: mocks.fetch,
  }),
}))
vi.mock('@/stores/category-store', () => ({
  useCategoryStore: () => ({
    categories: [
      { id: 'food', name: 'Food', type: 'expense' },
      { id: 'other', name: 'Other', type: 'expense' },
    ],
    fetch: mocks.fetch,
  }),
}))
vi.mock('@/stores/categorization-store', () => ({
  useCategorizationStore: () => ({ suggestCategory: vi.fn() }),
}))
const base: TransactionPageRow = {
  id: 'tx',
  account_id: 'a',
  category_id: 'food',
  subcategory_id: null,
  type: 'expense',
  amount: 1000,
  currency: 'USD',
  description: 'Original',
  notes: null,
  date: '2026-01-01',
  tags: '',
  is_recurring: 0,
  transfer_to_account_id: null,
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  has_splits: 0,
  finalization_id: 'final',
  is_finalized_statement: 1,
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue(base)
  mocks.correct.mockResolvedValue(undefined)
  mocks.splits.mockResolvedValue([
    {
      id: 's1',
      category_id: 'food',
      subcategory_id: null,
      amount: 400,
      notes: 'original split note',
    },
    { id: 's2', category_id: 'other', subcategory_id: null, amount: 600, notes: null },
  ])
})
describe('native metadata and split editor parity', () => {
  it('retains the existing dialog design and locks finalized financial fields while submitting metadata', async () => {
    render(<TransactionDialog />)
    const description = await screen.findByLabelText('form.description')
    expect(screen.getByLabelText('form.amount')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('form.date')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('form.account')).toBeDisabled()
    expect(screen.getByLabelText('correction.reporting')).toBeInTheDocument()
    fireEvent.change(description, { target: { value: 'Corrected description' } })
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenCalledWith(
        'tx',
        expect.objectContaining({
          description: 'Corrected description',
          notes: null,
          reporting_treatment: 'normal',
        }),
        undefined
      )
    )
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.close).toHaveBeenCalled()
  })
  it('loads split allocations before enabling edits and avoids replacing evidence for metadata-only saves', async () => {
    mocks.get.mockResolvedValue({ ...base, has_splits: 1 })
    render(<TransactionDialog />)
    const description = await screen.findByLabelText('form.description')
    expect(screen.getByLabelText('form.amount 1')).toHaveValue(4)
    expect(screen.getByLabelText('form.amount 2')).toHaveValue(6)
    fireEvent.change(description, { target: { value: 'Only metadata' } })
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenCalledWith(
        'tx',
        expect.objectContaining({ description: 'Only metadata' }),
        undefined
      )
    )
  })
  it('submits explicit split replacement with preserved notes and does not close on policy rejection', async () => {
    mocks.get.mockResolvedValue({ ...base, has_splits: 1 })
    mocks.correct.mockRejectedValue(new Error('Clear classifications before replacing splits.'))
    render(<TransactionDialog />)
    await screen.findByLabelText('form.description')
    fireEvent.change(screen.getByLabelText('form.amount 1'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('form.amount 2'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }))
    await waitFor(() =>
      expect(mocks.correct).toHaveBeenCalledWith('tx', expect.any(Object), [
        { categoryId: 'food', subcategoryId: null, amount: 500, notes: 'original split note' },
        { categoryId: 'other', subcategoryId: null, amount: 500, notes: null },
      ])
    )
    expect(mocks.close).not.toHaveBeenCalled()
  })
})
