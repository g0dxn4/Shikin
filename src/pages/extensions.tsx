import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Database,
  FileSpreadsheet,
  KeyRound,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react'
import { isTauri } from '@/lib/runtime'

type ExtensionStatus = 'ready' | 'configure' | 'desktop'

/**
 * Static capability routing. Badges are presentation-only:
 * MCP is always Configure (no runtime status; CLI is not desktop-only).
 * Signed updates are Desktop on web and Ready in Tauri.
 * Do not read keys, versions, or invented provider status.
 */
const EXTENSIONS = [
  { key: 'csvImport', icon: FileSpreadsheet, href: '/transactions', status: 'ready' },
  {
    key: 'mcp',
    icon: TerminalSquare,
    href: '/settings?section=integrations#hosted-access',
    status: 'configure',
  },
  {
    key: 'marketData',
    icon: KeyRound,
    href: '/settings?section=integrations#market-data',
    status: 'configure',
  },
  {
    key: 'localData',
    icon: Database,
    href: '/settings?section=data#backups',
    status: 'ready',
  },
  {
    key: 'updates',
    icon: ShieldCheck,
    href: '/settings?section=data#updates',
    status: 'updates',
  },
] as const

const STATUS_CLASS: Record<ExtensionStatus, string> = {
  ready: 'border-success/30 text-success',
  configure: 'border-accent/40 text-accent',
  desktop: 'border-border text-muted-foreground',
}

function extensionStatus(status: (typeof EXTENSIONS)[number]['status']): ExtensionStatus {
  if (status === 'updates') return isTauri ? 'ready' : 'desktop'
  return status
}

export function ExtensionsPage() {
  const { t } = useTranslation('extensions')

  return (
    <div className="page-content">
      <section aria-labelledby="extensions-capabilities" className="space-y-2">
        <h2 id="extensions-capabilities" className="text-sm font-semibold">
          {t('capabilitiesTitle')}
        </h2>
        <ul className="grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2">
          {EXTENSIONS.map(({ key, icon: Icon, href, status: statusKey }, index) => {
            const status = extensionStatus(statusKey)
            const description = t(`items.${key}.description`)
            const spansRow = EXTENSIONS.length % 2 === 1 && index === EXTENSIONS.length - 1
            return (
              <li key={key} className={spansRow ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                <Link
                  to={href}
                  title={description}
                  aria-describedby={`extension-${key}-description`}
                  className="border-border bg-surface hover:bg-muted focus-visible:ring-ring flex h-full min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="bg-muted text-accent grid size-11 shrink-0 place-items-center rounded-xl">
                    <Icon size={20} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1 basis-32">
                    <span className="block text-sm font-semibold break-words">
                      {t(`items.${key}.title`)}
                    </span>
                  </span>
                  <span
                    data-status={status}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[status]}`}
                  >
                    <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                    {t(`status.${status}`)}
                  </span>
                  <span className="text-accent inline-flex min-h-11 items-center gap-1 text-xs font-semibold break-words">
                    {t(`items.${key}.action`)}
                    <ArrowRight size={14} aria-hidden="true" />
                  </span>
                </Link>
                <span id={`extension-${key}-description`} className="sr-only">
                  {description}
                </span>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}
