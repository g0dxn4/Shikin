import { cn } from '@/lib/utils'

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-screen items-center justify-center bg-background', className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-primary" />
    </div>
  )
}
