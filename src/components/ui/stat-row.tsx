import { cn } from '@/lib/utils'

interface StatRowProps {
  label: string
  value: string
  valueColor?: string
  className?: string
}

export function StatRow({ label, value, valueColor, className }: StatRowProps) {
  return (
    <div className={cn('flex items-center justify-between', className)}>
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className={cn('font-heading text-sm font-semibold', valueColor)}>{value}</span>
    </div>
  )
}
