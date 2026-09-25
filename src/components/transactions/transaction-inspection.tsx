import { useTranslation } from 'react-i18next'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/money'
import type { TransactionPageRow } from '@/lib/transaction-query'
import { TransactionFxEvidenceDetails } from './transaction-fx-evidence'
import { LegacyImportIdentityAction } from './legacy-import-identity-dialog'
import {
  isEligibleLegacyImportIdentityRow,
  transactionProtection,
} from './transaction-inspection-eligibility'

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-4 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right break-words">{value}</dd>
    </div>
  )
}

export function TransactionInspection({
  transaction,
  onClassify,
  onIdentityChanged,
  onIdentityClosed,
  onIdentityOpenChange,
  onDelete,
  actionsDisabled,
  dirty,
}: {
  transaction: TransactionPageRow
  onClassify: () => void
  onIdentityChanged: () => void
  onIdentityClosed: () => void
  onIdentityOpenChange: (open: boolean) => void
  onDelete: () => void
  actionsDisabled: boolean
  dirty: boolean
}) {
  const { t } = useTranslation('transactions')
  const { t: tConsumption } = useTranslation('consumption')
  const protection = transactionProtection(transaction)
  const status = transaction.status?.trim()
  return (
    <details className="border-border mt-2 rounded-lg border p-3 text-sm">
      <summary data-transaction-details-summary className="cursor-pointer font-medium">
        {t('detail.details')}
      </summary>
      <p className="mt-3 font-semibold tabular-nums">
        {formatMoney(transaction.amount, transaction.currency)}
      </p>
      <dl className="border-border mt-3 divide-y border-y">
        <DetailItem label={t('filters.type')} value={t(`types.${transaction.type}`)} />
        <DetailItem
          label={t('ledger.date')}
          value={dayjs(transaction.date).format('MMMM D, YYYY')}
        />
        <DetailItem
          label={t('ledger.account')}
          value={
            transaction.type === 'transfer'
              ? `${transaction.account_name ?? '—'} → ${transaction.transfer_to_account_name ?? '—'}`
              : (transaction.account_name ?? '—')
          }
        />
        <DetailItem
          label={t('ledger.category')}
          value={transaction.has_splits ? t('split.badge') : (transaction.category_name ?? '—')}
        />
        <DetailItem
          label={t('ledger.status')}
          value={t(`status.${status === 'pending' || status === 'cleared' ? status : 'posted'}`)}
        />
        <DetailItem
          label={t('ledger.source')}
          value={transaction.source ?? transaction.import_source ?? 'manual'}
        />
        <DetailItem
          label={t('detail.notes')}
          value={transaction.notes ?? transaction.note ?? '—'}
        />
        <DetailItem label={t('detail.reference')} value={transaction.id} />
      </dl>
      <TransactionFxEvidenceDetails transactionId={transaction.id} />
      {protection && (
        <p className="border-warning/30 bg-warning/10 mt-3 rounded-lg border p-3 text-xs">
          {t(protection)}
        </p>
      )}
      {dirty && (
        <p className="text-muted-foreground mt-3 text-xs" role="status">
          {t('dialog.saveOrDiscard')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {(transaction.type === 'expense' || transaction.type === 'income') && !protection && (
          <Button type="button" variant="outline" disabled={actionsDisabled} onClick={onClassify}>
            {tConsumption('actions.classify')}
          </Button>
        )}
        {isEligibleLegacyImportIdentityRow(transaction) && !protection && (
          <div
            className={actionsDisabled ? 'pointer-events-none opacity-50' : ''}
            aria-disabled={actionsDisabled}
          >
            <LegacyImportIdentityAction
              transactionId={transaction.id}
              onChanged={onIdentityChanged}
              onClosed={onIdentityClosed}
              onActionOpenChange={onIdentityOpenChange}
              disabled={actionsDisabled}
            />
          </div>
        )}
        {!protection && !transaction.is_finalized_statement && !transaction.finalization_id && (
          <Button
            type="button"
            variant="outline"
            className="text-destructive"
            disabled={actionsDisabled}
            onClick={onDelete}
          >
            {t('deleteTransaction')}
          </Button>
        )}
      </div>
    </details>
  )
}
