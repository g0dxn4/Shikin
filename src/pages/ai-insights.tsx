import { useState } from 'react'
import {
  Sparkles,
  AlertTriangle,
  TrendingUp,
  Zap,
  ArrowRight,
  Circle,
  CheckCircle2,
} from 'lucide-react'
import { PageHeader } from '@/components/ui/page-header'
import { ChartContainer } from '@/components/ui/chart-container'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

interface InsightCard {
  id: string
  type: 'warning' | 'success' | 'accent'
  title: string
  description: string
  icon: React.ReactNode
}

const INSIGHTS: InsightCard[] = [
  {
    id: '1',
    type: 'warning',
    title: 'Spending Alert',
    description:
      'Your dining expenses increased 34% this month compared to your 3-month average. Consider setting a budget limit.',
    icon: <AlertTriangle size={18} />,
  },
  {
    id: '2',
    type: 'success',
    title: 'Savings Opportunity',
    description:
      'You could save $45/mo by switching 3 monthly subscriptions to annual billing. Adobe CC, Spotify, and iCloud.',
    icon: <TrendingUp size={18} />,
  },
  {
    id: '3',
    type: 'accent',
    title: 'Investment Signal',
    description:
      'AAPL is near its 52-week high at $198.50. Your position is up 24.3% — consider taking partial profits.',
    icon: <Zap size={18} />,
  },
]

const BORDER_COLORS: Record<string, string> = {
  warning: 'border-l-yellow-500',
  success: 'border-l-green-500',
  accent: 'border-l-accent',
}

const ICON_COLORS: Record<string, string> = {
  warning: 'text-yellow-500',
  success: 'text-green-500',
  accent: 'text-accent',
}

const SUGGESTED_ACTIONS = [
  { id: '1', text: 'Review dining expenses and set a $400/mo budget', done: false },
  { id: '2', text: 'Switch Adobe CC to annual plan ($45/mo savings)', done: false },
  { id: '3', text: 'Rebalance portfolio — tech allocation is 45% (target: 35%)', done: false },
]

export function AIInsights() {
  const [checkedActions, setCheckedActions] = useState<Set<string>>(new Set())

  const toggleAction = (id: string) => {
    setCheckedActions((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader
        title="AI Insights"
        actions={
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <span className="text-muted-foreground text-xs">Updated just now</span>
          </div>
        }
      />

      {/* Insight Cards */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {INSIGHTS.map((insight) => (
          <div
            key={insight.id}
            className={`glass-card border-l-4 p-5 ${BORDER_COLORS[insight.type]}`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className={ICON_COLORS[insight.type]}>{insight.icon}</span>
              <h3 className="font-heading text-sm font-semibold">{insight.title}</h3>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              {insight.description}
            </p>
          </div>
        ))}
      </div>

      {/* Chat Preview */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent font-heading text-sm font-bold text-white">
            I
          </div>
          <div>
            <h3 className="font-heading text-sm font-semibold">Chat with Ivy</h3>
            <p className="text-muted-foreground text-[10px]">Your AI financial assistant</p>
          </div>
        </div>
        <div className="mb-4 rounded-lg bg-white/[0.03] px-4 py-3">
          <p className="text-sm leading-relaxed">
            Based on your spending patterns, I recommend focusing on your dining budget this month.
            You're on track to exceed last month by ~$180. Want me to create a budget alert?
          </p>
        </div>
        <Button variant="outline" size="sm">
          Open Chat
          <ArrowRight size={14} />
        </Button>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartContainer title="Income vs Expenses">
          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Income</span>
                <span className="font-heading font-semibold text-success">$6,240</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded bg-white/[0.04]">
                <div
                  className="h-full rounded bg-gradient-to-r from-green-600 to-green-400"
                  style={{ width: '85%' }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Expenses</span>
                <span className="font-heading font-semibold text-destructive">$4,250</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded bg-white/[0.04]">
                <div
                  className="h-full rounded bg-gradient-to-r from-red-600 to-red-400"
                  style={{ width: '58%' }}
                />
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-white/5 pt-3 text-xs">
              <span className="text-muted-foreground">Net</span>
              <span className="font-heading font-semibold text-success">+$1,990</span>
            </div>
          </div>
        </ChartContainer>

        <ChartContainer title="Savings Rate">
          <div className="relative flex h-40 items-end justify-center overflow-hidden rounded">
            {/* Gradient background simulating area chart */}
            <div className="absolute inset-0 bg-gradient-to-t from-accent/20 via-accent/5 to-transparent" />
            {/* Simulated curve */}
            <svg
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              viewBox="0 0 200 100"
            >
              <path
                d="M0,80 C30,75 50,60 80,55 C110,50 130,40 160,35 C180,32 200,30 200,30"
                fill="none"
                stroke="#bf5af2"
                strokeWidth="1.5"
              />
            </svg>
            <Badge className="relative mb-4 bg-accent/20 text-accent">Current: 32%</Badge>
          </div>
        </ChartContainer>
      </div>

      {/* Suggested Actions */}
      <div className="glass-card p-5">
        <h3 className="font-heading mb-4 text-sm font-semibold">Suggested Actions</h3>
        <div className="space-y-2">
          {SUGGESTED_ACTIONS.map((action) => {
            const isChecked = checkedActions.has(action.id)
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => toggleAction(action.id)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
              >
                {isChecked ? (
                  <CheckCircle2 size={18} className="shrink-0 text-success" />
                ) : (
                  <Circle size={18} className="text-muted-foreground shrink-0" />
                )}
                <span
                  className={`text-sm ${
                    isChecked ? 'text-muted-foreground line-through' : ''
                  }`}
                >
                  {action.text}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
