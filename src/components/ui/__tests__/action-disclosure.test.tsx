import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionDisclosure } from '../action-disclosure'

describe('ActionDisclosure', () => {
  afterEach(() => vi.restoreAllMocks())

  function mockGeometry(geometry: {
    triggerTop: number
    panelHeight: number
    navTop?: number
    mainTop?: number
  }) {
    vi.stubGlobal('innerHeight', 640)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.classList.contains('native-bottom-nav'))
        return DOMRect.fromRect({ y: geometry.navTop, height: 640 - (geometry.navTop ?? 640) })
      if (this.tagName === 'MAIN')
        return DOMRect.fromRect({ y: geometry.mainTop ?? 0, height: 640 - (geometry.mainTop ?? 0) })
      if (this.getAttribute('aria-controls'))
        return DOMRect.fromRect({ y: geometry.triggerTop, height: 44 })
      if (
        this.id &&
        this.id === this.parentElement?.querySelector('button')?.getAttribute('aria-controls')
      )
        return DOMRect.fromRect({ y: geometry.triggerTop + 44, height: geometry.panelHeight })
      if (this.querySelector('button[aria-controls]'))
        return DOMRect.fromRect({ y: geometry.triggerTop, height: 44 })
      return DOMRect.fromRect({})
    })
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (
      this: HTMLElement
    ) {
      return this.id &&
        this.id === this.parentElement?.querySelector('button')?.getAttribute('aria-controls')
        ? geometry.panelHeight
        : 0
    })
    return geometry
  }

  afterEach(() => vi.unstubAllGlobals())

  it('flips above a visible mobile nav, keeping the account trigger and tab focus usable', async () => {
    mockGeometry({ triggerTop: 419, panelHeight: 182, navTop: 576 })
    const user = userEvent.setup()
    render(
      <main>
        <ActionDisclosure
          label="Account actions"
          trigger={<span>Open</span>}
          actions={[
            { label: 'Edit account', onSelect: vi.fn() },
            { label: 'Archive account', onSelect: vi.fn() },
          ]}
        />
        <nav className="native-bottom-nav" style={{ display: 'block' }} />
      </main>
    )
    const opener = screen.getByRole('button', { name: 'Account actions' })
    await user.click(opener)
    const action = screen.getByRole('button', { name: 'Edit account' })
    expect(action.parentElement).toHaveStyle({ top: '-186px', maxHeight: '411px' })
    await user.tab()
    expect(action).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    expect(opener).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens below when it fits and ignores a hidden bottom nav', async () => {
    mockGeometry({ triggerTop: 170, panelHeight: 180, navTop: 300 })
    const user = userEvent.setup()
    render(
      <main>
        <ActionDisclosure label="More" actions={[{ label: 'Import', onSelect: vi.fn() }]} />
        <nav className="native-bottom-nav" style={{ display: 'none' }} />
      </main>
    )
    await user.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('button', { name: 'Import' }).parentElement).toHaveStyle({
      top: '48px',
      maxHeight: '418px',
    })
  })

  it('clamps a tall panel to the larger available side and recalculates on scroll and resize', async () => {
    const geometry = mockGeometry({ triggerTop: 300, panelHeight: 480, navTop: 576, mainTop: 58 })
    const user = userEvent.setup()
    render(
      <main>
        <ActionDisclosure label="More" actions={[{ label: 'Edit', onSelect: vi.fn() }]} />
        <nav className="native-bottom-nav" style={{ display: 'block' }} />
      </main>
    )
    await user.click(screen.getByRole('button', { name: 'More' }))
    const panel = screen.getByRole('button', { name: 'Edit' }).parentElement
    expect(panel).toHaveStyle({ top: '-238px', maxHeight: '234px' })
    expect(panel).toHaveClass('overflow-y-auto')

    // A scroll moves the trigger toward the top; below now has more room.
    geometry.triggerTop = 80
    act(() => window.dispatchEvent(new Event('scroll')))
    expect(panel).toHaveStyle({ top: '48px', maxHeight: '444px' })
    geometry.navTop = 520
    act(() => window.dispatchEvent(new Event('resize')))
    expect(panel).toHaveStyle({ top: '48px', maxHeight: '388px' })
  })

  it('keeps a long clamped disclosure keyboard reachable through its final action', async () => {
    mockGeometry({ triggerTop: 300, panelHeight: 550, navTop: 576, mainTop: 58 })
    const user = userEvent.setup()
    render(
      <main>
        <ActionDisclosure
          label="Account actions"
          actions={Array.from({ length: 10 }, (_, i) => ({
            label: `Action ${i + 1}`,
            onSelect: vi.fn(),
          }))}
        />
        <nav className="native-bottom-nav" style={{ display: 'block' }} />
      </main>
    )
    const opener = screen.getByRole('button', { name: 'Account actions' })
    await user.click(opener)
    const last = screen.getByRole('button', { name: 'Action 10' })
    expect(last.parentElement).toHaveClass('overflow-y-auto')
    expect(last.parentElement).toHaveStyle({ maxHeight: '234px' })
    for (let i = 0; i < 10; i++) await user.tab()
    expect(last).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
  })

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

  it('renders optional trigger content while keeping native disclosure behavior', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ActionDisclosure
        label="More actions"
        trigger={<span data-testid="custom-trigger">Open</span>}
        actions={[{ label: 'Edit account', onSelect }]}
      />
    )

    const trigger = screen.getByRole('button', { name: 'More actions' })
    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument()
    expect(trigger.querySelector('svg')).not.toBeInTheDocument()

    await user.click(trigger)
    const action = screen.getByRole('button', { name: 'Edit account' })
    expect(action).toBeVisible()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Edit account' })).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Edit account' }))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(trigger).toHaveFocus()
  })
})
