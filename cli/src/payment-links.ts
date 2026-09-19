import {
  assertPaymentLinkCapacity,
  assertStatementPaymentEquation,
  planStatementPaymentLink,
  planStatementPaymentUnlink,
  resolvePaymentEvidence,
  type ActivePaymentLink,
  type PaymentAccount,
  type PaymentEvidence,
  type PaymentTransaction,
  type ResolvedPaymentEvidence,
} from '@shikin/finance-core/payments'
import type { ConsumptionClassification, CorrectionSplit } from '@shikin/finance-core/corrections'
import {
  boundedText,
  dayjs,
  execute,
  fromCentavos,
  generateId,
  positiveMoneyAmount,
  query,
  toCentavos,
  transaction,
  writeAuditLog,
  z,
  type ToolDefinition,
} from './tools/shared.js'

export type PaymentLinkMode = 'apply_to_unpaid' | 'attribute_existing'

type PaymentStatementRow = {
  id: string
  account_id: string
  statement_balance: number
  paid_amount: number
  unattributed_paid_amount: number
  currency: string
  due_date: string
  status: 'open' | 'partial' | 'paid' | 'overdue'
}

type PaymentLinkRow = ActivePaymentLink & {
  original_statement_id: string
  original_transaction_id: string
  statement_id: string | null
  transaction_id: string | null
  mode: PaymentLinkMode
  source: string | null
  note: string | null
  created_at: string
  voided_at: string | null
}

type LinkPlan = {
  link: PaymentLinkRow
  requestedTransactionId: string
  resolved: ResolvedPaymentEvidence
  statementBefore: PaymentStatementRow
  statementAfter: PaymentStatementRow
  canonicalActiveLinkedAmountBefore: number
}

function safeAdd(a: number, b: number, label: string): number {
  const result = a + b
  if (!Number.isSafeInteger(result)) throw new Error(`${label} exceeds safe integer capacity.`)
  return result
}

function coreStatement(statement: PaymentStatementRow) {
  return {
    statementBalance: statement.statement_balance,
    paidAmount: statement.paid_amount,
    unattributedPaidAmount: statement.unattributed_paid_amount,
    dueDate: statement.due_date,
    status: statement.status,
  }
}

function statementPublic(statement: PaymentStatementRow) {
  return {
    id: statement.id,
    accountId: statement.account_id,
    statementBalanceCentavos: statement.statement_balance,
    statementBalance: fromCentavos(statement.statement_balance),
    paidAmountCentavos: statement.paid_amount,
    paidAmount: fromCentavos(statement.paid_amount),
    unattributedPaidAmountCentavos: statement.unattributed_paid_amount,
    unattributedPaidAmount: fromCentavos(statement.unattributed_paid_amount),
    linkedAmountCentavos: statement.paid_amount - statement.unattributed_paid_amount,
    linkedAmount: fromCentavos(statement.paid_amount - statement.unattributed_paid_amount),
    currency: statement.currency,
    status: statement.status,
  }
}

function linkPublic(link: PaymentLinkRow, requestedTransactionId?: string) {
  return {
    id: link.id,
    statementId: link.statement_id,
    transactionId: link.transaction_id,
    originalStatementId: link.original_statement_id,
    originalTransactionId: link.original_transaction_id,
    requestedTransactionId: requestedTransactionId ?? link.original_transaction_id,
    amountCentavos: link.amount,
    amount: fromCentavos(link.amount),
    mode: link.mode,
    source: link.source,
    note: link.note,
    createdAt: link.created_at,
    voidedAt: link.voided_at,
  }
}

function readPaymentEvidence(): PaymentEvidence {
  return {
    accounts: query<PaymentAccount>(
      'SELECT id, type, currency, account_mode, is_archived FROM accounts'
    ),
    transactions: query<PaymentTransaction>('SELECT * FROM transactions'),
    splits: query<CorrectionSplit>('SELECT * FROM transaction_splits'),
    classifications: query<ConsumptionClassification>(
      'SELECT * FROM transaction_consumption_classifications'
    ),
    activeLinks: query<ActivePaymentLink>(
      'SELECT id, transaction_id, amount FROM card_statement_payment_links WHERE voided_at IS NULL'
    ),
  }
}

function readStatement(statementId: string): PaymentStatementRow {
  const statement = query<PaymentStatementRow>(
    'SELECT id, account_id, statement_balance, paid_amount, unattributed_paid_amount, currency, due_date, status FROM credit_card_statements WHERE id = $1 LIMIT 1',
    [statementId]
  )[0]
  if (!statement) throw new Error(`Credit card statement ${statementId} not found.`)
  return statement
}

function activeStatementLinkedAmount(statementId: string): number {
  const links = query<{ amount: number }>(
    'SELECT amount FROM card_statement_payment_links WHERE statement_id = $1 AND voided_at IS NULL',
    [statementId]
  )
  let total = 0
  for (const link of links) total = safeAdd(total, link.amount, 'Statement linked payment total')
  return total
}

function assertStatementEquation(statement: PaymentStatementRow, activeAmount: number): void {
  try {
    assertStatementPaymentEquation(coreStatement(statement), activeAmount)
  } catch (error) {
    throw new Error(
      `Statement ${statement.id} payment evidence is inconsistent; repair it before changing links.`,
      { cause: error }
    )
  }
}

function planLink(input: {
  id: string
  statementId: string
  transactionId: string
  amountCentavos: number
  mode: PaymentLinkMode
  explicitRepaymentConfirmation: boolean
  source?: string
  note?: string
}): LinkPlan {
  if (!Number.isSafeInteger(input.amountCentavos) || input.amountCentavos <= 0)
    throw new Error('Payment link amount must be a positive safe integer.')
  const statement = readStatement(input.statementId)
  const evidence = readPaymentEvidence()
  const activeForStatement = activeStatementLinkedAmount(statement.id)
  assertStatementEquation(statement, activeForStatement)
  const resolved = resolvePaymentEvidence({
    transactionId: input.transactionId,
    cardAccountId: statement.account_id,
    explicitRepaymentConfirmation: input.explicitRepaymentConfirmation,
    evidence,
  })
  const capacity = assertPaymentLinkCapacity({
    resolved,
    activeLinks: evidence.activeLinks,
    additionalAmount: input.amountCentavos,
  })
  const transition = planStatementPaymentLink({
    statement: coreStatement(statement),
    activeLinkedAmount: activeForStatement,
    amount: input.amountCentavos,
    mode: input.mode,
    today: dayjs().format('YYYY-MM-DD'),
  })
  const statementAfter: PaymentStatementRow = {
    ...statement,
    unattributed_paid_amount: transition.after.unattributedPaidAmount,
    paid_amount: transition.after.paidAmount,
    status: transition.after.status,
  }
  const now = dayjs().toISOString()
  return {
    requestedTransactionId: input.transactionId,
    resolved,
    canonicalActiveLinkedAmountBefore: capacity.activeAmount,
    statementBefore: statement,
    statementAfter,
    link: {
      id: input.id,
      original_statement_id: statement.id,
      original_transaction_id: resolved.canonicalTransactionId,
      statement_id: statement.id,
      transaction_id: resolved.canonicalTransactionId,
      amount: input.amountCentavos,
      mode: input.mode,
      source: input.source?.trim() || null,
      note: input.note?.trim() || null,
      created_at: now,
      voided_at: null,
    },
  }
}

function auditLinkPlan(plan: LinkPlan, action: 'link' | 'record-payment') {
  return {
    entity: 'card_statement_payment_link',
    entityId: plan.link.id,
    action,
    before: {
      link: null,
      statement: statementPublic(plan.statementBefore),
    },
    after: {
      link: linkPublic(plan.link, plan.requestedTransactionId),
      statement: statementPublic(plan.statementAfter),
      evidence: {
        shape: plan.resolved.shape,
        requestedTransactionId: plan.requestedTransactionId,
        canonicalTransactionId: plan.resolved.canonicalTransactionId,
        aliasTransactionIds: plan.resolved.aliasTransactionIds,
        eligibleCapacityCentavos: plan.resolved.capacity,
        activeLinkedAmountBeforeCentavos: plan.canonicalActiveLinkedAmountBefore,
        explicitRepaymentConfirmation: plan.resolved.explicitRepaymentConfirmation,
      },
    },
    source: plan.link.source,
    note: plan.link.note,
  }
}

function persistLinkPlan(plan: LinkPlan, action: 'link' | 'record-payment' = 'link') {
  execute(
    `INSERT INTO card_statement_payment_links
       (id, original_statement_id, original_transaction_id, statement_id, transaction_id, amount, mode, source, note, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
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
  const result = execute(
    `UPDATE credit_card_statements
     SET unattributed_paid_amount = $1, paid_amount = $2, status = $3,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $4 AND paid_amount = $5 AND unattributed_paid_amount = $6`,
    [
      plan.statementAfter.unattributed_paid_amount,
      plan.statementAfter.paid_amount,
      plan.statementAfter.status,
      plan.statementAfter.id,
      plan.statementBefore.paid_amount,
      plan.statementBefore.unattributed_paid_amount,
    ]
  )
  if (result.rowsAffected !== 1)
    throw new Error(`Statement ${plan.statementAfter.id} changed; retry the payment link.`)
  const audit = auditLinkPlan(plan, action)
  writeAuditLog(audit)
  return { plan, audit }
}

/** Must be called inside the caller's synchronous SQLite transaction. Revalidates locked state. */
export function applyExistingPaymentLink(input: {
  id?: string
  statementId: string
  transactionId: string
  amountCentavos: number
  mode?: PaymentLinkMode
  explicitRepaymentConfirmation: boolean
  source?: string
  note?: string
  action?: 'link' | 'record-payment'
}) {
  const plan = planLink({
    ...input,
    id: input.id ?? generateId(),
    mode: input.mode ?? 'apply_to_unpaid',
  })
  return persistLinkPlan(plan, input.action ?? 'link')
}

export function previewExistingPaymentLink(input: {
  id?: string
  statementId: string
  transactionId: string
  amountCentavos: number
  mode?: PaymentLinkMode
  explicitRepaymentConfirmation: boolean
  source?: string
  note?: string
}) {
  const plan = planLink({
    ...input,
    id: input.id ?? generateId(),
    mode: input.mode ?? 'apply_to_unpaid',
  })
  return { plan, audit: auditLinkPlan(plan, 'link') }
}

function paymentFailure(error: unknown) {
  return {
    success: false as const,
    reason: 'payment_link_invalid',
    message: error instanceof Error ? error.message : String(error),
  }
}

const linkCardStatementPayment: ToolDefinition = {
  name: 'link-card-statement-payment',
  description:
    'Allocate an existing eligible posted payment transaction to a credit-card statement without creating transactions or changing account balances.',
  schema: z.object({
    statementId: boundedText('Statement ID', 'Credit card statement receiving evidence', 128),
    transactionId: boundedText(
      'Transaction ID',
      'Existing repayment transaction or validated matched alias',
      128
    ),
    amount: positiveMoneyAmount('Amount of the existing payment to allocate'),
    mode: z.enum(['apply_to_unpaid', 'attribute_existing']).optional().default('apply_to_unpaid'),
    confirmRepaymentToCard: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'Required for ordinary card income or bank expense evidence; confirms it repays this specific card'
      ),
    auditSource: z.string().trim().min(1).max(120),
    auditNote: z.string().trim().min(1).max(1000),
    dryRun: z.boolean().optional().default(false),
  }),
  effects: {
    writesTo: [
      'card_statement_payment_links',
      'credit_card_statements',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => {
    const id = generateId()
    const common = {
      id,
      statementId: input.statementId,
      transactionId: input.transactionId,
      amountCentavos: toCentavos(input.amount),
      mode: input.mode as PaymentLinkMode,
      explicitRepaymentConfirmation: input.confirmRepaymentToCard,
      source: input.auditSource,
      note: input.auditNote,
    }
    try {
      if (input.dryRun) {
        const { plan, audit } = previewExistingPaymentLink(common)
        return {
          success: true,
          dryRun: true,
          wouldCreate: linkPublic(plan.link, plan.requestedTransactionId),
          wouldUpdateStatement: {
            before: statementPublic(plan.statementBefore),
            after: statementPublic(plan.statementAfter),
          },
          balanceImpact: { affectsBalances: false, accounts: [], deltas: [] },
          transactionImpact: { creates: [], updates: [], deletes: [] },
          auditPreview: audit,
        }
      }
      const { plan } = transaction(() => applyExistingPaymentLink(common))
      return {
        success: true,
        dryRun: false,
        link: linkPublic(plan.link, plan.requestedTransactionId),
        statement: statementPublic(plan.statementAfter),
        balanceImpact: { affectsBalances: false, accounts: [], deltas: [] },
        transactionImpact: { creates: [], updates: [], deletes: [] },
      }
    } catch (error) {
      return paymentFailure(error)
    }
  },
}

function planUnlink(linkId: string) {
  const link = query<PaymentLinkRow>(
    'SELECT * FROM card_statement_payment_links WHERE id = $1 LIMIT 1',
    [linkId]
  )[0]
  if (!link) throw new Error(`Payment link ${linkId} not found.`)
  if (link.voided_at) throw new Error(`Payment link ${linkId} is already voided.`)
  if (!link.statement_id || !link.transaction_id)
    throw new Error(`Active payment link ${linkId} has missing live references.`)
  const statement = readStatement(link.statement_id)
  const active = activeStatementLinkedAmount(statement.id)
  assertStatementEquation(statement, active)
  const transition = planStatementPaymentUnlink({
    statement: coreStatement(statement),
    activeLinkedAmount: active,
    amount: link.amount,
    mode: link.mode,
    today: dayjs().format('YYYY-MM-DD'),
  })
  const statementAfter: PaymentStatementRow = {
    ...statement,
    unattributed_paid_amount: transition.after.unattributedPaidAmount,
    paid_amount: transition.after.paidAmount,
    status: transition.after.status,
  }
  return { link, statementBefore: statement, statementAfter }
}

const unlinkCardStatementPayment: ToolDefinition = {
  name: 'unlink-card-statement-payment',
  description:
    'Void a statement payment allocation while retaining immutable historical IDs. Does not delete or change its transaction or account balances.',
  schema: z.object({
    linkId: boundedText('Payment link ID', 'Active payment link to void', 128),
    auditSource: z.string().trim().min(1).max(120),
    auditNote: z.string().trim().min(1).max(1000),
    dryRun: z.boolean().optional().default(false),
  }),
  effects: {
    writesTo: [
      'card_statement_payment_links',
      'credit_card_statements',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => {
    try {
      if (input.dryRun) {
        const plan = planUnlink(input.linkId)
        return {
          success: true,
          dryRun: true,
          wouldVoid: linkPublic(plan.link),
          wouldUpdateStatement: {
            before: statementPublic(plan.statementBefore),
            after: statementPublic(plan.statementAfter),
          },
          balanceImpact: { affectsBalances: false, accounts: [], deltas: [] },
          transactionImpact: { creates: [], updates: [], deletes: [] },
        }
      }
      const plan = transaction(() => {
        const current = planUnlink(input.linkId)
        const voidedAt = dayjs().toISOString()
        const updateLink = execute(
          'UPDATE card_statement_payment_links SET voided_at = $1 WHERE id = $2 AND voided_at IS NULL',
          [voidedAt, current.link.id]
        )
        if (updateLink.rowsAffected !== 1)
          throw new Error(`Payment link ${current.link.id} changed; retry unlinking.`)
        const updateStatement = execute(
          `UPDATE credit_card_statements
           SET unattributed_paid_amount = $1, paid_amount = $2, status = $3,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $4 AND paid_amount = $5 AND unattributed_paid_amount = $6`,
          [
            current.statementAfter.unattributed_paid_amount,
            current.statementAfter.paid_amount,
            current.statementAfter.status,
            current.statementAfter.id,
            current.statementBefore.paid_amount,
            current.statementBefore.unattributed_paid_amount,
          ]
        )
        if (updateStatement.rowsAffected !== 1)
          throw new Error(`Statement ${current.statementAfter.id} changed; retry unlinking.`)
        writeAuditLog({
          entity: 'card_statement_payment_link',
          entityId: current.link.id,
          action: 'unlink',
          before: {
            link: linkPublic(current.link),
            statement: statementPublic(current.statementBefore),
          },
          after: {
            link: linkPublic({ ...current.link, voided_at: voidedAt }),
            statement: statementPublic(current.statementAfter),
          },
          source: input.auditSource,
          note: input.auditNote,
        })
        return { ...current, voidedAt }
      })
      return {
        success: true,
        dryRun: false,
        link: linkPublic({ ...plan.link, voided_at: plan.voidedAt }),
        statement: statementPublic(plan.statementAfter),
        balanceImpact: { affectsBalances: false, accounts: [], deltas: [] },
        transactionImpact: { creates: [], updates: [], deletes: [] },
      }
    } catch (error) {
      return paymentFailure(error)
    }
  },
}

const listCardStatementPaymentLinks: ToolDefinition = {
  name: 'list-card-statement-payment-links',
  description:
    'List active or historical credit-card statement payment evidence. This is a read-only operation.',
  schema: z.object({
    statementId: boundedText(
      'Statement ID',
      'Filter by current or original statement ID',
      128
    ).optional(),
    transactionId: boundedText(
      'Transaction ID',
      'Filter by current or original canonical transaction ID',
      128
    ).optional(),
    status: z.enum(['active', 'voided', 'all']).optional().default('active'),
    limit: z.number().int().min(1).max(500).optional().default(100),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) => {
    const filters: string[] = []
    const params: unknown[] = []
    if (input.statementId) {
      params.push(input.statementId, input.statementId)
      filters.push(
        `(statement_id = $${params.length - 1} OR original_statement_id = $${params.length})`
      )
    }
    if (input.transactionId) {
      params.push(input.transactionId, input.transactionId)
      filters.push(
        `(transaction_id = $${params.length - 1} OR original_transaction_id = $${params.length})`
      )
    }
    if (input.status === 'active') filters.push('voided_at IS NULL')
    if (input.status === 'voided') filters.push('voided_at IS NOT NULL')
    params.push(input.limit)
    const links = query<PaymentLinkRow>(
      `SELECT * FROM card_statement_payment_links
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
      params
    )
    return { success: true, links: links.map((link) => linkPublic(link)), count: links.length }
  },
}

export const paymentLinkTools: ToolDefinition[] = [
  linkCardStatementPayment,
  unlinkCardStatementPayment,
  listCardStatementPaymentLinks,
]

/** Revalidate every active link reached through this transaction or its matched alias. */
export function assertActivePaymentCapacity(input: {
  transactionId: string
  transactions?: readonly PaymentTransaction[]
  splits?: readonly CorrectionSplit[]
  classifications?: readonly ConsumptionClassification[]
}): void {
  const current = readPaymentEvidence()
  const currentRow = current.transactions.find((row) => row.id === input.transactionId)
  const canonicalIds = new Set<string>([input.transactionId])
  if (currentRow?.matched_transaction_id) canonicalIds.add(currentRow.matched_transaction_id)
  for (const row of current.transactions) {
    if (row.matched_transaction_id === input.transactionId) canonicalIds.add(row.id)
  }
  const relevant = query<{ transaction_id: string; account_id: string }>(
    `SELECT DISTINCT l.transaction_id, s.account_id
     FROM card_statement_payment_links l
     JOIN credit_card_statements s ON s.id = l.statement_id
     WHERE l.voided_at IS NULL`
  ).filter((item) => canonicalIds.has(item.transaction_id))
  if (!relevant.length) return

  const evidence: PaymentEvidence = {
    ...current,
    transactions: input.transactions ?? current.transactions,
    splits: input.splits ?? current.splits,
    classifications: input.classifications ?? current.classifications,
  }
  for (const item of relevant) {
    try {
      const resolved = resolvePaymentEvidence({
        transactionId: item.transaction_id,
        cardAccountId: item.account_id,
        explicitRepaymentConfirmation: true,
        evidence,
      })
      assertPaymentLinkCapacity({ resolved, activeLinks: evidence.activeLinks })
    } catch (error) {
      throw new Error(
        `Unlink active payments before invalidating their evidence or eligible capacity: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }
}
