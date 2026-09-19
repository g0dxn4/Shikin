import { applyMetadataCorrection, type MetadataCorrection } from '@shikin/finance-core/corrections'
import { create } from 'zustand'
import { query, withTransaction } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { fromCentavos, toCentavos } from '@/lib/money'
import { learnFromTransaction } from '@/lib/auto-categorize'
import { useAccountStore } from './account-store'
import {
  createSplits,
  guardFrontendEvidence,
  auditFrontendCorrection,
  getSplits as fetchSplits,
  getSplitCategoryMembership,
} from '@/lib/split-service'
import type { SplitInput } from '@/lib/split-service'
import type { Account, Transaction, TransactionSplitWithCategory } from '@/types/database'
import type { TransactionType, CurrencyCode } from '@/types/common'

interface TransactionFormData {
  amount: number
  type: TransactionType
  description: string
  categoryId: string | null
  accountId: string
  transferToAccountId: string | null
  currency: CurrencyCode
  date: string
  notes: string | null
  status?: Transaction['status'] | null
  subcategoryId?: string | null
  reportingTreatment?: 'normal' | 'exclude_from_cashflow'
}

interface MutationOptions {
  skipRefresh?: boolean
}

export interface ReviewFieldUpdate {
  categoryId?: string | null
  accountId?: string
}

type BalanceImpactInput = {
  type: TransactionType
  amount: number
  accountId: string
  transferToAccountId?: string | null
  status?: Transaction['status'] | null
  ledgerTreatment?: Transaction['ledger_treatment'] | null
  isArchived?: number | null
  sourceAccountMode?: Account['account_mode'] | null
  transferAccountMode?: Account['account_mode'] | null
}

type WritableAccountRef = {
  id: string
  currency: CurrencyCode
  reference: string
  accountMode: Account['account_mode']
}

function formatAccountReference(accountId: string, accountName: string | null | undefined) {
  const name = accountName?.trim()
  return name ? `"${name}" (${accountId})` : accountId
}

function isBalanceAffectingStatus(status: Transaction['status'] | null | undefined): boolean {
  return (status ?? 'posted') !== 'pending'
}

function normalizeCurrency(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

async function assertRecurringRuleCompatible(
  tx: TransactionClient,
  recurringRuleId: string | null | undefined,
  transactionRef: { accountId: string; type: TransactionType; currency: string | null | undefined }
) {
  if (!recurringRuleId) return

  const rules = await tx.query<{
    account_id: string
    type: TransactionType
    currency: string | null
  }>('SELECT account_id, type, currency FROM recurring_rules WHERE id = ? LIMIT 1', [
    recurringRuleId,
  ])

  if (rules.length === 0) {
    throw new Error(`Recurring rule ${recurringRuleId} not found.`)
  }

  const rule = rules[0]
  if (rule.account_id !== transactionRef.accountId) {
    throw new Error(
      `Recurring rule ${recurringRuleId} belongs to account ${rule.account_id}, not ${transactionRef.accountId}.`
    )
  }
  if (rule.type !== transactionRef.type) {
    throw new Error(
      `Recurring rule ${recurringRuleId} is for ${rule.type} transactions, not ${transactionRef.type}.`
    )
  }

  const ruleCurrency = normalizeCurrency(rule.currency)
  const transactionCurrency = normalizeCurrency(transactionRef.currency)
  if (!ruleCurrency) {
    throw new Error(
      `Recurring rule ${recurringRuleId} has no stored currency. Repair or recreate it before linking transactions.`
    )
  }
  if (!transactionCurrency) {
    throw new Error(
      `Transaction currency is unknown; cannot link recurring rule ${recurringRuleId}.`
    )
  }
  if (ruleCurrency !== transactionCurrency) {
    throw new Error(
      `Recurring rule ${recurringRuleId} uses ${ruleCurrency}, not ${transactionCurrency}.`
    )
  }
}

async function resolveWritableTransactionAccount(
  tx: TransactionClient,
  accountId: string | null | undefined,
  label = 'Account'
): Promise<WritableAccountRef> {
  if (!accountId) throw new Error(`${label} is required.`)

  const accounts =
    (await tx.query<{
      id: string | null
      name: string | null
      currency: string | null
      is_archived: number | null
      account_mode?: Account['account_mode'] | null
    }>('SELECT id, name, currency, is_archived, account_mode FROM accounts WHERE id = ? LIMIT 1', [
      accountId,
    ])) ?? []
  if (accounts.length === 0) {
    throw new Error(`${label} ${accountId} not found.`)
  }
  const account = accounts[0]
  const accountReference = formatAccountReference(account.id ?? accountId, account.name)

  if (account.is_archived !== 0) {
    throw new Error(
      `${label} ${accountReference} is archived. Unarchive it before using it for new writes.`
    )
  }

  const currency = normalizeCurrency(account.currency)
  if (!currency) {
    throw new Error(
      `${label} ${accountReference} has no stored currency. Repair it before writing transactions.`
    )
  }

  return {
    id: account.id ?? accountId,
    currency,
    reference: accountReference,
    accountMode: account.account_mode ?? 'transactional',
  }
}

function assertTransactionCurrencyMatchesAccount(
  transactionCurrency: string | null | undefined,
  account: WritableAccountRef
) {
  const normalizedTransactionCurrency = normalizeCurrency(transactionCurrency)
  if (!normalizedTransactionCurrency) {
    throw new Error(
      `Transaction currency is required and must match account ${account.reference} ` +
        `currency ${account.currency}.`
    )
  }
  if (normalizedTransactionCurrency !== account.currency) {
    throw new Error(
      `Transaction currency ${normalizedTransactionCurrency} does not match account ` +
        `${account.reference} currency ${account.currency}.`
    )
  }
}

async function resolveTransactionWriteAccounts(tx: TransactionClient, data: TransactionFormData) {
  const sourceAccount = await resolveWritableTransactionAccount(tx, data.accountId)
  assertTransactionCurrencyMatchesAccount(data.currency, sourceAccount)

  if (data.type !== 'transfer') {
    return { sourceAccount, transferDestination: null, currency: sourceAccount.currency }
  }

  const transferDestination = await resolveWritableTransactionAccount(
    tx,
    data.transferToAccountId,
    'Transfer destination account'
  )
  if (transferDestination.id === sourceAccount.id) {
    throw new Error('Transfer destination account must be different from the source account.')
  }
  if (transferDestination.currency !== sourceAccount.currency) {
    throw new Error(
      `Cannot transfer from ${sourceAccount.currency} to ${transferDestination.currency}. Cross-currency transfers are not supported because no FX conversion is applied.`
    )
  }

  return { sourceAccount, transferDestination, currency: sourceAccount.currency }
}

async function applyBalanceImpact(
  tx: TransactionClient,
  input: BalanceImpactInput,
  now: string,
  direction: 1 | -1
) {
  if (
    !isBalanceAffectingStatus(input.status) ||
    (input.ledgerTreatment ?? 'normal') !== 'normal' ||
    input.isArchived === 1
  )
    return

  if (input.type === 'transfer' && input.transferToAccountId) {
    if ((input.sourceAccountMode ?? 'transactional') === 'transactional') {
      await tx.execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
        -input.amount * direction,
        now,
        input.accountId,
      ])
    }
    if ((input.transferAccountMode ?? 'transactional') === 'transactional') {
      await tx.execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
        input.amount * direction,
        now,
        input.transferToAccountId,
      ])
    }
    return
  }

  if ((input.sourceAccountMode ?? 'transactional') !== 'transactional') return

  const delta = (input.type === 'income' ? input.amount : -input.amount) * direction
  await tx.execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
    delta,
    now,
    input.accountId,
  ])
}

type TransactionForMutation = Transaction & {
  source_account_mode?: Account['account_mode'] | null
  transfer_account_mode?: Account['account_mode'] | null
  is_receivable_payment?: number
  is_reconciliation_adjustment?: number
  is_finalized_statement?: number
  has_splits?: number
}

async function getTransactionForMutation(
  tx: TransactionClient,
  id: string
): Promise<TransactionForMutation | null> {
  const rows =
    (await tx.query<TransactionForMutation>(
      `SELECT t.*, a.account_mode AS source_account_mode,
              ta.account_mode AS transfer_account_mode,
              EXISTS(SELECT 1 FROM receivables r WHERE r.matched_transaction_id = t.id) AS is_receivable_payment,
              EXISTS(SELECT 1 FROM account_reconciliations ar WHERE ar.adjustment_transaction_id = t.id) AS is_reconciliation_adjustment,
              (t.finalization_id IS NOT NULL OR EXISTS(
                SELECT 1 FROM account_reconciliations ar
                WHERE ar.account_id = t.account_id AND ar.staging_batch_id = t.staging_batch_id AND ar.selection_mode = 'legacy_batch' AND COALESCE(t.ledger_treatment, 'normal') = 'normal' AND COALESCE(t.status, 'posted') != 'pending'
              )) AS is_finalized_statement,
              EXISTS(
                SELECT 1 FROM transaction_splits ts WHERE ts.transaction_id = t.id
              ) AS has_splits
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
       LEFT JOIN accounts ta ON ta.id = t.transfer_to_account_id
       WHERE t.id = ?
       LIMIT 1`,
      [id]
    )) ?? []
  return rows[0] ?? null
}

function assertMutableTransaction(transaction: TransactionForMutation, metadataOnly = false): void {
  if (transaction.is_archived === 1) {
    throw new Error('Archived transaction provenance cannot be edited or deleted.')
  }
  if ((transaction.transaction_kind ?? 'standard') !== 'standard') {
    throw new Error('This financial record requires its dedicated workflow.')
  }
  if (
    transaction.is_placeholder === 1 &&
    (transaction.placeholder_status ?? 'unresolved') !== 'unresolved'
  ) {
    throw new Error('Completed placeholder lifecycle rows require their dedicated workflow.')
  }
  if (
    transaction.matched_transaction_id ||
    transaction.is_receivable_payment ||
    transaction.is_reconciliation_adjustment ||
    (!metadataOnly && (transaction.finalization_id || transaction.is_finalized_statement))
  ) {
    throw new Error(
      'Linked financial provenance requires an explicit unmatch or reversal workflow.'
    )
  }
}

function assertTransactionLedgerAccount(account: WritableAccountRef | null | undefined): void {
  if (account?.accountMode === 'snapshot_only') {
    throw new Error(
      `Account ${account.id} is snapshot-only and cannot accept transaction ledger rows.`
    )
  }
}

function assertSingleRowAffected(result: { rowsAffected: number }, message: string) {
  if (result.rowsAffected !== 1) {
    throw new Error(message)
  }
}

async function updateTransactionWithData(
  tx: TransactionClient,
  id: string,
  data: TransactionFormData,
  currentTransaction?: TransactionForMutation,
  options?: { preserveLegacyStatus?: boolean }
): Promise<boolean> {
  const existing = currentTransaction ?? (await getTransactionForMutation(tx, id))
  if (!existing) return false
  const metadataOnly =
    toCentavos(data.amount) === existing.amount &&
    data.type === existing.type &&
    data.accountId === existing.account_id &&
    data.transferToAccountId === existing.transfer_to_account_id &&
    data.currency === existing.currency &&
    data.date === existing.date &&
    (data.status ?? existing.status ?? 'posted') === (existing.status ?? 'posted')
  if (metadataOnly && existing.type !== 'transfer') {
    await correctMetadata(tx, existing, {
      description: data.description,
      category_id: data.categoryId,
      subcategory_id: data.subcategoryId,
      notes: data.notes,
      reporting_treatment: data.reportingTreatment,
    })
    return true
  }
  assertMutableTransaction(existing)
  if (existing.has_splits) {
    throw new Error('Split transactions require their dedicated split workflow.')
  }

  const now = new Date().toISOString()
  const newAmountCentavos = toCentavos(data.amount)
  const oldIsTransfer = existing.type === 'transfer' && !!existing.transfer_to_account_id
  const newIsTransfer = data.type === 'transfer'
  const newStatus =
    options?.preserveLegacyStatus && (existing.status === undefined || existing.status === null)
      ? null
      : (data.status ?? existing.status ?? 'posted')
  const { sourceAccount, transferDestination, currency } = await resolveTransactionWriteAccounts(
    tx,
    data
  )
  assertTransactionLedgerAccount(sourceAccount)
  assertTransactionLedgerAccount(transferDestination)
  if (existing.source_account_mode === 'snapshot_only') {
    throw new Error(
      `Account ${existing.account_id} is snapshot-only and cannot accept transaction ledger rows.`
    )
  }
  if (existing.transfer_account_mode === 'snapshot_only') {
    throw new Error(
      `Account ${existing.transfer_to_account_id} is snapshot-only and cannot accept transaction ledger rows.`
    )
  }
  const identityChanged =
    sourceAccount.id !== existing.account_id ||
    data.type !== existing.type ||
    normalizeCurrency(currency) !== normalizeCurrency(existing.currency)

  if (identityChanged) {
    await assertRecurringRuleCompatible(tx, existing.recurring_rule_id, {
      accountId: sourceAccount.id,
      type: data.type,
      currency,
    })
  }

  await assertCategoryAssignment(
    tx,
    newIsTransfer ? null : data.categoryId,
    data.subcategoryId === undefined ? existing.subcategory_id : data.subcategoryId,
    data.type
  )
  await guardFrontendEvidence(tx, existing, {
    ...existing,
    amount: newAmountCentavos,
    type: data.type,
    account_id: sourceAccount.id,
    transfer_to_account_id: transferDestination?.id ?? null,
    currency,
    status: newStatus,
    date: data.date,
    reporting_treatment: data.reportingTreatment ?? existing.reporting_treatment,
  })
  await applyBalanceImpact(
    tx,
    {
      type: existing.type,
      amount: existing.amount,
      accountId: existing.account_id,
      transferToAccountId: oldIsTransfer ? existing.transfer_to_account_id : null,
      status: existing.status,
      ledgerTreatment: existing.ledger_treatment,
      isArchived: existing.is_archived,
      sourceAccountMode: existing.source_account_mode,
      transferAccountMode: existing.transfer_account_mode,
    },
    now,
    -1
  )

  const updateResult = await tx.execute(
    `UPDATE transactions SET account_id = ?, category_id = ?, transfer_to_account_id = ?, type = ?, amount = ?, currency = ?, description = ?, notes = ?, status = ?, date = ?, updated_at = ?, subcategory_id = ?, reporting_treatment = ?
      WHERE id = ?`,
    [
      sourceAccount.id,
      newIsTransfer ? null : data.categoryId,
      transferDestination?.id ?? null,
      data.type,
      newAmountCentavos,
      currency,
      data.description,
      data.notes,
      newStatus,
      data.date,
      now,
      data.subcategoryId === undefined ? existing.subcategory_id : data.subcategoryId,
      data.reportingTreatment ?? existing.reporting_treatment ?? 'normal',
      id,
    ]
  )
  assertSingleRowAffected(updateResult, `Transaction ${id} could not be updated safely.`)

  await applyBalanceImpact(
    tx,
    {
      type: data.type,
      amount: newAmountCentavos,
      accountId: sourceAccount.id,
      transferToAccountId: transferDestination?.id ?? null,
      status: newStatus,
      ledgerTreatment: existing.ledger_treatment,
      isArchived: existing.is_archived,
      sourceAccountMode: sourceAccount.accountMode,
      transferAccountMode: transferDestination?.accountMode,
    },
    now,
    1
  )
  await auditFrontendCorrection(tx, id, 'update', existing, { ...data, amount: newAmountCentavos })
  return true
}

async function assertCategoryAssignment(
  tx: TransactionClient,
  categoryId: string | null,
  subcategoryId: string | null | undefined,
  transactionType: string
) {
  if (categoryId === null) {
    if (subcategoryId) throw new Error('Subcategory must belong to the selected category.')
    return
  }
  if (!categoryId.trim()) throw new Error('Category cannot be blank.')
  const category = await tx.query<{ type: string }>('SELECT type FROM categories WHERE id = ?', [
    categoryId,
  ])
  if (!category.length) throw new Error('Category not found.')
  if (category[0].type !== transactionType)
    throw new Error('Category direction must match the transaction direction.')
  if (
    subcategoryId &&
    !(
      await tx.query('SELECT id FROM subcategories WHERE id = ? AND category_id = ?', [
        subcategoryId,
        categoryId,
      ])
    ).length
  )
    throw new Error('Subcategory must belong to the selected category.')
}

async function correctMetadata(
  tx: TransactionClient,
  existing: TransactionForMutation,
  patch: MetadataCorrection,
  splits?: SplitInput[],
  auditSource?: string,
  auditNote?: string
) {
  assertMutableTransaction(existing, true)
  const after = applyMetadataCorrection(
    existing,
    patch,
    !!existing.has_splits,
    splits !== undefined
  )
  await assertCategoryAssignment(tx, after.category_id ?? null, after.subcategory_id, existing.type)
  await guardFrontendEvidence(tx, existing, after)
  if (splits) await createSplits(existing.id, splits, existing.amount, tx)
  await tx.execute(
    'UPDATE transactions SET description = ?, category_id = ?, subcategory_id = ?, notes = ?, reporting_treatment = ?, updated_at = ? WHERE id = ?',
    [
      after.description,
      after.category_id,
      after.subcategory_id ?? null,
      after.notes,
      after.reporting_treatment === undefined ? 'normal' : after.reporting_treatment,
      new Date().toISOString(),
      existing.id,
    ]
  )
  await auditFrontendCorrection(
    tx,
    existing.id,
    'correct-metadata',
    existing,
    after,
    auditSource,
    auditNote
  )
}

/** Transaction row with joined display names */
export interface TransactionWithDetails extends Transaction {
  account_name?: string
  transfer_to_account_name?: string
  category_name?: string
  category_color?: string
  is_receivable_payment?: number
  is_reconciliation_adjustment?: number
  is_finalized_statement?: number
}

interface TransactionState {
  transactions: TransactionWithDetails[]
  splitTransactionIds: Set<string>
  splitCategoryIdsByTransaction: Map<string, Set<string>>
  isLoading: boolean
  fetchError: string | null
  error: string | null
  fetch: () => Promise<void>
  add: (data: TransactionFormData, options?: MutationOptions) => Promise<void>
  addWithSplits: (data: TransactionFormData, splits: SplitInput[]) => Promise<void>
  update: (id: string, data: TransactionFormData) => Promise<void>
  correctMetadata: (
    id: string,
    patch: MetadataCorrection,
    splits?: SplitInput[],
    auditSource?: string,
    auditNote?: string
  ) => Promise<void>
  updateReviewFields: (id: string, fields: ReviewFieldUpdate) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => TransactionWithDetails | undefined
  getSplits: (id: string) => Promise<TransactionSplitWithCategory[]>
  isSplit: (id: string) => boolean
}

export const useTransactionStore = create<TransactionState>((set, get) => ({
  transactions: [],
  splitTransactionIds: new Set<string>(),
  splitCategoryIdsByTransaction: new Map<string, Set<string>>(),
  isLoading: false,
  fetchError: null,
  error: null,

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const [transactions, splitCategoryIdsByTransaction] = await Promise.all([
        query<TransactionWithDetails>(
          `SELECT t.*, a.name as account_name, c.name as category_name, c.color as category_color,
                  ta.name as transfer_to_account_name,
                  EXISTS(SELECT 1 FROM receivables r WHERE r.matched_transaction_id = t.id) AS is_receivable_payment,
                  EXISTS(SELECT 1 FROM account_reconciliations ar WHERE ar.adjustment_transaction_id = t.id) AS is_reconciliation_adjustment,
                  (t.finalization_id IS NOT NULL OR EXISTS(
                    SELECT 1 FROM account_reconciliations ar
                    WHERE ar.account_id = t.account_id AND ar.staging_batch_id = t.staging_batch_id AND ar.selection_mode = 'legacy_batch' AND COALESCE(t.ledger_treatment, 'normal') = 'normal' AND COALESCE(t.status, 'posted') != 'pending'
                  )) AS is_finalized_statement
           FROM transactions t
           LEFT JOIN accounts a ON t.account_id = a.id
           LEFT JOIN categories c ON t.category_id = c.id
           LEFT JOIN accounts ta ON t.transfer_to_account_id = ta.id
           WHERE COALESCE(t.is_archived, 0) = 0
           ORDER BY t.date DESC, t.created_at DESC`
        ),
        getSplitCategoryMembership(),
      ])
      set({
        transactions,
        splitTransactionIds: new Set(splitCategoryIdsByTransaction.keys()),
        splitCategoryIdsByTransaction,
        fetchError: null,
      })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data, options) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const id = generateId()
        const now = new Date().toISOString()
        const amountCentavos = toCentavos(data.amount)
        const isTransfer = data.type === 'transfer'
        const { sourceAccount, transferDestination, currency } =
          await resolveTransactionWriteAccounts(tx, data)
        assertTransactionLedgerAccount(sourceAccount)
        assertTransactionLedgerAccount(transferDestination)

        await tx.execute(
          `INSERT INTO transactions (id, account_id, category_id, transfer_to_account_id, type, amount, currency, description, notes, status, date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            sourceAccount.id,
            isTransfer ? null : data.categoryId,
            transferDestination?.id ?? null,
            data.type,
            amountCentavos,
            currency,
            data.description,
            data.notes,
            data.status ?? 'posted',
            data.date,
            now,
            now,
          ]
        )

        await applyBalanceImpact(
          tx,
          {
            type: data.type,
            amount: amountCentavos,
            accountId: sourceAccount.id,
            transferToAccountId: transferDestination?.id ?? null,
            status: data.status ?? 'posted',
            sourceAccountMode: sourceAccount.accountMode,
            transferAccountMode: transferDestination?.accountMode,
          },
          now,
          1
        )
      })

      // Learn categorization from this transaction
      if (data.categoryId && data.description) {
        learnFromTransaction(data.description, data.categoryId).catch(() => {})
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    if (!options?.skipRefresh) {
      await Promise.allSettled([get().fetch(), useAccountStore.getState().fetch()])
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      const changed = await withTransaction((tx) => updateTransactionWithData(tx, id, data))
      if (!changed) return
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    await Promise.allSettled([get().fetch(), useAccountStore.getState().fetch()])
  },

  correctMetadata: async (id, patch, splits, auditSource, auditNote) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const existing = await getTransactionForMutation(tx, id)
        if (!existing) throw new Error('Transaction not found.')
        await correctMetadata(tx, existing, patch, splits, auditSource, auditNote)
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
    await get().fetch()
  },

  updateReviewFields: async (id, fields) => {
    set({ error: null })
    try {
      const changed = await withTransaction(async (tx) => {
        const existing = await getTransactionForMutation(tx, id)
        if (!existing) return false
        assertMutableTransaction(
          existing,
          fields.accountId === undefined || fields.accountId === existing.account_id
        )
        if (existing.type === 'transfer') {
          throw new Error('Transfers require their dedicated edit workflow.')
        }
        const splits = await tx.query<{ id: string }>(
          'SELECT id FROM transaction_splits WHERE transaction_id = ? LIMIT 1',
          [id]
        )
        if (splits.length > 0) {
          throw new Error('Split transactions require their dedicated review workflow.')
        }
        if (fields.categoryId === undefined && fields.accountId === undefined) return false

        return updateTransactionWithData(
          tx,
          id,
          {
            amount: fromCentavos(existing.amount),
            type: existing.type,
            description: existing.description,
            categoryId: fields.categoryId === undefined ? existing.category_id : fields.categoryId,
            accountId: fields.accountId ?? existing.account_id,
            transferToAccountId: existing.transfer_to_account_id,
            currency: existing.currency,
            date: existing.date,
            notes: existing.notes,
            status: existing.status ?? null,
          },
          existing,
          { preserveLegacyStatus: true }
        )
      })
      if (!changed) return
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    await Promise.allSettled([get().fetch(), useAccountStore.getState().fetch()])
  },

  remove: async (id) => {
    set({ error: null })
    try {
      const changed = await withTransaction(async (tx) => {
        const existing = await getTransactionForMutation(tx, id)
        if (!existing) return false
        assertMutableTransaction(existing)
        await guardFrontendEvidence(tx, existing, null)
        if (
          existing.source_account_mode === 'snapshot_only' ||
          existing.transfer_account_mode === 'snapshot_only'
        ) {
          throw new Error('Snapshot-only accounts cannot accept transaction ledger rows.')
        }

        const now = new Date().toISOString()

        await applyBalanceImpact(
          tx,
          {
            type: existing.type,
            amount: existing.amount,
            accountId: existing.account_id,
            transferToAccountId: existing.transfer_to_account_id,
            status: existing.status,
            ledgerTreatment: existing.ledger_treatment,
            isArchived: existing.is_archived,
            sourceAccountMode: existing.source_account_mode,
            transferAccountMode: existing.transfer_account_mode,
          },
          now,
          -1
        )

        const deleteResult = await tx.execute('DELETE FROM transactions WHERE id = ?', [id])
        assertSingleRowAffected(deleteResult, `Transaction ${id} could not be deleted safely.`)
        return true
      })
      if (!changed) return
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    await Promise.allSettled([get().fetch(), useAccountStore.getState().fetch()])
  },

  addWithSplits: async (data, splits) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const id = generateId()
        const now = new Date().toISOString()
        const amountCentavos = toCentavos(data.amount)

        if (data.type === 'transfer') {
          throw new Error('Split transactions cannot be transfers.')
        }
        const { sourceAccount, currency } = await resolveTransactionWriteAccounts(tx, data)
        assertTransactionLedgerAccount(sourceAccount)

        await tx.execute(
          `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, status, date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            sourceAccount.id,
            data.categoryId,
            data.type,
            amountCentavos,
            currency,
            data.description,
            data.notes,
            data.status ?? 'posted',
            data.date,
            now,
            now,
          ]
        )

        await createSplits(id, splits, amountCentavos, tx)

        await applyBalanceImpact(
          tx,
          {
            type: data.type,
            amount: amountCentavos,
            accountId: sourceAccount.id,
            status: data.status ?? 'posted',
            sourceAccountMode: sourceAccount.accountMode,
          },
          now,
          1
        )
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    await Promise.allSettled([get().fetch(), useAccountStore.getState().fetch()])
  },

  getSplits: async (id) => {
    try {
      return await fetchSplits(id)
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  isSplit: (id) => {
    return get().splitTransactionIds.has(id)
  },

  getById: (id) => {
    return get().transactions.find((t) => t.id === id)
  },
}))
