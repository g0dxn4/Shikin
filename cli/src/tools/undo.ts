import {
  z,
  query,
  execute,
  transaction,
  fromCentavos,
  dayjs,
  boundedText,
  resolveAccountId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  type AuditLogRow,
  type UndoSupportedEntity,
  type UndoSupportedAction,
  failure,
  parseAuditJson,
  formatAuditRow,
} from '../audit-read.js'
import {
  transactionSnapshotFromAudit,
  protectedUndoSemanticsFailure,
  transactionSnapshotPublic,
  transactionBalanceImpacts,
  insertUndoTransaction,
  updateUndoTransaction,
  deleteUndoTransaction,
  assertCurrentTransactionUndoState,
} from '../transaction-audit.js'
import {
  statementSnapshotFromAudit,
  statementSnapshotPublic,
  insertUndoStatement,
  updateUndoStatement,
  deleteUndoStatement,
  assertCurrentStatementUndoState,
} from '../statement-audit.js'

type UndoPlan = {
  entity: UndoSupportedEntity
  entityId: string
  action: UndoSupportedAction
  inverseAction: 'create' | 'update' | 'delete'
  beforeUndo: unknown
  afterUndo: unknown
  balanceImpact: ReturnType<typeof formatUndoBalanceImpact>
}

const UNDO_CANDIDATE_LIMIT = 200

function supportedAuditAction(value: string): value is UndoSupportedAction {
  return value === 'create' || value === 'update' || value === 'delete'
}

function supportedAuditEntity(value: string): value is UndoSupportedEntity {
  return value === 'transaction' || value === 'credit_card_statement'
}

function addUndoImpact(target: Map<string, number>, source: Map<string, number>, multiplier = 1) {
  for (const [accountId, amount] of source) {
    const next = (target.get(accountId) ?? 0) + amount * multiplier
    if (next === 0) target.delete(accountId)
    else target.set(accountId, next)
  }
}

function readUndoAccountBalances(accountIds: string[]) {
  const uniqueIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueIds.length === 0)
    return new Map<string, { name: string | null; balance: number | null }>()
  const placeholders = uniqueIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows = query<{ id: string; name: string | null; balance: number | null }>(
    `SELECT id, name, balance FROM accounts WHERE id IN (${placeholders})`,
    uniqueIds
  )
  return new Map(
    rows.map((row) => [row.id, { name: row.name ?? null, balance: row.balance ?? null }])
  )
}

function formatUndoBalanceImpact(deltas: Map<string, number>) {
  const sorted = [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))
  const balances = readUndoAccountBalances(sorted.map(([accountId]) => accountId))
  const accounts = sorted.map(([accountId, deltaCentavos]) => {
    const account = balances.get(accountId)
    const previousBalanceCentavos = account?.balance ?? null
    const newBalanceCentavos =
      previousBalanceCentavos === null ? null : previousBalanceCentavos + deltaCentavos
    return {
      accountId,
      accountName: account?.name ?? null,
      previousBalance:
        previousBalanceCentavos === null ? null : fromCentavos(previousBalanceCentavos),
      newBalance: newBalanceCentavos === null ? null : fromCentavos(newBalanceCentavos),
      delta: fromCentavos(deltaCentavos),
      previousBalanceCentavos,
      newBalanceCentavos,
      deltaCentavos,
    }
  })

  return { affectsBalances: accounts.length > 0, accounts, deltas: accounts }
}

function buildUndoPlan(entry: AuditLogRow): UndoPlan | ReturnType<typeof failure> {
  if (!supportedAuditEntity(entry.entity) || !supportedAuditAction(entry.action)) {
    return failure(
      'unsupported_undo_target',
      `Audit entry ${entry.id} is ${entry.entity}/${entry.action}, which cannot be undone safely by this tool.`
    )
  }

  const before = parseAuditJson(entry.before_json)
  const after = parseAuditJson(entry.after_json)
  const inverseAction =
    entry.action === 'create' ? 'delete' : entry.action === 'delete' ? 'create' : 'update'

  if (entry.entity === 'transaction') {
    const beforeTx = transactionSnapshotFromAudit(before)
    const afterTx = transactionSnapshotFromAudit(after)
    const sourceTx = entry.action === 'delete' ? beforeTx : afterTx
    if (!sourceTx) {
      return failure(
        'unsupported_undo_snapshot',
        `Audit entry ${entry.id} does not contain the transaction snapshot required for undo.`
      )
    }

    const exists = query<{ id: string }>('SELECT id FROM transactions WHERE id = $1 LIMIT 1', [
      sourceTx.id,
    ])[0]
    if (entry.action === 'delete' && exists) {
      return failure(
        'undo_conflict_transaction_exists',
        `Transaction ${sourceTx.id} already exists; undoing delete audit ${entry.id} would overwrite data.`
      )
    }
    if (entry.action !== 'delete' && !exists) {
      return failure(
        'undo_conflict_transaction_missing',
        `Transaction ${sourceTx.id} no longer exists; audit ${entry.id} cannot be undone safely.`
      )
    }

    const deltas = new Map<string, number>()
    if (entry.action === 'create' && afterTx)
      addUndoImpact(deltas, transactionBalanceImpacts(afterTx), -1)
    if (entry.action === 'delete' && beforeTx)
      addUndoImpact(deltas, transactionBalanceImpacts(beforeTx), 1)
    if (entry.action === 'update' && beforeTx && afterTx) {
      addUndoImpact(deltas, transactionBalanceImpacts(beforeTx), 1)
      addUndoImpact(deltas, transactionBalanceImpacts(afterTx), -1)
    }

    return {
      entity: 'transaction',
      entityId: sourceTx.id,
      action: entry.action,
      inverseAction,
      beforeUndo: entry.action === 'delete' ? null : transactionSnapshotPublic(afterTx!),
      afterUndo: entry.action === 'create' ? null : transactionSnapshotPublic(beforeTx!),
      balanceImpact: formatUndoBalanceImpact(deltas),
    }
  }

  const beforeStatement = statementSnapshotFromAudit(before)
  const afterStatement = statementSnapshotFromAudit(after)
  const sourceStatement = entry.action === 'delete' ? beforeStatement : afterStatement
  if (!sourceStatement) {
    return failure(
      'unsupported_undo_snapshot',
      `Audit entry ${entry.id} does not contain the credit-card statement snapshot required for undo.`
    )
  }
  const exists = query<{ id: string }>(
    'SELECT id FROM credit_card_statements WHERE id = $1 LIMIT 1',
    [sourceStatement.id]
  )[0]
  if (entry.action === 'delete' && exists) {
    return failure(
      'undo_conflict_statement_exists',
      `Credit-card statement ${sourceStatement.id} already exists; undoing delete audit ${entry.id} would overwrite data.`
    )
  }
  if (entry.action !== 'delete' && !exists) {
    return failure(
      'undo_conflict_statement_missing',
      `Credit-card statement ${sourceStatement.id} no longer exists; audit ${entry.id} cannot be undone safely.`
    )
  }

  return {
    entity: 'credit_card_statement',
    entityId: sourceStatement.id,
    action: entry.action,
    inverseAction,
    beforeUndo: entry.action === 'delete' ? null : statementSnapshotPublic(afterStatement!),
    afterUndo: entry.action === 'create' ? null : statementSnapshotPublic(beforeStatement!),
    balanceImpact: formatUndoBalanceImpact(new Map()),
  }
}

function dependentAuditRows(entry: AuditLogRow, limit = 5) {
  if (!entry.entity_id) return []
  return query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE entity = $1 AND entity_id = $2 AND created_at > $3 AND id <> $4
     ORDER BY created_at DESC, id DESC
     LIMIT $5`,
    [entry.entity, entry.entity_id, entry.created_at, entry.id, limit]
  )
}

function auditEntryMatchesAccount(entry: AuditLogRow, accountId: string): boolean {
  const before = parseAuditJson(entry.before_json)
  const after = parseAuditJson(entry.after_json)
  const txBefore = transactionSnapshotFromAudit(before)
  const txAfter = transactionSnapshotFromAudit(after)
  const statementBefore = statementSnapshotFromAudit(before)
  const statementAfter = statementSnapshotFromAudit(after)
  return (
    [txBefore, txAfter].some(
      (tx) => tx && (tx.accountId === accountId || tx.transferToAccountId === accountId)
    ) || [statementBefore, statementAfter].some((statement) => statement?.accountId === accountId)
  )
}

function findUndoAuditEntry(input: {
  auditId?: string
  transactionId?: string
  statementId?: string
  last?: boolean
  source?: string
  since?: string
  command?: string
  account?: string
}) {
  const targetCount = [input.auditId, input.transactionId, input.statementId].filter(Boolean).length
  if (targetCount > 1) {
    return failure(
      'undo_target_conflict',
      'Use only one of auditId, transactionId, or statementId for undo target selection.'
    )
  }
  if (!input.auditId && !input.transactionId && !input.statementId && !input.last) {
    return failure(
      'undo_target_required',
      'Provide auditId, transactionId, statementId, or last=true to choose what to undo.'
    )
  }

  let resolvedAccountId: string | null = null
  if (input.account) {
    const resolved = resolveAccountId(undefined, input.account)
    if (!resolved.success) return resolved
    resolvedAccountId = resolved.id
  }

  const filters = [
    "entity IN ('transaction', 'credit_card_statement')",
    "action IN ('create', 'update', 'delete')",
  ]
  const params: unknown[] = []
  const addFilter = (sql: string, value: unknown) => {
    params.push(value)
    filters.push(sql.replace('?', `$${params.length}`))
  }
  if (input.auditId) addFilter('id = ?', input.auditId)
  if (input.transactionId) {
    addFilter('entity = ?', 'transaction')
    addFilter('entity_id = ?', input.transactionId)
  }
  if (input.statementId) {
    addFilter('entity = ?', 'credit_card_statement')
    addFilter('entity_id = ?', input.statementId)
  }
  if (input.source) addFilter('source = ?', input.source)
  if (input.since) addFilter('created_at >= ?', input.since)
  if (input.command) addFilter('action = ?', input.command)

  params.push(resolvedAccountId ? UNDO_CANDIDATE_LIMIT : 1)
  const rows = query<AuditLogRow>(
    `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
     FROM audit_log
     WHERE ${filters.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )
  const row = resolvedAccountId
    ? rows.find((candidate) => auditEntryMatchesAccount(candidate, resolvedAccountId))
    : rows[0]
  if (!row) {
    return failure(
      'undo_target_not_found',
      'No undoable audit entry matched the requested filters.'
    )
  }
  return { success: true as const, entry: row }
}

function applyUndoBalanceDeltas(balanceImpact: UndoPlan['balanceImpact']) {
  for (const account of balanceImpact.accounts) {
    if (account.deltaCentavos === 0) continue
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [account.deltaCentavos, account.accountId]
    )
  }
}

function applyUndoPlan(
  previewEntry: AuditLogRow,
  source: string | undefined,
  note: string | undefined,
  allowDependentWrites: boolean
) {
  return transaction(() => {
    const entry = (query<AuditLogRow>(
      `SELECT id, entity, entity_id, action, before_json, after_json, source, note, created_at
         FROM audit_log WHERE id = $1 LIMIT 1`,
      [previewEntry.id]
    ) ?? [])[0]
    if (
      !entry ||
      entry.entity !== previewEntry.entity ||
      entry.entity_id !== previewEntry.entity_id ||
      entry.action !== previewEntry.action ||
      entry.before_json !== previewEntry.before_json ||
      entry.after_json !== previewEntry.after_json
    ) {
      throw new Error(`Audit entry ${previewEntry.id} changed; refresh the undo preview.`)
    }
    const protectedSemanticsFailure = protectedUndoSemanticsFailure(entry)
    if (protectedSemanticsFailure) throw new Error(protectedSemanticsFailure.message)
    const planResult = buildUndoPlan(entry)
    if ('success' in planResult && planResult.success === false) {
      throw new Error(planResult.message)
    }
    const plan = planResult as UndoPlan
    const currentDependentWrites = dependentAuditRows(entry)
    if (currentDependentWrites.length > 0 && !allowDependentWrites) {
      throw new Error(
        `Audit entry ${entry.id} now has later dependent writes; refresh the preview.`
      )
    }
    if (plan.entity === 'transaction') assertCurrentTransactionUndoState(entry, plan)
    else assertCurrentStatementUndoState(entry, plan)

    if (plan.entity === 'transaction') {
      if (plan.inverseAction === 'delete') deleteUndoTransaction(plan.entityId)
      if (plan.inverseAction === 'update') {
        const tx = transactionSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!tx) throw new Error(`Audit entry ${entry.id} has no transaction snapshot to restore.`)
        updateUndoTransaction(tx)
      }
      if (plan.inverseAction === 'create') {
        const tx = transactionSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!tx) throw new Error(`Audit entry ${entry.id} has no transaction snapshot to recreate.`)
        insertUndoTransaction(tx)
      }
      applyUndoBalanceDeltas(plan.balanceImpact)
    } else {
      if (plan.inverseAction === 'delete') deleteUndoStatement(plan.entityId)
      if (plan.inverseAction === 'update') {
        const statement = statementSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!statement)
          throw new Error(`Audit entry ${entry.id} has no statement snapshot to restore.`)
        updateUndoStatement(statement)
      }
      if (plan.inverseAction === 'create') {
        const statement = statementSnapshotFromAudit(parseAuditJson(entry.before_json))
        if (!statement)
          throw new Error(`Audit entry ${entry.id} has no statement snapshot to recreate.`)
        insertUndoStatement(statement)
      }
    }

    writeAuditLog({
      entity: plan.entity,
      entityId: plan.entityId,
      action: 'undo',
      before: {
        auditEntryId: entry.id,
        originalAction: entry.action,
        beforeUndo: plan.beforeUndo,
      },
      after: {
        auditEntryId: entry.id,
        undoAction: plan.inverseAction,
        afterUndo: plan.afterUndo,
        balanceImpact: plan.balanceImpact,
      },
      source: source ?? 'undo',
      note,
    })
    return plan
  })
}

export const undo: ToolDefinition = {
  name: 'undo',
  description:
    'Preview or apply a safe rollback for the latest matching transaction or credit-card-statement audit entry. Dry-run is the default; pass apply=true to write.',
  schema: z.object({
    last: z
      .boolean()
      .optional()
      .default(false)
      .describe('Select the latest matching undoable audit entry'),
    source: boundedText('Source', 'Optional provenance source filter', 120).optional(),
    since: z
      .string()
      .trim()
      .datetime({ offset: true })
      .transform((value) => dayjs(value).toISOString())
      .optional()
      .describe('Only consider audit entries at or after this ISO timestamp'),
    command: boundedText(
      'Command/action',
      'Optional audit action filter, e.g. create/update/delete',
      80
    )
      .optional()
      .describe('Optional audit action filter. Currently maps to audit_log.action.'),
    account: boundedText(
      'Account reference',
      'Optional account alias, ID, or exact name filter',
      128
    )
      .optional()
      .describe('Filter transaction/statement audit snapshots by account'),
    transactionId: boundedText(
      'Transaction ID',
      'Undo the latest audit entry for this transaction',
      128
    ).optional(),
    statementId: boundedText(
      'Statement ID',
      'Undo the latest audit entry for this credit-card statement',
      128
    ).optional(),
    auditId: boundedText('Audit ID', 'Undo this exact audit entry', 160).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Force preview mode. Preview mode is also used whenever apply is false.'),
    apply: z
      .boolean()
      .optional()
      .default(false)
      .describe('Actually apply the undo. Without apply, the tool only previews.'),
    allowDependentWrites: z
      .boolean()
      .optional()
      .default(false)
      .describe('Allow undo even when later audit writes exist for the same entity'),
    note: boundedText('Undo note', 'Optional audit note for the undo operation', 1000).optional(),
  }),
  effects: {
    writesTo: [
      'transactions',
      'accounts',
      'credit_card_statements',
      'transaction_fx_evidence',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async ({
    last,
    source,
    since,
    command,
    account,
    transactionId,
    statementId,
    auditId,
    dryRun,
    apply,
    allowDependentWrites,
    note,
  }) => {
    const found = findUndoAuditEntry({
      auditId,
      transactionId,
      statementId,
      last,
      source,
      since,
      command,
      account,
    })
    if (!found.success) return found

    const entry = found.entry
    const protectedSemanticsFailure = protectedUndoSemanticsFailure(entry)
    if (protectedSemanticsFailure) return protectedSemanticsFailure
    const planResult = buildUndoPlan(entry)
    if ('success' in planResult && planResult.success === false) return planResult
    const plan = planResult as UndoPlan
    if (plan.entity === 'transaction') assertCurrentTransactionUndoState(entry, plan)
    const dependentWrites = dependentAuditRows(entry).map((row) => formatAuditRow(row, false))
    if (dependentWrites.length > 0 && !allowDependentWrites) {
      return failure(
        'dependent_writes_exist',
        `Audit entry ${entry.id} has later writes for the same entity. Re-run with allowDependentWrites only after reviewing them.`,
        { auditEntry: formatAuditRow(entry, false), dependentWrites, wouldUndo: plan }
      )
    }

    const preview = {
      auditEntry: formatAuditRow(entry, false),
      dependentWrites,
      wouldUndo: plan,
      requiresApply: !apply,
    }
    if (!apply || dryRun) {
      return {
        success: true,
        dryRun: true,
        ...preview,
        message: `Dry run: audit entry ${entry.id} would be undone with inverse action ${plan.inverseAction}.`,
      }
    }

    const appliedPlan = applyUndoPlan(entry, source, note, allowDependentWrites)
    return {
      success: true,
      dryRun: false,
      auditEntry: formatAuditRow(entry, false),
      undone: appliedPlan,
      dependentWrites,
      message: `Undid audit entry ${entry.id} with inverse action ${appliedPlan.inverseAction}.`,
    }
  },
}
