import { tool, zodSchema } from 'ai'
import { z } from 'zod'
import { detectAnomalies } from '@/lib/anomaly-service'

export const getSpendingAnomalies = tool({
  description:
    'Detect and return spending anomalies such as unusual charges, duplicate transactions, spending spikes, subscription price changes, and large transactions. Use this when the user asks about unusual spending, alerts, or potential issues with their finances.',
  inputSchema: zodSchema(
    z.object({
      largeTransactionThreshold: z
        .number()
        .optional()
        .default(500)
        .describe('Dollar threshold for flagging large transactions (default $500)'),
    })
  ),
  execute: async ({ largeTransactionThreshold }) => {
    const anomalies = await detectAnomalies({ largeTransactionThreshold })
    const active = anomalies.filter((a) => !a.dismissed)

    const bySeverity = {
      high: active.filter((a) => a.severity === 'high').length,
      medium: active.filter((a) => a.severity === 'medium').length,
      low: active.filter((a) => a.severity === 'low').length,
    }

    return {
      totalAnomalies: active.length,
      bySeverity,
      anomalies: active.map((a) => ({
        type: a.type,
        severity: a.severity,
        title: a.title,
        description: a.description,
        amount: a.amount,
        transactionId: a.transaction_id,
        detectedAt: a.detected_at,
      })),
      message:
        active.length === 0
          ? 'No spending anomalies detected. Everything looks normal.'
          : `Found ${active.length} anomal${active.length === 1 ? 'y' : 'ies'}: ${bySeverity.high} high, ${bySeverity.medium} medium, ${bySeverity.low} low severity.`,
    }
  },
})
