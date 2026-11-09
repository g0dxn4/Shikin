import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountMaintenanceDialog } from '../account-maintenance-dialog'
import type { Account } from '@/types/database'
import { toast } from 'sonner'
import type { ComponentProps } from 'react'
import type * as IdentityDialogModule from '@/components/transactions/legacy-import-identity-dialog'

type IdentityActionProps = ComponentProps<typeof IdentityDialogModule.LegacyImportIdentityAction>
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  previewFinalization: vi.fn(),
  finalize: vi.fn(),
  previewSupersession: vi.fn(),
  supersede: vi.fn(),
  coverage: vi.fn(),
  settle: vi.fn(),
  invalidate: vi.fn(),
  identityChanged: undefined as IdentityActionProps['onChanged'],
  showIdentityDialog: false,
  identityRead: vi.fn(),
  identityPreview: vi.fn(),
  identityBind: vi.fn(),
}))
vi.mock('@/lib/account-reconciliation-service', () => ({
  readAccountMaintenance: mocks.read,
  previewAccountStatementFinalization: mocks.previewFinalization,
  previewAccountBridgeSupersession: mocks.previewSupersession,
}))
vi.mock('@/lib/account-maintenance-actions', () => ({
  finalizeAccountStatementHistory: mocks.finalize,
  supersedeAccountReconciliationBridge: mocks.supersede,
  setAccountSourceCoverage: mocks.coverage,
  settleAccountStagedTransactions: mocks.settle,
}))
vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: mocks.invalidate,
}))
vi.mock('@/lib/import-identity-service', () => ({
  readLegacyImportIdentityTransaction: mocks.identityRead,
  previewLegacyImportIdentity: mocks.identityPreview,
}))
vi.mock('@/lib/import-identity-actions', () => ({
  bindLegacyImportIdentity: mocks.identityBind,
}))
vi.mock('@/components/transactions/legacy-import-identity-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof IdentityDialogModule>()
  return {
    LegacyImportIdentityAction: (props: IdentityActionProps) => {
      mocks.identityChanged = props.onChanged
      return mocks.showIdentityDialog ? (
        <actual.LegacyImportIdentityAction {...props} />
      ) : (
        <button type="button">identity-action-{props.transactionId}</button>
      )
    },
  }
})
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

describe('AccountMaintenanceDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.identityChanged = undefined
    mocks.showIdentityDialog = false
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
    mocks.finalize.mockResolvedValue({
      reconciliationId: 'observation',
      refreshIncomplete: false,
    })
    mocks.previewSupersession.mockResolvedValue({
      previewToken: 'supersession-token',
      originalSignedBridge: 1_000,
      replacementEffect: -500,
      successorSignedBridge: 1_500,
      currentStored: 777,
      currentEffective: 800,
      laterAnchors: [{ id: 'later', date: '2025-02-28', effectiveBalance: 800 }],
    })
    mocks.supersede.mockResolvedValue({ correctionId: 'correction', refreshIncomplete: false })
  })

  it('owns a late identity reload warning after unmount and acknowledges delivery', async () => {
    mocks.read
      .mockResolvedValueOnce({
        ...history,
        transactions: [{ ...staged, import_source: null }],
      })
      .mockRejectedValueOnce(new Error('late identity reload unavailable'))
    const view = render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByRole('button', { name: 'identity-action-staged' })
    const changed = mocks.identityChanged
    if (!changed) throw new Error('Expected identity completion callback')
    view.unmount()
    await expect(changed({ refreshIncomplete: false })).resolves.toEqual({
      refreshWarningHandled: true,
    })
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith('errors.savedRefreshFailed')
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [true, false, false],
    [false, false, false],
    [false, true, false],
    [true, true, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ] as const)(
    'pins the identity warning when parent reload removes its launcher (storeFailure=%s, localFailure=%s, unmounted=%s)',
    async (storeFailure, localFailure, unmounted) => {
      mocks.showIdentityDialog = true
      const identity = {
        ...staged,
        import_source: null,
        import_external_id: null,
        import_fingerprint: null,
        import_content_fingerprint: null,
        notes: null,
        source: null,
        note: null,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }
      const preview = {
        previewToken: 'identity-token',
        transaction: identity,
        binding: {
          transactionId: 'staged',
          importSource: 'Bank',
          importExternalId: '007',
          importFingerprint: 'identity',
          importContentFingerprint: null,
          originalContentVerified: false,
        },
        limitation: 'Original content is unknown.',
      }
      const boundHistory = { ...history, transactions: [{ ...identity, import_source: 'Bank' }] }
      let resolveReload!: (value: typeof boundHistory) => void
      let rejectReload!: (error: Error) => void
      mocks.read.mockResolvedValueOnce({ ...history, transactions: [identity] })
      if (unmounted) {
        mocks.read.mockReturnValueOnce(
          new Promise((resolve, reject) => {
            resolveReload = resolve
            rejectReload = reject
          })
        )
      } else if (localFailure)
        mocks.read.mockRejectedValueOnce(new Error('local refresh unavailable'))
      else mocks.read.mockResolvedValueOnce(boundHistory)
      mocks.identityRead.mockResolvedValue(identity)
      mocks.identityPreview.mockResolvedValue(preview)
      mocks.identityBind.mockResolvedValue({ ...preview, refreshIncomplete: storeFailure })
      const user = userEvent.setup()
      const view = render(
        <AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />
      )
      await user.click(await screen.findByRole('button', { name: 'identity.action' }))
      const dialog = screen.getByRole('dialog', { name: 'identity.title' })
      await within(dialog).findByText('Statement purchase')
      await user.type(within(dialog).getByLabelText('identity.sourceNamespace'), 'Bank')
      await user.type(within(dialog).getByLabelText('identity.externalId'), '007')
      await user.click(within(dialog).getByRole('checkbox'))
      await user.click(within(dialog).getByRole('button', { name: 'identity.review' }))
      await user.click(await within(dialog).findByRole('button', { name: 'identity.confirm' }))
      await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
      if (unmounted) {
        view.unmount()
        await act(async () => {
          if (localFailure) rejectReload(new Error('local refresh unavailable'))
          else resolveReload(boundHistory)
        })
        expect(toast.warning).toHaveBeenCalledExactlyOnceWith('errors.savedRefreshFailed')
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      } else {
        await waitFor(() =>
          expect(screen.queryByRole('button', { name: 'identity.action' })).not.toBeInTheDocument()
        )
        if (storeFailure || localFailure) {
          expect(await screen.findByText('errors.savedRefreshFailed')).toBeVisible()
          expect(screen.getAllByText('errors.savedRefreshFailed')).toHaveLength(1)
        } else expect(screen.queryByText('errors.savedRefreshFailed')).not.toBeInTheDocument()
        expect(toast.warning).not.toHaveBeenCalled()
      }
      expect(screen.queryByRole('dialog', { name: 'identity.title' })).not.toBeInTheDocument()
      expect(screen.queryByText('identity.savedRefreshFailed')).not.toBeInTheDocument()
      expect(mocks.identityBind).toHaveBeenCalledOnce()
    }
  )

  it('requires a reviewed preview and separate confirmation with the exact finalization payload', async () => {
    const user = userEvent.setup()
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    expect(await screen.findByText('title')).toBeInTheDocument()
    await waitFor(() => expect(mocks.read).toHaveBeenCalledWith('a'))

    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!) // exact coverage evidence
    await user.click(checkboxes[2]!) // exact staged row
    await user.clear(screen.getByLabelText('coverage.start'))
    await user.type(screen.getByLabelText('coverage.start'), '2025-01-01')
    await user.clear(screen.getByLabelText('coverage.end'))
    await user.type(screen.getByLabelText('coverage.end'), '2025-01-31')
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))

    await waitFor(() => expect(mocks.previewFinalization).toHaveBeenCalledTimes(1))
    expect(mocks.previewFinalization.mock.calls).toStrictEqual([
      [
        {
          accountId: 'a',
          transactionIds: ['staged'],
          coverageIds: ['coverage'],
          acknowledgeProvisional: false,
          provisionalProvenance: undefined,
          statementStartDate: '2025-01-01',
          statementEndDate: '2025-01-31',
          actualBalanceCentavos: 0,
        },
      ],
    ])
    expect(mocks.finalize).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('finalize.bridge')
    await user.click(screen.getByRole('button', { name: 'finalize.confirm' }))
    await waitFor(() =>
      expect(mocks.finalize.mock.calls).toStrictEqual([
        [
          {
            accountId: 'a',
            transactionIds: ['staged'],
            coverageIds: ['coverage'],
            acknowledgeProvisional: false,
            provisionalProvenance: undefined,
            statementStartDate: '2025-01-01',
            statementEndDate: '2025-01-31',
            actualBalanceCentavos: 0,
            previewToken: 'reviewed-token',
          },
        ],
      ])
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
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
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
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    expect(await screen.findByText('Coverage is incomplete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
  })

  it('mounts the explicit identity workflow only on unbound staged rows', async () => {
    mocks.read.mockResolvedValue({
      ...history,
      transactions: [{ ...staged, import_source: null }],
    })
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'identity-action-staged' })).toBeVisible()
  })

  it('ignores an older preview after an input change', async () => {
    let resolvePreview: (value: Awaited<ReturnType<typeof mocks.previewFinalization>>) => void
    mocks.previewFinalization.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        })
    )
    const user = userEvent.setup()
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    const balance = screen.getByLabelText('finalize.balance')
    await user.type(balance, '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    await user.clear(balance)
    await user.type(balance, '1')
    resolvePreview!({
      previewToken: 'obsolete-token',
      transactionIds: ['staged'],
      transactionCount: 1,
      coverage: [coverage],
      reconciliationDate: '2025-01-31',
      stagedBalanceEffect: -500,
      adjustment: 500,
    })
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'finalize.preview' })).toBeEnabled()
  })

  it('clears confirmation after a rejected apply and requires a fresh review', async () => {
    mocks.finalize.mockRejectedValueOnce(new Error('stale reviewed preview token'))
    const user = userEvent.setup()
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))
    expect(await screen.findByText('stale reviewed preview token')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'finalize.preview' })).toBeEnabled()
  })

  it.each([false, true])(
    'pins the committed settlement warning after review reset (reloadFails=%s)',
    async (reloadFails) => {
      mocks.read.mockResolvedValueOnce({
        ...history,
        transactions: [{ ...staged, status: 'pending' }],
      })
      if (reloadFails) mocks.read.mockRejectedValueOnce(new Error('local reload unavailable'))
      mocks.settle.mockResolvedValueOnce({
        transactionIds: ['staged'],
        refreshIncomplete: true,
      })
      const user = userEvent.setup()
      render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
      await screen.findByText('Statement purchase')
      await user.click(screen.getAllByRole('checkbox')[2]!)
      await user.click(screen.getByRole('button', { name: 'settlement.reviewAction' }))
      await user.click(screen.getByRole('button', { name: 'settlement.confirm' }))
      await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
      expect(mocks.settle).toHaveBeenCalledExactlyOnceWith({
        accountId: 'a',
        transactionIds: ['staged'],
        status: 'posted',
      })
      expect(screen.queryByText('errors.savedRefreshFailed')).not.toBeInTheDocument()
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith('errors.savedRefreshFailed')
      expect(screen.queryByRole('button', { name: 'settlement.confirm' })).not.toBeInTheDocument()
    }
  )

  it.each([
    ['close', false],
    ['close', true],
    ['reopen', false],
    ['reopen', true],
    ['account', false],
    ['account', true],
  ] as const)(
    'keeps one committed warning after %s during local reload (reloadFails=%s)',
    async (change, reloadFails) => {
      let resolveReload!: (value: typeof history) => void
      let rejectReload!: (error: Error) => void
      mocks.read.mockResolvedValueOnce(history).mockImplementationOnce(
        () =>
          new Promise<typeof history>((resolve, reject) => {
            resolveReload = resolve
            rejectReload = reject
          })
      )
      mocks.finalize.mockResolvedValueOnce({
        reconciliationId: 'observation',
        refreshIncomplete: true,
      })
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const view = render(
        <AccountMaintenanceDialog account={account} open onOpenChange={onOpenChange} />
      )
      await screen.findByText('Statement purchase')
      await user.click(screen.getAllByRole('checkbox')[1]!)
      await user.click(screen.getAllByRole('checkbox')[2]!)
      await user.type(screen.getByLabelText('finalize.balance'), '0')
      await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
      await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))
      await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
      if (change === 'account') {
        view.rerender(
          <AccountMaintenanceDialog
            account={{ ...account, id: 'b' }}
            open
            onOpenChange={onOpenChange}
          />
        )
      } else {
        view.rerender(
          <AccountMaintenanceDialog account={account} open={false} onOpenChange={onOpenChange} />
        )
        if (change === 'reopen') {
          view.rerender(
            <AccountMaintenanceDialog account={account} open onOpenChange={onOpenChange} />
          )
        }
      }
      await act(async () => {
        if (reloadFails) rejectReload(new Error('local reload unavailable'))
        else
          resolveReload({
            ...history,
            transactions: [{ ...staged, description: 'Obsolete reload row' }],
          })
      })
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith('errors.savedRefreshFailed')
      expect(screen.queryByText('errors.savedRefreshFailed')).not.toBeInTheDocument()
      expect(screen.queryByText('Obsolete reload row')).not.toBeInTheDocument()
      expect(mocks.finalize).toHaveBeenCalledOnce()
    }
  )

  it.each([
    ['apply', true, false],
    ['reload', true, false],
    ['reload', true, true],
    ['reload', false, true],
  ] as const)(
    'pins warning delivery after unmount during %s (storeFailure=%s, localFailure=%s)',
    async (stage, storeFailure, localFailure) => {
      let resolveApply!: (result: { reconciliationId: string; refreshIncomplete: boolean }) => void
      let resolveReload!: (result: typeof history) => void
      let rejectReload!: (error: Error) => void
      mocks.finalize.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveApply = resolve
        })
      )
      if (stage === 'reload') {
        mocks.read.mockResolvedValueOnce(history).mockReturnValueOnce(
          new Promise((resolve, reject) => {
            resolveReload = resolve
            rejectReload = reject
          })
        )
      }
      const user = userEvent.setup()
      const view = render(
        <AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />
      )
      const checkboxes = await screen.findAllByRole('checkbox')
      await user.click(checkboxes[1]!)
      await user.click(checkboxes[2]!)
      await user.type(screen.getByLabelText('finalize.balance'), '0')
      await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
      await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))
      const committed = { reconciliationId: 'observation', refreshIncomplete: storeFailure }
      if (stage === 'reload') {
        await act(async () => resolveApply(committed))
        await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
      }
      view.unmount()
      await act(async () => {
        if (stage === 'apply') resolveApply(committed)
        else if (localFailure) rejectReload(new Error('local reload unavailable'))
        else resolveReload(history)
      })
      expect(toast.warning).toHaveBeenCalledExactlyOnceWith('errors.savedRefreshFailed')
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(mocks.read).toHaveBeenCalledTimes(stage === 'apply' ? 1 : 2)
      expect(mocks.finalize).toHaveBeenCalledOnce()
      expect(mocks.invalidate).toHaveBeenCalledWith('store-refresh')
    }
  )

  it('pins a local reload failure after finalization has committed', async () => {
    mocks.read.mockResolvedValueOnce(history).mockRejectedValueOnce(new Error('reload unavailable'))
    const user = userEvent.setup()
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))
    expect(await screen.findByText('errors.savedRefreshFailed')).toBeVisible()
    expect(mocks.finalize).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
  })

  it('invalidates committed views, clears mutation state, and reports rejected refreshes', async () => {
    mocks.finalize.mockResolvedValueOnce({
      reconciliationId: 'observation',
      refreshIncomplete: true,
    })
    const user = userEvent.setup()
    render(<AccountMaintenanceDialog account={account} open onOpenChange={vi.fn()} />)
    await screen.findByText('title')
    const checkboxes = await screen.findAllByRole('checkbox')
    await user.click(checkboxes[1]!)
    await user.click(checkboxes[2]!)
    await user.type(screen.getByLabelText('finalize.balance'), '0')
    await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
    await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))

    expect(await screen.findByText('errors.savedRefreshFailed')).toBeVisible()
    expect(mocks.invalidate).toHaveBeenCalledWith('store-refresh')
    expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
  })

  it.each([false, true])(
    'invalidates after close without reviving old state and reports any refresh warning (incomplete=%s)',
    async (incomplete) => {
      let resolveApply: (value: { reconciliationId: string; refreshIncomplete: boolean }) => void
      mocks.finalize.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveApply = resolve
          })
      )
      const user = userEvent.setup()
      const onOpenChange = vi.fn()
      const view = render(
        <AccountMaintenanceDialog account={account} open={true} onOpenChange={onOpenChange} />
      )
      await screen.findByText('title')
      const checkboxes = await screen.findAllByRole('checkbox')
      await user.click(checkboxes[1]!)
      await user.click(checkboxes[2]!)
      await user.type(screen.getByLabelText('finalize.balance'), '0')
      await user.click(screen.getByRole('button', { name: 'finalize.preview' }))
      await user.click(await screen.findByRole('button', { name: 'finalize.confirm' }))

      view.rerender(
        <AccountMaintenanceDialog account={account} open={false} onOpenChange={onOpenChange} />
      )
      resolveApply!({ reconciliationId: 'observation', refreshIncomplete: incomplete })
      await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledWith('store-refresh'))

      view.rerender(
        <AccountMaintenanceDialog account={account} open={true} onOpenChange={onOpenChange} />
      )
      await screen.findByText('title')
      expect(screen.queryByRole('button', { name: 'finalize.confirm' })).not.toBeInTheDocument()
      expect(screen.queryByText('errors.savedRefreshFailed')).not.toBeInTheDocument()
      expect(mocks.finalize).toHaveBeenCalledOnce()
      expect(vi.mocked(toast.warning).mock.calls).toEqual(
        incomplete ? [['errors.savedRefreshFailed']] : []
      )
    }
  )

  it('does not let an older account load replace a newer dialog context', async () => {
    let resolveFirst: (value: typeof history) => void
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    const secondAccount = { ...account, id: 'b', name: 'Savings' }
    const secondHistory = {
      ...history,
      account: { ...history.account, id: 'b', name: 'Savings' },
      transactions: [
        {
          ...staged,
          id: 'new-row',
          account_id: 'b',
          source_account_id: 'b',
          description: 'New row',
        },
      ],
    }
    mocks.read.mockResolvedValueOnce(secondHistory)
    const onOpenChange = vi.fn()
    const view = render(
      <AccountMaintenanceDialog account={account} open={true} onOpenChange={onOpenChange} />
    )
    view.rerender(
      <AccountMaintenanceDialog account={secondAccount} open={true} onOpenChange={onOpenChange} />
    )
    expect(await screen.findByText('New row')).toBeVisible()
    resolveFirst!(history)
    await waitFor(() => expect(screen.queryByText('Statement purchase')).not.toBeInTheDocument())
    expect(screen.getByText('New row')).toBeVisible()
  })
})
