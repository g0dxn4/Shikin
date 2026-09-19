import { signedLedgerDeltaForAccount, type AccountMode, type LedgerEntry } from './ledger.js'

export type ReconciliationInput =
  | {
      accountMode: 'transactional'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: number
    }
  | {
      accountMode: 'snapshot_only'
      observedBalanceCentavos: number
    }

export type ReconciliationAdjustment =
  | {
      status: 'ledger_adjustment'
      accountMode: 'transactional'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: number
      adjustmentCentavos: number
      bridge: null | {
        type: 'income' | 'expense'
        amountCentavos: number
        reportingTreatment: 'exclude_from_cashflow'
        transactionKind: 'reconciliation_bridge'
      }
    }
  | {
      status: 'observed_balance'
      accountMode: 'snapshot_only'
      observedBalanceCentavos: number
      effectiveLedgerBalanceCentavos: null
      adjustmentCentavos: null
      bridge: null
    }

/** Reconcile a transactional ledger or record a snapshot-only observed balance. */
export function calculateReconciliationAdjustment(
  input: ReconciliationInput
): ReconciliationAdjustment {
  assertAccountMode(input.accountMode)
  assertCentavos(input.observedBalanceCentavos, 'observedBalanceCentavos')

  if (input.accountMode === 'snapshot_only') {
    return {
      status: 'observed_balance',
      accountMode: input.accountMode,
      observedBalanceCentavos: input.observedBalanceCentavos,
      effectiveLedgerBalanceCentavos: null,
      adjustmentCentavos: null,
      bridge: null,
    }
  }

  assertCentavos(input.effectiveLedgerBalanceCentavos, 'effectiveLedgerBalanceCentavos')
  const adjustmentCentavos = input.observedBalanceCentavos - input.effectiveLedgerBalanceCentavos
  if (!Number.isSafeInteger(adjustmentCentavos)) {
    throw new RangeError('reconciliation adjustment exceeds the safe integer range')
  }

  return {
    status: 'ledger_adjustment',
    accountMode: input.accountMode,
    observedBalanceCentavos: input.observedBalanceCentavos,
    effectiveLedgerBalanceCentavos: input.effectiveLedgerBalanceCentavos,
    adjustmentCentavos,
    bridge:
      adjustmentCentavos === 0
        ? null
        : {
            type: adjustmentCentavos > 0 ? 'income' : 'expense',
            amountCentavos: Math.abs(adjustmentCentavos),
            reportingTreatment: 'exclude_from_cashflow',
            transactionKind: 'reconciliation_bridge',
          },
  }
}

function assertAccountMode(value: unknown): asserts value is AccountMode {
  if (value !== 'transactional' && value !== 'snapshot_only') {
    throw new TypeError(`Unsupported account mode: ${String(value)}`)
  }
}

function assertCentavos(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`)
}

export type ValuationDeclaration = 'cash_plus_holdings' | 'portfolio_snapshot' | 'unresolved'

/** Explicit declarations always win; never infer ownership from a balance. */
export function accountValuationDeclaration(input: {
  type: string
  accountMode?: string | undefined
  valuationMode?: ValuationDeclaration | undefined
  creating?: boolean
}): ValuationDeclaration {
  if (input.valuationMode !== undefined) {
    if (!['cash_plus_holdings', 'portfolio_snapshot', 'unresolved'].includes(input.valuationMode)) {
      throw new Error('Invalid valuationMode.')
    }
    return input.valuationMode
  }
  if (input.creating && ['investment', 'crypto'].includes(input.type)) {
    throw new Error(
      'Portfolio accounts require an explicit valuationMode: cash_plus_holdings, portfolio_snapshot, or unresolved. Choose who owns the balance; do not infer from its amount.'
    )
  }
  if (input.accountMode === 'snapshot_only') return 'portfolio_snapshot'
  return ['investment', 'crypto'].includes(input.type) ? 'unresolved' : 'cash_plus_holdings'
}

export function safeMoney(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new RangeError('Financial result exceeds safe integer centavos.')
  return value
}

export function assertObservationDate(date: string, today: string): void {
  assertLedgerDate(date)
  if (date > today)
    throw new Error(
      'Observed date cannot be in the future. Observations are end-of-day, not intraday.'
    )
}

function assertLedgerDate(date: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Invalid end-of-day ledger date: ${date}`)
  }
}

export interface DatedLedgerRow {
  id: string
  date: string
  type: LedgerEntry['type']
  amount: number
  currency: string
  account_id: string
  transfer_to_account_id: string | null
  matched_transaction_id: string | null
  status: string | null
  ledger_treatment: LedgerEntry['ledgerTreatment']
  transaction_kind: LedgerEntry['transactionKind']
  reporting_treatment: string | null
  is_archived: 0 | 1 | null
  source_account_id: string | null
  source_currency: string | null
  source_account_mode: LedgerEntry['account']['accountMode'] | null
  destination_account_id: string | null
  destination_currency: string | null
  destination_account_mode: LedgerEntry['account']['accountMode'] | null
}

/** Query ALL relevant rows, including archived mirrors and reverse links. Never prefilter dates. */
export const datedLedgerQuery = `SELECT t.*,
 source.id AS source_account_id, source.currency AS source_currency,
 source.account_mode AS source_account_mode,
 destination.id AS destination_account_id, destination.currency AS destination_currency,
 destination.account_mode AS destination_account_mode
 FROM transactions t
 LEFT JOIN accounts source ON source.id = t.account_id
 LEFT JOIN accounts destination ON destination.id = t.transfer_to_account_id
 WHERE t.account_id = ? OR t.transfer_to_account_id = ?
 OR t.id IN (SELECT matched_transaction_id FROM transactions WHERE account_id = ? OR transfer_to_account_id = ?)
 OR t.matched_transaction_id IN (SELECT id FROM transactions WHERE account_id = ? OR transfer_to_account_id = ?)
 ORDER BY t.id`

function validatePair(source: DatedLedgerRow, mirror: DatedLedgerRow | undefined): void {
  const posted = (r: DatedLedgerRow) => r.status === 'posted' || r.status === 'cleared'
  if (
    !mirror ||
    mirror.id === source.id ||
    source.matched_transaction_id !== mirror.id ||
    mirror.matched_transaction_id !== source.id ||
    source.type !== 'transfer' ||
    source.transaction_kind !== 'standard' ||
    source.is_archived !== 0 ||
    mirror.type !== 'income' ||
    mirror.transaction_kind !== 'archived_transfer_mirror' ||
    mirror.is_archived !== 1 ||
    source.transfer_to_account_id !== mirror.account_id ||
    source.destination_account_id !== mirror.account_id ||
    source.account_id === mirror.account_id ||
    mirror.transfer_to_account_id !== null ||
    source.ledger_treatment !== 'normal' ||
    mirror.ledger_treatment !== 'normal' ||
    source.reporting_treatment !== 'exclude_from_cashflow' ||
    mirror.reporting_treatment !== 'exclude_from_cashflow' ||
    !posted(source) ||
    !posted(mirror) ||
    source.amount <= 0 ||
    !Number.isSafeInteger(source.amount) ||
    source.amount !== mirror.amount ||
    source.currency !== mirror.currency ||
    source.currency !== source.source_currency ||
    mirror.currency !== mirror.source_currency ||
    source.destination_currency !== mirror.currency ||
    source.source_account_id !== source.account_id ||
    mirror.source_account_id !== mirror.account_id ||
    source.source_account_mode !== 'transactional' ||
    mirror.source_account_mode !== 'transactional' ||
    source.destination_account_mode !== 'transactional'
  ) {
    throw new Error(
      `Broken or ambiguous matched transfer ${source.id}; repair the pair explicitly before reconciliation.`
    )
  }
  assertLedgerDate(source.date)
  assertLedgerDate(mirror.date)
}

export function projectDatedLedger(
  rows: readonly DatedLedgerRow[],
  accountId: string,
  asOf?: string
): number {
  if (asOf !== undefined) assertLedgerDate(asOf)
  const byId = new Map(rows.map((row) => [row.id, row]))
  if (byId.size !== rows.length) throw new Error('Duplicate projection row IDs.')
  let balance = 0
  for (const row of rows) {
    if (row.matched_transaction_id || row.transaction_kind === 'archived_transfer_mirror') {
      const source =
        row.transaction_kind === 'archived_transfer_mirror'
          ? byId.get(row.matched_transaction_id ?? '')
          : row
      if (!source) throw new Error(`Missing matched source for ${row.id}.`)
      const mirror = byId.get(source.matched_transaction_id ?? '')
      validatePair(source, mirror)
      if (row !== source) continue
      if (source.account_id === accountId && (!asOf || source.date <= asOf))
        balance = safeMoney(balance - source.amount)
      if (mirror!.account_id === accountId && (!asOf || mirror!.date <= asOf))
        balance = safeMoney(balance + source.amount)
      continue
    }
    assertLedgerDate(row.date)
    if (!row.source_account_id || !row.source_currency)
      throw new Error(`Missing account for ${row.id}.`)
    const result = signedLedgerDeltaForAccount(
      {
        type: row.type,
        amountCentavos: row.amount,
        currency: row.currency,
        account: {
          accountId: row.source_account_id,
          currency: row.source_currency,
          accountMode: row.source_account_mode ?? 'transactional',
        },
        transferToAccount:
          row.destination_account_id && row.destination_currency
            ? {
                accountId: row.destination_account_id,
                currency: row.destination_currency,
                accountMode: row.destination_account_mode ?? 'transactional',
              }
            : null,
        status: row.status,
        ledgerTreatment: row.ledger_treatment ?? null,
        transactionKind: row.transaction_kind ?? null,
        isArchived: row.is_archived,
      },
      accountId
    )
    if (result.status === 'rejected' || result.status === 'unresolved')
      throw new Error(`Invalid ledger row ${row.id}: ${result.reason}`)
    if (result.status === 'applied' && (!asOf || row.date <= asOf))
      balance = safeMoney(balance + result.deltaCentavos)
  }
  return balance
}

export function planDatedReconciliation(input: {
  rows: readonly DatedLedgerRow[]
  accountId: string
  date: string
  today: string
  observedBalance: number
  storedBalance: number
  laterAnchorDates: readonly string[]
}) {
  assertObservationDate(input.date, input.today)
  const asOfLedger = projectDatedLedger(input.rows, input.accountId, input.date)
  const currentLedger = projectDatedLedger(input.rows, input.accountId)
  const adjustment = safeMoney(safeMoney(input.observedBalance) - asOfLedger)
  if (adjustment !== 0 && input.laterAnchorDates.some((date) => date > input.date)) {
    throw new Error(
      'Nonzero backdated reconciliation crosses a later anchor. Use reviewed bridge supersession instead.'
    )
  }
  const currentBalanceAfter = safeMoney(currentLedger + adjustment)
  return {
    asOfLedger,
    currentLedger,
    adjustment,
    currentBalanceAfter,
    storedVsLedgerDiscrepancy: safeMoney(input.storedBalance - currentLedger),
    storedBalanceEffect: safeMoney(currentBalanceAfter - input.storedBalance),
    laterActivityRetained: safeMoney(currentLedger - asOfLedger),
  }
}
