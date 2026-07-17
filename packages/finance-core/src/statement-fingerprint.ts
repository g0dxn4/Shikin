import type { TransactionType } from './ledger.js'

export interface StatementIdentityInput {
  accountId: string
  sourceNamespace: string
  date: string
  type: TransactionType
  amountCentavos: number
  currency: string
  description: string
  externalId?: string | null
  occurrenceOrdinal?: number | null
}

export interface AssignedStatementOccurrenceOrdinal {
  rowIndex: number
  occurrenceOrdinal: number | null
  fallbackGroupCanonicalMaterial: string | null
}

export type StatementIdentityMaterial =
  | {
      strategy: 'external_id'
      canonicalMaterial: string
      externalId: string
    }
  | {
      strategy: 'occurrence_ordinal'
      canonicalMaterial: string
      occurrenceOrdinal: number
    }
  | {
      strategy: 'unresolved'
      reason: 'missing_external_id_and_occurrence_ordinal'
      canonicalMaterial: null
    }

/**
 * Assign fallback ordinals within one statement. Rows are grouped by immutable
 * fallback material, so unrelated row ordering cannot change their ordinals.
 * Exact duplicates remain distinct as ordinal 0, 1, and so on.
 */
export function assignStatementOccurrenceOrdinals(
  inputs: readonly StatementIdentityInput[]
): AssignedStatementOccurrenceOrdinal[] {
  const nextOrdinalByGroup = new Map<string, number>()
  return inputs.map((input, rowIndex) => {
    if (hasExternalId(input.externalId)) {
      validateExternalIdentity(input)
      return {
        rowIndex,
        occurrenceOrdinal: null,
        fallbackGroupCanonicalMaterial: null,
      }
    }

    const fallbackGroupCanonicalMaterial = canonicalFallbackGroupMaterial(input)
    const occurrenceOrdinal = nextOrdinalByGroup.get(fallbackGroupCanonicalMaterial) ?? 0
    nextOrdinalByGroup.set(fallbackGroupCanonicalMaterial, occurrenceOrdinal + 1)
    return { rowIndex, occurrenceOrdinal, fallbackGroupCanonicalMaterial }
  })
}

/**
 * Produce deterministic identity material only. Adapters may hash this material
 * with SHA-256; this package intentionally does not label the material itself a hash.
 */
export function canonicalStatementIdentityMaterial(
  input: StatementIdentityInput
): StatementIdentityMaterial {
  const accountId = requiredTrimmed(input.accountId, 'accountId')
  const sourceNamespace = requiredTrimmed(input.sourceNamespace, 'sourceNamespace')

  if (hasExternalId(input.externalId)) {
    const externalId = requiredExact(input.externalId, 'externalId')
    return {
      strategy: 'external_id',
      externalId,
      canonicalMaterial: JSON.stringify({
        version: 1,
        namespace: 'shikin-statement-identity',
        strategy: 'external_id',
        accountId,
        sourceNamespace,
        externalId,
      }),
    }
  }

  assertTransactionType(input.type)
  assertCentavos(input.amountCentavos)
  const currency = requiredTrimmed(input.currency, 'currency').toUpperCase()
  if (!Number.isSafeInteger(input.occurrenceOrdinal) || (input.occurrenceOrdinal ?? -1) < 0) {
    return {
      strategy: 'unresolved',
      reason: 'missing_external_id_and_occurrence_ordinal',
      canonicalMaterial: null,
    }
  }

  const occurrenceOrdinal = input.occurrenceOrdinal as number
  return {
    strategy: 'occurrence_ordinal',
    occurrenceOrdinal,
    canonicalMaterial: JSON.stringify({
      version: 1,
      namespace: 'shikin-statement-identity',
      strategy: 'occurrence_ordinal',
      accountId,
      sourceNamespace,
      date: requiredTrimmed(input.date, 'date'),
      type: input.type,
      amountCentavos: input.amountCentavos,
      currency,
      description: normalizeDescription(input.description),
      occurrenceOrdinal,
    }),
  }
}

function canonicalFallbackGroupMaterial(input: StatementIdentityInput): string {
  assertTransactionType(input.type)
  assertCentavos(input.amountCentavos)
  return JSON.stringify({
    version: 1,
    namespace: 'shikin-statement-fallback-group',
    accountId: requiredTrimmed(input.accountId, 'accountId'),
    sourceNamespace: requiredTrimmed(input.sourceNamespace, 'sourceNamespace'),
    date: requiredTrimmed(input.date, 'date'),
    type: input.type,
    amountCentavos: input.amountCentavos,
    currency: requiredTrimmed(input.currency, 'currency').toUpperCase(),
    description: normalizeDescription(input.description),
  })
}

function validateExternalIdentity(input: StatementIdentityInput): void {
  requiredTrimmed(input.accountId, 'accountId')
  requiredTrimmed(input.sourceNamespace, 'sourceNamespace')
  requiredExact(input.externalId as string, 'externalId')
}

function hasExternalId(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value.length > 0
}

function normalizeDescription(value: string): string {
  return requiredTrimmed(value, 'description').replace(/\s+/g, ' ').toLowerCase()
}

function requiredTrimmed(value: string, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  const trimmed = value.trim()
  if (!trimmed) throw new TypeError(`${label} must not be empty`)
  return trimmed
}

function requiredExact(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must not be empty`)
  return value
}

function assertTransactionType(value: unknown): asserts value is TransactionType {
  if (value !== 'income' && value !== 'expense' && value !== 'transfer') {
    throw new TypeError(`Unsupported transaction type: ${String(value)}`)
  }
}

function assertCentavos(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('amountCentavos must be a non-negative safe integer')
  }
}
