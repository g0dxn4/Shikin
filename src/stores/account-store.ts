import { create } from 'zustand'
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
      const creditFields = getCreditCardFields(data)
      await execute(
        `INSERT INTO accounts (id, name, type, currency, balance, credit_limit, statement_closing_day, payment_due_day, is_archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          id,
          data.name,
          data.type,
          data.currency,
          toCentavos(data.balance),
          creditFields.creditLimit,
          creditFields.statementClosingDay,
          creditFields.paymentDueDay,
          now,
          now,
        ]
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

  update: async (id, data) => {
    set({ error: null })
    try {
      await withTransaction(async (tx) => {
        const existing = await tx.query<Pick<Account, 'currency' | 'is_archived' | 'balance'>>(
          'SELECT currency, is_archived, balance FROM accounts WHERE id = ? LIMIT 1',
          [id]
        )
        if (existing.length === 0) {
          throw new Error(`Account ${id} not found.`)
        }
        if (existing[0].is_archived === 1) {
          throw new Error(`Account ${id} is archived. Unarchive it before editing it.`)
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
        const creditFields = getCreditCardFields(data)
        await tx.execute(
          `UPDATE accounts SET name = ?, type = ?, currency = ?, balance = ?, credit_limit = ?, statement_closing_day = ?, payment_due_day = ?, updated_at = ? WHERE id = ?`,
          [
            data.name,
            data.type,
            data.currency,
            toCentavos(data.balance),
            creditFields.creditLimit,
            creditFields.statementClosingDay,
            creditFields.paymentDueDay,
            now,
            id,
          ]
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
