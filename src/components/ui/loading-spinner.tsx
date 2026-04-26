import { cn } from '@/lib/utils'

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div
      className={cn('bg-background flex h-screen items-center justify-center', className)}
      role="status"
    >
      <div
        className="border-muted-foreground border-t-primary h-8 w-8 animate-spin rounded-full border-2"
        aria-hidden="true"
      />
      <span className="sr-only">Loading</span>
    </div>
  )
}
