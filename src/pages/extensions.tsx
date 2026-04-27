import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  CheckCircle,
  Database,
  FileSpreadsheet,
  KeyRound,
  Puzzle,
  ServerCog,
  TerminalSquare,
} from 'lucide-react'

const EXTENSIONS = [
  {
    key: 'csvImport',
    icon: FileSpreadsheet,
    href: '/transactions',
    status: 'ready',
    accent: 'text-success',
  },
  {
    key: 'mcp',
    icon: TerminalSquare,
    href: '/settings',
    status: 'ready',
    accent: 'text-accent',
  },
  {
    key: 'marketData',
    icon: KeyRound,
    href: '/settings',
    status: 'configure',
    accent: 'text-warning',
  },
  {
    key: 'localData',
    icon: Database,
    href: '/settings',
    status: 'ready',
    accent: 'text-primary',
  },
  {
    key: 'updates',
    icon: ServerCog,
    href: '/settings',
    status: 'ready',
    accent: 'text-success',
  },
] as const

export function ExtensionsPage() {
  const { t } = useTranslation('common')

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-card page-header p-5">
        <div className="flex items-center gap-3">
          <Puzzle size={24} className="text-extension" aria-hidden="true" />
          <div>
            <h1 className="font-heading text-2xl font-bold">{t('extensions.title')}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{t('extensions.description')}</p>
          </div>
        </div>
      </div>

      <div className="liquid-hero p-5 sm:p-6">
        <div className="max-w-2xl">
          <span className="text-accent mb-3 inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
            <CheckCircle size={14} aria-hidden="true" />
            {t('extensions.localFirst')}
          </span>
          <h2 className="font-heading text-2xl font-bold tracking-tight sm:text-3xl">
            {t('extensions.heroTitle')}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6">
            {t('extensions.heroDescription')}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {EXTENSIONS.map(({ key, icon: Icon, href, status, accent }) => (
          <a
            key={key}
            href={href}
            className="liquid-card group flex min-h-48 flex-col justify-between p-5 transition-transform duration-200 hover:translate-y-[-2px] motion-reduce:transform-none"
          >
            <div>
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-white/[0.08] bg-white/[0.05]">
                  <Icon size={22} className={accent} aria-hidden="true" />
                </div>
                <span className="text-muted-foreground rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase">
                  {t(`extensions.status.${status}`)}
                </span>
              </div>
              <h3 className="font-heading text-lg font-semibold">
                {t(`extensions.items.${key}.title`)}
              </h3>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                {t(`extensions.items.${key}.description`)}
              </p>
            </div>
            <span className="text-accent mt-5 inline-flex items-center gap-2 text-sm font-semibold">
              {t(`extensions.items.${key}.action`)}
              <ArrowRight
                size={15}
                className="transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
                aria-hidden="true"
              />
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
