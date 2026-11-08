import { correctMetadataMutation, guardTransactionEvidence } from '../transaction-corrections.js'
import { buildTransactionFxEvidenceSnapshot } from '@shikin/finance-core'
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
  normalizeCurrencyCode,
  resolveCategoryId,
  assertSingleRowUpdated,
  writeAuditLog,
  type ToolDefinition,
} from './shared.js'
import {
  importPlanToken,
  prepareImportIdentities,
  sha256Fingerprint,
} from '@shikin/finance-core/imports'
import {
  addTransactionInputSchema,
  executeAddTransaction,
  transactionFxAcceptanceGuardSchema,
  resolveCliFxAcceptance,
  appendCliFxEvidence,
  getBalanceImpact,
  normalizeNewTransactionStatus,
  addImpact,
  diffBalanceImpacts,
  combineBalanceImpacts,
  invertBalanceImpacts,
  readAccountBalances,
  readAccountNames,
  applyBalanceDeltas,
  buildBalanceAuditChanges,
  formatBalanceImpactPreview,
  buildTransactionBalanceAuditPreview,
  writeTransactionBalanceAudit,
  resolveTransferDestination,
  resolveRecurringRuleId,
} from '../transaction-mutations.js'
import {
  normalizeTransactionStatus,
  normalizeLedgerTreatment,
  normalizeReportingTreatment,
  publicFxEvidence,
  normalizeTransactionTagKey,
  transactionTagFromUnknown,
  parseStoredTransactionTags,
  type TransactionRow,
  type TransactionTag,
  type TransactionFxEvidenceRow,
} from '../transaction-values.js'
import { transactionAuditSnapshot } from '../transaction-audit.js'

type PlaceholderSplitInput = {
  amount: number
  description?: string
  category?: string
  notes?: string
}

function latestTransactionFxEvidence(transactionId: string): TransactionFxEvidenceRow | null {
  return (
    query<TransactionFxEvidenceRow>(
      `SELECT * FROM transaction_fx_evidence
       WHERE transaction_id = $1 OR original_transaction_id = $2
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [transactionId, transactionId]
    )[0] ?? null
  )
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

function assertImportedProvenanceUnchanged(tx: TransactionRow, source?: string, note?: string) {
  if (
    (tx.import_source ||
      tx.import_external_id ||
      tx.import_fingerprint ||
      tx.import_content_fingerprint) &&
    ((source !== undefined && (source || null) !== (tx.source ?? null)) ||
      (note !== undefined && (note || null) !== (tx.note ?? null)))
  )
    throw new Error(
      'Imported source and note are immutable; use auditSource/auditNote in correct-transaction-metadata.'
    )
}

function assertUnresolvedPlaceholder(tx: TransactionRow) {
  const financialFailure = protectedFinancialTransactionFailure(tx, 'update')
  if (financialFailure) return financialFailure
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
  if (action !== 'update') guardTransactionEvidence(tx, null)
  const references = (query<{
    reconciliation_count: number
    receivable_count: number
    finalized_statement_count: number
  }>(
    `SELECT
       (SELECT COUNT(*) FROM account_reconciliations WHERE adjustment_transaction_id = $1) AS reconciliation_count,
       (SELECT COUNT(*) FROM receivables WHERE matched_transaction_id = $2) AS receivable_count,
       (SELECT COUNT(*) FROM account_reconciliations
        WHERE account_id = $3 AND staging_batch_id = $4 AND selection_mode = 'legacy_batch') AS finalized_statement_count`,
    [tx.id, tx.id, tx.account_id, tx.staging_batch_id ?? null]
  ) ?? [])[0]
  if ((references?.reconciliation_count ?? 0) > 0 || (references?.receivable_count ?? 0) > 0) {
    return {
      success: false as const,
      reason: 'referenced_financial_transaction' as const,
      message: `Transaction ${tx.id} is part of reconciliation or receivable provenance and requires its dedicated workflow.`,
    }
  }
  if (
    action !== 'match' &&
    (tx.finalization_id ||
      ((tx.ledger_treatment ?? 'normal') === 'normal' &&
        (tx.status ?? 'posted') !== 'pending' &&
        (references?.finalized_statement_count ?? 0) > 0))
  ) {
    return {
      success: false as const,
      reason: 'finalized_statement_transaction' as const,
      message: `Transaction ${tx.id} belongs to finalized statement batch ${tx.staging_batch_id}; use a dedicated correction workflow.`,
    }
  }
  return null
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

export const addTransaction: ToolDefinition = {
  name: 'add-transaction',
  description:
    'Add a new financial transaction (expense, income, or transfer). Use this when the user wants to record spending, earnings, or money movement between accounts.',
  schema: addTransactionInputSchema,
  effects: {
    writesTo: [
      'transactions',
      'accounts',
      'transaction_fx_evidence',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async (input) => executeAddTransaction(input),
}

export const bindTransactionImportIdentity: ToolDefinition = {
  name: 'bind-transaction-import-identity',
  description:
    'Preview and explicitly bind verified source/external-ID identity to one legacy transaction without inferring original financial content.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'Legacy transaction to bind', 128),
    sourceNamespace: boundedText(
      'Source namespace',
      'Case-sensitive source namespace; surrounding whitespace is ignored',
      120
    ),
    externalId: z
      .string()
      .min(1)
      .max(512)
      .refine((value) => Boolean(value.trim()), 'External ID must not be blank')
      .describe('Exact opaque external ID; case and leading zeros are preserved'),
    apply: z.boolean().optional().default(false),
    previewToken: boundedText(
      'Preview token',
      'Token returned by this exact binding preview',
      128
    ).optional(),
    source: boundedText('Audit source', 'Source of this reviewed binding', 120).optional(),
    note: boundedText('Audit note', 'Reason for binding this legacy identity', 500).optional(),
  }),
  effects: {
    writesTo: ['transactions', 'audit_log', 'app_data_state'],
  },
  execute: async ({
    transactionId,
    sourceNamespace,
    externalId,
    apply,
    previewToken,
    source,
    note,
  }) => {
    try {
      return transaction(() => {
        const row = query<TransactionRow & { updated_at?: string }>(
          'SELECT * FROM transactions WHERE id = $1 LIMIT 1',
          [transactionId]
        )[0]
        if (!row)
          return {
            success: false,
            reason: 'transaction_not_found',
            message: `Transaction ${transactionId} not found.`,
          }
        if (row.is_archived === 1 || (row.transaction_kind ?? 'standard') !== 'standard') {
          return {
            success: false,
            reason: 'protected_transaction',
            message:
              'Only active standard ledger rows can receive a legacy import identity binding.',
          }
        }
        const namespace = sourceNamespace.trim()
        const prepared = prepareImportIdentities(
          [
            {
              accountId: row.account_id,
              sourceNamespace: namespace,
              externalId,
              date: row.date,
              type: row.type,
              amountCentavos: row.amount,
              currency: row.currency ?? '',
              description: row.description,
            },
          ],
          [
            {
              accountId: row.account_id,
              sourceNamespace: namespace,
              externalId,
              date: row.date,
              type: row.type,
              amountCentavos: row.amount,
              currency: row.currency ?? '',
              transferToAccountId: row.transfer_to_account_id,
            },
          ]
        )[0]!
        const collision = query<{ id: string }>(
          `SELECT id FROM transactions
           WHERE account_id=$1 AND import_source=$2 AND import_external_id=$3 AND id<>$4
           ORDER BY id LIMIT 1`,
          [row.account_id, namespace, externalId, row.id]
        )[0]
        if (collision) {
          return {
            success: false,
            reason: 'identity_already_bound',
            message: `Source identity is already bound to transaction ${collision.id}.`,
          }
        }
        if (
          (row.import_source || row.import_external_id || row.import_fingerprint) &&
          (row.import_source !== namespace ||
            row.import_external_id !== externalId ||
            row.import_fingerprint !== prepared.identity.canonicalMaterial)
        ) {
          return {
            success: false,
            reason: 'identity_conflict',
            message: 'Transaction already has a different import identity.',
          }
        }
        const state = query<{ database_id: string; data_revision: number }>(
          'SELECT database_id, data_revision FROM app_data_state WHERE id=1'
        )[0]
        if (!state) throw new Error('Import identity binding requires app_data_state.')
        const token = importPlanToken({
          version: 1,
          operation: 'bind-transaction-import-identity',
          databaseId: state.database_id,
          dataRevision: state.data_revision,
          transactionId: row.id,
          sourceNamespace: namespace,
          externalId,
          existingEvidence: sha256Fingerprint(JSON.stringify(row)),
          identityKey: prepared.identityKey,
          source: source ?? null,
          note: note ?? null,
        })
        const binding = {
          transactionId: row.id,
          importSource: namespace,
          importExternalId: externalId,
          importFingerprint: prepared.identity.canonicalMaterial,
          importContentFingerprint: null,
          originalContentVerified: false,
        }
        if (!apply) {
          return {
            success: true,
            dryRun: true,
            applyRequired: true,
            previewToken: token,
            binding,
            limitation:
              'Original source content is unknown. No content fingerprint was fabricated from the possibly edited ledger row.',
          }
        }
        if (!previewToken || previewToken !== token) {
          throw new Error(
            'A matching current previewToken is required for explicit legacy identity binding.'
          )
        }
        const update = execute(
          `UPDATE transactions SET import_source=$1, import_external_id=$2, import_fingerprint=$3,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE id=$4 AND import_content_fingerprint IS NULL`,
          [namespace, externalId, prepared.identity.canonicalMaterial, row.id]
        )
        if (update.rowsAffected !== 1) throw new Error('Legacy identity binding became stale.')
        writeAuditLog({
          entity: 'transaction',
          entityId: row.id,
          action: 'bind-import-identity',
          before: {
            importSource: row.import_source,
            importExternalId: row.import_external_id,
            importFingerprint: row.import_fingerprint,
          },
          after: binding,
          source,
          note,
        })
        return { success: true, dryRun: false, mode: 'reviewed_atomic', binding }
      })
    } catch (error) {
      return {
        success: false,
        reason: 'identity_binding_failed',
        message: error instanceof Error ? error.message : String(error),
      }
    }
  },
}

// ---------------------------------------------------------------------------
// 2. update-transaction
// ---------------------------------------------------------------------------

export const updateTransaction: ToolDefinition = {
  name: 'update-transaction',
  description:
    'Update an existing transaction. Use this when the user wants to change the amount, description, category, date, or other details of a transaction.',
  schema: z.object({
    transactionId: boundedText('Transaction ID', 'The ID of the transaction to update', 128),
    amount: positiveMoneyAmount('Re-entered original amount in inputCurrency units').optional(),
    inputCurrency: z
      .string()
      .trim()
      .optional()
      .describe('Re-entered original currency for an FX financial replacement.'),
    fxAcceptanceGuard: transactionFxAcceptanceGuardSchema
      .optional()
      .describe('Exact guard returned by the current FX update dry run.'),
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
  effects: {
    writesTo: [
      'transactions',
      'accounts',
      'transaction_fx_evidence',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async ({
    transactionId,
    amount,
    inputCurrency,
    fxAcceptanceGuard,
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
      const latestFxEvidence = latestTransactionFxEvidence(tx.id)
      const lifecycleFailure = protectedPlaceholderLifecycleFailure(tx, 'update')
      if (lifecycleFailure) return lifecycleFailure
      const financialFailure = protectedFinancialTransactionFailure(tx, 'update', false)
      if (financialFailure) return financialFailure
      assertImportedProvenanceUnchanged(tx, source, note)
      if (
        amount === undefined &&
        type === undefined &&
        date === undefined &&
        status === undefined &&
        ledgerTreatment === undefined &&
        stagingBatchId === undefined &&
        recurringRuleId === undefined &&
        accountId === undefined &&
        transferToAccountId === undefined &&
        inputCurrency === undefined &&
        fxAcceptanceGuard === undefined &&
        source === undefined &&
        note === undefined &&
        tx.type !== 'transfer'
      ) {
        const resolved = category === undefined ? undefined : resolveCategoryId(category)
        if (resolved && !resolved.success) return resolved
        return correctMetadataMutation({
          transactionId,
          description,
          categoryId: resolved?.success ? resolved.id : undefined,
          notes: notes === '' ? null : notes,
          reportingTreatment,
          dryRun,
        })
      }
      const oldAmountCentavos = tx.amount
      const oldType = tx.type
      const oldAccountId = tx.account_id

      if (!tx.currency) {
        return unknownTransactionCurrencyFailure(tx)
      }

      let newAmount = amount !== undefined ? toCentavos(amount) : oldAmountCentavos
      const newType = type || oldType
      const newStatus =
        status === undefined || status === tx.status
          ? normalizeTransactionStatus(tx.status)
          : normalizeNewTransactionStatus(status)
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

        if (
          sourceCurrency &&
          normalizeCurrencyCode(resolvedAccount.currency) !== normalizeCurrencyCode(sourceCurrency)
        ) {
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
      const normalizedInputCurrency = normalizeCurrencyCode(inputCurrency)
      const requestsForeignInput = Boolean(
        normalizedInputCurrency && normalizedInputCurrency !== normalizeCurrencyCode(newCurrency)
      )
      if (latestFxEvidence || requestsForeignInput) {
        if (amount === undefined || inputCurrency === undefined || date === undefined) {
          return {
            success: false,
            reason: 'fx_reentry_required',
            message:
              'FX financial edits require explicit amount, inputCurrency, and date re-entry before preview.',
          }
        }
      }
      const acceptedFx = resolveCliFxAcceptance({
        inputAmountCentavos: amount !== undefined ? toCentavos(amount) : oldAmountCentavos,
        inputCurrency,
        account: {
          id: newAccountId,
          currency: newCurrency,
          accountMode: resolvedAccount?.success ? resolvedAccount.accountMode : 'transactional',
        },
        transactionDate: date ?? tx.date,
        transactionType: newType,
        status: newStatus,
        ledgerTreatment: newLedgerTreatment,
        suppliedGuard: fxAcceptanceGuard,
        forceEvidence: Boolean(latestFxEvidence),
      })
      if (acceptedFx && !dryRun && !fxAcceptanceGuard) {
        return {
          success: false,
          reason: 'fx_preview_required',
          message:
            'FX financial edits require a dry-run preview and its exact fxAcceptanceGuard before apply.',
          preview: {
            accountAmountCentavos: acceptedFx.accountAmountCentavos,
            accountCurrency: acceptedFx.accountCurrency,
            acceptanceGuard: acceptedFx.acceptanceGuard,
          },
        }
      }
      if (acceptedFx) newAmount = acceptedFx.accountAmountCentavos

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

      guardTransactionEvidence(tx, updatedTx)
      if (
        query('SELECT id FROM transaction_splits WHERE transaction_id = $1 LIMIT 1', [tx.id])
          .length &&
        (updatedTx.category_id !== tx.category_id ||
          updatedTx.type !== tx.type ||
          updatedTx.amount !== tx.amount)
      )
        throw new Error('Split transactions require explicit split correction.')
      const oldImpact = getBalanceImpact(tx, true)
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
          beforeFxEvidence: latestFxEvidence,
          afterFxEvidence: acceptedFx
            ? buildTransactionFxEvidenceSnapshot({
                id: 'preview-evidence',
                transactionId,
                createdAt: 'preview',
                preview: acceptedFx,
              })
            : latestFxEvidence,
        })

        return {
          success: true,
          dryRun: true,
          balanceImpact: formatBalanceImpactPreview(auditPreview.balanceChanges, accountNames),
          ...(acceptedFx
            ? {
                fxPreview: {
                  inputAmount: amount,
                  inputAmountCentavos: acceptedFx.inputAmountCentavos,
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

      const nextFxEvidence = acceptedFx ? appendCliFxEvidence(transactionId, acceptedFx) : null
      writeTransactionBalanceAudit({
        action: 'update',
        before: tx,
        after: updatedTx,
        balanceDeltas,
        balancesBefore,
        beforeFxEvidence: latestFxEvidence,
        afterFxEvidence: nextFxEvidence ?? latestFxEvidence,
      })

      const displayAmount = fromCentavos(updatedTx.amount)

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
          fxEvidence: publicFxEvidence(nextFxEvidence ?? latestFxEvidence),
        },
        message: `Updated transaction ${transactionId}: ${updatedTx.currency} ${displayAmount.toFixed(2)} ${updatedTx.type}`,
      }
    })
  },
}

// ---------------------------------------------------------------------------
// 3. delete-transaction
// ---------------------------------------------------------------------------

export const deleteTransaction: ToolDefinition = {
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
  effects: {
    writesTo: [
      'transactions',
      'accounts',
      'transaction_fx_evidence',
      'audit_log',
      'app_data_state',
    ],
  },
  execute: async ({ transactionId, dryRun }) => {
    return transaction(() => {
      const existing = query<TransactionRow>('SELECT * FROM transactions WHERE id = $1', [
        transactionId,
      ])

      if (existing.length === 0) {
        return { success: false, message: `Transaction ${transactionId} not found.` }
      }

      const tx = existing[0]
      const latestFxEvidence = latestTransactionFxEvidence(tx.id)
      const lifecycleFailure = protectedPlaceholderLifecycleFailure(tx, 'delete')
      if (lifecycleFailure) return lifecycleFailure
      const financialFailure = protectedFinancialTransactionFailure(tx, 'delete', false)
      if (financialFailure) return financialFailure

      const balanceImpact = getBalanceImpact(tx, true)
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
          beforeFxEvidence: latestFxEvidence,
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

      const deleted = execute('DELETE FROM transactions WHERE id = $1', [transactionId])
      assertSingleRowUpdated(deleted, `Transaction ${transactionId} could not be deleted safely.`)
      writeTransactionBalanceAudit({
        action: 'delete',
        before: tx,
        after: null,
        balanceDeltas,
        balancesBefore,
        beforeFxEvidence: latestFxEvidence,
      })

      return {
        success: true,
        dryRun: false,
        message: `Deleted ${tx.type}: $${fromCentavos(tx.amount).toFixed(2)} "${tx.description}" from ${tx.date}`,
      }
    })
  },
}

export const matchTransferTransactions: ToolDefinition = {
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
      if (
        !Number.isSafeInteger(sourceTransaction.amount) ||
        sourceTransaction.amount <= 0 ||
        sourceTransaction.amount !== mirrorTransaction.amount
      ) {
        return {
          success: false as const,
          reason: 'amount_mismatch' as const,
          message: 'Transfer matching requires exact centavo amounts.',
        }
      }
      if (
        !normalizeCurrencyCode(sourceTransaction.currency) ||
        !normalizeCurrencyCode(mirrorTransaction.currency) ||
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
          row.is_archived === 1 ||
          row.matched_transaction_id
      )
      if (invalidLifecycle) {
        return {
          success: false as const,
          reason: 'transaction_not_matchable' as const,
          message: `Transaction ${invalidLifecycle.id} must be unarchived, unmatched, normal-ledger, and posted or cleared.`,
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
      const sourceBeforeImpact = getBalanceImpact(sourceTransaction, true)
      const mirrorBeforeImpact = getBalanceImpact(mirrorTransaction, true)
      const sourceAfterImpact = getBalanceImpact(transfer)
      const mirrorAfterImpact = getBalanceImpact(archivedMirror)
      if (!sourceBeforeImpact.success)
        return { ...sourceBeforeImpact, reason: 'balance_impact_invalid' as const }
      if (!mirrorBeforeImpact.success)
        return { ...mirrorBeforeImpact, reason: 'balance_impact_invalid' as const }
      if (!sourceAfterImpact.success)
        return { ...sourceAfterImpact, reason: 'balance_impact_invalid' as const }
      if (!mirrorAfterImpact.success)
        return { ...mirrorAfterImpact, reason: 'balance_impact_invalid' as const }
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
      execute(
        'INSERT INTO transfer_match_provenance (id, source_transaction_id, mirror_transaction_id, source_before_json, mirror_before_json) VALUES ($1,$2,$3,$4,$5)',
        [
          generateId(),
          current.sourceTransaction.id,
          current.mirrorTransaction.id,
          JSON.stringify(current.sourceTransaction),
          JSON.stringify(current.mirrorTransaction),
        ]
      )
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

export const unmatchTransferTransactions: ToolDefinition = {
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

      guardTransactionEvidence(sourceTransaction, null)
      guardTransactionEvidence(mirrorTransaction, null)
      const provenance = query<{
        id: string
        source_before_json: string
        mirror_before_json: string
      }>(
        'SELECT * FROM transfer_match_provenance WHERE source_transaction_id = $1 AND mirror_transaction_id = $2 AND unmatched_at IS NULL',
        [sourceTransaction.id, mirrorTransaction.id]
      )[0]
      if (!provenance)
        return {
          success: false as const,
          reason: 'ambiguous_legacy_provenance',
          message:
            'Original treatments cannot be proven. Unmatch requires reliable original-row provenance.',
        }
      const restoredSource = JSON.parse(provenance.source_before_json) as TransactionRow
      const restoredMirror = JSON.parse(provenance.mirror_before_json) as TransactionRow
      if (
        restoredSource.type !== 'expense' ||
        restoredMirror.type !== 'income' ||
        [restoredSource, restoredMirror].some(
          (row) =>
            row.is_archived ||
            row.matched_transaction_id ||
            (row.transaction_kind ?? 'standard') !== 'standard' ||
            !['normal', 'exclude_from_cashflow'].includes(row.reporting_treatment ?? 'normal')
        ) ||
        [
          [restoredSource, sourceTransaction],
          [restoredMirror, mirrorTransaction],
        ].some(
          ([original, current]) =>
            JSON.stringify(Object.keys(original).sort()) !==
            JSON.stringify(Object.keys(current).sort())
        )
      )
        return {
          success: false as const,
          reason: 'invalid_transfer_provenance',
          message:
            'Original full-row provenance is incomplete or inconsistent; restoration is unsafe.',
        }
      const expectedSource = {
        ...restoredSource,
        type: 'transfer',
        transfer_to_account_id: restoredMirror.account_id,
        reporting_treatment: 'exclude_from_cashflow',
        matched_transaction_id: restoredMirror.id,
      }
      const expectedMirror = {
        ...restoredMirror,
        reporting_treatment: 'exclude_from_cashflow',
        transaction_kind: 'archived_transfer_mirror',
        matched_transaction_id: restoredSource.id,
        is_archived: 1,
      }
      for (const [actual, expected] of [
        [sourceTransaction, expectedSource],
        [mirrorTransaction, expectedMirror],
      ]) {
        if (
          Object.entries(expected).some(
            ([key, value]) =>
              key !== 'updated_at' && (actual as unknown as Record<string, unknown>)[key] !== value
          )
        )
          return {
            success: false as const,
            reason: 'changed_match_provenance',
            message: 'Matched evidence has changed; unmatch cannot restore it safely.',
          }
      }
      const deltas = new Map<string, number>()
      for (const [row, multiplier] of [
        [sourceTransaction, -1],
        [mirrorTransaction, -1],
        [restoredSource, 1],
        [restoredMirror, 1],
      ] as const) {
        const impact = getBalanceImpact(row, true)
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
        provenance,
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
      for (const restored of [current.restoredSource, current.restoredMirror]) {
        // Snapshot keys originated from SELECT *; bind all values and restrict identifiers.
        const entries = Object.entries(restored).filter(([key]) => key !== 'id')
        if (entries.some(([key]) => !/^[a-z_]+$/.test(key)))
          throw new Error('Invalid match provenance fields.')
        assertSingleRowUpdated(
          execute(
            `UPDATE transactions SET ${entries.map(([key], index) => `${key} = $${index + 1}`).join(', ')} WHERE id = $${entries.length + 1}`,
            [...entries.map(([, value]) => value), restored.id]
          ),
          'Could not restore original transaction.'
        )
      }
      execute(
        "UPDATE transfer_match_provenance SET unmatched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = $1 AND unmatched_at IS NULL",
        [current.provenance.id]
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

export const tagTransaction: ToolDefinition = {
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

export const untagTransaction: ToolDefinition = {
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

export const createPlaceholderTransaction: ToolDefinition = {
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

export const resolvePlaceholderTransaction: ToolDefinition = {
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
      assertImportedProvenanceUnchanged(before, source, note)
      guardTransactionEvidence(before, null)
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
      const oldImpact = getBalanceImpact(before, true)
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

export const splitPlaceholderTransaction: ToolDefinition = {
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
      assertImportedProvenanceUnchanged(before, source, note)
      guardTransactionEvidence(before, null)
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
      const oldImpact = getBalanceImpact(before, true)
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
