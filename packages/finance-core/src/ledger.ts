export type TransactionType = 'income' | 'expense' | 'transfer'
export type PostingStatus = 'pending' | 'posted' | 'cleared'
export type LedgerTreatment = 'normal' | 'staged_no_balance_impact'
export type TransactionKind = 'standard' | 'reconciliation_bridge' | 'archived_transfer_mirror'
export type AccountMode = 'transactional' | 'snapshot_only'
export type RuntimeArchiveFlag = boolean | 0 | 1 | null

export interface LedgerAccountContext {
  accountId: string
  currency: string
  accountMode: AccountMode
}

export interface LedgerEntry {
  type: TransactionType
  amountCentavos: number
  currency: string
  account: LedgerAccountContext
  transferToAccount?: LedgerAccountContext | null
  status?: string | null
  ledgerTreatment?: LedgerTreatment | null
  transactionKind?: TransactionKind | null
  isArchived?: RuntimeArchiveFlag
}

export type LedgerExclusionReason =
  | 'pending'
  | 'staged_no_balance_impact'
  | 'archived_provenance'
  | 'invalid_status'

export type LedgerRejectionReason =
  | 'snapshot_only_account'
  | 'same_account_transfer'
  | 'cross_currency_transfer'

export type EffectiveLedgerStatus =
  | {
      postsToLedger: true
      postingStatus: 'posted' | 'cleared'
      reason: 'effective'
    }
  | {
      postsToLedger: false
      postingStatus: PostingStatus | 'invalid'
      reason: LedgerExclusionReason
    }

export type SignedLedgerDeltaResult =
  | {
      status: 'applied'
      effectiveStatus: EffectiveLedgerStatus & { postsToLedger: true }
      deltas: ReadonlyArray<{ accountId: string; deltaCentavos: number }>
    }
  | {
      status: 'excluded'
      effectiveStatus: EffectiveLedgerStatus & { postsToLedger: false }
      deltas: readonly []
    }
  | {
      status: 'rejected'
      reason: LedgerRejectionReason
      deltas: readonly []
    }
  | {
      status: 'unresolved'
      reason: 'missing_transfer_destination'
      effectiveStatus: EffectiveLedgerStatus & { postsToLedger: true }
      deltas: readonly []
    }

export interface LedgerLeg {
  readonly accountId: string
  readonly deltaCentavos: number
}

export type LegacyLedgerPolicy = 'cli-mutation' | 'frontend-mutation' | 'generic-undo'

export interface LegacyLedgerInput {
  readonly type: TransactionType
  readonly amountCentavos: number
  readonly accountId: string
  readonly transferToAccountId?: string | null
  readonly status?: string | null
  readonly ledgerTreatment?: string | null
  readonly isArchived?: unknown
  readonly sourceAccountMode?: string | null
  readonly transferAccountMode?: string | null
}

export type LegacyLedgerLegResult =
  | { readonly status: 'ready'; readonly legs: readonly LedgerLeg[] }
  | { readonly status: 'missing_transfer_destination'; readonly legs: readonly [] }

/**
 * Compatibility contracts for existing mutation/replay paths, not strict validation.
 * Keep raw facts: normalizing here would reinterpret previously posted legacy rows.
 * Callers retain their guards and their distinct sum/overwrite/ordered-write projections.
 */
export function calculateLegacyLedgerLegs(
  input: LegacyLedgerInput,
  policy: LegacyLedgerPolicy
): LegacyLedgerLegResult {
  if (input.status === 'pending') return { status: 'ready', legs: [] }
  if (
    policy !== 'generic-undo' &&
    (input.isArchived === 1 ||
      (policy === 'cli-mutation'
        ? input.ledgerTreatment === 'staged_no_balance_impact'
        : (input.ledgerTreatment ?? 'normal') !== 'normal'))
  ) {
    return { status: 'ready', legs: [] }
  }
  if (input.type === 'transfer' && !input.transferToAccountId) {
    if (policy === 'cli-mutation') return { status: 'missing_transfer_destination', legs: [] }
    if (policy === 'generic-undo') return { status: 'ready', legs: [] }
  }
  return {
    status: 'ready',
    legs: orderedLedgerLegs(input, policy === 'frontend-mutation' ? 'transactional-only' : 'all'),
  }
}

function orderedLedgerLegs(
  input: Pick<
    LegacyLedgerInput,
    | 'type'
    | 'amountCentavos'
    | 'accountId'
    | 'transferToAccountId'
    | 'sourceAccountMode'
    | 'transferAccountMode'
  >,
  scope: 'all' | 'transactional-only'
): readonly LedgerLeg[] {
  const legs: LedgerLeg[] = []
  if (scope === 'all' || (input.sourceAccountMode ?? 'transactional') === 'transactional') {
    legs.push({
      accountId: input.accountId,
      deltaCentavos: input.type === 'income' ? input.amountCentavos : -input.amountCentavos,
    })
  }
  if (
    input.type === 'transfer' &&
    input.transferToAccountId &&
    (scope === 'all' || (input.transferAccountMode ?? 'transactional') === 'transactional')
  ) {
    legs.push({ accountId: input.transferToAccountId, deltaCentavos: input.amountCentavos })
  }
  return legs
}

/** Empty legacy status values have always been treated as posted by Shikin adapters. */
export function normalizePostingStatus(
  status: string | null | undefined
): PostingStatus | 'invalid' {
  const normalized = status?.trim().toLowerCase() ?? ''
  if (normalized === '') return 'posted'
  if (normalized === 'pending' || normalized === 'posted' || normalized === 'cleared') {
    return normalized
  }
  return 'invalid'
}

export function getEffectiveLedgerStatus(
  entry: Pick<LedgerEntry, 'status' | 'ledgerTreatment' | 'transactionKind' | 'isArchived'>
): EffectiveLedgerStatus {
  assertLedgerTreatment(entry.ledgerTreatment)
  assertTransactionKind(entry.transactionKind)
  assertArchiveFlag(entry.isArchived)

  const postingStatus = normalizePostingStatus(entry.status)
  if (postingStatus === 'invalid') {
    return { postsToLedger: false, postingStatus, reason: 'invalid_status' }
  }
  if (postingStatus === 'pending') {
    return { postsToLedger: false, postingStatus, reason: 'pending' }
  }
  if (entry.ledgerTreatment === 'staged_no_balance_impact') {
    return { postsToLedger: false, postingStatus, reason: 'staged_no_balance_impact' }
  }
  if (isArchived(entry.isArchived) || entry.transactionKind === 'archived_transfer_mirror') {
    return { postsToLedger: false, postingStatus, reason: 'archived_provenance' }
  }
  return { postsToLedger: true, postingStatus, reason: 'effective' }
}

export function calculateSignedLedgerDeltas(entry: LedgerEntry): SignedLedgerDeltaResult {
  assertCentavos(entry.amountCentavos)
  assertTransactionType(entry.type)
  assertLedgerTreatment(entry.ledgerTreatment)
  assertTransactionKind(entry.transactionKind)
  assertArchiveFlag(entry.isArchived)
  assertAccountContext(entry.account, 'account')
  const transactionCurrency = normalizeCurrency(entry.currency, 'currency')
  const sourceAccountCurrency = normalizeCurrency(entry.account.currency, 'account.currency')
  if (transactionCurrency !== sourceAccountCurrency) {
    throw new TypeError(
      `Transaction currency ${transactionCurrency} does not match source account currency ${sourceAccountCurrency}`
    )
  }

  if (entry.account.accountMode === 'snapshot_only') {
    return { status: 'rejected', reason: 'snapshot_only_account', deltas: [] }
  }

  if (entry.type === 'transfer' && entry.transferToAccount) {
    assertAccountContext(entry.transferToAccount, 'transferToAccount')
    if (entry.transferToAccount.accountMode === 'snapshot_only') {
      return { status: 'rejected', reason: 'snapshot_only_account', deltas: [] }
    }
    if (entry.transferToAccount.accountId === entry.account.accountId) {
      return { status: 'rejected', reason: 'same_account_transfer', deltas: [] }
    }
    if (
      normalizeCurrency(entry.transferToAccount.currency, 'transferToAccount.currency') !==
      sourceAccountCurrency
    ) {
      return { status: 'rejected', reason: 'cross_currency_transfer', deltas: [] }
    }
  }

  const effectiveStatus = getEffectiveLedgerStatus(entry)
  if (!effectiveStatus.postsToLedger) {
    return { status: 'excluded', effectiveStatus, deltas: [] }
  }

  if (entry.type === 'transfer') {
    const destination = entry.transferToAccount
    if (!destination) {
      return {
        status: 'unresolved',
        reason: 'missing_transfer_destination',
        effectiveStatus,
        deltas: [],
      }
    }

    return {
      status: 'applied',
      effectiveStatus,
      deltas: orderedLedgerLegs(
        {
          type: entry.type,
          amountCentavos: entry.amountCentavos,
          accountId: entry.account.accountId,
          transferToAccountId: destination.accountId,
        },
        'all'
      ),
    }
  }

  return {
    status: 'applied',
    effectiveStatus,
    deltas: orderedLedgerLegs(
      {
        type: entry.type,
        amountCentavos: entry.amountCentavos,
        accountId: entry.account.accountId,
      },
      'all'
    ),
  }
}

export type SignedLedgerDeltaForAccountResult =
  | (Extract<SignedLedgerDeltaResult, { status: 'applied' }> & { deltaCentavos: number })
  | Exclude<SignedLedgerDeltaResult, { status: 'applied' }>

export function signedLedgerDeltaForAccount(
  entry: LedgerEntry,
  accountId: string
): SignedLedgerDeltaForAccountResult {
  const result = calculateSignedLedgerDeltas(entry)
  if (result.status !== 'applied') return result
  return {
    ...result,
    deltaCentavos: result.deltas.find((delta) => delta.accountId === accountId)?.deltaCentavos ?? 0,
  }
}

function assertTransactionType(value: unknown): asserts value is TransactionType {
  if (value !== 'income' && value !== 'expense' && value !== 'transfer') {
    throw new TypeError(`Unsupported transaction type: ${String(value)}`)
  }
}

function assertLedgerTreatment(
  value: unknown
): asserts value is LedgerTreatment | null | undefined {
  if (
    value !== undefined &&
    value !== null &&
    value !== 'normal' &&
    value !== 'staged_no_balance_impact'
  ) {
    throw new TypeError(`Unsupported ledger treatment: ${String(value)}`)
  }
}

function assertTransactionKind(
  value: unknown
): asserts value is TransactionKind | null | undefined {
  if (
    value !== undefined &&
    value !== null &&
    value !== 'standard' &&
    value !== 'reconciliation_bridge' &&
    value !== 'archived_transfer_mirror'
  ) {
    throw new TypeError(`Unsupported transaction kind: ${String(value)}`)
  }
}

function assertAccountContext(value: LedgerAccountContext, label: string): void {
  if (!value || typeof value !== 'object') throw new TypeError(`${label} context is required`)
  if (value.accountMode !== 'transactional' && value.accountMode !== 'snapshot_only') {
    throw new TypeError(`Unsupported account mode: ${String(value.accountMode)}`)
  }
  requiredTrimmed(value.accountId, `${label}.accountId`)
  normalizeCurrency(value.currency, `${label}.currency`)
}

function normalizeCurrency(value: unknown, label: string): string {
  const normalized = requiredTrimmed(value, label).toUpperCase()
  if (!/^[A-Z0-9]{2,10}$/.test(normalized)) {
    throw new TypeError(`${label} must be a 2-10 character asset or currency code`)
  }
  return normalized
}

function requiredTrimmed(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must not be empty`)
  return value.trim()
}

function assertArchiveFlag(value: unknown): asserts value is RuntimeArchiveFlag | undefined {
  if (
    value !== undefined &&
    value !== null &&
    value !== false &&
    value !== true &&
    value !== 0 &&
    value !== 1
  ) {
    throw new TypeError(`Unsupported archive flag: ${String(value)}`)
  }
}

function isArchived(value: RuntimeArchiveFlag | undefined): boolean {
  return value === true || value === 1
}

function assertCentavos(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('amountCentavos must be a non-negative safe integer')
  }
}
