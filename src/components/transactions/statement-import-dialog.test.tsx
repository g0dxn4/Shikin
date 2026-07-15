import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StatementImportDialog } from './statement-import-dialog'

const { mockImportStatementFile, mockParseStatement, mockToastError } = vi.hoisted(() => ({
  mockImportStatementFile: vi.fn(),
  mockParseStatement: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
  return {
    Select: ({
      children,
      value,
      onValueChange,
    }: {
      children: React.ReactNode
      value: string
      onValueChange: (value: string) => void
    }) => {
      React.useEffect(() => {
        if (!value) onValueChange('account-1')
      }, [onValueChange, value])
      return <div>{children}</div>
    },
    SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectValue: ({ placeholder }: { placeholder: string }) => <span>{placeholder}</span>,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  }
})

vi.mock('@/components/ui/scroll-area', () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('StatementImportDialog', () => {
  it('keeps file, account, and preview context after a resolved import failure', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    const parsed = {
      date: '2026-07-14',
      amount: 12.5,
      description: 'Retry me',
      type: 'expense' as const,
    }
    mockParseStatement.mockReturnValue([parsed])
    mockImportStatementFile.mockResolvedValue({
      imported: 0,
      skipped: 0,
      errors: ['Account update affected 0 rows'],
    })
    const file = new File(['statement'], 'retry.ofx', { type: 'application/xml' })
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('statement') })

    const { container } = render(<StatementImportDialog open={true} onOpenChange={onOpenChange} />)
    const input = container.querySelector('input[type="file"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected statement file input')
    fireEvent.change(input, { target: { files: [file] } })

    const previewButton = await screen.findByRole('button', { name: 'import.preview' })
    await waitFor(() => expect(previewButton).toBeEnabled())
    await user.click(previewButton)
    await user.click(screen.getByRole('button', { name: 'import.confirm' }))

    await waitFor(() => expect(mockImportStatementFile).toHaveBeenCalledWith(file, 'account-1'))
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByText('Retry me')).toBeVisible()
    expect(screen.getByText('Checking')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.confirm' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'import.cancel' }))
    expect(screen.getByText('retry.ofx')).toBeVisible()
    expect(screen.getByRole('button', { name: 'import.preview' })).toBeEnabled()
  })
})
