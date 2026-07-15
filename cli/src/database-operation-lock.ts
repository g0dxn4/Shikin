// The CLI adapter is intentionally type-only/thin: the path-parameterized Node
// implementation remains the single protocol implementation shared by Node runtimes.
export {
  DATABASE_OPERATION_PROTOCOL,
  DATABASE_OPERATION_PROTOCOL_VERSION,
  DATABASE_OPERATION_RUNTIME_IDS,
  DEFAULT_DATABASE_OPERATION_TIMING,
  SHIKIN_DATABASE_IDENTITY,
  DatabaseOperationLock,
  DatabaseOperationLockError,
} from '../../scripts/database-operation-lock.mjs'
export type {
  DatabaseOperation,
  DatabaseOperationLifecycleHealth,
  DatabaseOperationLockOptions,
  DatabaseOperationLockPaths,
  DatabaseOperationRuntimeId,
  DatabaseOperationTiming,
  ExclusiveIntent,
  ExclusiveIntentPhase,
  OperationStateRecord,
  OwnerEvidence,
  RegistrationMutexRecord,
  RuntimeLease,
  StaleCleanupResult,
} from '../../scripts/database-operation-lock.mjs'
