/**
 * Statement import service.
 * Reads a bank statement file, parses it, deduplicates, and creates transactions.
 */

import { query, execute } from '@/lib/database'
import { generateId } from '@/lib/ulid'
import { toCentavos } from '@/lib/money'
import { parseStatement, type ParsedTransaction } from '@/lib/statement-parser'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
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

/**
 * Check if a transaction already exists within 1 day of the given date
 * with the same amount and description (duplicate detection).
 */
async function isDuplicate(
  accountId: string,
  date: string,
  amountCentavos: number,
  description: string
): Promise<boolean> {
  // Check for existing transaction with same amount and description
  // within +/- 1 day of the given date
  const rows = await query<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM transactions
     WHERE account_id = ?
       AND amount = ?
       AND description = ?
       AND date BETWEEN date(?, '-1 day') AND date(?, '+1 day')`,
    [accountId, amountCentavos, description, date, date]
  )
  return (rows[0]?.cnt ?? 0) > 0
}

/**
 * Import a bank statement file into the specified account.
 *
 * @param file - The .ofx, .qfx, or .qif file to import
 * @param accountId - The account ID to assign imported transactions to
 * @returns Import results with counts and any errors
 */
export async function importStatementFile(
  file: File,
  accountId: string
): Promise<ImportResult> {
  const result: ImportResult = { imported: 0, skipped: 0, errors: [] }

  // Read and parse the file
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
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : 'Failed to parse file')
    return result
  }

  if (parsed.length === 0) {
    result.errors.push('No transactions found in file')
    return result
  }

  // Import each transaction, skipping duplicates
  const now = new Date().toISOString()
  let totalBalanceDelta = 0

  for (const tx of parsed) {
    try {
      const amountCentavos = toCentavos(tx.amount)

      // Check for duplicates
      const duplicate = await isDuplicate(accountId, tx.date, amountCentavos, tx.description)
      if (duplicate) {
        result.skipped++
        continue
      }

      const id = generateId()
      await execute(
        `INSERT INTO transactions (id, account_id, category_id, type, amount, currency, description, notes, date, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          accountId,
          null, // no category assigned on import
          tx.type,
          amountCentavos,
          'USD',
          tx.description,
          null,
          tx.date,
          now,
          now,
        ]
      )

      // Track balance delta
      const delta = tx.type === 'income' ? amountCentavos : -amountCentavos
      totalBalanceDelta += delta

      result.imported++
    } catch (err) {
      result.errors.push(
        `Failed to import "${tx.description}" (${tx.date}): ${err instanceof Error ? err.message : 'Unknown error'}`
      )
    }
  }

  // Update account balance in one shot
  if (totalBalanceDelta !== 0) {
    await execute('UPDATE accounts SET balance = balance + ?, updated_at = ? WHERE id = ?', [
      totalBalanceDelta,
      now,
      accountId,
    ])
  }

  // Refresh stores
  await useTransactionStore.getState().fetch()
  await useAccountStore.getState().fetch()

  return result
}
