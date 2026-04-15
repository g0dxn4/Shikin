import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  title: string
  description: string
  retryLabel?: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({
  title,
  description,
  retryLabel = 'Try again',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'glass-card flex flex-col items-center justify-center py-16 text-center',
        className
      )}
    >
      <div className="bg-destructive/10 mb-4 flex h-14 w-14 items-center justify-center rounded-full">
        <AlertTriangle size={28} className="text-destructive" />
      </div>
      <h2 className="font-heading mb-2 text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mb-4 max-w-md text-sm">{description}</p>
      {onRetry && (
        <Button variant="outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
