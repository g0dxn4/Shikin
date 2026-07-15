import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  RecoveryJournalError,
  consumeVerifiedPreparedMutationToken,
  releaseVerifiedPreparedMutationToken,
  revalidateVerifiedPreparedMutationToken,
  verifyPreparedMutationProof,
} from './database-operation-recovery-journal.mjs'

// Capture the serialization and reflection primordials before caller-controlled
// metadata can mutate their ambient bindings or prototypes.
const PrimordialArray = Array
const PrimordialTypeError = TypeError
const ArrayIsArray = Array.isArray
const JsonParse = JSON.parse
const JsonStringify = JSON.stringify
const ObjectCreate = Object.create
const ObjectDefineProperty = Object.defineProperty
const ObjectFreeze = Object.freeze
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const ObjectGetPrototypeOf = Object.getPrototypeOf
const ObjectHasOwn = Object.hasOwn
const ObjectIs = Object.is
const ObjectKeys = Object.keys
const ObjectPrototype = Object.prototype

export const DATABASE_OPERATION_PROTOCOL = 'shikin.database-operation-lock'
export const DATABASE_OPERATION_PROTOCOL_VERSION = 1
export const SHIKIN_DATABASE_IDENTITY = 'com.asf.shikin:shikin.db'
export const DATABASE_OPERATION_RUNTIME_IDS = ObjectFreeze([
  'cli',
  'mcp',
  'browser-data-server',
  'tauri',
])
export const DEFAULT_DATABASE_OPERATION_TIMING = ObjectFreeze({
  mutexTtlMs: 5_000,
  leaseTtlMs: 30_000,
  heartbeatIntervalMs: 5_000,
})

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const RECOVERY_JOURNAL_PROTOCOL = 'shikin.database-operation-recovery-journal'
const RECOVERY_JOURNAL_VERSION = 1
const RECOVERY_JOURNAL_DURABILITY = 'linux-fsync-complete'
const MUTEX_MIN_TTL_MS = 1_000
const MUTEX_MAX_TTL_MS = 15_000
const LEASE_MIN_TTL_MS = 5_000
const LEASE_MAX_TTL_MS = 300_000
const HEARTBEAT_MIN_MS = 1_000
const DEFAULT_ACQUIRE_TIMEOUT_MS = 15_000
const DEFAULT_MAX_STATE_RECORDS = 8
const UUID_PATTERN_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const STATE_FILE_PATTERN = new RegExp(`^operation-state-(\\d{20})-(${UUID_PATTERN_SOURCE})\\.json$`)
const TOKEN_DIRECTORY_PATTERN = new RegExp(`^token-(${UUID_PATTERN_SOURCE})$`)
const STAGED_STATE_PATTERN = new RegExp(`^staged-state-(${UUID_PATTERN_SOURCE})\\.json$`)
const STAGED_MUTEX_PATTERN = new RegExp(`^staged-mutex-(${UUID_PATTERN_SOURCE})\\.json$`)
const READ_RETRY_LIMIT = 16
const sleepArray = new Int32Array(new SharedArrayBuffer(4))
let linuxClockTicksPerSecond

export class DatabaseOperationLockError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DatabaseOperationLockError'
    this.code = code
  }
}

/**
 * Path-parameterized, synchronous coordination core. Construction is inert with
 * respect to the filesystem; only explicit methods initialize the supplied
 * private root.
 */
export class DatabaseOperationLock {
  constructor(options) {
    if (!isPlainRecord(options)) throw protocolError('INVALID_OPTIONS', 'Lock options are required')
    assertBoundedString(options.rootDir, 'rootDir', 1, 4096)
    if (options.databaseIdentity !== SHIKIN_DATABASE_IDENTITY) {
      throw protocolError(
        'INVALID_DATABASE_IDENTITY',
        `databaseIdentity must be ${SHIKIN_DATABASE_IDENTITY}`
      )
    }
    if (!DATABASE_OPERATION_RUNTIME_IDS.includes(options.runtimeId)) {
      throw protocolError('INVALID_RUNTIME', `Unsupported runtime ID ${String(options.runtimeId)}`)
    }

    this.rootDir = resolve(options.rootDir)
    this.databaseIdentity = options.databaseIdentity
    this.runtimeId = options.runtimeId
    this.ownerId = randomUUID()
    this.mutexTtlMs = options.mutexTtlMs ?? DEFAULT_DATABASE_OPERATION_TIMING.mutexTtlMs
    this.leaseTtlMs = options.leaseTtlMs ?? DEFAULT_DATABASE_OPERATION_TIMING.leaseTtlMs
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_DATABASE_OPERATION_TIMING.heartbeatIntervalMs
    this.acquireTimeoutMs = options.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS
    this.maxStateRecords = options.maxStateRecords ?? DEFAULT_MAX_STATE_RECORDS
    this.clock = options.clock ?? Date.now
    this.testHooks = options.testHooks ?? null
    this.owner = null
    this.currentLease = null
    this.heartbeatTimer = null
    this.fenced = false
    this.lastFailure = null
    this.maintenanceFailures = []
    this.lastCommittedStateRevision = null
    this.durabilityUncertain = false

    validateTiming(this)
    if (!Number.isSafeInteger(this.acquireTimeoutMs) || this.acquireTimeoutMs < 0) {
      throw protocolError('INVALID_TIMING', 'acquireTimeoutMs must be a non-negative integer')
    }
    if (!Number.isSafeInteger(this.maxStateRecords) || this.maxStateRecords < 2) {
      throw protocolError('INVALID_OPTIONS', 'maxStateRecords must be an integer of at least 2')
    }
    if (typeof this.clock !== 'function')
      throw protocolError('INVALID_OPTIONS', 'clock must be a function')
    const allowedHooks = [
      'beforePublish',
      'afterPrune',
      'afterRename',
      'afterFsync',
      'afterRelease',
      'afterStateDirectoryRead',
      'afterMutexRootStat',
      'beforeMutexPublication',
      'afterMutexPublication',
      'afterMutexQuarantine',
      'beforeMutexRestore',
      'directorySync',
    ]
    if (
      this.testHooks !== null &&
      (!isPlainRecord(this.testHooks) ||
        ObjectKeys(this.testHooks).some(
          (key) => !allowedHooks.includes(key) || typeof this.testHooks[key] !== 'function'
        ))
    ) {
      throw protocolError('INVALID_OPTIONS', 'testHooks is malformed')
    }

    const identityHash = createHash('sha256').update(SHIKIN_DATABASE_IDENTITY).digest('hex')
    this.paths = ObjectFreeze({
      root: this.rootDir,
      hostIdentity: join(this.rootDir, 'machine-host-identity.json'),
      protocolRoot: join(this.rootDir, 'database-operation-lock-v1'),
      operationRoot: join(this.rootDir, 'database-operation-lock-v1', identityHash),
      stateRecords: join(this.rootDir, 'database-operation-lock-v1', identityHash, 'state-records'),
      registrationMutex: join(
        this.rootDir,
        'database-operation-lock-v1',
        identityHash,
        'registration-mutex'
      ),
    })
  }

  getPaths() {
    return this.paths
  }

  getOwnerEvidence() {
    return cloneJson(this.#ensureOwner())
  }

  readOperationState() {
    this.#ensureOwner()
    return cloneJson(this.#readAuthoritativeState())
  }

  registerRuntimeLease() {
    this.#requireOperationalOwner()
    const leaseId = randomUUID()
    const lease = this.#mutateState((previous, now) => {
      if (previous.exclusiveIntent !== null) {
        throw protocolError(
          'EXCLUSIVE_INTENT_ACTIVE',
          'A database operation intent blocks registration'
        )
      }
      if (previous.leases.some((item) => item.owner.ownerId === this.owner.ownerId)) {
        throw protocolError('OWNER_ALREADY_REGISTERED', 'This owner already has a runtime lease')
      }
      const fencingGeneration = previous.fencingGenerationHighWater + 1
      const timestamp = isoTime(now)
      const nextLease = {
        recordKind: 'runtime_lease',
        leaseId,
        owner: cloneJson(this.owner),
        fencingGeneration,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        expiresAt: isoTime(now + this.leaseTtlMs),
        ttlMs: this.leaseTtlMs,
      }
      return {
        state: {
          ...previous,
          fencingGenerationHighWater: fencingGeneration,
          leases: [...previous.leases, nextLease],
        },
        value: nextLease,
      }
    })
    this.currentLease = cloneJson(lease)
    return cloneJson(lease)
  }

  renewRuntimeLease(lease = this.currentLease) {
    this.#requireOperationalOwner()
    const evidence = validateLease(cloneJson(lease), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'LEASE_FENCED')
    const renewed = this.#mutateState((previous, now) => {
      const index = previous.leases.findIndex((item) => item.leaseId === evidence.leaseId)
      if (index === -1 || !sameLeaseAuthority(previous.leases[index], evidence)) {
        throw protocolError(
          'LEASE_FENCED',
          'Runtime lease ownership or fencing evidence no longer matches'
        )
      }
      if (isExpired(previous.leases[index].expiresAt, now)) {
        throw protocolError('LEASE_EXPIRED', 'An expired runtime lease cannot renew')
      }
      const nextLease = {
        ...previous.leases[index],
        heartbeatAt: isoTime(now),
        expiresAt: isoTime(now + previous.leases[index].ttlMs),
      }
      const leases = [...previous.leases]
      leases[index] = nextLease
      return { state: { ...previous, leases }, value: nextLease }
    })
    if (this.currentLease && sameLeaseAuthority(this.currentLease, evidence)) {
      this.currentLease = cloneJson(renewed)
    }
    return cloneJson(renewed)
  }

  releaseRuntimeLease(lease = this.currentLease) {
    this.#requireOperationalOwner()
    const evidence = validateLease(cloneJson(lease), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'LEASE_FENCED')
    const released = this.#mutateState((previous) => {
      const index = previous.leases.findIndex((item) => item.leaseId === evidence.leaseId)
      if (index === -1 || !sameLeaseAuthority(previous.leases[index], evidence)) {
        throw protocolError(
          'LEASE_FENCED',
          'Runtime lease ownership or fencing evidence no longer matches'
        )
      }
      const leases = [...previous.leases]
      leases.splice(index, 1)
      return { state: { ...previous, leases }, value: true }
    })
    if (released && this.currentLease && sameLeaseAuthority(this.currentLease, evidence)) {
      this.stopHeartbeat()
      this.currentLease = null
    }
    return released
  }

  cleanupStaleRecords() {
    this.#requireOperationalOwner()
    return this.#mutateState((previous, now) => {
      const removedLeaseIds = []
      const leases = previous.leases.filter((lease) => {
        if (!isExpired(lease.expiresAt, now)) return true
        if (!this.#isOwnerDemonstrablyDead(lease.owner)) return true
        removedLeaseIds.push(lease.leaseId)
        return false
      })
      let exclusiveIntent = previous.exclusiveIntent
      let fencingGenerationHighWater = previous.fencingGenerationHighWater
      let abandonedIntent = false
      if (
        exclusiveIntent !== null &&
        exclusiveIntent.phase !== 'mutating' &&
        leases.length === 0 &&
        this.#isOwnerDemonstrablyDead(exclusiveIntent.owner)
      ) {
        fencingGenerationHighWater += 1
        exclusiveIntent = null
        abandonedIntent = true
      }
      if (removedLeaseIds.length === 0 && !abandonedIntent) {
        return {
          changed: false,
          value: { removedLeaseIds, abandonedIntent, stateRevision: previous.stateRevision },
        }
      }
      return {
        state: { ...previous, leases, exclusiveIntent, fencingGenerationHighWater },
        value: {
          removedLeaseIds,
          abandonedIntent,
          stateRevision: previous.stateRevision + 1,
        },
      }
    })
  }

  acquireExclusiveIntent(operation, metadata) {
    this.#requireOperationalOwner()
    if (operation !== 'restore' && operation !== 'import') {
      throw protocolError(
        'INVALID_OPERATION',
        `Unsupported database operation ${String(operation)}`
      )
    }
    const metadataSnapshot = snapshotCallerIntentMetadata(metadata)

    const operationId = randomUUID()
    return cloneJson(
      this.#mutateState((previous, now) => {
        if (previous.exclusiveIntent !== null) {
          throw protocolError(
            'EXCLUSIVE_INTENT_ACTIVE',
            'An exclusive database intent already exists'
          )
        }
        if (this.currentLease === null) {
          throw protocolError('LEASE_REQUIRED', 'Exclusive intent requires one active owner lease')
        }
        const persistedByOwnerId = previous.leases.filter(
          (lease) => lease.owner.ownerId === this.owner.ownerId
        )
        const ownLeases = previous.leases.filter((lease) => sameOwner(lease.owner, this.owner))
        if (ownLeases.length !== 1 || persistedByOwnerId.length !== 1) {
          throw protocolError(
            'LEASE_FENCED',
            'Exclusive intent requires exactly one lease with complete current owner authority'
          )
        }
        const ownLease = ownLeases[0]
        if (!sameLeaseAuthority(ownLease, this.currentLease)) {
          throw protocolError(
            'LEASE_FENCED',
            'Current lease evidence does not match persisted state'
          )
        }
        if (isExpired(ownLease.expiresAt, now)) {
          throw protocolError(
            'LEASE_EXPIRED',
            'An expired owner cannot publish an exclusive database intent'
          )
        }
        const fencingGeneration = previous.fencingGenerationHighWater + 1
        const timestamp = isoTime(now)
        const intent = {
          recordKind: 'exclusive_intent',
          operationId,
          operation,
          phase: 'registered',
          owner: cloneJson(this.owner),
          fencingGeneration,
          createdAt: timestamp,
          updatedAt: timestamp,
          ...(metadataSnapshot === undefined
            ? {}
            : { metadata: cloneJson(metadataSnapshot) }),
        }
        return {
          state: {
            ...previous,
            fencingGenerationHighWater: fencingGeneration,
            exclusiveIntent: intent,
          },
          value: intent,
        }
      })
    )
  }

  drainExclusiveIntent(intent) {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    return cloneJson(
      this.#mutateState((previous, now) => {
        const current = requireIntentAuthority(previous, evidence, ['registered', 'draining'])
        const phase =
          current.phase === 'registered'
            ? 'draining'
            : previous.leases.length === 0
              ? 'exclusive'
              : 'draining'
        if (current.phase === phase) return { changed: false, value: current }
        const next = { ...current, phase, updatedAt: isoTime(now) }
        return { state: { ...previous, exclusiveIntent: next }, value: next }
      })
    )
  }

  beginExclusiveMutation(intent, proof) {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    const advisoryBinding = requireMutationEntryBinding(
      this.#readAuthoritativeState(),
      evidence,
      this.paths.operationRoot
    )
    let token
    let authoritativeBinding
    try {
      token = normalizeRecoveryJournalCall(() =>
        verifyPreparedMutationProof(proof, advisoryBinding)
      )
      const preparedCommitment = normalizeRecoveryJournalCall(() =>
        revalidateVerifiedPreparedMutationToken(token, advisoryBinding)
      )
      return cloneJson(
        this.#mutateState(
          (previous, now) => {
            authoritativeBinding = requireMutationEntryBinding(
              previous,
              evidence,
              this.paths.operationRoot
            )
            const current = previous.exclusiveIntent
            const next = {
              ...current,
              phase: 'mutating',
              updatedAt: isoTime(now),
              metadata: metadataWithRecoveryCommitment(current.metadata, preparedCommitment),
            }
            return { state: { ...previous, exclusiveIntent: next }, value: next }
          },
          {
            beforeFinalFence: () => {
              const commitment = normalizeRecoveryJournalCall(() =>
                revalidateVerifiedPreparedMutationToken(token, authoritativeBinding)
              )
              if (
                commitment.commitmentSha256 !== preparedCommitment.commitmentSha256 ||
                commitment.durability !== preparedCommitment.durability
              ) {
                throw protocolError(
                  'PREPARED_PROOF_INVALID',
                  'Prepared commitment changed during mutex revalidation'
                )
              }
            },
            onCommitted: () => consumeVerifiedPreparedMutationToken(token),
            durabilityPolicy: 'required-for-mutation-authority',
          }
        )
      )
    } finally {
      releaseVerifiedPreparedMutationToken(token)
    }
  }

  completeExclusiveMutation(intent) {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    return cloneJson(
      this.#mutateState((previous, now) => {
        const current = requireIntentAuthority(previous, evidence, ['mutating'])
        if (current.fencingGeneration !== previous.fencingGenerationHighWater) {
          throw protocolError('INTENT_FENCED', 'Exclusive intent is no longer the high-water owner')
        }
        const timestamp = isoTime(now)
        const next = {
          ...current,
          phase: 'completed',
          updatedAt: timestamp,
          completedAt: timestamp,
        }
        return { state: { ...previous, exclusiveIntent: next }, value: next }
      })
    )
  }

  clearExclusiveIntent(intent) {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    return this.#mutateState((previous) => {
      requireIntentAuthority(previous, evidence, ['completed'])
      return { state: { ...previous, exclusiveIntent: null }, value: true }
    })
  }

  cancelExclusiveIntent(intent) {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    return this.#mutateState((previous) => {
      const current = previous.exclusiveIntent
      if (current === null || !sameIntentAuthority(current, evidence)) {
        throw protocolError('INTENT_FENCED', 'Exclusive intent authority no longer matches')
      }
      if (!['registered', 'draining', 'exclusive'].includes(current.phase)) {
        throw protocolError(
          'INTENT_PHASE_INVALID',
          `Exclusive intent cannot be cancelled from persisted phase ${current.phase}`
        )
      }
      incrementCancellationCounter(previous.stateRevision, 'stateRevision')
      const fencingGenerationHighWater = incrementCancellationCounter(
        previous.fencingGenerationHighWater,
        'fencingGenerationHighWater'
      )
      return {
        state: { ...previous, fencingGenerationHighWater, exclusiveIntent: null },
        value: true,
      }
    })
  }

  assertRuntimeLeaseAuthority(lease = this.currentLease) {
    this.#requireOperationalOwner()
    const evidence = validateLease(cloneJson(lease), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'LEASE_FENCED')
    const now = this.#now()
    const state = this.#readAuthoritativeState()
    const current = state.leases.find((item) => item.leaseId === evidence.leaseId)
    if (!current || !sameLeaseAuthority(current, evidence) || isExpired(current.expiresAt, now)) {
      this.#selfFence(
        protocolError('LEASE_FENCED', 'Runtime lease is absent, expired, or superseded')
      )
      throw this.lastFailure
    }
    return cloneJson(current)
  }

  assertExclusiveAuthority(intent, phase = 'mutating') {
    this.#requireOperationalOwner()
    const evidence = validateIntent(cloneJson(intent), this.databaseIdentity)
    this.#requireCallerOwner(evidence.owner, 'INTENT_FENCED')
    const state = this.#readAuthoritativeState()
    const current = requireIntentAuthority(state, evidence, [phase])
    if (current.fencingGeneration !== state.fencingGenerationHighWater) {
      throw protocolError('INTENT_FENCED', 'Exclusive intent is no longer the high-water owner')
    }
    return cloneJson(current)
  }

  getLifecycleHealth() {
    const maintenanceDegraded = this.maintenanceFailures.length > 0
    const maintenanceReason = maintenanceDegraded ? this.maintenanceFailures.join('; ') : null
    try {
      if (this.fenced) {
        return ObjectFreeze({
          healthy: false,
          fenced: true,
          registered: false,
          shouldDrain: false,
          reason: this.lastFailure?.message ?? 'Owner self-fenced',
          stateRevision: this.lastCommittedStateRevision,
          fencingGeneration: this.currentLease?.fencingGeneration ?? null,
          maintenanceDegraded,
          durabilityUncertain: this.durabilityUncertain,
          lastCommittedStateRevision: this.lastCommittedStateRevision,
        })
      }
      if (!this.currentLease) {
        return ObjectFreeze({
          healthy: false,
          fenced: false,
          registered: false,
          shouldDrain: false,
          reason: maintenanceReason ?? 'No runtime lease is registered',
          stateRevision: this.#readAuthoritativeState().stateRevision,
          fencingGeneration: null,
          maintenanceDegraded,
          durabilityUncertain: false,
          lastCommittedStateRevision: this.lastCommittedStateRevision,
        })
      }
      const lease = this.assertRuntimeLeaseAuthority(this.currentLease)
      const state = this.#readAuthoritativeState()
      return ObjectFreeze({
        healthy: !maintenanceDegraded,
        fenced: false,
        registered: true,
        shouldDrain: state.exclusiveIntent !== null,
        reason:
          maintenanceReason ??
          (state.exclusiveIntent === null ? null : 'An exclusive database intent is active'),
        stateRevision: state.stateRevision,
        fencingGeneration: lease.fencingGeneration,
        maintenanceDegraded,
        durabilityUncertain: false,
        lastCommittedStateRevision: this.lastCommittedStateRevision,
      })
    } catch (error) {
      this.#selfFence(error)
      return ObjectFreeze({
        healthy: false,
        fenced: true,
        registered: false,
        shouldDrain: false,
        reason: this.lastFailure.message,
        stateRevision: this.lastCommittedStateRevision,
        fencingGeneration: this.currentLease?.fencingGeneration ?? null,
        maintenanceDegraded: this.maintenanceFailures.length > 0,
        durabilityUncertain: this.durabilityUncertain,
        lastCommittedStateRevision: this.lastCommittedStateRevision,
      })
    }
  }

  startHeartbeat(lease = this.currentLease) {
    if (this.heartbeatTimer) return this.heartbeatTimer
    this.assertRuntimeLeaseAuthority(lease)
    this.heartbeatTimer = setInterval(() => {
      try {
        this.currentLease = this.renewRuntimeLease(this.currentLease)
      } catch (error) {
        this.#selfFence(error)
      }
    }, this.heartbeatIntervalMs)
    this.heartbeatTimer.unref?.()
    return this.heartbeatTimer
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }

  #ensureOwner() {
    if (this.owner) return this.owner
    this.#ensurePaths()
    const hostId = readOrCreateHostIdentity(this.paths.hostIdentity)
    const processStartedAt = currentProcessStartedAt()
    this.owner = ObjectFreeze({
      ownerId: this.ownerId,
      runtimeId: this.runtimeId,
      hostId,
      processId: process.pid,
      processStartedAt,
    })
    return this.owner
  }

  #ensurePaths() {
    ensureCanonicalPrivateRoot(this.paths.root)
    ensurePrivateDirectory(this.paths.protocolRoot, this.paths.root)
    ensurePrivateDirectory(this.paths.operationRoot, this.paths.root)
    ensurePrivateDirectory(this.paths.stateRecords, this.paths.root)
  }

  #requireOperationalOwner() {
    if (this.fenced) {
      throw protocolError(
        'OWNER_SELF_FENCED',
        this.lastFailure?.message ?? 'Owner is self-fenced and cannot mutate authority'
      )
    }
  }

  #recordMaintenanceFailure(error, durabilityUncertain = false) {
    const failure = normalizeError(error)
    this.maintenanceFailures.push(`${failure.code}: ${failure.message}`)
    if (durabilityUncertain) {
      this.durabilityUncertain = true
      this.#selfFence(
        protocolError(
          'PUBLICATION_DURABILITY_UNCERTAIN',
          `Committed state publication durability is uncertain: ${failure.message}`,
          failure
        )
      )
    }
  }

  #now() {
    const value = this.clock()
    if (!Number.isFinite(value))
      throw protocolError('CLOCK_FAILURE', 'Clock returned an invalid time')
    return Math.trunc(value)
  }

  #readAuthoritativeState() {
    this.#ensurePaths()
    for (let attempt = 0; attempt < READ_RETRY_LIMIT; attempt += 1) {
      let names
      try {
        names = readdirSync(this.paths.stateRecords)
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw normalizeError(error)
      }
      this.testHooks?.afterStateDirectoryRead?.(
        ObjectFreeze({ attempt, names: ObjectFreeze([...names]), path: this.paths.stateRecords })
      )
      const records = []
      let retry = false
      for (const name of names) {
        const match = STATE_FILE_PATTERN.exec(name)
        if (!match) {
          throw protocolError('STATE_CORRUPTION', `Unexpected operation-state entry ${name}`)
        }
        const path = join(this.paths.stateRecords, name)
        try {
          assertPrivateRegularFile(path)
          const state = parseJsonFile(path, 'operation state')
          validateState(state, this.databaseIdentity)
          const fileRevision = Number(match[1])
          if (!Number.isSafeInteger(fileRevision) || fileRevision !== state.stateRevision) {
            throw protocolError(
              'STATE_CORRUPTION',
              `State filename revision does not match ${name}`
            )
          }
          records.push({ path, name, state })
        } catch (error) {
          if (error?.code === 'ENOENT') {
            retry = true
            break
          }
          throw normalizeError(error, 'STATE_CORRUPTION')
        }
      }
      if (retry) continue
      if (records.length === 0) {
        return initialState(this.databaseIdentity, this.#ensureOwner(), this.#now())
      }
      const ordered = [...records].sort(
        (left, right) => left.state.stateRevision - right.state.stateRevision
      )
      for (let index = 1; index < ordered.length; index += 1) {
        if (ordered[index].state.stateRevision === ordered[index - 1].state.stateRevision) {
          throw protocolError(
            'STATE_CORRUPTION',
            `Duplicate operation-state revision ${ordered[index].state.stateRevision}`
          )
        }
        if (
          ordered[index].state.fencingGenerationHighWater <
          ordered[index - 1].state.fencingGenerationHighWater
        ) {
          throw protocolError(
            'STATE_CORRUPTION',
            'Fencing high-water decreases across state records'
          )
        }
      }
      return ordered.at(-1).state
    }
    throw protocolError('STATE_READ_RACE', 'Operation state changed during every bounded read')
  }

  #mutateState(mutator, options) {
    this.#requireOperationalOwner()
    this.#ensureOwner()
    const publication = normalizeStatePublicationOptions(options)
    const mutex = this.#acquireMutex()
    let released = false
    const releaseMutex = () => {
      if (released) return
      try {
        released = this.#releaseMutex(mutex)
      } catch (error) {
        this.#recordMaintenanceFailure(error)
      }
    }

    let value
    let next
    let context
    try {
      const previous = this.#readAuthoritativeState()
      const now = this.#now()
      const mutation = mutator(cloneJson(previous), now)
      if (!isPlainRecord(mutation)) {
        throw protocolError('INVALID_MUTATION', 'Mutation result is malformed')
      }
      value = cloneJson(mutation.value)
      if (mutation.changed === false) {
        releaseMutex()
        return value
      }
      if (!isPlainRecord(mutation.state)) {
        throw protocolError('INVALID_MUTATION', 'Mutation state is missing')
      }
      next = {
        ...mutation.state,
        protocol: DATABASE_OPERATION_PROTOCOL,
        protocolVersion: DATABASE_OPERATION_PROTOCOL_VERSION,
        recordKind: 'operation_state',
        databaseIdentity: this.databaseIdentity,
        stateRevision: previous.stateRevision + 1,
        updatedBy: cloneJson(this.owner),
        updatedAt: isoTime(now),
      }
      if (next.fencingGenerationHighWater < previous.fencingGenerationHighWater) {
        throw protocolError('INVALID_MUTATION', 'Fencing high-water cannot decrease')
      }
      validateState(next, this.databaseIdentity)
      const stageId = randomUUID()
      const stagePath = join(mutex.tokenPath, `staged-state-${stageId}.json`)
      writeJsonExclusive(stagePath, next)
      context = {
        mutex: cloneJson(mutex.record),
        mutexPath: this.paths.registrationMutex,
        tokenPath: mutex.tokenPath,
        stagePath,
        statePath: null,
        nextState: cloneJson(next),
      }
      this.testHooks?.beforePublish?.(ObjectFreeze({ ...context }))
      this.#pruneForPublication()
      this.testHooks?.afterPrune?.(ObjectFreeze({ ...context }))
      publication.beforeFinalFence(ObjectFreeze({ ...context }))
      this.#revalidateMutex(mutex)
      const stateName = `operation-state-${String(next.stateRevision).padStart(20, '0')}-${randomUUID()}.json`
      const statePath = join(this.paths.stateRecords, stateName)
      renameSync(stagePath, statePath)
      this.lastCommittedStateRevision = next.stateRevision
      context.statePath = statePath
    } catch (error) {
      releaseMutex()
      throw normalizeError(error)
    }

    let strictFailure = null
    try {
      publication.onCommitted(ObjectFreeze({ ...context }))
    } catch (error) {
      const failure = normalizeError(error)
      this.#recordMaintenanceFailure(failure, true)
      strictFailure = mutationCommitUncertain(
        'Committed mutation-entry publication failed in its infallible commit callback',
        failure
      )
    }

    let durable = false
    if (strictFailure === null) {
      try {
        this.testHooks?.afterRename?.(ObjectFreeze({ ...context }))
        const injectedDirectorySync = this.testHooks?.directorySync?.(
          ObjectFreeze({ path: this.paths.stateRecords })
        )
        if (injectedDirectorySync !== undefined && injectedDirectorySync !== false) {
          throw protocolError(
            'INVALID_OPTIONS',
            'directorySync test hook may only inject unsupported with false'
          )
        }
        const directorySynced =
          injectedDirectorySync === false ? false : syncDirectory(this.paths.stateRecords)
        if (directorySynced) {
          durable = true
        } else if (publication.durabilityPolicy === 'required-for-mutation-authority') {
          const failure = protocolError(
            'DIRECTORY_SYNC_UNSUPPORTED',
            'State record is committed but directory fsync is unsupported'
          )
          this.#recordMaintenanceFailure(failure, true)
          strictFailure = mutationCommitUncertain(
            'Committed mutation-entry publication directory durability is unsupported',
            failure
          )
        } else {
          durable = true
          this.#recordMaintenanceFailure(
            protocolError(
              'DIRECTORY_SYNC_UNSUPPORTED',
              'State record is published but directory fsync is unsupported'
            )
          )
        }
        if (strictFailure === null) {
          this.testHooks?.afterFsync?.(ObjectFreeze({ ...context }))
        }
      } catch (error) {
        const failure = normalizeError(error)
        this.#recordMaintenanceFailure(failure, !durable)
        if (
          !durable &&
          publication.durabilityPolicy === 'required-for-mutation-authority'
        ) {
          strictFailure = mutationCommitUncertain(
            'Committed mutation-entry publication directory durability is uncertain',
            failure
          )
        }
      }
    }

    try {
      released = this.#releaseMutex(mutex)
      this.testHooks?.afterRelease?.(ObjectFreeze({ ...context, mutexReleased: released }))
    } catch (error) {
      this.#recordMaintenanceFailure(error)
    }
    if (strictFailure !== null) throw strictFailure
    return value
  }

  #requireCallerOwner(owner, code) {
    this.#ensureOwner()
    if (!sameOwner(owner, this.owner)) {
      throw protocolError(code, 'Persisted owner evidence does not belong to this lock instance')
    }
  }

  #acquireMutex() {
    const deadline = this.#now() + this.acquireTimeoutMs
    while (true) {
      const inspection = inspectMutexDirectory(
        this.paths.registrationMutex,
        this.databaseIdentity,
        this.mutexTtlMs,
        this.testHooks
      )
      const observedAt = this.#now()
      if (inspection.status === 'malformed') throw inspection.error
      if (inspection.status === 'complete' || inspection.status === 'incomplete') {
        const stale =
          inspection.status === 'complete'
            ? isExpired(inspection.record.expiresAt, observedAt)
            : observedAt >= inspection.staleAt
        if (stale && this.#quarantineStaleMutex(inspection)) continue
        if (observedAt >= deadline) {
          throw protocolError('MUTEX_BUSY', 'Timed out waiting for the registration mutex')
        }
        sleep(10)
        continue
      }

      const mutexId = randomUUID()
      const candidatePath = join(
        this.paths.operationRoot,
        `.candidate-mutex-${mutexId}-${randomUUID()}`
      )
      mkdirSync(candidatePath, { mode: PRIVATE_DIRECTORY_MODE })
      const candidateTokenPath = join(candidatePath, `token-${mutexId}`)
      mkdirSync(candidateTokenPath, { mode: PRIVATE_DIRECTORY_MODE })
      const acquiredAt = this.#now()
      const record = {
        protocol: DATABASE_OPERATION_PROTOCOL,
        protocolVersion: DATABASE_OPERATION_PROTOCOL_VERSION,
        recordKind: 'registration_mutex',
        databaseIdentity: this.databaseIdentity,
        mutexId,
        owner: cloneJson(this.owner),
        acquiredAt: isoTime(acquiredAt),
        expiresAt: isoTime(acquiredAt + this.mutexTtlMs),
        ttlMs: this.mutexTtlMs,
      }
      // writeJsonExclusive fsyncs mutex.json and its token directory; syncing the
      // candidate then makes the complete token child durable before publication.
      writeJsonExclusive(join(candidateTokenPath, 'mutex.json'), record)
      syncDirectory(candidatePath)
      const publicationContext = ObjectFreeze({
        candidatePath,
        mutexPath: this.paths.registrationMutex,
        tokenPath: join(this.paths.registrationMutex, `token-${mutexId}`),
        mutex: cloneJson(record),
      })
      try {
        this.testHooks?.beforeMutexPublication?.(publicationContext)
      } catch (error) {
        throw normalizeError(error)
      }

      let published = false
      try {
        renameSync(candidatePath, this.paths.registrationMutex)
        published = true
      } catch (error) {
        if (!isDirectoryRenameCollision(error, this.paths.registrationMutex)) {
          throw normalizeError(error)
        }
        rmSync(candidatePath, { recursive: true, force: true })
      }
      if (published) {
        syncDirectory(this.paths.operationRoot)
        try {
          this.testHooks?.afterMutexPublication?.(publicationContext)
        } catch (error) {
          throw normalizeError(error)
        }
        const mutex = { record, tokenPath: publicationContext.tokenPath }
        this.#revalidateMutex(mutex)
        return mutex
      }

      if (this.#now() >= deadline) {
        throw protocolError('MUTEX_BUSY', 'Timed out waiting for the registration mutex')
      }
      sleep(10)
    }
  }

  #revalidateMutex(mutex) {
    const inspection = inspectMutexDirectory(
      this.paths.registrationMutex,
      this.databaseIdentity,
      this.mutexTtlMs,
      this.testHooks
    )
    if (
      inspection.status !== 'complete' ||
      inspection.tokenPath !== mutex.tokenPath ||
      !sameMutexAuthority(inspection.record, mutex.record) ||
      isExpired(inspection.record.expiresAt, this.#now())
    ) {
      throw protocolError('MUTEX_FENCED', 'Registration mutex was expired, removed, or superseded')
    }
  }

  #releaseMutex(mutex) {
    let inspection
    try {
      inspection = inspectMutexDirectory(
        this.paths.registrationMutex,
        this.databaseIdentity,
        this.mutexTtlMs,
        this.testHooks
      )
    } catch {
      return false
    }
    if (
      inspection.status !== 'complete' ||
      inspection.tokenPath !== mutex.tokenPath ||
      !sameMutexAuthority(inspection.record, mutex.record) ||
      isExpired(inspection.record.expiresAt, this.#now())
    ) {
      return false
    }
    const quarantine = join(
      this.paths.operationRoot,
      `.quarantine-release-${mutex.record.mutexId}-${randomUUID()}`
    )
    try {
      renameSync(this.paths.registrationMutex, quarantine)
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw normalizeError(error)
    }
    this.testHooks?.afterMutexQuarantine?.(
      ObjectFreeze({ quarantine, mutexPath: this.paths.registrationMutex })
    )
    const moved = inspectMutexDirectory(
      quarantine,
      this.databaseIdentity,
      this.mutexTtlMs,
      this.testHooks
    )
    if (moved.status !== 'complete' || !sameMutexAuthority(moved.record, mutex.record)) {
      restoreQuarantine(quarantine, this.paths.registrationMutex, this.testHooks)
      return false
    }
    rmSync(quarantine, { recursive: true, force: false })
    syncDirectory(this.paths.operationRoot)
    return true
  }

  #quarantineStaleMutex(expected) {
    const quarantine = join(this.paths.operationRoot, `.quarantine-stale-${randomUUID()}`)
    try {
      renameSync(this.paths.registrationMutex, quarantine)
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw normalizeError(error)
    }
    const movedStat = lstatSync(quarantine)
    const stableIdentity =
      process.platform === 'win32'
        ? null
        : movedStat.dev === expected.stat.dev && movedStat.ino === expected.stat.ino
    const moved = inspectMutexDirectory(
      quarantine,
      this.databaseIdentity,
      this.mutexTtlMs,
      this.testHooks
    )
    const now = this.#now()
    const removable =
      expected.status === 'complete'
        ? moved.status === 'complete' &&
          sameMutexAuthority(expected.record, moved.record) &&
          isExpired(moved.record.expiresAt, now) &&
          stableIdentity !== false
        : expected.status === 'incomplete' &&
          moved.status === 'incomplete' &&
          now >= moved.staleAt &&
          stableIdentity === true
    if (!removable) {
      restoreQuarantineIfPossible(quarantine, this.paths.registrationMutex, this.testHooks)
      return false
    }
    rmSync(quarantine, { recursive: true, force: false })
    syncDirectory(this.paths.operationRoot)
    return true
  }

  #pruneForPublication() {
    const records = readdirSync(this.paths.stateRecords)
      .map((name) => {
        const match = STATE_FILE_PATTERN.exec(name)
        if (!match) throw protocolError('STATE_CORRUPTION', `Unexpected state entry ${name}`)
        return { name, revision: Number(match[1]) }
      })
      .sort((left, right) => right.revision - left.revision || right.name.localeCompare(left.name))
    const retainedBeforePublication = Math.max(1, this.maxStateRecords - 1)
    for (const record of records.slice(retainedBeforePublication)) {
      const path = join(this.paths.stateRecords, record.name)
      assertPrivateRegularFile(path)
      rmSync(path)
    }
    if (records.length > retainedBeforePublication) syncDirectory(this.paths.stateRecords)
  }

  #isOwnerDemonstrablyDead(owner) {
    validateOwner(owner)
    const currentHostId = readOrCreateHostIdentity(this.paths.hostIdentity)
    if (owner.hostId !== currentHostId) return false
    if (process.platform !== 'linux') {
      return nonLinuxProcessDemonstrablyAbsent(owner.processId)
    }
    let startedAt
    try {
      startedAt = linuxProcessStartedAt(owner.processId)
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return true
      throw protocolError(
        'PROCESS_EVIDENCE_UNAVAILABLE',
        'Could not inspect stale owner process',
        error
      )
    }
    return startedAt !== owner.processStartedAt
  }

  #selfFence(error) {
    this.fenced = true
    this.lastFailure = normalizeError(error)
    this.stopHeartbeat()
  }
}

const EXISTING_STATE_PUBLICATION = ObjectFreeze({
  beforeFinalFence: () => {},
  onCommitted: () => {},
  durabilityPolicy: 'existing-best-effort',
})

function normalizeStatePublicationOptions(options) {
  if (options === undefined) return EXISTING_STATE_PUBLICATION
  if (
    !isPlainRecord(options) ||
    ObjectKeys(options).length !== 3 ||
    !ObjectHasOwn(options, 'beforeFinalFence') ||
    !ObjectHasOwn(options, 'onCommitted') ||
    !ObjectHasOwn(options, 'durabilityPolicy') ||
    typeof options.beforeFinalFence !== 'function' ||
    typeof options.onCommitted !== 'function' ||
    !['existing-best-effort', 'required-for-mutation-authority'].includes(
      options.durabilityPolicy
    )
  ) {
    throw protocolError('INVALID_OPTIONS', 'State publication options are malformed')
  }
  return options
}

function requireMutationEntryBinding(state, evidence, operationRoot) {
  const current = state.exclusiveIntent
  if (current === null || !sameIntentAuthority(current, evidence)) {
    throw protocolError('INTENT_FENCED', 'Exclusive intent authority no longer matches')
  }
  if (current.phase !== 'exclusive') {
    throw protocolError(
      'INTENT_PHASE_INVALID',
      `Exclusive mutation cannot begin from persisted phase ${current.phase}`
    )
  }
  if (state.leases.length !== 0) {
    throw protocolError('RUNTIME_LEASES_ACTIVE', 'Runtime leases must drain before mutation')
  }
  if (current.fencingGeneration !== state.fencingGenerationHighWater) {
    throw protocolError('INTENT_FENCED', 'Exclusive intent is no longer the high-water owner')
  }
  if (state.stateRevision >= Number.MAX_SAFE_INTEGER) {
    throw protocolError('STATE_CORRUPTION', 'State revision cannot advance safely')
  }
  return ObjectFreeze({
    operationRoot,
    stateRevision: state.stateRevision,
    intent: cloneJson(current),
  })
}

function normalizeRecoveryJournalCall(action) {
  try {
    return action()
  } catch (error) {
    if (error instanceof RecoveryJournalError) {
      throw protocolError(error.code, error.message, error)
    }
    throw normalizeError(error)
  }
}

function mutationCommitUncertain(message, cause) {
  return protocolError('MUTATION_COMMIT_DURABILITY_UNCERTAIN', message, cause)
}

export function validateDatabaseOperationRecord(value) {
  const record = cloneJson(value)
  if (record?.recordKind === 'operation_state') {
    validateState(record, SHIKIN_DATABASE_IDENTITY)
  } else if (record?.recordKind === 'registration_mutex') {
    validateMutex(record, SHIKIN_DATABASE_IDENTITY)
  } else {
    throw protocolError('STATE_CORRUPTION', 'Unknown database operation record kind')
  }
  return record
}

function initialState(databaseIdentity, owner, now) {
  return {
    protocol: DATABASE_OPERATION_PROTOCOL,
    protocolVersion: DATABASE_OPERATION_PROTOCOL_VERSION,
    recordKind: 'operation_state',
    databaseIdentity,
    stateRevision: 0,
    fencingGenerationHighWater: 0,
    leases: [],
    exclusiveIntent: null,
    updatedBy: cloneJson(owner),
    updatedAt: isoTime(now),
  }
}

function validateTiming(options) {
  if (
    !Number.isSafeInteger(options.mutexTtlMs) ||
    options.mutexTtlMs < MUTEX_MIN_TTL_MS ||
    options.mutexTtlMs > MUTEX_MAX_TTL_MS
  ) {
    throw protocolError('INVALID_TIMING', 'mutexTtlMs violates the protocol contract')
  }
  if (
    !Number.isSafeInteger(options.leaseTtlMs) ||
    options.leaseTtlMs < LEASE_MIN_TTL_MS ||
    options.leaseTtlMs > LEASE_MAX_TTL_MS
  ) {
    throw protocolError('INVALID_TIMING', 'leaseTtlMs violates the protocol contract')
  }
  if (
    !Number.isSafeInteger(options.heartbeatIntervalMs) ||
    options.heartbeatIntervalMs < HEARTBEAT_MIN_MS ||
    options.heartbeatIntervalMs >= options.leaseTtlMs / 3
  ) {
    throw protocolError('INVALID_TIMING', 'heartbeatIntervalMs violates the protocol contract')
  }
}

function validateState(value, expectedIdentity) {
  assertExactKeys(
    value,
    [
      'protocol',
      'protocolVersion',
      'recordKind',
      'databaseIdentity',
      'stateRevision',
      'fencingGenerationHighWater',
      'leases',
      'exclusiveIntent',
      'updatedBy',
      'updatedAt',
    ],
    'operation state'
  )
  if (
    value.protocol !== DATABASE_OPERATION_PROTOCOL ||
    value.protocolVersion !== DATABASE_OPERATION_PROTOCOL_VERSION ||
    value.recordKind !== 'operation_state' ||
    value.databaseIdentity !== expectedIdentity ||
    !Number.isSafeInteger(value.stateRevision) ||
    value.stateRevision < 0 ||
    !Number.isSafeInteger(value.fencingGenerationHighWater) ||
    value.fencingGenerationHighWater < 0 ||
    !ArrayIsArray(value.leases) ||
    !isIsoTime(value.updatedAt)
  ) {
    throw protocolError('STATE_CORRUPTION', 'Operation state record is malformed')
  }
  validateOwner(value.updatedBy)
  const leaseIds = new Set()
  const ownerIds = new Set()
  for (const lease of value.leases) {
    validateLease(lease, expectedIdentity)
    if (lease.fencingGeneration > value.fencingGenerationHighWater) {
      throw protocolError('STATE_CORRUPTION', 'Lease generation exceeds fencing high-water')
    }
    if (leaseIds.has(lease.leaseId) || ownerIds.has(lease.owner.ownerId)) {
      throw protocolError('STATE_CORRUPTION', 'Runtime lease IDs and owners must be unique')
    }
    leaseIds.add(lease.leaseId)
    ownerIds.add(lease.owner.ownerId)
  }
  if (value.exclusiveIntent !== null) {
    validateIntent(value.exclusiveIntent, expectedIdentity)
    validateRecoveryCommitmentMetadata(value.exclusiveIntent)
    if (value.exclusiveIntent.fencingGeneration > value.fencingGenerationHighWater) {
      throw protocolError('STATE_CORRUPTION', 'Intent generation exceeds fencing high-water')
    }
    if (
      ['exclusive', 'mutating', 'completed', 'abandoned'].includes(value.exclusiveIntent.phase) &&
      value.leases.length !== 0
    ) {
      throw protocolError('STATE_CORRUPTION', 'Exclusive intent phase requires an empty lease set')
    }
  }
  return value
}

function validateLease(value) {
  assertExactKeys(
    value,
    [
      'recordKind',
      'leaseId',
      'owner',
      'fencingGeneration',
      'acquiredAt',
      'heartbeatAt',
      'expiresAt',
      'ttlMs',
    ],
    'runtime lease'
  )
  if (
    value.recordKind !== 'runtime_lease' ||
    !isIdentifier(value.leaseId) ||
    !Number.isSafeInteger(value.fencingGeneration) ||
    value.fencingGeneration < 1 ||
    !isIsoTime(value.acquiredAt) ||
    !isIsoTime(value.heartbeatAt) ||
    !isIsoTime(value.expiresAt) ||
    !Number.isSafeInteger(value.ttlMs) ||
    value.ttlMs < LEASE_MIN_TTL_MS ||
    value.ttlMs > LEASE_MAX_TTL_MS
  ) {
    throw protocolError('STATE_CORRUPTION', 'Runtime lease record is malformed')
  }
  validateOwner(value.owner)
  return value
}

function validateIntent(value) {
  const required = [
    'recordKind',
    'operationId',
    'operation',
    'phase',
    'owner',
    'fencingGeneration',
    'createdAt',
    'updatedAt',
  ]
  const optional = ['completedAt', 'metadata']
  assertAllowedKeys(value, required, optional, 'exclusive intent')
  if (
    value.recordKind !== 'exclusive_intent' ||
    !isIdentifier(value.operationId) ||
    !['restore', 'import'].includes(value.operation) ||
    !['registered', 'draining', 'exclusive', 'mutating', 'completed', 'abandoned'].includes(
      value.phase
    ) ||
    !Number.isSafeInteger(value.fencingGeneration) ||
    value.fencingGeneration < 1 ||
    !isIsoTime(value.createdAt) ||
    !isIsoTime(value.updatedAt) ||
    (value.completedAt !== undefined && !isIsoTime(value.completedAt)) ||
    (value.phase === 'completed' && value.completedAt === undefined) ||
    (value.metadata !== undefined && !isPlainRecord(value.metadata))
  ) {
    throw protocolError('STATE_CORRUPTION', 'Exclusive intent record is malformed')
  }
  validateOwner(value.owner)
  validateRecoveryCommitmentMetadata(value)
  return value
}

const RECOVERY_COMMITMENT_KEYS = ObjectFreeze([
  'shikin.recovery.protocol',
  'shikin.recovery.version',
  'shikin.recovery.recordSha256',
  'shikin.recovery.durability',
  'shikin.recovery.claimSequence',
])

function validateRecoveryCommitmentMetadata(intent) {
  if (intent.metadata === undefined) return false
  const recoveryKeys = ObjectKeys(intent.metadata).filter((key) =>
    key.startsWith('shikin.recovery.')
  )
  if (recoveryKeys.length === 0) return false
  if (!['mutating', 'completed', 'abandoned'].includes(intent.phase)) {
    throw protocolError(
      'STATE_CORRUPTION',
      'Recovery commitment metadata is forbidden before mutation'
    )
  }
  if (
    recoveryKeys.length !== RECOVERY_COMMITMENT_KEYS.length ||
    !RECOVERY_COMMITMENT_KEYS.every((key) =>
      ObjectHasOwn(intent.metadata, key)
    ) ||
    intent.metadata['shikin.recovery.protocol'] !== RECOVERY_JOURNAL_PROTOCOL ||
    intent.metadata['shikin.recovery.version'] !== RECOVERY_JOURNAL_VERSION ||
    typeof intent.metadata['shikin.recovery.recordSha256'] !== 'string' ||
    !/^[0-9a-f]{64}$/.test(intent.metadata['shikin.recovery.recordSha256']) ||
    intent.metadata['shikin.recovery.durability'] !== RECOVERY_JOURNAL_DURABILITY ||
    !Number.isSafeInteger(intent.metadata['shikin.recovery.claimSequence']) ||
    intent.metadata['shikin.recovery.claimSequence'] < 0
  ) {
    throw protocolError('STATE_CORRUPTION', 'Recovery commitment metadata is malformed')
  }
  return true
}

class MetadataValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'MetadataValidationError'
    this.code = code
  }
}

function snapshotCallerIntentMetadata(metadata) {
  normalizeCallerIntentMetadataValidation(metadata)
  if (metadata === undefined) return undefined

  let snapshot
  try {
    // This is the single caller-controlled serialization. Its detached result is
    // revalidated, then all later cloning and publication uses trap-free data.
    snapshot = JsonParse(JsonStringify(metadata))
  } catch (error) {
    throw protocolError('INVALID_OPERATION', 'Intent metadata could not be serialized', error)
  }
  normalizeCallerIntentMetadataValidation(snapshot)
  return snapshot
}

function normalizeCallerIntentMetadataValidation(metadata) {
  try {
    validateCallerIntentMetadata(metadata)
  } catch (error) {
    if (error instanceof MetadataValidationError) {
      throw protocolError(error.code, error.message, error)
    }
    throw protocolError('INVALID_OPERATION', 'Intent metadata could not be validated', error)
  }
}

function validateCallerIntentMetadata(metadata) {
  if (metadata === undefined) return
  if (!isPlainRecord(metadata)) {
    throw metadataValidationError('INVALID_OPERATION', 'Intent metadata must be an object')
  }
  validateCanonicalMetadataValue(metadata)
  const keys = ObjectKeys(metadata)
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    if (key.startsWith('shikin.recovery.')) {
      throw metadataValidationError(
        'RESERVED_METADATA_KEY',
        `Intent metadata key ${key} is reserved`
      )
    }
  }
}

function validateUnicodeString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw metadataValidationError(
          'INVALID_OPERATION',
          'Intent metadata string is not valid Unicode'
        )
      }
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw metadataValidationError(
        'INVALID_OPERATION',
        'Intent metadata string is not valid Unicode'
      )
    }
  }
}

function validateCanonicalMetadataValue(value) {
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    validateUnicodeString(value)
    return
  }
  if (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    !ObjectIs(value, -0)
  ) {
    return
  }
  if (ArrayIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      validateCanonicalMetadataValue(value[index])
    }
    return
  }
  if (isPlainRecord(value)) {
    const keys = ObjectKeys(value)
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]
      validateUnicodeString(key)
      validateCanonicalMetadataValue(value[key])
    }
    return
  }
  throw metadataValidationError('INVALID_OPERATION', 'Intent metadata is not canonical JSON')
}

function metadataValidationError(code, message) {
  return new MetadataValidationError(code, message)
}

function metadataWithRecoveryCommitment(metadata, commitment) {
  return {
    ...(metadata === undefined ? {} : cloneJson(metadata)),
    'shikin.recovery.protocol': RECOVERY_JOURNAL_PROTOCOL,
    'shikin.recovery.version': RECOVERY_JOURNAL_VERSION,
    'shikin.recovery.recordSha256': commitment.commitmentSha256,
    'shikin.recovery.durability': RECOVERY_JOURNAL_DURABILITY,
    'shikin.recovery.claimSequence': 0,
  }
}

function validateMutex(value, expectedIdentity) {
  assertExactKeys(
    value,
    [
      'protocol',
      'protocolVersion',
      'recordKind',
      'databaseIdentity',
      'mutexId',
      'owner',
      'acquiredAt',
      'expiresAt',
      'ttlMs',
    ],
    'registration mutex'
  )
  if (
    value.protocol !== DATABASE_OPERATION_PROTOCOL ||
    value.protocolVersion !== DATABASE_OPERATION_PROTOCOL_VERSION ||
    value.recordKind !== 'registration_mutex' ||
    value.databaseIdentity !== expectedIdentity ||
    !isIdentifier(value.mutexId) ||
    !isIsoTime(value.acquiredAt) ||
    !isIsoTime(value.expiresAt) ||
    !Number.isSafeInteger(value.ttlMs) ||
    value.ttlMs < MUTEX_MIN_TTL_MS ||
    value.ttlMs > MUTEX_MAX_TTL_MS
  ) {
    throw protocolError('MUTEX_CORRUPTION', 'Registration mutex record is malformed')
  }
  validateOwner(value.owner)
  return value
}

function validateOwner(value) {
  assertExactKeys(
    value,
    ['ownerId', 'runtimeId', 'hostId', 'processId', 'processStartedAt'],
    'owner evidence'
  )
  if (
    !isIdentifier(value.ownerId) ||
    !DATABASE_OPERATION_RUNTIME_IDS.includes(value.runtimeId) ||
    !isIdentifier(value.hostId) ||
    !Number.isSafeInteger(value.processId) ||
    value.processId < 1 ||
    value.processId > 0xffff_ffff ||
    !isIsoTime(value.processStartedAt)
  ) {
    throw protocolError('STATE_CORRUPTION', 'Owner evidence is malformed')
  }
  return value
}

function inspectMutexDirectory(path, databaseIdentity, incompleteTtlMs, testHooks = null) {
  let stat
  try {
    stat = lstatSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'absent' }
    throw normalizeError(error)
  }
  testHooks?.afterMutexRootStat?.(ObjectFreeze({ path, stat }))
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return {
      status: 'malformed',
      stat,
      error: protocolError('MUTEX_CORRUPTION', 'Mutex path is not a directory'),
    }
  }
  let entries
  try {
    entries = readdirSync(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'retry' }
    throw normalizeError(error)
  }
  if (entries.length === 0) {
    return { status: 'incomplete', stat, staleAt: stat.mtimeMs + incompleteTtlMs }
  }
  if (entries.length !== 1 || !TOKEN_DIRECTORY_PATTERN.test(entries[0])) {
    return {
      status: 'malformed',
      stat,
      error: protocolError('MUTEX_CORRUPTION', 'Mutex directory has unexpected entries'),
    }
  }
  const tokenPath = join(path, entries[0])
  let tokenStat
  let tokenEntries
  try {
    tokenStat = lstatSync(tokenPath)
    tokenEntries = readdirSync(tokenPath)
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'retry' }
    throw normalizeError(error)
  }
  if (!tokenStat.isDirectory() || tokenStat.isSymbolicLink()) {
    return {
      status: 'malformed',
      stat,
      error: protocolError('MUTEX_CORRUPTION', 'Mutex token is not a directory'),
    }
  }
  const unexpected = tokenEntries.filter(
    (entry) =>
      entry !== 'mutex.json' &&
      !STAGED_STATE_PATTERN.test(entry) &&
      !STAGED_MUTEX_PATTERN.test(entry)
  )
  if (unexpected.length > 0) {
    return {
      status: 'malformed',
      stat,
      error: protocolError('MUTEX_CORRUPTION', 'Mutex token has unexpected entries'),
    }
  }
  if (!tokenEntries.includes('mutex.json')) {
    return { status: 'incomplete', stat, staleAt: stat.mtimeMs + incompleteTtlMs }
  }
  try {
    const mutexPath = join(tokenPath, 'mutex.json')
    assertPrivateRegularFile(mutexPath)
    const record = parseJsonFile(mutexPath, 'registration mutex')
    validateMutex(record, databaseIdentity)
    if (entries[0] !== `token-${record.mutexId}`) {
      throw protocolError('MUTEX_CORRUPTION', 'Mutex token directory does not match mutexId')
    }
    return { status: 'complete', stat, tokenPath, record }
  } catch (error) {
    if (error?.code === 'ENOENT') return { status: 'retry' }
    return { status: 'malformed', stat, error: normalizeError(error, 'MUTEX_CORRUPTION') }
  }
}

function requireIntentAuthority(state, evidence, phases) {
  const current = state.exclusiveIntent
  if (
    current === null ||
    !sameIntentAuthority(current, evidence) ||
    !phases.includes(current.phase)
  ) {
    throw protocolError(
      'INTENT_FENCED',
      'Exclusive intent ownership, fencing, or phase no longer matches'
    )
  }
  return current
}

function incrementCancellationCounter(value, label) {
  if (value >= Number.MAX_SAFE_INTEGER) {
    throw protocolError('COUNTER_OVERFLOW', `${label} cannot exceed the JSON safe-integer limit`)
  }
  return value + 1
}

function sameLeaseAuthority(left, right) {
  return (
    left.leaseId === right.leaseId &&
    left.fencingGeneration === right.fencingGeneration &&
    sameOwner(left.owner, right.owner)
  )
}

function sameIntentAuthority(left, right) {
  return (
    left.operationId === right.operationId &&
    left.fencingGeneration === right.fencingGeneration &&
    sameOwner(left.owner, right.owner)
  )
}

function sameMutexAuthority(left, right) {
  return (
    left.databaseIdentity === right.databaseIdentity &&
    left.mutexId === right.mutexId &&
    left.expiresAt === right.expiresAt &&
    sameOwner(left.owner, right.owner)
  )
}

function sameOwner(left, right) {
  return (
    left.ownerId === right.ownerId &&
    left.runtimeId === right.runtimeId &&
    left.hostId === right.hostId &&
    left.processId === right.processId &&
    left.processStartedAt === right.processStartedAt
  )
}

function readOrCreateHostIdentity(path) {
  const parent = dirname(path)
  ensurePrivateDirectory(parent, parent)
  for (let attempt = 0; attempt < READ_RETRY_LIMIT; attempt += 1) {
    try {
      assertPrivateRegularFile(path)
      const record = parseJsonFile(path, 'machine host identity')
      assertExactKeys(record, ['hostId'], 'machine host identity')
      if (!isIdentifier(record.hostId)) {
        throw protocolError('HOST_ID_CORRUPTION', 'Machine host identity is malformed')
      }
      return record.hostId
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw protocolError(
          'HOST_ID_CORRUPTION',
          'Stable machine host identity is malformed or unsafe',
          error
        )
      }
    }

    const hostId = randomUUID()
    const stagedPath = join(parent, `.machine-host-identity-${randomUUID()}.json`)
    try {
      writeJsonExclusive(stagedPath, { hostId })
      try {
        linkSync(stagedPath, path)
        syncDirectory(parent)
        return hostId
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
    } finally {
      rmSync(stagedPath, { force: true })
    }
  }
  throw protocolError('HOST_ID_CORRUPTION', 'Machine host identity could not converge')
}

function currentProcessStartedAt() {
  if (process.platform === 'linux') return linuxProcessStartedAt(process.pid)
  return isoTime(Date.now())
}

function nonLinuxProcessDemonstrablyAbsent(processId) {
  if (process.platform !== 'win32' && processId > 0x7fff_ffff) return true
  try {
    process.kill(processId, 0)
    return false
  } catch (error) {
    if (error?.code === 'ESRCH') return true
    if (error?.code === 'EPERM') return false
    throw protocolError(
      'PROCESS_EVIDENCE_UNAVAILABLE',
      'Could not conservatively inspect process liveness',
      error
    )
  }
}

function linuxProcessStartedAt(processId) {
  const statSource = readFileSync(`/proc/${processId}/stat`, 'utf8')
  const closing = statSource.lastIndexOf(')')
  if (closing < 0)
    throw protocolError('PROCESS_EVIDENCE_UNAVAILABLE', 'Malformed Linux process stat')
  const fields = statSource
    .slice(closing + 2)
    .trim()
    .split(/\s+/)
  const startTicks = Number(fields[19])
  if (!Number.isSafeInteger(startTicks) || startTicks < 0) {
    throw protocolError('PROCESS_EVIDENCE_UNAVAILABLE', 'Malformed Linux process start time')
  }
  const bootLine = readFileSync('/proc/stat', 'utf8')
    .split('\n')
    .find((line) => line.startsWith('btime '))
  const bootSeconds = Number(bootLine?.slice(6))
  if (!Number.isSafeInteger(bootSeconds) || bootSeconds < 0) {
    throw protocolError('PROCESS_EVIDENCE_UNAVAILABLE', 'Malformed Linux boot time')
  }
  if (linuxClockTicksPerSecond === undefined) {
    linuxClockTicksPerSecond = Number(
      execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim()
    )
  }
  if (!Number.isSafeInteger(linuxClockTicksPerSecond) || linuxClockTicksPerSecond < 1) {
    throw protocolError('PROCESS_EVIDENCE_UNAVAILABLE', 'Invalid Linux clock tick rate')
  }
  return isoTime(bootSeconds * 1000 + Math.floor((startTicks * 1000) / linuxClockTicksPerSecond))
}

function ensureCanonicalPrivateRoot(path) {
  const expected = resolve(path)
  if (!existsSync(expected)) {
    let ancestor = dirname(expected)
    while (!existsSync(ancestor)) ancestor = dirname(ancestor)
    assertCanonicalDirectory(ancestor)
    mkdirSync(expected, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  }
  assertCanonicalDirectory(expected)
  if (process.platform !== 'win32') chmodSync(expected, PRIVATE_DIRECTORY_MODE)
}

function ensurePrivateDirectory(path, canonicalRoot) {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw protocolError('UNSAFE_PATH', `${path} is not a private directory`)
  }
  const canonical = comparablePath(realpathSync(path))
  const root = comparablePath(realpathSync(canonicalRoot))
  if (
    canonical !== root &&
    !canonical.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)
  ) {
    throw protocolError('UNSAFE_PATH', `${path} escapes the canonical coordination root`)
  }
  if (process.platform !== 'win32') chmodSync(path, PRIVATE_DIRECTORY_MODE)
}

function assertCanonicalDirectory(path) {
  const stat = lstatSync(path)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    comparablePath(realpathSync(path)) !== comparablePath(resolve(path))
  ) {
    throw protocolError('UNSAFE_PATH', `${path} is not a canonical non-symlink directory`)
  }
}

function comparablePath(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

function assertPrivateRegularFile(path) {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw protocolError('UNSAFE_PATH', `${path} is not a regular file`)
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    throw protocolError('UNSAFE_PATH', `${path} is not private`)
  }
}

function writeJsonExclusive(path, value) {
  const descriptor = openSync(path, 'wx', PRIVATE_FILE_MODE)
  try {
    writeFileSync(descriptor, `${stringifyJsonData(value)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  if (process.platform !== 'win32') chmodSync(path, PRIVATE_FILE_MODE)
  syncDirectory(resolve(path, '..'))
}

function parseJsonFile(path, label) {
  const source = readFileSync(path, 'utf8')
  if (source.length === 0 || source.length > 1024 * 1024) {
    throw protocolError('STATE_CORRUPTION', `${label} file has an invalid size`)
  }
  try {
    return JsonParse(source)
  } catch (error) {
    throw protocolError('STATE_CORRUPTION', `${label} file contains malformed JSON`, error)
  }
}

function syncDirectory(path) {
  let descriptor
  try {
    descriptor = openSync(path, 'r')
    fsyncSync(descriptor)
    return true
  } catch (error) {
    if (['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes(error?.code)) return false
    throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function restoreQuarantine(quarantine, fixedPath, testHooks = null) {
  if (!restoreQuarantineIfPossible(quarantine, fixedPath, testHooks)) {
    throw protocolError(
      'MUTEX_FENCED',
      'A quarantined mutex could not be restored because a successor exists'
    )
  }
}

function restoreQuarantineIfPossible(quarantine, fixedPath, testHooks = null) {
  testHooks?.beforeMutexRestore?.(ObjectFreeze({ quarantine, mutexPath: fixedPath }))
  try {
    renameSync(quarantine, fixedPath)
    return true
  } catch (error) {
    if (isDirectoryRenameCollision(error, fixedPath)) return false
    throw error
  }
}

function isDirectoryRenameCollision(error, destination) {
  if (['EEXIST', 'ENOTEMPTY'].includes(error?.code)) return true
  if (!['EPERM', 'EACCES'].includes(error?.code)) return false
  try {
    return lstatSync(destination).isDirectory()
  } catch {
    return false
  }
}

function assertExactKeys(value, expected, label) {
  if (!isPlainRecord(value)) throw protocolError('STATE_CORRUPTION', `${label} is not an object`)
  const actualKeys = ObjectKeys(value).sort()
  const expectedKeys = [...expected].sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw protocolError('STATE_CORRUPTION', `${label} has unknown or missing fields`)
  }
}

function assertAllowedKeys(value, required, optional, label) {
  if (!isPlainRecord(value)) throw protocolError('STATE_CORRUPTION', `${label} is not an object`)
  const allowed = new Set([...required, ...optional])
  if (
    required.some((key) => !(key in value)) ||
    ObjectKeys(value).some((key) => !allowed.has(key))
  ) {
    throw protocolError('STATE_CORRUPTION', `${label} has unknown or missing fields`)
  }
}

function assertBoundedString(value, label, minimum, maximum) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw protocolError('INVALID_OPTIONS', `${label} must contain ${minimum}-${maximum} characters`)
  }
}

function isIdentifier(value) {
  if (typeof value !== 'string') return false
  const byteLength = Buffer.byteLength(value, 'utf8')
  return byteLength >= 1 && byteLength <= 128
}

function isIsoTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
}

function isExpired(expiresAt, now) {
  const expires = Date.parse(expiresAt)
  if (!Number.isFinite(expires))
    throw protocolError('STATE_CORRUPTION', 'Expiration time is malformed')
  return now >= expires
}

function isoTime(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()))
    throw protocolError('CLOCK_FAILURE', 'Could not format clock time')
  return date.toISOString()
}

function sleep(milliseconds) {
  Atomics.wait(sleepArray, 0, 0, milliseconds)
}

function cloneJson(value) {
  return value === undefined ? undefined : JsonParse(stringifyJsonData(value))
}

function stringifyJsonData(value) {
  return JsonStringify(copyJsonDataWithoutTraps(value, []))
}

function copyJsonDataWithoutTraps(value, ancestors) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol') return undefined
    return value
  }
  for (let index = 0; index < ancestors.length; index += 1) {
    if (ancestors[index] === value) {
      throw new PrimordialTypeError('Cannot serialize cyclic JSON data')
    }
  }
  ObjectDefineProperty(ancestors, String(ancestors.length), {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })

  try {
    if (ArrayIsArray(value)) {
      const lengthDescriptor = ObjectGetOwnPropertyDescriptor(value, 'length')
      if (lengthDescriptor === undefined || !ObjectHasOwn(lengthDescriptor, 'value')) {
        throw new PrimordialTypeError('JSON data arrays must have a data length')
      }
      const copy = new PrimordialArray(lengthDescriptor.value)
      // Arrays cannot use a null prototype without changing their JSON behavior,
      // so shadow any inherited or own toJSON before the captured stringifier runs.
      ObjectDefineProperty(copy, 'toJSON', {
        configurable: true,
        value: undefined,
      })
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = ObjectGetOwnPropertyDescriptor(value, String(index))
        if (descriptor !== undefined && !ObjectHasOwn(descriptor, 'value')) {
          throw new PrimordialTypeError('JSON data must not contain accessors')
        }
        ObjectDefineProperty(copy, String(index), {
          configurable: true,
          enumerable: true,
          value:
            descriptor === undefined
              ? undefined
              : copyJsonDataWithoutTraps(descriptor.value, ancestors),
          writable: true,
        })
      }
      return copy
    }

    const copy = ObjectCreate(null)
    const keys = ObjectKeys(value)
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]
      const descriptor = ObjectGetOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !ObjectHasOwn(descriptor, 'value')) {
        throw new PrimordialTypeError('JSON data must not contain accessors')
      }
      ObjectDefineProperty(copy, key, {
        configurable: true,
        enumerable: true,
        value: copyJsonDataWithoutTraps(descriptor.value, ancestors),
        writable: true,
      })
    }
    return copy
  } finally {
    ancestors.length -= 1
  }
}

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || ArrayIsArray(value)) return false
  const prototype = ObjectGetPrototypeOf(value)
  return prototype === ObjectPrototype || prototype === null
}

function protocolError(code, message, cause) {
  return new DatabaseOperationLockError(code, message, cause)
}

function normalizeError(error, fallbackCode = 'FILESYSTEM_FAILURE') {
  if (error instanceof DatabaseOperationLockError) return error
  return protocolError(fallbackCode, error instanceof Error ? error.message : String(error), error)
}
