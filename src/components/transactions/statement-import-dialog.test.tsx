import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatementImportDialog } from './statement-import-dialog'
import type { ImportReviewDecision } from '@shikin/finance-core/imports'

const {
  mockImportStatementFile,
  mockPreviewStatementFile,
  mockParseStatement,
  mockToastError,
  mockInvalidate,
  mockFormatMoney,
} = vi.hoisted(() => ({
  mockImportStatementFile: vi.fn(),
  mockPreviewStatementFile: vi.fn(),
  mockParseStatement: vi.fn(),
  mockToastError: vi.fn(),
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
    warning: vi.fn(),
    success: vi.fn(),
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
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue(content) })
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
    legacyEvidenceLimitations: [],
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
    mockInvalidate.mockClear()
    mockFormatMoney.mockClear()
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

    const previewButton = await screen.findByRole('button', { name: 'import.preview' })
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

  it('invalidates the page query after imported rows commit', async () => {
    const parsed = parsedTx({ description: 'Imported' })
    mockParseStatement.mockReturnValue([parsed])
    mockPreviewStatementFile.mockResolvedValue(previewResult({ parsedTransactions: [parsed] }))
    mockImportStatementFile.mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
    const file = createStatementFile('success.ofx')
    const { input, user } = await renderDialog()

    await chooseAccount(user)
    await chooseFile(input, file)
    await user.click(await screen.findByRole('button', { name: 'import.preview' }))
    await user.click(await screen.findByRole('button', { name: 'import.confirm' }))

    await waitFor(() => expect(mockInvalidate).toHaveBeenCalledWith('import'))
  })

  it('ignores a stale file parse after a newer file is selected', async () => {
    let resolveFirst: (value: string) => void
    const firstFile = new File(['first'], 'first.ofx', { type: 'application/xml' })
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
    mockImportStatementFile.mockResolvedValue({ imported: 1, skipped: 0, errors: [] })
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
    expect(screen.getByText('Legacy fingerprint only compared amount and date')).toBeVisible()
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
