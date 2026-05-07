import type { MouseEvent, ReactNode } from 'react'
import { Minus, Square, X } from 'lucide-react'
import { isTauri } from '@/lib/runtime'

type WindowCommand = 'minimize' | 'toggleMaximize' | 'close' | 'startDragging'

async function runWindowCommand(command: WindowCommand) {
  if (!isTauri) return

  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow()[command]()
}

function handleWindowCommand(command: WindowCommand) {
  void runWindowCommand(command).catch((error) => {
    console.error(`Failed to ${command} window`, error)
  })
}

export function TauriTitleBar() {
  if (!isTauri) return null

  const handleDragStart = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return

    handleWindowCommand('startDragging')
  }

  return (
    <header
      data-tauri-drag-region
      aria-label="Window title bar"
      onMouseDown={handleDragStart}
      className="bg-background/95 flex h-10 shrink-0 items-center border-b border-white/[0.06] pl-3 backdrop-blur-xl select-none"
    >
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex h-full items-center" role="group" aria-label="Window controls">
        <TitleBarButton label="Minimize window" command="minimize">
          <Minus size={14} aria-hidden="true" />
        </TitleBarButton>
        <TitleBarButton label="Maximize window" command="toggleMaximize">
          <Square size={12} aria-hidden="true" />
        </TitleBarButton>
        <TitleBarButton label="Close window" command="close" destructive>
          <X size={14} aria-hidden="true" />
        </TitleBarButton>
      </div>
    </header>
  )
}

interface TitleBarButtonProps {
  label: string
  command: WindowCommand
  children: ReactNode
  destructive?: boolean
}

function TitleBarButton({ label, command, children, destructive = false }: TitleBarButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={() => handleWindowCommand(command)}
      className={
        destructive
          ? 'text-muted-foreground hover:bg-destructive hover:text-destructive-foreground focus-visible:ring-ring flex h-10 w-12 items-center justify-center transition-colors focus-visible:ring-2 focus-visible:outline-none'
          : 'text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-10 w-12 items-center justify-center transition-colors hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:outline-none'
      }
    >
      {children}
    </button>
  )
}
