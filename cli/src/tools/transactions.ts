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
  positiveMoneyAmount,
  isAccountWriteEligible,
  resolveAccountId,
  crossCurrencyMoveMessage,
  unknownTransactionCurrencyFailure,
  getDistinctCurrencies,
  getCategoryIdentity,
  missingCurrencyRepairFailure,
  hasMissingCurrency,
  normalizeCurrencyCode,
  resolveCategoryId,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  findTransactionDuplicate,
  transactionDuplicateReason,
  type TransactionDuplicateCheck,
} from '../duplicate-detection.js'

type TransactionStatus = 'pending' | 'posted' | 'cleared'
type LedgerTreatment = 'normal' | 'staged_no_balance_impact'
type ReportingTreatment = 'normal' | 'exclude_from_cashflow'
type PlaceholderTransactionStatus = 'unresolved' | 'resolved' | 'split' | 'cancelled'
const placeholderStatusSchema = z.enum(['unresolved', 'resolved', 'split', 'cancelled'])

type TransactionRow = {
  id: string
  account_id: string
  category_id: string | null
  transfer_to_account_id: string | null
  type: 'expense' | 'income' | 'transfer'
  amount: number
  currency: string | null
  description: string
  notes: string | null
  status?: TransactionStatus | null
  source?: string | null
  note?: string | null
  recurring_rule_id?: string | null
  ledger_treatment?: LedgerTreatment | null
  reporting_treatment?: ReportingTreatment | null
  transaction_kind?: 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror' | null
  staging_batch_id?: string | null
  reconciliation_id?: string | null
  matched_transaction_id?: string | null
  is_archived?: number | null
  tags?: string | null
  is_placeholder?: number | null
  placeholder_status?: PlaceholderTransactionStatus | null
  resolved_at?: string | null
  resolved_by_transaction_id?: string | null
  placeholder_reason?: string | null
  placeholder_parent_transaction_id?: string | null
  date: string
}

type QueriedTransactionRow = {
  id: string
  description: string
  amount: number
  currency: string | null
  type: 'expense' | 'income' | 'transfer'
  date: string
  notes: string | null
  status: TransactionStatus
  source: string | null
  note: string | null
  recurring_rule_id: string | null
  ledger_treatment: LedgerTreatment | null
  reporting_treatment: ReportingTreatment | null
  transaction_kind: 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror' | null
  staging_batch_id: string | null
  reconciliation_id: string | null
  matched_transaction_id: string | null
  is_archived: number | null
  tags: string | null
  is_placeholder: number | null
  placeholder_status: PlaceholderTransactionStatus | null
  resolved_at: string | null
  resolved_by_transaction_id: string | null
  placeholder_reason: string | null
  placeholder_parent_transaction_id: string | null
  category_name: string
  account_name: string
  transfer_to_account_id: string | null
  transfer_to_account_name: string | null
  reconciliation_date: string | null
  reconciliation_account_id: string | null
  reconciliation_adjustment_amount: number | null
  reconciliation_staging_batch_id: string | null
  statement_start_date: string | null
  statement_end_date: string | null
  reconciliation_source: string | null
  reconciliation_note: string | null
}

type AccountRef = {
  id: string
  currency: string
  accountMode?: 'transactional' | 'snapshot_only'
}

type RecurringRuleRef = {
  id: string
  account_id: string
  type: 'expense' | 'income' | 'transfer'
  currency: string | null
}

type BalanceImpactResult =
  | { success: true; impacts: Map<string, number> }
  | { success: false; message: string }

type BalanceAuditChange = {
  accountId: string
  deltaCentavos: number
  previousBalanceCentavos: number | null
  newBalanceCentavos: number | null
  previousBalance: number | null
  newBalance: number | null
}

type PlaceholderSplitInput = {
  amount: number
  description?: string
  category?: string
  notes?: string
}

type TransactionTag = {
  key: string
  label: string
}

type BalanceImpactPreview = {
  affectsBalances: boolean
  accounts: Array<{
    accountId: string
    accountName: string | null
    previousBalance: number | null
    newBalance: number | null
    delta: number
    previousBalanceCentavos: number | null
    newBalanceCentavos: number | null
    deltaCentavos: number
  }>
}

function normalizeTransactionStatus(status: TransactionRow['status']): TransactionStatus {
  return status ?? 'posted'
}

function isBalanceAffectingStatus(status: TransactionRow['status']): boolean {
  return normalizeTransactionStatus(status) !== 'pending'
}

function normalizeLedgerTreatment(value: TransactionRow['ledger_treatment']): LedgerTreatment {
  return value === 'staged_no_balance_impact' ? value : 'normal'
}

function normalizeReportingTreatment(
  value: TransactionRow['reporting_treatment']
): ReportingTreatment {
  return value === 'exclude_from_cashflow' ? value : 'normal'
}

function addImpact(impacts: Map<string, number>, accountId: string, amount: number) {
  impacts.set(accountId, (impacts.get(accountId) ?? 0) + amount)
}

function getBalanceImpact(
  tx: Pick<
    TransactionRow,
    | 'id'
    | 'type'
    | 'amount'
    | 'account_id'
    | 'transfer_to_account_id'
    | 'status'
    | 'ledger_treatment'
    | 'is_archived'
  >
): BalanceImpactResult {
  const impacts = new Map<string, number>()
  if (
    !isBalanceAffectingStatus(tx.status) ||
    normalizeLedgerTreatment(tx.ledger_treatment) !== 'normal' ||
    tx.is_archived === 1
  ) {
    return { success: true, impacts }
  }

  if (tx.type === 'transfer') {
    if (!tx.transfer_to_account_id) {
      return {
        success: false,
        message: `Transfer transaction ${tx.id} has no destination account. Repair or recreate it before editing it.`,
      }
    }

    addImpact(impacts, tx.account_id, -tx.amount)
    addImpact(impacts, tx.transfer_to_account_id, tx.amount)
    return { success: true, impacts }
  }

  addImpact(impacts, tx.account_id, tx.type === 'income' ? tx.amount : -tx.amount)
  return { success: true, impacts }
}

function diffBalanceImpacts(
  oldImpacts: Map<string, number>,
  newImpacts: Map<string, number>
): Map<string, number> {
  const deltas = new Map<string, number>()
  const accountIds = new Set([...oldImpacts.keys(), ...newImpacts.keys()])

  for (const accountId of accountIds) {
    const delta = (newImpacts.get(accountId) ?? 0) - (oldImpacts.get(accountId) ?? 0)
    if (delta !== 0) deltas.set(accountId, delta)
  }

  return deltas
}

function combineBalanceImpacts(...impactMaps: Map<string, number>[]): Map<string, number> {
  const combined = new Map<string, number>()
  for (const impacts of impactMaps) {
    for (const [accountId, amount] of impacts) addImpact(combined, accountId, amount)
  }
  return combined
}

function invertBalanceImpacts(impacts: Map<string, number>): Map<string, number> {
  return new Map([...impacts.entries()].map(([accountId, amount]) => [accountId, -amount]))
}

function sortedBalanceDeltas(deltas: Map<string, number>): Array<[string, number]> {
  return [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))
}

function readAccountBalances(accountIds: string[]): Map<string, number> {
  const uniqueAccountIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueAccountIds.length === 0) return new Map()

  const placeholders = uniqueAccountIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows =
    query<{ id: string; balance: number }>(
      `SELECT id, balance FROM accounts WHERE id IN (${placeholders})`,
      uniqueAccountIds
    ) ?? []

  return new Map(rows.map((row) => [row.id, row.balance]))
}

function readAccountNames(accountIds: string[]): Map<string, string | null> {
  const uniqueAccountIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueAccountIds.length === 0) return new Map()

  const placeholders = uniqueAccountIds.map((_, index) => `$${index + 1}`).join(', ')
  const rows =
    query<{ id: string; name: string | null }>(
      `SELECT id, name FROM accounts WHERE id IN (${placeholders})`,
      uniqueAccountIds
    ) ?? []

  return new Map(rows.map((row) => [row.id, row.name ?? null]))
}

function archivedBalanceMutationFailure(accountIds: string[]) {
  const uniqueAccountIds = [...new Set(accountIds)].sort((a, b) => a.localeCompare(b))
  if (uniqueAccountIds.length === 0) return null

  const placeholders = uniqueAccountIds.map((_, index) => `$${index + 1}`).join(', ')
  const protectedAccounts =
    query<{
      id: string
      name: string
      is_archived?: number
      account_mode?: 'transactional' | 'snapshot_only' | null
    }>(
      `SELECT id, name, is_archived, account_mode
       FROM accounts
       WHERE id IN (${placeholders})
         AND (is_archived = 1 OR account_mode = 'snapshot_only')
       ORDER BY id`,
      uniqueAccountIds
    ) ?? []
  if (protectedAccounts.length === 0) return null

  const snapshotAccounts = protectedAccounts.filter(
    (account) => account.account_mode === 'snapshot_only'
  )
  if (snapshotAccounts.length > 0) {
    return {
      success: false as const,
      reason: 'snapshot_only_account' as const,
      accountIds: snapshotAccounts.map((account) => account.id),
      message: `Snapshot-only account${snapshotAccounts.length === 1 ? '' : 's'} ${snapshotAccounts.map((account) => `${account.name} (${account.id})`).join(', ')} cannot accept transaction ledger balance mutations.`,
    }
  }

  const archivedLabels = protectedAccounts.map((account) => `${account.name} (${account.id})`)
  return {
    success: false as const,
    reason: 'archived_account_balance_mutation' as const,
    accountIds: protectedAccounts.map((account) => account.id),
    message: `Cannot mutate balances for archived account${protectedAccounts.length === 1 ? '' : 's'} ${archivedLabels.join(', ')}. Unarchive affected accounts before editing or deleting balance-affecting transactions.`,
  }
}

function applyBalanceDeltas(deltas: Map<string, number>) {
  for (const [accountId, delta] of sortedBalanceDeltas(deltas)) {
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND COALESCE(account_mode, 'transactional') = 'transactional'",
      [delta, accountId]
    )
  }
}

function assertSingleRowUpdated(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) throw new Error(message)
}

function buildBalanceAuditChanges(
  deltas: Map<string, number>,
  balancesBefore: Map<string, number>
): BalanceAuditChange[] {
  return sortedBalanceDeltas(deltas).map(([accountId, deltaCentavos]) => {
    const previousBalanceCentavos = balancesBefore.get(accountId) ?? null
    const newBalanceCentavos =
      previousBalanceCentavos === null ? null : previousBalanceCentavos + deltaCentavos

    return {
      accountId,
      deltaCentavos,
      previousBalanceCentavos,
      newBalanceCentavos,
      previousBalance:
        previousBalanceCentavos === null ? null : fromCentavos(previousBalanceCentavos),
      newBalance: newBalanceCentavos === null ? null : fromCentavos(newBalanceCentavos),
    }
  })
}

function formatBalanceImpactPreview(
  balanceChanges: BalanceAuditChange[],
  accountNames: Map<string, string | null> = new Map()
): BalanceImpactPreview & { deltas: BalanceAuditChange[] } {
  return {
    affectsBalances: balanceChanges.length > 0,
    deltas: balanceChanges,
    accounts: balanceChanges.map((change) => ({
      accountId: change.accountId,
      accountName: accountNames.get(change.accountId) ?? null,
      previousBalance: change.previousBalance,
      newBalance: change.newBalance,
      delta: fromCentavos(change.deltaCentavos),
      previousBalanceCentavos: change.previousBalanceCentavos,
      newBalanceCentavos: change.newBalanceCentavos,
      deltaCentavos: change.deltaCentavos,
    })),
  }
}

function transactionDuplicateWarnings(duplicateCheck: TransactionDuplicateCheck) {
  const match = duplicateCheck.match
  if (!match) return []

  return [
    {
      type: match.kind,
      reason: transactionDuplicateReason(match.kind),
      existingTransactionId: match.existingTransactionId,
      accountId: match.accountId,
      date: match.date,
      amount: fromCentavos(match.amountCentavos),
      amountCentavos: match.amountCentavos,
      daysApart: match.daysApart,
      descriptionSimilarity: match.descriptionSimilarity,
      message:
        match.kind === 'exact_duplicate'
          ? `Exact duplicate transaction ${match.existingTransactionId} already exists.`
          : `Potential duplicate transaction ${match.existingTransactionId} is within ${match.windowDays} days with similar description.`,
    },
  ]
}

function transactionAuditSnapshot(tx: TransactionRow) {
  const tagDetails = parseStoredTransactionTags(tx.tags)
  return {
    id: tx.id,
    accountId: tx.account_id,
    categoryId: tx.category_id,
    transferToAccountId: tx.transfer_to_account_id,
    type: tx.type,
    amount: fromCentavos(tx.amount),
    amountCentavos: tx.amount,
    currency: tx.currency,
    description: tx.description,
    notes: tx.notes,
    status: normalizeTransactionStatus(tx.status),
    source: tx.source ?? null,
    note: tx.note ?? null,
    recurringRuleId: tx.recurring_rule_id ?? null,
    ledgerTreatment: normalizeLedgerTreatment(tx.ledger_treatment),
    reportingTreatment: normalizeReportingTreatment(tx.reporting_treatment),
    transactionKind: tx.transaction_kind ?? 'standard',
    stagingBatchId: tx.staging_batch_id ?? null,
    reconciliationId: tx.reconciliation_id ?? null,
    matchedTransactionId: tx.matched_transaction_id ?? null,
    isArchived: tx.is_archived === 1,
    tags: tagDetails.map((tag) => tag.label),
    tagDetails,
    isPlaceholder: Boolean(tx.is_placeholder),
    placeholderStatus: tx.placeholder_status ?? null,
    resolvedAt: tx.resolved_at ?? null,
    resolvedByTransactionId: tx.resolved_by_transaction_id ?? null,
    placeholderReason: tx.placeholder_reason ?? null,
    placeholderParentTransactionId: tx.placeholder_parent_transaction_id ?? null,
    date: tx.date,
  }
}

function publicTransactionSnapshot(tx: TransactionRow) {
  const tagDetails = parseStoredTransactionTags(tx.tags)
  return {
    id: tx.id,
    accountId: tx.account_id,
    categoryId: tx.category_id,
    transferToAccountId: tx.transfer_to_account_id,
    type: tx.type,
    amount: fromCentavos(tx.amount),
    amountCentavos: tx.amount,
    currency: tx.currency,
    description: tx.description,
    notes: tx.notes,
    status: normalizeTransactionStatus(tx.status),
    source: tx.source ?? null,
    note: tx.note ?? null,
    recurringRuleId: tx.recurring_rule_id ?? null,
    ledgerTreatment: normalizeLedgerTreatment(tx.ledger_treatment),
    reportingTreatment: normalizeReportingTreatment(tx.reporting_treatment),
    transactionKind: tx.transaction_kind ?? 'standard',
    stagingBatchId: tx.staging_batch_id ?? null,
    reconciliationId: tx.reconciliation_id ?? null,
    matchedTransactionId: tx.matched_transaction_id ?? null,
    isArchived: tx.is_archived === 1,
    tags: tagDetails.map((tag) => tag.label),
    tagDetails,
    isPlaceholder: Boolean(tx.is_placeholder),
    placeholderStatus: tx.placeholder_status ?? null,
    resolvedAt: tx.resolved_at ?? null,
    resolvedByTransactionId: tx.resolved_by_transaction_id ?? null,
    placeholderReason: tx.placeholder_reason ?? null,
    placeholderParentTransactionId: tx.placeholder_parent_transaction_id ?? null,
    date: tx.date,
  }
}

function normalizeTransactionTagLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

function normalizeTransactionTagKey(label: string): string {
  return normalizeTransactionTagLabel(label).toLocaleLowerCase()
}

function transactionTagFromUnknown(value: unknown): TransactionTag | null {
  if (typeof value === 'string') {
    const label = normalizeTransactionTagLabel(value)
    const key = normalizeTransactionTagKey(label)
    return key ? { key, label } : null
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const labelValue = record.label ?? record.name ?? record.value ?? record.key
    if (typeof labelValue !== 'string') return null
    const label = normalizeTransactionTagLabel(labelValue)
    const keyValue = typeof record.key === 'string' ? record.key : label
    const key = normalizeTransactionTagKey(keyValue)
    return key && label ? { key, label } : null
  }

  return null
}

function parseStoredTransactionTags(rawTags: string | null | undefined): TransactionTag[] {
  if (!rawTags || rawTags.trim() === '') return []

  let parsed: unknown
  try {
    parsed = JSON.parse(rawTags)
  } catch {
    return []
  }

  const values = Array.isArray(parsed) ? parsed : [parsed]
  const tags: TransactionTag[] = []
  const seenKeys = new Set<string>()

  for (const value of values) {
    const tag = transactionTagFromUnknown(value)
    if (!tag || seenKeys.has(tag.key)) continue
    tags.push(tag)
    seenKeys.add(tag.key)
  }

  return tags
}

function serializeTransactionTags(tags: TransactionTag[]): string {
  return JSON.stringify(tags.map((tag) => tag.label))
}

function addTransactionTag(rawTags: string | null | undefined, label: string) {
  const tag = transactionTagFromUnknown(label)
  if (!tag) return { changed: false as const, tags: parseStoredTransactionTags(rawTags) }

  const tags = parseStoredTransactionTags(rawTags)
  if (tags.some((existing) => existing.key === tag.key)) {
    return { changed: false as const, tags }
  }

  return { changed: true as const, tags: [...tags, tag] }
}

function removeTransactionTag(rawTags: string | null | undefined, label: string) {
  const key = normalizeTransactionTagKey(label)
  const tags = parseStoredTransactionTags(rawTags)
  const nextTags = tags.filter((tag) => tag.key !== key)
  return { changed: nextTags.length !== tags.length, tags: nextTags }
}

function transactionTagOutput(tags: TransactionTag[]) {
  return {
    tags: tags.map((tag) => tag.label),
    tagDetails: tags,
  }
}

function resolvePlaceholderCategory(category: string | undefined) {
  const resolved = resolveCategoryId(category)
  if (!resolved.success) return resolved
  return { success: true as const, categoryId: resolved.id }
}

function placeholderFailure(reason: string, message: string) {
  return { success: false as const, reason, message }
}

function assertPlaceholderTransaction(tx: TransactionRow) {
  if (!tx.is_placeholder) {
    return placeholderFailure(
      'not_placeholder_transaction',
      `Transaction ${tx.id} is not a placeholder.`
    )
  }
  return null
}

function assertUnresolvedPlaceholder(tx: TransactionRow) {
  const placeholderError = assertPlaceholderTransaction(tx)
  if (placeholderError) return placeholderError
  if ((tx.placeholder_status ?? 'unresolved') !== 'unresolved') {
    return placeholderFailure(
      'placeholder_not_unresolved',
      `Placeholder transaction ${tx.id} is ${tx.placeholder_status ?? 'unknown'} and cannot be changed by this workflow.`
    )
  }
  return null
}

function protectedPlaceholderLifecycleFailure(tx: TransactionRow, action: 'update' | 'delete') {
  if (!tx.is_placeholder) return null
  const placeholderStatus = tx.placeholder_status ?? 'unresolved'
  if (placeholderStatus === 'unresolved') return null
  return placeholderFailure(
    'protected_placeholder_lifecycle',
    `Placeholder transaction ${tx.id} is ${placeholderStatus} and cannot be ${action}d with the generic transaction workflow.`
  )
}

function protectedFinancialTransactionFailure(
  tx: TransactionRow,
  action: 'update' | 'delete' | 'match',
  includeReferences = true
) {
  if (tx.is_archived === 1) {
    return {
      success: false as const,
      reason: 'archived_transaction' as const,
      message: `Transaction ${tx.id} is archived provenance and cannot be ${action}d.`,
    }
  }
  if ((tx.transaction_kind ?? 'standard') !== 'standard') {
    return {
      success: false as const,
      reason: 'protected_transaction_kind' as const,
      message: `Transaction ${tx.id} is a ${tx.transaction_kind} record and requires its dedicated workflow.`,
    }
  }
  if (tx.matched_transaction_id) {
    return {
      success: false as const,
      reason: 'matched_transaction' as const,
      message: `Transaction ${tx.id} is linked to ${tx.matched_transaction_id} and cannot be changed without an explicit unmatch workflow.`,
    }
  }
  if (!includeReferences) return null
  const references = (query<{
    reconciliation_count: number
    receivable_count: number
    finalized_statement_count: number
  }>(
    `SELECT
       (SELECT COUNT(*) FROM account_reconciliations WHERE adjustment_transaction_id = $1) AS reconciliation_count,
       (SELECT COUNT(*) FROM receivables WHERE matched_transaction_id = $2) AS receivable_count,
       (SELECT COUNT(*) FROM account_reconciliations
        WHERE account_id = $3 AND staging_batch_id = $4) AS finalized_statement_count`,
    [tx.id, tx.id, tx.account_id, tx.staging_batch_id ?? null]
  ) ?? [])[0]
  if ((references?.reconciliation_count ?? 0) > 0 || (references?.receivable_count ?? 0) > 0) {
    return {
      success: false as const,
      reason: 'referenced_financial_transaction' as const,
      message: `Transaction ${tx.id} is part of reconciliation or receivable provenance and requires its dedicated workflow.`,
    }
  }
  if (action !== 'match' && (references?.finalized_statement_count ?? 0) > 0) {
    return {
      success: false as const,
      reason: 'finalized_statement_transaction' as const,
      message: `Transaction ${tx.id} belongs to finalized statement batch ${tx.staging_batch_id}; use a dedicated correction workflow.`,
    }
  }
  return null
}

function buildTransactionBalanceAuditPreview({
  action,
  before,
  after,
  balanceDeltas,
  balancesBefore,
}: {
  action: 'create' | 'update' | 'delete' | 'match-transfer' | 'unmatch-transfer'
  before: TransactionRow | null
  after: TransactionRow | null
  balanceDeltas: Map<string, number>
  balancesBefore: Map<string, number>
}) {
  const balanceChanges = buildBalanceAuditChanges(balanceDeltas, balancesBefore)
  return {
    entity: 'transaction',
    entityId: after?.id ?? before?.id ?? null,
    action,
    before: before
      ? {
          transaction: transactionAuditSnapshot(before),
          balances: balanceChanges.map((change) => ({
            accountId: change.accountId,
            balanceCentavos: change.previousBalanceCentavos,
            balance: change.previousBalance,
          })),
        }
      : null,
    after: after
      ? {
          transaction: transactionAuditSnapshot(after),
          balances: balanceChanges.map((change) => ({
            accountId: change.accountId,
            balanceCentavos: change.newBalanceCentavos,
            balance: change.newBalance,
          })),
        }
      : null,
    source: after ? (after.source ?? null) : (before?.source ?? null),
    note: after ? (after.note ?? null) : (before?.note ?? null),
    balanceChanges,
  }
}

function transactionDuplicateFailure(duplicateCheck: TransactionDuplicateCheck) {
  const match = duplicateCheck.match
  if (!match) return null

  return {
    success: false as const,
    reason: transactionDuplicateReason(match.kind),
    duplicate: match,
    duplicateCheck,
    message:
      match.kind === 'exact_duplicate'
        ? `Exact duplicate transaction ${match.existingTransactionId} already exists. Re-run with allowDuplicate to record it anyway.`
        : `Potential duplicate transaction ${match.existingTransactionId} is within ${match.windowDays} days with similar description. Re-run with allowDuplicate to record it anyway.`,
  }
}

function writeTransactionBalanceAudit(
  params: Parameters<typeof buildTransactionBalanceAuditPreview>[0]
) {
  const auditPreview = buildTransactionBalanceAuditPreview(params)
  writeAuditLog({
    entity: auditPreview.entity,
    entityId: auditPreview.entityId,
    action: auditPreview.action,
    before: auditPreview.before,
    after: auditPreview.after,
    source: auditPreview.source,
    note: auditPreview.note,
  })
}

function resolveTransferDestination(transferToAccountId: string | undefined, source: AccountRef) {
  if (!transferToAccountId) {
    return {
      success: false as const,
      message: 'transferToAccountId is required for transfer transactions.',
    }
  }

  if (transferToAccountId === source.id) {
    return {
      success: false as const,
      message: 'Transfer destination account must be different from the source account.',
    }
  }

  const accounts = query<{
    id: string
    currency: string
    is_archived: number
    account_mode?: 'transactional' | 'snapshot_only' | null
  }>('SELECT id, currency, is_archived, account_mode FROM accounts WHERE id = $1 LIMIT 1', [
    transferToAccountId,
  ])

  if (accounts.length === 0) {
    return {
      success: false as const,
      message: `Transfer destination account ${transferToAccountId} not found.`,
    }
  }

  const destination = accounts[0]
  if (!isAccountWriteEligible(destination)) {
    return {
      success: false as const,
      message: `Transfer destination account ${transferToAccountId} is archived. Unarchive it before using it for new writes.`,
    }
  }

  if (destination.currency !== source.currency) {
    return {
      success: false as const,
      message: `Cannot transfer from ${source.currency} to ${destination.currency}. Cross-currency transfers are not supported because no FX conversion is applied.`,
    }
  }

  if ((destination.account_mode ?? 'transactional') === 'snapshot_only') {
    return {
      success: false as const,
      reason: 'snapshot_only_account',
      message: `Account ${destination.id} is snapshot-only and cannot be used for transaction ledger writes.`,
    }
  }

  return {
    success: true as const,
    id: destination.id,
    currency: destination.currency,
    accountMode: destination.account_mode ?? ('transactional' as const),
  }
}

function snapshotOnlyAccountFailure(accountId: string) {
  const account = (query<{ account_mode?: 'transactional' | 'snapshot_only' | null }>(
    'SELECT account_mode FROM accounts WHERE id = $1 LIMIT 1',
    [accountId]
  ) ?? [])[0]
  if ((account?.account_mode ?? 'transactional') !== 'snapshot_only') return null
  return {
    success: false as const,
    reason: 'snapshot_only_account',
    message: `Account ${accountId} is snapshot-only and cannot be used for transaction ledger writes.`,
  }
}

function resolveRecurringRuleId(
  recurringRuleId: string | null | undefined,
  transactionRef?: { accountId: string; type: TransactionRow['type']; currency: string | null }
) {
  if (!recurringRuleId) {
    return { success: true as const, id: null }
  }

  const rules =
    query<RecurringRuleRef>(
      'SELECT id, account_id, type, currency FROM recurring_rules WHERE id = $1 LIMIT 1',
      [recurringRuleId]
    ) ?? []

  if (rules.length === 0) {
    return {
      success: false as const,
      message: `Recurring rule ${recurringRuleId} not found.`,
    }
  }

  const rule = rules[0]
  if (transactionRef) {
    if (rule.account_id !== transactionRef.accountId) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} belongs to account ${rule.account_id}, not ${transactionRef.accountId}.`,
      }
    }
    if (rule.type !== transactionRef.type) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} is for ${rule.type} transactions, not ${transactionRef.type}.`,
      }
    }
    const ruleCurrency = normalizeCurrencyCode(rule.currency)
    const transactionCurrency = normalizeCurrencyCode(transactionRef.currency)
    if (!ruleCurrency) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} has no stored currency. Repair or recreate it before linking transactions.`,
      }
    }
    if (!transactionCurrency) {
      return {
        success: false as const,
        message: `Transaction currency is unknown; cannot link recurring rule ${recurringRuleId}.`,
      }
    }
    if (ruleCurrency !== transactionCurrency) {
      return {
        success: false as const,
        message: `Recurring rule ${recurringRuleId} uses ${ruleCurrency}, not ${transactionCurrency}.`,
      }
    }
  }

  return { success: true as const, id: rule.id }
}

const addTransaction: ToolDefinition = {
  name: 'add-transaction',
  description:
    'Add a new financial transaction (expense, income, or transfer). Use this when the user wants to record spending, earnings, or money movement between accounts.',
  schema: z.object({
    amount: positiveMoneyAmount(
      'The transaction amount in the main currency unit (e.g. 12.50, not cents; max 1,000,000,000)'
    ),
    type: z.enum(['expense', 'income', 'transfer']).describe('The type of transaction'),
    description: boundedText('Description', 'A short description of the transaction', 200),
    category: boundedText(
      'Category',
      'Category name (e.g. "Food & Dining", "Salary"). Must resolve to one existing category.',
      120
    ).optional(),
    date: isoDate('Transaction date in YYYY-MM-DD format. Defaults to today.').optional(),
    notes: boundedText('Notes', 'Additional notes about the transaction', 1000).optional(),
    note: boundedText(
      'Note',
      'Workflow changelog note to store with the transaction',
      1000
    ).optional(),
    source: boundedText(
      'Source',
      'Automation source or origin label to store with the transaction',
      120
    ).optional(),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .default('posted')
      .describe('Transaction status. Pending transactions do not affect account balances.'),
    ledgerTreatment: z
      .enum(['normal', 'staged_no_balance_impact'])
      .optional()
      .default('normal')
      .describe(
        'Ledger treatment. Staged history is retained but has no balance impact until finalized.'
      ),
    reportingTreatment: z
      .enum(['normal', 'exclude_from_cashflow'])
      .optional()
      .default('normal')
      .describe(
        'Whether reports should include this transaction in income, spending, and cashflow.'
      ),
    stagingBatchId: boundedText(
      'Staging batch ID',
      'Required when ledgerTreatment is staged_no_balance_impact',
      128
    ).optional(),
    recurringRuleId: boundedText(
      'Recurring rule ID',
      'Optional recurring rule ID linked to this transaction',
      128
    ).optional(),
    accountId: boundedText(
      'Account ID',
      'Optional account ID to apply the transaction to. Required when multiple accounts exist.',
      128
    ).optional(),
    account: boundedText(
      'Account alias',
      'Optional account alias, exact account ID, or exact account name. Required when multiple accounts exist.',
      128
    ).optional(),
    transferToAccountId: boundedText(
      'Transfer destination account ID',
      'Destination account ID for transfer transactions. Required when type is transfer.',
      128
    ).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the transaction without writing it'),
    allowDuplicate: z
      .boolean()
      .optional()
      .default(false)
      .describe('Record the transaction even when an exact or likely duplicate is detected'),
  }),
  execute: async ({
    amount,
    type,
    description,
    category,
    date,
    notes,
    note,
    source,
    status,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
    recurringRuleId,
    accountId,
    account,
    transferToAccountId,
    dryRun,
    allowDuplicate,
  }) => {
    const id = generateId()
    const amountCentavos = toCentavos(amount)
    const txDate = date || dayjs().format('YYYY-MM-DD')
    const transactionNotes = notes ?? null
    const transactionSource = source ?? null
    const transactionNote = note ?? null
    const transactionStatus = status ?? 'posted'
    const transactionLedgerTreatment = ledgerTreatment ?? 'normal'
    const transactionReportingTreatment = reportingTreatment ?? 'normal'
    const transactionStagingBatchId = stagingBatchId ?? null
    const linkedRecurringRuleId = recurringRuleId ?? null

    if (transactionLedgerTreatment === 'staged_no_balance_impact' && !transactionStagingBatchId) {
      return {
        success: false,
        reason: 'staging_batch_required',
        message: 'stagingBatchId is required for staged_no_balance_impact transactions.',
      }
    }
    if (transactionLedgerTreatment === 'staged_no_balance_impact' && type === 'transfer') {
      return {
        success: false,
        reason: 'staged_transfer_not_supported',
        message:
          'Stage imported account-side rows as income or expense, then match transfers after finalization.',
      }
    }

    return transaction(() => {
      const resolvedCategory =
        type === 'transfer'
          ? { success: true as const, id: null, name: null }
          : resolveCategoryId(category)
      if (!resolvedCategory.success) {
        return { success: false, message: resolvedCategory.message }
      }

      const resolvedAccount = resolveAccountId(accountId, account)
      if (!resolvedAccount.success) {
        return {
          success: false,
          message: resolvedAccount.message,
        }
      }
      if (resolvedAccount.accountMode === 'snapshot_only') {
        return {
          success: false,
          reason: 'snapshot_only_account',
          message: `Account ${resolvedAccount.id} is snapshot-only and cannot be used for transaction ledger writes.`,
        }
      }

      const resolvedTransferDestination =
        type === 'transfer'
          ? resolveTransferDestination(transferToAccountId, resolvedAccount)
          : { success: true as const, id: null }

      if (!resolvedTransferDestination.success) {
        return { success: false, message: resolvedTransferDestination.message }
      }

      const resolvedRecurringRule = resolveRecurringRuleId(linkedRecurringRuleId, {
        accountId: resolvedAccount.id,
        type,
        currency: resolvedAccount.currency,
      })
      if (!resolvedRecurringRule.success) {
        return { success: false, message: resolvedRecurringRule.message }
      }

      const duplicateCheck = findTransactionDuplicate({
        accountId: resolvedAccount.id,
        date: txDate,
        amountCentavos,
        type,
        status: transactionStatus,
        transferToAccountId: resolvedTransferDestination.id,
        description,
        source: transactionSource,
        note: transactionNote,
      })
      const duplicateWarnings = transactionDuplicateWarnings(duplicateCheck)

      if (duplicateCheck.match && !allowDuplicate && !dryRun) {
        return transactionDuplicateFailure(duplicateCheck)
      }

      const newTransaction: TransactionRow = {
        id,
        account_id: resolvedAccount.id,
        category_id: resolvedCategory.id,
        transfer_to_account_id: resolvedTransferDestination.id,
        type,
        amount: amountCentavos,
        currency: resolvedAccount.currency,
        description,
        notes: transactionNotes,
        status: transactionStatus,
        source: transactionSource,
        note: transactionNote,
        recurring_rule_id: resolvedRecurringRule.id,
        ledger_treatment: transactionLedgerTreatment,
        reporting_treatment: transactionReportingTreatment,
        transaction_kind: 'standard',
        staging_batch_id: transactionStagingBatchId,
        is_archived: 0,
        date: txDate,
      }
      const balanceImpact = getBalanceImpact(newTransaction)
      if (!balanceImpact.success) {
        return { success: false, message: balanceImpact.message }
      }
      const balanceDeltas = balanceImpact.impacts
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
      const auditPreview = buildTransactionBalanceAuditPreview({
        action: 'create',
        before: null,
        after: newTransaction,
        balanceDeltas,
        balancesBefore,
      })
      const balanceImpactPreview = formatBalanceImpactPreview(
        auditPreview.balanceChanges,
        accountNames
      )

      if (dryRun) {
        const duplicateFailure = transactionDuplicateFailure(duplicateCheck)
        return {
          success: true,
          dryRun: true,
          balanceImpact: balanceImpactPreview,
          ...(duplicateWarnings.length > 0 ? { duplicateWarnings } : {}),
          ...(duplicateCheck.match
            ? {
                duplicateCheck,
                duplicatePolicy: {
                  allowDuplicate,
                  applyBlocked: !allowDuplicate,
                  reason: duplicateCheck.match.kind,
                },
              }
            : {}),
          wouldCreate: {
            id,
            accountId: resolvedAccount.id,
            transferToAccountId: resolvedTransferDestination.id,
            amount,
            currency: resolvedAccount.currency,
            type,
            description,
            category: resolvedCategory.name,
            date: txDate,
            notes: transactionNotes,
            status: transactionStatus,
            source: transactionSource,
            note: transactionNote,
            recurringRuleId: resolvedRecurringRule.id,
            ledgerTreatment: transactionLedgerTreatment,
            reportingTreatment: transactionReportingTreatment,
            stagingBatchId: transactionStagingBatchId,
            balanceImpact: balanceImpactPreview,
            balanceDeltas: auditPreview.balanceChanges,
            auditPreview,
          },
          message:
            duplicateFailure && !allowDuplicate
              ? `${duplicateFailure.message} No changes were written.`
              : `Dry run: ${type} transaction for ${resolvedAccount.currency} ${amount.toFixed(2)} would be created.`,
        }
      }

      execute(
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, ledger_treatment, reporting_treatment, transaction_kind, staging_batch_id, is_archived, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'standard', $16, 0, $17)`,
        [
          id,
          resolvedAccount.id,
          resolvedCategory.id,
          resolvedTransferDestination.id,
          type,
          amountCentavos,
          resolvedAccount.currency,
          description,
          transactionNotes,
          transactionStatus,
          transactionSource,
          transactionNote,
          resolvedRecurringRule.id,
          transactionLedgerTreatment,
          transactionReportingTreatment,
          transactionStagingBatchId,
          txDate,
        ]
      )

      applyBalanceDeltas(balanceDeltas)
      writeTransactionBalanceAudit({
        action: 'create',
        before: null,
        after: newTransaction,
        balanceDeltas,
        balancesBefore,
      })

      return {
        success: true,
        dryRun: false,
        transaction: {
          id,
          accountId: resolvedAccount.id,
          transferToAccountId: resolvedTransferDestination.id,
          amount,
          type,
          description,
          category: resolvedCategory.name,
          date: txDate,
          notes: transactionNotes,
          currency: resolvedAccount.currency,
          status: transactionStatus,
          source: transactionSource,
          note: transactionNote,
          recurringRuleId: resolvedRecurringRule.id,
          ledgerTreatment: transactionLedgerTreatment,
          reportingTreatment: transactionReportingTreatment,
          stagingBatchId: transactionStagingBatchId,
        },
        ...(duplicateCheck.match && allowDuplicate
          ? {
              duplicateOverride: {
                allowed: true,
                reason: 'allow_duplicate',
                duplicate: duplicateCheck.match,
                duplicateCheck,
              },
            }
          : {}),
        message: `Added ${type}: $${amount.toFixed(2)} for "${description}" on ${txDate}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 2. update-transaction
// ---------------------------------------------------------------------------

const updateTransaction: ToolDefinition = {
  name: 'update-transaction',
  description:
    'Update an existing transaction. Use this when the user wants to change the amount, description, category, date, or other details of a transaction.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to update', 128),
    amount: positiveMoneyAmount('New amount in the main currency unit (e.g. 12.50)').optional(),
    type: z.enum(['expense', 'income', 'transfer']).optional().describe('New transaction type'),
    description: boundedText('Description', 'New description', 200).optional(),
    category: boundedText(
      'Category',
      'New category name — will match the closest existing category',
      120
    ).optional(),
    date: isoDate('New date in YYYY-MM-DD format').optional(),
    notes: z.string().max(1000).optional().describe('New notes. Pass an empty string to clear.'),
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('New workflow changelog note. Pass an empty string to clear.'),
    source: z
      .string()
      .trim()
      .max(120)
      .optional()
      .describe('New automation source or origin label. Pass an empty string to clear.'),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .describe('New transaction status. Pending transactions do not affect account balances.'),
    ledgerTreatment: z
      .enum(['normal', 'staged_no_balance_impact'])
      .optional()
      .describe(
        'New ledger treatment. Use finalize-staged-statement-history to make staged rows effective.'
      ),
    reportingTreatment: z
      .enum(['normal', 'exclude_from_cashflow'])
      .optional()
      .describe('New reporting treatment'),
    stagingBatchId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('New staging batch ID. Pass an empty string to clear when the row is not staged.'),
    recurringRuleId: z
      .string()
      .trim()
      .max(128)
      .optional()
      .describe('New linked recurring rule ID. Pass an empty string to clear.'),
    accountId: boundedText(
      'Account ID',
      'New account ID to move the transaction to',
      128
    ).optional(),
    transferToAccountId: boundedText(
      'Transfer destination account ID',
      'Destination account ID for transfer transactions',
      128
    ).optional(),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the update without writing it'),
  }),
  execute: async ({
    transactionId,
    amount,
    type,
    description,
    category,
    date,
    notes,
    note,
    source,
    status,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
    recurringRuleId,
    accountId,
    transferToAccountId,
    dryRun,
  }) => {
    return transaction(() => {
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const lifecycleFailure = protectedPlaceholderLifecycleFailure(tx, 'update')
      if (lifecycleFailure) return lifecycleFailure
      const financialFailure = protectedFinancialTransactionFailure(tx, 'update', false)
      if (financialFailure) return financialFailure
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      if (!tx.currency) {
        return unknownTransactionCurrencyFailure(tx)
      }

      const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const newStatus = status ?? normalizeTransactionStatus(tx.status)
      const newLedgerTreatment = ledgerTreatment ?? normalizeLedgerTreatment(tx.ledger_treatment)
      const newReportingTreatment =
        reportingTreatment ?? normalizeReportingTreatment(tx.reporting_treatment)
      const newStagingBatchId =
        stagingBatchId !== undefined
          ? stagingBatchId === ''
            ? null
            : stagingBatchId
          : (tx.staging_batch_id ?? null)
      if (
        normalizeLedgerTreatment(tx.ledger_treatment) === 'staged_no_balance_impact' &&
        newLedgerTreatment === 'normal'
      ) {
        return {
          success: false,
          reason: 'staged_finalization_required',
          message:
            'Use finalize-staged-statement-history so the batch and reconciliation bridge are committed atomically.',
        }
      }
      if (newLedgerTreatment === 'staged_no_balance_impact' && !newStagingBatchId) {
        return {
          success: false,
          reason: 'staging_batch_required',
          message: 'stagingBatchId is required for staged_no_balance_impact transactions.',
        }
      }
      if (newLedgerTreatment === 'staged_no_balance_impact' && newType === 'transfer') {
        return {
          success: false,
          reason: 'staged_transfer_not_supported',
          message: 'Staged statement rows must remain account-side income or expense entries.',
        }
      }
      const isMovingAccounts = accountId !== undefined && accountId !== oldAccountId
      const sourceCurrency = tx.currency
      let resolvedAccount:
        | {
            success: true
            id: string
            currency: string
            accountMode: 'transactional' | 'snapshot_only'
          }
        | { success: false; message: string }
        | null = null

      if (isMovingAccounts) {
        resolvedAccount = resolveAccountId(accountId)
        if (!resolvedAccount.success) {
          return { success: false, message: resolvedAccount.message }
        }
        if (resolvedAccount.accountMode === 'snapshot_only') {
          return {
            success: false,
            reason: 'snapshot_only_account',
            message: `Account ${resolvedAccount.id} is snapshot-only and cannot be used for transaction ledger writes.`,
          }
        }

        if (sourceCurrency && resolvedAccount.currency !== sourceCurrency) {
          return {
            success: false,
            message: crossCurrencyMoveMessage(
              'transaction',
              sourceCurrency,
              resolvedAccount.currency
            ),
          }
        }
      }

      const newAccountId = resolvedAccount?.success ? resolvedAccount.id : accountId || oldAccountId
      const newCurrency = sourceCurrency

      let newCategoryId = tx.category_id
      if (newType === 'transfer') {
        newCategoryId = null
      } else if (category !== undefined) {
        const resolvedCategory = resolveCategoryId(category)
        if (!resolvedCategory.success) {
          return { success: false, message: resolvedCategory.message }
        }
        newCategoryId = resolvedCategory.id
      }

      if (newType !== 'transfer' && transferToAccountId !== undefined) {
        return {
          success: false,
          message: 'transferToAccountId can only be used when the transaction type is transfer.',
        }
      }

      let newTransferToAccountId: string | null = null
      if (newType === 'transfer') {
        const resolvedDestination = resolveTransferDestination(
          transferToAccountId ?? tx.transfer_to_account_id ?? undefined,
          {
            id: newAccountId,
            currency: newCurrency,
            accountMode: 'transactional',
          }
        )
        if (!resolvedDestination.success) {
          return { success: false, message: resolvedDestination.message }
        }
        newTransferToAccountId = resolvedDestination.id
      }

      let newRecurringRuleId = tx.recurring_rule_id ?? null
      if (recurringRuleId !== undefined) {
        newRecurringRuleId = recurringRuleId === '' ? null : recurringRuleId
      }

      const updatedTx: TransactionRow = {
        ...tx,
        amount: newAmount,
        type: newType,
        description: description !== undefined ? description : tx.description,
        category_id: newCategoryId,
        date: date || tx.date,
        notes: notes !== undefined ? (notes === '' ? null : notes) : tx.notes,
        account_id: newAccountId,
        currency: newCurrency,
        transfer_to_account_id: newTransferToAccountId,
        status: newStatus,
        source: source !== undefined ? (source === '' ? null : source) : (tx.source ?? null),
        note: note !== undefined ? (note === '' ? null : note) : (tx.note ?? null),
        recurring_rule_id: newRecurringRuleId,
        ledger_treatment: newLedgerTreatment,
        reporting_treatment: newReportingTreatment,
        staging_batch_id: newStagingBatchId,
      }

      if (updatedTx.recurring_rule_id) {
        const resolvedRecurringRule = resolveRecurringRuleId(updatedTx.recurring_rule_id, {
          accountId: updatedTx.account_id,
          type: updatedTx.type,
          currency: updatedTx.currency,
        })
        if (!resolvedRecurringRule.success) {
          return { success: false, message: resolvedRecurringRule.message }
        }
        updatedTx.recurring_rule_id = resolvedRecurringRule.id
      }

      const oldImpact = getBalanceImpact(tx)
      if (!oldImpact.success) {
        return { success: false, message: oldImpact.message }
      }
      const newImpact = getBalanceImpact(updatedTx)
      if (!newImpact.success) {
        return { success: false, message: newImpact.message }
      }
      const balanceDeltas = diffBalanceImpacts(oldImpact.impacts, newImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const referencedFinancialFailure = protectedFinancialTransactionFailure(tx, 'update')
      if (referencedFinancialFailure) return referencedFinancialFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
      if (dryRun) {
        const auditPreview = buildTransactionBalanceAuditPreview({
          action: 'update',
          before: tx,
          after: updatedTx,
          balanceDeltas,
          balancesBefore,
        })

        return {
          success: true,
          dryRun: true,
          balanceImpact: formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames),
          wouldUpdate: {
            transactionId,
            before: transactionAuditSnapshot(tx),
            after: transactionAuditSnapshot(updatedTx),
            validation: {
              status: updatedTx.status,
              currency: updatedTx.currency,
              recurringRuleId: updatedTx.recurring_rule_id,
            },
            balanceImpact: formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames),
            balanceDeltas: auditPreview.balanceChanges,
            auditPreview,
          },
          message: `Dry run: transaction ${transactionId} would be updated; no changes were written.`,
        }
      }
      applyBalanceDeltas(balanceDeltas)

      const updateResult = execute(
        `UPDATE transactions
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7, currency = $8, transfer_to_account_id = $9, status = $10, source = $11, note = $12, recurring_rule_id = $13, ledger_treatment = $14, reporting_treatment = $15, staging_batch_id = $16,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $17`,
        [
          updatedTx.amount,
          updatedTx.type,
          updatedTx.description,
          updatedTx.category_id,
          updatedTx.date,
          updatedTx.notes,
          updatedTx.account_id,
          updatedTx.currency,
          updatedTx.transfer_to_account_id,
          updatedTx.status,
          updatedTx.source,
          updatedTx.note,
          updatedTx.recurring_rule_id,
          updatedTx.ledger_treatment,
          updatedTx.reporting_treatment,
          updatedTx.staging_batch_id,
          transactionId,
        ]
      )

      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Transaction ${transactionId} could not be updated safely.`)
      }

      writeTransactionBalanceAudit({
        action: 'update',
        before: tx,
        after: updatedTx,
        balanceDeltas,
        balancesBefore,
      })

      const displayAmount = amount !== undefined ? amount : fromCentavos(oldAmountCentavos)

      return {
        success: true,
        dryRun: false,
        transaction: {
          id: transactionId,
          amount: displayAmount,
          type: updatedTx.type,
          description: updatedTx.description,
          accountId: updatedTx.account_id,
          transferToAccountId: updatedTx.transfer_to_account_id,
          date: updatedTx.date,
          notes: updatedTx.notes,
          status: updatedTx.status,
          source: updatedTx.source,
          note: updatedTx.note,
          recurringRuleId: updatedTx.recurring_rule_id,
          ledgerTreatment: updatedTx.ledger_treatment,
          reportingTreatment: updatedTx.reporting_treatment,
          stagingBatchId: updatedTx.staging_batch_id,
        },
        message: `Updated transaction ${transactionId}: $${displayAmount.toFixed(2)} ${updatedTx.type}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 3. delete-transaction
// ---------------------------------------------------------------------------

const deleteTransaction: ToolDefinition = {
  name: 'delete-transaction',
  description:
    'Delete a transaction. Use this when the user wants to remove a transaction. The account balance will be adjusted accordingly.',
  schema: z.object({
    transactionId: z.string().describe('The ID of the transaction to delete'),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe('Validate and preview the deletion without writing it'),
  }),
  execute: async ({ transactionId, dryRun }) => {
    return transaction(() => {
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const lifecycleFailure = protectedPlaceholderLifecycleFailure(tx, 'delete')
      if (lifecycleFailure) return lifecycleFailure
      const financialFailure = protectedFinancialTransactionFailure(tx, 'delete', false)
      if (financialFailure) return financialFailure

      const balanceImpact = getBalanceImpact(tx)
      if (!balanceImpact.success) {
        return { success: false, message: balanceImpact.message }
      }
      const balanceDeltas = invertBalanceImpacts(balanceImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const referencedFinancialFailure = protectedFinancialTransactionFailure(tx, 'delete')
      if (referencedFinancialFailure) return referencedFinancialFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
      if (dryRun) {
        const auditPreview = buildTransactionBalanceAuditPreview({
          action: 'delete',
          before: tx,
          after: null,
          balanceDeltas,
          balancesBefore,
        })

        return {
          success: true,
          dryRun: true,
          balanceImpact: formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames),
          wouldDelete: {
            transactionId,
            transaction: transactionAuditSnapshot(tx),
            balanceImpact: formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames),
            balanceDeltas: auditPreview.balanceChanges,
            auditPreview,
          },
          message: `Dry run: transaction ${transactionId} would be deleted; no changes were written.`,
        }
      }
      applyBalanceDeltas(balanceDeltas)

      execute('DELETE FROM transactions WHERE id = $1', [transactionId])
      writeTransactionBalanceAudit({
        action: 'delete',
        before: tx,
        after: null,
        balanceDeltas,
        balancesBefore,
      })

      return {
        success: true,
        dryRun: false,
        message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}" from ${tx.date}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 4. query-transactions
// ---------------------------------------------------------------------------

const queryTransactions: ToolDefinition = {
  name: 'query-transactions',
  description:
    'Search and filter transactions. Use this when the user asks about their transactions, wants to find specific ones, or asks questions about their financial history.',
  schema: z.object({
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    categoryId: boundedText('Category ID', 'Filter by category ID', 128).optional(),
    type: z
      .enum(['expense', 'income', 'transfer'])
      .optional()
      .describe('Filter by transaction type'),
    status: z
      .enum(['pending', 'posted', 'cleared'])
      .optional()
      .describe('Filter by transaction status'),
    ledgerTreatment: z
      .enum(['normal', 'staged_no_balance_impact'])
      .optional()
      .describe('Filter by ledger treatment'),
    reportingTreatment: z
      .enum(['normal', 'exclude_from_cashflow'])
      .optional()
      .describe('Filter by reporting treatment'),
    stagingBatchId: boundedText('Staging batch ID', 'Filter by staging batch', 128).optional(),
    includeArchived: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include archived provenance rows'),
    startDate: isoDate('Start date (YYYY-MM-DD) inclusive').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) inclusive').optional(),
    search: boundedText(
      'Search term',
      'Search term to match against transaction descriptions',
      200
    ).optional(),
    tag: boundedText('Tag', 'Filter by transaction tag label or key', 120).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Maximum number of results (default 20, max 100)'),
  }),
  execute: async ({
    accountId,
    categoryId,
    type,
    status,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId,
    includeArchived,
    startDate,
    endDate,
    search,
    tag,
    limit,
  }) => {
    const conditions: string[] = []
    const params: unknown[] = []
    let paramIndex = 0
    const tagKey = tag ? normalizeTransactionTagKey(tag) : null

    if (tag && !tagKey) {
      return { success: false, message: 'Tag filter must not be empty.' }
    }

    if (accountId) {
      paramIndex++
      const sourceAccountParam = paramIndex
      paramIndex++
      const destinationAccountParam = paramIndex
      conditions.push(
        `(t.account_id = $${sourceAccountParam} OR t.transfer_to_account_id = $${destinationAccountParam})`
      )
      params.push(accountId, accountId)
    }
    if (categoryId) {
      paramIndex++
      conditions.push(`t.category_id = $${paramIndex}`)
      params.push(categoryId)
    }
    if (type) {
      paramIndex++
      conditions.push(`t.type = $${paramIndex}`)
      params.push(type)
    }
    if (status) {
      paramIndex++
      conditions.push(`COALESCE(NULLIF(TRIM(t.status), ''), 'posted') = $${paramIndex}`)
      params.push(status)
    }
    if (ledgerTreatment) {
      paramIndex++
      conditions.push(`COALESCE(t.ledger_treatment, 'normal') = $${paramIndex}`)
      params.push(ledgerTreatment)
    }
    if (reportingTreatment) {
      paramIndex++
      conditions.push(`COALESCE(t.reporting_treatment, 'normal') = $${paramIndex}`)
      params.push(reportingTreatment)
    }
    if (stagingBatchId) {
      paramIndex++
      conditions.push(`t.staging_batch_id = $${paramIndex}`)
      params.push(stagingBatchId)
    }
    if (!includeArchived) conditions.push(`COALESCE(t.is_archived, 0) = 0`)
    if (startDate) {
      paramIndex++
      conditions.push(`t.date >= $${paramIndex}`)
      params.push(startDate)
    }
    if (endDate) {
      paramIndex++
      conditions.push(`t.date <= $${paramIndex}`)
      params.push(endDate)
    }
    if (search) {
      paramIndex++
      conditions.push(`t.description LIKE $${paramIndex}`)
      params.push(`%${search}%`)
    }
    if (tagKey) {
      paramIndex++
      conditions.push(`json_valid(t.tags) AND EXISTS (
        SELECT 1
        FROM json_each(t.tags) AS tag
        WHERE (tag.type = 'text' AND lower(trim(tag.value)) = $${paramIndex})
           OR (tag.type = 'object' AND (
             lower(trim(COALESCE(json_extract(tag.value, '$.key'), ''))) = $${paramIndex}
             OR lower(trim(COALESCE(json_extract(tag.value, '$.label'), ''))) = $${paramIndex}
             OR lower(trim(COALESCE(json_extract(tag.value, '$.name'), ''))) = $${paramIndex}
              OR lower(trim(COALESCE(json_extract(tag.value, '$.value'), ''))) = $${paramIndex}
            ))
      )`)
      params.push(tagKey, tagKey, tagKey, tagKey, tagKey)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const queryParams = [...params]
    const limitClause = `LIMIT $${paramIndex + 1}`
    queryParams.push(limit)

    const transactionRows = await query<QueriedTransactionRow>(
      `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.notes, t.status, t.source, t.note, t.recurring_rule_id, t.tags, t.transfer_to_account_id,
               t.ledger_treatment, t.reporting_treatment, t.transaction_kind, t.staging_batch_id, t.reconciliation_id, t.matched_transaction_id, t.is_archived,
              t.is_placeholder, t.placeholder_status, t.resolved_at, t.resolved_by_transaction_id, t.placeholder_reason, t.placeholder_parent_transaction_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
               a.name as account_name,
               ta.name as transfer_to_account_name,
               ar.reconciliation_date, ar.account_id AS reconciliation_account_id,
               ar.adjustment_amount AS reconciliation_adjustment_amount,
               ar.staging_batch_id AS reconciliation_staging_batch_id,
               ar.statement_start_date, ar.statement_end_date,
               ar.source AS reconciliation_source, ar.note AS reconciliation_note
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
        LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
        LEFT JOIN account_reconciliations ar ON t.reconciliation_id = ar.id
       ${whereClause}
       ORDER BY t.date DESC, t.created_at DESC
       ${limitClause}`,
      queryParams
    )

    const transactions = transactionRows
    const totalMatched =
      (
        await query<{ count: number }>(
          `SELECT COUNT(*) as count FROM transactions t ${whereClause}`,
          params
        )
      )[0]?.count ?? 0

    return {
      transactions: transactions.map((t) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        currency: t.currency,
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        transferToAccountId: t.transfer_to_account_id,
        transferToAccount: t.transfer_to_account_name,
        date: t.date,
        notes: t.notes,
        status: t.status,
        source: t.source,
        note: t.note,
        recurringRuleId: t.recurring_rule_id,
        ledgerTreatment: normalizeLedgerTreatment(t.ledger_treatment),
        reportingTreatment: normalizeReportingTreatment(t.reporting_treatment),
        transactionKind: t.transaction_kind ?? 'standard',
        stagingBatchId: t.staging_batch_id,
        reconciliationId: t.reconciliation_id,
        reconciliation: t.reconciliation_id
          ? {
              id: t.reconciliation_id,
              accountId: t.reconciliation_account_id,
              date: t.reconciliation_date,
              adjustmentAmount: fromCentavos(t.reconciliation_adjustment_amount ?? 0),
              adjustmentAmountCentavos: t.reconciliation_adjustment_amount,
              stagingBatchId: t.reconciliation_staging_batch_id,
              statementStartDate: t.statement_start_date,
              statementEndDate: t.statement_end_date,
              source: t.reconciliation_source,
              note: t.reconciliation_note,
            }
          : null,
        matchedTransactionId: t.matched_transaction_id,
        isArchived: t.is_archived === 1,
        ...transactionTagOutput(parseStoredTransactionTags(t.tags)),
        isPlaceholder: Boolean(t.is_placeholder),
        placeholderStatus: t.placeholder_status,
        resolvedAt: t.resolved_at,
        resolvedByTransactionId: t.resolved_by_transaction_id,
        placeholderReason: t.placeholder_reason,
        placeholderParentTransactionId: t.placeholder_parent_transaction_id,
      })),
      count: transactions.length,
      totalMatched,
      message:
        transactions.length === 0
          ? 'No transactions found matching your criteria.'
          : `Found ${totalMatched} transaction${totalMatched !== 1 ? 's' : ''}${transactions.length < totalMatched ? `, showing first ${transactions.length}` : ''}.`,
    }
  },
}

const matchTransferTransactions: ToolDefinition = {
  name: 'match-transfer-transactions',
  description:
    'Preview or atomically link an exact expense/income pair as one transfer while preserving the imported mirror as archived provenance.',
  schema: z.object({
    sourceTransactionId: boundedText(
      'Source transaction ID',
      'Expense transaction from the funding account',
      128
    ),
    mirrorTransactionId: boundedText(
      'Mirror transaction ID',
      'Income transaction imported on the destination account',
      128
    ),
    dateWindowDays: z
      .number()
      .int()
      .min(0)
      .max(7)
      .optional()
      .default(3)
      .describe('Maximum number of days between the two statement rows'),
    apply: z.boolean().optional().default(false).describe('Apply the atomic transfer match'),
    source: boundedText('Source', 'Optional audit source', 120).optional(),
    note: boundedText('Note', 'Optional audit note', 500).optional(),
  }),
  execute: async ({
    sourceTransactionId,
    mirrorTransactionId,
    dateWindowDays,
    apply,
    source,
    note,
  }) => {
    if (sourceTransactionId === mirrorTransactionId) {
      return {
        success: false,
        reason: 'same_transaction',
        message: 'A transfer match requires two distinct transactions.',
      }
    }

    const buildMatch = () => {
      const rows = query<TransactionRow>('SELECT * FROM transactions WHERE id IN ($1, $2)', [
        sourceTransactionId,
        mirrorTransactionId,
      ])
      const sourceTransaction = rows.find((row) => row.id === sourceTransactionId)
      const mirrorTransaction = rows.find((row) => row.id === mirrorTransactionId)
      if (!sourceTransaction || !mirrorTransaction) {
        return {
          success: false as const,
          reason: 'transaction_not_found' as const,
          message: 'Both source and mirror transactions must exist.',
        }
      }
      const sourceModeFailure = snapshotOnlyAccountFailure(sourceTransaction.account_id)
      if (sourceModeFailure) return sourceModeFailure
      const mirrorModeFailure = snapshotOnlyAccountFailure(mirrorTransaction.account_id)
      if (mirrorModeFailure) return mirrorModeFailure
      if (sourceTransaction.type !== 'expense' || mirrorTransaction.type !== 'income') {
        return {
          success: false as const,
          reason: 'invalid_transfer_pair' as const,
          message: 'The source must be an expense and the destination mirror must be an income.',
        }
      }
      if (sourceTransaction.account_id === mirrorTransaction.account_id) {
        return {
          success: false as const,
          reason: 'same_account' as const,
          message: 'Transfer rows must belong to different accounts.',
        }
      }
      if (sourceTransaction.amount !== mirrorTransaction.amount) {
        return {
          success: false as const,
          reason: 'amount_mismatch' as const,
          message: 'Transfer matching requires exact centavo amounts.',
        }
      }
      if (
        !sourceTransaction.currency ||
        !mirrorTransaction.currency ||
        normalizeCurrencyCode(sourceTransaction.currency) !==
          normalizeCurrencyCode(mirrorTransaction.currency)
      ) {
        return {
          success: false as const,
          reason: 'currency_mismatch' as const,
          message: 'Transfer matching requires the same known currency on both rows.',
        }
      }
      const daysApart = Math.abs(
        dayjs(sourceTransaction.date)
          .startOf('day')
          .diff(dayjs(mirrorTransaction.date).startOf('day'), 'day')
      )
      if (daysApart > dateWindowDays) {
        return {
          success: false as const,
          reason: 'date_window_exceeded' as const,
          message: `Transfer rows are ${daysApart} days apart, outside the ${dateWindowDays}-day window.`,
        }
      }
      const invalidLifecycle = [sourceTransaction, mirrorTransaction].find(
        (row) =>
          !['posted', 'cleared'].includes(normalizeTransactionStatus(row.status)) ||
          normalizeLedgerTreatment(row.ledger_treatment) !== 'normal' ||
          normalizeReportingTreatment(row.reporting_treatment) !== 'normal' ||
          row.is_archived === 1 ||
          row.matched_transaction_id
      )
      if (invalidLifecycle) {
        return {
          success: false as const,
          reason: 'transaction_not_matchable' as const,
          message: `Transaction ${invalidLifecycle.id} must be unarchived, unmatched, normal-ledger, normal-reporting, and posted or cleared.`,
        }
      }
      for (const row of [sourceTransaction, mirrorTransaction]) {
        const financialFailure = protectedFinancialTransactionFailure(row, 'match')
        if (financialFailure) return financialFailure
      }

      const transfer: TransactionRow = {
        ...sourceTransaction,
        transfer_to_account_id: mirrorTransaction.account_id,
        type: 'transfer',
        reporting_treatment: 'exclude_from_cashflow',
        matched_transaction_id: mirrorTransaction.id,
      }
      const archivedMirror: TransactionRow = {
        ...mirrorTransaction,
        ledger_treatment: 'normal',
        reporting_treatment: 'exclude_from_cashflow',
        transaction_kind: 'archived_transfer_mirror',
        matched_transaction_id: sourceTransaction.id,
        is_archived: 1,
      }
      const sourceBeforeImpact = getBalanceImpact(sourceTransaction)
      const mirrorBeforeImpact = getBalanceImpact(mirrorTransaction)
      const sourceAfterImpact = getBalanceImpact(transfer)
      const mirrorAfterImpact = getBalanceImpact(archivedMirror)
      if (
        !sourceBeforeImpact.success ||
        !mirrorBeforeImpact.success ||
        !sourceAfterImpact.success ||
        !mirrorAfterImpact.success
      ) {
        return {
          success: false as const,
          reason: 'balance_impact_invalid' as const,
          message: 'The transfer pair has invalid balance-impact data.',
        }
      }
      const oldImpacts = combineBalanceImpacts(
        sourceBeforeImpact.impacts,
        mirrorBeforeImpact.impacts
      )
      const newImpacts = combineBalanceImpacts(sourceAfterImpact.impacts, mirrorAfterImpact.impacts)
      const balanceDeltas = diffBalanceImpacts(oldImpacts, newImpacts)
      return {
        success: true as const,
        sourceTransaction,
        mirrorTransaction,
        transfer,
        archivedMirror,
        daysApart,
        balanceDeltas,
      }
    }

    const match = buildMatch()
    if (!match.success) return match
    const balancesBefore = readAccountBalances([...match.balanceDeltas.keys()])
    const preview = {
      source: publicTransactionSnapshot(match.sourceTransaction),
      mirror: publicTransactionSnapshot(match.mirrorTransaction),
      transfer: publicTransactionSnapshot(match.transfer),
      archivedMirror: publicTransactionSnapshot(match.archivedMirror),
      matchEvidence: {
        exactAmount: true,
        sameCurrency: true,
        daysApart: match.daysApart,
        dateWindowDays,
      },
      balanceImpact: formatBalanceImpactPreview(
        buildBalanceAuditChanges(match.balanceDeltas, balancesBefore),
        readAccountNames([...match.balanceDeltas.keys()])
      ),
    }
    if (!apply) {
      return {
        success: true,
        dryRun: true,
        applyRequired: true,
        wouldMatch: preview,
        message: `Dry run: transactions ${sourceTransactionId} and ${mirrorTransactionId} would be linked as one transfer.`,
      }
    }

    return transaction(() => {
      const current = buildMatch()
      if (!current.success) throw new Error(current.message)
      const currentBalancesBefore = readAccountBalances([...current.balanceDeltas.keys()])
      applyBalanceDeltas(current.balanceDeltas)
      assertSingleRowUpdated(
        execute(
          `UPDATE transactions
           SET transfer_to_account_id = $1, type = 'transfer',
               reporting_treatment = 'exclude_from_cashflow', matched_transaction_id = $2,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $3 AND COALESCE(is_archived, 0) = 0`,
          [
            current.mirrorTransaction.account_id,
            current.mirrorTransaction.id,
            current.sourceTransaction.id,
          ]
        ),
        `Source transaction ${sourceTransactionId} could not be converted safely.`
      )
      assertSingleRowUpdated(
        execute(
          `UPDATE transactions
           SET reporting_treatment = 'exclude_from_cashflow',
               transaction_kind = 'archived_transfer_mirror', matched_transaction_id = $1,
               is_archived = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $2 AND COALESCE(is_archived, 0) = 0`,
          [current.sourceTransaction.id, current.mirrorTransaction.id]
        ),
        `Mirror transaction ${mirrorTransactionId} could not be archived safely.`
      )
      writeTransactionBalanceAudit({
        action: 'match-transfer',
        before: current.sourceTransaction,
        after: current.transfer,
        balanceDeltas: current.balanceDeltas,
        balancesBefore: currentBalancesBefore,
      })
      writeAuditLog({
        entity: 'transaction',
        entityId: current.mirrorTransaction.id,
        action: 'archive-transfer-mirror',
        before: publicTransactionSnapshot(current.mirrorTransaction),
        after: publicTransactionSnapshot(current.archivedMirror),
        source: source ?? null,
        note: note ?? null,
      })
      return {
        success: true,
        dryRun: false,
        matched: {
          ...preview,
          source: publicTransactionSnapshot(current.transfer),
          mirror: publicTransactionSnapshot(current.archivedMirror),
          balanceImpact: formatBalanceImpactPreview(
            buildBalanceAuditChanges(current.balanceDeltas, currentBalancesBefore),
            readAccountNames([...current.balanceDeltas.keys()])
          ),
        },
        message: `Linked transactions ${sourceTransactionId} and ${mirrorTransactionId} as one transfer and preserved the mirror as archived provenance.`,
      }
    })
  },
}

const unmatchTransferTransactions: ToolDefinition = {
  name: 'unmatch-transfer-transactions',
  description:
    'Preview or atomically reverse a matched transfer, restoring the source expense and archived income mirror without deleting statement provenance.',
  schema: z.object({
    sourceTransactionId: boundedText(
      'Source transaction ID',
      'Matched source transfer transaction ID',
      128
    ),
    apply: z.boolean().optional().default(false).describe('Apply the unmatch; defaults to preview'),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
  }),
  execute: async ({ sourceTransactionId, apply, source, note }) => {
    const buildUnmatch = () => {
      const sourceTransaction = query<TransactionRow>(
        'SELECT * FROM transactions WHERE id = $1 LIMIT 1',
        [sourceTransactionId]
      )[0]
      if (!sourceTransaction) {
        return {
          success: false as const,
          reason: 'transaction_not_found' as const,
          message: `Transaction ${sourceTransactionId} not found.`,
        }
      }
      const mirrorId = sourceTransaction.matched_transaction_id
      if (
        sourceTransaction.type !== 'transfer' ||
        sourceTransaction.is_archived === 1 ||
        (sourceTransaction.transaction_kind ?? 'standard') !== 'standard' ||
        !sourceTransaction.transfer_to_account_id ||
        !mirrorId
      ) {
        return {
          success: false as const,
          reason: 'not_matched_transfer' as const,
          message: `Transaction ${sourceTransactionId} is not a matched source transfer.`,
        }
      }
      const mirrorTransaction = query<TransactionRow>(
        'SELECT * FROM transactions WHERE id = $1 LIMIT 1',
        [mirrorId]
      )[0]
      if (
        !mirrorTransaction ||
        mirrorTransaction.is_archived !== 1 ||
        mirrorTransaction.transaction_kind !== 'archived_transfer_mirror' ||
        mirrorTransaction.matched_transaction_id !== sourceTransaction.id ||
        mirrorTransaction.account_id !== sourceTransaction.transfer_to_account_id ||
        mirrorTransaction.amount !== sourceTransaction.amount ||
        normalizeCurrencyCode(mirrorTransaction.currency) !==
          normalizeCurrencyCode(sourceTransaction.currency)
      ) {
        return {
          success: false as const,
          reason: 'invalid_transfer_provenance' as const,
          message:
            'The archived mirror is missing or no longer forms a reciprocal exact transfer pair.',
        }
      }
      const sourceModeFailure = snapshotOnlyAccountFailure(sourceTransaction.account_id)
      if (sourceModeFailure) return sourceModeFailure
      const mirrorModeFailure = snapshotOnlyAccountFailure(mirrorTransaction.account_id)
      if (mirrorModeFailure) return mirrorModeFailure

      const restoredSource: TransactionRow = {
        ...sourceTransaction,
        type: 'expense',
        transfer_to_account_id: null,
        reporting_treatment: 'normal',
        matched_transaction_id: null,
      }
      const restoredMirror: TransactionRow = {
        ...mirrorTransaction,
        transaction_kind: 'standard',
        reporting_treatment: 'normal',
        matched_transaction_id: null,
        is_archived: 0,
      }
      const deltas = new Map<string, number>()
      for (const [row, multiplier] of [
        [sourceTransaction, -1],
        [mirrorTransaction, -1],
        [restoredSource, 1],
        [restoredMirror, 1],
      ] as const) {
        const impact = getBalanceImpact(row)
        if (!impact.success) return impact
        for (const [accountId, amount] of impact.impacts) {
          addImpact(deltas, accountId, amount * multiplier)
        }
      }
      return {
        success: true as const,
        sourceTransaction,
        mirrorTransaction,
        restoredSource,
        restoredMirror,
        balanceDeltas: deltas,
      }
    }

    const previewState = buildUnmatch()
    if (!previewState.success) return previewState
    const balancesBefore = readAccountBalances([...previewState.balanceDeltas.keys()])
    const preview = {
      source: publicTransactionSnapshot(previewState.restoredSource),
      mirror: publicTransactionSnapshot(previewState.restoredMirror),
      balanceImpact: formatBalanceImpactPreview(
        buildBalanceAuditChanges(previewState.balanceDeltas, balancesBefore),
        readAccountNames([...previewState.balanceDeltas.keys()])
      ),
    }
    if (!apply) {
      return {
        success: true,
        dryRun: true,
        applyRequired: true,
        wouldUnmatch: preview,
        message: `Dry run: matched transfer ${sourceTransactionId} would be restored to its two original statement rows.`,
      }
    }

    return transaction(() => {
      const current = buildUnmatch()
      if (!current.success) throw new Error(current.message)
      const currentBalances = readAccountBalances([...current.balanceDeltas.keys()])
      applyBalanceDeltas(current.balanceDeltas)
      assertSingleRowUpdated(
        execute(
          `UPDATE transactions
           SET type = 'expense', transfer_to_account_id = NULL,
               reporting_treatment = 'normal', matched_transaction_id = NULL,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $1 AND type = 'transfer' AND matched_transaction_id = $2
             AND COALESCE(transaction_kind, 'standard') = 'standard'
             AND COALESCE(is_archived, 0) = 0`,
          [current.sourceTransaction.id, current.mirrorTransaction.id]
        ),
        `Source transfer ${sourceTransactionId} could not be unmatched safely.`
      )
      assertSingleRowUpdated(
        execute(
          `UPDATE transactions
           SET reporting_treatment = 'normal', transaction_kind = 'standard',
               matched_transaction_id = NULL, is_archived = 0,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = $1 AND transaction_kind = 'archived_transfer_mirror'
             AND matched_transaction_id = $2 AND is_archived = 1`,
          [current.mirrorTransaction.id, current.sourceTransaction.id]
        ),
        `Archived mirror ${current.mirrorTransaction.id} could not be restored safely.`
      )
      writeTransactionBalanceAudit({
        action: 'unmatch-transfer',
        before: current.sourceTransaction,
        after: current.restoredSource,
        balanceDeltas: current.balanceDeltas,
        balancesBefore: currentBalances,
      })
      writeAuditLog({
        entity: 'transaction',
        entityId: current.mirrorTransaction.id,
        action: 'restore-transfer-mirror',
        before: publicTransactionSnapshot(current.mirrorTransaction),
        after: publicTransactionSnapshot(current.restoredMirror),
        source: source ?? null,
        note: note ?? null,
      })
      return {
        success: true,
        dryRun: false,
        unmatched: {
          source: publicTransactionSnapshot(current.restoredSource),
          mirror: publicTransactionSnapshot(current.restoredMirror),
          balanceImpact: formatBalanceImpactPreview(
            buildBalanceAuditChanges(current.balanceDeltas, currentBalances),
            readAccountNames([...current.balanceDeltas.keys()])
          ),
        },
        message: `Unmatched transfer ${sourceTransactionId} and restored both original statement rows.`,
      }
    })
  },
}

const tagTransaction: ToolDefinition = {
  name: 'tag-transaction',
  description: 'Add a tag to an existing transaction using the transaction tags JSON field.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Transaction ID to tag', 128),
    tag: boundedText('Tag', 'Tag label to add', 120),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  execute: async ({ transactionId, tag, source, note, dryRun }) => {
    const normalizedTag = normalizeTransactionTagKey(tag)
    if (!normalizedTag) return { success: false, message: 'Tag must not be empty.' }

    return transaction(() => {
      const rows = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1 LIMIT 1', [
        transactionId,
      ])
      if (rows.length === 0)
        return { success: false, message: `Transaction ${transactionId} not found.` }

      const before = rows[0]
      const tagChange = addTransactionTag(before.tags, tag)
      const after: TransactionRow = {
        ...before,
        tags: serializeTransactionTags(tagChange.tags),
      }
      const beforeSnapshot = publicTransactionSnapshot(before)
      const afterSnapshot = publicTransactionSnapshot(after)

      if (dryRun) {
        return {
          success: true,
          action: 'tagged' as const,
          dryRun: true,
          changed: tagChange.changed,
          wouldUpdate: {
            transactionId,
            before: beforeSnapshot,
            after: afterSnapshot,
          },
          message: tagChange.changed
            ? `Dry run: tag "${tag}" would be added to transaction ${transactionId}.`
            : `Dry run: transaction ${transactionId} already has tag "${tag}".`,
        }
      }

      if (!tagChange.changed) {
        return {
          success: true,
          action: 'tagged' as const,
          changed: false,
          transaction: beforeSnapshot,
          message: `Transaction ${transactionId} already has tag "${tag}".`,
        }
      }

      const updateResult = execute(
        `UPDATE transactions SET tags = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
        [after.tags, transactionId]
      )
      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Transaction ${transactionId} could not be tagged safely.`)
      }
      writeAuditLog({
        entity: 'transaction',
        entityId: transactionId,
        action: 'tag',
        before: { transaction: beforeSnapshot },
        after: { transaction: afterSnapshot },
        source: source ?? null,
        note: note ?? null,
      })

      return {
        success: true,
        action: 'tagged' as const,
        changed: true,
        transaction: afterSnapshot,
        message: `Added tag "${tag}" to transaction ${transactionId}.`,
      }
    })
  },
}

const untagTransaction: ToolDefinition = {
  name: 'untag-transaction',
  description: 'Remove a tag from an existing transaction.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Transaction ID to untag', 128),
    tag: boundedText('Tag', 'Tag label or key to remove', 120),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  execute: async ({ transactionId, tag, source, note, dryRun }) => {
    const normalizedTag = normalizeTransactionTagKey(tag)
    if (!normalizedTag) return { success: false, message: 'Tag must not be empty.' }

    return transaction(() => {
      const rows = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1 LIMIT 1', [
        transactionId,
      ])
      if (rows.length === 0)
        return { success: false, message: `Transaction ${transactionId} not found.` }

      const before = rows[0]
      const tagChange = removeTransactionTag(before.tags, tag)
      const after: TransactionRow = {
        ...before,
        tags: serializeTransactionTags(tagChange.tags),
      }
      const beforeSnapshot = publicTransactionSnapshot(before)
      const afterSnapshot = publicTransactionSnapshot(after)

      if (dryRun) {
        return {
          success: true,
          action: 'untagged' as const,
          dryRun: true,
          changed: tagChange.changed,
          wouldUpdate: {
            transactionId,
            before: beforeSnapshot,
            after: afterSnapshot,
          },
          message: tagChange.changed
            ? `Dry run: tag "${tag}" would be removed from transaction ${transactionId}.`
            : `Dry run: transaction ${transactionId} does not have tag "${tag}".`,
        }
      }

      if (!tagChange.changed) {
        return {
          success: true,
          action: 'untagged' as const,
          changed: false,
          transaction: beforeSnapshot,
          message: `Transaction ${transactionId} does not have tag "${tag}".`,
        }
      }

      const updateResult = execute(
        `UPDATE transactions SET tags = $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2`,
        [after.tags, transactionId]
      )
      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Transaction ${transactionId} could not be untagged safely.`)
      }
      writeAuditLog({
        entity: 'transaction',
        entityId: transactionId,
        action: 'untag',
        before: { transaction: beforeSnapshot },
        after: { transaction: afterSnapshot },
        source: source ?? null,
        note: note ?? null,
      })

      return {
        success: true,
        action: 'untagged' as const,
        changed: true,
        transaction: afterSnapshot,
        message: `Removed tag "${tag}" from transaction ${transactionId}.`,
      }
    })
  },
}

const listTags: ToolDefinition = {
  name: 'list-tags',
  description: 'List transaction tags with usage counts.',
  schema: z.object({}),
  execute: async () => {
    const rows = query<{ id: string; date: string; tags: string | null }>(
      `SELECT id, date, tags
       FROM transactions
       WHERE tags IS NOT NULL AND TRIM(tags) NOT IN ('', '[]')
       ORDER BY date DESC, created_at DESC`,
      []
    )
    const tagsByKey = new Map<
      string,
      { key: string; label: string; count: number; lastUsedDate: string | null }
    >()

    for (const row of rows) {
      for (const tag of parseStoredTransactionTags(row.tags)) {
        const existing = tagsByKey.get(tag.key)
        if (!existing) {
          tagsByKey.set(tag.key, {
            key: tag.key,
            label: tag.label,
            count: 1,
            lastUsedDate: row.date ?? null,
          })
          continue
        }
        existing.count += 1
        if (row.date && (!existing.lastUsedDate || row.date > existing.lastUsedDate)) {
          existing.lastUsedDate = row.date
        }
      }
    }

    const tags = [...tagsByKey.values()].sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label)
    )

    return {
      tags,
      count: tags.length,
      message:
        tags.length === 0
          ? 'No transaction tags found.'
          : `Found ${tags.length} tag${tags.length === 1 ? '' : 's'}.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 5. get-spending-summary
// ---------------------------------------------------------------------------

const createPlaceholderTransaction: ToolDefinition = {
  name: 'create-placeholder-transaction',
  description:
    'Create an unresolved placeholder transaction when the amount is known but final merchant/category details are not yet confirmed.',
  schema: z.object({
    amount: positiveMoneyAmount('Placeholder amount'),
    type: z.enum(['expense', 'income']).optional().default('expense'),
    description: boundedText('Description', 'Placeholder description', 500)
      .optional()
      .default('Unknown transaction'),
    accountId: boundedText('Account ID', 'Account ID to attach the placeholder to', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, ID, or exact account name',
      200
    ).optional(),
    category: boundedText('Category', 'Optional category name or ID', 200).optional(),
    date: isoDate('Transaction date (YYYY-MM-DD)').optional(),
    notes: boundedText('Notes', 'Transaction notes', 2000).optional(),
    placeholderReason: boundedText(
      'Placeholder reason',
      'Why this transaction is not fully resolved yet',
      500
    ).optional(),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  execute: async ({
    amount,
    type,
    description,
    accountId,
    account,
    category,
    date,
    notes,
    placeholderReason,
    source,
    note,
    dryRun,
  }) => {
    const resolvedAccount = resolveAccountId(accountId, account)
    if (!resolvedAccount.success) return resolvedAccount
    const resolvedAccountId = resolvedAccount.id
    if (resolvedAccount.accountMode === 'snapshot_only') {
      return {
        success: false,
        reason: 'snapshot_only_account',
        message: `Account ${resolvedAccountId} is snapshot-only and cannot be used for transaction ledger writes.`,
      }
    }
    const categoryResult = resolvePlaceholderCategory(category)
    if (!categoryResult.success) return categoryResult

    const amountCentavos = toCentavos(amount)
    const nowDate = date ?? dayjs().format('YYYY-MM-DD')
    const tx: TransactionRow = {
      id: generateId(),
      account_id: resolvedAccountId,
      category_id: categoryResult.categoryId,
      transfer_to_account_id: null,
      type,
      amount: amountCentavos,
      currency: resolvedAccount.currency,
      description,
      notes: notes ?? null,
      status: 'posted',
      source: source ?? null,
      note: note ?? null,
      recurring_rule_id: null,
      is_placeholder: 1,
      placeholder_status: 'unresolved',
      resolved_at: null,
      resolved_by_transaction_id: null,
      placeholder_reason: placeholderReason ?? null,
      placeholder_parent_transaction_id: null,
      date: nowDate,
    }

    const balanceImpact = getBalanceImpact(tx)
    if (!balanceImpact.success) return { success: false, message: balanceImpact.message }
    const balanceDeltas = balanceImpact.impacts
    const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
    if (archivedMutationFailure) return archivedMutationFailure
    const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
    const auditPreview = buildTransactionBalanceAuditPreview({
      action: 'create',
      before: null,
      after: tx,
      balanceDeltas,
      balancesBefore,
    })
    const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
    const formattedBalanceImpact = formatBalanceImpactPreview(
      auditPreview.balanceChanges,
      accountNames
    )

    if (dryRun) {
      return {
        success: true,
        dryRun: true,
        wouldCreate: publicTransactionSnapshot(tx),
        balanceImpact: formattedBalanceImpact,
        auditPreview,
        message: `Dry run: placeholder transaction ${tx.id} would be created; no changes were written.`,
      }
    }

    return transaction(() => {
      applyBalanceDeltas(balanceDeltas)
      execute(
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, is_placeholder, placeholder_status, resolved_at, resolved_by_transaction_id, placeholder_reason, placeholder_parent_transaction_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
        [
          tx.id,
          tx.account_id,
          tx.category_id,
          tx.transfer_to_account_id,
          tx.type,
          tx.amount,
          tx.currency,
          tx.description,
          tx.notes,
          tx.status,
          tx.source,
          tx.note,
          tx.recurring_rule_id,
          tx.is_placeholder,
          tx.placeholder_status,
          tx.resolved_at,
          tx.resolved_by_transaction_id,
          tx.placeholder_reason,
          tx.placeholder_parent_transaction_id,
          tx.date,
        ]
      )
      writeTransactionBalanceAudit({
        action: 'create',
        before: null,
        after: tx,
        balanceDeltas,
        balancesBefore,
      })
      return {
        success: true,
        dryRun: false,
        transaction: publicTransactionSnapshot(tx),
        balanceImpact: formattedBalanceImpact,
        message: `Created unresolved placeholder transaction ${tx.id}.`,
      }
    })
  },
}

const listPlaceholderTransactions: ToolDefinition = {
  name: 'list-placeholder-transactions',
  description:
    'List transactions marked as placeholders, optionally filtered by placeholder status.',
  schema: z.object({
    status: placeholderStatusSchema.optional().describe('Filter by placeholder status'),
    accountId: boundedText('Account ID', 'Filter by account ID', 128).optional(),
    account: boundedText(
      'Account reference',
      'Account alias, ID, or exact account name',
      200
    ).optional(),
    limit: z.number().int().min(1).max(100).optional().default(50),
  }),
  execute: async ({ status, accountId, account, limit }) => {
    const conditions = ['t.is_placeholder = 1']
    const params: unknown[] = []
    let paramIndex = 0

    if (status) {
      paramIndex++
      conditions.push(`t.placeholder_status = $${paramIndex}`)
      params.push(status)
    }
    if (accountId || account) {
      const resolvedAccount = resolveAccountId(accountId, account)
      if (!resolvedAccount.success) return resolvedAccount
      paramIndex++
      conditions.push(`t.account_id = $${paramIndex}`)
      params.push(resolvedAccount.id)
    }
    paramIndex++
    params.push(limit)

    const placeholders = query<QueriedTransactionRow>(
      `SELECT t.id, t.description, t.amount, t.currency, t.type, t.date, t.notes, t.status, t.source, t.note, t.recurring_rule_id, t.tags, t.transfer_to_account_id,
              t.is_placeholder, t.placeholder_status, t.resolved_at, t.resolved_by_transaction_id, t.placeholder_reason, t.placeholder_parent_transaction_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name,
              ta.name as transfer_to_account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT $${paramIndex}`,
      params
    )

    return {
      placeholders: placeholders.map((t) => ({
        id: t.id,
        description: t.description,
        amount: fromCentavos(t.amount),
        amountCentavos: t.amount,
        currency: t.currency,
        type: t.type,
        category: t.category_name,
        account: t.account_name,
        date: t.date,
        notes: t.notes,
        status: t.status,
        source: t.source,
        note: t.note,
        placeholderStatus: t.placeholder_status,
        resolvedAt: t.resolved_at,
        resolvedByTransactionId: t.resolved_by_transaction_id,
        placeholderReason: t.placeholder_reason,
        placeholderParentTransactionId: t.placeholder_parent_transaction_id,
      })),
      count: placeholders.length,
      message:
        placeholders.length === 0
          ? 'No placeholder transactions found.'
          : `Found ${placeholders.length} placeholder transaction${placeholders.length === 1 ? '' : 's'}.`,
    }
  },
}

const resolvePlaceholderTransaction: ToolDefinition = {
  name: 'resolve-placeholder-transaction',
  description:
    'Resolve an unresolved placeholder by updating the original transaction with final known details while preserving placeholder audit metadata.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Placeholder transaction ID', 128),
    amount: positiveMoneyAmount('Resolved amount').optional(),
    type: z.enum(['expense', 'income']).optional(),
    description: boundedText('Description', 'Resolved transaction description', 500).optional(),
    category: boundedText('Category', 'Resolved category name or ID', 200).optional(),
    date: isoDate('Resolved transaction date').optional(),
    notes: boundedText('Notes', 'Resolved transaction notes', 2000).optional(),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  execute: async ({
    transactionId,
    amount,
    type,
    description,
    category,
    date,
    notes,
    source,
    note,
    dryRun,
  }) => {
    return transaction(() => {
      const rows = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1 LIMIT 1', [
        transactionId,
      ])
      if (rows.length === 0)
        return { success: false, message: `Transaction ${transactionId} not found.` }
      const before = rows[0]
      const unresolvedError = assertUnresolvedPlaceholder(before)
      if (unresolvedError) return unresolvedError
      const categoryResult = resolvePlaceholderCategory(category)
      if (!categoryResult.success) return categoryResult

      const after: TransactionRow = {
        ...before,
        amount: amount !== undefined ? toCentavos(amount) : before.amount,
        type: type ?? before.type,
        description: description ?? before.description,
        category_id: category !== undefined ? categoryResult.categoryId : before.category_id,
        date: date ?? before.date,
        notes: notes !== undefined ? (notes === '' ? null : notes) : before.notes,
        source: source !== undefined ? (source === '' ? null : source) : (before.source ?? null),
        note: note !== undefined ? (note === '' ? null : note) : (before.note ?? null),
        placeholder_status: 'resolved',
        resolved_at: dayjs().toISOString(),
        resolved_by_transaction_id: before.id,
      }
      const oldImpact = getBalanceImpact(before)
      if (!oldImpact.success) return { success: false, message: oldImpact.message }
      const newImpact = getBalanceImpact(after)
      if (!newImpact.success) return { success: false, message: newImpact.message }
      const balanceDeltas = diffBalanceImpacts(oldImpact.impacts, newImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      const auditPreview = buildTransactionBalanceAuditPreview({
        action: 'update',
        before,
        after,
        balanceDeltas,
        balancesBefore,
      })
      const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
      const formattedBalanceImpact = formatBalanceImpactPreview(
        auditPreview.balanceChanges,
        accountNames
      )

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldResolve: {
            before: publicTransactionSnapshot(before),
            after: publicTransactionSnapshot(after),
          },
          balanceImpact: formattedBalanceImpact,
          auditPreview,
          message: `Dry run: placeholder transaction ${transactionId} would be resolved; no changes were written.`,
        }
      }

      const updateResult = execute(
        `UPDATE transactions
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, source = $7, note = $8,
             placeholder_status = 'resolved', resolved_at = $9, resolved_by_transaction_id = $10,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $11 AND is_placeholder = 1 AND COALESCE(placeholder_status, 'unresolved') = 'unresolved'`,
        [
          after.amount,
          after.type,
          after.description,
          after.category_id,
          after.date,
          after.notes,
          after.source,
          after.note,
          after.resolved_at,
          after.resolved_by_transaction_id,
          transactionId,
        ]
      )
      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Placeholder transaction ${transactionId} could not be resolved safely.`)
      }
      applyBalanceDeltas(balanceDeltas)
      writeTransactionBalanceAudit({
        action: 'update',
        before,
        after,
        balanceDeltas,
        balancesBefore,
      })
      return {
        success: true,
        dryRun: false,
        transaction: publicTransactionSnapshot(after),
        balanceImpact: formattedBalanceImpact,
        message: `Resolved placeholder transaction ${transactionId}.`,
      }
    })
  },
}

const splitPlaceholderTransaction: ToolDefinition = {
  name: 'split-placeholder-transaction',
  description:
    'Resolve an unresolved placeholder into multiple concrete transactions whose amounts exactly equal the original placeholder amount.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Placeholder transaction ID', 128),
    splits: z
      .array(
        z.object({
          amount: positiveMoneyAmount('Split amount'),
          description: boundedText('Description', 'Split transaction description', 500).optional(),
          category: boundedText('Category', 'Split category name or ID', 200).optional(),
          notes: boundedText('Notes', 'Split notes', 2000).optional(),
        })
      )
      .min(2)
      .max(20),
    source: boundedText('Source', 'Automation source or origin label', 120).optional(),
    note: boundedText('Note', 'Workflow changelog note', 500).optional(),
    dryRun: z.boolean().optional().default(false),
  }),
  execute: async ({ transactionId, splits, source, note, dryRun }) => {
    return transaction(() => {
      const rows = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1 LIMIT 1', [
        transactionId,
      ])
      if (rows.length === 0)
        return { success: false, message: `Transaction ${transactionId} not found.` }
      const before = rows[0]
      const unresolvedError = assertUnresolvedPlaceholder(before)
      if (unresolvedError) return unresolvedError

      const splitCentavos = splits.map((split: PlaceholderSplitInput) => toCentavos(split.amount))
      const totalCentavos = splitCentavos.reduce(
        (sum: number, amountCentavos: number) => sum + amountCentavos,
        0
      )
      if (totalCentavos !== before.amount) {
        return placeholderFailure(
          'split_amount_mismatch',
          `Split amounts must equal the original placeholder amount exactly (${fromCentavos(before.amount).toFixed(2)}).`
        )
      }

      const childTransactions: TransactionRow[] = []
      for (const [index, split] of splits.entries()) {
        const categoryResult = resolvePlaceholderCategory(split.category)
        if (!categoryResult.success) return categoryResult
        childTransactions.push({
          ...before,
          id: generateId(),
          category_id: categoryResult.categoryId,
          amount: splitCentavos[index],
          description: split.description ?? `${before.description} (${index + 1})`,
          notes: split.notes ?? null,
          source: source !== undefined ? (source === '' ? null : source) : (before.source ?? null),
          note: note !== undefined ? (note === '' ? null : note) : (before.note ?? null),
          is_placeholder: 0,
          placeholder_status: null,
          resolved_at: dayjs().toISOString(),
          resolved_by_transaction_id: null,
          placeholder_reason: null,
          placeholder_parent_transaction_id: before.id,
        })
      }

      const after: TransactionRow = {
        ...before,
        status: 'pending',
        source: source !== undefined ? (source === '' ? null : source) : (before.source ?? null),
        note: note !== undefined ? (note === '' ? null : note) : (before.note ?? null),
        placeholder_status: 'split',
        resolved_at: dayjs().toISOString(),
      }
      const oldImpact = getBalanceImpact(before)
      if (!oldImpact.success) return { success: false, message: oldImpact.message }
      const afterImpact = getBalanceImpact(after)
      if (!afterImpact.success) return { success: false, message: afterImpact.message }
      const combinedNewImpacts = new Map(afterImpact.impacts)
      for (const child of childTransactions) {
        const childImpact = getBalanceImpact(child)
        if (!childImpact.success) return { success: false, message: childImpact.message }
        for (const [accountId, delta] of childImpact.impacts) {
          addImpact(combinedNewImpacts, accountId, delta)
        }
      }
      const balanceDeltas = diffBalanceImpacts(oldImpact.impacts, combinedNewImpacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
      const balancesBefore = readAccountBalances([...balanceDeltas.keys()])
      const auditPreview = buildTransactionBalanceAuditPreview({
        action: 'update',
        before,
        after,
        balanceDeltas,
        balancesBefore,
      })
      const accountNames = dryRun ? readAccountNames([...balanceDeltas.keys()]) : new Map()
      const formattedBalanceImpact = formatBalanceImpactPreview(
        auditPreview.balanceChanges,
        accountNames
      )

      if (dryRun) {
        return {
          success: true,
          dryRun: true,
          wouldSplit: {
            before: publicTransactionSnapshot(before),
            after: publicTransactionSnapshot(after),
            children: childTransactions.map(publicTransactionSnapshot),
          },
          balanceImpact: formattedBalanceImpact,
          auditPreview,
          message: `Dry run: placeholder transaction ${transactionId} would be split into ${childTransactions.length} transactions; no changes were written.`,
        }
      }

      const updateResult = execute(
        `UPDATE transactions
         SET status = 'pending', source = $1, note = $2, placeholder_status = 'split', resolved_at = $3,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $4 AND is_placeholder = 1 AND COALESCE(placeholder_status, 'unresolved') = 'unresolved'`,
        [after.source, after.note, after.resolved_at, transactionId]
      )
      if (updateResult.rowsAffected !== 1) {
        throw new Error(`Placeholder transaction ${transactionId} could not be split safely.`)
      }
      applyBalanceDeltas(balanceDeltas)
      for (const child of childTransactions) {
        execute(
          `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, is_placeholder, placeholder_status, resolved_at, resolved_by_transaction_id, placeholder_reason, placeholder_parent_transaction_id, date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
          [
            child.id,
            child.account_id,
            child.category_id,
            child.transfer_to_account_id,
            child.type,
            child.amount,
            child.currency,
            child.description,
            child.notes,
            child.status,
            child.source,
            child.note,
            child.recurring_rule_id,
            child.is_placeholder,
            child.placeholder_status,
            child.resolved_at,
            child.resolved_by_transaction_id,
            child.placeholder_reason,
            child.placeholder_parent_transaction_id,
            child.date,
          ]
        )
      }
      writeTransactionBalanceAudit({
        action: 'update',
        before,
        after,
        balanceDeltas,
        balancesBefore,
      })
      writeAuditLog({
        entity: 'transaction',
        entityId: transactionId,
        action: 'split-placeholder',
        before: publicTransactionSnapshot(before),
        after: {
          placeholder: publicTransactionSnapshot(after),
          children: childTransactions.map(publicTransactionSnapshot),
        },
        source: after.source,
        note: after.note,
      })
      return {
        success: true,
        dryRun: false,
        placeholder: publicTransactionSnapshot(after),
        transactions: childTransactions.map(publicTransactionSnapshot),
        balanceImpact: formattedBalanceImpact,
        message: `Split placeholder transaction ${transactionId} into ${childTransactions.length} transactions.`,
      }
    })
  },
}

const getSpendingSummary: ToolDefinition = {
  name: 'get-spending-summary',
  description:
    'Get a summary of spending by category for a given time period. Use this when the user asks about their spending, expenses, or budget status.',
  schema: z.object({
    period: z
      .enum(['week', 'month', 'year', 'custom'])
      .optional()
      .default('month')
      .describe('The time period to summarize'),
    startDate: isoDate('Start date (YYYY-MM-DD) for custom period').optional(),
    endDate: isoDate('End date (YYYY-MM-DD) for custom period').optional(),
  }),
  execute: async ({ period, startDate, endDate }) => {
    let start: string
    let end: string

    if (period === 'custom' && (!startDate || !endDate)) {
      return {
        success: false,
        message: 'Custom spending summaries require both startDate and endDate.',
      }
    }

    if (period === 'custom' && startDate && endDate) {
      start = startDate
      end = endDate
      if (dayjs(start).isAfter(dayjs(end), 'day')) {
        return {
          success: false,
          message: 'Custom spending summaries require startDate to be on or before endDate.',
        }
      }
    } else {
      const now = dayjs()
      end = now.format('YYYY-MM-DD')
      switch (period) {
        case 'week':
          start = now.subtract(6, 'day').format('YYYY-MM-DD')
          break
        case 'year':
          start = now.startOf('year').format('YYYY-MM-DD')
          break
        default:
          start = now.startOf('month').format('YYYY-MM-DD')
      }
    }

    const spending = await query<{
      currency: string
      category_id: string | null
      category_name: string
      total: number
      count: number
    }>(
      `SELECT
         t.currency as currency,
         t.category_id as category_id,
         COALESCE(c.name, 'Uncategorized') as category_name,
         SUM(t.amount) as total,
         COUNT(*) as count
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
        WHERE t.type = 'expense'
          AND COALESCE(NULLIF(TRIM(t.status), ''), 'posted') IN ('posted', 'cleared')
          AND t.date >= $1
          AND t.date <= $2
        GROUP BY t.currency, t.category_id, c.name
        ORDER BY t.currency ASC, total DESC`,
      [start, end]
    )

    const totals = await query<{ currency: string; type: string; total: number }>(
      `SELECT currency, type, COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE type IN ('income', 'expense')
         AND COALESCE(NULLIF(TRIM(status), ''), 'posted') IN ('posted', 'cleared')
         AND date >= $1 AND date <= $2
       GROUP BY currency, type`,
      [start, end]
    )

    if (hasMissingCurrency([...spending, ...totals])) {
      return missingCurrencyRepairFailure('Spending summary')
    }

    const currencies = getDistinctCurrencies([...spending, ...totals])
    const totalsByCurrency = currencies.map((currency) => {
      const expenses =
        totals.find((row) => row.currency === currency && row.type === 'expense')?.total || 0
      const income =
        totals.find((row) => row.currency === currency && row.type === 'income')?.total || 0
      return {
        currency,
        totalExpenses: fromCentavos(expenses),
        totalIncome: fromCentavos(income),
        netSavings: fromCentavos(income - expenses),
      }
    })
    const singleCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : null
    const emptyPeriodTotals =
      totalsByCurrency.length === 0 ? { totalExpenses: 0, totalIncome: 0, netSavings: 0 } : null

    return {
      period: { start, end },
      mixedCurrency: totalsByCurrency.length > 1,
      totalExpenses: singleCurrency?.totalExpenses ?? emptyPeriodTotals?.totalExpenses ?? null,
      totalIncome: singleCurrency?.totalIncome ?? emptyPeriodTotals?.totalIncome ?? null,
      netSavings: singleCurrency?.netSavings ?? emptyPeriodTotals?.netSavings ?? null,
      totalsByCurrency,
      byCategory: spending.map((row) => ({
        currency: row.currency,
        ...getCategoryIdentity(row.category_id, row.category_name),
        amount: fromCentavos(row.total),
        transactionCount: row.count,
        percentage:
          (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
            ?.totalExpenses ?? 0) > 0
            ? Math.round(
                (fromCentavos(row.total) /
                  (totalsByCurrency.find((totalsRow) => totalsRow.currency === row.currency)
                    ?.totalExpenses ?? 0)) *
                  100
              )
            : 0,
      })),
      message:
        spending.length === 0
          ? `No expenses found for ${start} to ${end}.`
          : singleCurrency
            ? `Total spending from ${start} to ${end}: ${singleCurrency.currency} ${singleCurrency.totalExpenses.toFixed(2)} across ${spending.length} categories.`
            : `Found spending from ${start} to ${end} across ${totalsByCurrency.length} currencies. See totalsByCurrency and byCategory for per-currency breakdowns; no FX conversion was applied.`,
    }
  },
}

// ---------------------------------------------------------------------------
// 6. list-accounts
// ---------------------------------------------------------------------------

export const transactionsTools: ToolDefinition[] = [
  addTransaction,
  updateTransaction,
  deleteTransaction,
  queryTransactions,
  matchTransferTransactions,
  unmatchTransferTransactions,
  tagTransaction,
  untagTransaction,
  listTags,
  createPlaceholderTransaction,
  listPlaceholderTransactions,
  resolvePlaceholderTransaction,
  splitPlaceholderTransaction,
  getSpendingSummary,
]
