import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from '../confirm-dialog'

describe('ConfirmDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    title: 'Delete item?',
    description: 'This action cannot be undone.',
    onConfirm: vi.fn(),
  }

  it('renders title and description when open', () => {
    render(<ConfirmDialog {...defaultProps} />)

    expect(screen.getByText('Delete item?')).toBeInTheDocument()
    expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument()
  })

  it('uses default labels "Confirm" and "Cancel"', () => {
    render(<ConfirmDialog {...defaultProps} />)

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders custom labels', () => {
    render(<ConfirmDialog {...defaultProps} confirmLabel="Yes, delete" cancelLabel="No, keep" />)

    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'No, keep' })).toBeInTheDocument()
  })

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup()
    render(<ConfirmDialog {...defaultProps} />)

    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(defaultProps.onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onOpenChange(false) when cancel button is clicked', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ConfirmDialog {...defaultProps} onOpenChange={onOpenChange} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('disables both buttons when isLoading', () => {
    render(<ConfirmDialog {...defaultProps} isLoading />)

    expect(screen.getByRole('button', { name: 'Confirm...' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('shows descriptive loading text on confirm button when isLoading', () => {
    render(<ConfirmDialog {...defaultProps} isLoading />)

    expect(screen.getByRole('button', { name: 'Confirm...' })).toBeInTheDocument()
  })
})
