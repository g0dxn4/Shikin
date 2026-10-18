import type { TFunction } from 'i18next'
import { Info } from 'lucide-react'
import { NativePanel } from '@/components/ui/native-layout'
import { formatMoney } from '@/lib/money'
import type {
  LiquidCompositionModel,
  PositiveSegmentKey,
} from '@/components/accounts/account-composition'

type AccountsT = TFunction<'accounts'>

const SEGMENT_COLOR: Record<PositiveSegmentKey, string> = {
  checking: 'var(--color-chart-1)',
  savings: 'var(--color-chart-2)',
  cash: 'var(--color-chart-3)',
  other: 'var(--color-chart-4)',
  creditPositive: 'var(--color-chart-5)',
}

function debtLabel(
  model: Extract<LiquidCompositionModel, { kind: 'stack' | 'context' }>,
  t: AccountsT
) {
  if (model.debtKind === 'card') return t('mix.cardDebt')
  if (model.debtKind === 'other') return t('mix.otherDebt')
  return t('mix.debt')
}

function ScopeDisclosure({ t }: { t: AccountsT }) {
  return (
    <details className="shrink-0">
      <summary className="text-muted-foreground focus-visible:ring-ring inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-md px-1 text-xs focus-visible:ring-2 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <Info size={14} aria-hidden="true" />
        {t('mix.scopeLabel')}
      </summary>
      <p className="text-muted-foreground mt-1 max-w-prose text-xs">{t('mix.scope')}</p>
    </details>
  )
}

export function LiquidCompositionPanel({
  model,
  t,
}: {
  model: LiquidCompositionModel
  t: AccountsT
}) {
  return (
    <NativePanel className="min-w-0 p-4 sm:px-5 sm:py-4" data-composition={model.kind}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 className="min-w-0 text-base font-semibold break-words">{t('mix.title')}</h2>
        <ScopeDisclosure t={t} />
      </div>

      {model.kind === 'stack' ? (
        <div className="mt-3 min-w-0">
          <div
            className="bg-muted flex h-3 w-full overflow-hidden rounded-full"
            data-testid="mix-stack"
            role="img"
            aria-label={t('mix.stackLabel')}
          >
            {model.segments.map((segment) => (
              <div
                key={segment.key}
                data-testid={`mix-segment-${segment.key}`}
                className="h-full"
                style={{
                  flex: `0 0 ${segment.widthPercent}`,
                  backgroundColor: SEGMENT_COLOR[segment.key],
                }}
              />
            ))}
          </div>
          <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            {model.segments.map((segment) => (
              <li
                key={segment.key}
                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
              >
                <span
                  data-testid={`mix-swatch-${segment.key}`}
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-sm"
                  style={{
                    width: 8,
                    height: 8,
                    backgroundColor: SEGMENT_COLOR[segment.key],
                  }}
                />
                <span className="min-w-0 break-words">{t(`mix.segments.${segment.key}`)}</span>
                <span className="ml-auto shrink-0 font-medium break-words tabular-nums">
                  {formatMoney(segment.amountCentavos, model.currency)}
                </span>
              </li>
            ))}
          </ul>
          <p className="sr-only">
            {formatMoney(model.positiveCentavos, model.currency)} −{' '}
            {formatMoney(model.debtCentavos, model.currency)} ={' '}
            {formatMoney(model.netCentavos, model.currency)}
          </p>
          <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{t('mix.spendable')}</p>
              <p className="mt-0.5 text-sm font-medium break-words tabular-nums">
                {formatMoney(model.positiveCentavos, model.currency)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{debtLabel(model, t)}</p>
              <p className="text-warning mt-0.5 text-sm font-medium break-words tabular-nums">
                {formatMoney(model.debtCentavos, model.currency)}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span>{t('mix.net')}</span>
            <span className="text-foreground font-medium break-words tabular-nums">
              {formatMoney(model.netCentavos, model.currency)}
            </span>
          </p>
        </div>
      ) : null}

      {model.kind === 'context' ? (
        <div className="mt-3 min-w-0">
          <p className="text-muted-foreground text-sm">{t('mix.emptyStack')}</p>
          <div className="mt-3 grid min-w-0 grid-cols-2 gap-x-4 gap-y-2">
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{t('mix.spendable')}</p>
              <p className="mt-0.5 text-sm font-medium break-words tabular-nums">
                {formatMoney(model.positiveCentavos, model.currency)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-muted-foreground text-xs">{debtLabel(model, t)}</p>
              <p className="text-warning mt-0.5 text-sm font-medium break-words tabular-nums">
                {formatMoney(model.debtCentavos, model.currency)}
              </p>
            </div>
          </div>
          <p className="text-muted-foreground mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span>{t('mix.net')}</span>
            <span className="text-foreground font-medium break-words tabular-nums">
              {formatMoney(model.netCentavos, model.currency)}
            </span>
          </p>
        </div>
      ) : null}

      {model.kind === 'grouped' ? (
        <div className="mt-3 min-w-0">
          <p className="text-muted-foreground text-sm">{t('mix.groupedCaption')}</p>
          {model.groups.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {model.groups.map((group) => (
                <li
                  key={group.currency}
                  className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm"
                >
                  <span>{group.currency}</span>
                  <span className="font-medium break-words tabular-nums">
                    {formatMoney(group.amountCentavos, group.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {model.kind === 'unreconciled' ? (
        <p className="text-muted-foreground mt-3 text-sm">{t('mix.unreconciled')}</p>
      ) : null}
    </NativePanel>
  )
}
