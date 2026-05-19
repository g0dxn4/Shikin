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
}

type AccountRef = {
  id: string
  currency: string
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

function addImpact(impacts: Map<string, number>, accountId: string, amount: number) {
  impacts.set(accountId, (impacts.get(accountId) ?? 0) + amount)
}

function getBalanceImpact(
  tx: Pick<
    TransactionRow,
    'id' | 'type' | 'amount' | 'account_id' | 'transfer_to_account_id' | 'status'
  >
): BalanceImpactResult {
  const impacts = new Map<string, number>()
  if (!isBalanceAffectingStatus(tx.status)) {
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
  const archivedAccounts =
    query<{ id: string; name: string }>(
      `SELECT id, name FROM accounts WHERE id IN (${placeholders}) AND is_archived = 1 ORDER BY id`,
      uniqueAccountIds
    ) ?? []
  if (archivedAccounts.length === 0) return null

  const archivedLabels = archivedAccounts.map((account) => `${account.name} (${account.id})`)
  return {
    success: false as const,
    reason: 'archived_account_balance_mutation' as const,
    accountIds: archivedAccounts.map((account) => account.id),
    message: `Cannot mutate balances for archived account${archivedAccounts.length === 1 ? '' : 's'} ${archivedLabels.join(', ')}. Unarchive affected accounts before editing or deleting balance-affecting transactions.`,
  }
}

function applyBalanceDeltas(deltas: Map<string, number>) {
  for (const [accountId, delta] of sortedBalanceDeltas(deltas)) {
    execute(
      "UPDATE accounts SET balance = balance + $1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $2",
      [delta, accountId]
    )
  }
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

function buildTransactionBalanceAuditPreview({
  action,
  before,
  after,
  balanceDeltas,
  balancesBefore,
}: {
  action: 'create' | 'update' | 'delete'
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

  const accounts = query<{ id: string; currency: string; is_archived: number }>(
    'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
    [transferToAccountId]
  )

  if (accounts.length === 0) {
    return {
      success: false as const,
      message: `Transfer destination account ${transferToAccountId} not found.`,
    }
  }

  const destination = accounts[0]
  if (destination.is_archived === 1) {
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

  return { success: true as const, id: destination.id, currency: destination.currency }
}

function resolveRecurringRuleId(
  recurringRuleId: string | null | undefined,
  transactionRef?: { accountId: string; type: TransactionRow['type']; currency: string | null }
) {
  if (!recurringRuleId) {
    return { success: true as const, id: null }
  }

  const rules = query<RecurringRuleRef>(
    'SELECT id, account_id, type, currency FROM recurring_rules WHERE id = $1 LIMIT 1',
    [recurringRuleId]
  )

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
    const linkedRecurringRuleId = recurringRuleId ?? null

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
        `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, source, note, recurring_rule_id, date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      if (!tx.currency) {
        return unknownTransactionCurrencyFailure(tx)
      }

      const newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const newStatus = status ?? normalizeTransactionStatus(tx.status)
      const isMovingAccounts = accountId !== undefined && accountId !== oldAccountId
      const sourceCurrency = tx.currency
      let resolvedAccount:
        | { success: true; id: string; currency: string }
        | { success: false; message: string }
        | null = null

      if (isMovingAccounts) {
        resolvedAccount = resolveAccountId(accountId)
        if (!resolvedAccount.success) {
          return { success: false, message: resolvedAccount.message }
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
         SET amount = $1, type = $2, description = $3, category_id = $4, date = $5, notes = $6, account_id = $7, currency = $8, transfer_to_account_id = $9, status = $10, source = $11, note = $12, recurring_rule_id = $13,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = $14`,
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

      const balanceImpact = getBalanceImpact(tx)
      if (!balanceImpact.success) {
        return { success: false, message: balanceImpact.message }
      }
      const balanceDeltas = invertBalanceImpacts(balanceImpact.impacts)
      const archivedMutationFailure = archivedBalanceMutationFailure([...balanceDeltas.keys()])
      if (archivedMutationFailure) return archivedMutationFailure
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
              t.is_placeholder, t.placeholder_status, t.resolved_at, t.resolved_by_transaction_id, t.placeholder_reason, t.placeholder_parent_transaction_id,
              COALESCE(c.name, 'Uncategorized') as category_name,
              a.name as account_name,
              ta.name as transfer_to_account_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
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
    const accountRows = query<AccountRef & { is_archived: number }>(
      'SELECT id, currency, is_archived FROM accounts WHERE id = $1 LIMIT 1',
      [resolvedAccountId]
    )
    if (accountRows.length === 0)
      return { success: false, message: `Account ${resolvedAccountId} not found.` }
    if (accountRows[0].is_archived === 1) {
      return {
        success: false,
        message: `Account ${resolvedAccountId} is archived. Unarchive it before using it for new writes.`,
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
      currency: accountRows[0].currency,
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
  tagTransaction,
  untagTransaction,
  listTags,
  createPlaceholderTransaction,
  listPlaceholderTransactions,
  resolvePlaceholderTransaction,
  splitPlaceholderTransaction,
  getSpendingSummary,
]
