import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  constants as fsConstants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readdirSync,
  readSync,
  realpathSync,
  writeSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import {
  canonicalRecoveryJournalBytes,
  createRecoveryArtifactHasher,
  recoveryArtifactKey,
  recoveryOperationKey,
  recoveryRecordHash,
} from './database-operation-recovery-journal-canonical.mjs'
import { SHIKIN_SCHEMA_CONTRACT_IDENTITY } from './shikin-schema-contract-identity.mjs'

const PROTOCOL = 'shikin.database-operation-recovery-journal'
const PROTOCOL_VERSION = 1
const DATABASE_IDENTITY = 'com.asf.shikin:shikin.db'
const RECOVERY_DIRECTORY = 'recovery-journal-v1'
const OPERATIONS_DIRECTORY = 'operations'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_WRITABLE_FILE_MODE = 0o600
const PRIVATE_READ_ONLY_FILE_MODE = 0o400
const HASH_CHUNK_SIZE = 1024 * 1024
const MAX_RECORD_BYTES = 1024 * 1024
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024
const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RECORD_NAME = /^00000000000000000000-([0-9a-f]{64})\.json$/
const OPERATION_RECORD_ENTRIES = Object.freeze(['artifacts', 'records'])
const RUNTIME_IDS = Object.freeze(['cli', 'mcp', 'browser-data-server', 'tauri'])
const ROLES = Object.freeze(['candidate', 'rollback'])
const CHECK_KEYS = Object.freeze([
  'integrityCheck',
  'foreignKeyCheck',
  'schemaContractCheck',
  'sidecarCheck',
])
const FAULT_POINTS = new Set([
  'after-recovery-root-create',
  'after-operations-directory-create',
  'after-operation-directory-create',
  'after-artifacts-directory-create',
  'after-records-directory-create',
  'after-candidate-artifact-create',
  'after-candidate-artifact-callback',
  'after-candidate-artifact-fsync',
  'after-rollback-artifact-create',
  'after-rollback-artifact-callback',
  'after-rollback-artifact-fsync',
  'after-record-create',
  'after-record-write',
  'after-record-fsync',
  'after-artifacts-directory-fsync',
  'after-records-directory-fsync',
  'after-operation-directory-fsync',
  'after-operations-directory-fsync',
  'after-recovery-root-fsync',
  'after-operation-root-fsync',
])

const proofState = new WeakMap()
const verifiedTokenState = new WeakMap()
let interArtifactHashTestHook

export class RecoveryJournalError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RecoveryJournalError'
    this.code = code
  }
}

export function setRecoveryJournalInterArtifactHashTestHookForTest(hook) {
  if (process.env.NODE_ENV !== 'test' || (hook !== undefined && typeof hook !== 'function')) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Recovery test hook is test-only')
  }
  interArtifactHashTestHook = hook
}

export function prepareMutationJournal(options) {
  try {
    const binding = validatePrepareOptions(options)
    requireLinuxDurability()
    const rootIdentity = validateOperationRoot(binding.operationRoot)
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    const parentIdentities = ensureJournalParents(paths, rootIdentity)

    if (pathExists(paths.operation)) {
      throw journalError(
        'RECOVERY_PREPARATION_INCOMPLETE',
        'An operation directory already exists and must not be read, modified, or reused'
      )
    }

    const directoryIdentities = new Map(
      parentIdentities.map((identity) => [identity.path, identity])
    )
    const operationIdentity = createPrivateDirectory(
      paths.operation,
      'after-operation-directory-create'
    )
    directoryIdentities.set(paths.operation, operationIdentity)
    const artifactsIdentity = createPrivateDirectory(
      paths.artifacts,
      'after-artifacts-directory-create'
    )
    directoryIdentities.set(paths.artifacts, artifactsIdentity)
    const recordsIdentity = createPrivateDirectory(paths.records, 'after-records-directory-create')
    directoryIdentities.set(paths.records, recordsIdentity)

    const nonce = randomBytes(32).toString('hex')
    const artifactRecords = {}
    const checks = {}
    for (const role of ROLES) {
      const artifactKey = recoveryArtifactKey(paths.operationKey, nonce, role)
      const filename = `${role}-${artifactKey}.sqlite`
      const artifactPath = join(paths.artifacts, filename)
      const result = writePreparedArtifact(
        role,
        artifactPath,
        binding,
        options.writeArtifact
      )
      artifactRecords[role] = {
        path: `artifacts/${filename}`,
        contentDigest: result.contentDigest,
        sizeBytes: result.sizeBytes,
      }
      checks[role] = result.checks
    }

    assertExactDirectoryEntries(
      paths.artifacts,
      [basename(artifactRecords.candidate.path), basename(artifactRecords.rollback.path)],
      true
    )
    assertNoSqliteSidecars(paths.artifacts)

    const record = {
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      recordKind: 'prepared_mutation',
      sequence: 0,
      previousRecordSha256: null,
      databaseIdentity: DATABASE_IDENTITY,
      operationId: binding.intent.operationId,
      operation: binding.intent.operation,
      owner: cloneOwner(binding.intent.owner),
      fencingGeneration: binding.intent.fencingGeneration,
      createdAt: binding.intent.createdAt,
      nonce,
      candidate: artifactRecords.candidate,
      rollback: artifactRecords.rollback,
      schemaContract: schemaContractIdentity(),
      checks: {
        candidate: checks.candidate,
        rollback: checks.rollback,
      },
    }
    const canonicalBytes = canonicalRecoveryJournalBytes(record)
    const commitmentSha256 = recoveryRecordHash(canonicalBytes)
    const recordPath = join(
      paths.records,
      `00000000000000000000-${commitmentSha256}.json`
    )
    writePreparedRecord(recordPath, canonicalBytes)

    const durability = finishDurability(paths)
    revalidateDirectoryIdentities(directoryIdentities)
    revalidateDirectoryIdentity(rootIdentity)
    const evidence = validateCompleteOperation(paths, binding)
    if (evidence.commitmentSha256 !== commitmentSha256) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record commitment changed')
    }
    return mintPreparedMutation(binding, paths, evidence, durability)
  } catch (error) {
    throw normalizeError(error)
  }
}

export function verifyPreparedMutationProof(proof, options) {
  const state = proofState.get(proof)
  if (!state) throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof is not authentic')
  if (state.used) throw journalError('PREPARED_PROOF_USED', 'Prepared proof was already consumed')
  if (state.active) {
    throw journalError('PREPARED_PROOF_ACTIVE', 'Prepared proof already has an active verifier')
  }
  try {
    const binding = validateVerificationOptions(options)
    if (!sameBinding(binding, state.binding)) {
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof binding does not match')
    }
    requireLinuxDurability()
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    if (paths.operation !== state.paths.operation) {
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof path does not match')
    }
    const evidence = validateCompleteOperation(paths, binding, true)
    if (
      evidence.commitmentSha256 !== state.commitmentSha256 ||
      evidence.durability !== state.durability
    ) {
      closeRetainedEvidence(evidence.retainedEvidence)
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof commitment does not match')
    }
    const token = Object.freeze(Object.create(null))
    const tokenState = {
      proof: state,
      binding: cloneBinding(binding),
      commitment: Object.freeze({
        commitmentSha256: evidence.commitmentSha256,
        durability: evidence.durability,
      }),
      retainedEvidence: evidence.retainedEvidence,
      status: 'active',
    }
    state.active = true
    verifiedTokenState.set(token, tokenState)
    return token
  } catch (error) {
    throw normalizeError(error)
  }
}

export function revalidateVerifiedPreparedMutationToken(token, options) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState) throw journalError('PREPARED_PROOF_INVALID', 'Verified token is not authentic')
  if (tokenState.proof.used) {
    throw journalError('PREPARED_PROOF_USED', 'Prepared proof was already consumed')
  }
  if (tokenState.status !== 'active' || !tokenState.proof.active) {
    throw journalError('PREPARED_PROOF_INVALID', 'Verified token is not active')
  }
  try {
    const binding = validateVerificationOptions(options)
    if (
      !sameBinding(binding, tokenState.binding) ||
      !sameBinding(binding, tokenState.proof.binding)
    ) {
      throw journalError('PREPARED_PROOF_INVALID', 'Verified token binding does not match')
    }
    requireLinuxDurability()
    revalidateRetainedEvidence(tokenState.retainedEvidence)
    return tokenState.commitment
  } catch (error) {
    throw normalizeError(error)
  }
}

export function releaseVerifiedPreparedMutationToken(token) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState || tokenState.status !== 'active') return
  tokenState.status = 'released'
  tokenState.proof.active = false
  const retainedEvidence = tokenState.retainedEvidence
  tokenState.retainedEvidence = null
  closeRetainedEvidence(retainedEvidence)
}

export function consumeVerifiedPreparedMutationToken(token) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState || tokenState.status !== 'active') return
  tokenState.status = 'consumed'
  tokenState.proof.used = true
  tokenState.proof.active = false
  const retainedEvidence = tokenState.retainedEvidence
  tokenState.retainedEvidence = null
  closeRetainedEvidence(retainedEvidence)
}

// Deliberately does not mint a proof. It exists only so both implementations can
// validate the shared immutable on-disk fixture in their test suites.
export function validatePreparedMutationEvidenceForTest(options) {
  try {
    const binding = validateVerificationOptions(options)
    requireLinuxDurability()
    const rootIdentity = validateOperationRoot(binding.operationRoot)
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    const evidence = validateCompleteOperation(paths, binding)
    revalidateDirectoryIdentity(rootIdentity)
    return Object.freeze({
      commitmentSha256: evidence.commitmentSha256,
      durability: evidence.durability,
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

function mintPreparedMutation(binding, paths, evidence, durability) {
  const proof = Object.freeze(Object.create(null))
  const state = {
    binding: cloneBinding(binding),
    paths: Object.freeze({ operation: paths.operation }),
    commitmentSha256: evidence.commitmentSha256,
    durability,
    used: false,
    active: false,
  }
  proofState.set(proof, state)
  return Object.freeze({
    proof,
    commitmentSha256: evidence.commitmentSha256,
    durability,
  })
}

function writePreparedArtifact(role, path, binding, writeArtifact) {
  let descriptor
  try {
    descriptor = openExclusiveFile(path)
    injectFault(`after-${role}-artifact-create`)
    const reservedIdentity = inspectOpenRegularFile(descriptor, path, 'reserved artifact')
    let callbackResult
    try {
      callbackResult = writeArtifact(
        Object.freeze({
          role,
          path,
          operationId: binding.intent.operationId,
          operation: binding.intent.operation,
          schemaContractIdentity: SHIKIN_SCHEMA_CONTRACT_IDENTITY,
        })
      )
    } catch (error) {
      if (
        process.env.NODE_ENV === 'test' &&
        error instanceof RecoveryJournalError &&
        error.code === 'RECOVERY_TEST_FAULT'
      ) {
        throw error
      }
      throw journalError('RECOVERY_VALIDATION_FAILED', `${role} artifact callback failed`, error)
    }
    injectFault(`after-${role}-artifact-callback`)
    let checks
    try {
      checks = validateArtifactChecks(callbackResult, `${role} artifact callback`)
    } catch (error) {
      if (error instanceof RecoveryJournalError) throw error
      throw journalError('RECOVERY_VALIDATION_FAILED', `${role} artifact checks are malformed`, error)
    }
    revalidateOpenRegularFile(descriptor, path, reservedIdentity, 'artifact')
    flushAndSealFile(descriptor, path, reservedIdentity, `${role} artifact`)
    injectFault(`after-${role}-artifact-fsync`)
    const artifact = hashOpenArtifact(descriptor, path, reservedIdentity, role)
    return { ...artifact, checks }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function writePreparedRecord(path, canonicalBytes) {
  let descriptor
  try {
    descriptor = openExclusiveFile(path)
    injectFault('after-record-create')
    const reservedIdentity = inspectOpenRegularFile(
      descriptor,
      path,
      'reserved record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    writeAll(descriptor, canonicalBytes)
    writeAll(descriptor, Buffer.from('\n'))
    injectFault('after-record-write')
    revalidateOpenRegularFile(
      descriptor,
      path,
      reservedIdentity,
      'record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    flushAndSealFile(
      descriptor,
      path,
      reservedIdentity,
      'prepared record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    injectFault('after-record-fsync')
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function validateCompleteOperation(paths, binding, retainEvidence = false) {
  requireLinuxDurability()
  let retainedEvidence
  try {
    retainedEvidence = {
      directories: [
        openRetainedDirectoryEvidence(paths.operationRoot, 'operation root', true),
        openRetainedDirectoryEvidence(paths.recoveryRoot, 'recovery root', true),
        openRetainedDirectoryEvidence(paths.operations, 'operations root', true),
        openRetainedDirectoryEvidence(paths.operation, 'operation directory', false),
        openRetainedDirectoryEvidence(paths.artifacts, 'artifacts directory', false),
        openRetainedDirectoryEvidence(paths.records, 'records directory', false),
      ],
      files: [],
      expectedLayouts: [],
    }
    assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY])
    assertExactDirectoryEntries(paths.operation, OPERATION_RECORD_ENTRIES)
    const recordEntries = safeDirectoryEntries(paths.records, 'records directory')
    if (recordEntries.length !== 1 || !RECORD_NAME.test(recordEntries[0])) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Records directory must contain exactly one prepared record'
      )
    }
    const recordName = recordEntries[0]
    const commitmentFromName = RECORD_NAME.exec(recordName)[1]
    const recordPath = join(paths.records, recordName)
    const recordEvidence = openRetainedFileEvidence(
      recordPath,
      'prepared record',
      'RECOVERY_JOURNAL_CORRUPTION',
      MAX_RECORD_BYTES,
      true
    )
    retainedEvidence.files.push(recordEvidence)
    const recordBytes = readRetainedFileEvidence(
      recordEvidence,
      MAX_RECORD_BYTES,
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    if (recordBytes.length < 2 || recordBytes[recordBytes.length - 1] !== 0x0a) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record must end in exactly one LF')
    }
    const canonicalBytes = recordBytes.subarray(0, -1)
    if (canonicalBytes[canonicalBytes.length - 1] === 0x0a || canonicalBytes.includes(0x0d)) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record has a noncanonical terminator')
    }
    const commitmentSha256 = recoveryRecordHash(canonicalBytes)
    if (commitmentSha256 !== commitmentFromName) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record filename hash does not match')
    }
    let record
    try {
      record = JSON.parse(canonicalBytes.toString('utf8'))
    } catch (error) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record is malformed JSON', error)
    }
    validatePreparedRecord(record, binding, paths)
    let recanonicalized
    try {
      recanonicalized = canonicalRecoveryJournalBytes(record)
    } catch (error) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record is not canonical JSON', error)
    }
    if (!canonicalBytes.equals(recanonicalized)) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record bytes are noncanonical')
    }

    const expectedArtifactNames = ROLES.map((role) => basename(record[role].path))
    assertExactDirectoryEntries(paths.artifacts, expectedArtifactNames, true)
    assertNoSqliteSidecars(paths.artifacts)
    for (const role of ROLES) {
      const artifactPath = join(paths.operation, ...record[role].path.split('/'))
      retainedEvidence.files.push(
        openRetainedFileEvidence(
          artifactPath,
          `${role} artifact`,
          'RECOVERY_ARTIFACT_CORRUPTION',
          MAX_ARTIFACT_BYTES,
          false,
          role,
          record[role].sizeBytes
        )
      )
    }
    const openedArtifacts = retainedEvidence.files.filter((evidence) => evidence.role !== undefined)
    for (let index = 0; index < openedArtifacts.length; index += 1) {
      const opened = openedArtifacts[index]
      const artifact = hashOpenArtifact(
        opened.descriptor,
        opened.path,
        opened.identity,
        opened.role,
        opened.expectedSizeBytes
      )
      if (
        artifact.contentDigest !== record[opened.role].contentDigest ||
        artifact.sizeBytes !== record[opened.role].sizeBytes
      ) {
        throw journalError(
          'RECOVERY_ARTIFACT_CORRUPTION',
          `${opened.role} artifact digest or size does not match`
        )
      }
      if (index === 0) runInterArtifactHashTestHook(openedArtifacts)
    }
    retainedEvidence.expectedLayouts = [
      Object.freeze({ path: paths.recoveryRoot, expected: [OPERATIONS_DIRECTORY], artifact: false }),
      Object.freeze({ path: paths.operation, expected: OPERATION_RECORD_ENTRIES, artifact: false }),
      Object.freeze({ path: paths.records, expected: [recordName], artifact: false }),
      Object.freeze({ path: paths.artifacts, expected: expectedArtifactNames, artifact: true }),
    ]
    revalidateRetainedEvidence(retainedEvidence)
    const result = {
      commitmentSha256,
      record,
      durability: 'linux-fsync-complete',
    }
    if (retainEvidence) {
      result.retainedEvidence = retainedEvidence
      retainedEvidence = null
    }
    return result
  } finally {
    closeRetainedEvidence(retainedEvidence)
  }
}

function validatePreparedRecord(record, binding, paths) {
  assertExactKeys(
    record,
    [
      'protocol',
      'protocolVersion',
      'recordKind',
      'sequence',
      'previousRecordSha256',
      'databaseIdentity',
      'operationId',
      'operation',
      'owner',
      'fencingGeneration',
      'createdAt',
      'nonce',
      'candidate',
      'rollback',
      'schemaContract',
      'checks',
    ],
    'prepared record',
    'RECOVERY_JOURNAL_CORRUPTION'
  )
  if (
    record.protocol !== PROTOCOL ||
    record.protocolVersion !== PROTOCOL_VERSION ||
    record.recordKind !== 'prepared_mutation' ||
    record.sequence !== 0 ||
    record.previousRecordSha256 !== null ||
    record.databaseIdentity !== DATABASE_IDENTITY ||
    record.operationId !== binding.intent.operationId ||
    record.operation !== binding.intent.operation ||
    record.fencingGeneration !== binding.intent.fencingGeneration ||
    record.createdAt !== binding.intent.createdAt ||
    !LOWER_HEX_64.test(record.nonce) ||
    !sameOwner(record.owner, binding.intent.owner)
  ) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record binding is malformed')
  }
  validateSchemaIdentity(record.schemaContract, 'RECOVERY_JOURNAL_CORRUPTION')
  assertExactKeys(
    record.checks,
    ROLES,
    'artifact check pair',
    'RECOVERY_JOURNAL_CORRUPTION'
  )
  for (const role of ROLES) {
    validateArtifactChecks(record.checks[role], `${role} recorded checks`, 'RECOVERY_JOURNAL_CORRUPTION')
    assertExactKeys(
      record[role],
      ['path', 'contentDigest', 'sizeBytes'],
      `${role} artifact record`,
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    const artifactKey = recoveryArtifactKey(paths.operationKey, record.nonce, role)
    const expectedPath = `artifacts/${role}-${artifactKey}.sqlite`
    if (
      record[role].path !== expectedPath ||
      typeof record[role].contentDigest !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(record[role].contentDigest) ||
      !isNonnegativeSafeInteger(record[role].sizeBytes) ||
      record[role].sizeBytes > MAX_ARTIFACT_BYTES
    ) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${role} artifact record is malformed`)
    }
  }
}

function validatePrepareOptions(options) {
  assertExactKeys(
    options,
    ['operationRoot', 'stateRevision', 'intent', 'writeArtifact'],
    'prepare options',
    'INVALID_RECOVERY_OPTIONS'
  )
  if (typeof options.writeArtifact !== 'function') {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'writeArtifact must be a function')
  }
  return validateBinding(options)
}

function validateVerificationOptions(options) {
  assertExactKeys(
    options,
    ['operationRoot', 'stateRevision', 'intent'],
    'verification options',
    'INVALID_RECOVERY_OPTIONS'
  )
  return validateBinding(options)
}

function validateBinding(options) {
  if (typeof options.operationRoot !== 'string' || options.operationRoot.length === 0) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must be a non-empty string')
  }
  if (comparablePath(options.operationRoot) !== comparablePath(resolve(options.operationRoot))) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must be an absolute canonical path')
  }
  const expectedRootBasename = createHash('sha256').update(DATABASE_IDENTITY, 'utf8').digest('hex')
  if (basename(options.operationRoot) !== expectedRootBasename) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot basename must equal the database identity SHA-256'
    )
  }
  if (!isNonnegativeSafeInteger(options.stateRevision)) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'stateRevision must be a non-negative safe integer')
  }
  const intent = options.intent
  assertExactKeys(
    intent,
    [
      'recordKind',
      'operationId',
      'operation',
      'phase',
      'owner',
      'fencingGeneration',
      'createdAt',
      'updatedAt',
    ],
    'exclusive intent',
    'INVALID_RECOVERY_OPTIONS',
    ['metadata']
  )
  if (
    intent.recordKind !== 'exclusive_intent' ||
    !isIdentifier(intent.operationId) ||
    !['restore', 'import'].includes(intent.operation) ||
    intent.phase !== 'exclusive' ||
    !isPositiveSafeInteger(intent.fencingGeneration) ||
    !isIsoTime(intent.createdAt) ||
    !isIsoTime(intent.updatedAt) ||
    (intent.metadata !== undefined && !isCanonicalPlainObject(intent.metadata))
  ) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'Intent must be an exclusive restore or import intent'
    )
  }
  validateOwner(intent.owner, 'INVALID_RECOVERY_OPTIONS')
  return Object.freeze({
    operationRoot: resolve(options.operationRoot),
    stateRevision: options.stateRevision,
    intent: cloneIntent(intent),
  })
}

function validateOwner(owner, code) {
  assertExactKeys(
    owner,
    ['ownerId', 'runtimeId', 'hostId', 'processId', 'processStartedAt'],
    'owner evidence',
    code
  )
  if (
    !isIdentifier(owner.ownerId) ||
    !RUNTIME_IDS.includes(owner.runtimeId) ||
    !isIdentifier(owner.hostId) ||
    !Number.isSafeInteger(owner.processId) ||
    owner.processId < 1 ||
    owner.processId > 0xffff_ffff ||
    !isIsoTime(owner.processStartedAt)
  ) {
    throw journalError(code, 'Owner evidence is malformed')
  }
}

function validateArtifactChecks(value, label, code = 'RECOVERY_VALIDATION_FAILED') {
  if (value && typeof value.then === 'function') {
    throw journalError(code, `${label} must return synchronously`)
  }
  assertExactKeys(value, CHECK_KEYS, label, code)
  if (CHECK_KEYS.some((key) => value[key] !== 'ok')) {
    throw journalError(code, `${label} did not return the exact four ok checks`)
  }
  return Object.freeze({
    integrityCheck: 'ok',
    foreignKeyCheck: 'ok',
    schemaContractCheck: 'ok',
    sidecarCheck: 'ok',
  })
}

function validateSchemaIdentity(value, code) {
  assertExactKeys(
    value,
    ['rawBytesSha256', 'contractVersion', 'latestMigration'],
    'schema contract identity',
    code
  )
  if (
    value.rawBytesSha256 !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.rawBytesSha256 ||
    value.contractVersion !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.contractVersion ||
    value.latestMigration !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.latestMigration
  ) {
    throw journalError(code, 'Schema contract identity does not match trusted bytes')
  }
}

function validateOperationRoot(operationRoot) {
  const resolved = resolve(operationRoot)
  let real
  try {
    real = realpathSync(resolved)
  } catch (error) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must already exist', error)
  }
  if (comparablePath(real) !== comparablePath(resolved)) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must be canonical and symlink-free')
  }
  const expectedBasename = createHash('sha256').update(DATABASE_IDENTITY, 'utf8').digest('hex')
  if (basename(resolved) !== expectedBasename) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot basename must equal the database identity SHA-256'
    )
  }
  try {
    return inspectPrivateDirectory(resolved, 'operationRoot', 'INVALID_RECOVERY_OPTIONS')
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot is unsafe', error)
  }
}

function journalPaths(operationRoot, operationId) {
  const operationKey = recoveryOperationKey(DATABASE_IDENTITY, operationId)
  const recoveryRoot = join(operationRoot, RECOVERY_DIRECTORY)
  const operations = join(recoveryRoot, OPERATIONS_DIRECTORY)
  const operation = join(operations, operationKey)
  return Object.freeze({
    operationRoot,
    recoveryRoot,
    operations,
    operationKey,
    operation,
    artifacts: join(operation, 'artifacts'),
    records: join(operation, 'records'),
  })
}

function ensureJournalParents(paths, rootIdentity) {
  const recoveryIdentity = ensurePrivateDirectory(
    paths.recoveryRoot,
    'after-recovery-root-create'
  )
  revalidateDirectoryIdentity(rootIdentity)
  assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY], false, true)
  const operationsIdentity = ensurePrivateDirectory(
    paths.operations,
    'after-operations-directory-create'
  )
  assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY])
  return [recoveryIdentity, operationsIdentity]
}

function ensurePrivateDirectory(path, faultPoint) {
  try {
    mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE })
    if (process.platform !== 'win32') chmodSync(path, PRIVATE_DIRECTORY_MODE)
    injectFault(faultPoint)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  return inspectPrivateDirectory(path, 'journal directory')
}

function createPrivateDirectory(path, faultPoint) {
  try {
    mkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE })
    if (process.platform !== 'win32') chmodSync(path, PRIVATE_DIRECTORY_MODE)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw journalError('RECOVERY_PREPARATION_INCOMPLETE', 'Operation path already exists')
    }
    throw error
  }
  injectFault(faultPoint)
  return inspectPrivateDirectory(path, 'journal directory')
}

function inspectPrivateDirectory(path, label, code = 'RECOVERY_JOURNAL_CORRUPTION') {
  let stat
  try {
    stat = lstatSync(path, { bigint: true })
  } catch (error) {
    throw journalError(code, `Could not inspect ${label}`, error)
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw journalError(code, `${label} is not a non-symlink directory`)
  }
  if (process.platform !== 'win32' && (Number(stat.mode) & 0o077) !== 0) {
    throw journalError(code, `${label} is not private`)
  }
  let real
  try {
    real = realpathSync(path)
  } catch (error) {
    throw journalError(code, `Could not canonicalize ${label}`, error)
  }
  if (comparablePath(real) !== comparablePath(resolve(path))) {
    throw journalError(code, `${label} is noncanonical or traverses a symlink`)
  }
  if (stat.ino <= 0n) {
    throw journalError(code, `${label} has no stable filesystem identity`)
  }
  return Object.freeze({ path, dev: stat.dev, ino: stat.ino })
}

function revalidateDirectoryIdentity(identity) {
  const current = inspectPrivateDirectory(identity.path, 'journal directory')
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Journal directory identity changed')
  }
}

function openRetainedDirectoryEvidence(path, label, mutable) {
  let descriptor
  try {
    const flags =
      fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY ?? 0) |
      (fsConstants.O_NOFOLLOW ?? 0)
    descriptor = openSync(path, flags)
    const openStat = fstatSync(descriptor, { bigint: true })
    const pathStat = lstatSync(path, { bigint: true })
    assertRetainedDirectoryStat(openStat, label)
    assertRetainedDirectoryStat(pathStat, label)
    if (pathStat.isSymbolicLink()) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${label} is a symlink`)
    }
    let real
    try {
      real = realpathSync(path)
    } catch (error) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `Could not canonicalize ${label}`, error)
    }
    if (comparablePath(real) !== comparablePath(resolve(path))) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        `${label} is noncanonical or traverses a symlink`
      )
    }
    const openSnapshot = retainedStatSnapshot(openStat, label)
    const pathSnapshot = retainedStatSnapshot(pathStat, label)
    if (
      openSnapshot.dev !== pathSnapshot.dev ||
      openSnapshot.ino !== pathSnapshot.ino ||
      (!mutable && !sameRetainedSnapshot(openSnapshot, pathSnapshot))
    ) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${label} path identity changed`)
    }
    const evidence = Object.freeze({
      descriptor,
      path,
      label,
      mutable,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
      identity: Object.freeze({ dev: openSnapshot.dev, ino: openSnapshot.ino }),
      snapshot: openSnapshot,
      kind: 'directory',
    })
    descriptor = undefined
    return evidence
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', `Could not retain ${label}`, error)
  } finally {
    if (descriptor !== undefined) closeDescriptorNoThrow(descriptor)
  }
}

function openRetainedFileEvidence(
  path,
  label,
  code,
  maximumBytes,
  requireNonempty,
  role,
  expectedSizeBytes
) {
  let descriptor
  try {
    const opened = openExistingFile(path, label, code)
    descriptor = opened.descriptor
    const openStat = fstatSync(descriptor, { bigint: true })
    const pathStat = lstatSync(path, { bigint: true })
    assertRetainedFileStat(openStat, label, code)
    assertRetainedFileStat(pathStat, label, code)
    const openSnapshot = retainedStatSnapshot(openStat, label)
    const pathSnapshot = retainedStatSnapshot(pathStat, label)
    if (!sameRetainedSnapshot(openSnapshot, pathSnapshot)) {
      throw journalError(code, `${label} path snapshot changed`)
    }
    if (
      openSnapshot.size > BigInt(maximumBytes) ||
      (requireNonempty && openSnapshot.size === 0n) ||
      (expectedSizeBytes !== undefined && openSnapshot.size !== BigInt(expectedSizeBytes))
    ) {
      throw journalError(code, `${label} has an invalid retained size`)
    }
    const evidence = Object.freeze({
      descriptor,
      path,
      label,
      code,
      identity: opened.identity,
      snapshot: openSnapshot,
      kind: 'file',
      ...(role === undefined ? {} : { role, expectedSizeBytes }),
    })
    descriptor = undefined
    return evidence
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error
    throw journalError(code, `Could not retain ${label}`, error)
  } finally {
    if (descriptor !== undefined) closeDescriptorNoThrow(descriptor)
  }
}

function retainedStatSnapshot(stat, label) {
  if (
    typeof stat.dev !== 'bigint' ||
    typeof stat.ino !== 'bigint' ||
    typeof stat.nlink !== 'bigint' ||
    typeof stat.mode !== 'bigint' ||
    typeof stat.size !== 'bigint' ||
    typeof stat.mtimeNs !== 'bigint' ||
    typeof stat.ctimeNs !== 'bigint' ||
    stat.ino <= 0n ||
    stat.nlink <= 0n
  ) {
    throw journalError(
      'RECOVERY_DURABILITY_FAILURE',
      `Stable nanosecond filesystem evidence is unavailable for ${label}`
    )
  }
  return Object.freeze({
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    mode: stat.mode & 0o777n,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  })
}

function assertRetainedDirectoryStat(stat, label) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${label} is not a retained directory`)
  }
  const snapshot = retainedStatSnapshot(stat, label)
  if ((snapshot.mode & 0o077n) !== 0n) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${label} is not private`)
  }
}

function assertRetainedFileStat(stat, label, code) {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw journalError(code, `${label} is not a retained regular file`)
  }
  const snapshot = retainedStatSnapshot(stat, label)
  if (snapshot.nlink !== 1n || snapshot.mode !== BigInt(PRIVATE_READ_ONLY_FILE_MODE)) {
    throw journalError(code, `${label} is linked or is not sealed read-only`)
  }
}

function sameRetainedSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function revalidateRetainedEvidence(evidence) {
  if (!evidence) {
    throw journalError('PREPARED_PROOF_INVALID', 'Verified token has no retained evidence')
  }
  const reopened = []
  try {
    for (const retained of evidence.directories) {
      const current = openRetainedDirectoryEvidence(
        retained.path,
        retained.label,
        retained.mutable
      )
      reopened.push(current)
      if (
        current.identity.dev !== retained.identity.dev ||
        current.identity.ino !== retained.identity.ino ||
        (!retained.mutable && !sameRetainedSnapshot(current.snapshot, retained.snapshot))
      ) {
        throw journalError(retained.code, `${retained.label} retained evidence changed`)
      }
    }
    for (const retained of evidence.files) {
      const current = openRetainedFileEvidence(
        retained.path,
        retained.label,
        retained.code,
        retained.snapshot.size,
        retained.snapshot.size > 0n,
        retained.role,
        retained.expectedSizeBytes
      )
      reopened.push(current)
      if (!sameRetainedSnapshot(current.snapshot, retained.snapshot)) {
        throw journalError(retained.code, `${retained.label} retained evidence changed`)
      }
    }
    for (const layout of evidence.expectedLayouts) {
      assertBoundedExactDirectoryEntries(layout.path, layout.expected, layout.artifact)
    }
    for (const retained of [...evidence.directories, ...evidence.files]) {
      const current = fstatSync(retained.descriptor, { bigint: true })
      if (retained.kind === 'directory') {
        assertRetainedDirectoryStat(current, retained.label)
        const snapshot = retainedStatSnapshot(current, retained.label)
        if (
          snapshot.dev !== retained.identity.dev ||
          snapshot.ino !== retained.identity.ino ||
          (!retained.mutable && !sameRetainedSnapshot(snapshot, retained.snapshot))
        ) {
          throw journalError(retained.code, `${retained.label} retained handle changed`)
        }
      } else {
        assertRetainedFileStat(current, retained.label, retained.code)
        if (!sameRetainedSnapshot(retainedStatSnapshot(current, retained.label), retained.snapshot)) {
          throw journalError(retained.code, `${retained.label} retained handle changed`)
        }
      }
    }
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'Could not revalidate retained evidence', error)
  } finally {
    closeRetainedEvidence({ directories: reopened, files: [] })
  }
}

function assertBoundedExactDirectoryEntries(path, expected, artifactDirectory) {
  const directory = opendirSync(path)
  const actual = []
  try {
    for (let index = 0; index <= expected.length; index += 1) {
      const entry = directory.readSync()
      if (entry === null) break
      actual.push(entry.name)
    }
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'Could not enumerate retained layout', error)
  } finally {
    try {
      directory.closeSync()
    } catch {
      // Evidence release is deliberately no-throw.
    }
  }
  const sortedActual = actual.sort()
  const sortedExpected = [...expected].sort()
  if (
    sortedActual.length !== sortedExpected.length ||
    sortedActual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    const sidecar = artifactDirectory
      ? sortedActual.find((entry) => /\.sqlite-(?:wal|shm|journal)$/.test(entry))
      : undefined
    throw journalError(
      artifactDirectory ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION',
      sidecar ? `SQLite sidecar ${sidecar} is forbidden` : 'Retained journal layout changed'
    )
  }
}

function readRetainedFileEvidence(evidence, maximumBytes, code) {
  const size = evidence.snapshot.size
  if (size <= 0n || size > BigInt(maximumBytes)) {
    throw journalError(code, `${evidence.label} has an invalid size`)
  }
  const bytes = Buffer.alloc(Number(size))
  let position = 0
  while (position < bytes.length) {
    const count = readSync(
      evidence.descriptor,
      bytes,
      position,
      bytes.length - position,
      position
    )
    if (count <= 0) throw journalError(code, `${evidence.label} changed while reading`)
    position += count
  }
  const current = fstatSync(evidence.descriptor, { bigint: true })
  assertRetainedFileStat(current, evidence.label, code)
  if (!sameRetainedSnapshot(retainedStatSnapshot(current, evidence.label), evidence.snapshot)) {
    throw journalError(code, `${evidence.label} changed while reading`)
  }
  return bytes
}

function closeRetainedEvidence(evidence) {
  if (!evidence) return
  for (const item of [...(evidence.files ?? []), ...(evidence.directories ?? [])]) {
    closeDescriptorNoThrow(item.descriptor)
  }
}

function closeDescriptorNoThrow(descriptor) {
  try {
    closeSync(descriptor)
  } catch {
    // Release and consume mark lifecycle state before best-effort descriptor closure.
  }
}

function openExclusiveFile(path) {
  const flags =
    fsConstants.O_CREAT |
    fsConstants.O_EXCL |
    fsConstants.O_RDWR |
    (fsConstants.O_NOFOLLOW ?? 0)
  try {
    const descriptor = openSync(path, flags, PRIVATE_WRITABLE_FILE_MODE)
    if (process.platform !== 'win32') fchmodSync(descriptor, PRIVATE_WRITABLE_FILE_MODE)
    return descriptor
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Final journal path already exists')
    }
    throw error
  }
}

function openExistingFile(path, label, corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION') {
  const flags = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)
  let descriptor
  try {
    descriptor = openSync(path, flags)
    const identity = inspectOpenRegularFile(descriptor, path, label, corruptionCode, true)
    return { descriptor, identity }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor)
    if (error instanceof RecoveryJournalError) throw error
    throw journalError(corruptionCode, `Could not open ${label}`, error)
  }
}

function inspectOpenRegularFile(
  descriptor,
  path,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION',
  sealed = false
) {
  let openStat
  let pathStat
  try {
    openStat = fstatSync(descriptor, { bigint: true })
    pathStat = lstatSync(path, { bigint: true })
  } catch (error) {
    throw journalError(corruptionCode, `Could not inspect ${label}`, error)
  }
  if (
    !openStat.isFile() ||
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    openStat.nlink !== 1n ||
    pathStat.nlink !== 1n ||
    openStat.ino <= 0n ||
    openStat.dev !== pathStat.dev ||
    openStat.ino !== pathStat.ino
  ) {
    throw journalError(
      corruptionCode,
      `${label} is replaced, linked, or not a stable regular file`
    )
  }
  if (process.platform !== 'win32') {
    const mode = Number(pathStat.mode) & 0o777
    if (sealed ? mode !== PRIVATE_READ_ONLY_FILE_MODE : (mode & 0o077) !== 0) {
      throw journalError(
        corruptionCode,
        sealed ? `${label} is not sealed read-only` : `${label} is not private`
      )
    }
  }
  return Object.freeze({ dev: openStat.dev, ino: openStat.ino })
}

function revalidateOpenRegularFile(
  descriptor,
  path,
  identity,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION',
  sealed = false
) {
  const current = inspectOpenRegularFile(descriptor, path, label, corruptionCode, sealed)
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw journalError(corruptionCode, `${label} identity changed`)
  }
}

function flushAndSealFile(
  descriptor,
  path,
  identity,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION'
) {
  try {
    fsyncSync(descriptor)
    fchmodSync(descriptor, PRIVATE_READ_ONLY_FILE_MODE)
    fsyncSync(descriptor)
  } catch (error) {
    throw journalError('RECOVERY_DURABILITY_FAILURE', `Could not flush and seal ${label}`, error)
  }
  revalidateOpenRegularFile(descriptor, path, identity, label, corruptionCode, true)
}

function hashOpenArtifact(descriptor, path, identity, role, expectedSizeBytes) {
  let stat
  try {
    stat = fstatSync(descriptor, { bigint: true })
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not stat ${role} artifact`, error)
  }
  if (
    stat.size > BigInt(MAX_ARTIFACT_BYTES) ||
    (expectedSizeBytes !== undefined && stat.size !== BigInt(expectedSizeBytes))
  ) {
    throw journalError(
      'RECOVERY_ARTIFACT_CORRUPTION',
      `${role} artifact opened size is unexpected or exceeds the 8 GiB limit`
    )
  }
  const hasher = createRecoveryArtifactHasher(role)
  const chunk = Buffer.allocUnsafe(HASH_CHUNK_SIZE)
  let position = 0
  while (position < Number(stat.size)) {
    const length = Math.min(chunk.length, Number(stat.size) - position)
    let count
    try {
      count = readSync(descriptor, chunk, 0, length, position)
    } catch (error) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not hash ${role} artifact`, error)
    }
    if (count <= 0) {
      throw journalError('RECOVERY_ARTIFACT_CORRUPTION', `${role} artifact changed while hashing`)
    }
    hasher.update(chunk.subarray(0, count))
    position += count
  }
  revalidateOpenRegularFile(
    descriptor,
    path,
    identity,
    `${role} artifact`,
    'RECOVERY_ARTIFACT_CORRUPTION',
    true
  )
  const finalStat = fstatSync(descriptor, { bigint: true })
  if (finalStat.size !== stat.size) {
    throw journalError('RECOVERY_ARTIFACT_CORRUPTION', `${role} artifact size changed while hashing`)
  }
  return {
    contentDigest: `sha256:${hasher.digest('hex')}`,
    sizeBytes: Number(stat.size),
  }
}

function openArtifactEvidence(path, role, expectedSizeBytes) {
  const { descriptor, identity } = openExistingFile(path, `${role} artifact`)
  try {
    const snapshot = linuxFileSnapshot(descriptor, `${role} artifact`)
    if (
      snapshot.size > BigInt(MAX_ARTIFACT_BYTES) ||
      snapshot.size !== BigInt(expectedSizeBytes)
    ) {
      throw journalError(
        'RECOVERY_ARTIFACT_CORRUPTION',
        `${role} artifact opened size is unexpected or exceeds the 8 GiB limit`
      )
    }
    return Object.freeze({ descriptor, identity, path, role, expectedSizeBytes, snapshot })
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function linuxFileSnapshot(descriptor, label) {
  let stat
  try {
    stat = fstatSync(descriptor, { bigint: true })
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not snapshot ${label}`, error)
  }
  if (
    typeof stat.mtimeNs !== 'bigint' ||
    typeof stat.ctimeNs !== 'bigint' ||
    typeof stat.size !== 'bigint'
  ) {
    throw journalError('RECOVERY_DURABILITY_FAILURE', `Linux stat evidence is unavailable for ${label}`)
  }
  return Object.freeze({ size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs })
}

function revalidateArtifactEvidence(opened) {
  revalidateOpenRegularFile(
    opened.descriptor,
    opened.path,
    opened.identity,
    `${opened.role} artifact`,
    'RECOVERY_ARTIFACT_CORRUPTION',
    true
  )
  const current = linuxFileSnapshot(opened.descriptor, `${opened.role} artifact`)
  if (
    current.size !== opened.snapshot.size ||
    current.mtimeNs !== opened.snapshot.mtimeNs ||
    current.ctimeNs !== opened.snapshot.ctimeNs
  ) {
    throw journalError(
      'RECOVERY_ARTIFACT_CORRUPTION',
      `${opened.role} artifact changed during complete evidence verification`
    )
  }
}

function readSecureFile(
  path,
  label,
  maximumBytes,
  corruptionCode = 'RECOVERY_JOURNAL_CORRUPTION'
) {
  const { descriptor, identity } = openExistingFile(path, label, corruptionCode)
  try {
    const stat = fstatSync(descriptor, { bigint: true })
    if (stat.size <= 0n || stat.size > BigInt(maximumBytes)) {
      throw journalError(corruptionCode, `${label} has an invalid size`)
    }
    const bytes = Buffer.alloc(Number(stat.size))
    let position = 0
    while (position < bytes.length) {
      const count = readSync(descriptor, bytes, position, bytes.length - position, position)
      if (count <= 0) {
        throw journalError(corruptionCode, `${label} changed while reading`)
      }
      position += count
    }
    revalidateOpenRegularFile(descriptor, path, identity, label, corruptionCode, true)
    if (fstatSync(descriptor, { bigint: true }).size !== stat.size) {
      throw journalError(corruptionCode, `${label} size changed while reading`)
    }
    return bytes
  } finally {
    closeSync(descriptor)
  }
}

function runInterArtifactHashTestHook(openedArtifacts) {
  if (interArtifactHashTestHook === undefined) return
  if (process.env.NODE_ENV !== 'test') {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Recovery test hook is test-only')
  }
  interArtifactHashTestHook(
    Object.freeze(openedArtifacts.map(({ role, path }) => Object.freeze({ role, path })))
  )
}

function finishDurability(paths) {
  requireLinuxDurability()
  for (const [path, faultPoint] of [
    [paths.artifacts, 'after-artifacts-directory-fsync'],
    [paths.records, 'after-records-directory-fsync'],
    [paths.operation, 'after-operation-directory-fsync'],
    [paths.operations, 'after-operations-directory-fsync'],
    [paths.recoveryRoot, 'after-recovery-root-fsync'],
    [paths.operationRoot, 'after-operation-root-fsync'],
  ]) {
    syncDirectory(path)
    injectFault(faultPoint)
  }
  return 'linux-fsync-complete'
}

function syncDirectory(path) {
  let descriptor
  try {
    const flags =
      fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY ?? 0) |
      (fsConstants.O_NOFOLLOW ?? 0)
    descriptor = openSync(path, flags)
    const stat = fstatSync(descriptor, { bigint: true })
    if (!stat.isDirectory()) {
      throw journalError('RECOVERY_DURABILITY_FAILURE', 'Directory sync target is not a directory')
    }
    fsyncSync(descriptor)
  } catch (error) {
    if (error instanceof RecoveryJournalError) throw error
    throw journalError('RECOVERY_DURABILITY_FAILURE', `Could not fsync directory ${path}`, error)
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function assertExactDirectoryEntries(
  path,
  expected,
  artifactDirectory = false,
  allowMissingExpected = false
) {
  const actual = safeDirectoryEntries(path, 'journal directory').sort()
  const sortedExpected = [...expected].sort()
  if (allowMissingExpected && actual.length === 0) return
  if (
    actual.length !== sortedExpected.length ||
    actual.some((entry, index) => entry !== sortedExpected[index])
  ) {
    throw journalError(
      artifactDirectory ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION',
      'Journal directory contains missing or unexpected entries'
    )
  }
}

function assertNoSqliteSidecars(path) {
  const sidecar = safeDirectoryEntries(path, 'artifacts directory').find((entry) =>
    /\.sqlite-(?:wal|shm|journal)$/.test(entry)
  )
  if (sidecar) {
    throw journalError('RECOVERY_ARTIFACT_CORRUPTION', `SQLite sidecar ${sidecar} is forbidden`)
  }
}

function safeDirectoryEntries(path, label) {
  try {
    return readdirSync(path)
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not read ${label}`, error)
  }
}

function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset)
    if (written <= 0) throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'Short journal write')
    offset += written
  }
}

function injectFault(point) {
  const configured = process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
  if (process.env.NODE_ENV !== 'test' || configured === undefined || configured === '') return
  if (!FAULT_POINTS.has(configured)) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Unknown recovery journal test fault point')
  }
  if (configured === point) {
    throw journalError('RECOVERY_TEST_FAULT', `Injected recovery journal fault after ${point}`)
  }
}

function assertExactKeys(value, required, label, code, optional = []) {
  if (!isPlainObject(value)) throw journalError(code, `${label} must be a plain object`)
  const allowed = new Set([...required, ...optional])
  const actual = Object.keys(value)
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    actual.some((key) => !allowed.has(key)) ||
    actual.length < required.length
  ) {
    throw journalError(code, `${label} has unknown or missing fields`)
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isCanonicalPlainObject(value) {
  if (!isPlainObject(value)) return false
  try {
    canonicalRecoveryJournalBytes(value)
    return true
  } catch {
    return false
  }
}

function isIdentifier(value) {
  if (typeof value !== 'string') return false
  try {
    canonicalRecoveryJournalBytes(value)
  } catch {
    return false
  }
  const codePoints = [...value].length
  return codePoints >= 1 && codePoints <= 128
}

function isIsoTime(value) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return false
  const timestamp = new Date(value)
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString() === value
}

function isNonnegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1
}

function cloneOwner(owner) {
  return {
    ownerId: owner.ownerId,
    runtimeId: owner.runtimeId,
    hostId: owner.hostId,
    processId: owner.processId,
    processStartedAt: owner.processStartedAt,
  }
}

function cloneIntent(intent) {
  const clone = {
    recordKind: intent.recordKind,
    operationId: intent.operationId,
    operation: intent.operation,
    phase: intent.phase,
    owner: cloneOwner(intent.owner),
    fencingGeneration: intent.fencingGeneration,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  }
  if (intent.metadata !== undefined) clone.metadata = structuredClone(intent.metadata)
  return Object.freeze(clone)
}

function cloneBinding(binding) {
  return Object.freeze({
    operationRoot: binding.operationRoot,
    stateRevision: binding.stateRevision,
    intent: cloneIntent(binding.intent),
  })
}

function schemaContractIdentity() {
  return {
    rawBytesSha256: SHIKIN_SCHEMA_CONTRACT_IDENTITY.rawBytesSha256,
    contractVersion: SHIKIN_SCHEMA_CONTRACT_IDENTITY.contractVersion,
    latestMigration: SHIKIN_SCHEMA_CONTRACT_IDENTITY.latestMigration,
  }
}

function sameBinding(left, right) {
  return (
    left.operationRoot === right.operationRoot &&
    left.stateRevision === right.stateRevision &&
    left.intent.recordKind === right.intent.recordKind &&
    left.intent.operationId === right.intent.operationId &&
    left.intent.operation === right.intent.operation &&
    left.intent.phase === right.intent.phase &&
    left.intent.fencingGeneration === right.intent.fencingGeneration &&
    left.intent.createdAt === right.intent.createdAt &&
    left.intent.updatedAt === right.intent.updatedAt &&
    sameOptionalMetadata(left.intent.metadata, right.intent.metadata) &&
    sameOwner(left.intent.owner, right.intent.owner)
  )
}

function sameOptionalMetadata(left, right) {
  if (left === undefined || right === undefined) return left === right
  return canonicalRecoveryJournalBytes(left).equals(canonicalRecoveryJournalBytes(right))
}

function sameOwner(left, right) {
  return (
    isPlainObject(left) &&
    left.ownerId === right.ownerId &&
    left.runtimeId === right.runtimeId &&
    left.hostId === right.hostId &&
    left.processId === right.processId &&
    left.processStartedAt === right.processStartedAt &&
    Object.keys(left).length === 5
  )
}

function comparablePath(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function requireLinuxDurability() {
  if (process.platform !== 'linux') {
    throw journalError(
      'RECOVERY_DURABILITY_FAILURE',
      'Recovery journal proof issuance and verification require Linux fsync semantics'
    )
  }
}

function revalidateDirectoryIdentities(identities) {
  for (const identity of identities.values()) revalidateDirectoryIdentity(identity)
}

function journalError(code, message, cause) {
  return new RecoveryJournalError(code, message, cause)
}

function normalizeError(error) {
  if (error instanceof RecoveryJournalError) return error
  return journalError('RECOVERY_FILESYSTEM_FAILURE', error?.message ?? String(error), error)
}
