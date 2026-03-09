import { cn } from '@/lib/utils'

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: string
  change?: { value: string; positive: boolean }
  className?: string
}

export function MetricCard({ icon, label, value, change, className }: MetricCardProps) {
  return (
    <div className={cn('metric-card flex items-start gap-3', className)}>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
        {icon}
      </div>
      <div className="min-w-0">
        <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
          {label}
        </span>
        <p className="font-heading text-xl font-bold">{value}</p>
        {change && (
          <span
            className={cn('text-xs', change.positive ? 'text-success' : 'text-destructive')}
          >
            {change.positive ? '+' : ''}
            {change.value}
          </span>
        )}
      </div>
    </div>
  )
}
