import {
  assertFxCurrency,
  exchangeRateBindings,
  FX_RATE_INSERT,
  FX_RATE_SELECT,
  planExchangeRate,
  type DatedExchangeRate,
  type SetExchangeRateInput,
} from '@shikin/finance-core/fx'
import { execute, query, transaction } from './database.js'
import { writeAuditLog } from './tools/shared.js'
import { generateId } from './ulid.js'

export type CurrencySettings =
  | { configured: false; mainCurrency: null }
  | { configured: true; mainCurrency: string }
export function getCurrencySettings(): CurrencySettings {
  const row = query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'")[0]
  if (!row) return { configured: false, mainCurrency: null }
  assertFxCurrency(row.value)
  return { configured: true, mainCurrency: row.value }
}
export function listExchangeRates(): DatedExchangeRate[] {
  return query<DatedExchangeRate>(FX_RATE_SELECT)
}
/** Explicit configuration only; never promotes a JSON preference or rewrites money. */
export function setMainCurrency(currency: string): CurrencySettings {
  assertFxCurrency(currency)
  return transaction(() => {
    const before = getCurrencySettings()
    const createdAt = new Date().toISOString()
    execute(
      "INSERT INTO settings (key, value, updated_at) VALUES ('main_currency', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [currency, createdAt]
    )
    const after: CurrencySettings = { configured: true, mainCurrency: currency }
    writeAuditLog({
      entity: 'settings',
      entityId: 'main_currency',
      action: 'UPDATE',
      before,
      after,
      source: 'cli',
      createdAt,
    })
    return after
  })
}
/** No update/delete operation: correction appends against a checked current leaf. */
export function setExchangeRate(input: SetExchangeRateInput): DatedExchangeRate {
  return transaction(() => {
    const plan = planExchangeRate(listExchangeRates(), input, {
      id: generateId(),
      createdAt: new Date().toISOString(),
    })
    execute(FX_RATE_INSERT, exchangeRateBindings(plan.rate))
    writeAuditLog({
      entity: 'manual_exchange_rates',
      entityId: plan.rate.id,
      action: 'CREATE',
      before: plan.previous,
      after: {
        ...plan.rate,
        historicalChange: plan.historicalChange,
        historicalReportsRecalculate: Boolean(plan.previous) || plan.historicalChange,
      },
      source: 'cli',
      note: input.auditNote,
      createdAt: plan.rate.createdAt,
    })
    return plan.rate
  })
}
