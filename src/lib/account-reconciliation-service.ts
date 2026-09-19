import {
  assertObservationDate,
  assertReconciliationPeriodCovered,
  datedLedgerQuery,
  planReconciliationBridgeSupersession,
  planStatementFinalization,
  projectDatedLedger,
  safeMoney,
  selectReconciliationCoverage,
  selectStagedReconciliationRows,
  type ReconciliationObservation,
  type ReconciliationSelectionRow,
  type SourceCoverageEvidence,
} from '@shikin/finance-core/reconciliation'
import { query, withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'

export type AccountMaintenanceAccount = {
  id: string
  name: string
  currency: string
  balance: number
  account_mode: string
  is_archived: number
}

export type AccountMaintenanceHistory = {
  account: AccountMaintenanceAccount
  observations: ReconciliationObservation[]
  coverage: SourceCoverageEvidence[]
  transactions: ReconciliationSelectionRow[]
  corrections: Array<{
    id: string
    original_reconciliation_id: string
    original_bridge_id: string
    successor_reconciliation_id: string
    successor_bridge_id: string | null
    replacement_transaction_ids_json: string
    created_at: string
  }>
}

export type CoverageInput = {
  accountId: string
  coverageId?: string
  sourceNamespace: string
  periodStart: string
  periodEnd: string
  status: 'verified' | 'provisional' | 'gap'
  zeroRows?: boolean
  documentRef?: string | null
  source?: string | null
  note?: string | null
}

export type FinalizationInput = {
  accountId: string
  transactionIds?: string[]
  stagingBatchId?: string
  coverageIds: string[]
  acknowledgeProvisional?: boolean
  provisionalProvenance?: string
  statementStartDate: string
  statementEndDate: string
  actualBalanceCentavos: number
  reconciliationDate?: string
  source?: string
  note?: string
}

export type SupersessionInput = {
  accountId: string
  reconciliationId: string
  bridgeId: string
  transactionIds: string[]
  coverageIds: string[]
  source?: string
  note?: string
}

type DataState = { database_id: string; data_revision: number }

type FinalizationPreviewMaterial = {
  account: AccountMaintenanceAccount
  rows: ReconciliationSelectionRow[]
  coverage: SourceCoverageEvidence[]
  beforeRows: ReconciliationSelectionRow[]
  date: string
  plan: ReturnType<typeof planStatementFinalization>
  state: DataState
}

type SupersessionPreviewMaterial = {
  account: AccountMaintenanceAccount
  all: ReconciliationSelectionRow[]
  rows: ReconciliationSelectionRow[]
  coverage: SourceCoverageEvidence[]
  original: ReconciliationObservation
  bridge: ReconciliationSelectionRow
  plan: ReturnType<typeof planReconciliationBridgeSupersession>
  state: DataState
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function assertDate(value: string, label: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
  )
    throw new Error(`${label} must be a valid ISO date.`)
}

async function accountFor(
  tx: Pick<TransactionClient, 'query'>,
  accountId: string,
  allowArchived = false
): Promise<AccountMaintenanceAccount> {
  const account = (
    await tx.query<AccountMaintenanceAccount>('SELECT * FROM accounts WHERE id = ? LIMIT 1', [
      accountId,
    ])
  )[0]
  if (!account || (!allowArchived && account.is_archived !== 0))
    throw new Error('Account missing or archived.')
  return account
}

async function ledgerRows(
  tx: Pick<TransactionClient, 'query'>,
  accountId: string
): Promise<ReconciliationSelectionRow[]> {
  return tx.query<ReconciliationSelectionRow>(datedLedgerQuery, Array(6).fill(accountId))
}

async function observations(
  tx: Pick<TransactionClient, 'query'>,
  accountId: string
): Promise<ReconciliationObservation[]> {
  return tx.query<ReconciliationObservation>(
    'SELECT * FROM account_reconciliations WHERE account_id = ? ORDER BY reconciliation_date, id',
    [accountId]
  )
}

async function coverageRows(
  tx: Pick<TransactionClient, 'query'>,
  accountId: string
): Promise<SourceCoverageEvidence[]> {
  return tx.query<SourceCoverageEvidence>(
    'SELECT * FROM source_coverage WHERE account_id = ? ORDER BY period_start, id',
    [accountId]
  )
}

async function dataState(tx: Pick<TransactionClient, 'query'>): Promise<DataState> {
  const state = (
    await tx.query<DataState>(
      'SELECT database_id, data_revision FROM app_data_state WHERE id = 1 LIMIT 1'
    )
  )[0]
  if (!state) throw new Error('Database lineage/revision missing; initialize schema first.')
  return state
}

async function one(result: Promise<{ rowsAffected: number }>, message: string): Promise<void> {
  if ((await result).rowsAffected !== 1) throw new Error(message)
}

async function audit(
  tx: TransactionClient,
  accountId: string,
  action: string,
  before: unknown,
  after: unknown,
  source?: string | null,
  note?: string | null
): Promise<void> {
  await tx.execute(
    'INSERT INTO audit_log (id, entity, entity_id, action, before_json, after_json, source, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [
      generateId(),
      'account',
      accountId,
      action,
      before === null ? null : JSON.stringify(before),
      JSON.stringify(after),
      source ?? null,
      note ?? null,
    ]
  )
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

async function refreshViews(): Promise<boolean> {
  const results = await Promise.allSettled([
    useAccountStore.getState().fetch(),
    useTransactionStore.getState().fetch(),
  ])
  return results.some((result) => result.status === 'rejected')
}

async function insertObservation(
  tx: TransactionClient,
  input: {
    id: string
    account: AccountMaintenanceAccount
    date: string
    observed: number
    storedBefore: number
    ledgerBefore: number
    adjustment: number
    batch?: string | null
    start?: string | null
    end?: string | null
    source?: string | null
    note?: string | null
  }
): Promise<void> {
  await tx.execute(
    `INSERT INTO account_reconciliations (
       id, account_id, reconciliation_date, actual_balance, stored_balance_before,
       ledger_balance_before, ledger_balance_after, adjustment_amount, staging_batch_id,
       statement_start_date, statement_end_date, source, note, selection_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'explicit_rows')`,
    [
      input.id,
      input.account.id,
      input.date,
      input.observed,
      input.storedBefore,
      input.ledgerBefore,
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

async function insertBridge(
  tx: TransactionClient,
  account: AccountMaintenanceAccount,
  observationId: string,
  date: string,
  delta: number,
  source?: string | null,
  note?: string | null
): Promise<string | null> {
  safeMoney(delta)
  if (delta === 0) return null
  const id = generateId()
  await tx.execute(
    `INSERT INTO transactions (
       id, account_id, type, amount, currency, description, status, ledger_treatment,
       reporting_treatment, transaction_kind, reconciliation_id, is_archived, date, source, note
     ) VALUES (?, ?, ?, ?, ?, 'Balance reconciliation bridge', 'posted', 'normal',
       'exclude_from_cashflow', 'reconciliation_bridge', ?, 0, ?, ?, ?)`,
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
  await one(
    tx.execute('UPDATE account_reconciliations SET adjustment_transaction_id = ? WHERE id = ?', [
      id,
      observationId,
    ]),
    'Concurrent reconciliation evidence change; no changes applied.'
  )
  return id
}

async function activate(
  tx: TransactionClient,
  rows: readonly ReconciliationSelectionRow[],
  observationId: string
): Promise<void> {
  for (const row of rows)
    await one(
      tx.execute(
        `UPDATE transactions
            SET ledger_treatment = 'normal', finalization_id = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          WHERE id = ? AND finalization_id IS NULL
            AND ledger_treatment = 'staged_no_balance_impact'
            AND status IN ('posted', 'cleared') AND is_archived = 0`,
        [observationId, row.id]
      ),
      `Concurrent change to staged row ${row.id}; no changes applied.`
    )
}

export async function readAccountMaintenance(
  accountId: string
): Promise<AccountMaintenanceHistory> {
  const account = await accountFor({ query }, accountId, true)
  const [history, coverage, transactions, corrections] = await Promise.all([
    observations({ query }, accountId),
    coverageRows({ query }, accountId),
    ledgerRows({ query }, accountId),
    query<AccountMaintenanceHistory['corrections'][number]>(
      `SELECT rc.* FROM reconciliation_corrections rc
        JOIN account_reconciliations ar ON ar.id = rc.original_reconciliation_id
       WHERE ar.account_id = ? ORDER BY rc.created_at, rc.id`,
      [accountId]
    ),
  ])
  return { account, observations: history, coverage, transactions, corrections }
}

export async function setAccountSourceCoverage(
  input: CoverageInput
): Promise<{ coverage: SourceCoverageEvidence; refreshIncomplete: boolean }> {
  assertDate(input.periodStart, 'Printed period start')
  assertDate(input.periodEnd, 'Printed period end')
  if (input.periodStart > input.periodEnd) throw new Error('Printed period start must precede end.')
  if (!input.sourceNamespace.trim()) throw new Error('Source namespace is required.')
  if (input.zeroRows && input.status === 'gap') throw new Error('A gap cannot certify zero rows.')
  const result = await withTransaction(async (tx) => {
    const account = await accountFor(tx, input.accountId)
    const before = input.coverageId
      ? (
          await tx.query<SourceCoverageEvidence>('SELECT * FROM source_coverage WHERE id = ?', [
            input.coverageId,
          ])
        )[0]
      : undefined
    if (input.coverageId && (!before || before.account_id !== account.id))
      throw new Error('Coverage not found for account.')
    if (
      before &&
      (before.source_namespace !== input.sourceNamespace.trim() ||
        before.period_start !== input.periodStart ||
        before.period_end !== input.periodEnd)
    )
      throw new Error('Coverage identity is immutable; create a new record for a new period.')
    const values = {
      documentRef:
        input.documentRef === undefined ? (before?.document_ref ?? null) : input.documentRef,
      source: input.source === undefined ? (before?.source ?? null) : input.source,
      note: input.note === undefined ? (before?.note ?? null) : input.note,
    }
    if (input.status !== 'gap' && !values.documentRef && !values.source && !values.note)
      throw new Error('Verified/provisional coverage requires document, source or note provenance.')
    const id = before?.id ?? generateId()
    if (before)
      await one(
        tx.execute(
          `UPDATE source_coverage SET status = ?, zero_rows = ?, document_ref = ?, source = ?, note = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
          [input.status, input.zeroRows ? 1 : 0, values.documentRef, values.source, values.note, id]
        ),
        'Concurrent coverage change; no changes applied.'
      )
    else
      await tx.execute(
        `INSERT INTO source_coverage (
           id, account_id, source_namespace, period_start, period_end, status,
           zero_rows, document_ref, source, note
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          account.id,
          input.sourceNamespace.trim(),
          input.periodStart,
          input.periodEnd,
          input.status,
          input.zeroRows ? 1 : 0,
          values.documentRef,
          values.source,
          values.note,
        ]
      )
    const after = (
      await tx.query<SourceCoverageEvidence>('SELECT * FROM source_coverage WHERE id = ?', [id])
    )[0]!
    await audit(
      tx,
      account.id,
      'set-source-coverage',
      before ?? null,
      after,
      input.source,
      input.note
    )
    return after
  })
  return { coverage: result, refreshIncomplete: await refreshViews() }
}

export async function settleAccountStagedTransactions(input: {
  accountId: string
  transactionIds: string[]
  status: 'posted' | 'cleared'
  source?: string
  note?: string
}): Promise<{ transactionIds: string[]; refreshIncomplete: boolean }> {
  const transactionIds = await withTransaction(async (tx) => {
    const account = await accountFor(tx, input.accountId)
    const rows = selectStagedReconciliationRows({
      rows: await ledgerRows(tx, account.id),
      accountId: account.id,
      accountCurrency: account.currency,
      accountMode: account.account_mode,
      transactionIds: input.transactionIds,
      allowPending: true,
    })
    for (const row of rows)
      await one(
        tx.execute(
          `UPDATE transactions SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE id = ? AND status = 'pending' AND ledger_treatment = 'staged_no_balance_impact'`,
          [input.status, row.id]
        ),
        `Concurrent change to pending row ${row.id}; no changes applied.`
      )
    const ids = rows.map((row) => row.id)
    await audit(
      tx,
      account.id,
      'settle-staged-transactions',
      rows,
      { transactionIds: ids, status: input.status },
      input.source,
      input.note
    )
    return ids
  })
  return { transactionIds, refreshIncomplete: await refreshViews() }
}

async function createFinalizationMaterial(
  tx: TransactionClient,
  input: FinalizationInput
): Promise<FinalizationPreviewMaterial> {
  const account = await accountFor(tx, input.accountId)
  const [beforeRows, anchors, allCoverage, state] = await Promise.all([
    ledgerRows(tx, account.id),
    observations(tx, account.id),
    coverageRows(tx, account.id),
    dataState(tx),
  ])
  const rows = selectStagedReconciliationRows({
    rows: beforeRows,
    accountId: account.id,
    accountCurrency: account.currency,
    accountMode: account.account_mode,
    transactionIds: input.transactionIds,
    stagingBatchId: input.stagingBatchId,
  })
  const date = input.reconciliationDate ?? input.statementEndDate
  assertObservationDate(date, today())
  assertDate(input.statementStartDate, 'Statement start')
  assertDate(input.statementEndDate, 'Statement end')
  if (
    input.statementStartDate > input.statementEndDate ||
    input.statementEndDate > date ||
    rows.some((row) => row.date < input.statementStartDate || row.date > input.statementEndDate)
  )
    throw new Error('Selected rows must be within the statement period and observation boundary.')
  const coverage = selectReconciliationCoverage({
    coverage: allCoverage,
    coverageIds: input.coverageIds,
    accountId: account.id,
    rows,
    boundary: date,
    acknowledgeProvisional: input.acknowledgeProvisional,
    provisionalProvenance: input.provisionalProvenance,
  })
  assertReconciliationPeriodCovered(
    coverage,
    rows,
    input.statementStartDate,
    input.statementEndDate
  )
  const plan = planStatementFinalization({
    rows: beforeRows,
    selectedRows: rows,
    accountId: account.id,
    accountBalance: account.balance,
    date,
    today: today(),
    observedBalance: safeMoney(input.actualBalanceCentavos),
    laterAnchorDates: anchors.map((row) => row.reconciliation_date),
  })
  return { account, rows, coverage, beforeRows, date, plan, state }
}

function finalizationTokenMaterial(
  input: FinalizationInput,
  material: FinalizationPreviewMaterial
) {
  const {
    accountId,
    transactionIds,
    stagingBatchId,
    coverageIds,
    acknowledgeProvisional,
    provisionalProvenance,
    statementStartDate,
    statementEndDate,
    actualBalanceCentavos,
    reconciliationDate,
    source,
    note,
  } = input
  return {
    input: {
      accountId,
      transactionIds,
      stagingBatchId,
      coverageIds,
      acknowledgeProvisional,
      provisionalProvenance,
      statementStartDate,
      statementEndDate,
      actualBalanceCentavos,
      reconciliationDate,
      source,
      note,
    },
    account: material.account,
    rows: material.rows,
    coverage: material.coverage,
    date: material.date,
    plan: material.plan,
    state: material.state,
  }
}

export async function previewAccountStatementFinalization(input: FinalizationInput) {
  return withTransaction(async (tx) => {
    const material = await createFinalizationMaterial(tx, input)
    return {
      previewToken: await digest(finalizationTokenMaterial(input, material)),
      account: material.account,
      transactionIds: material.rows.map((row) => row.id),
      transactionCount: material.rows.length,
      coverage: material.coverage,
      reconciliationDate: material.date,
      ...material.plan,
    }
  })
}

export async function finalizeAccountStatementHistory(
  input: FinalizationInput & { previewToken: string }
) {
  const result = await withTransaction(async (tx) => {
    const material = await createFinalizationMaterial(tx, input)
    const currentToken = await digest(finalizationTokenMaterial(input, material))
    if (!input.previewToken || input.previewToken !== currentToken)
      throw new Error('Missing, changed or stale reviewed preview token. Preview again.')
    const reconciliationId = generateId()
    await insertObservation(tx, {
      id: reconciliationId,
      account: material.account,
      date: material.date,
      observed: input.actualBalanceCentavos,
      storedBefore: material.account.balance,
      ledgerBefore: material.plan.asOfLedgerBefore,
      adjustment: material.plan.adjustment,
      batch: input.stagingBatchId,
      start: input.statementStartDate,
      end: input.statementEndDate,
      source: input.source,
      note: input.note,
    })
    await activate(tx, material.rows, reconciliationId)
    const adjustmentTransactionId = await insertBridge(
      tx,
      material.account,
      reconciliationId,
      material.date,
      material.plan.adjustment,
      input.source,
      input.note
    )
    await one(
      tx.execute('UPDATE accounts SET balance = ? WHERE id = ? AND is_archived = 0', [
        material.plan.currentBalanceAfter,
        material.account.id,
      ]),
      'Concurrent account change; no changes applied.'
    )
    const after = await ledgerRows(tx, material.account.id)
    if (
      projectDatedLedger(after, material.account.id, material.date) !==
        input.actualBalanceCentavos ||
      projectDatedLedger(after, material.account.id) !== material.plan.currentBalanceAfter
    )
      throw new Error('Finalization postcondition failed; all writes were rolled back.')
    const auditAfter = {
      ...material.plan,
      reconciliationId,
      adjustmentTransactionId,
      transactionIds: material.rows.map((row) => row.id),
      coverage: material.coverage,
      provisionalProvenance: input.provisionalProvenance ?? null,
    }
    await audit(
      tx,
      material.account.id,
      'finalize-staged-statement-history',
      { account: material.account, rows: material.rows },
      auditAfter,
      input.source,
      input.note
    )
    return auditAfter
  })
  return { ...result, refreshIncomplete: await refreshViews() }
}

async function createSupersessionMaterial(
  tx: TransactionClient,
  input: SupersessionInput
): Promise<SupersessionPreviewMaterial> {
  const account = await accountFor(tx, input.accountId)
  const [all, anchors, allCoverage, state] = await Promise.all([
    ledgerRows(tx, account.id),
    observations(tx, account.id),
    coverageRows(tx, account.id),
    dataState(tx),
  ])
  const original = anchors.find((row) => row.id === input.reconciliationId)
  const bridge = all.find((row) => row.id === input.bridgeId)
  if (!original || !bridge) throw new Error('Original bridge or observation was not found.')
  if (bridge.currency !== account.currency)
    throw new Error('Original bridge currency disagrees with the account.')
  if (
    (
      await tx.query<{ id: string }>(
        'SELECT id FROM reconciliation_corrections WHERE original_bridge_id = ? LIMIT 1',
        [bridge.id]
      )
    ).length
  )
    throw new Error('Bridge already superseded.')
  assertObservationDate(original.reconciliation_date, today())
  const rows = selectStagedReconciliationRows({
    rows: all,
    accountId: account.id,
    accountCurrency: account.currency,
    accountMode: account.account_mode,
    transactionIds: input.transactionIds,
  })
  const coverage = selectReconciliationCoverage({
    coverage: allCoverage,
    coverageIds: input.coverageIds,
    accountId: account.id,
    rows,
    boundary: original.reconciliation_date,
    verifiedOnly: true,
  })
  const plan = planReconciliationBridgeSupersession({
    rows: all,
    selectedRows: rows,
    accountId: account.id,
    accountBalance: account.balance,
    original,
    bridge,
    observations: anchors,
  })
  return { account, all, rows, coverage, original, bridge, plan, state }
}

function supersessionTokenMaterial(
  input: SupersessionInput,
  material: SupersessionPreviewMaterial
) {
  const { accountId, reconciliationId, bridgeId, transactionIds, coverageIds, source, note } = input
  return {
    input: { accountId, reconciliationId, bridgeId, transactionIds, coverageIds, source, note },
    account: material.account,
    original: material.original,
    bridge: material.bridge,
    rows: material.rows,
    coverage: material.coverage,
    plan: material.plan,
    state: material.state,
  }
}

export async function previewAccountBridgeSupersession(input: SupersessionInput) {
  return withTransaction(async (tx) => {
    const material = await createSupersessionMaterial(tx, input)
    return {
      previewToken: await digest(supersessionTokenMaterial(input, material)),
      account: material.account,
      original: material.original,
      bridge: material.bridge,
      transactionIds: material.rows.map((row) => row.id),
      coverage: material.coverage,
      ...material.plan,
    }
  })
}

export async function supersedeAccountReconciliationBridge(
  input: SupersessionInput & { previewToken: string }
) {
  const result = await withTransaction(async (tx) => {
    const material = await createSupersessionMaterial(tx, input)
    const currentToken = await digest(supersessionTokenMaterial(input, material))
    if (!input.previewToken || input.previewToken !== currentToken)
      throw new Error('Missing, changed or stale reviewed preview token. Preview again.')
    const successorId = generateId()
    const observed = projectDatedLedger(
      material.all,
      material.account.id,
      material.original.reconciliation_date
    )
    await insertObservation(tx, {
      id: successorId,
      account: material.account,
      date: material.original.reconciliation_date,
      observed,
      storedBefore: material.account.balance,
      ledgerBefore: safeMoney(
        safeMoney(observed - material.plan.originalSignedBridge) + material.plan.replacementEffect
      ),
      adjustment: material.plan.successorSignedBridge,
      source: input.source,
      note: input.note,
    })
    await one(
      tx.execute('UPDATE transactions SET is_archived = 1 WHERE id = ? AND is_archived = 0', [
        material.bridge.id,
      ]),
      'Concurrent bridge change; no changes applied.'
    )
    await activate(tx, material.rows, successorId)
    const successorBridgeId = await insertBridge(
      tx,
      material.account,
      successorId,
      material.original.reconciliation_date,
      material.plan.successorSignedBridge,
      input.source,
      input.note
    )
    const correctionId = generateId()
    await tx.execute(
      `INSERT INTO reconciliation_corrections (
         id, original_reconciliation_id, original_bridge_id, successor_reconciliation_id,
         successor_bridge_id, replacement_transaction_ids_json, source, note
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        correctionId,
        material.original.id,
        material.bridge.id,
        successorId,
        successorBridgeId,
        JSON.stringify(material.rows.map((row) => row.id)),
        input.source ?? null,
        input.note ?? null,
      ]
    )
    const after = await ledgerRows(tx, material.account.id)
    const storedAfter = (await accountFor(tx, material.account.id)).balance
    const laterAnchorsAfter = material.plan.laterAnchors.map((anchor) => ({
      ...anchor,
      effectiveBalance: projectDatedLedger(after, material.account.id, anchor.date),
    }))
    const currentEffectiveAfter = projectDatedLedger(after, material.account.id)
    if (
      storedAfter !== material.account.balance ||
      currentEffectiveAfter !== material.plan.currentEffective ||
      laterAnchorsAfter.some(
        (anchor, index) =>
          anchor.effectiveBalance !== material.plan.laterAnchors[index]?.effectiveBalance
      )
    )
      throw new Error('Supersession postcondition failed; all writes were rolled back.')
    const afterAudit = {
      correctionId,
      successorReconciliationId: successorId,
      successorBridgeId,
      currentStoredAfter: storedAfter,
      currentEffectiveAfter,
      laterAnchorsAfter,
    }
    await audit(
      tx,
      material.account.id,
      'supersede-reconciliation-bridge',
      supersessionTokenMaterial(input, material),
      afterAudit,
      input.source,
      input.note
    )
    return afterAudit
  })
  return { ...result, refreshIncomplete: await refreshViews() }
}
