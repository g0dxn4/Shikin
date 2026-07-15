// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  RecoveryJournalError,
  markPreparedMutationProofUsed,
  prepareMutationJournal,
  verifyPreparedMutationProof,
} from '../../scripts/database-operation-recovery-journal.mjs'
import type {
  ArtifactChecks,
  ArtifactWriteContext,
  PrepareMutationJournalOptions,
  PreparedMutationJournal,
  PreparedMutationProof,
  RecoveryJournalDurability,
  RecoveryJournalExclusiveIntent,
  VerifyPreparedMutationProofOptions,
} from '../../scripts/database-operation-recovery-journal.mjs'

describe('recovery journal declarations', () => {
  it('are importable by the CLI TypeScript project without filesystem side effects', () => {
    expect(prepareMutationJournal).toBeTypeOf('function')
    expect(verifyPreparedMutationProof).toBeTypeOf('function')
    expect(markPreparedMutationProofUsed).toBeTypeOf('function')
    expect(new RecoveryJournalError('TEST', 'test').code).toBe('TEST')

    expectTypeOf(prepareMutationJournal).returns.toMatchTypeOf<PreparedMutationJournal>()
    expectTypeOf<RecoveryJournalDurability>().toEqualTypeOf<'linux-fsync-complete'>()
    expectTypeOf<PreparedMutationJournal['durability']>().toEqualTypeOf<RecoveryJournalDurability>()
    expectTypeOf<RecoveryJournalExclusiveIntent['createdAt']>().toEqualTypeOf<string>()
    expectTypeOf<RecoveryJournalExclusiveIntent['updatedAt']>().toEqualTypeOf<string>()
    expectTypeOf<RecoveryJournalExclusiveIntent['metadata']>().toEqualTypeOf<
      Record<string, unknown> | undefined
    >()
    expectTypeOf(verifyPreparedMutationProof).returns.toEqualTypeOf<string>()
    expectTypeOf<PrepareMutationJournalOptions['writeArtifact']>()
      .parameter(0)
      .toEqualTypeOf<ArtifactWriteContext>()
    expectTypeOf<
      PrepareMutationJournalOptions['writeArtifact']
    >().returns.toEqualTypeOf<ArtifactChecks>()
    expectTypeOf(verifyPreparedMutationProof).parameter(0).toEqualTypeOf<PreparedMutationProof>()
    expectTypeOf(verifyPreparedMutationProof)
      .parameter(1)
      .toEqualTypeOf<VerifyPreparedMutationProofOptions>()
  })
})
