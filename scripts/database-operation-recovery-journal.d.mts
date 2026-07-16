export type RecoveryOperation = 'restore' | 'import'
export type RecoveryJournalDurability = 'linux-fsync-complete'
export type RecoveryJournalRuntimeId = 'cli' | 'mcp' | 'browser-data-server' | 'tauri'

export interface RecoveryJournalOwnerEvidence {
  ownerId: string
  runtimeId: RecoveryJournalRuntimeId
  hostId: string
  processId: number
  processStartedAt: string
}

export interface RecoveryJournalExclusiveIntent {
  recordKind: 'exclusive_intent'
  operationId: string
  operation: RecoveryOperation
  phase: 'exclusive'
  owner: RecoveryJournalOwnerEvidence
  fencingGeneration: number
  /** Exact exclusive-intent creation timestamp copied into the prepared record. */
  createdAt: string
  /** Proof-only intent binding field; it is not persisted in the prepared record. */
  updatedAt: string
  /** Proof-only plain canonical JSON object; it is not persisted in the prepared record. */
  metadata?: Record<string, unknown>
}

export interface RecoveryJournalCommitment {
  'shikin.recovery.protocol': 'shikin.database-operation-recovery-journal'
  'shikin.recovery.version': 1
  'shikin.recovery.recordSha256': string
  'shikin.recovery.durability': 'linux-fsync-complete'
  'shikin.recovery.claimSequence': number
}

export interface RecoveryJournalCommittedIntent {
  recordKind: 'exclusive_intent'
  operationId: string
  operation: RecoveryOperation
  phase: 'mutating' | 'abandoned'
  owner: RecoveryJournalOwnerEvidence
  fencingGeneration: number
  createdAt: string
  updatedAt: string
  recoveryCommitment: RecoveryJournalCommitment
}

export interface RecoverySchemaContractIdentity {
  readonly rawBytesSha256: `sha256:${string}`
  readonly contractVersion: number
  readonly latestMigration: string
}

export interface ArtifactChecks {
  integrityCheck: 'ok'
  foreignKeyCheck: 'ok'
  schemaContractCheck: 'ok'
  sidecarCheck: 'ok'
}

export interface ArtifactWriteContext {
  readonly role: 'candidate' | 'rollback'
  readonly path: string
  readonly operationId: string
  readonly operation: RecoveryOperation
  readonly schemaContractIdentity: Readonly<RecoverySchemaContractIdentity>
}

declare const preparedMutationProofBrand: unique symbol
export interface PreparedMutationProof {
  readonly [preparedMutationProofBrand]: true
}

declare const verifiedPreparedMutationTokenBrand: unique symbol
export interface VerifiedPreparedMutationToken {
  readonly [verifiedPreparedMutationTokenBrand]: true
}

declare const verifiedCommittedRecoveryEvidenceTokenBrand: unique symbol
export interface VerifiedCommittedRecoveryEvidenceToken {
  readonly [verifiedCommittedRecoveryEvidenceTokenBrand]: true
}

export interface PreparedCommitment {
  readonly commitmentSha256: string
  readonly durability: RecoveryJournalDurability
}

export interface PrepareMutationJournalOptions {
  operationRoot: string
  /** Proof-only binding field; it is not persisted in the prepared record. */
  stateRevision: number
  intent: RecoveryJournalExclusiveIntent
  writeArtifact(context: ArtifactWriteContext): ArtifactChecks
}

export interface VerifyPreparedMutationProofOptions {
  operationRoot: string
  /** Proof-only binding field; it is not persisted in the prepared record. */
  stateRevision: number
  intent: RecoveryJournalExclusiveIntent
}

export interface VerifyCommittedRecoveryEvidenceOptions {
  operationRoot: string
  stateRevision: number
  intent: RecoveryJournalCommittedIntent
}

export interface PreparedMutationJournal {
  readonly proof: PreparedMutationProof
  readonly commitmentSha256: string
  readonly durability: RecoveryJournalDurability
}

export class RecoveryJournalError extends Error {
  readonly code: string
  constructor(code: string, message: string, cause?: unknown)
}

export function prepareMutationJournal(
  options: PrepareMutationJournalOptions
): PreparedMutationJournal

export function verifyPreparedMutationProof(
  proof: PreparedMutationProof,
  options: VerifyPreparedMutationProofOptions
): VerifiedPreparedMutationToken

export function revalidateVerifiedPreparedMutationToken(
  token: VerifiedPreparedMutationToken,
  options: VerifyPreparedMutationProofOptions
): Readonly<PreparedCommitment>

export function releaseVerifiedPreparedMutationToken(token: VerifiedPreparedMutationToken): void
export function consumeVerifiedPreparedMutationToken(token: VerifiedPreparedMutationToken): void

export function verifyCommittedRecoveryEvidence(
  options: VerifyCommittedRecoveryEvidenceOptions
): VerifiedCommittedRecoveryEvidenceToken

export function revalidateVerifiedCommittedRecoveryEvidenceToken(
  token: VerifiedCommittedRecoveryEvidenceToken,
  options: VerifyCommittedRecoveryEvidenceOptions
): Readonly<PreparedCommitment>

export function releaseVerifiedCommittedRecoveryEvidenceToken(
  token: VerifiedCommittedRecoveryEvidenceToken
): void
