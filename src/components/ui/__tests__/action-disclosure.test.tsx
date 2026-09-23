import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ActionDisclosure } from '../action-disclosure'

describe('ActionDisclosure', () => {
  it('uses native button semantics and closes on Escape with focus restored', async () => {
    const user = userEvent.setup()
    render(
      <ActionDisclosure
        label="More actions"
        actions={[{ label: 'Edit account', onSelect: vi.fn() }]}
      />
    )

    const trigger = screen.getByRole('button', { name: 'More actions' })
    await user.click(trigger)
    const action = screen.getByRole('button', { name: 'Edit account' })
    expect(action).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.tab()
    expect(action).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Edit account' })).not.toBeInTheDocument()
  })

  it('closes on outside interaction and focuses the persistent trigger before an action runs', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn(() =>
      expect(screen.getByRole('button', { name: 'More actions' })).toHaveFocus()
    )
    render(
      <div>
        <ActionDisclosure label="More actions" actions={[{ label: 'Archive account', onSelect }]} />
        <button type="button">Outside</button>
      </div>
    )

    const trigger = screen.getByRole('button', { name: 'More actions' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Archive account' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })
})
