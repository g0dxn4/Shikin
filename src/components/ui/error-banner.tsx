import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorBannerProps {
  title?: string
  message?: string | null
  messages?: Array<string | null | undefined>
  retryLabel?: string
  onRetry?: () => void
  className?: string
}

export function ErrorBanner({
  title = 'Something went wrong',
  message,
  messages,
  retryLabel = 'Retry',
  onRetry,
  className,
}: ErrorBannerProps) {
  const resolvedMessages = (messages ?? [message]).filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  )

  if (resolvedMessages.length === 0) {
    return null
  }

  return (
    <div
      role="alert"
      className={cn(
        'border-destructive/30 bg-destructive/8 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-start',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <AlertTriangle size={16} className="text-destructive mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-foreground font-medium">{title}</p>
          {resolvedMessages.length === 1 ? (
            <p className="text-muted-foreground mt-1 leading-relaxed">{resolvedMessages[0]}</p>
          ) : (
            <ul className="text-muted-foreground mt-1 list-disc space-y-1 pl-4">
              {resolvedMessages.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="w-full shrink-0 sm:w-auto">
          {retryLabel}
        </Button>
      )}
    </div>
  )
}
