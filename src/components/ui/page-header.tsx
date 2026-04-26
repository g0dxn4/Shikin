import { cn } from '@/lib/utils'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, actions, children, className }: PageHeaderProps) {
  return (
    <div>
      <div className={cn('liquid-card page-header p-5', className)}>
        <div>
          {subtitle && (
            <p className="text-muted-foreground font-mono text-[10px] tracking-[0.3em] uppercase">
              {subtitle}
            </p>
          )}
          <h1 className="font-heading mt-1 text-2xl font-bold tracking-tight md:text-3xl">
            {title}
          </h1>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
