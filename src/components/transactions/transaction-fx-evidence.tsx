import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { formatMoney } from '@/lib/money'
import { getLatestTransactionFxEvidence } from '@/lib/transaction-fx'
import type { TransactionFxEvidence } from '@/types/database'

export function TransactionFxEvidenceDetails({ transactionId }: { transactionId: string }) {
  const { t } = useTranslation('transactions')
  const [loaded, setLoaded] = useState<{
    transactionId: string
    evidence: TransactionFxEvidence | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    void getLatestTransactionFxEvidence(transactionId)
      .then((evidence) => {
        if (!cancelled) setLoaded({ transactionId, evidence })
      })
      .catch(() => {
        if (!cancelled) setLoaded({ transactionId, evidence: null })
      })
    return () => {
      cancelled = true
    }
  }, [transactionId])

  const evidence = loaded?.transactionId === transactionId ? loaded.evidence : null
  if (!evidence) return null
  return (
    <section className="border-border bg-muted/25 mt-5 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('fx.evidenceTitle')}</h3>
          <p className="text-muted-foreground mt-1 text-xs">{t('fx.evidenceDescription')}</p>
        </div>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {t('fx.retained')}
        </Badge>
      </div>
      <dl className="divide-border mt-3 divide-y text-xs">
        <EvidenceItem
          label={t('fx.originalInput')}
          value={formatMoney(evidence.input_amount_centavos, evidence.input_currency)}
        />
        <EvidenceItem
          label={t('fx.accountMovement')}
          value={formatMoney(evidence.account_amount_centavos, evidence.account_currency)}
        />
        <EvidenceItem
          label={t('fx.acceptedRate')}
          value={`${evidence.input_currency}->${evidence.account_currency} · ${evidence.rate_decimal}`}
        />
        <EvidenceItem label={t('fx.transactionDate')} value={evidence.transaction_date} />
        <EvidenceItem
          label={t('fx.balanceContribution')}
          value={formatMoney(evidence.account_balance_delta_centavos, evidence.account_currency)}
        />
      </dl>
    </section>
  )
}

function EvidenceItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-words tabular-nums">{value}</dd>
    </div>
  )
}
