import * as React from 'react'

type AutoFocusHandler = (event: Event) => void
type OpenChangeHandler = (open: boolean) => void

interface OverlayFocusRestorationOptions {
  onOpenAutoFocus?: AutoFocusHandler
  onCloseAutoFocus?: AutoFocusHandler
}

interface OverlayFocusStore {
  capture: () => void
  captureIfEmpty: () => void
  take: () => HTMLElement | null
}

interface OverlayFocusProviderProps {
  children: React.ReactNode
  focusStore: OverlayFocusStore
  open?: boolean
}

const OverlayFocusContext = React.createContext<OverlayFocusStore | null>(null)

function getActiveFocusTarget() {
  if (typeof document === 'undefined') return null

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

function createOverlayFocusStore(): OverlayFocusStore {
  let opener: HTMLElement | null = null

  return {
    capture: () => {
      opener = getActiveFocusTarget()
    },
    captureIfEmpty: () => {
      if (!opener) opener = getActiveFocusTarget()
    },
    take: () => {
      const target = opener
      opener = null
      return target
    },
  }
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

export class OverlayFocusRestorationProvider extends React.Component<OverlayFocusProviderProps> {
  constructor(props: OverlayFocusProviderProps) {
    super(props)
    if (props.open === true) props.focusStore.capture()
  }

  getSnapshotBeforeUpdate(previousProps: OverlayFocusProviderProps) {
    // The before-mutation phase runs before a descendant's autoFocus commit.
    if (previousProps.open === false && this.props.open === true) {
      this.props.focusStore.capture()
    }

    return null
  }

  componentDidUpdate() {}

  render() {
    return React.createElement(
      OverlayFocusContext.Provider,
      { value: this.props.focusStore },
      this.props.children
    )
  }
}

export function useOverlayRootFocusRestoration(onOpenChange?: OpenChangeHandler) {
  const [focusStore] = React.useState(createOverlayFocusStore)

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) focusStore.capture()
      onOpenChange?.(open)
    },
    [focusStore, onOpenChange]
  )

  return { focusStore, onOpenChange: handleOpenChange }
}

export function useOverlayFocusRestoration({
  onOpenAutoFocus,
  onCloseAutoFocus,
}: OverlayFocusRestorationOptions) {
  const rootFocusStore = React.useContext(OverlayFocusContext)
  const [fallbackFocusStore] = React.useState(createOverlayFocusStore)
  const focusStore = rootFocusStore ?? fallbackFocusStore

  const handleOpenAutoFocus = React.useCallback(
    (event: Event) => {
      // This remains a fallback for content mounted without the shared root.
      focusStore.captureIfEmpty()
      onOpenAutoFocus?.(event)
    },
    [focusStore, onOpenAutoFocus]
  )

  const handleCloseAutoFocus = React.useCallback(
    (event: Event) => {
      onCloseAutoFocus?.(event)

      const opener = focusStore.take()
      if (!event.defaultPrevented && restoreFocus(opener)) {
        // Skip Radix's trigger-only restoration after restoring the actual opener.
        event.preventDefault()
      }
    },
    [focusStore, onCloseAutoFocus]
  )

  return { onOpenAutoFocus: handleOpenAutoFocus, onCloseAutoFocus: handleCloseAutoFocus }
}
