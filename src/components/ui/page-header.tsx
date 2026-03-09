interface PageHeaderProps {
  title: string
  actions?: React.ReactNode
  children?: React.ReactNode
}

export function PageHeader({ title, actions, children }: PageHeaderProps) {
  return (
    <div>
      <div className="page-header">
        <h1 className="font-heading text-2xl font-bold">{title}</h1>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
