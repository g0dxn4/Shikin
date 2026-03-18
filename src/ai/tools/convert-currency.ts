import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { fromCentavos, toCentavos } from '@/lib/money'
import { getRate, convertAmount } from '@/lib/exchange-rate-service'

export const convertCurrency = tool({
  description:
    'Convert an amount from one currency to another using live exchange rates. Use this when the user asks to convert between currencies or wants to know the equivalent value in a different currency.',
  inputSchema: zodSchema(
    z.object({
      amount: z.number().describe('The amount to convert (in regular units, e.g. 100.50)'),
      from: z.string().describe('Source currency code (e.g. USD, EUR, GBP)'),
      to: z.string().describe('Target currency code (e.g. MXN, JPY, BRL)'),
    })
  ),
  execute: async ({ amount, from, to }) => {
    const fromUpper = from.toUpperCase()
    const toUpper = to.toUpperCase()

    if (fromUpper === toUpper) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: amount,
        rate: 1,
        message: `${amount} ${fromUpper} = ${amount} ${toUpper} (same currency)`,
      }
    }

    try {
      const rate = await getRate(fromUpper, toUpper)
      const centavos = toCentavos(amount)
      const convertedCentavos = await convertAmount(centavos, fromUpper, toUpper)
      const converted = fromCentavos(convertedCentavos)

      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: Number(converted.toFixed(2)),
        rate: Number(rate.toFixed(6)),
        message: `${amount} ${fromUpper} = ${converted.toFixed(2)} ${toUpper} (rate: ${rate.toFixed(4)})`,
      }
    } catch (err) {
      return {
        amount,
        from: fromUpper,
        to: toUpper,
        convertedAmount: null,
        rate: null,
        message: `Could not convert ${fromUpper} to ${toUpper}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      }
    }
  },
})
