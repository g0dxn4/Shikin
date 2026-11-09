import {
  commitStatementFile,
  readStatementFile,
  type StatementImportApplyOptions,
} from '@/lib/statement-import'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
  refreshIncomplete: boolean
  mode?: 'reviewed_atomic' | 'unreviewed_atomic'
}

// Completion policy belongs to the action; the service only reads and commits.
export async function importStatementFile(
  file: File,
  accountId: string,
  options: StatementImportApplyOptions = {}
): Promise<ImportResult> {
  try {
    const statement = await readStatementFile(file)
    const counts = await commitStatementFile(file.name, accountId, statement, options)
    if (counts.imported > 0) invalidateTransactionPage('import')
    const refresh = await Promise.allSettled([
      Promise.resolve().then(() => useTransactionStore.getState().fetch()),
      Promise.resolve().then(() => useAccountStore.getState().fetch()),
    ])
    return {
      ...counts,
      errors: [],
      refreshIncomplete: refresh.some((result) => result.status === 'rejected'),
      mode: options.previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
    }
  } catch (error) {
    return {
      imported: 0,
      skipped: 0,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
      refreshIncomplete: false,
      mode: options.previewToken ? 'reviewed_atomic' : 'unreviewed_atomic',
    }
  }
}
