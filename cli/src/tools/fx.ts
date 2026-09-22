import {
  assertFxCurrency,
  planExchangeRate,
  type DatedExchangeRate,
  type SetExchangeRateInput,
} from '@shikin/finance-core/fx'
import {
  getCurrencySettings,
  listExchangeRates,
  setExchangeRate,
  setMainCurrency,
} from '../fx-service.js'
import {
  boundedText,
  currencyCode,
  dayjs,
  generateId,
  isoDate,
  z,
  type ToolDefinition,
} from './shared.js'

const getCurrencySettingsTool: ToolDefinition = {
  name: 'get-currency-settings',
  description:
    'Read the explicitly configured database-backed main currency. An absent main currency is reported as unconfigured.',
  schema: z.object({}),
  effects: { readOnly: true, writesTo: [] },
  execute: async () => getCurrencySettings(),
}

const setMainCurrencyTool: ToolDefinition = {
  name: 'set-main-currency',
  description:
    'Explicitly save the database-backed main reporting currency. This never relabels accounts, transactions, plans, snapshots, or other records.',
  schema: z.object({
    currency: currencyCode('Supported main currency code'),
    dryRun: z.boolean().default(false),
  }),
  effects: { writesTo: ['settings', 'audit_log', 'app_data_state'] },
  execute: async ({ currency, dryRun }: { currency: string; dryRun: boolean }) => {
    assertFxCurrency(currency)
    const before = getCurrencySettings()
    const after = { configured: true as const, mainCurrency: currency }
    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        before,
        after,
        message: `Would set the main currency to ${currency}. No records would be relabelled.`,
      }
    }

    const settings = setMainCurrency(currency)
    return {
      success: true,
      ...settings,
      message: `Main currency set to ${currency}. Existing records were not relabelled.`,
    }
  },
}

function withHistoryStatus(rates: DatedExchangeRate[]) {
  const supersededIds = new Set(
    rates.flatMap((rate) => (rate.supersedesRateId ? [rate.supersedesRateId] : []))
  )
  return rates.map((rate) => ({
    ...rate,
    direction: `${rate.fromCurrency}->${rate.toCurrency}`,
    status: supersededIds.has(rate.id) ? ('corrected' as const) : ('current' as const),
  }))
}

const listExchangeRatesTool: ToolDefinition = {
  name: 'list-exchange-rates',
  description:
    'List the complete immutable manual direct-rate history, including corrected rows and effective dates.',
  schema: z.object({}),
  effects: { readOnly: true, writesTo: [] },
  execute: async () => {
    const rates = withHistoryStatus(listExchangeRates())
    return { rates, count: rates.length }
  },
}

type SetRateToolInput = Omit<SetExchangeRateInput, 'today'> & { dryRun: boolean }

const setExchangeRateTool: ToolDefinition = {
  name: 'set-exchange-rate',
  description:
    'Append an effective-dated direct manual rate or immutable correction. Backdating and corrections require an audit note and explicit historical-change acknowledgement.',
  schema: z.object({
    fromCurrency: currencyCode('Supported source currency code'),
    toCurrency: currencyCode('Supported target currency code'),
    rateDecimal: z
      .string()
      .trim()
      .min(1, 'Exact decimal rate is required')
      .max(121, 'Exact decimal rate is too long')
      .describe('Positive plain decimal; never exponent notation'),
    effectiveFrom: isoDate('Calendar date when this direct rate starts applying'),
    replacesRateId: boundedText(
      'Replaced rate ID',
      'Current leaf rate ID to correct immutably',
      128
    ).optional(),
    sourceNote: boundedText('Source note', 'Optional source description', 1000).optional(),
    auditNote: boundedText(
      'Audit note',
      'Required reason for a correction or backdated rate',
      1000
    ).optional(),
    acknowledgeHistoricalChange: z.boolean().default(false),
    dryRun: z.boolean().default(false),
  }),
  effects: { writesTo: ['manual_exchange_rates', 'audit_log', 'app_data_state'] },
  execute: async ({ dryRun, ...input }: SetRateToolInput) => {
    const today = dayjs().format('YYYY-MM-DD')
    const trustedInput: SetExchangeRateInput = { ...input, today }

    if (dryRun) {
      const plan = planExchangeRate(listExchangeRates(), trustedInput, {
        id: generateId(),
        createdAt: dayjs().toISOString(),
      })
      return {
        success: true,
        dryRun: true,
        rate: plan.rate,
        previous: plan.previous,
        historicalChange: plan.historicalChange,
        historicalReportsRecalculate: Boolean(plan.previous) || plan.historicalChange,
        message: 'Rate validation passed. No manual rate or audit row was written.',
      }
    }

    const rate = setExchangeRate(trustedInput)
    return {
      success: true,
      rate: {
        ...rate,
        direction: `${rate.fromCurrency}->${rate.toCurrency}`,
        status: 'current',
      },
      message: `Saved direct rate ${rate.fromCurrency}->${rate.toCurrency} effective ${rate.effectiveFrom}.`,
    }
  },
}

export const fxTools: ToolDefinition[] = [
  getCurrencySettingsTool,
  setMainCurrencyTool,
  listExchangeRatesTool,
  setExchangeRateTool,
]
