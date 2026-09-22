import * as React from 'react'

type AutoFocusHandler = (event: Event) => void

interface OverlayFocusRestorationOptions {
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}

function getActiveFocusTarget() {
  const activeElement = document.activeElement

  if (
    !(activeElement instanceof HTMLElement) ||
    activeElement === document.body ||
    activeElement === document.documentElement
  ) {
    return null
  }

  return activeElement
}

function restoreFocus(target: HTMLElement | null) {
  if (
    !target?.isConnected ||
    target.matches(':disabled, [aria-disabled="true"]') ||
    target.closest('[inert], [hidden], [aria-hidden="true"]')
  ) {
    return false
  }

  target.focus({ preventScroll: true })
  return target.ownerDocument.activeElement === target
}

export function useOverlayFocusRestoration({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: OverlayFocusRestorationOptions) {
  const openerRef = React.useRef<HTMLElement | null>(null)

  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      // Radix fires this before moving focus into the overlay.
      openerRef.current = getActiveFocusTarget()
      onOpenAutoFocus?.(event)
    },
    [onOpenAutoFocus]
  )

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event)

      const opener = openerRef.current
      openerRef.current = null

      if (!event.defaultPrevented && restoreFocus(opener)) {
        // Skip Radix's trigger-only restoration after restoring the actual opener.
        event.preventDefault()
      }
    },
    [onCloseAutoFocus]
  )

  return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus }
}
