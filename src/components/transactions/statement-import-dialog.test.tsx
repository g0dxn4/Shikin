import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementImportDialog } from './statement-import-dialog'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'

const {
  mockImportStatementFile,
  mockPreviewStatementFile,
  mockParseStatement,
  mockToastError,
  mockToastWarning,
  mockToastSuccess,
  mockInvalidate,
  mockFormatMoney,
} = vi.hoisted(() => ({
  mockImportStatementFile: vi.fn(),
  mockPreviewStatementFile: vi.fn(),
  mockParseStatement: vi.fn(),
  mockToastError: vi.fn(),
  mockToastWarning: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockInvalidate: vi.fn(),
  mockFormatMoney: vi.fn(
    (centavos: number, currency: string) => `FORMATTED:${currency}:${centavos}`
  ),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key
      const extras = Object.entries(options)
        .filter(([name]) => name !== 'defaultValue')
        .map(([name, value]) => `${name}=${String(value)}`)
      return extras.length ? `${key} ${extras.join(' ')}` : key
    },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: mockToastError,
    warning: mockToastWarning,
    success: mockToastSuccess,
  },
}))

vi.mock('@/lib/statement-parser', () => ({
  parseStatement: mockParseStatement,
}))

vi.mock('@/lib/statement-import', () => ({
  importStatementFile: mockImportStatementFile,
  previewStatementFile: mockPreviewStatementFile,
}))

vi.mock('@/lib/transaction-query-events', () => ({
  invalidateTransactionPage: mockInvalidate,
}))

vi.mock('@/lib/money', () => ({
  toCentavos: (amount: number) => Math.round(amount * 100),
  formatMoney: mockFormatMoney,
}))

vi.mock('@/stores/account-store', () => ({
  useAccountStore: () => ({
    accounts: [
      {
        id: 'account-1',
        name: 'Checking',
        currency: 'USD',
        balance: 0,
        is_archived: 0,
      },
      {
        id: 'account-2',
        name: 'Euro Current',
        currency: 'EUR',
        balance: 0,
        is_archived: 0,
      },
    ],
    fetch: vi.fn(),
    fetchError: null,
  }),
}))

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode
    onOpenChange: (open: boolean) => void
  }) => (
    <div>
      {children}
      <button type="button" onClick={() => onOpenChange(false)}>
        Dismiss import dialog
      </button>
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/select', async () => {
  const React = await import('react')

  const SelectContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
  }>({
    value: '',
    onValueChange: () => {},
  })

  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode
      value: string
      onValueChange: (value: string) => void
    }) => (
      <SelectContext.Provider value={{ value, onValueChange }}>{children}</SelectContext.Provider>
    ),
    SelectTrigger: ({
      children,
      ...props
    }: {
      children: React.ReactNode
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button type="button" {...props}>
        {children}
      </button>
    ),
    SelectValue: ({ placeholder }: { placeholder: string }) => {
      const { value } = React.useContext(SelectContext)
      return <span>{value || placeholder}</span>
    },
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => {
      const { onValueChange } = React.useContext(SelectContext)
      return (
        <button type="button" onClick={() => onValueChange(value)}>
          {children}
        </button>
      )
    },
  }
})

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

function createStatementFile(name: string, content = 'statement') {
  const file = new File([content], name, { type: 'application/xml' })
  Object.defineProperty(file, 'text', {
    value: vi.fn().mockResolvedValue(content),
  })
  return file
}

function parsedTx(
  overrides: Partial<{
    date: string
    amount: number
    description: string
    type: 'income' | 'expense'
  }> = {}
) {
  return {
    date: '2026-07-14',
    amount: 12.5,
    description: 'Retry me',
    type: 'expense' as const,
    ...overrides,
  }
}

function requiredDecision(overrides: Partial<ImportReviewDecision> = {}): ImportReviewDecision {
  return {
    candidateIdentityKey: 'identity-1',
    candidateContentFingerprint: 'content-1',
    existingTransactionId: 'existing-1',
    existingEvidenceFingerprint: 'evidence-1',
    decision: 'distinct',
    ...overrides,
  }
}

function reviewCandidate(
  overrides: {
    candidateIdentityKey?: string
    existingTransactionId?: string
    incoming?: Partial<{
      rowIndex: number
      date: string
      description: string
      type: 'income' | 'expense'
      amountCentavos: number
      currency: string
    }>
    existing?: Partial<{
      id: string
      date: string
      description: string
      type: string
      amountCentavos: number
      currency: string
    }>
  } = {}
) {
  return {
    candidateIdentityKey: overrides.candidateIdentityKey ?? 'identity-1',
    existingTransactionId: overrides.existingTransactionId ?? 'existing-1',
    incoming: {
      rowIndex: 0,
      date: '2026-07-14',
      description: 'Incoming coffee',
      type: 'expense' as const,
      amountCentavos: 1250,
      currency: 'MXN',
      ...overrides.incoming,
    },
    existing: {
      id: 'existing-1',
      date: '2026-07-13',
      description: 'Ledger coffee',
      type: 'expense',
      amountCentavos: 1200,
      currency: 'MXN',
      ...overrides.existing,
    },
  }
}

function previewResult(overrides: Record<string, unknown> = {}) {
  const parsed = [parsedTx()]
  return {
    success: true,
    parsedTransactions: parsed,
    previewToken: 'preview-token',
    imported: 1,
    skipped: 0,
    errors: [],
    requiredDecisions: [],
    reviewCandidates: [],
    limitations: [],
    legacyEvidenceLimitations: [],
    treatment: 'posted',
    stagingBatchId: null,
    stagedCount: 0,
    pendingCount: 0,
    balanceImpactCentavos: -1250,
    accountCurrency: 'USD',
    ...overrides,
  }
}

async function renderDialog() {
  const user = userEvent.setup()
  const onOpenChange = vi.fn()
  const view = render(<StatementImportDialog open={true} onOpenChange={onOpenChange} />)
  const input = view.container.querySelector('input[type="file"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('Expected statement file input')
  return { ...view, input, onOpenChange, user }
}

async function chooseAccount(user: ReturnType<typeof userEvent.setup>, name = 'Checking') {
  await user.click(screen.getByRole('button', { name: new RegExp(`^${name}$`) }))
}

async function chooseFile(input: HTMLInputElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
  await screen.findByText(file.name)
}

describe('StatementImportDialog', () => {
  beforeEach(() => {
    mockImportStatementFile.mockReset()
    mockPreviewStatementFile.mockReset()
    mockParseStatement.mockReset()
    mockToastError.mockClear()
    mockToastWarning.mockClear()
    mockToastSuccess.mockClear()
    mockInvalidate.mockClear()
    mockFormatMoney.mockClear()
  })

  it('previews and applies staged posted history with a file-wide batch and zero balance impact', async () => {
    const parsed = parsedTx({ description: 'Historical row' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        parsedTransactions: [parsed],
        treatment: 'staged_posted',
        stagingBatchId: 'history-2026-07',
        stagedCount: 1,
        pendingCount: 0,
        balanceImpactCentavos: 0,
      })
    )
    mockImportStatementFile.mockResolvedValue({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    const file = createStatementFile('history.ofx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await user.click(screen.getByRole('button', { name: 'import.treatments.stagedPosted' }))
    await user.type(screen.getByRole('textbox', { name: 'import.stagingBatch' }), 'history-2026-07')
    await chooseFile(input, file)
    await user.click(await screen.findByRole('button', { name: 'import.preview' }))

    await waitFor(() =>
      expect(mockPreviewStatementFile).toHaveBeenCalledWith(file, 'account-1', [], {
        treatment: 'staged_posted',
        stagingBatchId: 'history-2026-07',
        acknowledgePending: false,
      })
    )
    expect(screen.getByText('import.plannedStaged count=1')).toBeVisible()
    expect(screen.getByText('import.plannedPending count=0')).toBeVisible()
    expect(screen.getByText('import.balanceImpact amount=FORMATTED:USD:0')).toBeVisible()
    expect(screen.getByText('import.resolvedBatch batch=history-2026-07')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1', {
        previewToken: 'preview-token',
        decisions: [],
        treatment: 'staged_posted',
        stagingBatchId: 'history-2026-07',
        acknowledgePending: false,
      })
    )
    expect(mockInvalidate).toHaveBeenCalledWith('import')
  })

  it('requires a deliberate pending acknowledgement and keeps service errors visible', async () => {
    mockParseStatement.mockReturnValue([parsedTx({ description: 'Pending hold' })])
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        success: false,
        previewToken: null,
        parsedTransactions: [],
        errors: ['Pending staging was rejected'],
        treatment: 'staged_pending',
        stagingBatchId: null,
        balanceImpactCentavos: 0,
      })
    )
    const file = createStatementFile('holds.qfx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await user.click(screen.getByRole('button', { name: 'import.treatments.stagedPending' }))
    await chooseFile(input, file)
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeDisabled()
    expect(mockPreviewStatementFile).not.toHaveBeenCalled()

    await user.click(screen.getByRole('checkbox'))
    const previewButton = screen.getByRole('button', { name: 'import.preview' })
    expect(previewButton).toBeEnabled()
    await user.click(previewButton)

    await waitFor(() =>
      expect(mockPreviewStatementFile).toHaveBeenCalledWith(file, 'account-1', [], {
        treatment: 'staged_pending',
        stagingBatchId: undefined,
        acknowledgePending: true,
      })
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Pending staging was rejected')
    expect(screen.getByText('holds.qfx')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
  })

  it('does not revive an in-flight staged preview after the batch changes', async () => {
    mockParseStatement.mockReturnValue([parsedTx({ description: 'Batch-bound row' })])
    let resolvePreview: (value: unknown) => void
    mockPreviewStatementFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePreview = resolve
        })
    )
    const file = createStatementFile('batch.ofx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await user.click(screen.getByRole('button', { name: 'import.treatments.stagedPosted' }))
    const batch = screen.getByRole('textbox', { name: 'import.stagingBatch' })
    await user.type(batch, 'first-batch')
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.clear(batch)
    await user.type(batch, 'second-batch')

    resolvePreview!(
      previewResult({
        treatment: 'staged_posted',
        stagingBatchId: 'first-batch',
        stagedCount: 1,
        balanceImpactCentavos: 0,
      })
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    )
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeEnabled()
    expect(screen.queryByText('import.resolvedBatch batch=first-batch')).not.toBeInTheDocument()
  })

  it('keeps file, account, and preview context after a resolved import failure', async () => {
    const parsed = parsedTx()
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(previewResult({ parsedTransactions: [parsed] }))
    mockImportStatementFile.mockResolvedValue({
      imported: 0,
      skipped: 0,
      errors: ['Account update affected 0 rows'],
    })
    const file = createStatementFile('retry.ofx')
    const { input, onOpenChange, user } = await renderDialog()

    await chooseAccount(user)
    await chooseFile(input, file)

    const previewButton = await screen.findByRole('button', {
      name: 'import.preview',
    })
    await waitFor(() => expect(previewButton).toBeEnabled())
    await user.click(previewButton)
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))

    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1', {
        previewToken: 'preview-token',
        decisions: [],
      })
    )
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByText('Retry me')).toBeVisible()
    expect(screen.getByText('Checking')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.confirm' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'import.cancel' }))
    expect(screen.getByText('retry.ofx')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeEnabled()
    expect(mockInvalidate).not.toHaveBeenCalled()
  })

  it.each([
    {
      changedInput: 'account',
      account: 'account-2',
      treatment: 'staged_pending',
      acknowledgePending: true,
    },
    {
      changedInput: 'treatment',
      account: 'account-1',
      treatment: 'staged_posted',
      acknowledgePending: false,
    },
    {
      changedInput: 'pending acknowledgement',
      account: 'account-1',
      treatment: 'staged_pending',
      acknowledgePending: true,
    },
  ])(
    'ignores an in-flight preview after changing only $changedInput',
    async ({ changedInput, account, treatment, acknowledgePending }) => {
      mockParseStatement.mockReturnValue([parsedTx({ description: 'Bound pending row' })])
      let resolvePreview!: (value: unknown) => void
      mockPreviewStatementFile.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePreview = resolve
          })
      )
      mockPreviewStatementFile.mockResolvedValue(
        previewResult({
          previewToken: 'fresh-binding',
          parsedTransactions: [parsedTx({ description: 'Fresh bound row' })],
        })
      )
      mockImportStatementFile.mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
      const file = createStatementFile('bound.qfx')
      const { input, user } = await renderDialog()
      await chooseAccount(user)
      await user.click(screen.getByRole('button', { name: 'import.treatments.stagedPending' }))
      await user.click(screen.getByRole('checkbox'))
      await chooseFile(input, file)
      await user.click(screen.getByRole('button', { name: 'import.preview' }))
      expect(mockPreviewStatementFile).toHaveBeenNthCalledWith(1, file, 'account-1', [], {
        treatment: 'staged_pending',
        stagingBatchId: undefined,
        acknowledgePending: true,
      })

      if (changedInput === 'account') await chooseAccount(user, 'Euro Current')
      if (changedInput === 'treatment') {
        await user.click(screen.getByRole('button', { name: 'import.treatments.stagedPosted' }))
      }
      if (changedInput === 'pending acknowledgement') {
        await user.click(screen.getByRole('checkbox'))
      }
      await act(async () => {
        resolvePreview(
          previewResult({
            previewToken: 'obsolete-binding',
            parsedTransactions: [parsedTx({ description: 'Obsolete bound row' })],
          })
        )
      })

      expect(screen.queryByText('Obsolete bound row')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
      expect(screen.getByText('bound.qfx')).toBeVisible()
      if (changedInput === 'pending acknowledgement') {
        expect(screen.getByRole('button', { name: 'import.preview' })).toBeDisabled()
        expect(screen.getByRole('checkbox')).not.toBeChecked()
        await user.click(screen.getByRole('checkbox'))
      }
      await user.click(screen.getByRole('button', { name: 'import.preview' }))
      expect(await screen.findByText('Fresh bound row')).toBeVisible()
      expect(mockPreviewStatementFile).toHaveBeenNthCalledWith(2, file, account, [], {
        treatment,
        stagingBatchId: undefined,
        acknowledgePending,
      })
      await user.click(screen.getByRole('button', { name: 'import.confirm' }))
      expect(mockImportStatementFile).toHaveBeenCalledWith(file, account, {
        previewToken: 'fresh-binding',
        decisions: [],
        treatment,
        stagingBatchId: undefined,
        acknowledgePending,
      })
    }
  )

  it('ignores an old file read after close and reopen with the same file', async () => {
    let resolveOldRead!: (content: string) => void
    const file = createStatementFile('reopened.ofx')
    vi.mocked(file.text)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldRead = resolve
          })
      )
      .mockResolvedValueOnce('reopened content')
    mockParseStatement.mockReturnValue([parsedTx(), parsedTx({ description: 'Second row' })])
    const { input, user, rerender, onOpenChange, container } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.cancel' }))
    rerender(<StatementImportDialog open={false} onOpenChange={onOpenChange} />)
    rerender(<StatementImportDialog open={true} onOpenChange={onOpenChange} />)
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeDisabled()
    expect(screen.queryByText('reopened.ofx')).not.toBeInTheDocument()
    await chooseAccount(user)
    const reopenedInput = container.querySelector<HTMLInputElement>('input[type="file"]')!
    await chooseFile(reopenedInput, file)
    expect(await screen.findByText('import.previewCount count=2')).toBeVisible()

    await act(async () => resolveOldRead('obsolete content'))

    expect(mockParseStatement.mock.calls).toEqual([['reopened content', 'reopened.ofx']])
    expect(screen.getByText('reopened.ofx')).toBeVisible()
    expect(screen.getByText('import.previewCount count=2')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeEnabled()
    expect(onOpenChange.mock.calls).toEqual([[false]])
  })

  it('keeps the reopened preview pending when the previous session preview settles', async () => {
    mockParseStatement.mockReturnValue([parsedTx()])
    let resolveOldPreview!: (value: unknown) => void
    let resolveNewPreview!: (value: unknown) => void
    mockPreviewStatementFile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldPreview = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewPreview = resolve
          })
      )
    const file = createStatementFile('reopened-preview.ofx')
    const { input, user, rerender, onOpenChange, container } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss import dialog' }))
    rerender(<StatementImportDialog open={false} onOpenChange={onOpenChange} />)
    rerender(<StatementImportDialog open={true} onOpenChange={onOpenChange} />)
    await chooseAccount(user)
    await chooseFile(container.querySelector<HTMLInputElement>('input[type="file"]')!, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))

    await act(async () => {
      resolveOldPreview(
        previewResult({ parsedTransactions: [parsedTx({ description: 'Obsolete session row' })] })
      )
    })
    expect(screen.queryByText('Obsolete session row')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeDisabled()
    await act(async () => {
      resolveNewPreview(
        previewResult({
          previewToken: 'reopened-token',
          parsedTransactions: [parsedTx({ description: 'Reopened preview row' })],
        })
      )
    })
    expect(screen.getByText('Reopened preview row')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.confirm' })).toBeEnabled()
    expect(mockPreviewStatementFile.mock.calls).toEqual([
      [file, 'account-1', []],
      [file, 'account-1', []],
    ])
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onOpenChange.mock.calls).toEqual([[false]])
  })

  it('invalidates an old committed import without disturbing a reopened import or emitting its toast', async () => {
    mockParseStatement.mockReturnValue([parsedTx()])
    mockPreviewStatementFile
      .mockResolvedValueOnce(previewResult({ previewToken: 'old-token' }))
      .mockResolvedValueOnce(previewResult({ previewToken: 'reopened-token' }))
    let resolveOldImport!: (value: unknown) => void
    let resolveNewImport!: (value: unknown) => void
    mockImportStatementFile
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOldImport = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveNewImport = resolve
          })
      )
    const file = createStatementFile('reopened-import.ofx')
    const { input, user, rerender, onOpenChange, container } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    await user.click(screen.getByRole('button', { name: 'Dismiss import dialog' }))
    rerender(<StatementImportDialog open={false} onOpenChange={onOpenChange} />)
    rerender(<StatementImportDialog open={true} onOpenChange={onOpenChange} />)
    await chooseAccount(user)
    await chooseFile(container.querySelector<HTMLInputElement>('input[type="file"]')!, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))

    await act(async () => {
      resolveOldImport({ imported: 2, skipped: 0, errors: ['Late committed warning'] })
    })
    expect(mockInvalidate.mock.calls).toEqual([['import']])
    expect(screen.getByText('import.importing')).toBeVisible()
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onOpenChange.mock.calls).toEqual([[false]])
    expect(mockImportStatementFile.mock.calls).toEqual([
      [file, 'account-1', { previewToken: 'old-token', decisions: [] }],
      [file, 'account-1', { previewToken: 'reopened-token', decisions: [] }],
    ])

    await act(async () => {
      resolveNewImport({ imported: 1, skipped: 1, errors: [] })
    })
    expect(mockInvalidate.mock.calls).toEqual([['import'], ['import']])
    expect(mockToastSuccess.mock.calls).toEqual([['import.success imported=1 skipped=1']])
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onOpenChange.mock.calls).toEqual([[false], [false]])
    expect(mockInvalidate.mock.invocationCallOrder[1]).toBeLessThan(
      mockToastSuccess.mock.invocationCallOrder[0]
    )
    expect(mockToastSuccess.mock.invocationCallOrder[0]).toBeLessThan(
      onOpenChange.mock.invocationCallOrder[1]
    )
  })

  it('invalidates the page query after imported rows commit', async () => {
    const parsed = parsedTx({ description: 'Imported' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(previewResult({ parsedTransactions: [parsed] }))
    mockImportStatementFile.mockResolvedValue({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    const file = createStatementFile('success.ofx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(await screen.findByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledWith('import'))
  })

  it('invalidates committed imports even if the dialog closes before the request settles', async () => {
    const parsed = parsedTx({ description: 'Committed' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(previewResult({ parsedTransactions: [parsed] }))
    let resolveImport: (value: { imported: number; skipped: number; errors: string[] }) => void
    mockImportStatementFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve
        })
    )
    const file = createStatementFile('close-before-commit.ofx')
    const { input, user, rerender, onOpenChange } = await renderDialog()

    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(await screen.findByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    expect(await screen.findByText('import.importing')).toBeVisible()

    rerender(<StatementImportDialog open={false} onOpenChange={onOpenChange} />)
    resolveImport!({ imported: 2, skipped: 0, errors: [] })

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledWith('import'))
    expect(mockToastSuccess).not.toHaveBeenCalled()
    expect(mockToastWarning).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('ignores a stale file parse after a newer file is selected', async () => {
    let resolveFirst: (value: string) => void
    const firstFile = new File(['first'], 'first.ofx', {
      type: 'application/xml',
    })
    Object.defineProperty(firstFile, 'text', {
      value: () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve
        }),
    })
    const secondFile = createStatementFile('second.ofx', 'second')
    mockParseStatement.mockImplementation((content: string) =>
      content === 'second'
        ? [parsedTx(), parsedTx({ description: 'Second extra' })]
        : [parsedTx({ description: 'From first file' })]
    )
    const { input } = await renderDialog()

    fireEvent.change(input, { target: { files: [firstFile] } })
    fireEvent.change(input, { target: { files: [secondFile] } })
    expect(await screen.findByText('import.previewCount count=2')).toBeVisible()

    resolveFirst!('first')
    await waitFor(() => {
      expect(screen.getByText('second.ofx')).toBeVisible()
      expect(screen.getByText('import.previewCount count=2')).toBeVisible()
    })
    expect(screen.queryByText('import.previewCount count=1')).not.toBeInTheDocument()
  })

  it('ignores a stale preview after the account or file selection changes', async () => {
    let resolveFirst: (value: unknown) => void
    const firstFile = createStatementFile('alpha.ofx', 'alpha')
    const secondFile = createStatementFile('beta.ofx', 'beta')
    mockParseStatement.mockImplementation((content: string) => [
      parsedTx({ description: content === 'beta' ? 'Beta row' : 'Alpha row' }),
    ])
    mockPreviewStatementFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve
        })
    )
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        parsedTransactions: [parsedTx({ description: 'Beta preview' })],
        previewToken: 'beta-token',
        imported: 3,
        skipped: 1,
      })
    )
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, firstFile)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))

    await chooseFile(input, secondFile)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await screen.findByText('Beta preview')

    resolveFirst!(
      previewResult({
        parsedTransactions: [parsedTx({ description: 'Stale preview' })],
        previewToken: 'stale-token',
        imported: 9,
        skipped: 9,
      })
    )

    await waitFor(() => {
      expect(screen.queryByText('Stale preview')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Beta preview')).toBeVisible()
    expect(screen.getByText(/import\.plannedImported count=3/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(
        secondFile,
        'account-1',
        expect.objectContaining({ previewToken: 'beta-token' })
      )
    )
  })

  it('resets the preview token when the account selection changes', async () => {
    mockParseStatement.mockReturnValue([parsedTx()])
    mockPreviewStatementFile.mockResolvedValue(previewResult())
    const file = createStatementFile('token.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    expect(await screen.findByRole('button', { name: 'import.confirm' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'import.cancel' }))
    await chooseAccount(user, 'Euro Current')
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()

    mockPreviewStatementFile.mockResolvedValue(previewResult({ previewToken: 'euro-token' }))
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(
        file,
        'account-2',
        expect.objectContaining({ previewToken: 'euro-token' })
      )
    )
  })

  it('does not bind an in-flight reviewed preview after a decision change', async () => {
    const decision = requiredDecision()
    const parsed = parsedTx({ description: 'Needs review' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValueOnce(
      previewResult({
        success: false,
        previewToken: null,
        parsedTransactions: [parsed],
        requiredDecisions: [decision],
        reviewCandidates: [reviewCandidate()],
        imported: 0,
        skipped: 0,
      })
    )
    let resolveReviewed: (value: unknown) => void
    mockPreviewStatementFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReviewed = resolve
        })
    )
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        parsedTransactions: [parsed],
        previewToken: 'fresh-reviewed-token',
        imported: 1,
        skipped: 0,
      })
    )
    mockImportStatementFile.mockResolvedValue({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    const file = createStatementFile('review.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await screen.findByText('Incoming coffee')

    await user.click(screen.getByRole('button', { name: 'import.keepExisting' }))
    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))
    await user.click(screen.getByRole('button', { name: 'import.importDistinct' }))

    resolveReviewed!(
      previewResult({
        parsedTransactions: [parsed],
        previewToken: 'stale-reviewed-token',
        imported: 1,
        skipped: 0,
      })
    )
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'import.reviewDecisions' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1', {
        previewToken: 'fresh-reviewed-token',
        decisions: [
          {
            candidateIdentityKey: 'identity-1',
            candidateContentFingerprint: 'content-1',
            existingTransactionId: 'existing-1',
            existingEvidenceFingerprint: 'evidence-1',
            decision: 'distinct',
          },
        ],
      })
    )
  })

  it('requires a refreshed reviewed preview after a stale apply failure', async () => {
    const decision = requiredDecision()
    const parsed = parsedTx({ description: 'Reviewed row' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          parsedTransactions: [parsed],
          requiredDecisions: [decision],
          reviewCandidates: [reviewCandidate()],
          imported: 0,
          skipped: 0,
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          parsedTransactions: [parsed],
          previewToken: 'reviewed-token',
          imported: 1,
          skipped: 0,
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          parsedTransactions: [parsed],
          previewToken: 'refreshed-token',
          imported: 1,
          skipped: 0,
        })
      )
    mockImportStatementFile
      .mockResolvedValueOnce({
        imported: 0,
        skipped: 0,
        errors: ['Statement preview is stale or does not match this file'],
      })
      .mockResolvedValueOnce({ imported: 1, skipped: 0, errors: [] })
    const file = createStatementFile('stale-apply.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.keepExisting' }))
    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('import.stalePreview')
    expect(screen.getByText('stale-apply.ofx')).toBeVisible()
    expect(screen.getByText('Checking')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1', {
      previewToken: 'reviewed-token',
      decisions: [
        {
          candidateIdentityKey: 'identity-1',
          candidateContentFingerprint: 'content-1',
          existingTransactionId: 'existing-1',
          existingEvidenceFingerprint: 'evidence-1',
          decision: 'keep_existing',
        },
      ],
    })

    await user.click(screen.getByRole('button', { name: 'import.refreshPreview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenLastCalledWith(file, 'account-1', {
        previewToken: 'refreshed-token',
        decisions: [
          {
            candidateIdentityKey: 'identity-1',
            candidateContentFingerprint: 'content-1',
            existingTransactionId: 'existing-1',
            existingEvidenceFingerprint: 'evidence-1',
            decision: 'keep_existing',
          },
        ],
      })
    )
    expect(mockInvalidate).toHaveBeenCalledWith('import')
  })

  it('clears stale reviewed decisions so refresh can bind a fresh preview', async () => {
    const parsed = parsedTx({ description: 'Needs recovery' })
    const staleDecision = requiredDecision()
    const freshDecision = requiredDecision({
      candidateContentFingerprint: 'content-2',
      existingEvidenceFingerprint: 'evidence-2',
    })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          parsedTransactions: [parsed],
          requiredDecisions: [staleDecision],
          reviewCandidates: [reviewCandidate()],
          imported: 0,
          skipped: 0,
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          parsedTransactions: [parsed],
          errors: [
            'One or more duplicate decisions are stale or do not belong to this statement plan',
          ],
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          parsedTransactions: [parsed],
          requiredDecisions: [freshDecision],
          reviewCandidates: [
            reviewCandidate({
              existing: { description: 'Updated ledger coffee' },
            }),
          ],
          imported: 0,
          skipped: 0,
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          parsedTransactions: [parsed],
          previewToken: 'recovered-token',
          imported: 1,
          skipped: 0,
        })
      )
    mockImportStatementFile.mockResolvedValue({
      imported: 1,
      skipped: 0,
      errors: [],
    })
    const file = createStatementFile('stale-decisions.ofx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await screen.findByText('Incoming coffee')
    await user.click(screen.getByRole('button', { name: 'import.keepExisting' }))
    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/duplicate decisions are stale/i)
    expect(screen.getByText('stale-decisions.ofx')).toBeVisible()
    expect(screen.getByText('Checking')).toBeVisible()
    expect(screen.getByText('Needs recovery')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'import.keepExisting' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    expect(mockPreviewStatementFile).toHaveBeenLastCalledWith(file, 'account-1', [
      {
        candidateIdentityKey: 'identity-1',
        candidateContentFingerprint: 'content-1',
        existingTransactionId: 'existing-1',
        existingEvidenceFingerprint: 'evidence-1',
        decision: 'keep_existing',
      },
    ])

    await user.click(screen.getByRole('button', { name: 'import.refreshPreview' }))
    await waitFor(() =>
      expect(mockPreviewStatementFile).toHaveBeenLastCalledWith(file, 'account-1', [])
    )
    expect(await screen.findByText('Updated ledger coffee')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.reviewDecisions' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'import.importDistinct' }))
    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))
    await waitFor(() =>
      expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1', {
        previewToken: 'recovered-token',
        decisions: [
          {
            candidateIdentityKey: 'identity-1',
            candidateContentFingerprint: 'content-2',
            existingTransactionId: 'existing-1',
            existingEvidenceFingerprint: 'evidence-2',
            decision: 'distinct',
          },
        ],
      })
    )
    expect(mockInvalidate).toHaveBeenCalledWith('import')
  })

  it('shows a visible preview failure without dropping file or account context', async () => {
    const parsed = parsedTx({ description: 'Keep me' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          parsedTransactions: [parsed],
          requiredDecisions: [requiredDecision()],
          reviewCandidates: [reviewCandidate()],
          imported: 0,
          skipped: 0,
        })
      )
      .mockResolvedValueOnce(
        previewResult({
          success: false,
          previewToken: null,
          errors: ['Preview exploded'],
        })
      )
    const file = createStatementFile('visible-fail.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.keepExisting' }))
    await user.click(screen.getByRole('button', { name: 'import.reviewDecisions' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Preview exploded')
    expect(screen.getByText('visible-fail.ofx')).toBeVisible()
    expect(screen.getByText('Checking')).toBeVisible()
    expect(screen.getByText('Keep me')).toBeVisible()
    expect(screen.getByText('Incoming coffee')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    expect(mockImportStatementFile).not.toHaveBeenCalled()
  })

  it('shows candidate pair details, planned counts, and source limitations', async () => {
    const parsed = parsedTx({ description: 'Statement coffee' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        success: false,
        previewToken: null,
        parsedTransactions: [parsed],
        imported: 2,
        skipped: 1,
        requiredDecisions: [requiredDecision()],
        reviewCandidates: [reviewCandidate()],
        limitations: [
          'Statement source did not declare a currency; amounts are assumed to be USD.',
          'Legacy fingerprint only compared amount and date',
        ],
        legacyEvidenceLimitations: ['Legacy fingerprint only compared amount and date'],
      })
    )
    const file = createStatementFile('pairs.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))

    expect(await screen.findByText('Incoming coffee')).toBeVisible()
    expect(screen.getByText('Ledger coffee')).toBeVisible()
    expect(screen.getByText('import.rowIndex number=1')).toBeVisible()
    expect(screen.getByText(/FORMATTED:MXN:1250/)).toBeVisible()
    expect(screen.getByText(/FORMATTED:MXN:1200/)).toBeVisible()
    expect(screen.getByText(/import\.plannedImported count=2/)).toBeVisible()
    expect(screen.getByText(/import\.plannedSkipped count=1/)).toBeVisible()
    expect(
      screen.getByText(
        'Statement source did not declare a currency; amounts are assumed to be USD.'
      )
    ).toBeVisible()
    expect(screen.getAllByText('Legacy fingerprint only compared amount and date')).toHaveLength(1)
    expect(screen.queryByText('import.existingCandidate id=existing-1')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import.reviewDecisions' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
  })

  it('does not ask for an opaque decision when match details are unavailable', async () => {
    mockParseStatement.mockReturnValue([parsedTx()])
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        success: false,
        previewToken: null,
        requiredDecisions: [requiredDecision()],
        reviewCandidates: [],
      })
    )
    const file = createStatementFile('opaque.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('import.missingCandidateDetails')
    expect(screen.queryByRole('button', { name: 'import.keepExisting' })).not.toBeInTheDocument()
    expect(screen.queryByText('import.existingCandidate id=existing-1')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'import.confirm' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'import.refreshPreview' })).toBeEnabled()
  })

  it('formats raw preview amounts in the selected account currency', async () => {
    mockParseStatement.mockReturnValue([parsedTx({ amount: 12.5, description: 'Euro grocery' })])
    mockPreviewStatementFile.mockResolvedValue(
      previewResult({
        parsedTransactions: [parsedTx({ amount: 12.5, description: 'Euro grocery' })],
      })
    )
    const file = createStatementFile('euro.ofx')
    const { input, user } = await renderDialog()
    await chooseAccount(user, 'Euro Current')
    await chooseFile(input, file)
    await user.click(screen.getByRole('button', { name: 'import.preview' }))

    expect(await screen.findByText('Euro grocery')).toBeVisible()
    expect(screen.getByText(/FORMATTED:EUR:1250/)).toBeVisible()
    expect(screen.queryByText('$12.50')).not.toBeInTheDocument()
    expect(mockFormatMoney).toHaveBeenCalledWith(1250, 'EUR')
  })
})
