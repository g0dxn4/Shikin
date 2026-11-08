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
  type TransactionFxPreview,
} from '@shikin/finance-core'
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
  normalizeCurrencyCode,
  resolveCategoryId,
  writeAuditLog,
} from './tools/shared.js'
import {
  findTransactionDuplicate,
  transactionDuplicateReason,
  type TransactionDuplicateCheck,
} from './duplicate-detection.js'

export type TransactionStatus = 'pending' | 'posted' | 'cleared'
export type LedgerTreatment = 'normal' | 'staged_no_balance_impact'
export type ReportingTreatment = 'normal' | 'exclude_from_cashflow'
export type PlaceholderTransactionStatus = 'unresolved' | 'resolved' | 'split' | 'cancelled'
export type TransactionRow = {
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
  finalization_id?: string | null
  import_source?: string | null
  import_external_id?: string | null
  import_fingerprint?: string | null
  import_content_fingerprint?: string | null
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
export type TransactionTag = {
  key: string
  label: string
}

export type TransactionFxEvidenceRow = {
  id: string
  transaction_id: string | null
  original_transaction_id: string
  original_account_id: string
  transaction_type: 'income' | 'expense'
  status: TransactionStatus
  ledger_treatment: LedgerTreatment
  input_amount_centavos: number
  input_currency: string
  account_amount_centavos: number
  account_currency: string
  account_balance_delta_centavos: number
  transaction_date: string
  rate_id: string | null
  rate_decimal: string
  created_at: string
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

export const transactionFxAcceptanceGuardSchema = z.object({
  version: z.literal(1),
  inputAmountCentavos: z.number().int().positive(),
  inputCurrency: z.string(),
  accountId: z.string(),
  accountCurrency: z.string(),
  mainCurrency: z.string(),
  transactionDate: z.string(),
  transactionType: z.enum(['income', 'expense']),
  status: z.enum(['pending', 'posted', 'cleared']),
  ledgerTreatment: z.enum(['normal', 'staged_no_balance_impact']),
  accountAmountCentavos: z.number().int().positive(),
  rateId: z.string().nullable(),
  effectiveFrom: z.string().nullable(),
  rateDecimal: z.string(),
  direction: z.string(),
})

export function normalizeTransactionStatus(status: TransactionRow['status']): TransactionStatus {
  return status ?? 'posted'
}

function isBalanceAffectingStatus(status: TransactionRow['status']): boolean {
  return normalizeTransactionStatus(status) !== 'pending'
}

export function normalizeLedgerTreatment(
  value: TransactionRow['ledger_treatment']
): LedgerTreatment {
  return value === 'staged_no_balance_impact' ? value : 'normal'
}

export function normalizeReportingTreatment(
  value: TransactionRow['reporting_treatment']
): ReportingTreatment {
  return value === 'exclude_from_cashflow' ? value : 'normal'
}

export function publicFxEvidence(
  evidence: TransactionFxEvidenceRow | TransactionFxEvidenceSnapshot | null
) {
  if (!evidence) return null
  if ('transaction_id' in evidence) {
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
  return {
    ...evidence,
    acceptedStatus: evidence.status,
    direction: `${evidence.inputCurrency}->${evidence.accountCurrency}`,
    immutableAcceptanceSnapshot: true,
  }
}

export function resolveCliFxAcceptance(input: {
  inputAmountCentavos: number
  inputCurrency: string | undefined
  account: AccountRef
  transactionDate: string
  transactionType: TransactionRow['type']
  status: TransactionStatus
  ledgerTreatment: LedgerTreatment
  suppliedGuard?: TransactionFxAcceptanceGuard
  forceEvidence?: boolean
}): TransactionFxPreview | null {
  const inputCurrency = normalizeCurrencyCode(input.inputCurrency ?? input.account.currency)
  if (!inputCurrency) throw new Error('Input currency is required.')
  const foreign = inputCurrency !== input.account.currency
  if (!foreign && !input.forceEvidence) return null
  if (input.transactionType === 'transfer') {
    throw new Error('Foreign input is not supported for transfers.')
  }
  const mainCurrency = query<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'main_currency' LIMIT 1"
  )[0]?.value
  const current = resolveTransactionFxPreview({
    inputAmountCentavos: input.inputAmountCentavos,
    inputCurrency,
    accountId: input.account.id,
    accountCurrency: input.account.currency,
    mainCurrency: mainCurrency ?? null,
    transactionDate: input.transactionDate,
    transactionType: input.transactionType,
    status: input.status,
    ledgerTreatment: input.ledgerTreatment,
    rates: query<DatedExchangeRate>(FX_RATE_SELECT),
  })
  if (input.suppliedGuard) {
    assertTransactionFxAcceptanceGuard(input.suppliedGuard, current.acceptanceGuard)
  }
  return current
}

export function appendCliFxEvidence(
  transactionId: string,
  preview: TransactionFxPreview
): TransactionFxEvidenceSnapshot {
  const evidence = buildTransactionFxEvidenceSnapshot({
    id: generateId(),
    transactionId,
    createdAt: new Date().toISOString(),
    preview,
  })
  execute(TRANSACTION_FX_EVIDENCE_INSERT, transactionFxEvidenceBindings(evidence))
  return evidence
}

export function addImpact(impacts: Map<string, number>, accountId: string, amount: number) {
  impacts.set(accountId, (impacts.get(accountId) ?? 0) + amount)
}

export function getBalanceImpact(
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

export function diffBalanceImpacts(
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

export function combineBalanceImpacts(...impactMaps: Map<string, number>[]): Map<string, number> {
  const combined = new Map<string, number>()
  for (const impacts of impactMaps) {
    for (const [accountId, amount] of impacts) addImpact(combined, accountId, amount)
  }
  return combined
}

export function invertBalanceImpacts(impacts: Map<string, number>): Map<string, number> {
  return new Map([...impacts.entries()].map(([accountId, amount]) => [accountId, -amount]))
}

function sortedBalanceDeltas(deltas: Map<string, number>): Array<[string, number]> {
  return [...deltas.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function readAccountBalances(accountIds: string[]): Map<string, number> {
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

export function readAccountNames(accountIds: string[]): Map<string, string | null> {
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
export function applyBalanceDeltas(deltas: Map<string, number>) {
  for (const [accountId, delta] of sortedBalanceDeltas(deltas)) {
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2 AND COALESCE(account_mode, 'transactional') = 'transactional'",
      [delta, accountId]
    )
  }
}
export function buildBalanceAuditChanges(
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

export function formatBalanceImpactPreview(
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

export function transactionDuplicateWarnings(duplicateCheck: TransactionDuplicateCheck) {
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

export function transactionAuditSnapshot(tx: TransactionRow) {
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
    finalizationId: tx.finalization_id ?? null,
    importSource: tx.import_source ?? null,
    importExternalId: tx.import_external_id ?? null,
    importFingerprint: tx.import_fingerprint ?? null,
    importContentFingerprint: tx.import_content_fingerprint ?? null,
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

export function normalizeTransactionTagKey(label: string): string {
  return normalizeTransactionTagLabel(label).toLocaleLowerCase()
}

export function transactionTagFromUnknown(value: unknown): TransactionTag | null {
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

export function parseStoredTransactionTags(rawTags: string | null | undefined): TransactionTag[] {
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

export function buildTransactionBalanceAuditPreview({
  action,
  before,
  after,
  balanceDeltas,
  balancesBefore,
  beforeFxEvidence = null,
  afterFxEvidence = null,
}: {
  action: 'create' | 'update' | 'delete' | 'match-transfer' | 'unmatch-transfer'
  before: TransactionRow | null
  after: TransactionRow | null
  balanceDeltas: Map<string, number>
  balancesBefore: Map<string, number>
  beforeFxEvidence?: TransactionFxEvidenceRow | TransactionFxEvidenceSnapshot | null
  afterFxEvidence?: TransactionFxEvidenceRow | TransactionFxEvidenceSnapshot | null
}) {
  const balanceChanges = buildBalanceAuditChanges(balanceDeltas, balancesBefore)
  return {
    entity: 'transaction',
    entityId: after?.id ?? before?.id ?? null,
    action,
    before: before
      ? {
          transaction: transactionAuditSnapshot(before),
          fxEvidence: publicFxEvidence(beforeFxEvidence),
          balanceChanges,
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
          fxEvidence: publicFxEvidence(afterFxEvidence),
          balanceChanges,
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

export function transactionDuplicateFailure(duplicateCheck: TransactionDuplicateCheck) {
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

export function writeTransactionBalanceAudit(
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

export function resolveTransferDestination(
  transferToAccountId: string | undefined,
  source: AccountRef
) {
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

export function resolveRecurringRuleId(
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

export type ImportedTransactionCreateInput = {
  id?: string
  accountId: string
  amountCentavos: number
  type: 'expense' | 'income'
  description: string
  category?: string
  date: string
  notes?: string
  status?: TransactionStatus
  source?: string
  note?: string
  ledgerTreatment?: LedgerTreatment
  reportingTreatment?: ReportingTreatment
  stagingBatchId?: string
  importSource: string
  importExternalId: string | null
  importFingerprint: string
  importContentFingerprint: string
}

export function validateImportedTransactionSync(input: ImportedTransactionCreateInput) {
  if (!Number.isSafeInteger(input.amountCentavos) || input.amountCentavos <= 0) {
    throw new Error('Imported amount must be a positive safe integer number of centavos.')
  }
  const ledgerTreatment = input.ledgerTreatment ?? 'normal'
  const reportingTreatment = input.reportingTreatment ?? 'normal'
  const status = input.status ?? 'posted'
  if (ledgerTreatment === 'staged_no_balance_impact' && !input.stagingBatchId) {
    throw new Error('stagingBatchId is required for staged_no_balance_impact transactions.')
  }
  const resolvedAccount = resolveAccountId(input.accountId, undefined)
  if (!resolvedAccount.success) throw new Error(resolvedAccount.message)
  if (resolvedAccount.accountMode === 'snapshot_only') {
    throw new Error(
      `Account ${resolvedAccount.id} is snapshot-only and cannot be used for transaction ledger writes.`
    )
  }
  const resolvedCategory = resolveCategoryId(input.category)
  if (!resolvedCategory.success) throw new Error(resolvedCategory.message)
  return { ledgerTreatment, reportingTreatment, status, resolvedAccount, resolvedCategory }
}

/**
 * Synchronous transaction creation primitive for whole-file imports. The caller
 * owns the surrounding better-sqlite3 transaction; every failure throws so a
 * file can never commit a prefix.
 */
function assertImportedBalanceChangesAreSafe(
  impacts: Map<string, number>,
  balancesBefore: Map<string, number>
): void {
  for (const [accountId, delta] of impacts) {
    const balance = balancesBefore.get(accountId)
    if (balance === undefined) {
      throw new Error(`Imported balance update account ${accountId} was not found.`)
    }
    if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(delta)) {
      throw new Error(
        `Imported balance update for account ${accountId} is outside the safe integer range.`
      )
    }
    const resultingBalance = balance + delta
    if (!Number.isSafeInteger(resultingBalance)) {
      throw new Error(
        `Imported transaction would move account ${accountId} outside the safe integer balance range.`
      )
    }
  }
}

export function createImportedTransactionSync(input: ImportedTransactionCreateInput) {
  const { ledgerTreatment, reportingTreatment, status, resolvedAccount, resolvedCategory } =
    validateImportedTransactionSync(input)
  const id = input.id ?? generateId()
  const row: TransactionRow = {
    id,
    account_id: resolvedAccount.id,
    category_id: resolvedCategory.id,
    transfer_to_account_id: null,
    type: input.type,
    amount: input.amountCentavos,
    currency: resolvedAccount.currency,
    description: input.description,
    notes: input.notes ?? null,
    status,
    source: input.source ?? null,
    note: input.note ?? null,
    recurring_rule_id: null,
    ledger_treatment: ledgerTreatment,
    reporting_treatment: reportingTreatment,
    transaction_kind: 'standard',
    staging_batch_id: input.stagingBatchId ?? null,
    import_source: input.importSource,
    import_external_id: input.importExternalId,
    import_fingerprint: input.importFingerprint,
    import_content_fingerprint: input.importContentFingerprint,
    is_archived: 0,
    date: input.date,
  }
  const impact = getBalanceImpact(row)
  if (!impact.success) throw new Error(impact.message)
  const balancesBefore = readAccountBalances([...impact.impacts.keys()])
  assertImportedBalanceChangesAreSafe(impact.impacts, balancesBefore)
  execute(
    `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, ledger_treatment, reporting_treatment, transaction_kind, staging_batch_id, import_source, import_external_id, import_fingerprint, import_content_fingerprint, is_archived, date)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,NULL,$12,$13,'standard',$14,$15,$16,$17,$18,0,$19)`,
    [
      id,
      resolvedAccount.id,
      resolvedCategory.id,
      input.type,
      input.amountCentavos,
      resolvedAccount.currency,
      input.description,
      input.notes ?? null,
      status,
      input.source ?? null,
      input.note ?? null,
      ledgerTreatment,
      reportingTreatment,
      input.stagingBatchId ?? null,
      input.importSource,
      input.importExternalId,
      input.importFingerprint,
      input.importContentFingerprint,
      input.date,
    ]
  )
  applyBalanceDeltas(impact.impacts)
  writeTransactionBalanceAudit({
    action: 'create',
    before: null,
    after: row,
    balanceDeltas: impact.impacts,
    balancesBefore,
  })
  return {
    id,
    accountId: resolvedAccount.id,
    amount: fromCentavos(input.amountCentavos),
    type: input.type,
    description: input.description,
    category: resolvedCategory.name,
    date: input.date,
    currency: resolvedAccount.currency,
    status,
    ledgerTreatment,
    reportingTreatment,
    stagingBatchId: input.stagingBatchId ?? null,
    importSource: input.importSource,
    importExternalId: input.importExternalId,
    importFingerprint: input.importFingerprint,
    importContentFingerprint: input.importContentFingerprint,
  }
}

export const addTransactionInputSchema = z.object({
  amount: positiveMoneyAmount(
    'Original entered amount in inputCurrency units (e.g. 12.50, not cents; max 1,000,000,000)'
  ),
  inputCurrency: z
    .string()
    .trim()
    .optional()
    .describe('Original entered currency. Omit to use the selected account currency.'),
  fxAcceptanceGuard: transactionFxAcceptanceGuardSchema
    .optional()
    .describe('Exact guard returned by a foreign-input dry run; required to apply foreign input.'),
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
    .describe('Whether reports should include this transaction in income, spending, and cashflow.'),
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
})

export type AddTransactionInput = z.infer<typeof addTransactionInputSchema>

function startAddTransaction(input: AddTransactionInput) {
  const { amount, date, type, ledgerTreatment, stagingBatchId } = input
  const id = generateId()
  const inputAmountCentavos = toCentavos(amount)
  const txDate = date || dayjs().format('YYYY-MM-DD')
  const transactionLedgerTreatment = ledgerTreatment ?? 'normal'
  const transactionStagingBatchId = stagingBatchId ?? null
  if (transactionLedgerTreatment === 'staged_no_balance_impact' && !transactionStagingBatchId) {
    return {
      success: false as const,
      reason: 'staging_batch_required',
      message: 'stagingBatchId is required for staged_no_balance_impact transactions.',
    }
  }
  if (transactionLedgerTreatment === 'staged_no_balance_impact' && type === 'transfer') {
    return {
      success: false as const,
      reason: 'staged_transfer_not_supported',
      message:
        'Stage imported account-side rows as income or expense, then match transfers after finalization.',
    }
  }
  return { success: true as const, id, inputAmountCentavos, txDate }
}

type AddTransactionStart = {
  success: true
  id: string
  inputAmountCentavos: number
  txDate: string
}

function prepareAddTransactionInTransaction(
  input: AddTransactionInput,
  started: AddTransactionStart
) {
  const {
    inputCurrency,
    fxAcceptanceGuard,
    type,
    description,
    category,
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
  } = input
  const { id, inputAmountCentavos, txDate } = started
  let amountCentavos = inputAmountCentavos
  const transactionNotes = notes ?? null
  const transactionSource = source ?? null
  const transactionNote = note ?? null
  const transactionStatus = status ?? 'posted'
  const transactionLedgerTreatment = ledgerTreatment ?? 'normal'
  const transactionReportingTreatment = reportingTreatment ?? 'normal'
  const transactionStagingBatchId = stagingBatchId ?? null
  const linkedRecurringRuleId = recurringRuleId ?? null
  const resolvedCategory =
    type === 'transfer'
      ? { success: true as const, id: null, name: null }
      : resolveCategoryId(category)
  if (!resolvedCategory.success) {
    return { success: false as const, message: resolvedCategory.message }
  }

  const resolvedAccount = resolveAccountId(accountId, account)
  if (!resolvedAccount.success) {
    return {
      success: false as const,
      message: resolvedAccount.message,
    }
  }
  if (resolvedAccount.accountMode === 'snapshot_only') {
    return {
      success: false as const,
      reason: 'snapshot_only_account',
      message: `Account ${resolvedAccount.id} is snapshot-only and cannot be used for transaction ledger writes.`,
    }
  }

  const resolvedTransferDestination =
    type === 'transfer'
      ? resolveTransferDestination(transferToAccountId, resolvedAccount)
      : { success: true as const, id: null }

  if (!resolvedTransferDestination.success) {
    return { success: false as const, message: resolvedTransferDestination.message }
  }

  const acceptedFx = resolveCliFxAcceptance({
    inputAmountCentavos,
    inputCurrency,
    account: resolvedAccount,
    transactionDate: txDate,
    transactionType: type,
    status: transactionStatus,
    ledgerTreatment: transactionLedgerTreatment,
    suppliedGuard: fxAcceptanceGuard,
  })
  if (acceptedFx && !dryRun && !fxAcceptanceGuard) {
    return {
      success: false as const,
      reason: 'fx_preview_required',
      message:
        'Foreign input requires a dry-run preview and its exact fxAcceptanceGuard before apply.',
      preview: {
        accountAmountCentavos: acceptedFx.accountAmountCentavos,
        accountCurrency: acceptedFx.accountCurrency,
        acceptanceGuard: acceptedFx.acceptanceGuard,
      },
    }
  }
  if (acceptedFx) amountCentavos = acceptedFx.accountAmountCentavos

  const resolvedRecurringRule = resolveRecurringRuleId(linkedRecurringRuleId, {
    accountId: resolvedAccount.id,
    type,
    currency: resolvedAccount.currency,
  })
  if (!resolvedRecurringRule.success) {
    return { success: false as const, message: resolvedRecurringRule.message }
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
    return transactionDuplicateFailure(duplicateCheck)!
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
    return { success: false as const, message: balanceImpact.message }
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
  const balanceImpactPreview = formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames)
  return {
    success: true as const,
    id,
    inputAmountCentavos,
    amountCentavos,
    txDate,
    transactionNotes,
    transactionSource,
    transactionNote,
    transactionStatus,
    transactionLedgerTreatment,
    transactionReportingTreatment,
    transactionStagingBatchId,
    resolvedCategory,
    resolvedAccount,
    resolvedTransferDestination,
    acceptedFx,
    resolvedRecurringRule,
    duplicateCheck,
    duplicateWarnings,
    newTransaction,
    balanceDeltas,
    balancesBefore,
    auditPreview,
    balanceImpactPreview,
  }
}

type PreparedAddTransaction = AddTransactionStart & {
  amountCentavos: number
  transactionNotes: string | null
  transactionSource: string | null
  transactionNote: string | null
  transactionStatus: TransactionStatus
  transactionLedgerTreatment: LedgerTreatment
  transactionReportingTreatment: ReportingTreatment
  transactionStagingBatchId: string | null
  resolvedCategory: { id: string | null; name: string | null }
  resolvedAccount: AccountRef
  resolvedTransferDestination: { id: string | null }
  acceptedFx: TransactionFxPreview | null
  resolvedRecurringRule: { id: string | null }
  duplicateCheck: TransactionDuplicateCheck
  duplicateWarnings: Array<Record<string, unknown>>
  newTransaction: TransactionRow
  balanceDeltas: Map<string, number>
  balancesBefore: Map<string, number>
  auditPreview: { balanceChanges: BalanceAuditChange[] } & Record<string, unknown>
  balanceImpactPreview: BalanceImpactPreview & { deltas: BalanceAuditChange[] }
}

function addTransactionPreview(input: AddTransactionInput, prepared: PreparedAddTransaction) {
  const { amount, inputCurrency, type, description } = input
  const {
    id,
    inputAmountCentavos,
    amountCentavos,
    txDate,
    transactionNotes,
    transactionSource,
    transactionNote,
    transactionStatus,
    transactionLedgerTreatment,
    transactionReportingTreatment,
    transactionStagingBatchId,
    resolvedCategory,
    resolvedAccount,
    resolvedTransferDestination,
    resolvedRecurringRule,
    auditPreview,
    balanceImpactPreview,
  } = prepared
  return {
    id,
    accountId: resolvedAccount.id,
    transferToAccountId: resolvedTransferDestination.id,
    amount: fromCentavos(amountCentavos),
    amountCentavos,
    inputAmount: amount,
    inputAmountCentavos,
    inputCurrency: inputCurrency ?? resolvedAccount.currency,
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
  }
}

function formatAddTransactionPreview(input: AddTransactionInput, prepared: PreparedAddTransaction) {
  const { amount, type, allowDuplicate } = input
  const {
    inputAmountCentavos,
    amountCentavos,
    resolvedAccount,
    acceptedFx,
    duplicateCheck,
    duplicateWarnings,
    balanceImpactPreview,
  } = prepared
  const duplicateFailure = transactionDuplicateFailure(duplicateCheck)
  return {
    success: true,
    dryRun: true,
    balanceImpact: balanceImpactPreview,
    ...(acceptedFx
      ? {
          fxPreview: {
            inputAmount: amount,
            inputAmountCentavos,
            inputCurrency: acceptedFx.inputCurrency,
            accountAmount: fromCentavos(acceptedFx.accountAmountCentavos),
            accountAmountCentavos: acceptedFx.accountAmountCentavos,
            accountCurrency: acceptedFx.accountCurrency,
            transactionDate: acceptedFx.transactionDate,
            conversion: acceptedFx.conversion,
            acceptanceGuard: acceptedFx.acceptanceGuard,
          },
        }
      : {}),
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
    wouldCreate: addTransactionPreview(input, prepared),
    message:
      duplicateFailure && !allowDuplicate
        ? `${duplicateFailure.message} No changes were written.`
        : `Dry run: ${type} transaction for ${resolvedAccount.currency} ${fromCentavos(amountCentavos).toFixed(2)} would be created.`,
  }
}

/** Validate and preview add input without exposing the public tool envelope to CSV planning. */
export function prepareAddTransaction(input: AddTransactionInput & { dryRun: true }) {
  const started = startAddTransaction(input)
  if (!started.success) return started
  return transaction(() => {
    const prepared = prepareAddTransactionInTransaction(input, started)
    if (!prepared.success) return prepared
    return {
      success: true as const,
      amountCentavos: prepared.amountCentavos,
      preview: addTransactionPreview(input, prepared),
    }
  })
}

export function executeAddTransaction(input: AddTransactionInput) {
  const started = startAddTransaction(input)
  if (!started.success) return started
  return transaction(() => {
    const prepared = prepareAddTransactionInTransaction(input, started)
    if (!prepared.success) return prepared
    if (input.dryRun) return formatAddTransactionPreview(input, prepared)
    const { amount, inputCurrency, type, description, allowDuplicate } = input
    const {
      id,
      inputAmountCentavos,
      amountCentavos,
      txDate,
      transactionNotes,
      transactionSource,
      transactionNote,
      transactionStatus,
      transactionLedgerTreatment,
      transactionReportingTreatment,
      transactionStagingBatchId,
      resolvedCategory,
      resolvedAccount,
      resolvedTransferDestination,
      acceptedFx,
      resolvedRecurringRule,
      duplicateCheck,
      newTransaction,
      balanceDeltas,
      balancesBefore,
    } = prepared
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
    const fxEvidence = acceptedFx ? appendCliFxEvidence(id, acceptedFx) : null
    writeTransactionBalanceAudit({
      action: 'create',
      before: null,
      after: newTransaction,
      balanceDeltas,
      balancesBefore,
      afterFxEvidence: fxEvidence,
    })

    return {
      success: true,
      dryRun: false,
      transaction: {
        id,
        accountId: resolvedAccount.id,
        transferToAccountId: resolvedTransferDestination.id,
        amount: fromCentavos(amountCentavos),
        amountCentavos,
        inputAmount: amount,
        inputAmountCentavos,
        inputCurrency: inputCurrency ?? resolvedAccount.currency,
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
        fxEvidence: publicFxEvidence(fxEvidence),
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
      message: `Added ${type}: ${resolvedAccount.currency} ${fromCentavos(amountCentavos).toFixed(2)} for "${description}" on ${txDate}`,
    }
  })
}
