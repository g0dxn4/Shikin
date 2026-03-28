import { useRef, useSyncExternalStore, type ReactNode } from 'react'
import { ResponsiveContainer } from 'recharts'

interface SafeChartProps {
  width?: number | `${number}%`
  height?: number | `${number}%`
  children: ReactNode
}

/**
 * Wraps Recharts ResponsiveContainer to suppress "width(-1) height(-1)" warnings.
 * Only renders the chart once the wrapper div has positive dimensions.
 */
export function SafeChart({ width = '100%', height = '100%', children }: SafeChartProps) {
  const ref = useRef<HTMLDivElement>(null)

  // Use useSyncExternalStore to get a synchronous, flicker-free read of dimensions
  const ready = useSyncExternalStore(
    (callback) => {
      const el = ref.current
      if (!el) return () => {}
      const observer = new ResizeObserver(callback)
      observer.observe(el)
      return () => observer.disconnect()
    },
    () => {
      const el = ref.current
      return !!el && el.clientWidth > 0 && el.clientHeight > 0
    },
    () => false // SSR: not ready
  )

  return (
    <div ref={ref} style={{ width: '100%', height: '100%', minHeight: 1 }}>
      {ready ? (
        <ResponsiveContainer width={width} height={height}>
          {children}
        </ResponsiveContainer>
      ) : null}
    </div>
  )
}
