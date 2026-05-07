import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TauriTitleBar } from '../tauri-title-bar'

const windowApiMock = vi.hoisted(() => ({
  close: vi.fn(() => Promise.resolve()),
  minimize: vi.fn(() => Promise.resolve()),
  startDragging: vi.fn(() => Promise.resolve()),
  toggleMaximize: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/runtime', () => ({
  isTauri: true,
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => windowApiMock,
}))

describe('TauriTitleBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a title-free draggable titlebar', async () => {
    render(<TauriTitleBar />)

    expect(screen.getByLabelText('Window title bar')).toBeInTheDocument()
    expect(screen.queryByText('Shikin')).not.toBeInTheDocument()

    fireEvent.mouseDown(screen.getByLabelText('Window title bar'), { button: 0 })

    await waitFor(() => expect(windowApiMock.startDragging).toHaveBeenCalledTimes(1))
  })

  it('wires minimize, maximize, and close controls to Tauri window commands', async () => {
    const user = userEvent.setup()
    render(<TauriTitleBar />)

    await user.click(screen.getByRole('button', { name: 'Minimize window' }))
    await user.click(screen.getByRole('button', { name: 'Maximize window' }))
    await user.click(screen.getByRole('button', { name: 'Close window' }))

    await waitFor(() => {
      expect(windowApiMock.minimize).toHaveBeenCalledTimes(1)
      expect(windowApiMock.toggleMaximize).toHaveBeenCalledTimes(1)
      expect(windowApiMock.close).toHaveBeenCalledTimes(1)
    })
  })
})
