import { createHash } from 'node:crypto'
import {
  assertObservationDate,
  assertReconciliationPeriodCovered,
  datedLedgerQuery,
  planDatedReconciliation,
  planReconciliationBridgeSupersession,
  planStatementFinalization,
  projectDatedLedger,
  safeMoney,
  selectReconciliationCoverage,
  selectStagedReconciliationRows,
  type DatedLedgerRow,
} from '@shikin/finance-core/reconciliation'
import {
  z,
  query,
  execute,
  transaction,
  generateId,
  toCentavos,
  fromCentavos,
  dayjs,
  boundedText,
  isoDate,
  moneyAmount,
  resolveAccountId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'

type Account = {
  id: string
  name: string
  currency: string
  balance: number
  account_mode: string
  is_archived: number
}
type Observation = {
  id: string
  account_id: string
  reconciliation_date: string
  actual_balance: number
  adjustment_amount: number
  adjustment_transaction_id: string | null
}
type SelectionRow = DatedLedgerRow & {
  finalization_id: string | null
  reconciliation_id: string | null
  import_source: string | null
  staging_batch_id: string | null
}
type Coverage = {
  id: string
  account_id: string
  source_namespace: string
  period_start: string
  period_end: string
  status: 'verified' | 'provisional' | 'gap'
  zero_rows: number
  document_ref: string | null
  source: string | null
  note: string | null
}
const today = () => dayjs().format('YYYY-MM-DD')
const idSchema = boundedText('ID', 'Exact record ID', 128)
const auditFields = {
  source: boundedText('Source', 'Audit provenance', 120).optional(),
  note: boundedText('Note', 'Audit note', 500).optional(),
}
const accountFields = {
  accountId: idSchema.optional(),
  account: boundedText('Account', 'Account alias, ID or name', 128).optional(),
}
function accountFor(input: { accountId?: string; account?: string }): Account {
  const resolved = resolveAccountId(input.accountId, input.account)
  if (!resolved.success) throw new Error(resolved.message)
  const account = query<Account>('SELECT * FROM accounts WHERE id = ?', [resolved.id])[0]
  if (!account || account.is_archived !== 0) throw new Error('Account missing or archived.')
  return account
}
function ledgerRows(id: string) {
  return query<SelectionRow>(datedLedgerQuery, Array(6).fill(id))
}
function observations(id: string) {
  return query<Observation>(
    'SELECT * FROM account_reconciliations WHERE account_id = ? ORDER BY reconciliation_date, id',
    [id]
  )
}
function one(result: { rowsAffected: number }) {
  if (result.rowsAffected !== 1)
    throw new Error('Concurrent account evidence change; no changes applied.')
}
function context(
  account: Account,
  date: string,
  observed: number,
  rows = ledgerRows(account.id),
  storedBalance = account.balance
) {
  return planDatedReconciliation({
    rows,
    accountId: account.id,
    date,
    today: today(),
    observedBalance: observed,
    storedBalance,
    laterAnchorDates: observations(account.id).map((row) => row.reconciliation_date),
  })
}
export function previewTransactionalAccountBalance(
  accountId: string,
  observedBalance: number,
  date = today()
) {
  return context(accountFor({ accountId }), date, observedBalance)
}
function insertObservation(input: {
  id: string
  account: Account
  date: string
  observed: number
  storedBefore?: number
  before: number
  adjustment: number
  batch?: string | null
  start?: string | null
  end?: string | null
  source?: string | null
  note?: string | null
}) {
  execute(
    `INSERT INTO account_reconciliations (id, account_id, reconciliation_date, actual_balance, stored_balance_before,
    ledger_balance_before, ledger_balance_after, adjustment_amount, staging_batch_id, statement_start_date, statement_end_date, source, note, selection_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'explicit_rows')`,
    [
      input.id,
      input.account.id,
      input.date,
      input.observed,
      input.storedBefore ?? input.account.balance,
      input.before,
      input.observed,
      input.adjustment,
      input.batch ?? null,
      input.start ?? null,
      input.end ?? null,
      input.source ?? null,
      input.note ?? null,
    ]
  )
}
function insertBridge(
  account: Account,
  observationId: string,
  date: string,
  delta: number,
  source?: string | null,
  note?: string | null
) {
  safeMoney(delta)
  if (delta === 0) return null
  const id = generateId()
  execute(
    `INSERT INTO transactions (id, account_id, type, amount, currency, description, status, ledger_treatment,
    reporting_treatment, transaction_kind, reconciliation_id, is_archived, date, source, note)
    VALUES (?, ?, ?, ?, ?, 'Balance reconciliation bridge', 'posted', 'normal', 'exclude_from_cashflow', 'reconciliation_bridge', ?, 0, ?, ?, ?)`,
    [
      id,
      account.id,
      delta > 0 ? 'income' : 'expense',
      Math.abs(delta),
      account.currency,
      observationId,
      date,
      source ?? null,
      note ?? null,
    ]
  )
  one(
    execute('UPDATE account_reconciliations SET adjustment_transaction_id = ? WHERE id = ?', [
      id,
      observationId,
    ])
  )
  return id
}
function snapshot(accountId: string, date: string, balance: number) {
  // Reconciliation history is append-only; never replace an earlier daily snapshot.
  execute(
    'INSERT OR IGNORE INTO account_balance_history (id, account_id, date, balance) VALUES (?, ?, ?, ?)',
    [generateId(), accountId, date, balance]
  )
}

export function reconcileTransactionalAccountBalance(input: {
  accountId: string
  currency: string
  observedBalance: number
  storedBalanceBefore: number
  date?: string
  statementStartDate?: string
  statementEndDate?: string
  source?: string
  note?: string
}) {
  const account = accountFor({ accountId: input.accountId })
  if (account.account_mode !== 'transactional') throw new Error('Transactional account required.')
  const date = input.date ?? today()
  const plan = context(
    account,
    date,
    input.observedBalance,
    ledgerRows(account.id),
    input.storedBalanceBefore
  )
  const reconciliationId = generateId()
  insertObservation({
    id: reconciliationId,
    account,
    date,
    observed: input.observedBalance,
    storedBefore: input.storedBalanceBefore,
    before: plan.asOfLedger,
    adjustment: plan.adjustment,
    start: input.statementStartDate,
    end: input.statementEndDate,
    source: input.source,
    note: input.note,
  })
  const adjustmentTransactionId = insertBridge(
    account,
    reconciliationId,
    date,
    plan.adjustment,
    input.source,
    input.note
  )
  one(
    execute(
      "UPDATE accounts SET balance = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND is_archived = 0",
      [plan.currentBalanceAfter, account.id]
    )
  )
  const after = ledgerRows(account.id)
  if (
    projectDatedLedger(after, account.id, date) !== input.observedBalance ||
    projectDatedLedger(after, account.id) !== plan.currentBalanceAfter
  )
    throw new Error('Reconciliation postcondition failed.')
  snapshot(account.id, date, input.observedBalance)
  const result = {
    reconciliationId,
    adjustmentTransactionId,
    adjustmentCentavos: plan.adjustment,
    verifiedLedgerBalance: fromCentavos(plan.currentBalanceAfter),
    verifiedLedgerBalanceCentavos: plan.currentBalanceAfter,
    ...plan,
  }
  writeAuditLog({
    entity: 'account',
    entityId: account.id,
    action: 'reconcile',
    before: { account, plan },
    after: result,
    source: input.source ?? null,
    note: input.note ?? null,
  })
  return result
}

const reconcile: ToolDefinition = {
  name: 'reconcile',
  description:
    'Preview/apply end-of-day observed balance reconciliation, retaining later activity. Nonzero changes crossing later anchors reject.',
  schema: z.object({
    ...accountFields,
    actualBalance: moneyAmount('Observed end-of-day balance'),
    date: isoDate('Observed date, defaults to today').optional(),
    statementStartDate: isoDate('Printed statement start').optional(),
    statementEndDate: isoDate('Printed statement end').optional(),
    basis: z.literal('effective_ledger').optional(),
    apply: z.boolean().default(false),
    ...auditFields,
  }),
  effects: {
    readOnly: false,
    writesTo: [
      'accounts',
      'transactions',
      'account_reconciliations',
      'account_balance_history',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => {
    const run = () => {
      const account = accountFor(input),
        date = input.date ?? today(),
        observed = toCentavos(input.actualBalance)
      assertObservationDate(date, today())
      if (
        input.statementStartDate &&
        input.statementEndDate &&
        input.statementStartDate > input.statementEndDate
      )
        throw new Error('Invalid statement period.')
      const snapshotOnly = account.account_mode === 'snapshot_only'
      const plan = snapshotOnly
        ? {
            asOfLedger: 0,
            currentLedger: 0,
            adjustment: 0,
            currentBalanceAfter: observed,
            storedVsLedgerDiscrepancy: null,
            storedBalanceEffect: safeMoney(observed - account.balance),
            laterActivityRetained: null,
          }
        : context(account, date, observed)
      const differenceCentavos = snapshotOnly ? plan.storedBalanceEffect : plan.adjustment
      const preview = {
        account: {
          ...account,
          accountMode: account.account_mode ?? 'transactional',
        },
        date,
        ...plan,
        storedBalanceCentavos: account.balance,
        storedBalance: fromCentavos(account.balance),
        ledgerBalanceCentavos: plan.asOfLedger,
        ledgerBalance: fromCentavos(plan.asOfLedger),
        actualBalanceCentavos: observed,
        actualBalance: fromCentavos(observed),
        ledgerDifferenceCentavos: safeMoney(observed - plan.asOfLedger),
        ledgerDifference: fromCentavos(safeMoney(observed - plan.asOfLedger)),
        storedDifferenceCentavos: safeMoney(observed - account.balance),
        storedDifference: fromCentavos(safeMoney(observed - account.balance)),
        differenceCentavos,
        difference: fromCentavos(differenceCentavos),
        requiredBasis: 'effective_ledger',
        statementCoverage: {
          startDate: input.statementStartDate ?? null,
          endDate: input.statementEndDate ?? null,
        },
        applyRequired: differenceCentavos !== 0,
        requiresConfirmation: differenceCentavos !== 0,
        message: snapshotOnly
          ? differenceCentavos === 0
            ? `Account "${account.name}" already records the observed ${account.currency} ${fromCentavos(observed).toFixed(2)} snapshot value.`
            : `Account "${account.name}" needs a ${account.currency} ${fromCentavos(differenceCentavos).toFixed(2)} observed snapshot change. Re-run with --apply.`
          : differenceCentavos === 0
            ? `Account "${account.name}" as-of ledger already matches ${account.currency} ${fromCentavos(observed).toFixed(2)}. Later activity is retained.`
            : `Account "${account.name}" needs a ${account.currency} ${fromCentavos(differenceCentavos).toFixed(2)} as-of reconciliation change. Current stored balance will keep later activity. Re-run with --apply.`,
      }
      if (!input.apply) return { success: true, dryRun: true, applied: false, ...preview }
      if (input.basis !== 'effective_ledger') {
        return {
          success: false,
          ...preview,
          reason: 'reconciliation_basis_required',
          requiredBasis: 'effective_ledger',
          message:
            'Applying reconciliation requires basis="effective_ledger" after reviewing the as-of ledger preview.',
        }
      }
      if (!snapshotOnly) {
        const applied = reconcileTransactionalAccountBalance({
          ...input,
          accountId: account.id,
          currency: account.currency,
          observedBalance: observed,
          storedBalanceBefore: account.balance,
          date,
        })
        return {
          success: true,
          ...preview,
          ...applied,
          dryRun: false,
          applied: true,
          applyRequired: false,
          requiresConfirmation: false,
          message: `Applied reconciliation for account "${account.name}". Later activity was retained.`,
        }
      }
      const reconciliationId = generateId()
      insertObservation({
        id: reconciliationId,
        account,
        date,
        observed,
        before: 0,
        adjustment: 0,
        source: input.source,
        note: input.note,
      })
      one(execute('UPDATE accounts SET balance = ? WHERE id = ?', [observed, account.id]))
      snapshot(account.id, date, observed)
      writeAuditLog({
        entity: 'account',
        entityId: account.id,
        action: 'reconcile',
        before: account,
        after: { ...preview, reconciliationId },
        source: input.source ?? null,
        note: input.note ?? null,
      })
      return {
        success: true,
        ...preview,
        reconciliationId,
        adjustmentTransactionId: null,
        dryRun: false,
        applied: true,
        applyRequired: false,
        requiresConfirmation: false,
        message: `Applied observed snapshot for account "${account.name}". No transaction ledger match is implied.`,
      }
    }
    return transaction(run)
  },
}

const coverageFields = {
  sourceNamespace: boundedText(
    'Source namespace',
    'Case-sensitive import source namespace (not audit source)',
    120
  ),
  periodStart: isoDate('Actual printed period start'),
  periodEnd: isoDate('Actual printed period end'),
  status: z.enum(['verified', 'provisional', 'gap']),
  zeroRows: z.boolean().default(false),
  documentRef: boundedText(
    'Document reference',
    'Independent statement/document evidence; no fake transactions',
    500
  )
    .nullable()
    .optional(),
  source: auditFields.source.nullable(),
  note: auditFields.note.nullable(),
}
const putCoverage: ToolDefinition = {
  name: 'set-source-coverage',
  description:
    'Create or explicitly revise independent printed-period source evidence, including zero-row periods and gaps. Does not finalize transactions.',
  schema: z.object({
    ...accountFields,
    coverageId: idSchema.optional(),
    ...coverageFields,
    dryRun: z.boolean().default(false),
  }),
  effects: {
    readOnly: false,
    writesTo: ['source_coverage', 'audit_log', 'app_data_state'],
  },
  execute: async (input) =>
    transaction(() => {
      const account = accountFor(input)
      if (input.periodStart > input.periodEnd)
        throw new Error('Printed period start must precede end.')
      if (input.zeroRows && input.status === 'gap')
        throw new Error('A gap cannot certify zero rows.')
      const before = input.coverageId
        ? query<Coverage>('SELECT * FROM source_coverage WHERE id = ?', [input.coverageId])[0]
        : null
      if (input.coverageId && (!before || before.account_id !== account.id))
        throw new Error('Coverage not found for account.')
      if (
        before &&
        (before.source_namespace !== input.sourceNamespace ||
          before.period_start !== input.periodStart ||
          before.period_end !== input.periodEnd)
      )
        throw new Error(
          'Coverage identity is immutable; create a new record for a different source or printed period.'
        )
      const id = before?.id ?? generateId()
      const values = [
        input.status,
        input.zeroRows ? 1 : 0,
        input.documentRef === undefined ? (before?.document_ref ?? null) : input.documentRef,
        input.source === undefined ? (before?.source ?? null) : input.source,
        input.note === undefined ? (before?.note ?? null) : input.note,
      ]
      if (input.status !== 'gap' && !values[2] && !values[3] && !values[4])
        throw new Error(
          'Verified/provisional coverage requires document, source or note provenance.'
        )
      if (input.dryRun)
        return { success: true, dryRun: true, coverageId: id, before, wouldSet: input }
      if (before)
        one(
          execute(
            "UPDATE source_coverage SET status = ?, zero_rows = ?, document_ref = ?, source = ?, note = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
            [...values, id]
          )
        )
      else
        execute(
          'INSERT INTO source_coverage (id, account_id, source_namespace, period_start, period_end, status, zero_rows, document_ref, source, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [id, account.id, input.sourceNamespace, input.periodStart, input.periodEnd, ...values]
        )
      const after = query<Coverage>('SELECT * FROM source_coverage WHERE id = ?', [id])[0]
      writeAuditLog({
        entity: 'account',
        entityId: account.id,
        action: 'set-source-coverage',
        before,
        after,
      })
      return { success: true, coverage: after }
    }),
}
const listCoverage: ToolDefinition = {
  name: 'list-source-coverage',
  description:
    'Read independent source coverage. Transaction date extrema are never coverage proof.',
  schema: z.object({
    ...accountFields,
    sourceNamespace: coverageFields.sourceNamespace.optional(),
  }),
  effects: { readOnly: true, writesTo: [] },
  execute: async (input) => {
    const account = input.accountId
      ? query<Account>('SELECT * FROM accounts WHERE id = ?', [input.accountId])[0]
      : accountFor(input)
    if (!account) throw new Error('Account not found.')
    return {
      success: true,
      coverage: query<Coverage>(
        'SELECT * FROM source_coverage WHERE account_id = ?' +
          (input.sourceNamespace ? ' AND source_namespace = ?' : '') +
          ' ORDER BY period_start, id',
        input.sourceNamespace ? [account.id, input.sourceNamespace] : [account.id]
      ),
    }
  },
}

function selectedRows(
  account: Account,
  input: { transactionIds?: string[]; stagingBatchId?: string },
  allowPending = false
) {
  return selectStagedReconciliationRows({
    rows: ledgerRows(account.id),
    accountId: account.id,
    accountCurrency: account.currency,
    accountMode: account.account_mode,
    transactionIds: input.transactionIds,
    stagingBatchId: input.stagingBatchId,
    allowPending,
  })
}
function coverageEvidence(
  account: Account,
  rows: SelectionRow[],
  input: {
    coverageIds?: string[]
    acknowledgeProvisional?: boolean
    provisionalProvenance?: string
  },
  boundary: string,
  verifiedOnly = false
) {
  const coverage = input.coverageIds?.length
    ? query<Coverage>(
        `SELECT * FROM source_coverage WHERE id IN (${input.coverageIds.map(() => '?').join(', ')})`,
        input.coverageIds
      )
    : []
  return selectReconciliationCoverage({
    coverage,
    coverageIds: input.coverageIds,
    accountId: account.id,
    rows,
    boundary,
    verifiedOnly,
    acknowledgeProvisional: input.acknowledgeProvisional,
    provisionalProvenance: input.provisionalProvenance,
  })
}

const selectionFields = {
  transactionIds: z.array(idSchema).min(1).max(10000).optional(),
  stagingBatchId: idSchema.optional(),
}
const evidenceFields = {
  coverageIds: z
    .array(idSchema)
    .min(1)
    .max(1000)
    .describe(
      'Independent coverage IDs from set-source-coverage. Provisional coverage also requires acknowledgeProvisional and provisionalProvenance.'
    ),
  acknowledgeProvisional: z.boolean().default(false),
  provisionalProvenance: boundedText(
    'Provisional provenance',
    'Why incomplete evidence is knowingly accepted',
    1000
  ).optional(),
}
function activate(rows: SelectionRow[], observationId: string) {
  for (const row of rows)
    one(
      execute(
        "UPDATE transactions SET ledger_treatment = 'normal', finalization_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND finalization_id IS NULL AND ledger_treatment = 'staged_no_balance_impact' AND status IN ('posted', 'cleared') AND is_archived = 0",
        [observationId, row.id]
      )
    )
}
const settle: ToolDefinition = {
  name: 'settle-staged-transactions',
  description:
    'Deliberately settle exact pending ordinary staged rows to posted/cleared. Leaves them staged and balance-neutral; preserves financial/source identity.',
  schema: z.object({
    ...accountFields,
    transactionIds: z.array(idSchema).min(1).max(10000),
    status: z.enum(['posted', 'cleared']),
    apply: z.boolean().default(false),
    ...auditFields,
  }),
  effects: {
    readOnly: false,
    writesTo: ['transactions', 'audit_log', 'app_data_state'],
  },
  execute: async (input) =>
    transaction(() => {
      const account = accountFor(input),
        rows = selectedRows(account, input, true)
      if (!input.apply)
        return {
          success: true,
          dryRun: true,
          transactionIds: rows.map((r) => r.id),
          status: input.status,
        }
      for (const row of rows)
        one(
          execute(
            "UPDATE transactions SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ? AND status = 'pending' AND ledger_treatment = 'staged_no_balance_impact'",
            [input.status, row.id]
          )
        )
      writeAuditLog({
        entity: 'account',
        entityId: account.id,
        action: 'settle-staged-transactions',
        before: rows,
        after: { transactionIds: rows.map((r) => r.id), status: input.status },
        source: input.source ?? null,
        note: input.note ?? null,
      })
      return {
        success: true,
        dryRun: false,
        transactionIds: rows.map((r) => r.id),
        ledgerTreatment: 'staged_no_balance_impact',
      }
    }),
}
const finalize: ToolDefinition = {
  name: 'finalize-staged-statement-history',
  description:
    'Finalize exact posted/cleared ordinary staged membership with independent coverage. Batch compatibility selects only posted/cleared rows; pending holds never auto-promote.',
  schema: z.object({
    ...accountFields,
    ...selectionFields,
    ...evidenceFields,
    statementStartDate: isoDate('Declared printed start'),
    statementEndDate: isoDate('Declared printed end'),
    actualBalance: moneyAmount('Observed end-of-day balance'),
    reconciliationDate: isoDate('Defaults to statement end').optional(),
    apply: z.boolean().default(false),
    ...auditFields,
  }),
  effects: {
    readOnly: false,
    writesTo: [
      'accounts',
      'transactions',
      'account_reconciliations',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) =>
    transaction(() => {
      const account = accountFor(input),
        rows = selectedRows(account, input),
        date = input.reconciliationDate ?? input.statementEndDate
      assertObservationDate(date, today())
      if (
        input.statementStartDate > input.statementEndDate ||
        input.statementEndDate > date ||
        rows.some((r) => r.date < input.statementStartDate || r.date > input.statementEndDate)
      )
        throw new Error(
          'Selected rows must be within the declared statement period and observation boundary.'
        )
      const coverage = coverageEvidence(account, rows, input, date)
      assertReconciliationPeriodCovered(
        coverage,
        rows,
        input.statementStartDate,
        input.statementEndDate
      )
      const beforeRows = ledgerRows(account.id)
      const finalization = planStatementFinalization({
        rows: beforeRows,
        selectedRows: rows,
        accountId: account.id,
        accountBalance: account.balance,
        date,
        today: today(),
        observedBalance: toCentavos(input.actualBalance),
        laterAnchorDates: observations(account.id).map((row) => row.reconciliation_date),
      })
      const plan = finalization
      const netChange = finalization.totalEffectiveLedgerChange
      const currentLedgerBefore = finalization.currentLedgerBefore
      const asOfLedgerBefore = finalization.asOfLedgerBefore
      const preview = {
        ...plan,
        account: {
          ...account,
          accountMode: account.account_mode ?? 'transactional',
        },
        asOfLedger: asOfLedgerBefore,
        currentLedger: currentLedgerBefore,
        asOfLedgerAfterSelection: plan.asOfLedgerAfterSelection,
        currentLedgerAfterSelection: plan.currentLedgerAfterSelection,
        stagedBalanceEffectCentavos: plan.stagedBalanceEffect,
        reconciliationBridgeCentavos: plan.adjustment,
        reconciliationBridge: fromCentavos(plan.adjustment),
        totalEffectiveLedgerChangeCentavos: netChange,
        storedVsLedgerDiscrepancy: safeMoney(account.balance - currentLedgerBefore),
        transactionIds: rows.map((r) => r.id),
        transactionCount: rows.length,
        coverage,
        selectionMode: 'explicit_rows',
        reconciliationDate: date,
        statementCoverage: {
          startDate: input.statementStartDate,
          endDate: input.statementEndDate,
        },
        applyRequired: true,
        message: `Dry run: ${rows.length} staged transaction(s) would be finalized with a ${account.currency} ${fromCentavos(plan.adjustment).toFixed(2)} as-of bridge. Later activity is retained.`,
      }
      if (!input.apply) return { success: true, dryRun: true, ...preview }
      const reconciliationId = generateId()
      insertObservation({
        id: reconciliationId,
        account,
        date,
        observed: toCentavos(input.actualBalance),
        before: projectDatedLedger(beforeRows, account.id, date),
        adjustment: plan.adjustment,
        batch: input.stagingBatchId,
        start: input.statementStartDate,
        end: input.statementEndDate,
        source: input.source,
        note: input.note,
      })
      activate(rows, reconciliationId)
      const adjustmentTransactionId = insertBridge(
        account,
        reconciliationId,
        date,
        plan.adjustment,
        input.source,
        input.note
      )
      one(
        execute('UPDATE accounts SET balance = ? WHERE id = ?', [
          plan.currentBalanceAfter,
          account.id,
        ])
      )
      const after = ledgerRows(account.id)
      if (
        projectDatedLedger(after, account.id, date) !== toCentavos(input.actualBalance) ||
        projectDatedLedger(after, account.id) !== plan.currentBalanceAfter
      )
        throw new Error('Finalization postcondition failed.')
      writeAuditLog({
        entity: 'account',
        entityId: account.id,
        action: 'finalize-staged-statement-history',
        before: { account, rows },
        after: {
          ...preview,
          reconciliationId,
          adjustmentTransactionId,
          provisionalProvenance: input.provisionalProvenance ?? null,
        },
        source: input.source ?? null,
        note: input.note ?? null,
      })
      return {
        success: true,
        ...preview,
        reconciliationId,
        adjustmentTransactionId,
        verifiedLedgerBalance: fromCentavos(plan.currentBalanceAfter),
        verifiedLedgerBalanceCentavos: plan.currentBalanceAfter,
        dryRun: false,
        applied: true,
        applyRequired: false,
        requiresConfirmation: false,
        message: `Applied finalization for ${rows.length} staged transaction(s). Later activity was retained.`,
      }
    }),
}

const supersede: ToolDefinition = {
  name: 'supersede-reconciliation-bridge',
  description:
    'Preview a protected bridge replacement; apply requires its exact reviewed token. Preserves original evidence, every later anchor and current stored/effective balances.',
  schema: z.object({
    ...accountFields,
    reconciliationId: idSchema,
    bridgeId: idSchema,
    transactionIds: z.array(idSchema).min(1).max(10000),
    coverageIds: evidenceFields.coverageIds,
    apply: z.boolean().default(false),
    previewToken: z.string().optional(),
    ...auditFields,
  }),
  effects: {
    readOnly: false,
    writesTo: [
      'transactions',
      'account_reconciliations',
      'reconciliation_corrections',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) =>
    transaction(() => {
      const account = accountFor(input),
        all = ledgerRows(account.id),
        anchors = observations(account.id)
      const original = anchors.find((o) => o.id === input.reconciliationId),
        bridge = all.find((r) => r.id === input.bridgeId)
      if (
        !original ||
        !bridge ||
        original.adjustment_transaction_id !== bridge.id ||
        bridge.reconciliation_id !== original.id ||
        bridge.account_id !== account.id ||
        bridge.transaction_kind !== 'reconciliation_bridge' ||
        bridge.is_archived !== 0 ||
        bridge.ledger_treatment !== 'normal' ||
        bridge.reporting_treatment !== 'exclude_from_cashflow' ||
        !['posted', 'cleared'].includes(bridge.status ?? '') ||
        !['income', 'expense'].includes(bridge.type) ||
        bridge.transfer_to_account_id ||
        bridge.matched_transaction_id ||
        bridge.finalization_id ||
        bridge.date !== original.reconciliation_date ||
        bridge.currency !== account.currency ||
        !Number.isSafeInteger(bridge.amount) ||
        bridge.amount <= 0
      )
        throw new Error('Original bridge/observation references or immutable shape are invalid.')
      assertObservationDate(original.reconciliation_date, today())
      if (
        query('SELECT id FROM reconciliation_corrections WHERE original_bridge_id = ?', [bridge.id])
          .length
      )
        throw new Error('Bridge already superseded.')
      const rows = selectedRows(account, input),
        coverage = coverageEvidence(account, rows, input, original.reconciliation_date, true)
      const supersession = planReconciliationBridgeSupersession({
        rows: all,
        selectedRows: rows,
        accountId: account.id,
        accountBalance: account.balance,
        original,
        bridge,
        observations: anchors,
      })
      const B = supersession.originalSignedBridge,
        R = supersession.replacementEffect,
        S = supersession.successorSignedBridge,
        currentEffective = supersession.currentEffective,
        laterAnchors = supersession.laterAnchors
      const state = query<{ database_id: string; data_revision: number }>(
        'SELECT database_id, data_revision FROM app_data_state WHERE id = 1'
      )[0]
      if (!state)
        throw new Error('Database lineage/revision missing; initialize schema before preview.')
      const plan = {
        accountId: account.id,
        original,
        bridge,
        transactionIds: rows.map((r) => r.id),
        rows,
        coverage,
        boundary: original.reconciliation_date,
        originalSignedBridge: B,
        replacementEffect: R,
        successorSignedBridge: S,
        laterAnchors,
        currentStored: account.balance,
        currentEffective,
        storedDiscrepancy: safeMoney(account.balance - currentEffective),
        state,
        source: input.source ?? null,
        note: input.note ?? null,
      }
      const previewToken = createHash('sha256').update(JSON.stringify(plan)).digest('hex')
      if (!input.apply) return { success: true, dryRun: true, previewToken, plan }
      if (!input.previewToken || input.previewToken !== previewToken)
        throw new Error(
          'Missing, changed or stale reviewed previewToken. Preview again; no writes applied.'
        )
      const successorId = generateId()
      // Successor observes the effective boundary, not a fabricated repair of a pre-existing discrepancy.
      const observed = projectDatedLedger(all, account.id, original.reconciliation_date)
      insertObservation({
        id: successorId,
        account,
        date: original.reconciliation_date,
        observed,
        before: safeMoney(safeMoney(observed - B) + R),
        adjustment: S,
        source: input.source,
        note: input.note,
      })
      one(
        execute('UPDATE transactions SET is_archived = 1 WHERE id = ? AND is_archived = 0', [
          bridge.id,
        ])
      )
      activate(rows, successorId)
      const successorBridgeId = insertBridge(
        account,
        successorId,
        original.reconciliation_date,
        S,
        input.source,
        input.note
      )
      const correctionId = generateId()
      execute(
        `INSERT INTO reconciliation_corrections (id, original_reconciliation_id, original_bridge_id, successor_reconciliation_id, successor_bridge_id, replacement_transaction_ids_json, source, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          correctionId,
          original.id,
          bridge.id,
          successorId,
          successorBridgeId,
          JSON.stringify(rows.map((r) => r.id)),
          input.source ?? null,
          input.note ?? null,
        ]
      )
      const after = ledgerRows(account.id),
        storedAfter = accountFor({ accountId: account.id }).balance
      const afterAnchors = laterAnchors.map((o) => ({
        ...o,
        effectiveBalance: projectDatedLedger(after, account.id, o.date),
      }))
      if (
        storedAfter !== account.balance ||
        projectDatedLedger(after, account.id) !== currentEffective ||
        afterAnchors.some((o, i) => o.effectiveBalance !== laterAnchors[i]?.effectiveBalance)
      )
        throw new Error('Supersession postcondition failed; all writes rolled back.')
      const result = {
        correctionId,
        successorReconciliationId: successorId,
        successorBridgeId,
        currentStoredAfter: storedAfter,
        currentEffectiveAfter: projectDatedLedger(after, account.id),
        laterAnchorsAfter: afterAnchors,
      }
      writeAuditLog({
        entity: 'account',
        entityId: account.id,
        action: 'supersede-reconciliation-bridge',
        before: plan,
        after: result,
        source: input.source ?? null,
        note: input.note ?? null,
      })
      return { success: true, dryRun: false, ...result, plan }
    }),
}

export const accountReconciliationTools: ToolDefinition[] = [
  reconcile,
  finalize,
  settle,
  putCoverage,
  listCoverage,
  supersede,
]
