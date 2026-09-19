import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExportLegacyImportIdentityAction } from './legacy-import-identity-dialog'

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  preview: vi.fn(),
  bind: vi.fn(),
  invalidate: vi.fn(),
}))

vi.mock('@/lib/import-identity-service', () => ({
  readLegacyImportIdentityTransaction: mocks.read,
  previewLegacyImportIdentity: mocks.preview,
  bindLegacyImportIdentity: mocks.bind,
}))
vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: mocks.invalidate,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}))

const transaction = {
  id: 'legacy',
  account_id: 'account',
  category_id: null,
  subcategory_id: null,
  transfer_to_account_id: null,
  type: 'expense',
  amount: 1234,
  currency: 'MXN',
  description: 'Legacy purchase',
  notes: 'keep',
  date: '2025-01-02',
  status: 'posted',
  source: 'ledger source',
  note: 'ledger note',
  ledger_treatment: 'staged_no_balance_impact',
  reporting_treatment: 'normal',
  transaction_kind: 'standard',
  staging_batch_id: 'batch',
  finalization_id: null,
  reconciliation_id: null,
  matched_transaction_id: null,
  import_source: null,
  import_external_id: null,
  import_fingerprint: null,
  import_content_fingerprint: null,
  is_archived: 0,
  created_at: '2025-01-02T00:00:00Z',
  updated_at: '2025-01-02T00:00:00Z',
}

const preview = {
  previewToken: 'reviewed-token',
  transaction,
  binding: {
    transactionId: 'legacy',
    importSource: 'Bank Feed',
    importExternalId: '000AbC',
    importFingerprint: '{identity}',
    importContentFingerprint: null,
    originalContentVerified: false,
  },
  limitation: 'Original source content is unknown.',
}

async function openAndFill(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'identity.action' }))
  await screen.findByText('Legacy purchase')
  await user.type(screen.getByLabelText('identity.sourceNamespace'), '  Bank Feed  ')
  await user.type(screen.getByLabelText('identity.externalId'), '000AbC')
  await user.type(screen.getByLabelText('identity.auditSource'), 'operator')
  await user.type(screen.getByLabelText('identity.auditNote'), 'verified statement ID')
  await user.click(screen.getByRole('checkbox'))
}

describe('ExportLegacyImportIdentityAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.read.mockResolvedValue(transaction)
    mocks.preview.mockResolvedValue(preview)
    mocks.bind.mockResolvedValue({ ...preview, refreshIncomplete: false })
  })

  it('shows the current native-currency record and requires reviewed explicit identity', async () => {
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ExportLegacyImportIdentityAction transactionId="legacy" onChanged={onChanged} />)
    await openAndFill(user)

    expect(screen.getByText('MXN')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    expect(await screen.findByText('identity.unknownContent')).toBeVisible()
    await waitFor(() =>
      expect(mocks.preview).toHaveBeenCalledWith({
        transactionId: 'legacy',
        sourceNamespace: '  Bank Feed  ',
        externalId: '000AbC',
        source: 'operator',
        note: 'verified statement ID',
      })
    )
    expect(mocks.bind).not.toHaveBeenCalled()
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))
    await waitFor(() =>
      expect(mocks.bind).toHaveBeenCalledWith(
        expect.objectContaining({ previewToken: 'reviewed-token', externalId: '000AbC' })
      )
    )
    expect(mocks.invalidate).toHaveBeenCalledWith('import')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('revokes a reviewed token on input change and ignores an older preview response', async () => {
    let resolveFirst: (value: typeof preview) => void
    mocks.preview
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce({
        ...preview,
        previewToken: 'new-token',
        binding: { ...preview.binding, importExternalId: 'new-id' },
      })
    const user = userEvent.setup()
    render(<ExportLegacyImportIdentityAction transactionId="legacy" />)
    await openAndFill(user)
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.clear(screen.getByLabelText('identity.externalId'))
    await user.type(screen.getByLabelText('identity.externalId'), 'new-id')
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    expect(await screen.findByText('new-id')).toBeVisible()

    resolveFirst!(preview)
    await waitFor(() => expect(screen.queryByText('000AbC')).not.toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'identity.confirm' }))
    expect(mocks.bind).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'new-id', previewToken: 'new-token' })
    )
  })

  it('clears confirmation after a rejected apply and requires a new review', async () => {
    mocks.bind.mockRejectedValueOnce(new Error('stale reviewed token'))
    const user = userEvent.setup()
    render(<ExportLegacyImportIdentityAction transactionId="legacy" />)
    await openAndFill(user)
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))

    expect(await screen.findByText('stale reviewed token')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'identity.confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'identity.review' })).toBeEnabled()
  })

  it('continues post-commit invalidation and callback after closing during apply', async () => {
    let resolveApply: (value: typeof preview & { refreshIncomplete: boolean }) => void
    mocks.bind.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveApply = resolve
        })
    )
    const user = userEvent.setup()
    const onChanged = vi.fn()
    render(<ExportLegacyImportIdentityAction transactionId="legacy" onChanged={onChanged} />)
    await openAndFill(user)
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))
    await user.click(screen.getByRole('button', { name: 'cancel' }))

    resolveApply!({ ...preview, refreshIncomplete: false })
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledWith('import'))
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('identity.savedRefreshFailed')).not.toBeInTheDocument()
  })

  it('truthfully reports a committed save when store refresh rejects', async () => {
    mocks.bind.mockResolvedValueOnce({ ...preview, refreshIncomplete: true })
    const user = userEvent.setup()
    render(<ExportLegacyImportIdentityAction transactionId="legacy" />)
    await openAndFill(user)
    await user.click(screen.getByRole('button', { name: 'identity.review' }))
    await user.click(await screen.findByRole('button', { name: 'identity.confirm' }))

    expect(await screen.findByText('identity.savedRefreshFailed')).toBeVisible()
    expect(mocks.invalidate).toHaveBeenCalledWith('import')
    expect(screen.queryByRole('button', { name: 'identity.confirm' })).not.toBeInTheDocument()
  })
})
