import {
  assertReceivablePaymentState,
  planReceivablePayment,
  planReceivablePaymentReversal,
  type ReceivableIncomeEvidence,
  type ReceivablePaymentLink,
  type ReceivablePaymentState,
} from '@shikin/finance-core/receivable-payments'
import { importPlanToken } from '@shikin/finance-core/imports'
import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'

type ReceivableRow = ReceivablePaymentState & { payer: string; updated_at: string }

async function context(tx: TransactionClient, receivableId: string) {
  const receivable = (
    await tx.query<ReceivableRow>('SELECT * FROM receivables WHERE id = ?', [receivableId])
  )[0]
  if (!receivable) throw new Error('Receivable not found.')
  const payments = await tx.query<ReceivablePaymentLink>(
    'SELECT * FROM receivable_payment_links WHERE receivable_id = ? ORDER BY created_at, id',
    [receivableId]
  )
  const summary = assertReceivablePaymentState(receivable, payments)
  return { receivable, payments, summary }
}

const evidenceSelect = `SELECT t.*, a.account_mode, a.is_archived AS account_is_archived,
  EXISTS (SELECT 1 FROM card_statement_payment_links p WHERE p.transaction_id = t.id AND p.voided_at IS NULL) AS is_card_payment,
  EXISTS (SELECT 1 FROM transaction_consumption_classifications c WHERE c.transaction_id = t.id AND c.role NOT IN ('earned_income', 'other_income')) AS is_non_income_classification
  FROM transactions t JOIN accounts a ON a.id = t.account_id`

/** A consistent, read-only view. Candidate entries are existing bank income, never forecasts. */
export function readReceivablePayments(receivableId: string) {
  return withTransaction(async (tx) => {
    const current = await context(tx, receivableId)
    const candidates: ReceivableIncomeEvidence[] = []
    if (current.receivable.status === 'open' || current.receivable.status === 'partial') {
      const rows = await tx.query<ReceivableIncomeEvidence>(
        `${evidenceSelect}
          WHERE t.type = 'income' AND t.status IN ('posted', 'cleared')
            AND UPPER(TRIM(t.currency)) = UPPER(TRIM(?)) AND t.amount <= ?
            AND (? IS NULL OR t.account_id = ?)
            AND NOT EXISTS (SELECT 1 FROM receivable_payment_links p WHERE p.transaction_id = t.id AND p.reversed_at IS NULL)
          ORDER BY t.date DESC, t.id DESC LIMIT 200`,
        [
          current.receivable.currency,
          current.summary.remainingAmount,
          current.receivable.account_id,
          current.receivable.account_id,
        ]
      )
      for (const income of rows) {
        try {
          planReceivablePayment({ ...current, income })
          candidates.push(income)
        } catch {
          // Ineligible bank evidence is not offered as a receipt candidate.
        }
      }
    }
    return { ...current, candidates }
  })
}

export type ReceivablePaymentView = Awaited<ReturnType<typeof readReceivablePayments>>

export interface ReceivablePaymentInput {
  receivableId: string
  action: 'match' | 'reverse'
  transactionId?: string
  paymentId?: string
  all?: boolean
  apply?: boolean
  expectedToken?: string
  note?: string
}

/** Frontend adapter uses exactly the same planners and database guards as CLI/MCP. */
export function changeReceivablePayment(input: ReceivablePaymentInput) {
  return withTransaction(async (tx) => {
    const current = await context(tx, input.receivableId)
    const income = input.transactionId
      ? (
          await tx.query<ReceivableIncomeEvidence>(`${evidenceSelect} WHERE t.id = ?`, [
            input.transactionId,
          ])
        )[0]
      : null
    if (input.action === 'match' && !income) throw new Error('Select a received bank transaction.')
    const otherLinks = income
      ? await tx.query<ReceivablePaymentLink>(
          'SELECT * FROM receivable_payment_links WHERE transaction_id = ? AND receivable_id <> ?',
          [income.id, input.receivableId]
        )
      : []
    const plan =
      input.action === 'match'
        ? planReceivablePayment({
            ...current,
            payments: [...current.payments, ...otherLinks],
            income: income!,
          })
        : planReceivablePaymentReversal({ ...current, paymentId: input.paymentId, all: input.all })
    const token = importPlanToken({
      action: input.action,
      receivable: current.receivable,
      payments: current.payments,
      income,
      otherLinks,
      paymentId: input.paymentId ?? null,
      all: input.all ?? false,
    })
    if (input.apply && !plan.replayed && input.expectedToken && token !== input.expectedToken)
      throw new Error('Payment evidence changed. Preview the receipt again before applying it.')
    const preview = { token, changed: !plan.replayed, after: plan.after }
    if (!input.apply || plan.replayed) return preview
    const now = new Date().toISOString()
    let paymentIds: readonly string[]
    if (input.action === 'match') {
      const id = generateId()
      await tx.execute(
        `INSERT INTO receivable_payment_links
          (id, receivable_id, transaction_id, amount, currency, transaction_date,
           transaction_snapshot_json, source, note, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          input.receivableId,
          income!.id,
          income!.amount,
          income!.currency!.trim().toUpperCase(),
          income!.date,
          JSON.stringify(income),
          'frontend',
          input.note ?? null,
          now,
        ]
      )
      paymentIds = [id]
    } else {
      paymentIds = 'paymentIds' in plan ? plan.paymentIds : []
      for (const id of paymentIds) {
        const result = await tx.execute(
          `UPDATE receivable_payment_links SET reversed_at = ?, reversal_source = ?, reversal_note = ?
            WHERE id = ? AND receivable_id = ? AND reversed_at IS NULL`,
          [now, 'frontend', input.note ?? null, id, input.receivableId]
        )
        if (result.rowsAffected !== 1)
          throw new Error('Receipt changed before reversal. Refresh and retry.')
      }
    }
    const saved = await context(tx, input.receivableId)
    await tx.execute(
      `INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
        VALUES (?, 'receivable', ?, ?, ?, ?, 'frontend', ?, ?)`,
      [
        generateId(),
        input.receivableId,
        input.action === 'match' ? 'match' : 'unmatch',
        JSON.stringify(current),
        JSON.stringify({ receivable: saved.receivable, paymentIds }),
        input.note ?? null,
        now,
      ]
    )
    return preview
  })
}

export type ReceivablePaymentPreview = Awaited<ReturnType<typeof changeReceivablePayment>>
