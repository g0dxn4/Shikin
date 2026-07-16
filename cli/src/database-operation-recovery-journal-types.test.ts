// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  RecoveryJournalError,
  consumeVerifiedPreparedMutationToken,
  prepareMutationJournal,
  releaseVerifiedCommittedRecoveryEvidenceToken,
  releaseVerifiedPreparedMutationToken,
  revalidateVerifiedCommittedRecoveryEvidenceToken,
  revalidateVerifiedPreparedMutationToken,
  verifyCommittedRecoveryEvidence,
  verifyPreparedMutationProof,
} from '../../scripts/database-operation-recovery-journal.mjs'
import type {
  ArtifactChecks,
  ArtifactWriteContext,
  PrepareMutationJournalOptions,
  PreparedCommitment,
  PreparedMutationJournal,
  PreparedMutationProof,
  RecoveryJournalCommitment,
  RecoveryJournalCommittedIntent,
  RecoveryJournalDurability,
  RecoveryJournalExclusiveIntent,
  VerifiedCommittedRecoveryEvidenceToken,
  VerifiedPreparedMutationToken,
  VerifyCommittedRecoveryEvidenceOptions,
  VerifyPreparedMutationProofOptions,
} from '../../scripts/database-operation-recovery-journal.mjs'

describe('recovery journal declarations', () => {
  it('are importable by the CLI TypeScript project without filesystem side effects', () => {
    expect(prepareMutationJournal).toBeTypeOf('function')
    expect(verifyPreparedMutationProof).toBeTypeOf('function')
    expect(revalidateVerifiedPreparedMutationToken).toBeTypeOf('function')
    expect(releaseVerifiedPreparedMutationToken).toBeTypeOf('function')
    expect(consumeVerifiedPreparedMutationToken).toBeTypeOf('function')
    expect(verifyCommittedRecoveryEvidence).toBeTypeOf('function')
    expect(revalidateVerifiedCommittedRecoveryEvidenceToken).toBeTypeOf('function')
    expect(releaseVerifiedCommittedRecoveryEvidenceToken).toBeTypeOf('function')
    expect(new RecoveryJournalError('TEST', 'test').code).toBe('TEST')

    expectTypeOf(prepareMutationJournal).returns.toMatchTypeOf<PreparedMutationJournal>()
    expectTypeOf<RecoveryJournalDurability>().toEqualTypeOf<'linux-fsync-complete'>()
    expectTypeOf<PreparedMutationJournal['durability']>().toEqualTypeOf<RecoveryJournalDurability>()
    expectTypeOf<RecoveryJournalExclusiveIntent['createdAt']>().toEqualTypeOf<string>()
    expectTypeOf<RecoveryJournalExclusiveIntent['updatedAt']>().toEqualTypeOf<string>()
    expectTypeOf<RecoveryJournalExclusiveIntent['metadata']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >()
    expectTypeOf(verifyPreparedMutationProof).returns.toEqualTypeOf<VerifiedPreparedMutationToken>()
    expectTypeOf(revalidateVerifiedPreparedMutationToken).returns.toEqualTypeOf<
      Readonly<PreparedCommitment>
    >()
    expectTypeOf<PrepareMutationJournalOptions['writeArtifact']>()
      .parameter(0)
      .toEqualTypeOf<ArtifactWriteContext>()
    expectTypeOf<
      PrepareMutationJournalOptions['writeArtifact']
    >().returns.toEqualTypeOf<ArtifactChecks>()
    expectTypeOf(verifyPreparedMutationProof).parameter(0).toEqualTypeOf<PreparedMutationProof>()
    expectTypeOf<Record<string, never>>().not.toMatchTypeOf<PreparedMutationProof>()
    expectTypeOf<Record<string, never>>().not.toMatchTypeOf<VerifiedPreparedMutationToken>()
    expectTypeOf<
      Record<string, never>
    >().not.toMatchTypeOf<VerifiedCommittedRecoveryEvidenceToken>()
    expectTypeOf<RecoveryJournalCommitment>().toEqualTypeOf<{
      'shikin.recovery.protocol': 'shikin.database-operation-recovery-journal'
      'shikin.recovery.version': 1
      'shikin.recovery.recordSha256': string
      'shikin.recovery.durability': 'linux-fsync-complete'
      'shikin.recovery.claimSequence': number
    }>()
    expectTypeOf<RecoveryJournalCommittedIntent['phase']>().toEqualTypeOf<
      'mutating' | 'abandoned'
    >()
    expectTypeOf(verifyCommittedRecoveryEvidence)
      .parameter(0)
      .toEqualTypeOf<VerifyCommittedRecoveryEvidenceOptions>()
    expectTypeOf(
      verifyCommittedRecoveryEvidence
    ).returns.toEqualTypeOf<VerifiedCommittedRecoveryEvidenceToken>()
    expectTypeOf(revalidateVerifiedCommittedRecoveryEvidenceToken)
      .parameter(0)
      .toEqualTypeOf<VerifiedCommittedRecoveryEvidenceToken>()
    expectTypeOf(revalidateVerifiedCommittedRecoveryEvidenceToken)
      .parameter(1)
      .toEqualTypeOf<VerifyCommittedRecoveryEvidenceOptions>()
    expectTypeOf(revalidateVerifiedCommittedRecoveryEvidenceToken).returns.toEqualTypeOf<
      Readonly<PreparedCommitment>
    >()
    expectTypeOf(releaseVerifiedCommittedRecoveryEvidenceToken)
      .parameter(0)
      .toEqualTypeOf<VerifiedCommittedRecoveryEvidenceToken>()
    expectTypeOf(verifyPreparedMutationProof)
      .parameter(1)
      .toEqualTypeOf<VerifyPreparedMutationProofOptions>()
    expectTypeOf(revalidateVerifiedPreparedMutationToken)
      .parameter(0)
      .toEqualTypeOf<VerifiedPreparedMutationToken>()
    expectTypeOf(releaseVerifiedPreparedMutationToken)
      .parameter(0)
      .toEqualTypeOf<VerifiedPreparedMutationToken>()
    expectTypeOf(consumeVerifiedPreparedMutationToken)
      .parameter(0)
      .toEqualTypeOf<VerifiedPreparedMutationToken>()
  })
})
