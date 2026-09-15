import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Flame, Landmark, LineChart, PieChart, Sparkles } from 'lucide-react'
import { NativePanel } from '@/components/ui/native-layout'

const insightSections = [
  {
    key: 'reports',
    href: '/reports',
    icon: PieChart,
    featured: true,
  },
  {
    key: 'spendingInsights',
    href: '/spending-insights',
    icon: Sparkles,
    featured: true,
  },
  {
    key: 'forecast',
    href: '/forecast',
    icon: LineChart,
    featured: false,
  },
  {
    key: 'netWorth',
    href: '/net-worth',
    icon: Landmark,
    featured: false,
  },
  {
    key: 'spendingHeatmap',
    href: '/spending-heatmap',
    icon: Flame,
    featured: false,
  },
] as const

export function InsightsPage() {
  const { t } = useTranslation('insights')

  return (
    <div className="page-content">
      <p className="text-muted-foreground max-w-2xl text-sm">{t('description')}</p>
      <section aria-label={t('featuredLabel')}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {insightSections.map((section) => (
            <InsightCard key={section.href} section={section} t={t} />
          ))}
        </div>
      </section>
    </div>
  )
}

type InsightSection = (typeof insightSections)[number]

interface InsightCardProps {
  section: InsightSection
  t: ReturnType<typeof useTranslation<'insights'>>['t']
}

function InsightCard({ section, t }: InsightCardProps) {
  const { key, href, icon: Icon, featured } = section
  const title = t(`sections.${key}.title`)
  const descriptionId = `insight-${key}-description`

  return (
    <NativePanel as="article" className={key === 'forecast' ? 'lg:col-span-2' : undefined}>
      <Link
        to={href}
        aria-describedby={descriptionId}
        className="hover:bg-muted/60 focus-visible:ring-ring flex min-h-32 flex-col justify-between gap-4 rounded-[inherit] p-5 focus-visible:ring-2 focus-visible:outline-none"
      >
        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <span className="bg-accent-muted text-accent grid size-9 place-items-center rounded-lg">
              <Icon size={18} aria-hidden="true" />
            </span>
            {featured ? (
              <span className="border-border text-muted-foreground rounded-md border px-2 py-0.5 text-[11px] font-medium">
                {t('featuredBadge')}
              </span>
            ) : null}
          </div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p id={descriptionId} className="text-muted-foreground mt-1.5 text-xs leading-5">
            {t(`sections.${key}.description`)}
          </p>
        </div>
        <span className="text-accent inline-flex items-center gap-1.5 text-xs font-semibold">
          {t('open', { title })}
          <ArrowRight size={14} aria-hidden="true" />
        </span>
      </Link>
    </NativePanel>
  )
}
