import {
  commitLegacyImportIdentity,
  type LegacyImportIdentityInput,
  type LegacyImportIdentityPreview,
} from '@/lib/import-identity-service'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { useTransactionStore } from '@/stores/transaction-store'

export async function bindLegacyImportIdentity(
  input: LegacyImportIdentityInput & { previewToken: string }
): Promise<LegacyImportIdentityPreview & { refreshIncomplete: boolean }> {
  const result = await commitLegacyImportIdentity(input)
  invalidateTransactionPage('import')
  const refresh = await Promise.allSettled([
    Promise.resolve().then(() => useTransactionStore.getState().fetch()),
  ])
  return { ...result, refreshIncomplete: refresh.some((item) => item.status === 'rejected') }
}
