import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  icon: React.ReactNode
  title: string
  description: string
  action?: { label: string; onClick: () => void }
  className?: string
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'liquid-card flex flex-col items-center justify-center py-16 text-center',
        className
      )}
    >
      <div
        className="bg-accent-muted text-primary mb-4 flex h-14 w-14 items-center justify-center rounded-3xl"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="font-heading mb-2 text-lg font-semibold">{title}</h2>
      <p className="text-muted-foreground mb-6 max-w-sm text-sm">{description}</p>
      {action && <Button onClick={action.onClick}>{action.label}</Button>}
    </div>
  )
}
