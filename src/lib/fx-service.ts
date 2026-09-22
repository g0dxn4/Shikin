import {
  assertFxCurrency,
  exchangeRateBindings,
  FX_RATE_INSERT,
  FX_RATE_SELECT,
  planExchangeRate,
  type DatedExchangeRate,
  type SetExchangeRateInput,
} from '@shikin/finance-core/fx'
import { query, withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'

export type CurrencySettings =
  | { configured: false; mainCurrency: null }
  | { configured: true; mainCurrency: string }
async function readSettings(read: TransactionClient['query']): Promise<CurrencySettings> {
  const row = (
    await read<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'")
  )[0]
  if (!row) return { configured: false, mainCurrency: null }
  assertFxCurrency(row.value)
  return { configured: true, mainCurrency: row.value }
}
export function getCurrencySettings(): Promise<CurrencySettings> {
  return readSettings(query)
}
export function listExchangeRates(): Promise<DatedExchangeRate[]> {
  return query<DatedExchangeRate>(FX_RATE_SELECT)
}
async function audit(
  tx: TransactionClient,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  createdAt: string,
  note: string | null = null
): Promise<void> {
  await tx.execute(
    'INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      entity,
      entityId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      'app',
      note,
      createdAt,
    ]
  )
}
/** Explicit configuration only; never promotes a JSON preference or rewrites money. */
export function setMainCurrency(currency: string): Promise<CurrencySettings> {
  assertFxCurrency(currency)
  return withTransaction(async (tx) => {
    const before = await readSettings(tx.query)
    const createdAt = new Date().toISOString()
    await tx.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES ('main_currency', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      [currency, createdAt]
    )
    const after: CurrencySettings = { configured: true, mainCurrency: currency }
    await audit(tx, 'settings', 'main_currency', 'UPDATE', before, after, createdAt)
    return after
  })
}
/** No update/delete operation: correction appends against a checked current leaf. */
export function setExchangeRate(input: SetExchangeRateInput): Promise<DatedExchangeRate> {
  return withTransaction(async (tx) => {
    const plan = planExchangeRate(await tx.query<DatedExchangeRate>(FX_RATE_SELECT), input, {
      id: generateId(),
      createdAt: new Date().toISOString(),
    })
    await tx.execute(FX_RATE_INSERT, exchangeRateBindings(plan.rate))
    await audit(
      tx,
      'manual_exchange_rates',
      plan.rate.id,
      'CREATE',
      plan.previous,
      {
        ...plan.rate,
        historicalChange: plan.historicalChange,
        historicalReportsRecalculate: Boolean(plan.previous) || plan.historicalChange,
      },
      plan.rate.createdAt,
      input.auditNote?.trim() || null
    )
    return plan.rate
  })
}
