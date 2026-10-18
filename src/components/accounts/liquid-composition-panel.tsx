import type { TFunction } from 'i18next'
import { NativePanel } from '@/components/ui/native-layout'
import { formatMoney } from '@/lib/money'
import type { LiquidCompositionModel } from '@/components/accounts/account-composition'

type AccountsT = TFunction<'accounts'>

function debtLabel(
  model: Extract<LiquidCompositionModel, { kind: 'stack' | 'context' }>,
  t: AccountsT
) {
  if (model.debtKind === 'card') return t('mix.cardDebt')
  if (model.debtKind === 'other') return t('mix.otherDebt')
  return t('mix.debt')
}

export function LiquidCompositionPanel({
  model,
  t,
}: {
  model: LiquidCompositionModel
  t: AccountsT
}) {
  const reconciled = model.kind === 'stack' || model.kind === 'context'

  return (
    <NativePanel className="min-w-0 p-4 sm:px-5 sm:py-4" data-composition={model.kind}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('mix.title')}</h2>
          <p className="text-muted-foreground mt-1 text-sm">{t('mix.scope')}</p>
        </div>
        {reconciled ? (
          <div className="grid min-w-0 grid-cols-2 gap-x-6 gap-y-1 sm:text-right">
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
        ) : null}
      </div>

      {model.kind === 'stack' ? (
        <div className="mt-4 min-w-0">
          <div
            className="bg-muted flex h-2 w-full overflow-hidden rounded-full"
            data-testid="mix-stack"
            role="img"
            aria-label={t('mix.stackLabel')}
          >
            {model.segments.map((segment, index) => (
              <div
                key={segment.key}
                data-testid={`mix-segment-${segment.key}`}
                className="h-full"
                style={{
                  flex: `0 0 ${segment.widthPercent}`,
                  backgroundColor: 'var(--color-chart-1)',
                  opacity: index % 2 === 0 ? 1 : 0.62,
                }}
              />
            ))}
          </div>
          <ul className="mt-3 grid min-w-0 gap-2 sm:grid-cols-2">
            {model.segments.map((segment) => (
              <li
                key={segment.key}
                className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm"
              >
                <span className="min-w-0 break-words">{t(`mix.segments.${segment.key}`)}</span>
                <span className="shrink-0 font-medium tabular-nums">
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
          <p className="text-muted-foreground mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span>{t('mix.net')}</span>
            <span className="text-foreground font-medium tabular-nums">
              {formatMoney(model.netCentavos, model.currency)}
            </span>
          </p>
        </div>
      ) : null}

      {model.kind === 'context' ? (
        <div className="mt-4 min-w-0">
          <p className="text-muted-foreground text-sm">{t('mix.emptyStack')}</p>
          <p className="text-muted-foreground mt-3 flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm">
            <span>{t('mix.net')}</span>
            <span className="text-foreground font-medium tabular-nums">
              {formatMoney(model.netCentavos, model.currency)}
            </span>
          </p>
        </div>
      ) : null}

      {model.kind === 'grouped' ? (
        <div className="mt-4 min-w-0">
          <p className="text-muted-foreground text-sm">{t('mix.groupedCaption')}</p>
          {model.groups.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {model.groups.map((group) => (
                <li
                  key={group.currency}
                  className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 text-sm"
                >
                  <span>{group.currency}</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(group.amountCentavos, group.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {model.kind === 'unreconciled' ? (
        <p className="text-muted-foreground mt-4 text-sm">{t('mix.unreconciled')}</p>
      ) : null}
    </NativePanel>
  )
}
