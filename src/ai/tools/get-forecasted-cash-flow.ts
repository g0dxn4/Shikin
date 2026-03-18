import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { generateCashFlowForecast } from '@/lib/forecast-service'
import { fromCentavos } from '@/lib/money'
import dayjs from 'dayjs'

export const getForecastedCashFlow = tool({
  description:
    'Get a cash flow forecast showing projected balances, burn rate, and danger dates. Use this when the user asks about future balances, cash flow projections, whether they can afford something, or when they might run low on money.',
  inputSchema: zodSchema(
    z.object({
      days: z
        .number()
        .optional()
        .default(30)
        .describe('Number of days to forecast (default 30, max 90)'),
    })
  ),
  execute: async ({ days }) => {
    const forecastDays = Math.min(Math.max(days, 7), 90)
    const forecast = await generateCashFlowForecast(forecastDays, 0)

    const endPoint = forecast.points[forecast.points.length - 1]

    return {
      currentBalance: fromCentavos(forecast.currentBalance),
      projectedBalanceAtEnd: fromCentavos(endPoint?.projected ?? 0),
      forecastDays,
      endDate: endPoint?.date ?? '',
      dailyBurnRate: fromCentavos(forecast.dailyBurnRate),
      dailyIncome: fromCentavos(forecast.dailyIncome),
      dailyNet: fromCentavos(forecast.dailyIncome - forecast.dailyBurnRate),
      minBalance: {
        date: forecast.minBalance.date,
        amount: fromCentavos(forecast.minBalance.amount),
      },
      dangerDates: forecast.dangerDates.map((d) => ({
        date: d,
        label: dayjs(d).format('MMM D, YYYY'),
      })),
      hasDangerDates: forecast.dangerDates.length > 0,
      message:
        forecast.dangerDates.length > 0
          ? `Warning: Your balance is projected to dip below $0 on ${dayjs(forecast.dangerDates[0]).format('MMM D, YYYY')}. Lowest projected balance: $${fromCentavos(forecast.minBalance.amount).toFixed(2)} on ${dayjs(forecast.minBalance.date).format('MMM D, YYYY')}.`
          : `Your cash flow looks healthy for the next ${forecastDays} days. Projected balance: $${fromCentavos(endPoint?.projected ?? 0).toFixed(2)} by ${dayjs(endPoint?.date).format('MMM D, YYYY')}. Daily burn rate: $${fromCentavos(forecast.dailyBurnRate).toFixed(2)}/day.`,
    }
  },
})
