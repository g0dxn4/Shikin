import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Database,
  FileSpreadsheet,
  KeyRound,
  ServerCog,
  TerminalSquare,
} from 'lucide-react'
import { NativePanel } from '@/components/ui/native-layout'

const EXTENSIONS = [
  { key: 'csvImport', icon: FileSpreadsheet, href: '/transactions', status: 'ready' },
  { key: 'mcp', icon: TerminalSquare, href: '/settings', status: 'ready' },
  { key: 'marketData', icon: KeyRound, href: '/settings', status: 'configure' },
  { key: 'localData', icon: Database, href: '/settings', status: 'ready' },
  { key: 'updates', icon: ServerCog, href: '/settings', status: 'ready' },
] as const

export function ExtensionsPage() {
  const { t } = useTranslation('extensions')

  return (
    <div className="page-content">
      <p className="text-muted-foreground max-w-2xl text-sm">{t('description')}</p>
      <NativePanel className="overflow-hidden">
        <div className="border-border border-b px-5 py-4 sm:px-6">
          <h2 className="text-base font-semibold">{t('capabilitiesTitle')}</h2>
          <p className="text-muted-foreground mt-1 text-xs">{t('capabilitiesDescription')}</p>
        </div>
        <div className="divide-border grid divide-y md:grid-cols-2 md:divide-x md:[&>*:nth-child(2)]:border-t-0">
          {EXTENSIONS.map(({ key, icon: Icon, href, status }) => (
            <Link
              key={key}
              to={href}
              className="hover:bg-muted focus-visible:ring-ring group flex min-h-36 flex-col gap-3 p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none sm:p-6"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="bg-accent-muted text-accent grid size-9 place-items-center rounded-lg">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <span className="border-border text-muted-foreground rounded-md border px-2 py-0.5 text-[11px] font-medium">
                  {t(`status.${status}`)}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{t(`items.${key}.title`)}</h3>
                <p className="text-muted-foreground mt-1.5 text-xs leading-5">
                  {t(`items.${key}.description`)}
                </p>
              </div>
              <span className="text-accent inline-flex items-center gap-1.5 text-xs font-semibold">
                {t(`items.${key}.action`)}
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </NativePanel>
    </div>
  )
}
