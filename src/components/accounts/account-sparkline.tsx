import dayjs from 'dayjs'
import { formatMoney } from '@/lib/money'
import {
  historySparklineLayout,
  type AccountHistoryPoint,
} from '@/components/accounts/account-history-batch'

export function AccountSparkline({
  points,
  color,
  currency,
  label,
}: {
  points: readonly AccountHistoryPoint[]
  color: string
  currency: string
  label: string
}) {
  const layout = historySparklineLayout(points)
  if (layout.length < 2) return null
  const poly = layout.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ')

  return (
    <div
      className="account-visual-slot mt-auto h-12 min-w-0"
      role="img"
      aria-label={label}
      data-balances={points.map((point) => point.balance).join(',')}
    >
      <span className="sr-only">
        {points
          .map(
            (point) =>
              `${dayjs(point.date).format('MMM D')}: ${formatMoney(point.balance, currency)}`
          )
          .join(', ')}
      </span>
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
    </div>
  )
}
