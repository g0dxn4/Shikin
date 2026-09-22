import {
  FX_RATE_SELECT,
  TRANSACTION_FX_EVIDENCE_INSERT,
  assertTransactionFxAcceptanceGuard,
  buildTransactionFxEvidenceSnapshot,
  resolveTransactionFxPreview,
  transactionFxEvidenceBindings,
  type DatedExchangeRate,
  type TransactionFxAcceptanceGuard,
  type TransactionFxEvidenceSnapshot,
  type TransactionFxLedgerTreatment,
  type TransactionFxPreview,
  type TransactionFxStatus,
  type TransactionFxType,
} from '@shikin/finance-core'
import { query, withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import type { TransactionFxEvidence } from '@/types/database'

export type { TransactionFxAcceptanceGuard, TransactionFxPreview }

export interface TransactionFxPreviewInput {
  inputAmountCentavos: number
  inputCurrency: string
  accountId: string
  transactionDate: string
  transactionType: TransactionFxType
  status?: TransactionFxStatus
  ledgerTreatment?: TransactionFxLedgerTreatment
}

type AccountAuthority = {
  id: string
  currency: string
  is_archived: number
  account_mode?: 'transactional' | 'snapshot_only' | null
}

async function readMainCurrency(tx: TransactionClient): Promise<string | null> {
  const row = (
    await tx.query<{ value: string }>("SELECT value FROM settings WHERE key = 'main_currency'")
  )[0]
  return row?.value ?? null
}

export async function resolveTransactionFxPreviewInTransaction(
  tx: TransactionClient,
  input: TransactionFxPreviewInput,
  suppliedGuard?: TransactionFxAcceptanceGuard | null
): Promise<TransactionFxPreview> {
  const account = (
    await tx.query<AccountAuthority>(
      'SELECT id, currency, is_archived, account_mode FROM accounts WHERE id = ? LIMIT 1',
      [input.accountId]
    )
  )[0]
  if (!account) throw new Error(`Account ${input.accountId} not found.`)
  if (account.is_archived !== 0) throw new Error(`Account ${input.accountId} is archived.`)
  if ((account.account_mode ?? 'transactional') !== 'transactional') {
    throw new Error(`Account ${input.accountId} is snapshot-only.`)
  }

  const mainCurrency = await readMainCurrency(tx)
  const rates = await tx.query<DatedExchangeRate>(FX_RATE_SELECT)
  const preview = resolveTransactionFxPreview({
    inputAmountCentavos: input.inputAmountCentavos,
    inputCurrency: input.inputCurrency,
    accountId: account.id,
    accountCurrency: account.currency,
    mainCurrency,
    transactionDate: input.transactionDate,
    transactionType: input.transactionType,
    status: input.status ?? 'posted',
    ledgerTreatment: input.ledgerTreatment ?? 'normal',
    rates,
  })
  if (suppliedGuard !== undefined) {
    assertTransactionFxAcceptanceGuard(suppliedGuard, preview.acceptanceGuard)
  }
  return preview
}

/** Read-only preview. Acceptance is always re-resolved through the write transaction. */
export function previewTransactionFxInput(
  input: TransactionFxPreviewInput
): Promise<TransactionFxPreview> {
  return withTransaction((tx) => resolveTransactionFxPreviewInTransaction(tx, input))
}

export async function appendTransactionFxEvidence(
  tx: TransactionClient,
  transactionId: string,
  preview: TransactionFxPreview,
  createdAt = new Date().toISOString()
): Promise<TransactionFxEvidenceSnapshot> {
  const evidence = buildTransactionFxEvidenceSnapshot({
    id: generateId(),
    transactionId,
    createdAt,
    preview,
  })
  await tx.execute(TRANSACTION_FX_EVIDENCE_INSERT, transactionFxEvidenceBindings(evidence))
  return evidence
}

export function getLatestTransactionFxEvidence(
  transactionId: string,
  tx?: TransactionClient
): Promise<TransactionFxEvidence | null> {
  const read = tx?.query ?? query
  return read<TransactionFxEvidence>(
    `SELECT * FROM transaction_fx_evidence
     WHERE transaction_id = ? OR original_transaction_id = ?
     ORDER BY created_at DESC, id DESC LIMIT 1`,
    [transactionId, transactionId]
  ).then((rows) => rows[0] ?? null)
}

export function publicTransactionFxEvidence(evidence: TransactionFxEvidence | null) {
  if (!evidence) return null
  return {
    id: evidence.id,
    transactionId: evidence.transaction_id,
    originalTransactionId: evidence.original_transaction_id,
    originalAccountId: evidence.original_account_id,
    transactionType: evidence.transaction_type,
    acceptedStatus: evidence.status,
    ledgerTreatment: evidence.ledger_treatment,
    inputAmountCentavos: evidence.input_amount_centavos,
    inputCurrency: evidence.input_currency,
    accountAmountCentavos: evidence.account_amount_centavos,
    accountCurrency: evidence.account_currency,
    accountBalanceDeltaCentavos: evidence.account_balance_delta_centavos,
    transactionDate: evidence.transaction_date,
    rateId: evidence.rate_id,
    rateDecimal: evidence.rate_decimal,
    direction: `${evidence.input_currency}->${evidence.account_currency}`,
    createdAt: evidence.created_at,
    immutableAcceptanceSnapshot: true,
  }
}
