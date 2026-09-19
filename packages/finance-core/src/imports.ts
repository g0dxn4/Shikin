import {
  assignStatementOccurrenceOrdinals,
  canonicalStatementIdentityMaterial,
  type StatementIdentityInput,
  type StatementIdentityMaterial,
} from './statement-fingerprint.js'

export type ImportDirection = 'income' | 'expense' | 'transfer'

export interface ImportFinancialContentInput {
  accountId: string
  sourceNamespace: string
  externalId?: string | null
  date: string
  type: ImportDirection
  amountCentavos: number
  currency: string
  transferToAccountId?: string | null
}

export interface PreparedImportIdentity {
  rowIndex: number
  identity: StatementIdentityMaterial
  identityKey: string
  contentMaterial: string
  contentFingerprint: string
}

export interface ImportReviewDecision {
  candidateIdentityKey: string
  candidateContentFingerprint: string
  existingTransactionId: string
  existingEvidenceFingerprint: string
  decision: 'distinct' | 'keep_existing'
}

function requiredTrimmed(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must not be empty`)
  return value.trim()
}

function exactExternalId(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.length === 0) return null
  if (!value.trim()) throw new TypeError('externalId must not be empty')
  return value
}

function assertFinancialContent(input: ImportFinancialContentInput): void {
  if (!['income', 'expense', 'transfer'].includes(input.type)) {
    throw new TypeError(`Unsupported transaction type: ${String(input.type)}`)
  }
  if (!Number.isSafeInteger(input.amountCentavos) || input.amountCentavos < 0) {
    throw new RangeError('amountCentavos must be a non-negative safe integer')
  }
  if (input.type === 'transfer' && !input.transferToAccountId) {
    throw new TypeError('transferToAccountId is required for transfer content')
  }
  if (input.type !== 'transfer' && input.transferToAccountId) {
    throw new TypeError('transferToAccountId is only valid for transfer content')
  }
}

/** Canonical immutable financial source content. Editable ledger metadata is excluded. */
export function canonicalImportFinancialContent(input: ImportFinancialContentInput): string {
  assertFinancialContent(input)
  return JSON.stringify({
    version: 1,
    namespace: 'shikin-import-financial-content',
    accountId: requiredTrimmed(input.accountId, 'accountId'),
    sourceNamespace: requiredTrimmed(input.sourceNamespace, 'sourceNamespace'),
    externalId: exactExternalId(input.externalId),
    date: requiredTrimmed(input.date, 'date'),
    type: input.type,
    amountCentavos: input.amountCentavos,
    currency: requiredTrimmed(input.currency, 'currency').toUpperCase(),
    transferToAccountId: input.transferToAccountId
      ? requiredTrimmed(input.transferToAccountId, 'transferToAccountId')
      : null,
  })
}

/** Small dependency-free SHA-256 used identically by browser and CLI adapters. */
function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = []
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (point <= 0x7f) bytes.push(point)
    else if (point <= 0x7ff) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f))
    else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 0x3f), 0x80 | (point & 0x3f))
    } else {
      bytes.push(
        0xf0 | (point >>> 18),
        0x80 | ((point >>> 12) & 0x3f),
        0x80 | ((point >>> 6) & 0x3f),
        0x80 | (point & 0x3f)
      )
    }
  }
  return Uint8Array.from(bytes)
}

export function sha256Fingerprint(value: string): string {
  const bytes = utf8Bytes(value)
  const words = new Uint32Array(64)
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ])
  const bitLength = bytes.length * 8
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false)
  view.setUint32(paddedLength - 4, bitLength >>> 0, false)
  const rotate = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount))

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index++)
      words[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]!
      const b = words[index - 2]!
      const s0 = rotate(a, 7) ^ rotate(a, 18) ^ (a >>> 3)
      const s1 = rotate(b, 17) ^ rotate(b, 19) ^ (b >>> 10)
      words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0
    }
    let a = hash[0]!
    let b = hash[1]!
    let c = hash[2]!
    let d = hash[3]!
    let e = hash[4]!
    let f = hash[5]!
    let g = hash[6]!
    let h = hash[7]!
    for (let index = 0; index < 64; index++) {
      const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
      const choose = (e & f) ^ (~e & g)
      const temp1 = (h + s1 + choose + constants[index]! + words[index]!) >>> 0
      const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temp2 = (s0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temp1) >>> 0
      d = c
      c = b
      b = a
      a = (temp1 + temp2) >>> 0
    }
    const next = [a, b, c, d, e, f, g, h]
    for (let index = 0; index < 8; index++) hash[index] = (hash[index]! + next[index]!) >>> 0
  }
  return `sha256:${Array.from(hash, (word) => word.toString(16).padStart(8, '0')).join('')}`
}

export function importContentFingerprint(input: ImportFinancialContentInput): string {
  return sha256Fingerprint(canonicalImportFinancialContent(input))
}

export function prepareImportIdentities(
  identityInputs: readonly StatementIdentityInput[],
  financialInputs: readonly ImportFinancialContentInput[]
): PreparedImportIdentity[] {
  if (identityInputs.length !== financialInputs.length) {
    throw new RangeError('Identity and financial content rows must have the same length')
  }
  const ordinals = assignStatementOccurrenceOrdinals(identityInputs)
  return identityInputs.map((input, rowIndex) => {
    const identity = canonicalStatementIdentityMaterial({
      ...input,
      occurrenceOrdinal: ordinals[rowIndex]!.occurrenceOrdinal,
    })
    if (!identity.canonicalMaterial)
      throw new Error(`Could not derive import identity for row ${rowIndex + 1}`)
    const contentMaterial = canonicalImportFinancialContent(financialInputs[rowIndex]!)
    return {
      rowIndex,
      identity,
      identityKey: sha256Fingerprint(identity.canonicalMaterial),
      contentMaterial,
      contentFingerprint: sha256Fingerprint(contentMaterial),
    }
  })
}

export function canonicalReviewDecisions(
  decisions: readonly ImportReviewDecision[]
): readonly ImportReviewDecision[] {
  const sorted = [...decisions].sort((left, right) =>
    [left.candidateIdentityKey, left.existingTransactionId]
      .join('\u0000')
      .localeCompare([right.candidateIdentityKey, right.existingTransactionId].join('\u0000'))
  )
  const seen = new Set<string>()
  for (const decision of sorted) {
    const key = `${decision.candidateIdentityKey}\u0000${decision.existingTransactionId}`
    if (seen.has(key)) throw new Error('Duplicate review decision for one import candidate')
    seen.add(key)
  }
  return sorted
}

export function importPlanToken(payload: unknown): string {
  return sha256Fingerprint(JSON.stringify(payload))
}
