import type { SourceCoverageEvidence } from '@shikin/finance-core/reconciliation'
import {
  commitAccountSourceCoverage,
  commitAccountStagedTransactions,
  commitAccountStatementFinalization,
  commitAccountBridgeSupersession,
  type CoverageInput,
  type StagedSettlementInput,
  type FinalizationInput,
  type SupersessionInput,
} from '@/lib/account-reconciliation-service'
import { invalidateTransactionPage } from '@/lib/transaction-query-events'
import { useAccountStore } from '@/stores/account-store'
import { useTransactionStore } from '@/stores/transaction-store'

async function refreshViews(): Promise<boolean> {
  const results = await Promise.allSettled([
    Promise.resolve().then(() => useAccountStore.getState().fetch()),
    Promise.resolve().then(() => useTransactionStore.getState().fetch()),
  ])
  return results.some((result) => result.status === 'rejected')
}

// Preserve eager invalidation and each operation's existing committed result.
export async function setAccountSourceCoverage(
  input: CoverageInput
): Promise<{ coverage: SourceCoverageEvidence; refreshIncomplete: boolean }> {
  const result = await commitAccountSourceCoverage(input)
  invalidateTransactionPage('store-refresh')
  return { coverage: result, refreshIncomplete: await refreshViews() }
}

export async function settleAccountStagedTransactions(
  input: StagedSettlementInput
): Promise<{ transactionIds: string[]; refreshIncomplete: boolean }> {
  const transactionIds = await commitAccountStagedTransactions(input)
  invalidateTransactionPage('store-refresh')
  return { transactionIds, refreshIncomplete: await refreshViews() }
}

export async function finalizeAccountStatementHistory(
  input: FinalizationInput & { previewToken: string }
) {
  const result = await commitAccountStatementFinalization(input)
  invalidateTransactionPage('store-refresh')
  return { ...result, refreshIncomplete: await refreshViews() }
}

export async function supersedeAccountReconciliationBridge(
  input: SupersessionInput & { previewToken: string }
) {
  const result = await commitAccountBridgeSupersession(input)
  invalidateTransactionPage('store-refresh')
  return { ...result, refreshIncomplete: await refreshViews() }
}
