import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

function ControlledDialog() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Example dialog</DialogTitle>
          <DialogDescription>Dialog used to verify focus restoration.</DialogDescription>
          <button>Dialog action</button>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ControlledSheet() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetTitle>Example sheet</SheetTitle>
          <SheetDescription>Sheet used to verify focus restoration.</SheetDescription>
          <button>Sheet action</button>
        </SheetContent>
      </Sheet>
    </>
  )
}

describe('overlay focus restoration', () => {
  it.each([
    ['dialog', ControlledDialog, 'Open dialog'],
    ['sheet', ControlledSheet, 'Open sheet'],
  ])(
    'restores a controlled %s to its actual opener after X and Escape',
    async (_, Overlay, label) => {
      const user = userEvent.setup()
      render(<Overlay />)

      const opener = screen.getByRole('button', { name: label })
      await user.click(opener)
      await user.click(screen.getByRole('button', { name: 'Close' }))

      await waitFor(() => expect(opener).toHaveFocus())

      await user.click(opener)
      await user.keyboard('{Escape}')

      await waitFor(() => expect(opener).toHaveFocus())
    }
  )

  it('preserves Radix trigger focus restoration', async () => {
    const user = userEvent.setup()
    render(
      <Sheet>
        <SheetTrigger>Native sheet trigger</SheetTrigger>
        <SheetContent>
          <SheetTitle>Triggered sheet</SheetTitle>
          <SheetDescription>A sheet with a Radix trigger.</SheetDescription>
        </SheetContent>
      </Sheet>
    )

    const trigger = screen.getByRole('button', { name: 'Native sheet trigger' })
    await user.click(trigger)
    await user.keyboard('{Escape}')

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('respects caller open and close autofocus overrides', async () => {
    const user = userEvent.setup()
    const onOpenAutoFocus = vi.fn((event: Event) => event.preventDefault())
    const onCloseAutoFocus = vi.fn((event: Event) => event.preventDefault())

    function OverriddenDialog() {
      const [open, setOpen] = useState(false)
      const initialFocusRef = useRef<HTMLButtonElement>(null)
      const closeFocusRef = useRef<HTMLButtonElement>(null)

      return (
        <>
          <button onClick={() => setOpen(true)}>Open overridden dialog</button>
          <button ref={closeFocusRef}>Caller close target</button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
              onOpenAutoFocus={(event) => {
                onOpenAutoFocus(event)
                initialFocusRef.current?.focus()
              }}
              onCloseAutoFocus={(event) => {
                onCloseAutoFocus(event)
                closeFocusRef.current?.focus()
              }}
            >
              <DialogTitle>Overridden dialog</DialogTitle>
              <DialogDescription>Autofocus is controlled by the caller.</DialogDescription>
              <button ref={initialFocusRef}>Caller open target</button>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    render(<OverriddenDialog />)
    await user.click(screen.getByRole('button', { name: 'Open overridden dialog' }))

    expect(onOpenAutoFocus).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Caller open target' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(onCloseAutoFocus).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Caller close target' })).toHaveFocus()
  })

  it('restores nested dialogs to their immediate parent, then restores the parent opener', async () => {
    const user = userEvent.setup()

    function NestedDialogs() {
      const [parentOpen, setParentOpen] = useState(false)
      const [childOpen, setChildOpen] = useState(false)

      return (
        <>
          <button onClick={() => setParentOpen(true)}>Open parent</button>
          <Dialog open={parentOpen} onOpenChange={setParentOpen}>
            <DialogContent>
              <DialogTitle>Parent dialog</DialogTitle>
              <DialogDescription>Parent for a nested confirmation.</DialogDescription>
              <button onClick={() => setChildOpen(true)}>Open child</button>
              <Dialog open={childOpen} onOpenChange={setChildOpen}>
                <DialogContent>
                  <DialogTitle>Child dialog</DialogTitle>
                  <DialogDescription>Nested confirmation.</DialogDescription>
                  <button
                    onClick={() => {
                      setChildOpen(false)
                      setParentOpen(false)
                    }}
                  >
                    Discard all
                  </button>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    render(<NestedDialogs />)
    const parentOpener = screen.getByRole('button', { name: 'Open parent' })

    await user.click(parentOpener)
    const childOpener = screen.getByRole('button', { name: 'Open child' })
    await user.click(childOpener)
    await user.keyboard('{Escape}')

    await waitFor(() => expect(childOpener).toHaveFocus())

    await user.click(childOpener)
    await user.click(screen.getByRole('button', { name: 'Discard all' }))

    await waitFor(() => expect(parentOpener).toHaveFocus())
  })

  it.each(['disabled', 'unmounted'] as const)(
    'does not restore focus to a %s opener',
    async (invalidState) => {
      const user = userEvent.setup()

      function InvalidOpenerDialog() {
        const [open, setOpen] = useState(false)
        const [openerMounted, setOpenerMounted] = useState(true)
        const openerRef = useRef<HTMLButtonElement>(null)

        return (
          <>
            {openerMounted ? (
              <button ref={openerRef} onClick={() => setOpen(true)}>
                Open invalid target dialog
              </button>
            ) : null}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Invalid target dialog</DialogTitle>
                <DialogDescription>The opener becomes unavailable.</DialogDescription>
                <button
                  onClick={() => {
                    if (invalidState === 'disabled' && openerRef.current) {
                      openerRef.current.disabled = true
                    } else {
                      setOpenerMounted(false)
                    }
                    setOpen(false)
                  }}
                >
                  Invalidate and close
                </button>
              </DialogContent>
            </Dialog>
          </>
        )
      }

      render(<InvalidOpenerDialog />)
      const opener = screen.getByRole('button', { name: 'Open invalid target dialog' })
      await user.click(opener)
      await user.click(screen.getByRole('button', { name: 'Invalidate and close' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(opener).not.toHaveFocus()
      expect(document.body).toHaveFocus()
    }
  )
})
