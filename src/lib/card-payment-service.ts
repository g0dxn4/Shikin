import {
  assertPaymentLinkCapacity,
  assertStatementPaymentEquation,
  planStatementBaselinePayment,
  planStatementPaymentLink,
  planStatementPaymentUnlink,
  planStatementTotalsEdit,
  resolvePaymentEvidence,
  type ActivePaymentLink,
  type PaymentAccount,
  type PaymentEvidence,
  type PaymentTransaction,
  type StatementPaymentLinkMode,
  type StatementPaymentState,
} from '@shikin/finance-core/payments'
import type { ConsumptionClassification, CorrectionSplit } from '@shikin/finance-core/corrections'
import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'

export type CardStatementStatus = 'open' | 'partial' | 'paid' | 'overdue'

export interface CardStatement {
  id: string
  accountId: string
  statementStartDate: string | null
  statementEndDate: string
  dueDate: string
  statementBalance: number
  minimumPayment: number
  paidAmount: number
  unattributedPaidAmount: number
  linkedPaidAmount: number
  currency: string
  status: CardStatementStatus
  source: string | null
  note: string | null
  createdAt: string | null
  updatedAt: string | null
  legacyOverpaid: boolean
  activeLinks: CardPaymentLink[]
}

export interface CardPaymentLink {
  id: string
  statementId: string | null
  transactionId: string | null
  originalStatementId: string
  originalTransactionId: string
  amount: number
  mode: StatementPaymentLinkMode
  source: string | null
  note: string | null
  createdAt: string
  voidedAt: string | null
  transactionDescription: string | null
  transactionDate: string | null
  transactionType: string | null
}

export interface CardPaymentSource {
  id: string
  name: string
  currency: string
  balance: number
}

export interface EligibleCardPayment {
  transactionId: string
  canonicalTransactionId: string
  description: string
  date: string
  amount: number
  currency: string
  shape: 'canonical_transfer' | 'ordinary_card_income' | 'ordinary_bank_expense'
  requiresExplicitConfirmation: boolean
  eligibleCapacity: number
  activeLinkedAmount: number
  remainingCapacity: number
}

export interface StatementDraft {
  statementStartDate?: string | null
  statementEndDate: string
  dueDate: string
  statementBalance: number
  minimumPayment: number
  paidAmount: number
  source?: string | null
  note?: string | null
}

export interface StatementUpdate {
  statementStartDate?: string | null
  statementEndDate?: string
  dueDate?: string
  statementBalance?: number
  minimumPayment?: number
  paidAmount?: number
  source?: string | null
  note?: string | null
}

export interface MutationPreview<T> {
  revision: number
  operation: string
  before: unknown
  after: T | null
}

export interface LinkPaymentInput {
  statementId: string
  transactionId: string
  amount: number
  mode: StatementPaymentLinkMode
  explicitRepaymentConfirmation: boolean
  source: string
  note: string
}

export interface RecordCardPaymentInput {
  cardAccountId: string
  fromAccountId?: string
  statementId?: string
  amount: number
  date?: string
  description?: string
  source: string
  note: string
  statementOnly?: boolean
}

type StatementRow = {
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
  status: CardStatementStatus
  source: string | null
  note: string | null
  created_at: string | null
  updated_at: string | null
}

type LinkRow = {
  id: string
  statement_id: string | null
  transaction_id: string | null
  original_statement_id: string
  original_transaction_id: string
  amount: number
  mode: StatementPaymentLinkMode
  source: string | null
  note: string | null
  created_at: string
  voided_at: string | null
  transaction_description?: string | null
  transaction_date?: string | null
  transaction_type?: string | null
}

type AccountRow = PaymentAccount & {
  name: string
  balance: number
}

type TransactionDisplayRow = PaymentTransaction & {
  description?: string
  date?: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function now(): string {
  return new Date().toISOString()
}

function assertSafeNonNegative(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} must be a non-negative safe integer amount.`)
}

function assertSafePositive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${label} must be a positive safe integer amount.`)
}

function assertAudit(source: string, note: string): void {
  if (!source.trim() || !note.trim())
    throw new Error('An audit source and note are required for this payment action.')
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))
    throw new Error(`${label} must be an ISO date.`)
}

function assertStatementDates(start: string | null, end: string, due: string): void {
  if (start && start > end) throw new Error('Statement start date must not follow its end date.')
  if (due < end) throw new Error('Statement due date must not precede its end date.')
}

function coreStatement(row: StatementRow): StatementPaymentState {
  return {
    statementBalance: row.statement_balance,
    paidAmount: row.paid_amount,
    unattributedPaidAmount: row.unattributed_paid_amount,
    dueDate: row.due_date,
    status: row.status,
  }
}

function linkPublic(row: LinkRow): CardPaymentLink {
  return {
    id: row.id,
    statementId: row.statement_id,
    transactionId: row.transaction_id,
    originalStatementId: row.original_statement_id,
    originalTransactionId: row.original_transaction_id,
    amount: row.amount,
    mode: row.mode,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    transactionDescription: row.transaction_description ?? null,
    transactionDate: row.transaction_date ?? null,
    transactionType: row.transaction_type ?? null,
  }
}

function statementPublic(row: StatementRow, links: LinkRow[]): CardStatement {
  const activeLinks = links.filter((link) => !link.voided_at)
  const linkedPaidAmount = activeLinks.reduce((total, link) => total + link.amount, 0)
  assertStatementPaymentEquation(coreStatement(row), linkedPaidAmount)
  return {
    id: row.id,
    accountId: row.account_id,
    statementStartDate: row.statement_start_date,
    statementEndDate: row.statement_end_date,
    dueDate: row.due_date,
    statementBalance: row.statement_balance,
    minimumPayment: row.minimum_payment,
    paidAmount: row.paid_amount,
    unattributedPaidAmount: row.unattributed_paid_amount,
    linkedPaidAmount,
    currency: row.currency,
    status: row.status,
    source: row.source,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    legacyOverpaid: row.paid_amount > row.statement_balance,
    activeLinks: activeLinks.map(linkPublic),
  }
}

async function revision(tx: TransactionClient): Promise<number> {
  return (
    (
      await tx.query<{ data_revision: number }>(
        'SELECT data_revision FROM app_data_state WHERE id = 1'
      )
    )[0]?.data_revision ?? 0
  )
}

async function assertRevision(tx: TransactionClient, expected: number): Promise<void> {
  if ((await revision(tx)) !== expected)
    throw new Error('Payment data changed after preview. Refresh and review the updated plan.')
}

async function writeAudit(
  tx: TransactionClient,
  entity: string,
  entityId: string,
  action: string,
  before: unknown,
  after: unknown,
  source: string | null,
  note: string | null
): Promise<void> {
  await tx.execute(
    `INSERT INTO audit_log
       (id, entity, entity_id, action, before_json, after_json, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      entity,
      entityId,
      action,
      JSON.stringify(before),
      JSON.stringify(after),
      source,
      note,
      now(),
    ]
  )
}

async function account(tx: TransactionClient, id: string): Promise<AccountRow> {
  const row = (
    await tx.query<AccountRow>(
      'SELECT id, name, type, currency, balance, account_mode, is_archived FROM accounts WHERE id = ? LIMIT 1',
      [id]
    )
  )[0]
  if (!row) throw new Error('Account not found.')
  return row
}

function assertWritableAccount(row: AccountRow): void {
  if (row.is_archived) throw new Error(`${row.name} is archived.`)
  if ((row.account_mode ?? 'transactional') !== 'transactional')
    throw new Error(`${row.name} is not a transactional account.`)
  if (!row.currency?.trim()) throw new Error(`${row.name} has no valid currency.`)
}

async function statementRow(tx: TransactionClient, id: string): Promise<StatementRow> {
  const row = (
    await tx.query<StatementRow>('SELECT * FROM credit_card_statements WHERE id = ? LIMIT 1', [id])
  )[0]
  if (!row) throw new Error('Card statement not found.')
  return row
}

async function assertStatementOwnerWritable(
  tx: TransactionClient,
  row: StatementRow
): Promise<void> {
  const owner = await account(tx, row.account_id)
  assertWritableAccount(owner)
  if (owner.type !== 'credit_card') throw new Error('Statement account is not a credit card.')
  if (owner.currency?.trim().toUpperCase() !== row.currency.trim().toUpperCase())
    throw new Error('Statement and card currencies do not match.')
}

async function linksForStatement(
  tx: TransactionClient,
  statementId: string,
  status: 'active' | 'voided' | 'all' = 'all'
): Promise<LinkRow[]> {
  const statusSql =
    status === 'active'
      ? 'AND l.voided_at IS NULL'
      : status === 'voided'
        ? 'AND l.voided_at IS NOT NULL'
        : ''
  return tx.query<LinkRow>(
    `SELECT l.*, t.description AS transaction_description, t.date AS transaction_date,
            t.type AS transaction_type
     FROM card_statement_payment_links l
     LEFT JOIN transactions t ON t.id = l.transaction_id
     WHERE (l.statement_id = ? OR l.original_statement_id = ?) ${statusSql}
     ORDER BY l.created_at DESC, l.id DESC`,
    [statementId, statementId]
  )
}

async function readEvidence(tx: TransactionClient): Promise<PaymentEvidence> {
  const accounts = await tx.query<PaymentAccount>(
    'SELECT id, type, currency, account_mode, is_archived FROM accounts'
  )
  const transactions = await tx.query<PaymentTransaction>('SELECT * FROM transactions')
  const splits = await tx.query<CorrectionSplit>('SELECT * FROM transaction_splits')
  const classifications = await tx.query<ConsumptionClassification>(
    'SELECT * FROM transaction_consumption_classifications'
  )
  const activeLinks = await tx.query<ActivePaymentLink>(
    'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL'
  )
  return { accounts, transactions, splits, classifications, activeLinks }
}

async function applyStatementTransition(
  tx: TransactionClient,
  row: StatementRow,
  after: StatementPaymentState
): Promise<void> {
  const result = await tx.execute(
    `UPDATE credit_card_statements
     SET statement_balance = ?, paid_amount = ?, unattributed_paid_amount = ?, due_date = ?, status = ?,
         updated_at = ?
     WHERE id = ? AND statement_balance = ? AND paid_amount = ? AND unattributed_paid_amount = ?`,
    [
      after.statementBalance,
      after.paidAmount,
      after.unattributedPaidAmount,
      after.dueDate,
      after.status,
      now(),
      row.id,
      row.statement_balance,
      row.paid_amount,
      row.unattributed_paid_amount,
    ]
  )
  if (result.rowsAffected !== 1) throw new Error('Card statement changed. Refresh and retry.')
}

export async function listCardStatements(accountId: string): Promise<CardStatement[]> {
  return withTransaction(async (tx) => {
    const card = await account(tx, accountId)
    if (card.type !== 'credit_card')
      throw new Error('Statements are only available for credit cards.')
    const rows = await tx.query<StatementRow>(
      'SELECT * FROM credit_card_statements WHERE account_id = ? ORDER BY statement_end_date DESC, id DESC',
      [accountId]
    )
    const result: CardStatement[] = []
    for (const row of rows) result.push(statementPublic(row, await linksForStatement(tx, row.id)))
    return result
  })
}

export async function listCardPaymentLinks(
  statementId: string,
  status: 'active' | 'voided' | 'all' = 'all'
): Promise<CardPaymentLink[]> {
  return withTransaction(async (tx) =>
    (await linksForStatement(tx, statementId, status)).map(linkPublic)
  )
}

export async function listCardPaymentSources(cardAccountId: string): Promise<CardPaymentSource[]> {
  return withTransaction(async (tx) => {
    const card = await account(tx, cardAccountId)
    if (card.type !== 'credit_card') throw new Error('Payment destination must be a credit card.')
    const rows = await tx.query<AccountRow>(
      `SELECT id, name, type, currency, balance, account_mode, is_archived
       FROM accounts
       WHERE id <> ? AND type IN ('checking', 'savings', 'cash', 'other') AND is_archived = 0
         AND COALESCE(account_mode, 'transactional') = 'transactional'
       ORDER BY name, id`,
      [cardAccountId]
    )
    return rows
      .filter((row) => row.currency?.trim().toUpperCase() === card.currency?.trim().toUpperCase())
      .map((row) => ({ id: row.id, name: row.name, currency: row.currency!, balance: row.balance }))
  })
}

export async function listEligibleCardPayments(
  cardAccountId: string
): Promise<EligibleCardPayment[]> {
  return withTransaction(async (tx) => {
    const evidence = await readEvidence(tx)
    const displayRows = await tx.query<TransactionDisplayRow>('SELECT * FROM transactions')
    const display = new Map(displayRows.map((row) => [row.id, row]))
    const canonicalSeen = new Set<string>()
    const result: EligibleCardPayment[] = []
    for (const row of evidence.transactions) {
      let resolved
      let requiresExplicitConfirmation = false
      try {
        resolved = resolvePaymentEvidence({
          transactionId: row.id,
          cardAccountId,
          explicitRepaymentConfirmation: false,
          evidence,
        })
      } catch {
        try {
          resolved = resolvePaymentEvidence({
            transactionId: row.id,
            cardAccountId,
            explicitRepaymentConfirmation: true,
            evidence,
          })
          requiresExplicitConfirmation = true
        } catch {
          continue
        }
      }
      if (canonicalSeen.has(resolved.canonicalTransactionId)) continue
      canonicalSeen.add(resolved.canonicalTransactionId)
      const capacity = assertPaymentLinkCapacity({ resolved, activeLinks: evidence.activeLinks })
      if (capacity.remainingCapacity <= 0) continue
      const source = display.get(resolved.canonicalTransactionId) ?? display.get(row.id)
      result.push({
        transactionId: row.id,
        canonicalTransactionId: resolved.canonicalTransactionId,
        description: source?.description ?? 'Recorded payment',
        date: source?.date ?? '',
        amount: resolved.amount,
        currency: resolved.currency,
        shape: resolved.shape,
        requiresExplicitConfirmation,
        eligibleCapacity: resolved.capacity,
        activeLinkedAmount: capacity.activeAmount,
        remainingCapacity: capacity.remainingCapacity,
      })
    }
    return result.sort(
      (a, b) => b.date.localeCompare(a.date) || a.transactionId.localeCompare(b.transactionId)
    )
  })
}

async function buildCreateStatement(
  tx: TransactionClient,
  accountId: string,
  draft: StatementDraft,
  id: string
): Promise<StatementRow> {
  const card = await account(tx, accountId)
  assertWritableAccount(card)
  if (card.type !== 'credit_card') throw new Error('Statement account must be a credit card.')
  assertIsoDate(draft.statementEndDate, 'Statement end date')
  assertIsoDate(draft.dueDate, 'Statement due date')
  if (draft.statementStartDate) assertIsoDate(draft.statementStartDate, 'Statement start date')
  assertStatementDates(draft.statementStartDate ?? null, draft.statementEndDate, draft.dueDate)
  assertSafeNonNegative(draft.statementBalance, 'Statement balance')
  assertSafeNonNegative(draft.minimumPayment, 'Minimum payment')
  assertSafeNonNegative(draft.paidAmount, 'Paid amount')
  if (draft.paidAmount > draft.statementBalance)
    throw new Error('A new statement paid amount cannot exceed its balance.')
  const duplicate = await tx.query<{ id: string }>(
    'SELECT id FROM credit_card_statements WHERE account_id = ? AND statement_end_date = ? LIMIT 1',
    [accountId, draft.statementEndDate]
  )
  if (duplicate.length) throw new Error('A statement already exists for this closing date.')
  const plan = planStatementTotalsEdit({
    statement: {
      statementBalance: draft.statementBalance,
      paidAmount: draft.paidAmount,
      unattributedPaidAmount: draft.paidAmount,
      dueDate: draft.dueDate,
      status: 'open',
    },
    activeLinkedAmount: 0,
    today: today(),
  })
  const timestamp = now()
  return {
    id,
    account_id: accountId,
    statement_start_date: draft.statementStartDate ?? null,
    statement_end_date: draft.statementEndDate,
    due_date: draft.dueDate,
    statement_balance: draft.statementBalance,
    minimum_payment: draft.minimumPayment,
    paid_amount: draft.paidAmount,
    unattributed_paid_amount: draft.paidAmount,
    currency: card.currency!.trim().toUpperCase(),
    status: plan.after.status,
    source: draft.source?.trim() || null,
    note: draft.note?.trim() || null,
    created_at: timestamp,
    updated_at: timestamp,
  }
}

export async function previewCreateCardStatement(
  accountId: string,
  draft: StatementDraft
): Promise<MutationPreview<CardStatement>> {
  return withTransaction(async (tx) => {
    const row = await buildCreateStatement(tx, accountId, draft, generateId())
    return {
      revision: await revision(tx),
      operation: 'create-statement',
      before: null,
      after: statementPublic(row, []),
    }
  })
}

export async function createCardStatement(
  accountId: string,
  draft: StatementDraft,
  expectedRevision: number
): Promise<CardStatement> {
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const row = await buildCreateStatement(tx, accountId, draft, generateId())
    await tx.execute(
      `INSERT INTO credit_card_statements
       (id, account_id, statement_start_date, statement_end_date, due_date, statement_balance,
        minimum_payment, paid_amount, unattributed_paid_amount, currency, status, source, note,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.account_id,
        row.statement_start_date,
        row.statement_end_date,
        row.due_date,
        row.statement_balance,
        row.minimum_payment,
        row.paid_amount,
        row.unattributed_paid_amount,
        row.currency,
        row.status,
        row.source,
        row.note,
        row.created_at,
        row.updated_at,
      ]
    )
    const result = statementPublic(row, [])
    await writeAudit(
      tx,
      'credit_card_statement',
      row.id,
      'create',
      null,
      { statement: result },
      row.source,
      row.note
    )
    return result
  })
}

async function buildUpdateStatement(
  tx: TransactionClient,
  id: string,
  patch: StatementUpdate
): Promise<{ before: CardStatement; row: StatementRow; after: CardStatement }> {
  const row = await statementRow(tx, id)
  await assertStatementOwnerWritable(tx, row)
  const links = await linksForStatement(tx, id)
  const before = statementPublic(row, links)
  const end = patch.statementEndDate ?? row.statement_end_date
  const due = patch.dueDate ?? row.due_date
  const start =
    patch.statementStartDate === undefined ? row.statement_start_date : patch.statementStartDate
  assertIsoDate(end, 'Statement end date')
  assertIsoDate(due, 'Statement due date')
  if (start) assertIsoDate(start, 'Statement start date')
  assertStatementDates(start, end, due)
  if (patch.minimumPayment !== undefined)
    assertSafeNonNegative(patch.minimumPayment, 'Minimum payment')
  if (end !== row.statement_end_date) {
    const duplicate = await tx.query<{ id: string }>(
      'SELECT id FROM credit_card_statements WHERE account_id = ? AND statement_end_date = ? AND id <> ? LIMIT 1',
      [row.account_id, end, id]
    )
    if (duplicate.length) throw new Error('A statement already exists for this closing date.')
  }
  const transition = planStatementTotalsEdit({
    statement: coreStatement(row),
    activeLinkedAmount: before.linkedPaidAmount,
    statementBalance: patch.statementBalance,
    paidAmount: patch.paidAmount,
    dueDate: due,
    today: today(),
  })
  const updated: StatementRow = {
    ...row,
    statement_start_date: start,
    statement_end_date: end,
    due_date: due,
    statement_balance: transition.after.statementBalance,
    minimum_payment: patch.minimumPayment ?? row.minimum_payment,
    paid_amount: transition.after.paidAmount,
    unattributed_paid_amount: transition.after.unattributedPaidAmount,
    status: transition.after.status,
    source: patch.source === undefined ? row.source : patch.source?.trim() || null,
    note: patch.note === undefined ? row.note : patch.note?.trim() || null,
    updated_at: now(),
  }
  return { before, row: updated, after: statementPublic(updated, links) }
}

export async function previewUpdateCardStatement(
  id: string,
  patch: StatementUpdate
): Promise<MutationPreview<CardStatement>> {
  return withTransaction(async (tx) => {
    const plan = await buildUpdateStatement(tx, id, patch)
    return {
      revision: await revision(tx),
      operation: 'update-statement',
      before: plan.before,
      after: plan.after,
    }
  })
}

export async function updateCardStatement(
  id: string,
  patch: StatementUpdate,
  expectedRevision: number
): Promise<CardStatement> {
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const current = await statementRow(tx, id)
    const plan = await buildUpdateStatement(tx, id, patch)
    const result = await tx.execute(
      `UPDATE credit_card_statements
       SET statement_start_date = ?, statement_end_date = ?, due_date = ?, statement_balance = ?,
           minimum_payment = ?, paid_amount = ?, unattributed_paid_amount = ?, status = ?, source = ?,
           note = ?, updated_at = ?
       WHERE id = ? AND updated_at = ? AND paid_amount = ? AND unattributed_paid_amount = ?`,
      [
        plan.row.statement_start_date,
        plan.row.statement_end_date,
        plan.row.due_date,
        plan.row.statement_balance,
        plan.row.minimum_payment,
        plan.row.paid_amount,
        plan.row.unattributed_paid_amount,
        plan.row.status,
        plan.row.source,
        plan.row.note,
        plan.row.updated_at,
        id,
        current.updated_at,
        current.paid_amount,
        current.unattributed_paid_amount,
      ]
    )
    if (result.rowsAffected !== 1) throw new Error('Card statement changed. Refresh and retry.')
    await writeAudit(
      tx,
      'credit_card_statement',
      id,
      'update',
      { statement: plan.before },
      { statement: plan.after },
      plan.row.source,
      plan.row.note
    )
    return plan.after
  })
}

export async function previewDeleteCardStatement(id: string): Promise<MutationPreview<null>> {
  return withTransaction(async (tx) => {
    const row = await statementRow(tx, id)
    await assertStatementOwnerWritable(tx, row)
    const links = await linksForStatement(tx, id)
    const before = statementPublic(row, links)
    if (before.activeLinks.length)
      throw new Error('Unlink active payments before deleting this statement.')
    return { revision: await revision(tx), operation: 'delete-statement', before, after: null }
  })
}

export async function deleteCardStatement(
  id: string,
  expectedRevision: number,
  source: string,
  note: string
): Promise<void> {
  assertAudit(source, note)
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const row = await statementRow(tx, id)
    await assertStatementOwnerWritable(tx, row)
    const links = await linksForStatement(tx, id)
    const before = statementPublic(row, links)
    if (before.activeLinks.length)
      throw new Error('Unlink active payments before deleting this statement.')
    const result = await tx.execute('DELETE FROM credit_card_statements WHERE id = ?', [id])
    if (result.rowsAffected !== 1) throw new Error('Card statement changed. Refresh and retry.')
    await writeAudit(
      tx,
      'credit_card_statement',
      id,
      'delete',
      { statement: before },
      null,
      source.trim(),
      note.trim()
    )
  })
}

async function buildLink(
  tx: TransactionClient,
  input: LinkPaymentInput,
  id: string
): Promise<{
  row: StatementRow
  link: LinkRow
  before: CardStatement
  after: CardStatement
  transition: ReturnType<typeof planStatementPaymentLink>
}> {
  assertSafePositive(input.amount, 'Payment link amount')
  assertAudit(input.source, input.note)
  const row = await statementRow(tx, input.statementId)
  await assertStatementOwnerWritable(tx, row)
  const links = await linksForStatement(tx, row.id)
  const before = statementPublic(row, links)
  const evidence = await readEvidence(tx)
  const resolved = resolvePaymentEvidence({
    transactionId: input.transactionId,
    cardAccountId: row.account_id,
    explicitRepaymentConfirmation: input.explicitRepaymentConfirmation,
    evidence,
  })
  assertPaymentLinkCapacity({
    resolved,
    activeLinks: evidence.activeLinks,
    additionalAmount: input.amount,
  })
  if (resolved.currency !== row.currency.trim().toUpperCase())
    throw new Error('Payment currency does not match the statement currency.')
  const transition = planStatementPaymentLink({
    statement: coreStatement(row),
    activeLinkedAmount: before.linkedPaidAmount,
    amount: input.amount,
    mode: input.mode,
    today: today(),
  })
  const link: LinkRow = {
    id,
    statement_id: row.id,
    transaction_id: resolved.canonicalTransactionId,
    original_statement_id: row.id,
    original_transaction_id: resolved.canonicalTransactionId,
    amount: input.amount,
    mode: input.mode,
    source: input.source.trim(),
    note: input.note.trim(),
    created_at: now(),
    voided_at: null,
  }
  const afterRow = {
    ...row,
    paid_amount: transition.after.paidAmount,
    unattributed_paid_amount: transition.after.unattributedPaidAmount,
    status: transition.after.status,
  }
  return { row, link, before, after: statementPublic(afterRow, [link, ...links]), transition }
}

export async function previewLinkCardPayment(
  input: LinkPaymentInput
): Promise<MutationPreview<CardStatement>> {
  return withTransaction(async (tx) => {
    const plan = await buildLink(tx, input, generateId())
    return {
      revision: await revision(tx),
      operation: 'link-payment',
      before: plan.before,
      after: plan.after,
    }
  })
}

export async function linkCardPayment(
  input: LinkPaymentInput,
  expectedRevision: number
): Promise<CardStatement> {
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const plan = await buildLink(tx, input, generateId())
    await tx.execute(
      `INSERT INTO card_statement_payment_links
       (id, original_statement_id, original_transaction_id, statement_id, transaction_id, amount,
        mode, source, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        plan.link.id,
        plan.link.original_statement_id,
        plan.link.original_transaction_id,
        plan.link.statement_id,
        plan.link.transaction_id,
        plan.link.amount,
        plan.link.mode,
        plan.link.source,
        plan.link.note,
        plan.link.created_at,
      ]
    )
    await applyStatementTransition(tx, plan.row, plan.transition.after)
    await writeAudit(
      tx,
      'card_statement_payment_link',
      plan.link.id,
      'link',
      { link: null, statement: plan.before },
      { link: linkPublic(plan.link), statement: plan.after },
      plan.link.source,
      plan.link.note
    )
    return plan.after
  })
}

async function buildUnlink(tx: TransactionClient, linkId: string) {
  const link = (
    await tx.query<LinkRow>('SELECT * FROM card_statement_payment_links WHERE id = ? LIMIT 1', [
      linkId,
    ])
  )[0]
  if (!link) throw new Error('Payment link not found.')
  if (link.voided_at) throw new Error('Payment link is already voided.')
  if (!link.statement_id || !link.transaction_id)
    throw new Error('Active payment link has missing live evidence.')
  const row = await statementRow(tx, link.statement_id)
  const links = await linksForStatement(tx, row.id)
  const before = statementPublic(row, links)
  const transition = planStatementPaymentUnlink({
    statement: coreStatement(row),
    activeLinkedAmount: before.linkedPaidAmount,
    amount: link.amount,
    mode: link.mode,
    today: today(),
  })
  const afterRow = {
    ...row,
    paid_amount: transition.after.paidAmount,
    unattributed_paid_amount: transition.after.unattributedPaidAmount,
    status: transition.after.status,
  }
  return {
    link,
    row,
    before,
    transition,
    after: statementPublic(
      afterRow,
      links.filter((item) => item.id !== link.id)
    ),
  }
}

export async function previewUnlinkCardPayment(
  linkId: string
): Promise<MutationPreview<CardStatement>> {
  return withTransaction(async (tx) => {
    const plan = await buildUnlink(tx, linkId)
    return {
      revision: await revision(tx),
      operation: 'unlink-payment',
      before: plan.before,
      after: plan.after,
    }
  })
}

export async function unlinkCardPayment(
  linkId: string,
  expectedRevision: number,
  source: string,
  note: string
): Promise<CardStatement> {
  assertAudit(source, note)
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const plan = await buildUnlink(tx, linkId)
    const voidedAt = now()
    const result = await tx.execute(
      'UPDATE card_statement_payment_links SET voided_at = ? WHERE id = ? AND voided_at IS NULL',
      [voidedAt, linkId]
    )
    if (result.rowsAffected !== 1) throw new Error('Payment link changed. Refresh and retry.')
    await applyStatementTransition(tx, plan.row, plan.transition.after)
    await writeAudit(
      tx,
      'card_statement_payment_link',
      linkId,
      'unlink',
      { link: linkPublic(plan.link), statement: plan.before },
      { link: linkPublic({ ...plan.link, voided_at: voidedAt }), statement: plan.after },
      source.trim(),
      note.trim()
    )
    return plan.after
  })
}

async function buildRecordPayment(
  tx: TransactionClient,
  input: RecordCardPaymentInput,
  transactionId: string
) {
  assertSafePositive(input.amount, 'Payment amount')
  assertAudit(input.source, input.note)
  const card = await account(tx, input.cardAccountId)
  assertWritableAccount(card)
  if (card.type !== 'credit_card') throw new Error('Payment destination must be a credit card.')
  const date = input.date ?? today()
  assertIsoDate(date, 'Payment date')
  let row: StatementRow | null = null
  let before: CardStatement | null = null
  let transition: ReturnType<typeof planStatementBaselinePayment> | null = null
  if (input.statementId) {
    row = await statementRow(tx, input.statementId)
    if (row.account_id !== card.id) throw new Error('Statement belongs to another credit card.')
    const links = await linksForStatement(tx, row.id)
    before = statementPublic(row, links)
    transition = input.statementOnly
      ? planStatementBaselinePayment({
          statement: coreStatement(row),
          activeLinkedAmount: before.linkedPaidAmount,
          amount: input.amount,
          today: today(),
        })
      : planStatementPaymentLink({
          statement: coreStatement(row),
          activeLinkedAmount: before.linkedPaidAmount,
          amount: input.amount,
          mode: 'apply_to_unpaid',
          today: today(),
        })
  }
  if (input.statementOnly) {
    if (!row || !before || !transition)
      throw new Error('Statement-only payment requires a statement.')
    return { card, source: null, row, before, transition, date, transactionId }
  }
  if (!input.fromAccountId) throw new Error('A source account is required for a real card payment.')
  const source = await account(tx, input.fromAccountId)
  assertWritableAccount(source)
  if (!['checking', 'savings', 'cash', 'other'].includes(source.type))
    throw new Error('Payment source must be a checking, savings, cash, or other account.')
  if (source.id === card.id) throw new Error('Payment source and destination must differ.')
  if (source.currency?.trim().toUpperCase() !== card.currency?.trim().toUpperCase())
    throw new Error('Payment source and card currencies do not match.')
  if (source.balance < input.amount) throw new Error('Payment source has insufficient funds.')
  if (Math.max(-card.balance, 0) < input.amount)
    throw new Error('Payment exceeds the current card debt.')
  return { card, source, row, before, transition, date, transactionId }
}

export async function previewRecordCardPayment(
  input: RecordCardPaymentInput
): Promise<MutationPreview<Record<string, unknown>>> {
  return withTransaction(async (tx) => {
    const plan = await buildRecordPayment(tx, input, generateId())
    return {
      revision: await revision(tx),
      operation: input.statementOnly ? 'record-statement-payment' : 'record-card-transfer',
      before: {
        statement: plan.before,
        sourceBalance: plan.source?.balance ?? null,
        cardBalance: plan.card.balance,
      },
      after: {
        transactionId: input.statementOnly ? null : plan.transactionId,
        amount: input.amount,
        currency: plan.card.currency,
        sourceBalance: plan.source ? plan.source.balance - input.amount : null,
        cardBalance: input.statementOnly ? plan.card.balance : plan.card.balance + input.amount,
        statementPaidAmount: plan.transition?.after.paidAmount ?? null,
        createsEvidenceLink: Boolean(!input.statementOnly && plan.row),
      },
    }
  })
}

export async function recordCardPayment(
  input: RecordCardPaymentInput,
  expectedRevision: number
): Promise<{ transactionId: string | null; statement: CardStatement | null }> {
  return withTransaction(async (tx) => {
    await assertRevision(tx, expectedRevision)
    const transactionId = generateId()
    const plan = await buildRecordPayment(tx, input, transactionId)
    if (input.statementOnly) {
      await applyStatementTransition(tx, plan.row!, plan.transition!.after)
      const afterRow = {
        ...plan.row!,
        paid_amount: plan.transition!.after.paidAmount,
        unattributed_paid_amount: plan.transition!.after.unattributedPaidAmount,
        status: plan.transition!.after.status,
      }
      const after = statementPublic(afterRow, await linksForStatement(tx, plan.row!.id))
      await writeAudit(
        tx,
        'credit_card_statement',
        plan.row!.id,
        'record-statement-payment',
        { statement: plan.before },
        { statement: after, transaction: null },
        input.source.trim(),
        input.note.trim()
      )
      return { transactionId: null, statement: after }
    }

    const source = plan.source!
    const timestamp = now()
    await tx.execute(
      `INSERT INTO transactions
       (id, account_id, transfer_to_account_id, type, amount, currency, description, notes, date,
        status, ledger_treatment, reporting_treatment, transaction_kind, is_archived, source, note,
        created_at, updated_at)
       VALUES (?, ?, ?, 'transfer', ?, ?, ?, NULL, ?, 'posted', 'normal', 'normal', 'standard', 0, ?, ?, ?, ?)`,
      [
        transactionId,
        source.id,
        plan.card.id,
        input.amount,
        plan.card.currency!.trim().toUpperCase(),
        input.description?.trim() || `Credit card payment: ${plan.card.name}`,
        plan.date,
        input.source.trim(),
        input.note.trim(),
        timestamp,
        timestamp,
      ]
    )
    const sourceUpdate = await tx.execute(
      `UPDATE accounts SET balance = balance - ?, updated_at = ?
       WHERE id = ? AND balance = ? AND is_archived = 0 AND COALESCE(account_mode, 'transactional') = 'transactional'`,
      [input.amount, timestamp, source.id, source.balance]
    )
    const cardUpdate = await tx.execute(
      `UPDATE accounts SET balance = balance + ?, updated_at = ?
       WHERE id = ? AND balance = ? AND is_archived = 0 AND COALESCE(account_mode, 'transactional') = 'transactional'`,
      [input.amount, timestamp, plan.card.id, plan.card.balance]
    )
    if (sourceUpdate.rowsAffected !== 1 || cardUpdate.rowsAffected !== 1)
      throw new Error('An account changed while applying the payment. Refresh and retry.')
    await writeAudit(
      tx,
      'transaction',
      transactionId,
      'create-card-payment',
      null,
      {
        transaction: {
          id: transactionId,
          accountId: source.id,
          transferToAccountId: plan.card.id,
          amount: input.amount,
          currency: plan.card.currency,
          date: plan.date,
        },
        balances: {
          sourceBefore: source.balance,
          sourceAfter: source.balance - input.amount,
          cardBefore: plan.card.balance,
          cardAfter: plan.card.balance + input.amount,
        },
      },
      input.source.trim(),
      input.note.trim()
    )

    let statement: CardStatement | null = null
    if (plan.row && plan.before && plan.transition) {
      const evidence = await readEvidence(tx)
      const resolved = resolvePaymentEvidence({
        transactionId,
        cardAccountId: plan.card.id,
        explicitRepaymentConfirmation: false,
        evidence,
      })
      assertPaymentLinkCapacity({
        resolved,
        activeLinks: evidence.activeLinks,
        additionalAmount: input.amount,
      })
      const link: LinkRow = {
        id: generateId(),
        statement_id: plan.row.id,
        transaction_id: transactionId,
        original_statement_id: plan.row.id,
        original_transaction_id: transactionId,
        amount: input.amount,
        mode: 'apply_to_unpaid',
        source: input.source.trim(),
        note: input.note.trim(),
        created_at: timestamp,
        voided_at: null,
      }
      await tx.execute(
        `INSERT INTO card_statement_payment_links
         (id, original_statement_id, original_transaction_id, statement_id, transaction_id, amount, mode, source, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          link.id,
          link.original_statement_id,
          link.original_transaction_id,
          link.statement_id,
          link.transaction_id,
          link.amount,
          link.mode,
          link.source,
          link.note,
          link.created_at,
        ]
      )
      await applyStatementTransition(tx, plan.row, plan.transition.after)
      const afterRow = {
        ...plan.row,
        paid_amount: plan.transition.after.paidAmount,
        unattributed_paid_amount: plan.transition.after.unattributedPaidAmount,
        status: plan.transition.after.status,
      }
      statement = statementPublic(
        afterRow,
        [link, ...(await linksForStatement(tx, plan.row.id))].filter(
          (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index
        )
      )
      await writeAudit(
        tx,
        'card_statement_payment_link',
        link.id,
        'record-payment',
        { link: null, statement: plan.before },
        { link: linkPublic(link), statement },
        link.source,
        link.note
      )
    }
    return { transactionId, statement }
  })
}
