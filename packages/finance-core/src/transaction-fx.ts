import { convertCentavosAsOf, type DatedExchangeRate, type FxProvenance } from './fx.js'

export type TransactionFxType = 'income' | 'expense'
export type TransactionFxStatus = 'pending' | 'posted' | 'cleared'
export type TransactionFxLedgerTreatment = 'normal' | 'staged_no_balance_impact'

export interface TransactionFxAcceptanceGuard {
  version: 1
  inputAmountCentavos: number
  inputCurrency: string
  accountId: string
  accountCurrency: string
  mainCurrency: string
  transactionDate: string
  transactionType: TransactionFxType
  status: TransactionFxStatus
  ledgerTreatment: TransactionFxLedgerTreatment
  accountAmountCentavos: number
  rateId: string | null
  effectiveFrom: string | null
  rateDecimal: string
  direction: string
}

export interface TransactionFxPreview {
  inputAmountCentavos: number
  inputCurrency: string
  accountId: string
  accountCurrency: string
  mainCurrency: string
  transactionDate: string
  transactionType: TransactionFxType
  status: TransactionFxStatus
  ledgerTreatment: TransactionFxLedgerTreatment
  accountAmountCentavos: number
  accountBalanceDeltaCentavos: number
  conversion: FxProvenance & { complete: true; amountCentavos: number; missingReason: null }
  acceptanceGuard: TransactionFxAcceptanceGuard
}

export interface TransactionFxEvidenceSnapshot {
  id: string
  transactionId: string
  originalTransactionId: string
  originalAccountId: string
  transactionType: TransactionFxType
  status: TransactionFxStatus
  ledgerTreatment: TransactionFxLedgerTreatment
  inputAmountCentavos: number
  inputCurrency: string
  accountAmountCentavos: number
  accountCurrency: string
  accountBalanceDeltaCentavos: number
  transactionDate: string
  rateId: string | null
  rateDecimal: string
  createdAt: string
}

function assertPositiveCentavos(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('Foreign input amount must be a positive safe integer number of centavos')
  }
}

/**
 * Resolve one explicit original input into account-ledger denomination. Different-currency input
 * is deliberately limited to a configured main-currency account; transfers and splits are adapter
 * concerns and must be rejected before calling this helper.
 */
export function resolveTransactionFxPreview(input: {
  inputAmountCentavos: number
  inputCurrency: string
  accountId: string
  accountCurrency: string
  mainCurrency: string | null
  transactionDate: string
  transactionType: TransactionFxType
  status: TransactionFxStatus
  ledgerTreatment: TransactionFxLedgerTreatment
  rates: readonly DatedExchangeRate[]
}): TransactionFxPreview {
  assertPositiveCentavos(input.inputAmountCentavos)
  if (!input.accountId) throw new Error('FX input requires an account identity')
  if (!input.mainCurrency) throw new Error('Main currency must be configured before foreign input')
  if (
    input.inputCurrency !== input.accountCurrency &&
    input.accountCurrency !== input.mainCurrency
  ) {
    throw new Error(
      `Foreign-to-foreign transaction input is not supported. Enter ${input.accountCurrency} for this account or choose a ${input.mainCurrency} account.`
    )
  }

  const conversion = convertCentavosAsOf({
    amountCentavos: input.inputAmountCentavos,
    fromCurrency: input.inputCurrency,
    toCurrency: input.accountCurrency,
    asOfDate: input.transactionDate,
    rates: input.rates,
  })
  if (!conversion.complete) {
    throw new Error(
      `No direct manual exchange rate is available for ${input.inputCurrency}->${input.accountCurrency} on ${input.transactionDate}.`
    )
  }
  if (conversion.amountCentavos <= 0) {
    throw new Error('Foreign input rounds to zero in the account currency')
  }

  const accountBalanceDeltaCentavos =
    input.status === 'pending' || input.ledgerTreatment !== 'normal'
      ? 0
      : input.transactionType === 'income'
        ? conversion.amountCentavos
        : -conversion.amountCentavos
  const rateDecimal = conversion.rateDecimal!
  const acceptanceGuard: TransactionFxAcceptanceGuard = {
    version: 1,
    inputAmountCentavos: input.inputAmountCentavos,
    inputCurrency: input.inputCurrency,
    accountId: input.accountId,
    accountCurrency: input.accountCurrency,
    mainCurrency: input.mainCurrency,
    transactionDate: input.transactionDate,
    transactionType: input.transactionType,
    status: input.status,
    ledgerTreatment: input.ledgerTreatment,
    accountAmountCentavos: conversion.amountCentavos,
    rateId: conversion.rateId,
    effectiveFrom: conversion.effectiveFrom,
    rateDecimal,
    direction: conversion.direction,
  }

  return {
    inputAmountCentavos: input.inputAmountCentavos,
    inputCurrency: input.inputCurrency,
    accountId: input.accountId,
    accountCurrency: input.accountCurrency,
    mainCurrency: input.mainCurrency,
    transactionDate: input.transactionDate,
    transactionType: input.transactionType,
    status: input.status,
    ledgerTreatment: input.ledgerTreatment,
    accountAmountCentavos: conversion.amountCentavos,
    accountBalanceDeltaCentavos,
    conversion,
    acceptanceGuard,
  }
}

export function assertTransactionFxAcceptanceGuard(
  supplied: TransactionFxAcceptanceGuard | null | undefined,
  current: TransactionFxAcceptanceGuard
): void {
  if (!supplied || JSON.stringify(supplied) !== JSON.stringify(current)) {
    throw new Error(
      'Foreign-input preview is stale. Preview again and accept the current account amount and rate.'
    )
  }
}

export function buildTransactionFxEvidenceSnapshot(input: {
  id: string
  transactionId: string
  createdAt: string
  preview: TransactionFxPreview
}): TransactionFxEvidenceSnapshot {
  const { preview } = input
  return {
    id: input.id,
    transactionId: input.transactionId,
    originalTransactionId: input.transactionId,
    originalAccountId: preview.accountId,
    transactionType: preview.transactionType,
    status: preview.status,
    ledgerTreatment: preview.ledgerTreatment,
    inputAmountCentavos: preview.inputAmountCentavos,
    inputCurrency: preview.inputCurrency,
    accountAmountCentavos: preview.accountAmountCentavos,
    accountCurrency: preview.accountCurrency,
    accountBalanceDeltaCentavos: preview.accountBalanceDeltaCentavos,
    transactionDate: preview.transactionDate,
    rateId: preview.conversion.rateId,
    rateDecimal: preview.conversion.rateDecimal!,
    createdAt: input.createdAt,
  }
}

export const TRANSACTION_FX_EVIDENCE_INSERT = `INSERT INTO transaction_fx_evidence (
  id, transaction_id, original_transaction_id, original_account_id, transaction_type, status,
  ledger_treatment, input_amount_centavos, input_currency, account_amount_centavos,
  account_currency, account_balance_delta_centavos, transaction_date, rate_id, rate_decimal, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

export function transactionFxEvidenceBindings(
  evidence: TransactionFxEvidenceSnapshot
): (string | number | null)[] {
  return [
    evidence.id,
    evidence.transactionId,
    evidence.originalTransactionId,
    evidence.originalAccountId,
    evidence.transactionType,
    evidence.status,
    evidence.ledgerTreatment,
    evidence.inputAmountCentavos,
    evidence.inputCurrency,
    evidence.accountAmountCentavos,
    evidence.accountCurrency,
    evidence.accountBalanceDeltaCentavos,
    evidence.transactionDate,
    evidence.rateId,
    evidence.rateDecimal,
    evidence.createdAt,
  ]
}
