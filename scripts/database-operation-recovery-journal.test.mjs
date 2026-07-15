// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  cpSync,
  linkSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { afterEach, describe, expect, it } from 'vitest'
import {
  canonicalRecoveryJournalBytes,
  recoveryArtifactDigest,
  recoveryArtifactKey,
  recoveryOperationKey,
  recoveryRecordHash,
} from './database-operation-recovery-journal-canonical.mjs'
import {
  consumeVerifiedPreparedMutationToken,
  prepareMutationJournal,
  releaseVerifiedPreparedMutationToken,
  revalidateVerifiedPreparedMutationToken,
  setRecoveryJournalInterArtifactHashTestHookForTest,
  validatePreparedMutationEvidenceForTest,
  verifyPreparedMutationProof,
} from './database-operation-recovery-journal.mjs'
import { SHIKIN_SCHEMA_CONTRACT_IDENTITY } from './shikin-schema-contract-identity.mjs'

const DATABASE_IDENTITY = 'com.asf.shikin:shikin.db'
const IDENTITY_HASH = createHash('sha256').update(DATABASE_IDENTITY).digest('hex')
const golden = JSON.parse(
  readFileSync(resolve('schema/database-operation-recovery-journal-v1-golden.json'), 'utf8')
)
const schema = JSON.parse(
  readFileSync(resolve('schema/database-operation-recovery-journal-v1.json'), 'utf8')
)
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validateSchema = ajv.compile(schema)
const tempDirectories = []
let intentSequence = 0

const OK_CHECKS = Object.freeze({
  integrityCheck: 'ok',
  foreignKeyCheck: 'ok',
  schemaContractCheck: 'ok',
  sidecarCheck: 'ok',
})

const POSIX_DIRECTORY_FAULTS = [
  'after-artifacts-directory-fsync',
  'after-records-directory-fsync',
  'after-operation-directory-fsync',
  'after-operations-directory-fsync',
  'after-recovery-root-fsync',
  'after-operation-root-fsync',
]
const ALL_FAULTS = [
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
  ...POSIX_DIRECTORY_FAULTS,
]

const PRE_OPERATION_FAULTS = new Set([
  'after-recovery-root-create',
  'after-operations-directory-create',
])
afterEach(() => {
  delete process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
  setRecoveryJournalInterArtifactHashTestHookForTest(undefined)
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('recovery journal cross-platform contract', () => {
  it('strictly validates only the exact prepared mutation shape', () => {
    expect(validateSchema(golden.preparedMutation.record), JSON.stringify(validateSchema.errors)).toBe(
      true
    )
    expect(validateSchema({ ...golden.preparedMutation.record, unexpected: true })).toBe(false)
    const missing = structuredClone(golden.preparedMutation.record)
    delete missing.previousRecordSha256
    expect(validateSchema(missing)).toBe(false)
    expect(
      validateSchema({
        ...golden.preparedMutation.record,
        checks: {
          ...golden.preparedMutation.record.checks,
          candidate: {
            ...golden.preparedMutation.record.checks.candidate,
            extra: 'ok',
          },
        },
      })
    ).toBe(false)
  })

  it('pins UTF-8 key order, escaping, domains, hashes, and layout without rewriting vectors', () => {
    for (const vector of golden.canonicalizationVectors) {
      const bytes = canonicalRecoveryJournalBytes(vector.value)
      expect(bytes.toString('utf8')).toBe(vector.canonicalUtf8)
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(vector.ordinarySha256)
    }

    const prepared = golden.preparedMutation
    const canonicalRecord = canonicalRecoveryJournalBytes(prepared.record)
    const candidate = Buffer.from(prepared.artifactBase64.candidate, 'base64')
    const rollback = Buffer.from(prepared.artifactBase64.rollback, 'base64')
    expect(recoveryOperationKey(DATABASE_IDENTITY, prepared.operationId)).toBe(prepared.operationKey)
    expect(recoveryArtifactKey(prepared.operationKey, prepared.nonce, 'candidate')).toBe(
      prepared.artifactKeys.candidate
    )
    expect(recoveryArtifactKey(prepared.operationKey, prepared.nonce, 'rollback')).toBe(
      prepared.artifactKeys.rollback
    )
    expect(recoveryArtifactDigest('candidate', candidate)).toBe(
      prepared.record.candidate.contentDigest
    )
    expect(recoveryArtifactDigest('rollback', rollback)).toBe(
      prepared.record.rollback.contentDigest
    )
    expect(canonicalRecord.toString('utf8')).toBe(prepared.canonicalRecordUtf8)
    expect(recoveryRecordHash(canonicalRecord)).toBe(prepared.recordHash)
    expect(prepared.layout.candidatePath).toContain(
      `${prepared.operationKey}/${prepared.record.candidate.path}`
    )
    expect(prepared.layout.rollbackPath).toContain(
      `${prepared.operationKey}/${prepared.record.rollback.path}`
    )
    expect(prepared.layout.recordPath).toContain(
      `records/00000000000000000000-${prepared.recordHash}.json`
    )
  })

  it('rejects unsupported canonical values and lone surrogates', () => {
    for (const value of [-0, -1, 1.25, Number.NaN, undefined, new Date(), '\ud800', '\udc00']) {
      expect(() => canonicalRecoveryJournalBytes(value)).toThrow()
    }
    const cyclic = {}
    cyclic.self = cyclic
    expect(() => canonicalRecoveryJournalBytes(cyclic)).toThrow('cyclic')
    expect(() => canonicalRecoveryJournalBytes(Array(1))).toThrow('dense')
    const extraArray = [0]
    extraArray.extra = true
    expect(() => canonicalRecoveryJournalBytes(extraArray)).toThrow('index-only')
    expect(() => canonicalRecoveryJournalBytes({ [Symbol('key')]: true })).toThrow('strings')
  })

  it('matches shared metadata number semantics after JSON lexical parsing', () => {
    for (const vector of golden.metadataNumberVectors) {
      const metadata = { nested: [{ value: JSON.parse(vector.jsonSource) }] }
      const original = structuredClone(metadata)
      if (vector.accepted) {
        expect(canonicalRecoveryJournalBytes(metadata).toString('utf8'), vector.name).toBe(
          vector.canonicalMetadataUtf8
        )
      } else {
        expect(() => canonicalRecoveryJournalBytes(metadata), vector.name).toThrow()
        expect(vector.canonicalMetadataUtf8).toBeNull()
      }
      expect(metadata, vector.name).toEqual(original)
    }
  })

  it('uses Unicode code points for every bounded identifier', () => {
    for (const vector of golden.identifierLengthVectors) {
      expect([...vector.value]).toHaveLength(vector.codePoints)
      expect(Buffer.byteLength(vector.value, 'utf8')).toBe(vector.utf8Bytes)
      const record = structuredClone(golden.preparedMutation.record)
      record.operationId = vector.value
      record.owner.ownerId = vector.value
      record.owner.hostId = vector.value
      expect(validateSchema(record), JSON.stringify(validateSchema.errors)).toBe(vector.accepted)
    }
    expect(schema.$defs.identifier['x-shikin-length-unit']).toBe('Unicode code points')
    expect(schema.$defs.artifactSizeBytes.maximum).toBe(8 * 1024 * 1024 * 1024)
    const oversized = structuredClone(golden.preparedMutation.record)
    oversized.candidate.sizeBytes = 8 * 1024 * 1024 * 1024 + 1
    expect(validateSchema(oversized)).toBe(false)
  })

  it('requires positive safe fencing generations in schema and implementation', () => {
    expect(schema.$defs.positiveSafeInteger).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    })
    const zeroRecord = structuredClone(golden.preparedMutation.record)
    zeroRecord.fencingGeneration = 0
    expect(validateSchema(zeroRecord)).toBe(false)

    const operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: { ...makeIntent('restore'), fencingGeneration: 0 },
          writeArtifact: writeDefaultArtifact,
        }),
      'INVALID_RECOVERY_OPTIONS'
    )
  })

  it('schema rejects impossible dates and hour 24', () => {
    for (const timestamp of ['2026-02-30T12:00:00.000Z', '2026-07-14T24:00:00.000Z']) {
      const record = structuredClone(golden.preparedMutation.record)
      record.createdAt = timestamp
      expect(validateSchema(record)).toBe(false)
      record.createdAt = golden.preparedMutation.record.createdAt
      record.owner.processStartedAt = timestamp
      expect(validateSchema(record)).toBe(false)
    }
  })

  it.runIf(process.platform !== 'linux')(
    'fails closed without journal artifacts on unsupported platforms after input validation',
    () => {
      const operationRoot = createOperationRoot()
      let callbacks = 0
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 1,
            intent: makeIntent('restore'),
            writeArtifact() {
              callbacks += 1
              return { ...OK_CHECKS }
            },
          }),
        'RECOVERY_DURABILITY_FAILURE'
      )
      expect(callbacks).toBe(0)
      expect(() => lstatSync(join(operationRoot, 'recovery-journal-v1'))).toThrow()
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot: join(dirname(operationRoot), 'wrong-identity'),
            stateRevision: 1,
            intent: makeIntent('restore'),
            writeArtifact: writeDefaultArtifact,
          }),
        'INVALID_RECOVERY_OPTIONS'
      )
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: -1,
            intent: makeIntent('restore'),
            writeArtifact: writeDefaultArtifact,
          }),
        'INVALID_RECOVERY_OPTIONS'
      )
      expectError(
        () => verifyPreparedMutationProof({}, { operationRoot, stateRevision: 1, intent: makeIntent('restore') }),
        'PREPARED_PROOF_INVALID'
      )
    }
  )
})

describe.runIf(process.platform === 'linux')('Node prepared mutation journal', () => {
  it('publishes exact artifacts and one canonical LF-terminated record, then verifies an opaque proof', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const contexts = []
    const candidateBytes = Buffer.alloc(1024 * 1024 + 17, 0xa5)
    const rollbackBytes = Buffer.from('rollback\0bytes', 'utf8')

    const prepared = prepareMutationJournal({
      operationRoot,
      stateRevision: 41,
      intent,
      writeArtifact(context) {
        contexts.push(context)
        writeFileSync(context.path, context.role === 'candidate' ? candidateBytes : rollbackBytes)
        return { ...OK_CHECKS }
      },
    })

    expect(prepared.durability).toBe('linux-fsync-complete')
    expect(prepared.commitmentSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.isFrozen(prepared.proof)).toBe(true)
    expect(Reflect.ownKeys(prepared.proof)).toEqual([])
    expect(JSON.stringify(prepared.proof)).toBe('{}')
    expect(contexts.map(({ role }) => role)).toEqual(['candidate', 'rollback'])
    for (const context of contexts) {
      expect(Object.isFrozen(context)).toBe(true)
      expect(context.operationId).toBe(intent.operationId)
      expect(context.operation).toBe('restore')
      expect(context.schemaContractIdentity).toBe(SHIKIN_SCHEMA_CONTRACT_IDENTITY)
      expect(relative(operationRoot, context.path)).not.toContain('..')
    }

    const paths = preparedPaths(operationRoot, intent)
    expect(readdirSync(paths.operation).sort()).toEqual(['artifacts', 'records'])
    expect(readdirSync(paths.artifacts).sort()).toHaveLength(2)
    const recordNames = readdirSync(paths.records)
    expect(recordNames).toEqual([
      `00000000000000000000-${prepared.commitmentSha256}.json`,
    ])
    const recordBytes = readFileSync(join(paths.records, recordNames[0]))
    expect(recordBytes.subarray(-1).equals(Buffer.from('\n'))).toBe(true)
    expect(recordBytes.subarray(-2, -1).equals(Buffer.from('\n'))).toBe(false)
    const record = JSON.parse(recordBytes.subarray(0, -1).toString('utf8'))
    expect(validateSchema(record), JSON.stringify(validateSchema.errors)).toBe(true)
    expect(record).not.toHaveProperty('stateRevision')
    expect(record).not.toHaveProperty('updatedAt')
    expect(record).not.toHaveProperty('metadata')
    expect(record.createdAt).toBe(intent.createdAt)
    expect(record.schemaContract).toEqual(SHIKIN_SCHEMA_CONTRACT_IDENTITY)
    expect(record.candidate.contentDigest).toBe(recoveryArtifactDigest('candidate', candidateBytes))
    expect(record.rollback.contentDigest).toBe(recoveryArtifactDigest('rollback', rollbackBytes))
    expect(statSync(join(paths.records, recordNames[0])).mode & 0o777).toBe(0o400)
    for (const name of readdirSync(paths.artifacts)) {
      expect(statSync(join(paths.artifacts, name)).mode & 0o777).toBe(0o400)
    }
    const token = verifyPreparedMutationProof(prepared.proof, {
      operationRoot,
      stateRevision: 41,
      intent,
    })
    expect(Object.isFrozen(token)).toBe(true)
    expect(Reflect.ownKeys(token)).toEqual([])
    expect(
      revalidateVerifiedPreparedMutationToken(token, {
        operationRoot,
        stateRevision: 41,
        intent,
      })
    ).toEqual({
      commitmentSha256: prepared.commitmentSha256,
      durability: 'linux-fsync-complete',
    })
    releaseVerifiedPreparedMutationToken(token)
  })

  it('never parses, resumes, deletes, or mints proof from an existing operation directory', () => {
    for (const kind of ['partial', 'complete', 'malicious']) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('import')
      const paths = preparedPaths(operationRoot, intent)
      if (kind === 'complete') {
        prepareDefault(operationRoot, intent, 9)
        const recordPath = join(paths.records, readdirSync(paths.records)[0])
        chmodSync(recordPath, 0o600)
        writeFileSync(recordPath, 'malformed existing evidence')
        chmodSync(recordPath, 0o400)
      } else {
        mkdirSync(dirname(paths.operation), { recursive: true, mode: 0o700 })
        chmodSync(join(operationRoot, 'recovery-journal-v1'), 0o700)
        chmodSync(dirname(paths.operation), 0o700)
        if (kind === 'partial') {
          mkdirSync(paths.operation, { mode: 0o700 })
          mkdirSync(paths.artifacts, { mode: 0o700 })
        } else {
          const outside = join(dirname(operationRoot), `malicious-${randomUUID()}`)
          writeFileSync(outside, 'not a directory')
          symlinkSync(outside, paths.operation)
        }
      }
      const before = lstatSync(paths.operation, { bigint: true })
      let callbacks = 0
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 9,
            intent,
            writeArtifact() {
              callbacks += 1
              throw new Error('must not run')
            },
          }),
        'RECOVERY_PREPARATION_INCOMPLETE',
        kind
      )
      const after = lstatSync(paths.operation, { bigint: true })
      expect(callbacks, kind).toBe(0)
      expect(after.dev, kind).toBe(before.dev)
      expect(after.ino, kind).toBe(before.ino)
    }
  })

  it('rejects proof forgery, JSON round trips, binding changes, and replay after consumption', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 12)
    const options = { operationRoot, stateRevision: 12, intent }

    expectError(() => verifyPreparedMutationProof({}, options), 'PREPARED_PROOF_INVALID')
    expectError(
      () => verifyPreparedMutationProof(JSON.parse(JSON.stringify(prepared.proof)), options),
      'PREPARED_PROOF_INVALID'
    )
    expectError(
      () =>
        verifyPreparedMutationProof(prepared.proof, {
          ...options,
          stateRevision: 13,
        }),
      'PREPARED_PROOF_INVALID'
    )
    expectError(
      () =>
        verifyPreparedMutationProof(prepared.proof, {
          ...options,
          intent: { ...intent, updatedAt: '2026-07-14T12:00:03.000Z' },
        }),
      'PREPARED_PROOF_INVALID'
    )
    const token = verifyPreparedMutationProof(prepared.proof, options)
    expectError(
      () => verifyPreparedMutationProof(prepared.proof, options),
      'PREPARED_PROOF_ACTIVE'
    )
    releaseVerifiedPreparedMutationToken(token)
    releaseVerifiedPreparedMutationToken(token)
    const reusable = verifyPreparedMutationProof(prepared.proof, options)
    consumeVerifiedPreparedMutationToken(reusable)
    consumeVerifiedPreparedMutationToken(reusable)
    expectError(() => verifyPreparedMutationProof(prepared.proof, options), 'PREPARED_PROOF_USED')
    expect(() => releaseVerifiedPreparedMutationToken({})).not.toThrow()
    expect(() => consumeVerifiedPreparedMutationToken({})).not.toThrow()
  })

  it('retains exactly nine close-on-exec handles and releases or consumes them no-throw', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 15)
    const options = { operationRoot, stateRevision: 15, intent }

    const releasedToken = verifyPreparedMutationProof(prepared.proof, options)
    let retained = retainedFileDescriptors(operationRoot)
    expect(retained).toHaveLength(9)
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `const fs=require('node:fs');const root=process.argv[1];const inherited=fs.readdirSync('/proc/self/fd').flatMap((fd)=>{try{const target=fs.readlinkSync('/proc/self/fd/'+fd);return target.startsWith(root)?[target]:[]}catch{return []}});process.stdout.write(JSON.stringify(inherited))`,
        operationRoot,
      ],
      { encoding: 'utf8' }
    )
    expect(child.status, child.stderr).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual([])
    closeSync(retained[0])
    expect(() => releaseVerifiedPreparedMutationToken(releasedToken)).not.toThrow()
    expect(retainedFileDescriptors(operationRoot)).toEqual([])

    const consumedToken = verifyPreparedMutationProof(prepared.proof, options)
    retained = retainedFileDescriptors(operationRoot)
    expect(retained).toHaveLength(9)
    closeSync(retained[0])
    expect(() => consumeVerifiedPreparedMutationToken(consumedToken)).not.toThrow()
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
    expectError(() => verifyPreparedMutationProof(prepared.proof, options), 'PREPARED_PROOF_USED')
  })

  it('allows mutable shared-root metadata churn but rejects operation-specific layout changes', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 16)
    const options = { operationRoot, stateRevision: 16, intent }
    const token = verifyPreparedMutationProof(prepared.proof, options)

    const secondIntent = makeIntent('import')
    prepareDefault(operationRoot, secondIntent, 17)
    expect(revalidateVerifiedPreparedMutationToken(token, options)).toEqual({
      commitmentSha256: prepared.commitmentSha256,
      durability: 'linux-fsync-complete',
    })

    writeFileSync(join(preparedPaths(operationRoot, intent).operation, 'unexpected'), 'x')
    expectError(
      () => revalidateVerifiedPreparedMutationToken(token, options),
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    releaseVerifiedPreparedMutationToken(token)
  })

  it('requires exact synchronous callback checks and an exclusive restore/import binding', () => {
    for (const callback of [
      ({ path }) => {
        writeFileSync(path, 'artifact')
        return Promise.resolve({ ...OK_CHECKS })
      },
      ({ path }) => {
        writeFileSync(path, 'artifact')
        return { ...OK_CHECKS, extra: 'ok' }
      },
      ({ path }) => {
        writeFileSync(path, 'artifact')
        return { ...OK_CHECKS, sidecarCheck: 'failed' }
      },
      () => {
        throw new Error('callback failed')
      },
    ]) {
      const operationRoot = createOperationRoot()
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 1,
            intent: makeIntent('restore'),
            writeArtifact: callback,
          }),
        'RECOVERY_VALIDATION_FAILED'
      )
    }

    const operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: { ...makeIntent('restore'), phase: 'mutating' },
          writeArtifact: writeDefaultArtifact,
        }),
      'INVALID_RECOVERY_OPTIONS'
    )

    for (const createdAt of ['2026-02-30T12:00:00.000Z', '2026-07-14T24:00:00.000Z']) {
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 1,
            intent: { ...makeIntent('restore'), createdAt },
            writeArtifact: writeDefaultArtifact,
          }),
        'INVALID_RECOVERY_OPTIONS'
      )
    }
    for (const metadata of [[], { invalid: -1 }, { invalid: undefined }]) {
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 1,
            intent: { ...makeIntent('restore'), metadata },
            writeArtifact: writeDefaultArtifact,
          }),
        'INVALID_RECOVERY_OPTIONS'
      )
    }
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: { ...makeIntent('restore'), operationId: '😀'.repeat(129) },
          writeArtifact: writeDefaultArtifact,
        }),
      'INVALID_RECOVERY_OPTIONS'
    )
  })

  it('accepts 128 multibyte code points and rejects invalid Unicode or 129 code points', () => {
    const accepted = '😀'.repeat(128)
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    intent.operationId = accepted
    intent.owner.ownerId = accepted
    intent.owner.hostId = accepted
    expect(prepareDefault(operationRoot, intent, 1).commitmentSha256).toMatch(/^[0-9a-f]{64}$/)

    for (const field of ['operationId', 'ownerId', 'hostId']) {
      const rejectedRoot = createOperationRoot()
      const rejected = makeIntent('restore')
      if (field === 'operationId') rejected.operationId = '😀'.repeat(129)
      else rejected.owner[field] = field === 'ownerId' ? '\ud800' : '😀'.repeat(129)
      expectError(
        () => prepareDefault(rejectedRoot, rejected, 1),
        'INVALID_RECOVERY_OPTIONS',
        field
      )
    }
  })

  it('does not accept caller path components, noncanonical roots, or the wrong identity root', () => {
    const operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact: writeDefaultArtifact,
          pathComponent: 'caller-controlled',
        }),
      'INVALID_RECOVERY_OPTIONS'
    )
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot: relative(process.cwd(), operationRoot),
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact: writeDefaultArtifact,
        }),
      'INVALID_RECOVERY_OPTIONS'
    )

    const parent = createTempDirectory()
    const wrongRoot = join(realpathSync(parent), 'not-the-identity')
    mkdirSync(wrongRoot, { mode: 0o700 })
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot: wrongRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact: writeDefaultArtifact,
        }),
      'INVALID_RECOVERY_OPTIONS'
    )
  })

  it('detects callback replacement, hardlinks, sidecars, unexpected entries, and unsafe privacy', () => {
    let operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact({ path }) {
            unlinkSync(path)
            writeFileSync(path, 'replacement')
            return { ...OK_CHECKS }
          },
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )

    operationRoot = createOperationRoot()
    const outsideLink = join(dirname(operationRoot), `hardlink-${randomUUID()}`)
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact({ path }) {
            writeFileSync(path, 'linked')
            linkSync(path, outsideLink)
            return { ...OK_CHECKS }
          },
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )

    operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact({ role, path }) {
            writeFileSync(path, role)
            if (role === 'candidate') writeFileSync(`${path}-wal`, 'sidecar')
            return { ...OK_CHECKS }
          },
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )

    operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact({ role, path }) {
            writeFileSync(path, role)
            if (role === 'candidate') writeFileSync(join(dirname(dirname(path)), 'unexpected'), 'x')
            return { ...OK_CHECKS }
          },
        }),
      'RECOVERY_JOURNAL_CORRUPTION'
    )

    if (process.platform !== 'win32') {
      operationRoot = createOperationRoot()
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot,
            stateRevision: 1,
            intent: makeIntent('restore'),
            writeArtifact({ path }) {
              writeFileSync(path, 'public')
              chmodSync(path, 0o644)
              return { ...OK_CHECKS }
            },
          }),
        'RECOVERY_ARTIFACT_CORRUPTION'
      )
    }
  })

  it('rejects symlinked roots and post-publication symlink or hardlink tampering', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 1)
    const paths = preparedPaths(operationRoot, intent)
    const candidate = join(
      paths.artifacts,
      readdirSync(paths.artifacts).find((name) => name.startsWith('candidate-'))
    )
    const outside = join(dirname(operationRoot), `outside-${randomUUID()}`)
    copyFileSync(candidate, outside)
    unlinkSync(candidate)
    try {
      symlinkSync(outside, candidate, 'file')
      expectError(
        () =>
          verifyPreparedMutationProof(prepared.proof, {
            operationRoot,
            stateRevision: 1,
            intent,
          }),
        'RECOVERY_ARTIFACT_CORRUPTION'
      )
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
    }

    const secondRoot = createOperationRoot()
    const secondIntent = makeIntent('restore')
    const second = prepareDefault(secondRoot, secondIntent, 2)
    const secondPaths = preparedPaths(secondRoot, secondIntent)
    const rollback = join(
      secondPaths.artifacts,
      readdirSync(secondPaths.artifacts).find((name) => name.startsWith('rollback-'))
    )
    linkSync(rollback, join(dirname(secondRoot), `outside-link-${randomUUID()}`))
    expectError(
      () =>
        verifyPreparedMutationProof(second.proof, {
          operationRoot: secondRoot,
          stateRevision: 2,
          intent: secondIntent,
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )

    const targetRoot = createOperationRoot()
    const alias = join(dirname(targetRoot), `root-alias-${randomUUID()}`)
    try {
      symlinkSync(targetRoot, alias, process.platform === 'win32' ? 'junction' : 'dir')
      expectError(
        () =>
          prepareMutationJournal({
            operationRoot: alias,
            stateRevision: 1,
            intent: makeIntent('restore'),
            writeArtifact: writeDefaultArtifact,
          }),
        'INVALID_RECOVERY_OPTIONS'
      )
    } catch (error) {
      if (process.platform !== 'win32' || error?.code !== 'EPERM') throw error
    }
  })

  it('detects artifact tampering and strict record hash, size, nonce, checks, and schema drift', () => {
    for (const testCase of [
      {
        name: 'nonce',
        mutate: (record) => {
          record.nonce = `G${record.nonce.slice(1)}`
        },
        code: 'RECOVERY_JOURNAL_CORRUPTION',
      },
      {
        name: 'checks',
        mutate: (record) => {
          record.checks.candidate.extra = 'ok'
        },
        code: 'RECOVERY_JOURNAL_CORRUPTION',
      },
      {
        name: 'schema digest',
        mutate: (record) => {
          record.schemaContract.rawBytesSha256 = `sha256:${'0'.repeat(64)}`
        },
        code: 'RECOVERY_JOURNAL_CORRUPTION',
      },
      {
        name: 'size',
        mutate: (record) => {
          record.candidate.sizeBytes += 1
        },
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
      },
      {
        name: 'digest',
        mutate: (record) => {
          record.rollback.contentDigest = `sha256:${'1'.repeat(64)}`
        },
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
      },
    ]) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 4)
      rewriteRecord(operationRoot, intent, testCase.mutate)
      expectError(
        () =>
          verifyPreparedMutationProof(prepared.proof, {
            operationRoot,
            stateRevision: 4,
            intent,
          }),
        testCase.code,
        testCase.name
      )
    }

    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 5)
    const paths = preparedPaths(operationRoot, intent)
    const candidate = join(
      paths.artifacts,
      readdirSync(paths.artifacts).find((name) => name.startsWith('candidate-'))
    )
    chmodSync(candidate, 0o600)
    writeFileSync(candidate, 'tampered')
    chmodSync(candidate, 0o400)
    expectError(
      () =>
        verifyPreparedMutationProof(prepared.proof, {
          operationRoot,
          stateRevision: 5,
          intent,
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
  })

  it('proof rereads reject partial, CRLF, hash-mismatched, and noncanonical records', () => {
    const cases = [
      {
        name: 'partial',
        mutate(recordPath) {
          chmodSync(recordPath, 0o600)
          truncateSync(recordPath, 0)
          chmodSync(recordPath, 0o400)
        },
      },
      {
        name: 'CRLF',
        mutate(recordPath) {
          const bytes = readFileSync(recordPath)
          chmodSync(recordPath, 0o600)
          writeFileSync(recordPath, Buffer.concat([bytes.subarray(0, -1), Buffer.from('\r\n')]))
          chmodSync(recordPath, 0o400)
        },
      },
      {
        name: 'hash mismatch',
        mutate(recordPath) {
          const bytes = readFileSync(recordPath)
          bytes[10] ^= 1
          chmodSync(recordPath, 0o600)
          writeFileSync(recordPath, bytes)
          chmodSync(recordPath, 0o400)
        },
      },
      {
        name: 'noncanonical',
        mutate(_recordPath, operationRoot, intent) {
          rewriteRecord(operationRoot, intent, () => {}, false)
        },
      },
    ]
    for (const [index, testCase] of cases.entries()) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, index + 1)
      const paths = preparedPaths(operationRoot, intent)
      const recordPath = join(paths.records, readdirSync(paths.records)[0])
      testCase.mutate(recordPath, operationRoot, intent)
      expectError(
        () =>
          verifyPreparedMutationProof(prepared.proof, {
            operationRoot,
            stateRevision: index + 1,
            intent,
          }),
        'RECOVERY_JOURNAL_CORRUPTION',
        testCase.name
      )
      expectError(
        () => prepareDefault(operationRoot, intent, index + 1),
        'RECOVERY_PREPARATION_INCOMPLETE',
        `${testCase.name} preparation`
      )
    }
  })

  it('validates shared static disk evidence without minting and ignores proof-only fields', () => {
    const operationRoot = createOperationRoot()
    cpSync(
      join(resolve(golden.onDiskEvidenceFixture.root), 'recovery-journal-v1'),
      join(operationRoot, 'recovery-journal-v1'),
      { recursive: true }
    )
    sealFixtureTree(join(operationRoot, 'recovery-journal-v1'))
    const record = golden.preparedMutation.record
    const intent = {
      recordKind: 'exclusive_intent',
      operationId: record.operationId,
      operation: record.operation,
      phase: 'exclusive',
      owner: structuredClone(record.owner),
      fencingGeneration: record.fencingGeneration,
      createdAt: record.createdAt,
      updatedAt: '2031-08-15T13:14:15.000Z',
      metadata: { proofOnly: ['different', 7] },
    }
    const first = validatePreparedMutationEvidenceForTest({
      operationRoot,
      stateRevision: 999,
      intent,
    })
    const second = validatePreparedMutationEvidenceForTest({
      operationRoot,
      stateRevision: 1000,
      intent: {
        ...intent,
        updatedAt: '2032-09-16T14:15:16.000Z',
        metadata: { another: true },
      },
    })
    expect(first).toEqual({
      commitmentSha256: golden.onDiskEvidenceFixture.recordHash,
      durability: 'linux-fsync-complete',
    })
    expect(second).toEqual(first)
    expect(first).not.toHaveProperty('proof')
    expectError(
      () => prepareDefault(operationRoot, intent, 999),
      'RECOVERY_PREPARATION_INCOMPLETE'
    )
  })

  it('rejects over-cap sparse artifacts before hashing on initial write and reread', () => {
    let operationRoot = createOperationRoot()
    expectError(
      () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 1,
          intent: makeIntent('restore'),
          writeArtifact({ path }) {
            truncateSync(path, 8 * 1024 * 1024 * 1024 + 1)
            return { ...OK_CHECKS }
          },
        }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )

    operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 2)
    const paths = preparedPaths(operationRoot, intent)
    const candidate = join(
      paths.artifacts,
      readdirSync(paths.artifacts).find((name) => name.startsWith('candidate-'))
    )
    chmodSync(candidate, 0o600)
    truncateSync(candidate, 8 * 1024 * 1024 * 1024 + 1)
    chmodSync(candidate, 0o400)
    expectError(
      () => verifyPreparedMutationProof(prepared.proof, { operationRoot, stateRevision: 2, intent }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
  })

  it('retains both handles and rejects a sibling-window write even when bytes are restored', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 3)
    setRecoveryJournalInterArtifactHashTestHookForTest((artifacts) => {
      const candidate = artifacts.find(({ role }) => role === 'candidate').path
      const original = readFileSync(candidate)
      chmodSync(candidate, 0o600)
      writeFileSync(candidate, original)
      chmodSync(candidate, 0o400)
    })
    expectError(
      () => verifyPreparedMutationProof(prepared.proof, { operationRoot, stateRevision: 3, intent }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
  })

  it('uses retained evidence for bounded no-hash revalidation before consumption', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 4)
    const options = { operationRoot, stateRevision: 4, intent }
    const token = verifyPreparedMutationProof(prepared.proof, options)
    const paths = preparedPaths(operationRoot, intent)
    const rollback = join(
      paths.artifacts,
      readdirSync(paths.artifacts).find((name) => name.startsWith('rollback-'))
    )
    chmodSync(rollback, 0o600)
    writeFileSync(rollback, 'changed before proof consumption')
    chmodSync(rollback, 0o400)
    expectError(
      () => revalidateVerifiedPreparedMutationToken(token, options),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
    releaseVerifiedPreparedMutationToken(token)
  })

  it('fails closed on insecure existing journal directories', () => {
    if (process.platform === 'win32') return
    const operationRoot = createOperationRoot()
    const recoveryRoot = join(operationRoot, 'recovery-journal-v1')
    mkdirSync(recoveryRoot, { mode: 0o755 })
    expectError(
      () => prepareDefault(operationRoot, makeIntent('restore'), 1),
      'RECOVERY_JOURNAL_CORRUPTION'
    )
  })
})

describe.runIf(process.platform === 'linux')('fault injection and restart disposition', () => {
  it('throws only after real operations and applies the required retry disposition at every point', () => {
    const applicableFaults =
      process.platform === 'win32'
        ? ALL_FAULTS.filter((fault) => !POSIX_DIRECTORY_FAULTS.includes(fault))
        : ALL_FAULTS
    for (const fault of applicableFaults) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const child = spawnSync(
        process.execPath,
        [
          resolve('scripts/database-operation-recovery-journal.worker.mjs'),
          operationRoot,
          '7',
          JSON.stringify(intent),
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            NODE_ENV: 'test',
            SHIKIN_RECOVERY_JOURNAL_TEST_FAULT: fault,
          },
        }
      )
      expect(child.error, fault).toBeUndefined()
      expect(child.status, `${fault}: ${child.stderr}`).toBe(0)
      expect(child.stdout.trim(), fault).toBe('ERROR:RECOVERY_TEST_FAULT')

      let callbacks = 0
      const retry = () =>
        prepareMutationJournal({
          operationRoot,
          stateRevision: 7,
          intent,
          writeArtifact(context) {
            callbacks += 1
            return writeDefaultArtifact(context)
          },
        })
      if (PRE_OPERATION_FAULTS.has(fault)) {
        expect(retry().commitmentSha256, fault).toMatch(/^[0-9a-f]{64}$/)
        expect(callbacks, fault).toBe(2)
      } else {
        expectError(retry, 'RECOVERY_PREPARATION_INCOMPLETE', fault)
        expect(callbacks, fault).toBe(0)
      }
    }
  })

  it('ignores the test fault variable outside NODE_ENV=test and rejects unknown test points', () => {
    const previousNodeEnv = process.env.NODE_ENV
    const previousFault = process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
    try {
      process.env.NODE_ENV = 'production'
      process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT = 'after-operation-directory-create'
      const operationRoot = createOperationRoot()
      expect(prepareDefault(operationRoot, makeIntent('restore'), 1).commitmentSha256).toMatch(
        /^[0-9a-f]{64}$/
      )

      process.env.NODE_ENV = 'test'
      process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT = 'not-allowlisted'
      expectError(
        () => prepareDefault(createOperationRoot(), makeIntent('restore'), 1),
        'INVALID_RECOVERY_OPTIONS'
      )
    } finally {
      process.env.NODE_ENV = previousNodeEnv
      if (previousFault === undefined) delete process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
      else process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT = previousFault
    }
  })
})

function createTempDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'shikin-recovery-journal-'))
  tempDirectories.push(directory)
  return directory
}

function createOperationRoot() {
  const directory = createTempDirectory()
  const canonicalParent = realpathSync(directory)
  const operationRoot = join(canonicalParent, IDENTITY_HASH)
  mkdirSync(operationRoot, { mode: 0o700 })
  if (process.platform !== 'win32') chmodSync(operationRoot, 0o700)
  return realpathSync(operationRoot)
}

function makeIntent(operation) {
  intentSequence += 1
  return {
    recordKind: 'exclusive_intent',
    operationId: `operation-${intentSequence}-${randomUUID()}`,
    operation,
    phase: 'exclusive',
    owner: {
      ownerId: `owner-${randomUUID()}`,
      runtimeId: 'cli',
      hostId: `host-${randomUUID()}`,
      processId: 4242,
      processStartedAt: '2026-07-14T12:00:00.000Z',
    },
    fencingGeneration: intentSequence,
    createdAt: '2026-07-14T12:00:01.000Z',
    updatedAt: '2026-07-14T12:00:02.000Z',
  }
}

function writeDefaultArtifact({ role, path }) {
  writeFileSync(path, Buffer.from(`${role}\0artifact`, 'utf8'))
  return { ...OK_CHECKS }
}

function prepareDefault(operationRoot, intent, stateRevision) {
  return prepareMutationJournal({
    operationRoot,
    stateRevision,
    intent,
    writeArtifact: writeDefaultArtifact,
  })
}

function preparedPaths(operationRoot, intent) {
  const operationKey = recoveryOperationKey(DATABASE_IDENTITY, intent.operationId)
  const operation = join(operationRoot, 'recovery-journal-v1', 'operations', operationKey)
  return {
    operation,
    artifacts: join(operation, 'artifacts'),
    records: join(operation, 'records'),
  }
}

function retainedFileDescriptors(operationRoot) {
  return readdirSync('/proc/self/fd')
    .map(Number)
    .filter((descriptor) => {
      try {
        return readlinkSync(`/proc/self/fd/${descriptor}`).startsWith(operationRoot)
      } catch {
        return false
      }
    })
}

function sealFixtureTree(path) {
  const stat = lstatSync(path)
  if (stat.isDirectory()) {
    chmodSync(path, 0o700)
    for (const entry of readdirSync(path)) sealFixtureTree(join(path, entry))
  } else {
    chmodSync(path, 0o400)
  }
}

function rewriteRecord(operationRoot, intent, mutate, canonical = true) {
  const paths = preparedPaths(operationRoot, intent)
  const oldName = readdirSync(paths.records)[0]
  const oldPath = join(paths.records, oldName)
  const record = JSON.parse(readFileSync(oldPath, 'utf8'))
  mutate(record)
  const body = canonical
    ? canonicalRecoveryJournalBytes(record)
    : Buffer.from(JSON.stringify(record, null, 2), 'utf8')
  const hash = recoveryRecordHash(body)
  const replacement = join(paths.records, `replacement-${randomUUID()}`)
  writeFileSync(replacement, Buffer.concat([body, Buffer.from('\n')]), { mode: 0o600 })
  unlinkSync(oldPath)
  const finalPath = join(paths.records, `00000000000000000000-${hash}.json`)
  renameSync(replacement, finalPath)
  chmodSync(finalPath, 0o400)
}

function expectError(action, code, label = '') {
  try {
    action()
  } catch (error) {
    expect(error?.code, label).toBe(code)
    return error
  }
  throw new Error(`Expected ${code}${label ? ` for ${label}` : ''}`)
}
