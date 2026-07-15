import { createHash } from 'node:crypto'

const OPERATION_KEY_DOMAIN = Buffer.from(
  'shikin.database-operation-recovery-journal/v1/operation-key\0',
  'utf8'
)
const ARTIFACT_KEY_DOMAIN = Buffer.from(
  'shikin.database-operation-recovery-journal/v1/artifact-key\0',
  'utf8'
)
const ARTIFACT_CONTENT_DOMAIN = Buffer.from(
  'shikin.database-operation-recovery-journal/v1/artifact-content\0',
  'utf8'
)
const RECORD_DOMAIN = Buffer.from('shikin.database-operation-recovery-journal/v1/record\0', 'utf8')

export function canonicalRecoveryJournalBytes(value) {
  return Buffer.from(canonicalValue(value, new Set()), 'utf8')
}

export function recoveryOperationKey(databaseIdentity, operationId) {
  return digestParts([
    OPERATION_KEY_DOMAIN,
    utf8(databaseIdentity, 'databaseIdentity'),
    ZERO,
    utf8(operationId, 'operationId'),
  ])
}

export function recoveryArtifactKey(operationKey, nonce, role) {
  assertLowerHex(operationKey, 64, 'operationKey')
  assertLowerHex(nonce, 64, 'nonce')
  if (role !== 'candidate' && role !== 'rollback') {
    throw new TypeError('role must be candidate or rollback')
  }
  return digestParts([
    ARTIFACT_KEY_DOMAIN,
    Buffer.from(operationKey, 'ascii'),
    ZERO,
    Buffer.from(nonce, 'ascii'),
    ZERO,
    Buffer.from(role, 'ascii'),
  ])
}

export function createRecoveryArtifactHasher(role) {
  if (role !== 'candidate' && role !== 'rollback') {
    throw new TypeError('role must be candidate or rollback')
  }
  return createHash('sha256')
    .update(ARTIFACT_CONTENT_DOMAIN)
    .update(Buffer.from(role, 'ascii'))
    .update(ZERO)
}

export function recoveryArtifactDigest(role, bytes) {
  const hash = createRecoveryArtifactHasher(role)
  hash.update(bytes)
  return `sha256:${hash.digest('hex')}`
}

export function recoveryRecordHash(canonicalRecordBytes) {
  return createHash('sha256').update(RECORD_DOMAIN).update(canonicalRecordBytes).digest('hex')
}

function canonicalValue(value, ancestors) {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'string') return canonicalString(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new TypeError('canonical integers must be non-negative safe integers')
    }
    return String(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError('unsupported canonical value')
  }
  if (ancestors.has(value)) throw new TypeError('cyclic canonical value')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value)
      if (
        keys.length !== value.length ||
        keys.some((key, index) => key !== String(index)) ||
        Object.getOwnPropertySymbols(value).length !== 0
      ) {
        throw new TypeError('canonical arrays must be dense and index-only')
      }
      return `[${value.map((item) => canonicalValue(item, ancestors)).join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('canonical objects must be plain objects')
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError('canonical object keys must be strings')
    }
    const keys = Object.keys(value).sort(compareUtf8)
    return `{${keys
      .map((key) => `${canonicalString(key)}:${canonicalValue(value[key], ancestors)}`)
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

function canonicalString(value) {
  let output = '"'
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = value.charCodeAt(index + 1)
      if (!Number.isInteger(low) || low < 0xdc00 || low > 0xdfff) {
        throw new TypeError('lone Unicode surrogate')
      }
      output += value[index] + value[index + 1]
      index += 1
      continue
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) throw new TypeError('lone Unicode surrogate')
    switch (codeUnit) {
      case 0x08:
        output += '\\b'
        break
      case 0x09:
        output += '\\t'
        break
      case 0x0a:
        output += '\\n'
        break
      case 0x0c:
        output += '\\f'
        break
      case 0x0d:
        output += '\\r'
        break
      case 0x22:
        output += '\\"'
        break
      case 0x5c:
        output += '\\\\'
        break
      default:
        output += codeUnit <= 0x1f ? `\\u${codeUnit.toString(16).padStart(4, '0')}` : value[index]
    }
  }
  return `${output}"`
}

function compareUtf8(left, right) {
  canonicalString(left)
  canonicalString(right)
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function utf8(value, label) {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`)
  canonicalString(value)
  return Buffer.from(value, 'utf8')
}

function assertLowerHex(value, length, label) {
  if (typeof value !== 'string' || value.length !== length || !/^[0-9a-f]+$/.test(value)) {
    throw new TypeError(`${label} must be ${length} lowercase hexadecimal characters`)
  }
}

function digestParts(parts) {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return hash.digest('hex')
}

const ZERO = Buffer.from([0])
