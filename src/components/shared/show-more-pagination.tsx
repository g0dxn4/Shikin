import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ShowMorePaginationProps {
  shown: number
  total: number
  summaryLabel: string
  showMoreLabel: string
  onShowMore: () => void
  className?: string
}

export function ShowMorePagination({
  shown,
  total,
  summaryLabel,
  showMoreLabel,
  onShowMore,
  className,
}: ShowMorePaginationProps) {
  if (shown >= total) return null

  return (
    <div
      className={cn(
        'liquid-card flex flex-col items-center gap-3 p-4 text-center sm:flex-row sm:justify-between sm:text-left',
        className
      )}
    >
      <p className="text-muted-foreground text-xs font-medium">{summaryLabel}</p>
      <Button variant="outline" size="sm" onClick={onShowMore}>
        {showMoreLabel}
      </Button>
    </div>
  )
}
