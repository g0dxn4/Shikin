import { useState } from 'react'
import { TrendingUp, Landmark, CreditCard } from 'lucide-react'
import { MetricCard } from '@/components/ui/metric-card'
import { ChartContainer } from '@/components/ui/chart-container'
import { PageHeader } from '@/components/ui/page-header'
import { StatRow } from '@/components/ui/stat-row'
import { ProgressBar } from '@/components/ui/progress-bar'

const PERIODS = [
  { label: '3M', value: '3m' },
  { label: '6M', value: '6m' },
  { label: '1Y', value: '1y' },
  { label: 'ALL', value: 'all' },
]

const ASSETS = [
  { name: 'Checking', amount: '$8,450', percent: 16 },
  { name: 'Savings', amount: '$12,200', percent: 23 },
  { name: 'Investments', amount: '$18,450', percent: 35 },
  { name: 'Crypto', amount: '$6,100', percent: 12 },
  { name: 'Other', amount: '$7,720', percent: 14 },
]

const LIABILITIES = [
  { name: 'Credit Card', amount: '$2,340', percent: 41 },
  { name: 'Student Loan', amount: '$3,350', percent: 59 },
]

export function NetWorth() {
  const [period, setPeriod] = useState('1y')

  return (
    <div className="animate-fade-in-up page-content">
      <PageHeader title="Net Worth" />

      {/* Hero metric */}
      <MetricCard
        icon={<TrendingUp size={16} className="text-accent" />}
        label="Total Net Worth"
        value="$47,230.50"
        change={{ value: '$2,450 (+5.5%)', positive: true }}
        className="border border-accent/10"
      />

      {/* Chart */}
      <ChartContainer
        title="Net Worth Over Time"
        periods={PERIODS}
        selectedPeriod={period}
        onPeriodChange={setPeriod}
      >
        <div className="relative h-48 overflow-hidden rounded bg-gradient-to-t from-accent/20 to-transparent">
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-muted-foreground text-xs">Chart placeholder</span>
          </div>
          {/* Simulated trend line */}
          <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <polyline
              points="0,160 60,140 120,145 180,120 240,100 300,110 360,85 420,70 480,60 540,50 600,40 660,35"
              fill="none"
              stroke="#bf5af2"
              strokeWidth="2"
              opacity="0.5"
            />
          </svg>
        </div>
      </ChartContainer>

      {/* Assets & Liabilities */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Assets */}
        <div className="glass-card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Landmark size={16} className="text-success" />
              <h3 className="font-heading text-sm font-semibold">Assets</h3>
            </div>
            <span className="font-heading text-lg font-bold text-success">$52,920</span>
          </div>
          <div className="space-y-3">
            {ASSETS.map((asset) => (
              <div key={asset.name} className="space-y-1">
                <StatRow label={asset.name} value={asset.amount} valueColor="text-success" />
                <ProgressBar value={asset.percent} color="success" size="sm" />
              </div>
            ))}
          </div>
        </div>

        {/* Liabilities */}
        <div className="glass-card space-y-4 p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard size={16} className="text-destructive" />
              <h3 className="font-heading text-sm font-semibold">Liabilities</h3>
            </div>
            <span className="font-heading text-lg font-bold text-destructive">$5,690</span>
          </div>
          <div className="space-y-3">
            {LIABILITIES.map((liability) => (
              <div key={liability.name} className="space-y-1">
                <StatRow
                  label={liability.name}
                  value={liability.amount}
                  valueColor="text-destructive"
                />
                <ProgressBar value={liability.percent} color="destructive" size="sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
