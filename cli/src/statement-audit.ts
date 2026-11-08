import { query, execute, fromCentavos } from './tools/shared.js'
import { paymentAmounts, effectiveStatementStatus, type StatementStatus } from './statement-read.js'
import {
  type AuditLogRow,
  asString,
  asNumber,
  nestedSnapshot,
  parseAuditJson,
} from './audit-read.js'

export type CreditCardStatementRow = {
  id: string
  account_id: string
  statement_start_date: string | null
  statement_end_date: string
  due_date: string
  statement_balance: number
  minimum_payment: number
  paid_amount: number
  unattributed_paid_amount: number
  currency: string
  status: StatementStatus
  source: string | null
  note: string | null
  created_at?: string | null
  updated_at?: string | null
  account_name?: string | null
  account_currency?: string | null
  account_type?: string | null
  account_is_archived?: number | null
}

export function statementSnapshot(statement: CreditCardStatementRow) {
  const payment = paymentAmounts(statement)
  const paymentStatus = effectiveStatementStatus(statement)

  return {
    id: statement.id,
    accountId: statement.account_id,
    accountName: statement.account_name ?? null,
    statementPeriod: {
      startDate: statement.statement_start_date,
      endDate: statement.statement_end_date,
      closingDate: statement.statement_end_date,
    },
    statementStartDate: statement.statement_start_date,
    statementEndDate: statement.statement_end_date,
    closingDate: statement.statement_end_date,
    dueDate: statement.due_date,
    statementBalance: fromCentavos(statement.statement_balance),
    statementBalanceCentavos: statement.statement_balance,
    minimumPayment: fromCentavos(statement.minimum_payment),
    minimumPaymentCentavos: statement.minimum_payment,
    paidAmount: fromCentavos(statement.paid_amount),
    paidAmountCentavos: statement.paid_amount,
    unattributedPaidAmount: fromCentavos(
      statement.unattributed_paid_amount ?? statement.paid_amount
    ),
    unattributedPaidAmountCentavos: statement.unattributed_paid_amount ?? statement.paid_amount,
    linkedPaidAmount: fromCentavos(
      statement.paid_amount - (statement.unattributed_paid_amount ?? statement.paid_amount)
    ),
    linkedPaidAmountCentavos:
      statement.paid_amount - (statement.unattributed_paid_amount ?? statement.paid_amount),
    legacyOverpaid: statement.paid_amount > statement.statement_balance,
    ...payment,
    currency: statement.currency,
    status: statement.status,
    paymentStatus,
    source: statement.source,
    note: statement.note,
    createdAt: statement.created_at ?? null,
    updatedAt: statement.updated_at ?? null,
  }
}

export function statementAuditSnapshot(statement: CreditCardStatementRow) {
  return statementSnapshot(statement)
}

export function paymentLinkStatementAuditSnapshot(statement: CreditCardStatementRow) {
  const baseline = statement.unattributed_paid_amount ?? statement.paid_amount
  return {
    id: statement.id,
    accountId: statement.account_id,
    statementBalanceCentavos: statement.statement_balance,
    statementBalance: fromCentavos(statement.statement_balance),
    paidAmountCentavos: statement.paid_amount,
    paidAmount: fromCentavos(statement.paid_amount),
    unattributedPaidAmountCentavos: baseline,
    unattributedPaidAmount: fromCentavos(baseline),
    linkedAmountCentavos: statement.paid_amount - baseline,
    linkedAmount: fromCentavos(statement.paid_amount - baseline),
    currency: statement.currency,
    status: statement.status,
  }
}

export type UndoStatementSnapshot = {
  id: string
  accountId: string
  statementStartDate: string | null
  statementEndDate: string
  dueDate: string
  statementBalanceCentavos: number
  minimumPaymentCentavos: number
  paidAmountCentavos: number
  unattributedPaidAmountCentavos: number
  currency: string
  status: 'open' | 'partial' | 'paid' | 'overdue'
  source: string | null
  note: string | null
}

function normalizeUndoStatementStatus(value: unknown): UndoStatementSnapshot['status'] {
  return value === 'open' || value === 'partial' || value === 'paid' || value === 'overdue'
    ? value
    : 'open'
}

export function statementSnapshotFromAudit(value: unknown): UndoStatementSnapshot | null {
  const statement = nestedSnapshot(value, 'statement')
  if (!statement) return null
  const id = asString(statement.id)
  const accountId = asString(statement.accountId)
  const statementEndDate = asString(statement.statementEndDate)
  const dueDate = asString(statement.dueDate)
  const statementBalanceCentavos = asNumber(statement.statementBalanceCentavos)
  const minimumPaymentCentavos = asNumber(statement.minimumPaymentCentavos)
  const paidAmountCentavos = asNumber(statement.paidAmountCentavos)
  const currency = asString(statement.currency)
  if (
    !id ||
    !accountId ||
    !statementEndDate ||
    !dueDate ||
    statementBalanceCentavos === null ||
    minimumPaymentCentavos === null ||
    paidAmountCentavos === null ||
    !currency
  ) {
    return null
  }

  return {
    id,
    accountId,
    statementStartDate: asString(statement.statementStartDate),
    statementEndDate,
    dueDate,
    statementBalanceCentavos,
    minimumPaymentCentavos,
    paidAmountCentavos,
    unattributedPaidAmountCentavos:
      asNumber(statement.unattributedPaidAmountCentavos) ?? paidAmountCentavos,
    currency,
    status: normalizeUndoStatementStatus(statement.status),
    source: asString(statement.source),
    note: asString(statement.note),
  }
}

export function statementSnapshotPublic(statement: UndoStatementSnapshot) {
  return {
    ...statement,
    statementBalance: fromCentavos(statement.statementBalanceCentavos),
    minimumPayment: fromCentavos(statement.minimumPaymentCentavos),
    paidAmount: fromCentavos(statement.paidAmountCentavos),
  }
}

export function insertUndoStatement(statement: UndoStatementSnapshot) {
  execute(
    `INSERT INTO credit_card_statements (id, account_id, statement_start_date, statement_end_date, due_date, statement_balance, minimum_payment, paid_amount, unattributed_paid_amount, currency, status, source, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      statement.id,
      statement.accountId,
      statement.statementStartDate,
      statement.statementEndDate,
      statement.dueDate,
      statement.statementBalanceCentavos,
      statement.minimumPaymentCentavos,
      statement.paidAmountCentavos,
      statement.unattributedPaidAmountCentavos,
      statement.currency,
      statement.status,
      statement.source,
      statement.note,
    ]
  )
}

export function updateUndoStatement(statement: UndoStatementSnapshot) {
  const result = execute(
    `UPDATE credit_card_statements
     SET account_id = $1, statement_start_date = $2, statement_end_date = $3, due_date = $4,
         statement_balance = $5, minimum_payment = $6, paid_amount = $7,
         unattributed_paid_amount = $8, currency = $9, status = $10, source = $11, note = $12,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $13`,
    [
      statement.accountId,
      statement.statementStartDate,
      statement.statementEndDate,
      statement.dueDate,
      statement.statementBalanceCentavos,
      statement.minimumPaymentCentavos,
      statement.paidAmountCentavos,
      statement.unattributedPaidAmountCentavos,
      statement.currency,
      statement.status,
      statement.source,
      statement.note,
      statement.id,
    ]
  )
  if (result.rowsAffected !== 1) {
    throw new Error(`Credit-card statement ${statement.id} could not be restored safely.`)
  }
}

export function deleteUndoStatement(statementId: string) {
  const result = execute('DELETE FROM credit_card_statements WHERE id = $1', [statementId])
  if (result.rowsAffected !== 1) {
    throw new Error(`Credit-card statement ${statementId} could not be deleted safely.`)
  }
}

export function assertCurrentStatementUndoState(
  entry: AuditLogRow,
  plan: { entityId: string; inverseAction: 'create' | 'update' | 'delete' }
) {
  const current = (query<Record<string, unknown>>(
    'SELECT * FROM credit_card_statements WHERE id = $1 LIMIT 1',
    [plan.entityId]
  ) ?? [])[0]
  if (plan.inverseAction === 'create') {
    if (current) throw new Error(`Statement ${plan.entityId} was recreated after this audit entry.`)
    return
  }
  if (!current) throw new Error(`Statement ${plan.entityId} no longer exists.`)
  if (
    query(
      'SELECT id FROM card_statement_payment_links WHERE statement_id = $1 AND voided_at IS NULL LIMIT 1',
      [plan.entityId]
    ).length
  ) {
    throw new Error('Unlink active payments before undoing statement history.')
  }
  const expectedCurrent = statementSnapshotFromAudit(parseAuditJson(entry.after_json))
  if (
    !expectedCurrent ||
    current.account_id !== expectedCurrent.accountId ||
    (current.statement_start_date ?? null) !== expectedCurrent.statementStartDate ||
    current.statement_end_date !== expectedCurrent.statementEndDate ||
    current.due_date !== expectedCurrent.dueDate ||
    current.statement_balance !== expectedCurrent.statementBalanceCentavos ||
    current.minimum_payment !== expectedCurrent.minimumPaymentCentavos ||
    current.paid_amount !== expectedCurrent.paidAmountCentavos ||
    (current.unattributed_paid_amount ?? current.paid_amount) !==
      expectedCurrent.unattributedPaidAmountCentavos ||
    current.currency !== expectedCurrent.currency ||
    current.status !== expectedCurrent.status ||
    (current.source ?? null) !== expectedCurrent.source ||
    (current.note ?? null) !== expectedCurrent.note
  ) {
    throw new Error(
      `Statement ${plan.entityId} changed after audit entry ${entry.id}; refresh the undo preview.`
    )
  }
}
