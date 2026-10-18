import dayjs from 'dayjs'
import { formatMoney } from '@/lib/money'
import {
  historySparklineLayout,
  type AccountHistoryPoint,
} from '@/components/accounts/account-history-batch'

function formatHistoryEndpoint(date: string, locale: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return date
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function AccountSparkline({
  points,
  color,
  currency,
  label,
  locale = 'en',
}: {
  points: readonly AccountHistoryPoint[]
  color: string
  currency: string
  label: string
  locale?: string
}) {
  const layout = historySparklineLayout(points)
  if (layout.length < 2 || layout.length !== points.length) return null
  const poly = layout.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')
  const first = points[0]
  const last = points[points.length - 1]
  if (!first || !last) return null
  const described = points
    .map((point) => `${dayjs(point.date).format('MMM D')}: ${formatMoney(point.balance, currency)}`)
    .join(', ')

  return (
    <div
      className="account-visual-slot min-w-0"
      role="img"
      aria-label={label}
      title={described}
      data-balances={points.map((point) => point.balance).join(',')}
      data-point-count={points.length}
    >
      <span className="sr-only">{described}</span>
      <svg
        viewBox="0 0 100 48"
        className="h-12 w-full"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <polyline
          points={poly}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <div className="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-[10px] leading-none tabular-nums">
        <time
          dateTime={first.date}
          data-endpoint="start"
          title={formatMoney(first.balance, currency)}
        >
          {formatHistoryEndpoint(first.date, locale)}
        </time>
        <time dateTime={last.date} data-endpoint="end" title={formatMoney(last.balance, currency)}>
          {formatHistoryEndpoint(last.date, locale)}
        </time>
      </div>
    </div>
  )
}
