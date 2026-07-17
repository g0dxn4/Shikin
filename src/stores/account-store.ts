import { create } from 'zustand'
import {
  calculateReconciliationAdjustment,
  signedLedgerDeltaForAccount,
  type LedgerEntry,
} from '@shikin/finance-core'
import { query, execute, withTransaction } from '@/lib/database'
import type { TransactionClient } from '@/lib/database'
import { getErrorMessage } from '@/lib/errors'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import type { Account } from '@/types/database'
import type { AccountType, CurrencyCode } from '@/types/common'
import dayjs from 'dayjs'

interface AccountFormData {
  name: string
  type: AccountType
  currency: CurrencyCode
  balance: number
  creditLimit?: number
  statementClosingDay?: number
  paymentDueDay?: number
  accountMode?: Account['account_mode']
}

interface BalanceHistoryPoint {
  date: string
  balance: number // centavos
}

interface AccountState {
  accounts: Account[]
  archivedAccounts: Account[]
  isLoading: boolean
  fetchError: string | null
  error: string | null
  balanceHistory: Map<string, BalanceHistoryPoint[]>
  fetch: () => Promise<void>
  add: (data: AccountFormData) => Promise<void>
  update: (id: string, data: AccountFormData) => Promise<void>
  setPrimary: (id: string) => Promise<void>
  archive: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  getById: (id: string) => Account | undefined
  /** Snapshot current balances for all active accounts (one per day, upserts) */
  snapshotBalances: () => Promise<void>
  /** Load balance history for a specific account */
  loadBalanceHistory: (accountId: string, months?: number) => Promise<BalanceHistoryPoint[]>
}

function normalizeAccountCurrency(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

type AccountCurrencyBlockerCounts = {
  transactionSourceCount: number
  transactionTransferDestinationCount: number
  recurringRuleSourceCount: number
  recurringRuleDestinationCount: number
  subscriptionCount: number
  investmentCount: number
  creditCardStatementCount: number
  balanceHistoryCount: number
  goalCount: number
  nonzeroBalanceCount: number
}

function totalAccountCurrencyBlockers(counts: AccountCurrencyBlockerCounts) {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

function accountCurrencyChangeBlockedMessage(counts: AccountCurrencyBlockerCounts) {
  const total = totalAccountCurrencyBlockers(counts)
  return `Cannot change this account currency while ${total} linked monetary reference${total === 1 ? '' : 's'} still point at the account. Create a new account or explicitly migrate the referenced data so amounts do not silently change meaning. Counts: transactions as source=${counts.transactionSourceCount}, transactions as transfer destination=${counts.transactionTransferDestinationCount}, recurring rules as source=${counts.recurringRuleSourceCount}, recurring rules as destination=${counts.recurringRuleDestinationCount}, subscriptions=${counts.subscriptionCount}, investments=${counts.investmentCount}, credit card statements=${counts.creditCardStatementCount}, account balance history=${counts.balanceHistoryCount}, goals=${counts.goalCount}, nonzero account balance=${counts.nonzeroBalanceCount}.`
}

async function ensurePrimaryAccountColumn() {
  const accountColumns = await query<{ name: string }>('PRAGMA table_info(accounts)')
  const hasPrimaryColumn = accountColumns.some((column) => column.name === 'is_primary')

  if (!hasPrimaryColumn) {
    await execute('ALTER TABLE accounts ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 0')
  }
}

function getCreditCardFields(data: AccountFormData) {
  if (data.type !== 'credit_card') {
    return {
      creditLimit: null,
      statementClosingDay: null,
      paymentDueDay: null,
    }
  }

  return {
    creditLimit: data.creditLimit === undefined ? null : toCentavos(data.creditLimit),
    statementClosingDay: data.statementClosingDay ?? null,
    paymentDueDay: data.paymentDueDay ?? null,
  }
}

type LedgerCandidateRow = {
  id: string
  type: string
  amount: number
  currency: string | null
  status: string | null
  ledger_treatment: string | null
  transaction_kind: string | null
  is_archived: number | null
  account_id: string
  source_account_id: string | null
  source_currency: string | null
  source_account_mode: string | null
  transfer_to_account_id: string | null
  destination_account_id: string | null
  destination_currency: string | null
  destination_account_mode: string | null
}

async function getEffectiveLedgerBalance(tx: TransactionClient, accountId: string) {
  const rows = await tx.query<LedgerCandidateRow>(
    `SELECT t.id, t.type, t.amount, t.currency, t.status, t.ledger_treatment, t.transaction_kind,
            t.is_archived, t.account_id,
            source.id AS source_account_id, source.currency AS source_currency,
            source.account_mode AS source_account_mode,
            t.transfer_to_account_id,
            destination.id AS destination_account_id,
            destination.currency AS destination_currency,
            destination.account_mode AS destination_account_mode
       FROM transactions t
       LEFT JOIN accounts source ON source.id = t.account_id
       LEFT JOIN accounts destination ON destination.id = t.transfer_to_account_id
      WHERE t.account_id = ? OR t.transfer_to_account_id = ?
      ORDER BY t.id`,
    [accountId, accountId]
  )

  return rows.reduce((balance, row) => {
    if (!row.source_account_id || row.source_currency === null) {
      throw new Error(`Transaction ${row.id} has no valid source account context.`)
    }
    const entry: LedgerEntry = {
      type: row.type as LedgerEntry['type'],
      amountCentavos: row.amount,
      currency: row.currency as LedgerEntry['currency'],
      account: {
        accountId: row.source_account_id,
        currency: row.source_currency,
        accountMode: row.source_account_mode as LedgerEntry['account']['accountMode'],
      },
      transferToAccount:
        row.destination_account_id && row.destination_currency !== null
          ? {
              accountId: row.destination_account_id,
              currency: row.destination_currency,
              accountMode: row.destination_account_mode as LedgerEntry['account']['accountMode'],
            }
          : null,
      status: row.status,
      ledgerTreatment: row.ledger_treatment as LedgerEntry['ledgerTreatment'],
      transactionKind: row.transaction_kind as LedgerEntry['transactionKind'],
      isArchived: row.is_archived as LedgerEntry['isArchived'],
    }
    const result = signedLedgerDeltaForAccount(entry, accountId)
    if (result.status !== 'applied') return balance
    const next = balance + result.deltaCentavos
    if (!Number.isSafeInteger(next)) {
      throw new RangeError(`Effective ledger balance for account ${accountId} is outside range.`)
    }
    return next
  }, 0)
}

async function reconcileTransactionalAccountBalance(
  tx: TransactionClient,
  input: {
    accountId: string
    currency: string
    observedBalance: number
    storedBalanceBefore: number
    reconciliationDate: string
    updatedAt: string
  }
) {
  const ledgerBalanceBefore = await getEffectiveLedgerBalance(tx, input.accountId)
  const adjustment = calculateReconciliationAdjustment({
    accountMode: 'transactional',
    observedBalanceCentavos: input.observedBalance,
    effectiveLedgerBalanceCentavos: ledgerBalanceBefore,
  })
  const reconciliationId = generateId()

  await tx.execute(
    `INSERT INTO account_reconciliations (
       id, account_id, reconciliation_date, actual_balance, stored_balance_before,
       ledger_balance_before, ledger_balance_after, adjustment_amount,
       adjustment_transaction_id, staging_batch_id, statement_start_date,
       statement_end_date, source, note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)`,
    [
      reconciliationId,
      input.accountId,
      input.reconciliationDate,
      input.observedBalance,
      input.storedBalanceBefore,
      ledgerBalanceBefore,
      input.observedBalance,
      adjustment.adjustmentCentavos,
    ]
  )

  if (adjustment.bridge) {
    const adjustmentTransactionId = generateId()
    await tx.execute(
      `INSERT INTO transactions (
         id, account_id, category_id, transfer_to_account_id, type, amount, currency,
         description, notes, status, source, note, ledger_treatment, reporting_treatment,
         transaction_kind, reconciliation_id, is_archived, date
       ) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'Balance reconciliation bridge', NULL, 'posted',
         NULL, NULL, 'normal', ?, ?, ?, 0, ?)`,
      [
        adjustmentTransactionId,
        input.accountId,
        adjustment.bridge.type,
        adjustment.bridge.amountCentavos,
        input.currency,
        adjustment.bridge.reportingTreatment,
        adjustment.bridge.transactionKind,
        reconciliationId,
        input.reconciliationDate,
      ]
    )
    const linkResult = await tx.execute(
      'UPDATE account_reconciliations SET adjustment_transaction_id = ? WHERE id = ?',
      [adjustmentTransactionId, reconciliationId]
    )
    if (linkResult.rowsAffected !== 1) {
      throw new Error(`Reconciliation ${reconciliationId} could not be linked to its bridge.`)
    }
  }

  const accountUpdate = await tx.execute(
    'UPDATE accounts SET balance = ?, updated_at = ? WHERE id = ? AND is_archived = 0',
    [input.observedBalance, input.updatedAt, input.accountId]
  )
  if (accountUpdate.rowsAffected !== 1) {
    throw new Error(`Account ${input.accountId} could not be reconciled safely.`)
  }

  const verifiedLedgerBalance = await getEffectiveLedgerBalance(tx, input.accountId)
  if (verifiedLedgerBalance !== input.observedBalance) {
    throw new Error(
      `Reconciliation verification failed: ledger ${verifiedLedgerBalance} did not match observed balance ${input.observedBalance}.`
    )
  }
}

async function countAccountReferences(tx: TransactionClient, accountId: string) {
  const count = async (sql: string, params: unknown[] = [accountId]) => {
    const rows = await tx.query<{ count: number }>(sql, params)
    return rows[0]?.count ?? 0
  }

  const counts = {
    linkedTransactionCount: await count(
      'SELECT COUNT(*) as count FROM transactions WHERE account_id = ? OR transfer_to_account_id = ?',
      [accountId, accountId]
    ),
    linkedRecurringRuleCount: await count(
      'SELECT COUNT(*) as count FROM recurring_rules WHERE account_id = ? OR to_account_id = ?',
      [accountId, accountId]
    ),
    linkedGoalCount: await count('SELECT COUNT(*) as count FROM goals WHERE account_id = ?'),
    linkedBalanceHistoryCount: await count(
      'SELECT COUNT(*) as count FROM account_balance_history WHERE account_id = ?'
    ),
    linkedCreditCardStatementCount: await count(
      'SELECT COUNT(*) as count FROM credit_card_statements WHERE account_id = ?'
    ),
    linkedInvestmentCount: await count(
      'SELECT COUNT(*) as count FROM investments WHERE account_id = ?'
    ),
    linkedSubscriptionCount: await count(
      'SELECT COUNT(*) as count FROM subscriptions WHERE account_id = ?'
    ),
    linkedAliasCount: 0,
  }

  const settingsRows = await tx.query<{ value: string }>(
    'SELECT value FROM settings WHERE key = ? LIMIT 1',
    ['account_aliases']
  )
  try {
    const aliases = JSON.parse(settingsRows[0]?.value ?? '{}') as Record<string, unknown>
    counts.linkedAliasCount = Object.values(aliases).filter((value) => value === accountId).length
  } catch {
    counts.linkedAliasCount = 0
  }

  return Object.values(counts).reduce((sum, value) => sum + value, 0)
}

async function countAccountCurrencyBlockers(
  tx: TransactionClient,
  accountId: string,
  currentBalance: number
): Promise<AccountCurrencyBlockerCounts> {
  const count = async (sql: string) => {
    const rows = await tx.query<{ count: number }>(sql, [accountId])
    return rows[0]?.count ?? 0
  }

  return {
    transactionSourceCount: await count(
      'SELECT COUNT(*) as count FROM transactions WHERE account_id = ?'
    ),
    transactionTransferDestinationCount: await count(
      'SELECT COUNT(*) as count FROM transactions WHERE transfer_to_account_id = ?'
    ),
    recurringRuleSourceCount: await count(
      'SELECT COUNT(*) as count FROM recurring_rules WHERE account_id = ?'
    ),
    recurringRuleDestinationCount: await count(
      'SELECT COUNT(*) as count FROM recurring_rules WHERE to_account_id = ?'
    ),
    subscriptionCount: await count(
      'SELECT COUNT(*) as count FROM subscriptions WHERE account_id = ?'
    ),
    investmentCount: await count('SELECT COUNT(*) as count FROM investments WHERE account_id = ?'),
    creditCardStatementCount: await count(
      'SELECT COUNT(*) as count FROM credit_card_statements WHERE account_id = ?'
    ),
    balanceHistoryCount: await count(
      'SELECT COUNT(*) as count FROM account_balance_history WHERE account_id = ?'
    ),
    goalCount: await count('SELECT COUNT(*) as count FROM goals WHERE account_id = ?'),
    nonzeroBalanceCount: currentBalance === 0 ? 0 : 1,
  }
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  archivedAccounts: [],
  isLoading: false,
  fetchError: null,
  error: null,
  balanceHistory: new Map(),

  fetch: async () => {
    set({ isLoading: true, fetchError: null })
    try {
      const allAccounts = await query<Account>(
        'SELECT * FROM accounts ORDER BY is_archived ASC, created_at DESC'
      )
      set({
        accounts: allAccounts.filter((account) => account.is_archived === 0),
        archivedAccounts: allAccounts.filter((account) => account.is_archived === 1),
        fetchError: null,
      })
    } catch (error) {
      set({ fetchError: getErrorMessage(error) })
      throw error
    } finally {
      set({ isLoading: false })
    }
  },

  add: async (data) => {
    set({ error: null })
    try {
      const id = generateId()
      const now = new Date().toISOString()
      const reconciliationDate = dayjs().format('YYYY-MM-DD')
      const creditFields = getCreditCardFields(data)
      const accountMode = data.accountMode ?? 'transactional'
      const observedBalance = toCentavos(data.balance)
      await withTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO accounts (id, name, type, currency, balance, credit_limit, statement_closing_day, payment_due_day, account_mode, is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            id,
            data.name,
            data.type,
            data.currency,
            accountMode === 'snapshot_only' ? observedBalance : 0,
            creditFields.creditLimit,
            creditFields.statementClosingDay,
            creditFields.paymentDueDay,
            accountMode,
            now,
            now,
          ]
        )

        if (accountMode === 'transactional' && observedBalance !== 0) {
          await reconcileTransactionalAccountBalance(tx, {
            accountId: id,
            currency: data.currency,
            observedBalance,
            storedBalanceBefore: 0,
            reconciliationDate,
            updatedAt: now,
          })
        }
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  update: async (id, data) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const existing = await tx.query<
          Pick<Account, 'currency' | 'is_archived' | 'balance' | 'account_mode'>
        >(
          'SELECT currency, is_archived, balance, account_mode FROM accounts WHERE id = ? LIMIT 1',
          [id]
        )
        if (existing.length === 0) {
          throw new Error(`Account ${id} not found.`)
        }
        if (existing[0].is_archived !== 0) {
          throw new Error(`Account ${id} is archived. Unarchive it before editing it.`)
        }

        const currentMode = existing[0].account_mode ?? 'transactional'
        const nextMode = data.accountMode ?? currentMode
        if (nextMode !== currentMode) {
          const transactionRows = await tx.query<{ count: number }>(
            `SELECT COUNT(*) AS count
             FROM transactions
             WHERE account_id = ? OR transfer_to_account_id = ?`,
            [id, id]
          )
          if ((transactionRows[0]?.count ?? 0) > 0) {
            throw new Error(
              'Create a new account to change balance tracking mode after transactions exist.'
            )
          }
        }

        if (
          normalizeAccountCurrency(existing[0].currency) !== normalizeAccountCurrency(data.currency)
        ) {
          const blockerCounts = await countAccountCurrencyBlockers(tx, id, existing[0].balance)
          if (totalAccountCurrencyBlockers(blockerCounts) > 0) {
            throw new Error(accountCurrencyChangeBlockedMessage(blockerCounts))
          }
        }

        const now = new Date().toISOString()
        const requestedBalance = toCentavos(data.balance)
        const creditFields = getCreditCardFields(data)
        const metadataParams = [
          data.name,
          data.type,
          data.currency,
          creditFields.creditLimit,
          creditFields.statementClosingDay,
          creditFields.paymentDueDay,
          nextMode,
          now,
        ]

        let metadataUpdate: { rowsAffected: number }
        if (nextMode === 'snapshot_only') {
          metadataUpdate = await tx.execute(
            `UPDATE accounts SET name = ?, type = ?, currency = ?, credit_limit = ?, statement_closing_day = ?, payment_due_day = ?, account_mode = ?, updated_at = ?, balance = ? WHERE id = ? AND is_archived = 0`,
            [...metadataParams, requestedBalance, id]
          )
        } else if (currentMode === 'snapshot_only') {
          metadataUpdate = await tx.execute(
            `UPDATE accounts SET name = ?, type = ?, currency = ?, credit_limit = ?, statement_closing_day = ?, payment_due_day = ?, account_mode = ?, updated_at = ?, balance = 0 WHERE id = ? AND is_archived = 0`,
            [...metadataParams, id]
          )
        } else {
          metadataUpdate = await tx.execute(
            `UPDATE accounts SET name = ?, type = ?, currency = ?, credit_limit = ?, statement_closing_day = ?, payment_due_day = ?, account_mode = ?, updated_at = ? WHERE id = ? AND is_archived = 0`,
            [...metadataParams, id]
          )
        }
        if (metadataUpdate.rowsAffected !== 1) {
          throw new Error(`Account ${id} could not be updated safely.`)
        }

        const balanceChanged = requestedBalance !== existing[0].balance
        const modeNeedsOpeningProvenance =
          currentMode === 'snapshot_only' && nextMode === 'transactional' && requestedBalance !== 0
        if (nextMode === 'transactional' && (balanceChanged || modeNeedsOpeningProvenance)) {
          await reconcileTransactionalAccountBalance(tx, {
            accountId: id,
            currency: data.currency,
            observedBalance: requestedBalance,
            storedBalanceBefore: existing[0].balance,
            reconciliationDate: dayjs().format('YYYY-MM-DD'),
            updatedAt: now,
          })
        }
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  setPrimary: async (id) => {
    set({ error: null })
    try {
      await ensurePrimaryAccountColumn()
      await execute(
        `UPDATE accounts
         SET is_primary = CASE WHEN id = ? THEN 1 ELSE 0 END,
             updated_at = CASE WHEN id = ? THEN ? ELSE updated_at END
         WHERE is_archived = 0 AND type NOT IN ('investment', 'crypto', 'credit_card')`,
        [id, id, new Date().toISOString()]
      )
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  archive: async (id) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const now = new Date().toISOString()
        await tx.execute('UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?', [
          now,
          id,
        ])
        await tx.execute(
          'UPDATE recurring_rules SET active = 0, updated_at = ? WHERE active = 1 AND (account_id = ? OR to_account_id = ?)',
          [now, id, id]
        )
        await tx.execute(
          'UPDATE subscriptions SET is_active = 0, updated_at = ? WHERE is_active = 1 AND account_id = ?',
          [now, id]
        )
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  unarchive: async (id) => {
    set({ error: null })
    try {
      await execute('UPDATE accounts SET is_archived = 0, updated_at = ? WHERE id = ?', [
        new Date().toISOString(),
        id,
      ])
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  remove: async (id) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const linkedReferenceCount = await countAccountReferences(tx, id)
        if (linkedReferenceCount > 0) {
          const now = new Date().toISOString()
          await tx.execute('UPDATE accounts SET is_archived = 1, updated_at = ? WHERE id = ?', [
            now,
            id,
          ])
          await tx.execute(
            'UPDATE recurring_rules SET active = 0, updated_at = ? WHERE active = 1 AND (account_id = ? OR to_account_id = ?)',
            [now, id, id]
          )
          await tx.execute(
            'UPDATE subscriptions SET is_active = 0, updated_at = ? WHERE is_active = 1 AND account_id = ?',
            [now, id]
          )
          return
        }

        await tx.execute('DELETE FROM accounts WHERE id = ?', [id])
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }

    try {
      await get().fetch()
    } catch {
      // The write already committed; fetchError already captures the refresh problem.
    }
  },

  getById: (id) => {
    return [...get().accounts, ...get().archivedAccounts].find((a) => a.id === id)
  },

  snapshotBalances: async () => {
    set({ error: null })
    try {
      const { accounts } = get()
      const today = dayjs().format('YYYY-MM-DD')

      for (const acc of accounts) {
        const existing = await query<{ id: string }>(
          'SELECT id FROM account_balance_history WHERE account_id = ? AND date = ?',
          [acc.id, today]
        )

        if (existing.length > 0) {
          await execute(
            'UPDATE account_balance_history SET balance = ? WHERE account_id = ? AND date = ?',
            [acc.balance, acc.id, today]
          )
        } else {
          await execute(
            'INSERT INTO account_balance_history (id, account_id, date, balance) VALUES (?, ?, ?, ?)',
            [generateId(), acc.id, today, acc.balance]
          )
        }
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },

  loadBalanceHistory: async (accountId, months = 6) => {
    try {
      const startDate = dayjs().subtract(months, 'month').format('YYYY-MM-DD')
      const rows = await query<BalanceHistoryPoint>(
        'SELECT date, balance FROM account_balance_history WHERE account_id = ? AND date >= ? ORDER BY date ASC',
        [accountId, startDate]
      )
      set((s) => {
        const newMap = new Map(s.balanceHistory)
        newMap.set(accountId, rows)
        return { balanceHistory: newMap }
      })
      return rows
    } catch (error) {
      set({ error: getErrorMessage(error) })
      throw error
    }
  },
}))
