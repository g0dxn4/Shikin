import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountMaintenanceAction } from '../account-maintenance-dialog'
import type { Account } from '@/types/database'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  previewFinalization: vi.fn(),
  finalize: vi.fn(),
  previewSupersession: vi.fn(),
  supersede: vi.fn(),
  coverage: vi.fn(),
  settle: vi.fn(),
}))
vi.mock('@/lib/account-reconciliation-service', () => ({
  readAccountMaintenance: mocks.read,
  previewAccountStatementFinalization: mocks.previewFinalization,
  finalizeAccountStatementHistory: mocks.finalize,
  previewAccountBridgeSupersession: mocks.previewSupersession,
  supersedeAccountReconciliationBridge: mocks.supersede,
  setAccountSourceCoverage: mocks.coverage,
  settleAccountStagedTransactions: mocks.settle,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

const account = {
  id: 'a',
  name: 'Checking',
  type: 'checking',
  currency: 'USD',
  balance: 0,
  icon: null,
  color: null,
  is_archived: 0,
  account_mode: 'transactional',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
} as Account

const staged = {
  id: 'staged',
  description: 'Statement purchase',
  date: '2025-01-15',
  type: 'expense',
  amount: 500,
  currency: 'USD',
  account_id: 'a',
  transfer_to_account_id: null,
  matched_transaction_id: null,
  status: 'posted',
  ledger_treatment: 'staged_no_balance_impact',
  transaction_kind: 'standard',
  reporting_treatment: 'normal',
  is_archived: 0,
  source_account_id: 'a',
  source_currency: 'USD',
  source_account_mode: 'transactional',
  destination_account_id: null,
  destination_currency: null,
  destination_account_mode: null,
  finalization_id: null,
  reconciliation_id: null,
  import_source: 'Bank',
  staging_batch_id: 'batch',
}
const coverage = {
  id: 'coverage',
  account_id: 'a',
  source_namespace: 'Bank',
  period_start: '2025-01-01',
  period_end: '2025-01-31',
  status: 'verified',
  zero_rows: 0,
  document_ref: 'statement.pdf',
  source: null,
  note: null,
}
const history = {
  account: { ...account, account_mode: 'transactional' },
  observations: [],
  coverage: [coverage],
  transactions: [staged],
  corrections: [],
}

describe('AccountMaintenanceAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.read.mockResolvedValue(history)
    mocks.previewFinalization.mockResolvedValue({
      previewToken: 'reviewed-token',
      transactionIds: ['staged'],
      transactionCount: 1,
      coverage: [coverage],
      reconciliationDate: '2025-01-31',
      stagedBalanceEffect: -500,
      adjustment: 500,
    })
    mocks.finalize.mockResolvedValue({ reconciliationId: 'observation' })
    mocks.previewSupersession.mockResolvedValue({
      previewToken: 'supersession-token',
      originalSignedBridge: 1_000,
      replacementEffect: -500,
      successorSignedBridge: 1_500,
      currentStored: 777,
      currentEffective: 800,
      laterAnchors: [{ id: 'later', date: '2025-02-28', effectiveBalance: 800 }],
    })
    mocks.supersede.mockResolvedValue({ correctionId: 'correction' })
  })

  it('is hidden for snapshot-only accounts', () => {
    const { container } = render(
      <AccountMaintenanceAction account={{ ...account, account_mode: 'snapshot_only' }} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('supports keyboard opening, reviewed preview, and separate confirmation', async () => {
    const user = userEvent.setup()
    render(<AccountMaintenanceAction account={account} />)
    await user.tab()
    expect(screen.getByRole('button', { name: 'action' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByText('title')).toBeInTheDocument()
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('a'))

    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1]!) // exact coverage evidence
    await user.click(checkboxes[2]!) // exact staged row
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))

    await waitFor(() => expect(mocks.previewFinalization).toHaveBeenCalledTimes(1))
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('finalize.bridge')
    await user.click(screen.getByRole('button', { name: 'finalize.confirm' }))
    await waitFor(() =>
      expect(mocks.finalize).toHaveBeenCalledWith(
        expect.objectContaining({ previewToken: 'reviewed-token', transactionIds: ['staged'] })
      )
    )
  })

  it('displays reviewed B/R/S and preserved anchors before supersession confirmation', async () => {
    mocks.read.mockResolvedValue({
      ...history,
      observations: [
        {
          id: 'original',
          account_id: 'a',
          reconciliation_date: '2025-01-31',
          actual_balance: 1_000,
          adjustment_amount: 1_000,
          adjustment_transaction_id: 'bridge',
        },
      ],
      transactions: [
        {
          ...staged,
          id: 'bridge',
          description: 'Original bridge',
          date: '2025-01-31',
          type: 'income',
          amount: 1_000,
          ledger_treatment: 'normal',
          transaction_kind: 'reconciliation_bridge',
          reporting_treatment: 'exclude_from_cashflow',
          reconciliation_id: 'original',
          import_source: null,
          staging_batch_id: null,
        },
        staged,
      ],
    })
    const user = userEvent.setup()
    render(<AccountMaintenanceAction account={account} />)
    await user.click(screen.getByRole('button', { name: 'action' }))
    await screen.findByText('title')
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.selectOptions(screen.getByLabelText('supersede.bridge'), 'bridge')
    await user.click(screen.getByRole('button', { name: 'supersede.preview' }))
    const review = await screen.findByRole('status')
    expect(review).toHaveTextContent('B')
    expect(review).toHaveTextContent('R')
    expect(review).toHaveTextContent('S')
    expect(review).toHaveTextContent('supersede.currentPreserved')
    expect(review).toHaveTextContent('supersede.anchors')
    await user.click(screen.getByRole('button', { name: 'supersede.confirm' }))
    await waitFor(() =>
      expect(mocks.supersede).toHaveBeenCalledWith(
        expect.objectContaining({ previewToken: 'supersession-token', bridgeId: 'bridge' })
      )
    )
  })

  it('shows an honest error and does not expose confirmation when preview fails', async () => {
    mocks.previewFinalization.mockRejectedValueOnce(new Error('Coverage is incomplete'))
    const user = userEvent.setup()
    render(<AccountMaintenanceAction account={account} />)
    await user.click(screen.getByRole('button', { name: 'action' }))
    await screen.findByText('title')
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    expect(await screen.findByText('Coverage is incomplete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
  })
})
