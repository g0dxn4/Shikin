import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ArrowRight, BarChart3, Flame, Landmark, LineChart, PieChart, Sparkles } from 'lucide-react'

const insightSections = [
  {
    key: 'reports',
    href: '/reports',
    icon: PieChart,
    accent: 'text-primary',
    border: 'bg-primary',
    featured: true,
  },
  {
    key: 'spendingInsights',
    href: '/spending-insights',
    icon: Sparkles,
    accent: 'text-chart-4',
    border: 'bg-chart-4',
    featured: true,
  },
  {
    key: 'forecast',
    href: '/forecast',
    icon: LineChart,
    accent: 'text-accent',
    border: 'bg-accent',
    featured: false,
  },
  {
    key: 'netWorth',
    href: '/net-worth',
    icon: Landmark,
    accent: 'text-chart-3',
    border: 'bg-chart-3',
    featured: false,
  },
  {
    key: 'spendingHeatmap',
    href: '/spending-heatmap',
    icon: Flame,
    accent: 'text-chart-5',
    border: 'bg-chart-5',
    featured: false,
  },
] as const

export function InsightsPage() {
  const { t } = useTranslation('insights')
  const featuredSections = insightSections.filter((section) => section.featured)
  const secondarySections = insightSections.filter((section) => !section.featured)

  return (
    <div className="page-content animate-fade-in-up">
      <div className="liquid-hero relative overflow-hidden p-5 sm:p-6 lg:p-8">
        <div className="bg-accent/20 pointer-events-none absolute -top-24 -right-20 h-64 w-64 rounded-full blur-3xl" />
        <BarChart3
          size={220}
          className="pointer-events-none absolute -right-12 -bottom-16 text-white/[0.035]"
          aria-hidden="true"
        />
        <div className="relative z-10 max-w-2xl">
          <span className="text-accent mb-3 inline-flex items-center gap-2 font-mono text-[10px] font-semibold tracking-[0.18em] uppercase">
            <BarChart3 size={14} aria-hidden="true" />
            {t('eyebrow')}
          </span>
          <h1 className="font-heading text-3xl font-bold tracking-tight sm:text-4xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-6 sm:text-base">
            {t('description')}
          </p>
        </div>
      </div>

      <section aria-label={t('featuredLabel')}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {featuredSections.map((section, index) => (
            <InsightCard key={section.href} section={section} index={index} t={t} featured />
          ))}
        </div>
      </section>

      <section aria-label={t('deeperLabel')}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {secondarySections.map((section, index) => (
            <InsightCard
              key={section.href}
              section={section}
              index={index + featuredSections.length}
              t={t}
            />
          ))}
        </div>
      </section>
    </div>
  )
}

type InsightSection = (typeof insightSections)[number]

interface InsightCardProps {
  section: InsightSection
  index: number
  t: ReturnType<typeof useTranslation<'insights'>>['t']
  featured?: boolean
}

function InsightCard({ section, index, t, featured = false }: InsightCardProps) {
  const { key, href, icon: Icon, accent, border } = section
  const title = t(`sections.${key}.title`)
  const descriptionId = `insight-${key}-description`

  return (
    <Link
      to={href}
      aria-describedby={descriptionId}
      className="liquid-card group focus-visible:ring-ring focus-visible:ring-offset-background relative flex min-h-[11rem] flex-col justify-between overflow-hidden p-5 transition-all duration-200 [animation-fill-mode:both] hover:-translate-y-0.5 hover:border-white/[0.12] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transform-none sm:min-h-[13rem]"
      style={{ animationDelay: `${index * 70}ms` }}
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 ${border}`} />
      <div className="pointer-events-none absolute -right-12 -bottom-16 h-40 w-40 rounded-full bg-white/[0.035] blur-2xl transition-opacity group-hover:opacity-80" />

      <div className="relative">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-white/[0.08] bg-gradient-to-br from-white/[0.08] to-transparent">
            <Icon size={22} className={accent} aria-hidden="true" />
          </div>
          {featured && (
            <span className="text-muted-foreground rounded-full border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] tracking-wider uppercase">
              {t('featuredBadge')}
            </span>
          )}
        </div>
        <h3 className="font-heading text-lg font-semibold">{title}</h3>
        <p id={descriptionId} className="text-muted-foreground mt-2 text-sm leading-6">
          {t(`sections.${key}.description`)}
        </p>
      </div>

      <span className="text-muted-foreground group-hover:text-accent mt-5 inline-flex items-center gap-2 text-sm font-semibold transition-colors">
        {t('open', { title })}
        <ArrowRight
          size={15}
          className="transition-transform group-hover:translate-x-0.5 motion-reduce:transform-none"
          aria-hidden="true"
        />
      </span>
    </Link>
  )
}
