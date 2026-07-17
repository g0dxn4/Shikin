/**
 * Statement import service.
 * Reads a bank statement file, parses it, deduplicates, and creates transactions.
 */

import { withTransaction, type TransactionClient } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import {
  assignStatementOccurrenceOrdinals,
  canonicalStatementIdentityMaterial,
} from '@shikin/finance-core'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}

interface ImportCounts {
  imported: number
  skipped: number
}

/**
 * Read file contents as text.
 */
async function readFileText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

function assertSupportedType(
  transaction: ParsedTransaction
): asserts transaction is ParsedTransaction & { type: 'income' | 'expense' } {
  if (transaction.type !== 'income' && transaction.type !== 'expense') {
    throw new Error(
      `Unsupported imported transaction type "${String(transaction.type)}" for "${transaction.description}" (${transaction.date})`
    )
  }
}

/**
 * Check if a transaction already exists within 1 day of the given date with
 * the same account, amount, description, type, and currency.
 */
async function isDuplicate(
  tx: TransactionClient,
  accountId: string,
  date: string,
  amountCentavos: number,
  description: string,
  type: 'income' | 'expense',
  currency: string,
  importFingerprint: string
): Promise<boolean> {
  const identityRows = await tx.query<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM transactions WHERE import_fingerprint = ?',
    [importFingerprint]
  )
  if ((identityRows[0]?.cnt ?? 0) > 0) return true

  // Preserve compatibility with rows imported before statement identities were persisted.
  const rows = await tx.query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE account_id = ?
       AND (import_fingerprint IS NULL OR TRIM(import_fingerprint) = '')
       AND amount = ?
       AND description = ?
       AND type = ?
       AND currency = ?
       AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')`,
    [accountId, amountCentavos, description, type, currency, date, date]
  )
  return (rows[0]?.cnt ?? 0) > 0
}

function statementSourceNamespace(fileName: string): string {
  const extension = fileName.split('.').pop()?.trim().toLowerCase()
  return `statement:${extension || 'unknown'}`
}

/**
 * Import a bank statement file into the specified account.
 *
 * @param file - The .ofx, .qfx, or .qif file to import
 * @param accountId - The account ID to assign imported transactions to
 * @returns Import results with counts and any errors
 */
export async function importStatementFile(file: File, accountId: string): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] }

  // File I/O and parsing do not hold the immediate database writer transaction.
  let content: string
  try {
    content = await readFileText(file)
  } catch {
    result.errors.push('Failed to read file')
    return result
  }

  let parsed: ParsedTransaction[]
  try {
    parsed = parseStatement(content, file.name)
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Failed to parse file')
    return result
  }

  if (parsed.length === 0) {
    result.errors.push('No transactions found in file')
    return result
  }

  const sourceNamespace = statementSourceNamespace(file.name)

  try {
    const committedCounts = await withTransaction<ImportCounts>(async (tx) => {
      // Defend against parser regressions before any row from this file is written.
      for (const transaction of parsed) assertSupportedType(transaction)

      let accounts: Array<{
        currency: string | null
        account_mode?: 'transactional' | 'snapshot_only' | null
        is_archived: number | null
      }>
      try {
        accounts = await tx.query(
          'SELECT currency, account_mode, is_archived FROM accounts WHERE id = ? LIMIT 1',
          [accountId]
        )
      } catch (error) {
        // eslint-disable-next-line preserve-caught-error -- original error is included in the message
        throw new Error(`Failed to validate account ${accountId}: ${getErrorMessage(error)}`)
      }

      const account = accounts[0]
      if (!account) throw new Error(`Account ${accountId} not found`)
      if (account.is_archived !== 0) {
        throw new Error(`Account ${accountId} is archived and cannot accept statement imports`)
      }

      const accountMode = account.account_mode ?? 'transactional'
      if (accountMode === 'snapshot_only') {
        throw new Error('Snapshot-only accounts do not accept transaction ledger imports')
      }
      if (accountMode !== 'transactional') {
        throw new Error(`Account ${accountId} has unsupported account mode "${accountMode}"`)
      }
      if (typeof account.currency !== 'string' || account.currency.trim() === '') {
        throw new Error(`Account ${accountId} has no stored currency`)
      }
      const accountCurrency = account.currency

      const preparedTransactions = parsed.map((transaction) => ({
        transaction,
        amountCentavos: toCentavos(transaction.amount),
      }))
      const occurrenceOrdinals = assignStatementOccurrenceOrdinals(
        preparedTransactions.map(({ transaction, amountCentavos }) => ({
          accountId,
          sourceNamespace,
          date: transaction.date,
          type: transaction.type,
          amountCentavos,
          currency: accountCurrency,
          description: transaction.description,
          externalId: transaction.externalId,
        }))
      )

      const now = new Date().toISOString()
      let imported = 0
      let skipped = 0
      let totalBalanceDelta = 0

      for (const [index, prepared] of preparedTransactions.entries()) {
        const { transaction, amountCentavos } = prepared
        const identity = canonicalStatementIdentityMaterial({
          accountId,
          sourceNamespace,
          date: transaction.date,
          type: transaction.type,
          amountCentavos,
          currency: accountCurrency,
          description: transaction.description,
          externalId: transaction.externalId,
          occurrenceOrdinal: occurrenceOrdinals[index].occurrenceOrdinal,
        })
        if (identity.canonicalMaterial === null) {
          throw new Error(`Could not derive identity for imported row ${index + 1}`)
        }
        const importFingerprint = identity.canonicalMaterial

        let duplicate: boolean
        try {
          duplicate = await isDuplicate(
            tx,
            accountId,
            transaction.date,
            amountCentavos,
            transaction.description,
            transaction.type,
            accountCurrency,
            importFingerprint
          )
        } catch (error) {
          // eslint-disable-next-line preserve-caught-error -- original error is included in the message
          throw new Error(
            `Failed to check duplicate for "${transaction.description}" (${transaction.date}): ${getErrorMessage(error)}`
          )
        }

        if (duplicate) {
          skipped++
          continue
        }

        try {
          await tx.execute(
            `INSERT INTO transactions (
               id, account_id, category_id, type, amount, currency, description, notes, date,
               import_source, import_external_id, import_fingerprint, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              generateId(),
              accountId,
              null, // no category assigned on import
              transaction.type,
              amountCentavos,
              accountCurrency,
              transaction.description,
              null,
              transaction.date,
              sourceNamespace,
              transaction.externalId ?? null,
              importFingerprint,
              now,
              now,
            ]
          )
        } catch (error) {
          // eslint-disable-next-line preserve-caught-error -- original error is included in the message
          throw new Error(
            `Failed to import "${transaction.description}" (${transaction.date}): ${getErrorMessage(error)}`
          )
        }

        totalBalanceDelta += transaction.type === 'income' ? amountCentavos : -amountCentavos
        imported++
      }

      if (imported > 0) {
        try {
          const update = await tx.execute(
            "UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ? AND is_archived = 0 AND COALESCE(account_mode, 'transactional') = 'transactional'",
            [totalBalanceDelta, now, accountId]
          )
          if (update.rowsAffected !== 1) {
            throw new Error(`account update affected ${update.rowsAffected} rows`)
          }
        } catch (error) {
          // eslint-disable-next-line preserve-caught-error -- original error is included in the message
          throw new Error(
            `Failed to update balance for account ${accountId}: ${getErrorMessage(error)}`
          )
        }
      }

      return { imported, skipped }
    })

    // Counts become visible only after withTransaction has committed.
    result.imported = committedCounts.imported
    result.skipped = committedCounts.skipped
  } catch (error) {
    // The transaction rejected, so no attempted rows or skips are reported as committed.
    result.errors.push(getErrorMessage(error))
    return result
  }

  // Refresh only after commit. Store refresh errors describe stale UI state, not a rolled-back import.
  await Promise.allSettled([
    Promise.resolve().then(() => useTransactionStore.getState().fetch()),
    Promise.resolve().then(() => useAccountStore.getState().fetch()),
  ])

  return result
}
