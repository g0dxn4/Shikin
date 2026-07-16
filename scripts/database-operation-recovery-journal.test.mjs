// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import fs, {
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
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
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
  RECOVERY_JOURNAL_SCANNER_FAULTS_FOR_TEST,
  RecoveryJournalError,
  consumeVerifiedPreparedMutationToken,
  prepareMutationJournal,
  releaseVerifiedCommittedRecoveryEvidenceToken,
  releaseVerifiedPreparedMutationToken,
  revalidateVerifiedCommittedRecoveryEvidenceToken,
  revalidateVerifiedPreparedMutationToken,
  setRecoveryJournalInterArtifactHashTestHookForTest,
  setRecoveryJournalScannerFaultForTest,
  validatePreparedMutationEvidenceForTest,
  verifyCommittedRecoveryEvidence,
  verifyPreparedMutationProof,
} from './database-operation-recovery-journal.mjs'
import { SHIKIN_SCHEMA_CONTRACT_IDENTITY } from './shikin-schema-contract-identity.mjs'

const DATABASE_IDENTITY = 'com.asf.shikin:shikin.db'
const NODE_18_20_8_VERSION = 'v18.20.8'
const NODE_18_PROVISION_TIMEOUT_MS = 120_000
const NODE_VERSION_TIMEOUT_MS = 10_000
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

function nodeSubprocessEnvironment(overrides = {}) {
  const environment = { ...process.env, ...overrides }
  delete environment.NODE_OPTIONS
  return environment
}

function subprocessDiagnostics(result) {
  return [
    `status=${String(result.status)}`,
    `signal=${String(result.signal)}`,
    `error=${result.error?.stack ?? 'none'}`,
    `stdout=${JSON.stringify(result.stdout ?? '')}`,
    `stderr=${JSON.stringify(result.stderr ?? '')}`,
  ].join('\n')
}

function resolveRequiredNode18Binary() {
  let binary
  let source
  let provision

  if (process.env.SHIKIN_NODE18_BINARY !== undefined) {
    binary = process.env.SHIKIN_NODE18_BINARY
    source = 'SHIKIN_NODE18_BINARY'
  } else if (process.version === NODE_18_20_8_VERSION) {
    binary = process.execPath
    source = 'current process.execPath'
  } else {
    const pnpmCli = process.env.npm_execpath
    const command = pnpmCli === undefined ? 'pnpm' : process.execPath
    const args = [
      ...(pnpmCli === undefined ? [] : [pnpmCli]),
      '--silent',
      'dlx',
      'node@18.20.8',
      '-p',
      'process.execPath',
    ]
    provision = spawnSync(command, args, {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: nodeSubprocessEnvironment(),
      timeout: NODE_18_PROVISION_TIMEOUT_MS,
    })
    if (provision.error !== undefined || provision.status !== 0) {
      throw new Error(
        `Unable to provision required ${NODE_18_20_8_VERSION} with pnpm.\n${subprocessDiagnostics(provision)}`
      )
    }
    binary = provision.stdout.trim()
    source = 'pnpm dlx node@18.20.8'
    if (binary.length === 0) {
      throw new Error(
        `pnpm did not report the required Node executable.\n${subprocessDiagnostics(provision)}`
      )
    }
  }

  const version = spawnSync(binary, ['--version'], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: nodeSubprocessEnvironment(),
    timeout: NODE_VERSION_TIMEOUT_MS,
  })
  if (
    version.error !== undefined ||
    version.status !== 0 ||
    version.stdout.trim() !== NODE_18_20_8_VERSION
  ) {
    const provisionDetails =
      provision === undefined ? '' : `\nProvision diagnostics:\n${subprocessDiagnostics(provision)}`
    throw new Error(
      `${source} did not resolve to exact ${NODE_18_20_8_VERSION}.\nVersion diagnostics:\n${subprocessDiagnostics(version)}${provisionDetails}`
    )
  }

  return binary
}

afterEach(() => {
  delete process.env.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
  setRecoveryJournalInterArtifactHashTestHookForTest(undefined)
  setRecoveryJournalScannerFaultForTest(undefined)
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('recovery journal cross-platform contract', () => {
  it('strictly validates only the exact prepared mutation shape', () => {
    expect(
      validateSchema(golden.preparedMutation.record),
      JSON.stringify(validateSchema.errors)
    ).toBe(true)
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
    expect(recoveryOperationKey(DATABASE_IDENTITY, prepared.operationId)).toBe(
      prepared.operationKey
    )
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
        () =>
          verifyPreparedMutationProof(
            {},
            { operationRoot, stateRevision: 1, intent: makeIntent('restore') }
          ),
        'PREPARED_PROOF_INVALID'
      )
    }
  )
})

describe('Node prepared mutation journal', () => {
  // prettier-ignore
  it.runIf(process.platform === 'linux')('publishes exact artifacts and one canonical LF-terminated record, then verifies an opaque proof', () => {
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
      expect(recordNames).toEqual([`00000000000000000000-${prepared.commitmentSha256}.json`])
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
      expect(record.candidate.contentDigest).toBe(
        recoveryArtifactDigest('candidate', candidateBytes)
      )
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('never parses, resumes, deletes, or mints proof from an existing operation directory', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects proof forgery, JSON round trips, binding changes, and replay after consumption', () => {
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
          operationRoot: createOperationRoot(),
        }),
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
    expectError(
      () =>
        verifyPreparedMutationProof(prepared.proof, {
          ...options,
          intent: { ...intent, metadata: { changed: true } },
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('retains exactly nine close-on-exec handles and releases or consumes them no-throw', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('allows mutable shared-root metadata churn but rejects operation-specific layout changes', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('does not enumerate or inspect unrelated operation siblings during preparation', () => {
      const operationRoot = createOperationRoot()
      const firstIntent = makeIntent('restore')
      prepareDefault(operationRoot, firstIntent, 16)
      const operationsRoot = join(operationRoot, 'recovery-journal-v1', 'operations')
      const malformedSibling = join(operationsRoot, 'malformed-unrelated-sibling')
      writeFileSync(malformedSibling, 'not an operation directory')

      const secondIntent = makeIntent('import')
      const prepared = prepareDefault(operationRoot, secondIntent, 17)
      expect(prepared).toMatchObject({
        commitmentSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        durability: 'linux-fsync-complete',
  })
      expect(readFileSync(malformedSibling, 'utf8')).toBe('not an operation directory')
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('revalidates all retained root identities and immutable evidence', () => {
    const attacks = [
        {
          name: 'operation root replacement',
          code: 'RECOVERY_JOURNAL_CORRUPTION',
          apply({ operationRoot }) {
            const old = join(dirname(operationRoot), `old-operation-root-${randomUUID()}`)
            renameSync(operationRoot, old)
            cpSync(old, operationRoot, { recursive: true })
            sealFixtureTree(operationRoot)
          },
        },
        {
          name: 'recovery root replacement',
          code: 'RECOVERY_JOURNAL_CORRUPTION',
          apply({ operationRoot }) {
            const recoveryRoot = join(operationRoot, 'recovery-journal-v1')
            const old = join(operationRoot, `old-recovery-root-${randomUUID()}`)
            renameSync(recoveryRoot, old)
            cpSync(old, recoveryRoot, { recursive: true })
            sealFixtureTree(recoveryRoot)
          },
        },
        {
          name: 'operations root replacement',
          code: 'RECOVERY_JOURNAL_CORRUPTION',
          apply({ operationRoot }) {
            const operationsRoot = join(operationRoot, 'recovery-journal-v1', 'operations')
            const old = join(operationRoot, `old-operations-root-${randomUUID()}`)
            renameSync(operationsRoot, old)
            cpSync(old, operationsRoot, { recursive: true })
            sealFixtureTree(operationsRoot)
          },
        },
      {
        name: 'artifact file replacement',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ operationRoot, paths }) {
          const artifact = join(paths.artifacts, readdirSync(paths.artifacts)[0])
          const replacement = join(operationRoot, `replacement-${randomUUID()}`)
          copyFileSync(artifact, replacement)
          chmodSync(replacement, 0o400)
          renameSync(replacement, artifact)
        },
      },
      {
        name: 'artifact directory replacement',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ operationRoot, paths }) {
          const old = join(operationRoot, `old-artifacts-${randomUUID()}`)
          renameSync(paths.artifacts, old)
          cpSync(old, paths.artifacts, { recursive: true })
          sealFixtureTree(paths.artifacts)
        },
      },
      {
        name: 'operation directory replacement',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ operationRoot, paths }) {
          const old = join(operationRoot, `old-operation-${randomUUID()}`)
          renameSync(paths.operation, old)
          cpSync(old, paths.operation, { recursive: true })
          sealFixtureTree(paths.operation)
        },
      },
      {
        name: 'same-size rewrite with restored mtime',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply({ paths }) {
          const artifact = join(paths.artifacts, readdirSync(paths.artifacts)[0])
          const stat = lstatSync(artifact, { bigint: true })
          const bytes = readFileSync(artifact)
          chmodSync(artifact, 0o600)
          writeFileSync(artifact, bytes)
          chmodSync(artifact, 0o400)
          utimesSync(
            artifact,
            Number(stat.atimeNs) / 1_000_000_000,
            Number(stat.mtimeNs) / 1_000_000_000
          )
        },
      },
      {
        name: 'mode flip and restore',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply({ paths }) {
          const artifact = join(paths.artifacts, readdirSync(paths.artifacts)[0])
          chmodSync(artifact, 0o600)
          chmodSync(artifact, 0o400)
        },
      },
      {
        name: 'hard-link count change',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply({ operationRoot, paths }) {
          const artifact = join(paths.artifacts, readdirSync(paths.artifacts)[0])
          linkSync(artifact, join(operationRoot, `outside-hardlink-${randomUUID()}`))
        },
      },
      {
        name: 'artifact sidecar',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ paths }) {
          writeFileSync(join(paths.artifacts, 'candidate.sqlite-wal'), 'sidecar')
        },
      },
      {
        name: 'extra record',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ paths }) {
          const extra = join(paths.records, `extra-${randomUUID()}`)
          writeFileSync(extra, 'extra')
          chmodSync(extra, 0o400)
        },
      },
      {
        name: 'extra operation entry',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ paths }) {
          writeFileSync(join(paths.operation, 'unexpected-entry'), 'extra')
        },
      },
      {
        name: 'extra recovery-root entry',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ paths }) {
          const recoveryRoot = dirname(dirname(paths.operation))
          writeFileSync(join(recoveryRoot, 'unexpected-entry'), 'extra')
        },
      },
    ]

    for (const attack of attacks) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 18)
      const options = { operationRoot, stateRevision: 18, intent }
      const token = verifyPreparedMutationProof(prepared.proof, options)
      try {
        attack.apply({ operationRoot, paths: preparedPaths(operationRoot, intent) })
        expectError(
          () => revalidateVerifiedPreparedMutationToken(token, options),
          attack.code,
          attack.name
        )
      } finally {
        releaseVerifiedPreparedMutationToken(token)
      }
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('closes every retained handle when full verification fails before token issuance', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 19)
    const options = { operationRoot, stateRevision: 19, intent }
    setRecoveryJournalInterArtifactHashTestHookForTest(() => {
      throw new Error('injected inter-hash failure')
    })
    expect(() => verifyPreparedMutationProof(prepared.proof, options)).toThrow(
      'injected inter-hash failure'
    )
    setRecoveryJournalInterArtifactHashTestHookForTest(undefined)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
    const token = verifyPreparedMutationProof(prepared.proof, options)
    releaseVerifiedPreparedMutationToken(token)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('requires exact synchronous callback checks and an exclusive restore/import binding', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('accepts 128 multibyte code points and rejects invalid Unicode or 129 code points', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('does not accept caller path components, noncanonical roots, or the wrong identity root', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('detects callback replacement, hardlinks, sidecars, unexpected entries, and unsafe privacy', () => {
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
              if (role === 'candidate')
                writeFileSync(join(dirname(dirname(path)), 'unexpected'), 'x')
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects symlinked roots and post-publication symlink or hardlink tampering', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('detects artifact tampering and strict record hash, size, nonce, checks, and schema drift', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('proof rereads reject partial, CRLF, hash-mismatched, and noncanonical records', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('validates shared static disk evidence without minting and ignores proof-only fields', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects over-cap sparse artifacts before hashing on initial write and reread', () => {
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
        () =>
          verifyPreparedMutationProof(prepared.proof, { operationRoot, stateRevision: 2, intent }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('retains both handles and rejects a sibling-window write even when bytes are restored', () => {
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
        () =>
          verifyPreparedMutationProof(prepared.proof, { operationRoot, stateRevision: 3, intent }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('uses retained evidence for bounded no-hash revalidation before consumption', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('fails closed on insecure existing journal directories', () => {
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

describe('Node committed recovery evidence verifier', () => {
  // prettier-ignore
  it.runIf(process.platform === 'linux')('verifies the exact shared static fixture without minting or resuming a prepared proof', () => {
    const operationRoot = createOperationRoot()
    cpSync(
      join(resolve(golden.onDiskEvidenceFixture.root), 'recovery-journal-v1'),
      join(operationRoot, 'recovery-journal-v1'),
      { recursive: true }
    )
    sealFixtureTree(join(operationRoot, 'recovery-journal-v1'))
    const record = golden.preparedMutation.record
    const source = {
      recordKind: 'exclusive_intent',
      operationId: record.operationId,
      operation: record.operation,
      phase: 'exclusive',
      owner: structuredClone(record.owner),
      fencingGeneration: record.fencingGeneration,
      createdAt: record.createdAt,
      updatedAt: '2031-08-15T13:14:15.000Z',
    }
    const options = makeCommittedOptions(
      operationRoot,
      source,
      { commitmentSha256: golden.onDiskEvidenceFixture.recordHash },
      { stateRevision: 999 }
    )
    const token = verifyCommittedRecoveryEvidence(options)
    expect(revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)).toEqual({
      commitmentSha256: golden.onDiskEvidenceFixture.recordHash,
      durability: 'linux-fsync-complete',
    })
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
    expectError(
      () => prepareDefault(operationRoot, source, 999),
      'RECOVERY_PREPARATION_INCOMPLETE'
    )
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('verifies initial and repeated mutating or abandoned lineage with independent recovery-only tokens', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 61)
    const before = journalWriteManifest(preparedPaths(operationRoot, intent).operation)

    for (const claimSequence of [0, 1, 2]) {
      const options = makeCommittedOptions(operationRoot, intent, prepared, {
        claimSequence,
        phase: claimSequence === 2 ? 'abandoned' : 'mutating',
        owner:
          claimSequence === 0
            ? intent.owner
            : { ...intent.owner, ownerId: `claimed-owner-${claimSequence}` },
        stateRevision: 61 + claimSequence,
      })
      const first = verifyCommittedRecoveryEvidence(options)
      const second = verifyCommittedRecoveryEvidence(options)
      expect(Object.isFrozen(first)).toBe(true)
      expect(Reflect.ownKeys(first)).toEqual([])
      expect(JSON.stringify(first)).toBe('{}')
      expect(retainedFileDescriptors(operationRoot)).toHaveLength(18)
      expect(revalidateVerifiedCommittedRecoveryEvidenceToken(first, options)).toEqual({
        commitmentSha256: prepared.commitmentSha256,
        durability: 'linux-fsync-complete',
      })
      releaseVerifiedCommittedRecoveryEvidenceToken(first)
      expect(retainedFileDescriptors(operationRoot)).toHaveLength(9)
      expect(revalidateVerifiedCommittedRecoveryEvidenceToken(second, options)).toEqual({
        commitmentSha256: prepared.commitmentSha256,
        durability: 'linux-fsync-complete',
      })
      releaseVerifiedCommittedRecoveryEvidenceToken(second)
      expect(retainedFileDescriptors(operationRoot)).toEqual([])
    }

    expect(journalWriteManifest(preparedPaths(operationRoot, intent).operation)).toEqual(before)
    const preparedToken = verifyPreparedMutationProof(prepared.proof, {
      operationRoot,
      stateRevision: 61,
      intent,
    })
    releaseVerifiedPreparedMutationToken(preparedToken)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('enforces exact commitment presence, shape, values, phase, generation, and initial owner precedence', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('import')
    const prepared = prepareDefault(operationRoot, intent, 62)
    const valid = makeCommittedOptions(operationRoot, intent, prepared)

    const missing = structuredClone(valid)
    delete missing.intent.recoveryCommitment
    expectError(() => verifyCommittedRecoveryEvidence(missing), 'RECOVERY_COMMITMENT_REQUIRED')
    expectError(
      () => verifyCommittedRecoveryEvidence({ ...valid, intent: { ...valid.intent, recoveryCommitment: null } }),
      'RECOVERY_COMMITMENT_REQUIRED'
    )
    expectError(
      () => verifyCommittedRecoveryEvidence({ ...valid, intent: { ...valid.intent, recoveryCommitment: [] } }),
      'INVALID_RECOVERY_OPTIONS'
    )

    const commitmentCases = [
      {},
      { ...valid.intent.recoveryCommitment, extra: true },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.protocol': 'wrong' },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.version': 2 },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.recordSha256': 'A'.repeat(64) },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.recordSha256': 'a'.repeat(63) },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.durability': 'unknown' },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.claimSequence': -1 },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.claimSequence': -0 },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.claimSequence': 1.5 },
      { ...valid.intent.recoveryCommitment, 'shikin.recovery.claimSequence': Number.MAX_SAFE_INTEGER + 1 },
    ]
    for (const recoveryCommitment of commitmentCases) {
      expectError(
        () => verifyCommittedRecoveryEvidence({ ...valid, intent: { ...valid.intent, recoveryCommitment } }),
        'RECOVERY_COMMITMENT_INVALID'
      )
    }

    for (const changed of [
      { phase: 'exclusive' },
      { phase: 'completed' },
      { fencingGeneration: 0 },
      { fencingGeneration: Number.MAX_SAFE_INTEGER + 1 },
      { fencingGeneration: valid.intent.recoveryCommitment['shikin.recovery.claimSequence'] },
      { owner: { ...intent.owner, ownerId: 'wrong-initial-owner' } },
    ]) {
      expectError(
        () => verifyCommittedRecoveryEvidence({ ...valid, intent: { ...valid.intent, ...changed } }),
        'RECOVERY_LINEAGE_INVALID'
      )
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects committed hash, immutable lineage, checked overflow, schema checks, and artifact corruption', () => {
    const attacks = [
      {
        name: 'wrong committed record hash',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ options }) {
          options.intent.recoveryCommitment['shikin.recovery.recordSha256'] = 'a'.repeat(64)
        },
      },
      {
        name: 'database identity lineage',
        code: 'RECOVERY_LINEAGE_INVALID',
        rewrite(record) { record.databaseIdentity = 'wrong.database' },
      },
      {
        name: 'operation id lineage',
        code: 'RECOVERY_LINEAGE_INVALID',
        rewrite(record) { record.operationId = 'wrong-operation' },
      },
      {
        name: 'operation type lineage',
        code: 'RECOVERY_LINEAGE_INVALID',
        rewrite(record) { record.operation = 'import' },
      },
      {
        name: 'creation time lineage',
        code: 'RECOVERY_LINEAGE_INVALID',
        rewrite(record) { record.createdAt = '2026-07-14T12:00:03.000Z' },
      },
      {
        name: 'generation overflow',
        code: 'RECOVERY_LINEAGE_INVALID',
        claimSequence: 1,
        fencingGeneration: Number.MAX_SAFE_INTEGER,
        rewrite(record) { record.fencingGeneration = Number.MAX_SAFE_INTEGER },
      },
      {
        name: 'schema identity',
        code: 'RECOVERY_VALIDATION_FAILED',
        rewrite(record) { record.schemaContract.latestMigration = '018_wrong' },
      },
      {
        name: 'recorded checks',
        code: 'RECOVERY_VALIDATION_FAILED',
        rewrite(record) { record.checks.candidate.integrityCheck = 'failed' },
      },
      {
        name: 'artifact bytes',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply({ paths }) {
          const artifact = join(paths.artifacts, readdirSync(paths.artifacts)[0])
          chmodSync(artifact, 0o600)
          writeFileSync(artifact, 'tampered')
          chmodSync(artifact, 0o400)
        },
      },
      {
        name: 'artifact sidecar',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply({ paths }) { writeFileSync(join(paths.artifacts, 'candidate.sqlite-wal'), 'sidecar') },
      },
      {
        name: 'record mode',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply({ paths }) { chmodSync(join(paths.records, readdirSync(paths.records)[0]), 0o600) },
      },
    ]

    for (const attack of attacks) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 63)
      const paths = preparedPaths(operationRoot, intent)
      const options = structuredClone(makeCommittedOptions(operationRoot, intent, prepared, {
        claimSequence: attack.claimSequence ?? 0,
        fencingGeneration: attack.fencingGeneration,
      }))
      if (attack.rewrite) {
        rewriteRecord(operationRoot, intent, attack.rewrite)
        options.intent.recoveryCommitment['shikin.recovery.recordSha256'] = currentRecordHash(paths)
      }
      attack.apply?.({ options, paths })
      expectError(() => verifyCommittedRecoveryEvidence(options), attack.code, attack.name)
      expect(retainedFileDescriptors(operationRoot), attack.name).toEqual([])
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('uses default UTF-8 names with strict ASCII validation and keeps every oversized committed layout classification bounded by role', () => {
    const probeRoot = createTempDirectory('shikin-dirent-utf8-')
    writeFileSync(join(probeRoot, 'ascii'), 'x')
    const probeDirectory = fs.opendirSync(probeRoot, { bufferSize: 1 })
    const probe = probeDirectory.readSync()
    probeDirectory.closeSync()
    expect(typeof probe?.name).toBe('string')
    expect(probe.name).toBe('ascii')

    for (const [target, code] of [
      ['recoveryRoot', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['operation', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['records', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['artifacts', 'RECOVERY_ARTIFACT_CORRUPTION'],
    ]) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 63)
      const paths = committedBoundaryPaths(operationRoot, intent)
      for (let index = 0; index < 32; index += 1) {
        writeFileSync(join(paths[target], `unexpected-${index}`), 'extra')
      }
      const error = expectError(
        () => verifyCommittedRecoveryEvidence(makeCommittedOptions(operationRoot, intent, prepared)),
        code,
        target
      )
      expect(error.message, target).toBe(`${target === 'recoveryRoot' ? 'recovery' : target}-layout`)
      expect(retainedFileDescriptors(operationRoot), target).toEqual([])
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('keeps the persistent broker reusable across every recoverable request fault and returns READY before each call completes', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 64)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const baselineTaskCount = readdirSync('/proc/self/task').length
    const expected = new Map([
      ['malformed-request', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol']],
      ['worker-malformed-response', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol']],
      ['response-overflow', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-response-overflow']],
      ['scanner-spawn-error', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-filesystem']],
      ['scanner-timeout', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-timeout']],
      ['scanner-status', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-failure']],
      ['scanner-signal', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-failure']],
      ['scanner-stderr', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-failure']],
      ['scanner-malformed-response', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-protocol']],
      ['scanner-extra-output', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-failure']],
      ['scanner-protocol-version', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-protocol']],
      ['scanner-node-version', ['RECOVERY_FILESYSTEM_FAILURE', 'scanner-protocol']],
      ['scanner-read-failure', ['RECOVERY_FILESYSTEM_FAILURE', 'recovery-filesystem']],
      ['scanner-close-failure', ['RECOVERY_FILESYSTEM_FAILURE', 'recovery-filesystem']],
      ['recovery-count-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'recovery-layout']],
      ['recovery-name-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'recovery-layout']],
      ['operation-count-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'operation-layout']],
      ['operation-name-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'operation-layout']],
      ['records-count-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'records-layout']],
      ['records-name-mismatch', ['RECOVERY_JOURNAL_CORRUPTION', 'records-layout']],
      ['artifacts-count-mismatch', ['RECOVERY_ARTIFACT_CORRUPTION', 'artifacts-layout']],
      ['artifacts-name-mismatch', ['RECOVERY_ARTIFACT_CORRUPTION', 'artifacts-layout']],
      ['pre-done-timeout', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout']],
      ['cancellation-delay', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout']],
      ['release-delay', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-release-incomplete']],
    ])
    const persistentFailures = new Set([
      'worker-malformed-response',
      'malformed-cancelled-terminal',
      'release-failed',
      'failed-state',
    ])
    expect(new Set(RECOVERY_JOURNAL_SCANNER_FAULTS_FOR_TEST)).toEqual(
      new Set([...expected.keys(), ...persistentFailures])
    )
    expect(Object.isFrozen(RECOVERY_JOURNAL_SCANNER_FAULTS_FOR_TEST)).toBe(true)
    expect(() => setRecoveryJournalScannerFaultForTest('unknown-fault')).toThrow()
    expect(() => setRecoveryJournalScannerFaultForTest(() => {})).toThrow()

    for (const [fault, result] of expected) {
      if (persistentFailures.has(fault)) continue
      setRecoveryJournalScannerFaultForTest(fault)
      const error = expectAnyError(() => verifyCommittedRecoveryEvidence(options))
      expect([error.code, error.message], fault).toEqual(result)
      expect(retainedFileDescriptors(operationRoot), fault).toEqual([])
      setRecoveryJournalScannerFaultForTest(undefined)
      if (fault === 'cancellation-delay' || fault === 'release-delay') waitForMilliseconds(150)
      const token = verifyCommittedRecoveryEvidence(options)
      releaseVerifiedCommittedRecoveryEvidenceToken(token)
      expect(retainedFileDescriptors(operationRoot), `${fault}: recovery`).toEqual([])
      expect(readdirSync('/proc/self/task'), fault).toHaveLength(baselineTaskCount)
    }
  }, 20_000)

  // prettier-ignore
  it.runIf(process.platform === 'linux')('reserves before getters, reports reentrant busy, preserves invalid precedence, and leaves the outer call unaffected', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 64)
    const outer = makeCommittedOptions(operationRoot, intent, prepared)
    const inner = structuredClone(outer)
    const invalidInner = structuredClone(outer)
    delete invalidInner.intent.recoveryCommitment
    let busy
    let invalid
    Object.defineProperty(outer.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        busy = expectAnyError(() => verifyCommittedRecoveryEvidence(inner))
        invalid = expectAnyError(() => verifyCommittedRecoveryEvidence(invalidInner))
        return 0
      },
    })
    const token = verifyCommittedRecoveryEvidence(outer)
    expect([busy.code, busy.message]).toEqual(['RECOVERY_FILESYSTEM_FAILURE', 'broker-busy'])
    expect(invalid.code).toBe('RECOVERY_COMMITMENT_REQUIRED')
    expect(retainedFileDescriptors(operationRoot)).toHaveLength(9)
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('fails closed for persistent FAILED and incomplete cleanup faults without terminating the broker process', () => {
    const expected = new Map([
      ['worker-malformed-response', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol', true]],
      ['malformed-cancelled-terminal', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout', true]],
      ['release-failed', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-release-incomplete', false]],
      ['failed-state', ['RECOVERY_FILESYSTEM_FAILURE', 'broker-failed', false]],
    ])
    for (const [fault, result] of expected) {
      const child = spawnSync(
        process.execPath,
        ['--input-type=module', '--eval', committedFixtureSubprocessScript(`
          journal.setRecoveryJournalScannerFaultForTest(process.env.SHIKIN_REQUEST_FAULT)
          let caught
          try { journal.verifyCommittedRecoveryEvidence(options) } catch (error) { caught = error }
          process.stdout.write(JSON.stringify([caught?.code, caught?.message, caught?.cause !== undefined]))
        `)],
        {
          cwd: resolve('.'),
          encoding: 'utf8',
          env: { ...process.env, NODE_ENV: 'test', SHIKIN_REQUEST_FAULT: fault },
          timeout: 10_000,
        }
      )
      expect(child.status, `${fault}: ${child.stderr}`).toBe(0)
      expect(JSON.parse(child.stdout), fault).toEqual(result)
    }
  }, 20_000)

  // prettier-ignore
  it.runIf(process.platform === 'linux')('handles every finite bootstrap failure after input validation and exits with failed workers unreferenced', () => {
    for (const fault of [
      'constructor-failure',
      'error-before-exit',
      'exit-before-ready',
      'never-ready',
      'termination-timeout',
    ]) {
      const script = `import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';const journal=await import(pathToFileURL(path.resolve('scripts/database-operation-recovery-journal.mjs')).href);const owner={ownerId:'owner',runtimeId:'cli',hostId:'host',processId:42,processStartedAt:'2026-07-14T12:00:00.000Z'};const commitment={'shikin.recovery.protocol':'shikin.database-operation-recovery-journal','shikin.recovery.version':1,'shikin.recovery.recordSha256':'a'.repeat(64),'shikin.recovery.durability':'linux-fsync-complete','shikin.recovery.claimSequence':0};const operationRoot=path.join('/',crypto.createHash('sha256').update('com.asf.shikin:shikin.db').digest('hex'));const valid={operationRoot,stateRevision:1,intent:{recordKind:'exclusive_intent',operationId:'operation',operation:'restore',phase:'mutating',owner,fencingGeneration:1,createdAt:'2026-07-14T12:00:01.000Z',updatedAt:'2026-07-14T12:00:02.000Z',recoveryCommitment:commitment}};const invalid=structuredClone(valid);delete invalid.intent.recoveryCommitment;const results=[];for(const value of [invalid,valid]){try{journal.verifyCommittedRecoveryEvidence(value)}catch(error){results.push([error.code,error.message])}}process.stdout.write(JSON.stringify(results));`
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_ENV: 'test',
          SHIKIN_RECOVERY_JOURNAL_BROKER_BOOTSTRAP_FAULT: fault,
        },
        timeout: 8_000,
      })
      expect(child.status, `${fault}: ${child.stderr}`).toBe(0)
      expect(JSON.parse(child.stdout), fault).toEqual([
        ['RECOVERY_COMMITMENT_REQUIRED', 'The exact committed recovery metadata is required'],
        ['RECOVERY_FILESYSTEM_FAILURE', 'broker-bootstrap'],
      ])
    }
  }, 25_000)

  // prettier-ignore
  it.runIf(process.platform === 'linux')('constructs exactly one persistent broker Worker and never adds a per-call parent task', () => {
    const child = spawnSync(
      process.execPath,
      ['--input-type=module', '--eval', committedFixtureSubprocessScript(`
        const afterImport = fs.readdirSync('/proc/self/task').length
        const tokenOne = journal.verifyCommittedRecoveryEvidence(options)
        journal.releaseVerifiedCommittedRecoveryEvidenceToken(tokenOne)
        const afterOne = fs.readdirSync('/proc/self/task').length
        const tokenTwo = journal.verifyCommittedRecoveryEvidence(options)
        journal.revalidateVerifiedCommittedRecoveryEvidenceToken(tokenTwo, options)
        journal.releaseVerifiedCommittedRecoveryEvidenceToken(tokenTwo)
        const afterTwo = fs.readdirSync('/proc/self/task').length
        workerThreads.Worker = OriginalWorker
        builtinModule.syncBuiltinESMExports()
        process.stdout.write(JSON.stringify([workerConstructions, afterImport, afterOne, afterTwo]))
      `, `
        const workerThreads = (await import('node:worker_threads')).default
        const builtinModule = await import('node:module')
        const OriginalWorker = workerThreads.Worker
        let workerConstructions = 0
        class InstrumentedWorker extends OriginalWorker {
          constructor(...args) {
            workerConstructions += 1
            super(...args)
          }
        }
        workerThreads.Worker = InstrumentedWorker
        builtinModule.syncBuiltinESMExports()
      `)],
      { cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } }
    )
    expect(child.status, child.stderr).toBe(0)
    const [constructions, afterImport, afterOne, afterTwo] = JSON.parse(child.stdout)
    expect(constructions).toBe(1)
    expect(afterOne).toBe(afterImport)
    expect(afterTwo).toBe(afterImport)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('raw Node 18.20.8 rejects every protected prototype mutation before authority-sensitive work', () => {
    const node18Binary = resolveRequiredNode18Binary()
    const script = String.raw`
      import fs from 'node:fs'
      import path from 'node:path'
      import crypto from 'node:crypto'
      import { syncBuiltinESMExports } from 'node:module'
      import { pathToFileURL } from 'node:url'

      const rawDefineProperty = Object.defineProperty
      const rawGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
      const rawGetPrototypeOf = Object.getPrototypeOf
      const rawSetPrototypeOf = Object.setPrototypeOf
      const rawCreate = Object.create
      const rawOwnKeys = Reflect.ownKeys
      const rawDeleteProperty = Reflect.deleteProperty
      const rawFsBinding = process.binding('fs')
      const rawBindingOpen = rawFsBinding.open.bind(rawFsBinding)
      const rawBindingWriteString = rawFsBinding.writeString.bind(rawFsBinding)
      const rawBindingClose = rawFsBinding.close.bind(rawFsBinding)
      const rawBindingContext = () => rawCreate(null)
      const rawOpenSync = (target, flags, mode) => {
        const context = rawBindingContext()
        const descriptor = rawBindingOpen(target, flags, mode, undefined, context)
        if (context.errno !== undefined) throw new Error('raw open failed: ' + context.errno)
        return descriptor
      }
      const rawWriteSync = (descriptor, value) => {
        const context = rawBindingContext()
        const written = rawBindingWriteString(descriptor, value, null, 'utf8', undefined, context)
        if (context.errno !== undefined) throw new Error('raw write failed: ' + context.errno)
        return written
      }
      const rawCloseSync = (descriptor) => {
        const context = rawBindingContext()
        rawBindingClose(descriptor, undefined, context)
        if (context.errno !== undefined) throw new Error('raw close failed: ' + context.errno)
      }
      const rawUnlinkSync = fs.unlinkSync.bind(fs)
      const rawReaddirSync = fs.readdirSync.bind(fs)
      const rawReadlinkSync = fs.readlinkSync.bind(fs)
      const rawLstatSync = fs.lstatSync.bind(fs)
      const rawCreateHash = crypto.createHash.bind(crypto)
      const rawRmSync = fs.rmSync.bind(fs)
      const openProbeFlags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
      const journal = await import(pathToFileURL(path.resolve('scripts/database-operation-recovery-journal.mjs')).href)
      await new Promise((resolveTurn) => setImmediate(resolveTurn))

      const golden = JSON.parse(fs.readFileSync(path.resolve('schema/database-operation-recovery-journal-v1-golden.json'), 'utf8'))
      const root = fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'shikin-node18-prototype-preflight-'))
      const operationRoot = path.join(root, rawCreateHash('sha256').update('com.asf.shikin:shikin.db').digest('hex'))
      fs.mkdirSync(operationRoot, { mode: 0o700 })
      fs.cpSync(path.resolve(golden.onDiskEvidenceFixture.root, 'recovery-journal-v1'), path.join(operationRoot, 'recovery-journal-v1'), { recursive: true })
      const seal = (target) => {
        const stat = rawLstatSync(target)
        if (stat.isDirectory()) {
          fs.chmodSync(target, 0o700)
          for (const name of rawReaddirSync(target)) seal(path.join(target, name))
        } else fs.chmodSync(target, 0o400)
      }
      seal(path.join(operationRoot, 'recovery-journal-v1'))
      const record = golden.preparedMutation.record
      const makeOptions = () => ({
        operationRoot,
        stateRevision: 999,
        intent: {
          recordKind: 'exclusive_intent',
          operationId: record.operationId,
          operation: record.operation,
          phase: 'mutating',
          owner: {
            ownerId: record.owner.ownerId,
            runtimeId: record.owner.runtimeId,
            hostId: record.owner.hostId,
            processId: record.owner.processId,
            processStartedAt: record.owner.processStartedAt,
          },
          fencingGeneration: record.fencingGeneration,
          createdAt: record.createdAt,
          updatedAt: '2031-08-15T13:14:15.000Z',
          recoveryCommitment: {
            'shikin.recovery.protocol': 'shikin.database-operation-recovery-journal',
            'shikin.recovery.version': 1,
            'shikin.recovery.recordSha256': golden.onDiskEvidenceFixture.recordHash,
            'shikin.recovery.durability': 'linux-fsync-complete',
            'shikin.recovery.claimSequence': 0,
          },
        },
      })

      const protectedTargets = []
      const seen = new Set()
      const roots = [
        Object.prototype,
        Error,
        Error.prototype,
        TypeError,
        TypeError.prototype,
        fs.Stats.prototype,
        rawGetPrototypeOf(rawLstatSync(process.execPath, { bigint: true })),
        rawGetPrototypeOf(Buffer.alloc(0)),
        Buffer.prototype,
        Uint8Array.prototype,
        rawGetPrototypeOf(Uint8Array.prototype),
        rawGetPrototypeOf(rawCreateHash('sha256')),
      ]
      for (const rootTarget of roots) {
        for (let target = rootTarget; target !== null && !seen.has(target); target = rawGetPrototypeOf(target)) {
          seen.add(target)
          protectedTargets.push(target)
        }
      }

      const attacks = []
      for (const key of ['error', 'code', 'path', 'bigint', 'encoding']) {
        attacks.push({
          label: 'Object.prototype.' + key,
          apply() {
            const original = rawGetOwnPropertyDescriptor(Object.prototype, key)
            rawDefineProperty(Object.prototype, key, {
              configurable: true,
              enumerable: true,
              get() {
                throw new Error('protected Object.prototype getter reached: ' + key)
              },
            })
            return () => {
              if (original === undefined) rawDeleteProperty(Object.prototype, key)
              else rawDefineProperty(Object.prototype, key, original)
            }
          },
        })
      }
      for (let index = 0; index < protectedTargets.length; index += 1) {
        const target = protectedTargets[index]
        const descriptors = rawOwnKeys(target).map((key) => [key, rawGetOwnPropertyDescriptor(target, key)])
        const attributeEntry = descriptors.find(([, descriptor]) => descriptor.configurable)
        if (attributeEntry === undefined) throw new Error('protected target has no mutable descriptor attributes: ' + index)
        const [attributeKey, attributeDescriptor] = attributeEntry
        attacks.push({
          label: 'descriptor-attributes-' + index,
          apply() {
            rawDefineProperty(target, attributeKey, { ...attributeDescriptor, enumerable: !attributeDescriptor.enumerable })
            return () => rawDefineProperty(target, attributeKey, attributeDescriptor)
          },
        })
        const identityEntry = descriptors.find(([, descriptor]) =>
          rawGetOwnPropertyDescriptor(descriptor, 'value') !== undefined
            ? descriptor.configurable || descriptor.writable
            : descriptor.configurable
        )
        if (identityEntry === undefined) throw new Error('protected target has no mutable descriptor identity: ' + index)
        const [identityKey, identityDescriptor] = identityEntry
        const identityIsData = rawGetOwnPropertyDescriptor(identityDescriptor, 'value') !== undefined
        attacks.push({
          label: 'descriptor-identity-' + index,
          apply() {
            const replacement = identityIsData
              ? { ...identityDescriptor, value: rawCreate(null) }
              : { ...identityDescriptor, get: function protectedAccessorReplacement() {} }
            rawDefineProperty(target, identityKey, replacement)
            return () => rawDefineProperty(target, identityKey, identityDescriptor)
          },
        })
        if (target !== Object.prototype) {
          attacks.push({
            label: 'prototype-' + index,
            apply() {
              const original = rawGetPrototypeOf(target)
              rawSetPrototypeOf(target, rawCreate(null))
              return () => rawSetPrototypeOf(target, original)
            },
          })
        }
      }

      const wrapperCalls = []
      const wrapperOriginals = []
      for (const [target, family] of [[fs, 'fs'], [path, 'path'], [crypto, 'crypto']]) {
        for (const key of rawOwnKeys(target)) {
          const descriptor = rawGetOwnPropertyDescriptor(target, key)
          const dataDescriptor = rawGetOwnPropertyDescriptor(descriptor, 'value') !== undefined
          if (
            !dataDescriptor ||
            typeof descriptor.value !== 'function' ||
            (!descriptor.configurable && !descriptor.writable) ||
            (family === 'path' && key === 'toNamespacedPath')
          ) continue
          const label = family + '.' + String(key)
          wrapperOriginals.push([target, key, descriptor])
          rawDefineProperty(target, key, {
            ...descriptor,
            value: function hostileAuthorityWrapper() {
              wrapperCalls.push(label)
              throw new Error('hostile authority wrapper reached: ' + label)
            },
            writable: true,
          })
        }
      }
      syncBuiltinESMExports()

      const rootDescriptors = () => rawReaddirSync('/proc/self/fd').flatMap((descriptor) => {
        try {
          const target = rawReadlinkSync('/proc/self/fd/' + descriptor)
          return target.startsWith(operationRoot) ? [target] : []
        } catch { return [] }
      })
      const runAttack = (mode, attack, index) => {
        let restorePoison
        const probe = operationRoot + '/post-poison-' + mode + '-' + index
        const options = makeOptions()
        rawDefineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
          configurable: true,
          enumerable: true,
          get() {
            restorePoison = attack.apply()
            let descriptor
            try {
              descriptor = rawOpenSync(probe, openProbeFlags, 0o600)
              rawWriteSync(descriptor, 'x')
            } finally {
              if (descriptor !== undefined) rawCloseSync(descriptor)
            }
            return 0
          },
        })
        let retainedToken
        if (mode === 'revalidate') retainedToken = journal.verifyCommittedRecoveryEvidence(makeOptions())
        const tasksBefore = rawReaddirSync('/proc/self/task').length
        const wrappersBefore = wrapperCalls.length
        let issuedToken
        let caught
        try {
          if (mode === 'verify') issuedToken = journal.verifyCommittedRecoveryEvidence(options)
          else journal.revalidateVerifiedCommittedRecoveryEvidenceToken(retainedToken, options)
        } catch (error) {
          caught = error
        } finally {
          if (issuedToken !== undefined) journal.releaseVerifiedCommittedRecoveryEvidenceToken(issuedToken)
          if (retainedToken !== undefined) journal.releaseVerifiedCommittedRecoveryEvidenceToken(retainedToken)
          if (restorePoison !== undefined) restorePoison()
        }

        const tasksAfter = rawReaddirSync('/proc/self/task').length
        if (rawLstatSync(probe).isFile()) rawUnlinkSync(probe)
        if (caught === undefined || caught.code !== 'INVALID_RECOVERY_OPTIONS') {
          throw new Error(mode + ' did not reject ' + attack.label + ' exactly')
        }
        if (wrapperCalls.length !== wrappersBefore) {
          throw new Error(mode + ' reached authority wrappers for ' + attack.label + ': ' + wrapperCalls.join(','))
        }
        const descriptors = rootDescriptors()
        if (descriptors.length !== 0) throw new Error(mode + ' leaked operation-root descriptors for ' + attack.label + ': ' + descriptors.join(','))
        if (tasksAfter !== tasksBefore) throw new Error(mode + ' changed task count for ' + attack.label)
      }

      try {
        for (let index = 0; index < attacks.length; index += 1) {
          runAttack('verify', attacks[index], index)
          runAttack('revalidate', attacks[index], index)
        }
      } finally {
        for (let index = wrapperOriginals.length - 1; index >= 0; index -= 1) {
          const [target, key, descriptor] = wrapperOriginals[index]
          rawDefineProperty(target, key, descriptor)
        }
        syncBuiltinESMExports()
        rawRmSync(root, { recursive: true, force: true })
      }
      if (wrapperCalls.length !== 0) throw new Error('authority wrappers were invoked')
      process.stdout.write(JSON.stringify({ version: process.version, cases: attacks.length }))
    `
    const child = spawnSync(node18Binary, ['--input-type=module', '--eval', script], {
      cwd: resolve('.'),
      encoding: 'utf8',
      env: nodeSubprocessEnvironment({ NODE_ENV: 'test' }),
      timeout: 60_000,
    })
    expect(child.status, subprocessDiagnostics(child)).toBe(0)
    expect(JSON.parse(child.stdout)).toEqual({ version: NODE_18_20_8_VERSION, cases: 61 })
  }, 200_000)

  // prettier-ignore
  it.runIf(process.platform === 'linux')('imports the lock in main and nested workers and lets import-only and preparation workers exit normally', () => {
    const lockUrl = JSON.stringify(new URL('./database-operation-lock.mjs', import.meta.url).href)
    const main = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${lockUrl})`], {
      cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 5_000,
    })
    expect(main.status, main.stderr).toBe(0)

    const nestedScript = `import {Worker} from 'node:worker_threads';const source=\`const {parentPort}=require('node:worker_threads');import(${lockUrl}).then(()=>parentPort.close())\`;const worker=new Worker(source,{eval:true,execArgv:[]});await new Promise((resolve,reject)=>{worker.once('exit',(code)=>code===0?resolve():reject(new Error('nested '+code)));worker.once('error',reject)});`
    const nested = spawnSync(process.execPath, ['--input-type=module', '--eval', nestedScript], {
      cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 5_000,
    })
    expect(nested.status, nested.stderr).toBe(0)

    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const preparation = spawnSync(
      process.execPath,
      [resolve('scripts/database-operation-recovery-journal.worker.mjs'), operationRoot, '3', JSON.stringify(intent)],
      { cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 5_000 }
    )
    expect(preparation.status, preparation.stderr).toBe(0)
    expect(preparation.stdout.trim()).toMatch(/^SUCCESS:[0-9a-f]{64}$/)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('keeps parent Worker, MessagePort, and unrelated Writable prototype poisons installed through a real turn and normal process exit', () => {
    const action = `
      const workerThreads = await import('node:worker_threads')
      const stream = await import('node:stream')
      const defineProperty = Object.defineProperty
      const poison = () => { throw new Error('mutable parent worker lifecycle method reached') }
      const install = (target, key) => {
        const descriptor = Object.getOwnPropertyDescriptor(target, key)
        if (descriptor === undefined || descriptor.configurable) {
          defineProperty(target, key, { configurable: true, writable: true, value: poison })
        } else if (descriptor.writable) {
          defineProperty(target, key, { ...descriptor, value: poison })
        }
      }
      Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
        configurable: true,
        enumerable: true,
        get() {
          install(workerThreads.Worker.prototype, 'emit')
          install(workerThreads.Worker.prototype, 'removeAllListeners')
          for (const symbol of Object.getOwnPropertySymbols(workerThreads.Worker.prototype)) {
            const descriptor = Object.getOwnPropertyDescriptor(workerThreads.Worker.prototype, symbol)
            if (typeof descriptor?.value === 'function') install(workerThreads.Worker.prototype, symbol)
          }
          install(workerThreads.MessagePort.prototype, 'unref')
          for (const key of ['destroy', 'emit', 'end', 'write']) install(stream.Writable.prototype, key)
          return 0
        },
      })
      const token = journal.verifyCommittedRecoveryEvidence(options)
      journal.releaseVerifiedCommittedRecoveryEvidenceToken(token)
      await new Promise((resolveTurn) => setImmediate(resolveTurn))
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', committedFixtureSubprocessScript(action)], {
      cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 8_000,
    })
    expect(child.status, child.stderr).toBe(0)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('uses only bootstrap-captured fs, path, and crypto bindings through verification, cleanup, and the next turn', () => {
    const action = `
      const module = await import('node:module')
      const cryptoModule = (await import('node:crypto')).default
      const pathModule = (await import('node:path')).default
      const defineProperty = Object.defineProperty
      const getDescriptor = Object.getOwnPropertyDescriptor
      const wrappers = []
      const originals = []
      const targets = [
        [fs, ['chmodSync','closeSync','fchmodSync','fstatSync','fsyncSync','lstatSync','mkdirSync','openSync','opendirSync','readdirSync','readSync','realpathSync','writeSync','Dir','Stats']],
        [pathModule, ['basename','dirname','join','resolve']],
        [cryptoModule, ['createHash','randomBytes']],
      ]
      const originalReaddir = fs.readdirSync
      const originalReadlink = fs.readlinkSync
      const originalWriteFile = fs.writeFileSync
      const originalJoin = pathModule.join
      const descriptorCount = () => originalReaddir('/proc/self/fd').filter((fd) => {
        try { return originalReadlink('/proc/self/fd/' + fd).startsWith(operationRoot) } catch { return false }
      }).length
      let installed = false
      const install = () => {
        if (installed) return
        installed = true
        for (const [target, keys] of targets) {
          for (const key of keys) {
            const descriptor = getDescriptor(target, key)
            if (descriptor === undefined || (!descriptor.configurable && !descriptor.writable)) continue
            originals.push([target, key, descriptor])
            const wrapper = function poisonedBuiltin() { wrappers.push(key); throw new Error('live builtin reached: ' + key) }
            defineProperty(target, key, { ...descriptor, value: wrapper, writable: true })
          }
        }
        module.syncBuiltinESMExports()
      }
      Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
        configurable: true,
        enumerable: true,
        get() { install(); return 0 },
      })
      let token
      let invalid
      try {
        token = journal.verifyCommittedRecoveryEvidence(options)
        journal.revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)
        originalWriteFile(originalJoin(operationRoot, 'recovery-journal-v1', 'unexpected'), 'x')
        try { journal.verifyCommittedRecoveryEvidence(structuredClone(options)) } catch (error) { invalid = error }
        journal.releaseVerifiedCommittedRecoveryEvidenceToken(token)
        token = undefined
        await new Promise((resolveTurn) => setImmediate(resolveTurn))
        if (descriptorCount() !== 0) throw new Error('retained descriptors survived cleanup')
        if (invalid?.code !== 'RECOVERY_JOURNAL_CORRUPTION') throw new Error('invalid evidence succeeded')
        if (wrappers.length !== 0) throw new Error('live wrappers executed: ' + wrappers.join(','))
      } finally {
        if (token) journal.releaseVerifiedCommittedRecoveryEvidenceToken(token)
        for (let index = originals.length - 1; index >= 0; index -= 1) {
          const [target, key, descriptor] = originals[index]
          defineProperty(target, key, descriptor)
        }
        module.syncBuiltinESMExports()
      }
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', committedFixtureSubprocessScript(action)], {
      cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' }, timeout: 8_000,
    })
    expect(child.status, child.stderr).toBe(0)
  })

  it('guards live Node builtin calls, persistent protocol constants, Worker options, and committed hash helpers at source level', () => {
    const source = readFileSync(resolve('scripts/database-operation-recovery-journal.mjs'), 'utf8')
    for (const name of [
      'liveCreateHash',
      'liveRandomBytes',
      'liveChmodSync',
      'liveCloseSync',
      'liveFchmodSync',
      'liveFstatSync',
      'liveFsyncSync',
      'liveLstatSync',
      'liveMkdirSync',
      'liveOpenSync',
      'liveOpendirSync',
      'liveReaddirSync',
      'liveReadSync',
      'liveRealpathSync',
      'liveWriteSync',
      'liveBasename',
      'liveDirname',
      'liveJoin',
      'liveResolve',
    ]) {
      expect(source).not.toMatch(new RegExp(`\\b${name}\\s*\\(`))
    }
    expect(source).not.toMatch(/new\s+LiveWorker\b/)
    expect(source).not.toContain('workerOptions.name')
    for (const [name, value] of Object.entries({
      BROKER_BOOT: 0,
      BROKER_READY: 1,
      BROKER_RESERVED: 2,
      BROKER_RUN: 3,
      BROKER_CANCEL: 4,
      BROKER_DONE: 5,
      BROKER_RELEASE: 6,
      BROKER_FAILED: 7,
    })) {
      expect(source).toContain(`const ${name} = ${value}`)
    }
    for (const name of [
      'hardenedRecoveryOperationKey',
      'hardenedRecoveryArtifactKey',
      'hardenedCreateRecoveryArtifactHasher',
      'hardenedRecoveryRecordHash',
      'hardenedDigestParts',
    ]) {
      const body = sourceFunctionBody(source, name)
      expect(body).not.toMatch(
        /\b(?:recoveryRecordHash|recoveryArtifactKey|recoveryOperationKey|createRecoveryArtifactHasher)\s*\(/
      )
    }
    for (const name of [
      'hardenedCreateRecoveryArtifactHasher',
      'hardenedRecoveryRecordHash',
      'hardenedDigestParts',
    ]) {
      expect(sourceFunctionBody(source, name)).toContain('createHashBuiltin')
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('does not inherit a hostile parent preload in either the pristine Worker or scanner child', () => {
    const harnessRoot = createTempDirectory('shikin-hostile-preload-')
    const preloadPath = join(harnessRoot, 'hostile-preload.cjs')
    const countPath = join(harnessRoot, 'preload-count.txt')
    writeFileSync(
      preloadPath,
      `const fs=require('node:fs');const wt=require('node:worker_threads');fs.appendFileSync(process.env.SHIKIN_PRELOAD_COUNT_PATH,process.pid+':'+wt.isMainThread+'\\n');globalThis.__shikinHostilePreload=true;`
    )
    const script = `import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';if(globalThis.__shikinHostilePreload!==true)process.exit(20);const journal=await import(pathToFileURL(path.resolve('scripts/database-operation-recovery-journal.mjs')).href);const root=fs.mkdtempSync(path.join(os.tmpdir(),'shikin-preload-harness-'));const operationRoot=path.join(root,crypto.createHash('sha256').update('com.asf.shikin:shikin.db').digest('hex'));fs.mkdirSync(operationRoot,{mode:0o700});const intent={recordKind:'exclusive_intent',operationId:'hostile-preload',operation:'restore',phase:'exclusive',owner:{ownerId:'owner',runtimeId:'cli',hostId:'host',processId:4242,processStartedAt:'2026-07-14T12:00:00.000Z'},fencingGeneration:1,createdAt:'2026-07-14T12:00:01.000Z',updatedAt:'2026-07-14T12:00:02.000Z'};const prepared=journal.prepareMutationJournal({operationRoot,stateRevision:1,intent,writeArtifact({role,path}){fs.writeFileSync(path,Buffer.from(role));return {integrityCheck:'ok',foreignKeyCheck:'ok',schemaContractCheck:'ok',sidecarCheck:'ok'}}});const options={operationRoot,stateRevision:1,intent:{...intent,phase:'mutating',recoveryCommitment:{'shikin.recovery.protocol':'shikin.database-operation-recovery-journal','shikin.recovery.version':1,'shikin.recovery.recordSha256':prepared.commitmentSha256,'shikin.recovery.durability':'linux-fsync-complete','shikin.recovery.claimSequence':0}}};const token=journal.verifyCommittedRecoveryEvidence(options);journal.releaseVerifiedCommittedRecoveryEvidenceToken(token);fs.rmSync(root,{recursive:true,force:true});`
    const child = spawnSync(
      process.execPath,
      ['--require', preloadPath, '--input-type=module', '--eval', script],
      {
        cwd: resolve('.'),
        encoding: 'utf8',
        env: { ...process.env, NODE_ENV: 'test', SHIKIN_PRELOAD_COUNT_PATH: countPath },
      }
    )
    expect(child.status, child.stderr).toBe(0)
    expect(readFileSync(countPath, 'utf8').trim().split('\n')).toEqual([
      `${child.pid}:true`,
    ])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux' && fs.existsSync('/usr/bin/strace'))('launches exactly one scanner child and no revalidation child with the fixed Node flags', () => {
    const harnessRoot = createTempDirectory('shikin-single-scanner-')
    const tracePath = join(harnessRoot, 'execve.trace')
    const script = `import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';const journal=await import(pathToFileURL(path.resolve('scripts/database-operation-recovery-journal.mjs')).href);const golden=JSON.parse(fs.readFileSync(path.resolve('schema/database-operation-recovery-journal-v1-golden.json'),'utf8'));const root=fs.mkdtempSync(path.join(os.tmpdir(),'shikin-one-scanner-'));const operationRoot=path.join(root,crypto.createHash('sha256').update('com.asf.shikin:shikin.db').digest('hex'));fs.mkdirSync(operationRoot,{mode:0o700});fs.cpSync(path.resolve(golden.onDiskEvidenceFixture.root,'recovery-journal-v1'),path.join(operationRoot,'recovery-journal-v1'),{recursive:true});const seal=(target)=>{const stat=fs.lstatSync(target);if(stat.isDirectory()){fs.chmodSync(target,0o700);for(const name of fs.readdirSync(target))seal(path.join(target,name))}else fs.chmodSync(target,0o400)};seal(path.join(operationRoot,'recovery-journal-v1'));const record=golden.preparedMutation.record;const options={operationRoot,stateRevision:999,intent:{recordKind:'exclusive_intent',operationId:record.operationId,operation:record.operation,phase:'mutating',owner:structuredClone(record.owner),fencingGeneration:record.fencingGeneration,createdAt:record.createdAt,updatedAt:'2031-08-15T13:14:15.000Z',recoveryCommitment:{'shikin.recovery.protocol':'shikin.database-operation-recovery-journal','shikin.recovery.version':1,'shikin.recovery.recordSha256':golden.onDiskEvidenceFixture.recordHash,'shikin.recovery.durability':'linux-fsync-complete','shikin.recovery.claimSequence':0}}};const missing=structuredClone(options);delete missing.intent.recoveryCommitment;let invalidCode;try{journal.verifyCommittedRecoveryEvidence(missing)}catch(error){invalidCode=error.code}if(invalidCode!=='RECOVERY_COMMITMENT_REQUIRED')process.exit(21);const token=journal.verifyCommittedRecoveryEvidence(options);journal.revalidateVerifiedCommittedRecoveryEvidenceToken(token,options);journal.releaseVerifiedCommittedRecoveryEvidenceToken(token);fs.rmSync(root,{recursive:true,force:true});`
    const traced = spawnSync(
      '/usr/bin/strace',
      ['-f', '-s', '100000', '-e', 'trace=execve', '-o', tracePath, process.execPath, '--input-type=module', '--eval', script],
      { cwd: resolve('.'), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' } }
    )
    expect(traced.status, traced.stderr).toBe(0)
    const nodeExecs = readFileSync(tracePath, 'utf8')
      .split('\n')
      .filter((line) => line.includes(`execve("${process.execPath}"`))
    expect(nodeExecs).toHaveLength(2)
    const scannerExec = nodeExecs[1]
    for (const flag of [
      '--disable-proto=throw',
      '--no-addons',
      '--no-global-search-paths',
      '--no-deprecation',
      '--no-warnings',
      '--input-type=module',
      '--eval',
    ]) {
      expect(scannerExec).toContain(`"${flag}"`)
    }
    for (const fixedScannerSource of [
      "const expectedCounts = [1, 2, 1, 2]",
      'opendirSyncBuiltin(path, { bufferSize: 1 })',
      'for (let index = 0; index <= expectedCount; index += 1)',
      'directoryCloseSync(directory)',
    ]) {
      expect(scannerExec).toContain(fixedScannerSource)
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('uses a trap-safe fixed-shape caller boundary without protocol-error impersonation or unexpected getter reads', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 64)
    const valid = makeCommittedOptions(operationRoot, intent, prepared)
    let unexpectedReads = 0

    for (const hostile of [
      new Proxy(valid, { ownKeys() { throw new RecoveryJournalError('RECOVERY_ARTIFACT_CORRUPTION', 'forged') } }),
      Object.defineProperty({ ...valid }, 'operationRoot', {
        enumerable: true,
        get() { throw new RecoveryJournalError('RECOVERY_JOURNAL_CORRUPTION', 'forged') },
      }),
      { ...valid, intent: new Proxy(valid.intent, { ownKeys() { throw new Error('intent ownKeys trap') } }) },
      {
        ...valid,
        intent: Object.defineProperty({ ...valid.intent }, 'recoveryCommitment', {
          enumerable: true,
          get() { throw new RecoveryJournalError('RECOVERY_VALIDATION_FAILED', 'forged') },
        }),
      },
    ]) {
      expectError(() => verifyCommittedRecoveryEvidence(hostile), 'INVALID_RECOVERY_OPTIONS')
      expect(retainedFileDescriptors(operationRoot)).toEqual([])
    }

    const outerExtra = { ...valid }
    Object.defineProperty(outerExtra, 'extra', {
      enumerable: false,
      get() { unexpectedReads += 1; return true },
    })
    const ownerExtra = { ...valid.intent.owner }
    Object.defineProperty(ownerExtra, 'extra', {
      enumerable: true,
      get() { unexpectedReads += 1; return true },
    })
    const commitmentExtra = { ...valid.intent.recoveryCommitment }
    Object.defineProperty(commitmentExtra, 'extra', {
      enumerable: true,
      get() { unexpectedReads += 1; return true },
    })
    for (const [hostile, code] of [
      [outerExtra, 'INVALID_RECOVERY_OPTIONS'],
      [{ ...valid, intent: { ...valid.intent, owner: ownerExtra } }, 'INVALID_RECOVERY_OPTIONS'],
      [
        { ...valid, intent: { ...valid.intent, recoveryCommitment: commitmentExtra } },
        'RECOVERY_COMMITMENT_INVALID',
      ],
    ]) {
      expectError(() => verifyCommittedRecoveryEvidence(hostile), code)
    }

    const metadataIntent = { ...valid.intent }
    Object.defineProperty(metadataIntent, 'metadata', {
      enumerable: true,
      get() { unexpectedReads += 1; return {} },
    })
    expectError(
      () => verifyCommittedRecoveryEvidence({ ...valid, intent: metadataIntent }),
      'INVALID_RECOVERY_OPTIONS'
    )
    const toJsonIntent = { ...valid.intent }
    Object.defineProperty(toJsonIntent, 'toJSON', {
      enumerable: false,
      get() { unexpectedReads += 1; return () => ({}) },
    })
    expectError(
      () => verifyCommittedRecoveryEvidence({ ...valid, intent: toJsonIntent }),
      'INVALID_RECOVERY_OPTIONS'
    )
    expect(unexpectedReads).toBe(0)

    const inherited = Object.create({ toJSON() { throw new Error('must be ignored') } })
    Object.assign(inherited, valid.intent)
    const token = verifyCommittedRecoveryEvidence({ ...valid, intent: inherited })
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('reads expected getters once, snapshots caller state, and validates hostile revalidation only after token authenticity', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('import')
    const prepared = prepareDefault(operationRoot, intent, 65)
    const valid = makeCommittedOptions(operationRoot, intent, prepared)
    const reads = new Map()
    const wrap = (value, label) => new Proxy(value, {
      ownKeys(target) { return Reflect.ownKeys(target) },
      get(target, key, receiver) {
        reads.set(`${label}.${String(key)}`, (reads.get(`${label}.${String(key)}`) ?? 0) + 1)
        return Reflect.get(target, key, receiver)
      },
    })
    const owner = wrap(valid.intent.owner, 'owner')
    const commitment = wrap(valid.intent.recoveryCommitment, 'commitment')
    const committedIntent = wrap({ ...valid.intent, owner, recoveryCommitment: commitment }, 'intent')
    const options = wrap({ ...valid, intent: committedIntent }, 'options')
    const token = verifyCommittedRecoveryEvidence(options)
    for (const count of reads.values()) expect(count).toBe(1)
    reads.clear()
    revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)
    for (const count of reads.values()) expect(count).toBe(1)

    const hostile = new Proxy({}, {
      ownKeys() { throw new RecoveryJournalError('RECOVERY_JOURNAL_CORRUPTION', 'forged') },
    })
    let forgedInspections = 0
    const forgedHostile = new Proxy({}, {
      ownKeys() { forgedInspections += 1; throw new Error('must not inspect') },
    })
    expectError(
      () => revalidateVerifiedCommittedRecoveryEvidenceToken({}, forgedHostile),
      'RECOVERY_EVIDENCE_TOKEN_INVALID'
    )
    expect(forgedInspections).toBe(0)
    expectError(
      () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, hostile),
      'INVALID_RECOVERY_OPTIONS'
    )
    expectError(
      () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, { ...valid, stateRevision: 66 }),
      'RECOVERY_EVIDENCE_BINDING_MISMATCH'
    )
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('retains nine close-on-exec path handles, revalidates without full hashing, and releases idempotently', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 66)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    let fullHashPasses = 0
    setRecoveryJournalInterArtifactHashTestHookForTest(() => { fullHashPasses += 1 })
    const token = verifyCommittedRecoveryEvidence(options)
    expect(fullHashPasses).toBe(1)
    expect(retainedFileDescriptors(operationRoot)).toHaveLength(9)
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
    expect(revalidateVerifiedCommittedRecoveryEvidenceToken(token, options).commitmentSha256).toBe(
      prepared.commitmentSha256
    )
    expect(fullHashPasses).toBe(1)
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
    expect(() => releaseVerifiedCommittedRecoveryEvidenceToken({})).not.toThrow()
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
    expectError(
      () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, options),
      'RECOVERY_EVIDENCE_TOKEN_RELEASED'
    )
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects replacement at each of the nine retained path boundaries with path-specific codes', () => {
    for (const [boundary, code] of [
      ['operationRoot', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['recoveryRoot', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['operations', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['operation', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['artifacts', 'RECOVERY_ARTIFACT_CORRUPTION'],
      ['records', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['record', 'RECOVERY_JOURNAL_CORRUPTION'],
      ['candidate', 'RECOVERY_ARTIFACT_CORRUPTION'],
      ['rollback', 'RECOVERY_ARTIFACT_CORRUPTION'],
    ]) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 67)
      const options = makeCommittedOptions(operationRoot, intent, prepared)
      const token = verifyCommittedRecoveryEvidence(options)
      const paths = committedBoundaryPaths(operationRoot, intent)
      replaceRetainedBoundary(paths[boundary], operationRoot)
      expectError(
        () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, options),
        code,
        boundary
      )
      releaseVerifiedCommittedRecoveryEvidenceToken(token)
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('closes every partially retained directory prefix when any directory open fails', () => {
    for (const boundary of [
      'operationRoot',
      'recoveryRoot',
      'operations',
      'operation',
      'artifacts',
      'records',
    ]) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 68)
      const options = makeCommittedOptions(operationRoot, intent, prepared)
      const paths = committedBoundaryPaths(operationRoot, intent)
      const backup = join(dirname(operationRoot), `failed-open-${boundary}-${randomUUID()}`)
      renameSync(paths[boundary], backup)
      expectError(
        () => verifyCommittedRecoveryEvidence(options),
        'RECOVERY_FILESYSTEM_FAILURE',
        boundary
      )
      expect(retainedFileDescriptors(dirname(operationRoot)), boundary).toEqual([])
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('preserves prepared artifact-open corruption while committed syscall opens fail as filesystem errors', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 69)
    const candidate = committedBoundaryPaths(operationRoot, intent).candidate
    const outside = join(dirname(operationRoot), `outside-${randomUUID()}`)
    copyFileSync(candidate, outside)
    unlinkSync(candidate)
    symlinkSync(outside, candidate, 'file')

    expectError(
      () => verifyPreparedMutationProof(prepared.proof, { operationRoot, stateRevision: 69, intent }),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
    expectError(
      () => verifyCommittedRecoveryEvidence(makeCommittedOptions(operationRoot, intent, prepared)),
      'RECOVERY_FILESYSTEM_FAILURE'
    )
    expect(retainedFileDescriptors(dirname(operationRoot))).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects inherited then before hashing without invoking the poison', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 69)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const originalThen = Object.getOwnPropertyDescriptor(Object.prototype, 'then')
    let thenReads = 0
    let installed = false
    let error
    Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          get() {
            thenReads += 1
            throw new Error('inherited then must not be read')
          },
        })
        installed = true
        return 0
      },
    })
    try {
      error = expectAnyError(() => verifyCommittedRecoveryEvidence(options))
    } finally {
      if (installed) {
        if (originalThen === undefined) Reflect.deleteProperty(Object.prototype, 'then')
        else Object.defineProperty(Object.prototype, 'then', originalThen)
      }
    }
    expect(error.code).toBe('INVALID_RECOVERY_OPTIONS')
    expect(thenReads).toBe(0)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects inherited retained-field poisons before opening recovery evidence', () => {
    for (const attack of ['setter', 'non-writable']) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 70)
      const options = makeCommittedOptions(operationRoot, intent, prepared)
      const originalRole = Object.getOwnPropertyDescriptor(Object.prototype, 'role')
      const originalExpectedSize = Object.getOwnPropertyDescriptor(Object.prototype, 'expectedSizeBytes')
      let roleInstalled = false
      let expectedSizeInstalled = false
      let error
      Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
        configurable: true,
        enumerable: true,
        get() {
          const descriptor = attack === 'setter'
            ? { configurable: true, set() { throw new Error(`inherited ${attack} setter reached`) } }
            : { configurable: true, value: 'inherited poison', writable: false }
          Object.defineProperty(Object.prototype, 'role', descriptor)
          roleInstalled = true
          Object.defineProperty(Object.prototype, 'expectedSizeBytes', descriptor)
          expectedSizeInstalled = true
          return 0
        },
      })
      try {
        error = expectAnyError(() => verifyCommittedRecoveryEvidence(options))
      } finally {
        if (roleInstalled) {
          if (originalRole === undefined) Reflect.deleteProperty(Object.prototype, 'role')
          else Object.defineProperty(Object.prototype, 'role', originalRole)
        }
        if (expectedSizeInstalled) {
          if (originalExpectedSize === undefined) Reflect.deleteProperty(Object.prototype, 'expectedSizeBytes')
          else Object.defineProperty(Object.prototype, 'expectedSizeBytes', originalExpectedSize)
        }
      }
      expect(error.code, attack).toBe('INVALID_RECOVERY_OPTIONS')
      expect(retainedFileDescriptors(operationRoot), attack).toEqual([])
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('isolates unprotected parent Dirent, Array, Worker, JSON, and Buffer-constructor poisons after broker readiness', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 71)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const direntTypeSymbol = probeDirentTypeSymbol()
    const poisonSymbol = Symbol('parent-only-poison')
    const defineProperty = Object.defineProperty
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
    const deleteProperty = Reflect.deleteProperty
    const originalOpendirSync = fs.opendirSync
    const originalReadSync = fs.Dir.prototype.readSync
    let opendirCalls = 0
    let readCalls = 0
    let poisonCalls = 0
    let finalGetterCalls = 0
    const throwPoison = (name) => function parentPoison() {
      poisonCalls += 1
      throw new Error(`${name} must remain isolated from broker and scanner`)
    }
    const mutations = [
      [fs.Dirent.prototype, 'name', { configurable: true, set: throwPoison('Dirent.name') }],
      [fs.Dirent.prototype, 'path', { configurable: true, set: throwPoison('Dirent.path') }],
      [fs.Dirent.prototype, direntTypeSymbol, { configurable: true, set: throwPoison('Dirent type') }],
      [Array.prototype, '0', { configurable: true, get: throwPoison('Array[0]'), set: throwPoison('Array[0]') }],
      [Array.prototype, poisonSymbol, { configurable: true, get: throwPoison('Array symbol') }],
      [Worker.prototype, 'on', { configurable: true, value: throwPoison('Worker.on'), writable: true }],
      [Worker.prototype, 'unref', { configurable: true, value: throwPoison('Worker.unref'), writable: true }],
      [JSON, 'parse', { configurable: true, value: throwPoison('JSON.parse'), writable: true }],
      [Buffer, 'from', { configurable: true, value: throwPoison('Buffer.from'), writable: true }],
    ]
    const originals = mutations.map(([target, key]) => [target, key, getOwnPropertyDescriptor(target, key)])
    fs.opendirSync = (...args) => { opendirCalls += 1; return originalOpendirSync(...args) }
    fs.Dir.prototype.readSync = function(...args) {
      readCalls += 1
      return originalReadSync.call(this, ...args)
    }
    syncBuiltinESMExports()
    defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        finalGetterCalls += 1
        for (const [target, key, descriptor] of mutations) defineProperty(target, key, descriptor)
        return 0
      },
    })

    let token
    let commitment
    try {
      token = verifyCommittedRecoveryEvidence(options)
      commitment = revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)
    } finally {
      for (let index = originals.length - 1; index >= 0; index -= 1) {
        const [target, key, descriptor] = originals[index]
        if (descriptor === undefined) deleteProperty(target, key)
        else defineProperty(target, key, descriptor)
      }
      fs.opendirSync = originalOpendirSync
      fs.Dir.prototype.readSync = originalReadSync
      syncBuiltinESMExports()
      if (token) releaseVerifiedCommittedRecoveryEvidenceToken(token)
    }
    expect(commitment).toEqual({
      commitmentSha256: prepared.commitmentSha256,
      durability: 'linux-fsync-complete',
    })
    expect(finalGetterCalls).toBe(2)
    expect(poisonCalls).toBe(0)
    expect(opendirCalls).toBe(0)
    expect(readCalls).toBe(0)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('revalidates fixed-shape retained evidence without enumeration after a prototype poison getter', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 73)
    const initialOptions = makeCommittedOptions(operationRoot, intent, prepared)
    const token = verifyCommittedRecoveryEvidence(initialOptions)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const original = Object.getOwnPropertyDescriptor(Array.prototype, '0')
    let installed = false
    let getterCalls = 0
    let setterCalls = 0
    Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(Array.prototype, '0', {
          configurable: true,
          get() { getterCalls += 1; return 'poison' },
          set() { setterCalls += 1 },
        })
        installed = true
        return 0
      },
    })
    let result
    try {
      result = revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)
    } finally {
      if (installed) {
        if (original === undefined) Reflect.deleteProperty(Array.prototype, '0')
        else Object.defineProperty(Array.prototype, '0', original)
      }
      releaseVerifiedCommittedRecoveryEvidenceToken(token)
    }
    expect(result).toEqual({
      commitmentSha256: prepared.commitmentSha256,
      durability: 'linux-fsync-complete',
    })
    expect(getterCalls).toBe(0)
    expect(setterCalls).toBe(0)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('still opens, retains, hashes, and rejects rollback when a final getter replaces array iteration', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 69)
    const paths = committedBoundaryPaths(operationRoot, intent)
    chmodSync(paths.rollback, 0o600)
    writeFileSync(paths.rollback, 'tampered rollback')
    chmodSync(paths.rollback, 0o400)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    let retainedHandlesAtInterHash = 0
    setRecoveryJournalInterArtifactHashTestHookForTest(() => {
      retainedHandlesAtInterHash = retainedFileDescriptors(operationRoot).length
    })
    const originalIterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)
    let roleIterations = 0
    Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(Array.prototype, Symbol.iterator, {
          configurable: true,
          writable: true,
          value: function* hostileArrayIterator() {
            if (this[0] === 'candidate' && this[1] === 'rollback') {
              roleIterations += 1
              yield this[0]
              if (roleIterations <= 2) yield this[1]
              return
            }
            for (let index = 0; index < this.length; index += 1) yield this[index]
          },
        })
        return 0
      },
    })
    let token
    let error
    try {
      try {
        token = verifyCommittedRecoveryEvidence(options)
      } catch (caught) {
        error = caught
      }
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, originalIterator)
    }
    if (token) releaseVerifiedCommittedRecoveryEvidenceToken(token)
    expect(retainedHandlesAtInterHash).toBe(9)
    expect(error?.code).toBe('RECOVERY_ARTIFACT_CORRUPTION')
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects an inter-artifact extra entry from the retained artifacts snapshot', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 74)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const paths = committedBoundaryPaths(operationRoot, intent)
    setRecoveryJournalInterArtifactHashTestHookForTest(() => {
      writeFileSync(join(paths.artifacts, 'inter-artifact-extra'), 'extra')
    })
    expectError(
      () => verifyCommittedRecoveryEvidence(options),
      'RECOVERY_ARTIFACT_CORRUPTION'
    )
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('rejects immutable directory changes from retained snapshots without re-enumeration', () => {
    for (const attack of [
      {
        name: 'artifact sidecar',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply(paths) { writeFileSync(join(paths.artifacts, 'candidate.sqlite-wal'), 'sidecar') },
      },
      {
        name: 'artifact extra entry',
        code: 'RECOVERY_ARTIFACT_CORRUPTION',
        apply(paths) { writeFileSync(join(paths.artifacts, 'unexpected'), 'extra') },
      },
      {
        name: 'operation extra entry',
        code: 'RECOVERY_JOURNAL_CORRUPTION',
        apply(paths) { writeFileSync(join(paths.operation, 'unexpected'), 'extra') },
      },
    ]) {
      const operationRoot = createOperationRoot()
      const intent = makeIntent('restore')
      const prepared = prepareDefault(operationRoot, intent, 70)
      const options = makeCommittedOptions(operationRoot, intent, prepared)
      const token = verifyCommittedRecoveryEvidence(options)
      attack.apply(committedBoundaryPaths(operationRoot, intent))
      expectError(
        () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, options),
        attack.code,
        attack.name
      )
      releaseVerifiedCommittedRecoveryEvidenceToken(token)
    }
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('allows operation siblings but rejects direct changes to the sealed recovery root', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 75)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const paths = committedBoundaryPaths(operationRoot, intent)
    const token = verifyCommittedRecoveryEvidence(options)
    const sibling = join(paths.operations, `sibling-${randomUUID()}`)
    mkdirSync(sibling, { mode: 0o700 })
    expect(revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)).toEqual({
      commitmentSha256: prepared.commitmentSha256,
      durability: 'linux-fsync-complete',
    })
    writeFileSync(join(paths.recoveryRoot, 'unexpected-direct-entry'), 'extra')
    expectError(
      () => revalidateVerifiedCommittedRecoveryEvidenceToken(token, options),
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    releaseVerifiedCommittedRecoveryEvidenceToken(token)
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('uses captured primordials after final getters through issuance and retained revalidation', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 71)
    const defineProperty = Object.defineProperty
    const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
    const deleteProperty = Reflect.deleteProperty
    const throwMutation = (name) => function hostileIntrinsic() {
      throw new Error(`ambient intrinsic reached: ${name}`)
    }
    const mutations = [
      ['Array isArray', Array, 'isArray'],
      ['Array iterator', Array.prototype, Symbol.iterator],
      ['Array map', Array.prototype, 'map'],
      ['Array filter', Array.prototype, 'filter'],
      ['Array push', Array.prototype, 'push'],
      ['Array includes', Array.prototype, 'includes'],
      ['Array sort', Array.prototype, 'sort'],
      ['Array some', Array.prototype, 'some'],
      ['Array find', Array.prototype, 'find'],
      ['JSON parse', JSON, 'parse'],
      ['RegExp test', RegExp.prototype, 'test'],
      ['RegExp exec', RegExp.prototype, 'exec'],
      ['Buffer alloc', Buffer, 'alloc'],
      ['Buffer allocUnsafe', Buffer, 'allocUnsafe'],
      ['Buffer byteLength', Buffer, 'byteLength'],
      ['Buffer compare', Buffer, 'compare'],
      ['Buffer from', Buffer, 'from'],
      ['String charCodeAt', String.prototype, 'charCodeAt'],
      ['String split', String.prototype, 'split'],
      ['String toLowerCase', String.prototype, 'toLowerCase'],
      ['Number isNaN', Number, 'isNaN'],
      ['Number isSafeInteger', Number, 'isSafeInteger'],
      ['Math min', Math, 'min'],
      ['Date constructor', globalThis, 'Date'],
      ['Number constructor', globalThis, 'Number'],
      ['BigInt constructor', globalThis, 'BigInt'],
      ['String constructor', globalThis, 'String'],
      ['TypeError constructor', globalThis, 'TypeError'],
      ['Object create', Object, 'create'],
      ['Object defineProperties', Object, 'defineProperties'],
      ['Object defineProperty', Object, 'defineProperty'],
      ['Object freeze', Object, 'freeze'],
      ['Object getOwnPropertyDescriptor', Object, 'getOwnPropertyDescriptor'],
      ['Object getOwnPropertySymbols', Object, 'getOwnPropertySymbols'],
      ['Object getPrototypeOf', Object, 'getPrototypeOf'],
      ['Object is', Object, 'is'],
      ['Object keys', Object, 'keys'],
      ['Reflect get', Reflect, 'get'],
      ['Reflect ownKeys', Reflect, 'ownKeys'],
      ['Map get', Map.prototype, 'get'],
      ['Map set', Map.prototype, 'set'],
      ['Map has', Map.prototype, 'has'],
      ['Map values', Map.prototype, 'values'],
      ['WeakMap get', WeakMap.prototype, 'get'],
      ['WeakMap set', WeakMap.prototype, 'set'],
      ['Set add', Set.prototype, 'add'],
      ['Set has', Set.prototype, 'has'],
      ['WeakSet add', WeakSet.prototype, 'add'],
      ['WeakSet has', WeakSet.prototype, 'has'],
      ['Date getTime', Date.prototype, 'getTime'],
      ['Date toISOString', Date.prototype, 'toISOString'],
      ['RecoveryJournalError hasInstance', RecoveryJournalError, Symbol.hasInstance],
    ]

    const runWithFinalMutation = (mutation, action) => {
      const [name, target, key] = mutation
      const original = getOwnPropertyDescriptor(target, key)
      let installed = false
      const options = makeCommittedOptions(operationRoot, intent, prepared)
      defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
        configurable: true,
        enumerable: true,
        get() {
          defineProperty(target, key, {
            configurable: true,
            writable: true,
            value: throwMutation(name),
          })
          installed = true
          return 0
        },
      })
      try {
        return action(options)
      } finally {
        if (installed) {
          if (original === undefined) deleteProperty(target, key)
          else defineProperty(target, key, original)
        }
      }
    }

    for (const mutation of mutations) {
      let token
      try {
        token = runWithFinalMutation(mutation, (options) =>
          verifyCommittedRecoveryEvidence(options)
        )
        expect(retainedFileDescriptors(operationRoot), mutation[0]).toHaveLength(9)
        runWithFinalMutation(mutation, (options) =>
          revalidateVerifiedCommittedRecoveryEvidenceToken(token, options)
        )
      } finally {
        if (token) releaseVerifiedCommittedRecoveryEvidenceToken(token)
      }
      expect(retainedFileDescriptors(operationRoot), mutation[0]).toEqual([])
    }
  })

  it('defines internal error fields independently of hostile error prototypes and private-brands authority', () => {
    const prototypeMutations = [
      [
        RecoveryJournalError.prototype,
        'name',
        {
          configurable: true,
          get() {
            return 'ForgedRecoveryJournalError'
          },
        },
      ],
      [
        RecoveryJournalError.prototype,
        'code',
        { configurable: true, value: 'RECOVERY_ARTIFACT_CORRUPTION', writable: false },
      ],
      [
        RecoveryJournalError.prototype,
        'cause',
        {
          configurable: true,
          get() {
            return new Error('forged inherited recovery cause')
          },
          set() {
            throw new Error('inherited recovery cause setter reached')
          },
        },
      ],
      [Error.prototype, 'name', { configurable: true, value: 'ForgedError', writable: false }],
      [
        Error.prototype,
        'code',
        {
          configurable: true,
          get() {
            return 'RECOVERY_JOURNAL_CORRUPTION'
          },
          set() {
            throw new Error('inherited boundary code setter reached')
          },
        },
      ],
      [
        Error.prototype,
        'cause',
        { configurable: true, value: new Error('forged boundary cause'), writable: false },
      ],
    ]
    const originals = prototypeMutations.map(([target, key]) => [
      target,
      key,
      Object.getOwnPropertyDescriptor(target, key),
    ])
    let callerError
    let internalError
    let callerDescriptors
    let internalDescriptors
    try {
      for (const [target, key, descriptor] of prototypeMutations) {
        Object.defineProperty(target, key, descriptor)
      }
      callerError = new RecoveryJournalError(
        'RECOVERY_ARTIFACT_CORRUPTION',
        'caller-forged protocol error',
        new Error('caller cause')
      )
      internalError = expectAnyError(() =>
        verifyCommittedRecoveryEvidence(
          new Proxy(
            {},
            {
              ownKeys() {
                throw callerError
              },
            }
          )
        )
      )
      callerDescriptors = Object.getOwnPropertyDescriptors(callerError)
      internalDescriptors = Object.getOwnPropertyDescriptors(internalError)
    } finally {
      for (let index = originals.length - 1; index >= 0; index -= 1) {
        const [target, key, descriptor] = originals[index]
        if (descriptor === undefined) Reflect.deleteProperty(target, key)
        else Object.defineProperty(target, key, descriptor)
      }
    }

    expect(callerDescriptors.name).toMatchObject({
      configurable: true,
      enumerable: true,
      value: 'RecoveryJournalError',
      writable: true,
    })
    expect(callerDescriptors.code).toMatchObject({
      configurable: true,
      enumerable: true,
      value: 'RECOVERY_ARTIFACT_CORRUPTION',
      writable: true,
    })
    expect(callerDescriptors.cause).toMatchObject({
      configurable: true,
      enumerable: false,
      writable: true,
    })
    expect(internalDescriptors.name.value).toBe('RecoveryJournalError')
    expect(internalDescriptors.code).toMatchObject({
      configurable: true,
      enumerable: true,
      value: 'INVALID_RECOVERY_OPTIONS',
      writable: true,
    })
    expect(internalDescriptors.cause).toMatchObject({
      configurable: true,
      enumerable: false,
      value: callerError,
      writable: true,
    })
    expect(internalError.code).toBe('INVALID_RECOVERY_OPTIONS')
    expect(internalError.cause).toBe(callerError)
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('does not trust caller-created protocol errors or mutable Symbol.hasInstance', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 72)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    const forged = new RecoveryJournalError('RECOVERY_ARTIFACT_CORRUPTION', 'forged')
    Object.defineProperty(options.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() { throw forged },
    })
    const originalHasInstance = Object.getOwnPropertyDescriptor(
      RecoveryJournalError,
      Symbol.hasInstance
    )
    let hasInstanceCalls = 0
    let error
    try {
      Object.defineProperty(RecoveryJournalError, Symbol.hasInstance, {
        configurable: true,
        value() { hasInstanceCalls += 1; return true },
      })
      error = expectAnyError(() => verifyCommittedRecoveryEvidence(options))
    } finally {
      if (originalHasInstance === undefined) delete RecoveryJournalError[Symbol.hasInstance]
      else Object.defineProperty(RecoveryJournalError, Symbol.hasInstance, originalHasInstance)
    }
    expect(error.code).toBe('INVALID_RECOVERY_OPTIONS')
    expect(hasInstanceCalls).toBe(0)

    const sidecar = join(preparedPaths(operationRoot, intent).artifacts, 'candidate.sqlite-wal')
    writeFileSync(sidecar, 'sidecar')
    const corrupted = makeCommittedOptions(operationRoot, intent, prepared)
    Object.defineProperty(corrupted.intent.recoveryCommitment, 'shikin.recovery.claimSequence', {
      configurable: true,
      enumerable: true,
      get() {
        Object.defineProperty(RecoveryJournalError, Symbol.hasInstance, {
          configurable: true,
          value() { hasInstanceCalls += 1; return true },
        })
        return 0
      },
    })
    try {
      expectError(
        () => verifyCommittedRecoveryEvidence(corrupted),
        'RECOVERY_ARTIFACT_CORRUPTION'
      )
    } finally {
      if (originalHasInstance === undefined) delete RecoveryJournalError[Symbol.hasInstance]
      else Object.defineProperty(RecoveryJournalError, Symbol.hasInstance, originalHasInstance)
      unlinkSync(sidecar)
    }
    expect(hasInstanceCalls).toBe(0)

    setRecoveryJournalInterArtifactHashTestHookForTest(() => { throw forged })
    expectError(
      () => verifyCommittedRecoveryEvidence(makeCommittedOptions(operationRoot, intent, prepared)),
      'RECOVERY_FILESYSTEM_FAILURE'
    )
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  // prettier-ignore
  it.runIf(process.platform === 'linux')('closes retained descriptors on representative full-verification failures', () => {
    const operationRoot = createOperationRoot()
    const intent = makeIntent('restore')
    const prepared = prepareDefault(operationRoot, intent, 73)
    const options = makeCommittedOptions(operationRoot, intent, prepared)
    setRecoveryJournalInterArtifactHashTestHookForTest(() => {
      throw new Error('committed inter-hash failure')
    })
    expectError(() => verifyCommittedRecoveryEvidence(options), 'RECOVERY_FILESYSTEM_FAILURE')
    expect(retainedFileDescriptors(operationRoot)).toEqual([])

    const rollback = join(
      preparedPaths(operationRoot, intent).artifacts,
      readdirSync(preparedPaths(operationRoot, intent).artifacts).find((name) =>
        name.startsWith('rollback-')
      )
    )
    setRecoveryJournalInterArtifactHashTestHookForTest(() => {
      renameSync(rollback, join(operationRoot, 'missing-rollback'))
    })
    expectError(() => verifyCommittedRecoveryEvidence(options), 'RECOVERY_FILESYSTEM_FAILURE')
    expect(retainedFileDescriptors(operationRoot)).toEqual([])
  })

  it.runIf(process.platform !== 'linux')(
    'preserves committed input and token precedence before unsupported-platform failure',
    () => {
      const intent = makeIntent('restore')
      const valid = makeCommittedOptions(syntheticOperationRoot(), intent, {
        commitmentSha256: 'a'.repeat(64),
      })
      const missing = structuredClone(valid)
      delete missing.intent.recoveryCommitment
      expectError(() => verifyCommittedRecoveryEvidence(missing), 'RECOVERY_COMMITMENT_REQUIRED')
      expectError(() => verifyCommittedRecoveryEvidence(valid), 'RECOVERY_DURABILITY_FAILURE')
      let inspected = 0
      const hostile = new Proxy(
        {},
        {
          ownKeys() {
            inspected += 1
            throw new Error('must not inspect')
          },
        }
      )
      expectError(
        () => revalidateVerifiedCommittedRecoveryEvidenceToken({}, hostile),
        'RECOVERY_EVIDENCE_TOKEN_INVALID'
      )
      expect(inspected).toBe(0)
    }
  )

  it('enforces the 16 KiB scalar binding limit before filesystem access', () => {
    const intent = makeIntent('restore')
    const prepared = { commitmentSha256: 'a'.repeat(64) }
    const template = makeCommittedOptions(syntheticOperationRoot(), intent, prepared)
    const fixedBytes = committedScalarBytes(template) - Buffer.byteLength(template.operationRoot)
    const rootBytes = 16_384 - fixedBytes
    const oneByteRoot = syntheticOperationRoot('a')
    const rootOverhead = Buffer.byteLength(oneByteRoot) - 1
    const fillerLength = rootBytes - rootOverhead
    const atLimit = {
      ...template,
      operationRoot: syntheticOperationRoot('a'.repeat(fillerLength)),
    }
    expect(committedScalarBytes(atLimit)).toBe(16_384)
    const atLimitError = expectAnyError(() => verifyCommittedRecoveryEvidence(atLimit))
    expect(atLimitError.code).not.toBe('INVALID_RECOVERY_OPTIONS')
    expectError(
      () =>
        verifyCommittedRecoveryEvidence({
          ...atLimit,
          operationRoot: syntheticOperationRoot('a'.repeat(fillerLength + 1)),
        }),
      'INVALID_RECOVERY_OPTIONS'
    )
  })
})

describe('fault injection and restart disposition', () => {
  // prettier-ignore
  it.runIf(process.platform === 'linux')('throws only after real operations and applies the required retry disposition at every point', () => {
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

  // prettier-ignore
  it.runIf(process.platform === 'linux')('ignores the test fault variable outside NODE_ENV=test and rejects unknown test points', () => {
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

function makeCommittedOptions(operationRoot, intent, prepared, overrides = {}) {
  const claimSequence = overrides.claimSequence ?? 0
  return {
    operationRoot,
    stateRevision: overrides.stateRevision ?? 1,
    intent: {
      recordKind: 'exclusive_intent',
      operationId: intent.operationId,
      operation: intent.operation,
      phase: overrides.phase ?? 'mutating',
      owner: structuredClone(overrides.owner ?? intent.owner),
      fencingGeneration: overrides.fencingGeneration ?? intent.fencingGeneration + claimSequence,
      createdAt: intent.createdAt,
      updatedAt: overrides.updatedAt ?? intent.updatedAt,
      recoveryCommitment: {
        'shikin.recovery.protocol': 'shikin.database-operation-recovery-journal',
        'shikin.recovery.version': 1,
        'shikin.recovery.recordSha256': prepared.commitmentSha256,
        'shikin.recovery.durability': 'linux-fsync-complete',
        'shikin.recovery.claimSequence': claimSequence,
      },
    },
  }
}

function currentRecordHash(paths) {
  const name = readdirSync(paths.records)[0]
  return /^00000000000000000000-([0-9a-f]{64})\.json$/.exec(name)[1]
}

function journalWriteManifest(root) {
  const entries = []
  const visit = (path) => {
    const stat = lstatSync(path, { bigint: true })
    const entry = {
      path: relative(root, path) || '.',
      mode: Number(stat.mode & 0o777n),
      size: stat.size.toString(),
      mtimeNs: stat.mtimeNs.toString(),
      ctimeNs: stat.ctimeNs.toString(),
    }
    if (stat.isFile()) {
      entry.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
    entries.push(entry)
    if (stat.isDirectory()) {
      for (const name of readdirSync(path).sort()) visit(join(path, name))
    }
  }
  visit(root)
  return entries
}

function committedBoundaryPaths(operationRoot, intent) {
  const prepared = preparedPaths(operationRoot, intent)
  const artifacts = readdirSync(prepared.artifacts)
  return {
    operationRoot,
    recoveryRoot: join(operationRoot, 'recovery-journal-v1'),
    operations: join(operationRoot, 'recovery-journal-v1', 'operations'),
    operation: prepared.operation,
    artifacts: prepared.artifacts,
    records: prepared.records,
    record: join(prepared.records, readdirSync(prepared.records)[0]),
    candidate: join(
      prepared.artifacts,
      artifacts.find((name) => name.startsWith('candidate-'))
    ),
    rollback: join(
      prepared.artifacts,
      artifacts.find((name) => name.startsWith('rollback-'))
    ),
  }
}

function replaceRetainedBoundary(path, operationRoot) {
  const backup = join(dirname(operationRoot), `retained-boundary-${randomUUID()}`)
  renameSync(path, backup)
  cpSync(backup, path, { recursive: true })
  sealFixtureTree(path)
}

function syntheticOperationRoot(filler = '') {
  const filesystemRoot = resolve('/')
  return filler.length === 0
    ? join(filesystemRoot, IDENTITY_HASH)
    : join(filesystemRoot, filler, IDENTITY_HASH)
}

function committedScalarBytes(options) {
  const { intent } = options
  return [
    options.operationRoot,
    DATABASE_IDENTITY,
    intent.recordKind,
    intent.operationId,
    intent.operation,
    intent.phase,
    intent.owner.ownerId,
    intent.owner.runtimeId,
    intent.owner.hostId,
    intent.owner.processStartedAt,
    intent.createdAt,
    intent.updatedAt,
    intent.recoveryCommitment['shikin.recovery.protocol'],
    intent.recoveryCommitment['shikin.recovery.recordSha256'],
    intent.recoveryCommitment['shikin.recovery.durability'],
  ].reduce((total, value) => total + Buffer.byteLength(value), 0)
}

function probeDirentTypeSymbol() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-dirent-symbol-probe-'))
  let directory
  try {
    writeFileSync(join(root, 'probe'), 'probe')
    directory = fs.opendirSync(root, { bufferSize: 1 })
    const entry = directory.readSync()
    const entryPrototype = entry === null ? null : Object.getPrototypeOf(entry)
    if (
      entry === null ||
      (entryPrototype !== fs.Dirent.prototype &&
        Object.getPrototypeOf(entryPrototype) !== fs.Dirent.prototype)
    ) {
      throw new Error('Could not obtain an fs.Dirent test probe')
    }
    const candidates = Object.getOwnPropertySymbols(entry).filter((symbol) => {
      const descriptor = Object.getOwnPropertyDescriptor(entry, symbol)
      return (
        descriptor !== undefined &&
        (descriptor.value === null || typeof descriptor.value === 'number')
      )
    })
    if (candidates.length !== 1) {
      throw new Error('Could not uniquely discover the internal fs.Dirent type symbol')
    }
    return candidates[0]
  } finally {
    if (directory !== undefined) directory.closeSync()
    rmSync(root, { recursive: true, force: true })
  }
}

function waitForMilliseconds(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function sourceFunctionBody(source, name) {
  const start = source.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`Missing source function ${name}`)
  const end = source.indexOf('\n}\n', start)
  if (end < 0) throw new Error(`Unterminated source function ${name}`)
  return source.slice(start, end + 2)
}

function committedFixtureSubprocessScript(actionSource, beforeImportSource = '') {
  return `
    import fs from 'node:fs'
    import os from 'node:os'
    import path from 'node:path'
    import crypto from 'node:crypto'
    import { pathToFileURL } from 'node:url'
    ${beforeImportSource}
    const tasksBeforeImport = fs.readdirSync('/proc/self/task').length
    const journal = await import(
      pathToFileURL(path.resolve('scripts/database-operation-recovery-journal.mjs')).href
    )
    await new Promise((resolveTurn) => setImmediate(resolveTurn))
    const golden = JSON.parse(
      fs.readFileSync(path.resolve('schema/database-operation-recovery-journal-v1-golden.json'), 'utf8')
    )
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shikin-persistent-broker-'))
    const operationRoot = path.join(
      root,
      crypto.createHash('sha256').update('com.asf.shikin:shikin.db').digest('hex')
    )
    fs.mkdirSync(operationRoot, { mode: 0o700 })
    fs.cpSync(
      path.resolve(golden.onDiskEvidenceFixture.root, 'recovery-journal-v1'),
      path.join(operationRoot, 'recovery-journal-v1'),
      { recursive: true }
    )
    const seal = (target) => {
      const stat = fs.lstatSync(target)
      if (stat.isDirectory()) {
        fs.chmodSync(target, 0o700)
        for (const name of fs.readdirSync(target)) seal(path.join(target, name))
      } else {
        fs.chmodSync(target, 0o400)
      }
    }
    seal(path.join(operationRoot, 'recovery-journal-v1'))
    const record = golden.preparedMutation.record
    const options = {
      operationRoot,
      stateRevision: 999,
      intent: {
        recordKind: 'exclusive_intent',
        operationId: record.operationId,
        operation: record.operation,
        phase: 'mutating',
        owner: structuredClone(record.owner),
        fencingGeneration: record.fencingGeneration,
        createdAt: record.createdAt,
        updatedAt: '2031-08-15T13:14:15.000Z',
        recoveryCommitment: {
          'shikin.recovery.protocol': 'shikin.database-operation-recovery-journal',
          'shikin.recovery.version': 1,
          'shikin.recovery.recordSha256': golden.onDiskEvidenceFixture.recordHash,
          'shikin.recovery.durability': 'linux-fsync-complete',
          'shikin.recovery.claimSequence': 0,
        },
      },
    }
    ${actionSource}
  `
}

function expectAnyError(action) {
  try {
    action()
  } catch (error) {
    return error
  }
  throw new Error('Expected an error')
}

function expectError(action, code, label = '') {
  const error = expectAnyError(action)
  expect(error?.code, label).toBe(code)
  return error
}
