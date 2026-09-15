import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageToolbarProps extends HTMLAttributes<HTMLDivElement> {
  leading?: ReactNode
  actions?: ReactNode
}

/** Compact page-owned row for filters and actions. The route title remains owned by AppShell. */
export function PageToolbar({ leading, actions, children, className, ...props }: PageToolbarProps) {
  return (
    <div
      className={cn(
        'page-toolbar flex min-h-10 flex-wrap items-center justify-between gap-2',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{leading ?? children}</div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

interface NativePanelProps extends HTMLAttributes<HTMLElement> {
  as?: 'section' | 'article' | 'div'
}

/** Semantic bordered surface used for page sections. */
export function NativePanel({ as: Comp = 'section', className, ...props }: NativePanelProps) {
  return <Comp className={cn('native-panel', className)} {...props} />
}

export function MetricStrip({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('metric-strip', className)} {...props} />
}

interface MetricItemProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
}

export function MetricItem({ label, value, detail, className, ...props }: MetricItemProps) {
  return (
    <div className={cn('metric-item', className)} {...props}>
      <span className="text-muted-foreground text-xs">{label}</span>
      <strong className="mt-1 block text-xl font-semibold tabular-nums">{value}</strong>
      {detail ? <span className="text-muted-foreground mt-1 block text-xs">{detail}</span> : null}
    </div>
  )
}
