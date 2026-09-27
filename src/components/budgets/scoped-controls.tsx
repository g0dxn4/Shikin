import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  normalizeReportScope,
  type NormalizedReportScope,
  type ReportWindowInput,
} from '@shikin/finance-core'
import type { ScopedReferences } from '@/lib/scoped-report-read'
import { Input } from '@/components/ui/input'
import { SUPPORTED_CURRENCIES } from '@/lib/constants'

export const scopedSelectClass =
  'bg-background text-foreground border-border min-h-11 w-full min-w-0 rounded-lg border px-3 text-sm'

export function CurrencyControl({
  value,
  onChange,
  allowDefault = false,
}: {
  value: string
  onChange: (value: string) => void
  allowDefault?: boolean
}) {
  const { t } = useTranslation('budgets')
  return (
    <label className="grid min-w-0 gap-1 text-sm">
      {t('scoped.currency')}
      <select
        className={scopedSelectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowDefault && <option value="">{t('scoped.databaseCurrency')}</option>}
        {!allowDefault && !value && <option value="">—</option>}
        {value &&
          !SUPPORTED_CURRENCIES.includes(value as (typeof SUPPORTED_CURRENCIES)[number]) && (
            <option value={value}>{value}</option>
          )}
        {SUPPORTED_CURRENCIES.map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </select>
    </label>
  )
}

export function ScopeControls({
  scope,
  onChange,
  accounts,
  categories,
}: ScopedReferences & {
  scope: NormalizedReportScope
  onChange: (scope: NormalizedReportScope) => void
}) {
  const { t } = useTranslation('budgets')
  const id = useId()
  const dimensions = [
    'accountIds',
    'excludeAccountIds',
    'categoryIds',
    'excludeCategoryIds',
  ] as const
  return (
    <details className="border-border min-w-0 rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        {t('scoped.advancedScope')}
      </summary>
      <p className="text-muted-foreground mb-3 text-xs">{t('scoped.scopeHelp')}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {dimensions.map((key) => {
          const isCategory = key === 'categoryIds' || key === 'excludeCategoryIds'
          const options: Array<{ id: string | null; name: string }> = isCategory
            ? [{ id: null, name: t('scoped.uncategorized') }, ...categories]
            : [...accounts]
          for (const selected of scope[key])
            if (!options.some((o) => o.id === selected))
              options.push({ id: selected, name: `${t('scoped.missingReference')}: ${selected}` })
          return (
            <fieldset key={key} className="border-border min-w-0 rounded-lg border p-2">
              <legend className="px-1 text-xs font-medium">{t(`scoped.${key}`)}</legend>
              <div className="max-h-40 overflow-y-auto">
                {options.map((option) => (
                  <label
                    key={option.id ?? '__null'}
                    className="flex min-h-11 items-center gap-2 text-sm [overflow-wrap:anywhere]"
                  >
                    <input
                      type="checkbox"
                      checked={(scope[key] as (string | null)[]).includes(option.id)}
                      onChange={(e) => {
                        const selected = scope[key] as (string | null)[]
                        onChange(
                          normalizeReportScope({
                            ...scope,
                            [key]: e.target.checked
                              ? [...selected, option.id]
                              : selected.filter((value) => value !== option.id),
                          })
                        )
                      }}
                    />
                    {option.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )
        })}
        {(['tags', 'excludeTags'] as const).map((key) => (
          <div key={key} className="grid gap-1 text-sm">
            <label htmlFor={`${id}-${key}`}>{t(`scoped.${key}`)}</label>
            <TagInput
              id={`${id}-${key}`}
              values={scope[key]}
              onChange={(values) => onChange({ ...scope, [key]: values })}
            />
            <span id={`${id}-${key}-help`} className="text-muted-foreground text-xs">
              {t('scoped.tagsHelp')}
            </span>
          </div>
        ))}
      </div>
    </details>
  )
}

export function WindowControls({
  value,
  onChange,
  budget = false,
}: {
  value: ReportWindowInput
  onChange: (value: ReportWindowInput) => void
  budget?: boolean
}) {
  const { t } = useTranslation('budgets')
  const update = (next: Partial<ReportWindowInput>) => onChange({ ...value, ...next })
  return (
    <details className="border-border min-w-0 rounded-lg border p-3">
      <summary className="min-h-11 cursor-pointer text-sm font-medium">
        {t('scoped.window')}
      </summary>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!budget && (
          <label className="grid gap-1 text-sm">
            {t('form.period')}
            <select
              className={scopedSelectClass}
              value={value.period ?? 'month'}
              onChange={(e) =>
                update({
                  period: e.target.value as ReportWindowInput['period'],
                  start: undefined,
                  end: undefined,
                })
              }
            >
              {(['week', 'month', 'year', 'custom'] as const).map((period) => (
                <option key={period} value={period}>
                  {t(`scoped.${period}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="grid min-w-0 gap-1 text-sm">
          {t('scoped.asOf')}
          <Input
            className="min-h-11 min-w-0"
            type="date"
            value={value.asOf ?? ''}
            onChange={(e) => update({ asOf: e.target.value || undefined })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('scoped.through')}
          <select
            className={scopedSelectClass}
            value={value.through ?? 'as_of'}
            onChange={(e) => update({ through: e.target.value as ReportWindowInput['through'] })}
          >
            <option value="as_of">{t('scoped.asOf')}</option>
            <option value="period_end">{t('scoped.periodEnd')}</option>
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('scoped.start')}
          <Input
            className="min-h-11 min-w-0"
            type="date"
            value={value.start ?? ''}
            onChange={(e) => update({ start: e.target.value || undefined })}
          />
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('scoped.end')}
          <Input
            className="min-h-11 min-w-0"
            type="date"
            value={value.end ?? ''}
            onChange={(e) => update({ end: e.target.value || undefined })}
          />
        </label>
        <label className="grid gap-1 text-sm">
          {t('scoped.weekStartsOn')}
          <select
            className={scopedSelectClass}
            value={value.weekStartsOn ?? 0}
            onChange={(e) => update({ weekStartsOn: Number(e.target.value) })}
          >
            {Array.from({ length: 7 }, (_, day) => (
              <option key={day} value={day}>
                {t(`scoped.days.${day as 0 | 1 | 2 | 3 | 4 | 5 | 6}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('scoped.timeZone')}
          <Input
            className="min-h-11 min-w-0"
            value={value.timeZone ?? ''}
            placeholder={Intl.DateTimeFormat().resolvedOptions().timeZone}
            onChange={(e) => update({ timeZone: e.target.value || undefined })}
          />
        </label>
      </div>
      <p className="text-muted-foreground mt-2 text-xs">{t('scoped.windowHelp')}</p>
    </details>
  )
}

function TagInput({
  id,
  values,
  onChange,
}: {
  id: string
  values: string[]
  onChange: (values: string[]) => void
}) {
  const [draft, setDraft] = useState(values.join(', '))
  return (
    <Input
      className="min-h-11 min-w-0"
      id={id}
      aria-describedby={`${id}-help`}
      value={draft}
      onChange={(event) => {
        setDraft(event.target.value)
        onChange(
          event.target.value
            .split(',')
            .map((v) => v.trim())
            .filter(Boolean)
        )
      }}
    />
  )
}
