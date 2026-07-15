export const DATABASE_OPERATION_PROTOCOL: 'shikin.database-operation-lock'
export const DATABASE_OPERATION_PROTOCOL_VERSION: 1
export const SHIKIN_DATABASE_IDENTITY: 'com.asf.shikin:shikin.db'
export const DATABASE_OPERATION_RUNTIME_IDS: readonly ['cli', 'mcp', 'browser-data-server', 'tauri']
export type DatabaseOperationRuntimeId = (typeof DATABASE_OPERATION_RUNTIME_IDS)[number]
export type DatabaseOperation = 'restore' | 'import'
export type ExclusiveIntentPhase =
  | 'registered'
  | 'draining'
  | 'exclusive'
  | 'mutating'
  | 'completed'
  | 'abandoned'

export interface OwnerEvidence {
  ownerId: string
  runtimeId: DatabaseOperationRuntimeId
  hostId: string
  processId: number
  processStartedAt: string
}

export interface RuntimeLease {
  recordKind: 'runtime_lease'
  leaseId: string
  owner: OwnerEvidence
  fencingGeneration: number
  acquiredAt: string
  heartbeatAt: string
  expiresAt: string
  ttlMs: number
}

export interface ExclusiveIntent {
  recordKind: 'exclusive_intent'
  operationId: string
  operation: DatabaseOperation
  phase: ExclusiveIntentPhase
  owner: OwnerEvidence
  fencingGeneration: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

export interface OperationStateRecord {
  protocol: typeof DATABASE_OPERATION_PROTOCOL
  protocolVersion: typeof DATABASE_OPERATION_PROTOCOL_VERSION
  recordKind: 'operation_state'
  databaseIdentity: string
  stateRevision: number
  fencingGenerationHighWater: number
  leases: RuntimeLease[]
  exclusiveIntent: ExclusiveIntent | null
  updatedBy: OwnerEvidence
  updatedAt: string
}

export interface RegistrationMutexRecord {
  protocol: typeof DATABASE_OPERATION_PROTOCOL
  protocolVersion: typeof DATABASE_OPERATION_PROTOCOL_VERSION
  recordKind: 'registration_mutex'
  databaseIdentity: string
  mutexId: string
  owner: OwnerEvidence
  acquiredAt: string
  expiresAt: string
  ttlMs: number
}

export interface DatabaseOperationTiming {
  mutexTtlMs: number
  leaseTtlMs: number
  heartbeatIntervalMs: number
}
export const DEFAULT_DATABASE_OPERATION_TIMING: Readonly<DatabaseOperationTiming>

export interface DatabaseOperationLockPaths {
  readonly root: string
  readonly hostIdentity: string
  readonly protocolRoot: string
  readonly operationRoot: string
  readonly stateRecords: string
  readonly registrationMutex: string
}

export interface DatabaseOperationLockTestHookContext {
  readonly mutex: RegistrationMutexRecord
  readonly mutexPath: string
  readonly tokenPath: string
  readonly stagePath: string
  readonly statePath: string | null
  readonly nextState: OperationStateRecord
  readonly mutexReleased?: boolean
}

export interface DatabaseOperationLockOptions extends Partial<DatabaseOperationTiming> {
  rootDir: string
  databaseIdentity: string
  runtimeId: DatabaseOperationRuntimeId
  acquireTimeoutMs?: number
  maxStateRecords?: number
  clock?: () => number
  /** Test-only race injection. Production adapters must not supply this. */
  testHooks?: {
    beforePublish?(context: DatabaseOperationLockTestHookContext): void
    afterPrune?(context: DatabaseOperationLockTestHookContext): void
    afterRename?(context: DatabaseOperationLockTestHookContext): void
    afterFsync?(context: DatabaseOperationLockTestHookContext): void
    afterRelease?(context: DatabaseOperationLockTestHookContext): void
    afterStateDirectoryRead?(context: {
      readonly attempt: number
      readonly names: readonly string[]
      readonly path: string
    }): void
    afterMutexRootStat?(context: { readonly path: string; readonly stat: unknown }): void
    beforeMutexPublication?(context: {
      readonly candidatePath: string
      readonly mutexPath: string
      readonly tokenPath: string
      readonly mutex: RegistrationMutexRecord
    }): void
    afterMutexPublication?(context: {
      readonly candidatePath: string
      readonly mutexPath: string
      readonly tokenPath: string
      readonly mutex: RegistrationMutexRecord
    }): void
    afterMutexQuarantine?(context: {
      readonly quarantine: string
      readonly mutexPath: string
    }): void
    beforeMutexRestore?(context: { readonly quarantine: string; readonly mutexPath: string }): void
    directorySync?(context: { readonly path: string }): boolean | undefined
  }
}

export interface StaleCleanupResult {
  removedLeaseIds: string[]
  abandonedIntent: boolean
  stateRevision: number
}

export interface DatabaseOperationLifecycleHealth {
  readonly healthy: boolean
  readonly fenced: boolean
  readonly registered: boolean
  readonly shouldDrain: boolean
  readonly reason: string | null
  readonly stateRevision: number | null
  readonly fencingGeneration: number | null
  readonly maintenanceDegraded: boolean
  readonly durabilityUncertain: boolean
  readonly lastCommittedStateRevision: number | null
}

export function validateDatabaseOperationRecord(
  value: unknown
): OperationStateRecord | RegistrationMutexRecord

export class DatabaseOperationLockError extends Error {
  readonly code: string
  constructor(code: string, message: string, cause?: unknown)
}

export class DatabaseOperationLock {
  constructor(options: DatabaseOperationLockOptions)
  getPaths(): DatabaseOperationLockPaths
  getOwnerEvidence(): OwnerEvidence
  readOperationState(): OperationStateRecord
  registerRuntimeLease(): RuntimeLease
  renewRuntimeLease(lease?: RuntimeLease | null): RuntimeLease
  releaseRuntimeLease(lease?: RuntimeLease | null): boolean
  cleanupStaleRecords(): StaleCleanupResult
  acquireExclusiveIntent(
    operation: DatabaseOperation,
    metadata?: Record<string, unknown>
  ): ExclusiveIntent
  drainExclusiveIntent(intent: ExclusiveIntent): ExclusiveIntent
  beginExclusiveMutation(intent: ExclusiveIntent): ExclusiveIntent
  completeExclusiveMutation(intent: ExclusiveIntent): ExclusiveIntent
  clearExclusiveIntent(intent: ExclusiveIntent): boolean
  cancelExclusiveIntent(intent: ExclusiveIntent): boolean
  assertRuntimeLeaseAuthority(lease?: RuntimeLease | null): RuntimeLease
  assertExclusiveAuthority(intent: ExclusiveIntent, phase?: ExclusiveIntentPhase): ExclusiveIntent
  getLifecycleHealth(): DatabaseOperationLifecycleHealth
  startHeartbeat(lease?: RuntimeLease | null): NodeJS.Timeout
  stopHeartbeat(): void
}
