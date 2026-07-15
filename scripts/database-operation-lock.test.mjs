// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DATABASE_OPERATION_PROTOCOL,
  SHIKIN_DATABASE_IDENTITY,
  DatabaseOperationLock,
  DatabaseOperationLockError,
  validateDatabaseOperationRecord,
} from './database-operation-lock.mjs'

const roots = []
const DATABASE_IDENTITY = SHIKIN_DATABASE_IDENTITY
const contractSchema = JSON.parse(
  readFileSync(resolve('schema/database-operation-lock-v1.json'), 'utf8')
)
const goldenFixtures = JSON.parse(
  readFileSync(resolve('schema/database-operation-lock-v1-golden.json'), 'utf8')
)
const ajv = new Ajv2020({ strict: false, discriminator: true })
addFormats(ajv)
const validateContractRecord = ajv.compile(contractSchema)

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('database operation lock core', () => {
  it('publishes state and mutex records that satisfy the immutable JSON contract', () => {
    const root = tempRoot()
    let observedMutex
    const lock = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      testHooks: {
        beforePublish({ mutex }) {
          observedMutex = mutex
        },
      },
    })
    lock.registerRuntimeLease()

    const state = lock.readOperationState()
    expect(validateContractRecord(state), JSON.stringify(validateContractRecord.errors)).toBe(true)
    expect(
      validateContractRecord(observedMutex),
      JSON.stringify(validateContractRecord.errors)
    ).toBe(true)
  })

  it('registers, renews, releases, and advances exact revisions and fencing', () => {
    const lock = createLock('cli')
    const owner = lock.getOwnerEvidence()
    let lease = lock.registerRuntimeLease()
    expect(lease.owner).toEqual(owner)
    expect(lock.readOperationState()).toMatchObject({
      stateRevision: 1,
      fencingGenerationHighWater: 1,
      leases: [{ leaseId: lease.leaseId, fencingGeneration: 1 }],
    })

    lease = lock.renewRuntimeLease(lease)
    expect(lock.readOperationState()).toMatchObject({
      stateRevision: 2,
      fencingGenerationHighWater: 1,
    })
    expect(lock.getLifecycleHealth()).toMatchObject({ healthy: true, fenced: false })
    const timer = lock.startHeartbeat(lease)
    expect(timer.hasRef()).toBe(false)
    lock.stopHeartbeat()

    expect(lock.releaseRuntimeLease(lease)).toBe(true)
    expect(lock.readOperationState()).toMatchObject({
      stateRevision: 3,
      fencingGenerationHighWater: 1,
      leases: [],
    })
  })

  it('rejects forged, released, and superseded lease authority without changing a successor', () => {
    const root = tempRoot()
    const original = createLockAt(root, 'cli')
    const firstLease = original.registerRuntimeLease()
    const forged = { ...firstLease, fencingGeneration: firstLease.fencingGeneration + 1 }
    expectLockError(() => original.renewRuntimeLease(forged), 'LEASE_FENCED')
    expect(original.readOperationState().stateRevision).toBe(1)

    original.releaseRuntimeLease(firstLease)
    const successor = createLockAt(root, 'mcp')
    const successorLease = successor.registerRuntimeLease()
    expectLockError(() => original.renewRuntimeLease(firstLease), 'LEASE_FENCED')
    expectLockError(() => original.releaseRuntimeLease(firstLease), 'LEASE_FENCED')
    expect(successor.assertRuntimeLeaseAuthority(successorLease)).toEqual(successorLease)
    expect(successor.readOperationState()).toMatchObject({
      stateRevision: 3,
      leases: [{ leaseId: successorLease.leaseId }],
    })
  })

  it('publishes intent with peer leases, drains every lease, and blocks only new registration', () => {
    const root = tempRoot()
    const owner = createLockAt(root, 'cli')
    const peer = createLockAt(root, 'mcp')
    const blocked = createLockAt(root, 'browser-data-server')
    let ownerLease = owner.registerRuntimeLease()
    let peerLease = peer.registerRuntimeLease()

    let intent = owner.acquireExclusiveIntent('restore', { fixture: true })
    expect(intent.phase).toBe('registered')
    expect(owner.readOperationState()).toMatchObject({
      stateRevision: 3,
      fencingGenerationHighWater: 3,
      leases: [{ leaseId: ownerLease.leaseId }, { leaseId: peerLease.leaseId }],
    })
    expect(owner.getLifecycleHealth()).toMatchObject({ shouldDrain: true, registered: true })
    expect(peer.getLifecycleHealth()).toMatchObject({ shouldDrain: true, registered: true })
    expectLockError(() => blocked.registerRuntimeLease(), 'EXCLUSIVE_INTENT_ACTIVE')

    ownerLease = owner.renewRuntimeLease(ownerLease)
    peerLease = peer.renewRuntimeLease(peerLease)
    intent = owner.drainExclusiveIntent(intent)
    expect(intent.phase).toBe('draining')
    peer.releaseRuntimeLease(peerLease)
    expect(owner.drainExclusiveIntent(intent).phase).toBe('draining')
    owner.releaseRuntimeLease(ownerLease)
    intent = owner.drainExclusiveIntent(intent)
    expect(intent.phase).toBe('exclusive')
    intent = owner.beginExclusiveMutation(intent)
    expect(owner.assertExclusiveAuthority(intent)).toEqual(intent)
    intent = owner.completeExclusiveMutation(intent)
    expect(intent).toMatchObject({ phase: 'completed', completedAt: expect.any(String) })
    expect(owner.clearExclusiveIntent(intent)).toBe(true)
    expect(owner.readOperationState()).toMatchObject({
      fencingGenerationHighWater: 3,
      exclusiveIntent: null,
      leases: [],
    })
  })

  it.each(['registered', 'draining', 'exclusive'])(
    'cancels a %s intent from stale descriptive evidence with exact lease and counter preservation',
    (phase) => {
      const { owner, peer, ownerLease, peerLease, intent } = cancelableIntentFixture(phase)
      const before = owner.readOperationState()
      const leaseBytes = JSON.stringify(before.leases)
      const stalePhase = phase === 'registered' ? 'exclusive' : 'registered'
      const evidence = {
        ...intent,
        operation: intent.operation === 'restore' ? 'import' : 'restore',
        phase: stalePhase,
      }

      expect(owner.cancelExclusiveIntent(evidence)).toBe(true)
      const after = owner.readOperationState()
      expect(after).toMatchObject({
        stateRevision: before.stateRevision + 1,
        fencingGenerationHighWater: before.fencingGenerationHighWater + 1,
        exclusiveIntent: null,
      })
      expect(JSON.stringify(after.leases)).toBe(leaseBytes)
      if (ownerLease !== null)
        expect(owner.assertRuntimeLeaseAuthority(ownerLease)).toEqual(ownerLease)
      if (peerLease !== null) expect(peer.assertRuntimeLeaseAuthority(peerLease)).toEqual(peerLease)
      expectLockError(() => owner.assertExclusiveAuthority(intent, phase), 'INTENT_FENCED')
    }
  )

  it.each(['mutating', 'completed', 'abandoned'])(
    'rejects cancellation from persisted %s after applying authority-before-phase precedence',
    (phase) => {
      const { owner, intent } = cancelableIntentFixture('exclusive')
      if (phase === 'mutating' || phase === 'completed') {
        const mutating = owner.beginExclusiveMutation(intent)
        if (phase === 'completed') owner.completeExclusiveMutation(mutating)
      } else {
        rewriteAuthoritativeState(owner, (state) => {
          state.exclusiveIntent.phase = 'abandoned'
          return state
        })
      }
      const before = owner.readOperationState()
      const stalePhaseEvidence = { ...intent, phase: 'registered' }

      expectLockError(
        () =>
          owner.cancelExclusiveIntent({
            ...stalePhaseEvidence,
            operationId: `wrong-${intent.operationId}`,
          }),
        'INTENT_FENCED'
      )
      expect(owner.readOperationState()).toEqual(before)
      expectLockError(() => owner.cancelExclusiveIntent(stalePhaseEvidence), 'INTENT_PHASE_INVALID')
      expect(owner.readOperationState()).toEqual(before)
    }
  )

  it('fences absent and mismatched cancellation evidence without self-fencing the caller', () => {
    const { owner, peer, intent } = cancelableIntentFixture('registered')
    const before = owner.readOperationState()

    for (const evidence of [
      { ...intent, operationId: `wrong-${intent.operationId}` },
      { ...intent, fencingGeneration: intent.fencingGeneration + 1 },
    ]) {
      expectLockError(() => owner.cancelExclusiveIntent(evidence), 'INTENT_FENCED')
      expect(owner.readOperationState()).toEqual(before)
    }

    const callerMismatch = { ...intent, owner: peer.getOwnerEvidence() }
    expectLockError(() => owner.cancelExclusiveIntent(callerMismatch), 'INTENT_FENCED')
    expect(owner.getLifecycleHealth()).toMatchObject({ fenced: false, registered: true })
    expect(owner.readOperationState()).toEqual(before)

    expectLockError(() => peer.cancelExclusiveIntent(callerMismatch), 'INTENT_FENCED')
    expect(peer.getLifecycleHealth()).toMatchObject({ fenced: false, registered: true })
    expect(owner.readOperationState()).toEqual(before)

    expectLockError(
      () => owner.cancelExclusiveIntent({ ...intent, phase: 'not-a-phase' }),
      'STATE_CORRUPTION'
    )
    expect(owner.readOperationState()).toEqual(before)

    expect(owner.cancelExclusiveIntent(intent)).toBe(true)
    const cancelled = owner.readOperationState()
    expectLockError(() => owner.cancelExclusiveIntent(intent), 'INTENT_FENCED')
    expect(owner.readOperationState()).toEqual(cancelled)
  })

  it.each(['stateRevision', 'fencingGenerationHighWater'])(
    'rejects independent %s overflow with COUNTER_OVERFLOW and no state change',
    (counter) => {
      const { owner, intent } = cancelableIntentFixture('registered')
      rewriteAuthoritativeState(owner, (state) => {
        state[counter] = Number.MAX_SAFE_INTEGER
        return state
      })
      const before = owner.readOperationState()

      expectLockError(() => owner.cancelExclusiveIntent(intent), 'COUNTER_OVERFLOW')
      expect(owner.readOperationState()).toEqual(before)
    }
  )

  it('keeps cancellation unchanged on prepublication failure and classifies committed faults', () => {
    let armed = false
    const beforePublish = cancelableIntentFixture('registered', {
      afterPrune: () => {
        if (armed) throw new Error('cancel after prune')
      },
    })
    const before = beforePublish.owner.readOperationState()
    armed = true
    expectLockError(
      () => beforePublish.owner.cancelExclusiveIntent(beforePublish.intent),
      'FILESYSTEM_FAILURE'
    )
    expect(beforePublish.owner.readOperationState()).toEqual(before)
    expect(beforePublish.owner.getLifecycleHealth()).toMatchObject({
      fenced: false,
      lastCommittedStateRevision: before.stateRevision,
    })

    armed = false
    const afterRename = cancelableIntentFixture('registered', {
      afterRename: () => {
        if (armed) throw new Error('cancel after rename')
      },
    })
    const renameBefore = afterRename.owner.readOperationState()
    armed = true
    expect(afterRename.owner.cancelExclusiveIntent(afterRename.intent)).toBe(true)
    expect(afterRename.owner.readOperationState()).toMatchObject({
      stateRevision: renameBefore.stateRevision + 1,
      fencingGenerationHighWater: renameBefore.fencingGenerationHighWater + 1,
      exclusiveIntent: null,
    })
    expect(afterRename.owner.getLifecycleHealth()).toMatchObject({
      fenced: true,
      registered: false,
      durabilityUncertain: true,
      lastCommittedStateRevision: renameBefore.stateRevision + 1,
    })

    armed = false
    const unsupported = cancelableIntentFixture('registered', {
      directorySync: () => (armed ? false : undefined),
    })
    const unsupportedBefore = unsupported.owner.readOperationState()
    armed = true
    expect(unsupported.owner.cancelExclusiveIntent(unsupported.intent)).toBe(true)
    expect(unsupported.owner.readOperationState()).toMatchObject({
      stateRevision: unsupportedBefore.stateRevision + 1,
      fencingGenerationHighWater: unsupportedBefore.fencingGenerationHighWater + 1,
      exclusiveIntent: null,
    })
    expect(unsupported.owner.getLifecycleHealth()).toMatchObject({
      fenced: false,
      registered: true,
      shouldDrain: false,
      maintenanceDegraded: true,
      durabilityUncertain: false,
      lastCommittedStateRevision: unsupportedBefore.stateRevision + 1,
    })

    for (const hook of ['afterFsync', 'afterRelease']) {
      armed = false
      const committed = cancelableIntentFixture('registered', {
        [hook]: () => {
          if (armed) throw new Error(`cancel ${hook}`)
        },
      })
      const committedBefore = committed.owner.readOperationState()
      armed = true
      expect(committed.owner.cancelExclusiveIntent(committed.intent)).toBe(true)
      expect(committed.owner.readOperationState()).toMatchObject({
        stateRevision: committedBefore.stateRevision + 1,
        fencingGenerationHighWater: committedBefore.fencingGenerationHighWater + 1,
        exclusiveIntent: null,
      })
      expect(committed.owner.getLifecycleHealth()).toMatchObject({
        fenced: false,
        registered: true,
        shouldDrain: false,
        maintenanceDegraded: true,
        durabilityUncertain: false,
        lastCommittedStateRevision: committedBefore.stateRevision + 1,
      })
    }
  })

  it('orders cancel-then-begin and begin-then-cancel as a fenced state machine', () => {
    const cancelFirst = cancelableIntentFixture('exclusive')
    expect(cancelFirst.owner.cancelExclusiveIntent(cancelFirst.intent)).toBe(true)
    expectLockError(
      () => cancelFirst.owner.beginExclusiveMutation(cancelFirst.intent),
      'INTENT_FENCED'
    )

    const beginFirst = cancelableIntentFixture('exclusive')
    const mutating = beginFirst.owner.beginExclusiveMutation(beginFirst.intent)
    const beforeRejectedCancel = beginFirst.owner.readOperationState()
    expectLockError(() => beginFirst.owner.cancelExclusiveIntent(mutating), 'INTENT_PHASE_INVALID')
    expect(beginFirst.owner.readOperationState()).toEqual(beforeRejectedCancel)
  })

  it('requires one exact unexpired own lease without changing state on rejected admission', () => {
    const noOwn = createLock('tauri')
    const initial = noOwn.readOperationState()
    expectLockError(() => noOwn.acquireExclusiveIntent('import'), 'LEASE_REQUIRED')
    expect(noOwn.readOperationState()).toMatchObject({
      stateRevision: initial.stateRevision,
      fencingGenerationHighWater: initial.fencingGenerationHighWater,
      leases: [],
      exclusiveIntent: null,
    })

    const root = tempRoot()
    let now = Date.now()
    const expired = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      leaseTtlMs: 5_000,
      heartbeatIntervalMs: 1_000,
      clock: () => now,
    })
    expired.registerRuntimeLease()
    now += 5_000
    const expiredState = expired.readOperationState()
    expectLockError(() => expired.acquireExclusiveIntent('restore'), 'LEASE_EXPIRED')
    expect(expired.readOperationState()).toEqual(expiredState)

    const forgedRoot = tempRoot()
    const forgedOwner = createLockAt(forgedRoot, 'mcp')
    forgedOwner.registerRuntimeLease()
    const path = highestStateFile(forgedOwner)
    const forgedState = JSON.parse(readFileSync(path, 'utf8'))
    forgedState.leases[0].owner.processStartedAt = '2000-01-01T00:00:00.000Z'
    writePrivateJson(path, forgedState, false)
    const before = forgedOwner.readOperationState()
    expectLockError(() => forgedOwner.acquireExclusiveIntent('restore'), 'LEASE_FENCED')
    expect(forgedOwner.readOperationState()).toEqual(before)
  })

  it('preserves all leases under concurrent real worker-process registration', async () => {
    const root = tempRoot()
    const forbiddenHome = join(root, 'must-not-resolve-home')
    const runtimeIds = ['cli', 'mcp', 'browser-data-server', 'tauri', 'cli', 'mcp']
    const results = await Promise.all(
      runtimeIds.map((runtimeId) => runWorker(root, runtimeId, 0, forbiddenHome))
    )
    const observer = createLockAt(root, 'tauri')
    const state = observer.readOperationState()

    expect(state.stateRevision).toBe(runtimeIds.length)
    expect(state.fencingGenerationHighWater).toBe(runtimeIds.length)
    expect(state.leases).toHaveLength(runtimeIds.length)
    expect(new Set(state.leases.map((lease) => lease.leaseId)).size).toBe(runtimeIds.length)
    expect(new Set(state.leases.map((lease) => lease.owner.ownerId)).size).toBe(runtimeIds.length)
    expect(new Set(state.leases.map((lease) => lease.owner.hostId)).size).toBe(1)
    expect(results.map((result) => result.lease.leaseId).sort()).toEqual(
      state.leases.map((lease) => lease.leaseId).sort()
    )
    expect(existsSync(forbiddenHome)).toBe(false)
  })

  it('does not steal a live expired lease and lets its owner release it', () => {
    const root = tempRoot()
    const liveOwner = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      leaseTtlMs: 5_000,
      heartbeatIntervalMs: 1_000,
      clock: () => Date.now() - 10_000,
    })
    const expiredLease = liveOwner.registerRuntimeLease()
    const cleaner = createLockAt(root, 'tauri')

    expect(cleaner.cleanupStaleRecords()).toMatchObject({ removedLeaseIds: [] })
    expect(cleaner.readOperationState()).toMatchObject({ stateRevision: 1 })
    expect(cleaner.readOperationState().leases).toHaveLength(1)
    expect(liveOwner.releaseRuntimeLease(expiredLease)).toBe(true)
    expect(cleaner.readOperationState()).toMatchObject({ stateRevision: 2, leases: [] })
  })

  it('reclaims an expired lease only after real dead-process evidence', async () => {
    const root = tempRoot()
    const worker = await runWorker(root, 'mcp', -40_000, join(root, 'forbidden-home'))
    const cleaner = createLockAt(root, 'tauri')
    const cleanup = cleaner.cleanupStaleRecords()

    expect(cleanup.removedLeaseIds).toEqual([worker.lease.leaseId])
    expect(cleanup.stateRevision).toBe(2)
    expect(cleaner.readOperationState()).toMatchObject({ stateRevision: 2, leases: [] })
  })

  it('publishes only complete mutex candidates and recovers from a pre-publication crash', () => {
    const root = tempRoot()
    let candidatePath
    let publicationObserved = false
    const interrupted = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      testHooks: {
        beforeMutexPublication(context) {
          candidatePath = context.candidatePath
          expect(existsSync(context.mutexPath)).toBe(false)
          expect(readCompleteMutex(context.candidatePath)).toEqual(context.mutex)
          throw new Error('simulated crash before mutex publication')
        },
        afterMutexPublication() {
          publicationObserved = true
        },
      },
    })

    expectLockError(() => interrupted.registerRuntimeLease(), 'FILESYSTEM_FAILURE')
    expect(publicationObserved).toBe(false)
    expect(existsSync(interrupted.getPaths().registrationMutex)).toBe(false)
    expect(readCompleteMutex(candidatePath)).toMatchObject({ recordKind: 'registration_mutex' })

    const successor = createLockAt(root, 'tauri')
    expect(successor.registerRuntimeLease()).toMatchObject({ recordKind: 'runtime_lease' })
    expect(successor.readOperationState()).toMatchObject({ stateRevision: 1 })
    expect(existsSync(successor.getPaths().registrationMutex)).toBe(false)
  })

  it('never restores a quarantine over an atomically published successor mutex', async () => {
    const root = tempRoot()
    const replacementOwner = createLockAt(root, 'tauri').getOwnerEvidence()
    const publicationBarrier = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2)
    )
    let successorRecord
    let successorCompletion
    let restoreObserved = false
    const holder = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      testHooks: {
        afterMutexQuarantine({ quarantine, mutexPath }) {
          const movedReplacement = mutexRecord(replacementOwner, Date.now(), randomUUID())
          rmSync(quarantine, { recursive: true })
          publishCompleteMutex(quarantine, movedReplacement)

          const worker = new Worker(
            `
              const { parentPort, workerData } = require('node:worker_threads')
              ;(async () => {
                const { DatabaseOperationLock } = await import(workerData.moduleUrl)
                const barrier = new Int32Array(workerData.barrier)
                const lock = new DatabaseOperationLock({
                  rootDir: workerData.root,
                  databaseIdentity: workerData.databaseIdentity,
                  runtimeId: 'tauri',
                  testHooks: {
                    afterMutexPublication() {
                      Atomics.store(barrier, 0, 1)
                      Atomics.notify(barrier, 0)
                      Atomics.wait(barrier, 1, 0)
                    },
                  },
                })
                const lease = lock.registerRuntimeLease()
                parentPort.postMessage({ ok: true, lease })
              })().catch((error) =>
                parentPort.postMessage({ ok: false, error: String(error?.stack ?? error) })
              )
            `,
            {
              eval: true,
              workerData: {
                moduleUrl: new URL('./database-operation-lock.mjs', import.meta.url).href,
                barrier: publicationBarrier.buffer,
                root,
                databaseIdentity: DATABASE_IDENTITY,
              },
            }
          )
          successorCompletion = new Promise((resolve, reject) => {
            worker.once('message', (message) =>
              message.ok ? resolve(message.lease) : reject(new Error(message.error))
            )
            worker.once('error', reject)
          })
          expect(Atomics.wait(publicationBarrier, 0, 0, 5_000)).toBe('ok')
          successorRecord = readCompleteMutex(mutexPath)
        },
        beforeMutexRestore({ quarantine, mutexPath }) {
          restoreObserved = true
          expect(readCompleteMutex(quarantine)).toBeDefined()
          expect(readCompleteMutex(mutexPath)).toEqual(successorRecord)
        },
      },
    })

    let lease
    try {
      lease = holder.registerRuntimeLease()
      expect(lease).toMatchObject({ recordKind: 'runtime_lease' })
      expect(restoreObserved).toBe(true)
      expect(readCompleteMutex(holder.getPaths().registrationMutex)).toEqual(successorRecord)
      const [token] = readdirSync(holder.getPaths().registrationMutex)
      expect(readdirSync(join(holder.getPaths().registrationMutex, token))).toEqual(['mutex.json'])
    } finally {
      Atomics.store(publicationBarrier, 1, 1)
      Atomics.notify(publicationBarrier, 1)
    }
    const successorLease = await successorCompletion
    expect(holder.readOperationState()).toMatchObject({
      stateRevision: 2,
      leases: [{ leaseId: lease.leaseId }, { leaseId: successorLease.leaseId }],
    })
  })

  it('fences a delayed superseded mutex holder from publishing or removing its successor', () => {
    const root = tempRoot()
    const successor = createLockAt(root, 'tauri')
    const successorOwner = successor.getOwnerEvidence()
    let quarantinedOld
    let successorRecord
    const delayed = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      testHooks: {
        beforePublish({ mutexPath, nextState }) {
          quarantinedOld = `${mutexPath}.superseded-${randomUUID()}`
          renameSync(mutexPath, quarantinedOld)
          const mutexId = randomUUID()
          const tokenPath = join(mutexPath, `token-${mutexId}`)
          mkdirSync(tokenPath, { recursive: true, mode: 0o700 })
          const now = Date.now()
          successorRecord = {
            protocol: DATABASE_OPERATION_PROTOCOL,
            protocolVersion: 1,
            recordKind: 'registration_mutex',
            databaseIdentity: DATABASE_IDENTITY,
            mutexId,
            owner: successorOwner,
            acquiredAt: new Date(now).toISOString(),
            expiresAt: new Date(now + 5_000).toISOString(),
            ttlMs: 5_000,
          }
          writePrivateJson(join(tokenPath, 'mutex.json'), successorRecord)
          expect(nextState.stateRevision).toBe(1)
        },
      },
    })

    expectLockError(() => delayed.registerRuntimeLease(), 'MUTEX_FENCED')
    expect(existsSync(successor.getPaths().registrationMutex)).toBe(true)
    expect(readSuccessorMutex(successor)).toEqual(successorRecord)
    expect(successor.readOperationState().stateRevision).toBe(0)
    expect(existsSync(quarantinedOld)).toBe(true)
  })

  it('fails closed on malformed state, unknown fields, and duplicate highest revisions', () => {
    const lock = createLock('cli')
    lock.registerRuntimeLease()
    const stateFile = highestStateFile(lock)
    const state = JSON.parse(readFileSync(stateFile, 'utf8'))
    writePrivateJson(stateFile, { ...state, unknownField: true }, false)

    expectLockError(() => lock.readOperationState(), 'STATE_CORRUPTION')

    const duplicateRoot = tempRoot()
    const duplicateLock = createLockAt(duplicateRoot, 'mcp')
    duplicateLock.registerRuntimeLease()
    const originalPath = highestStateFile(duplicateLock)
    const duplicateName = originalPath.replace(/[0-9a-f-]{36}\.json$/, `${randomUUID()}.json`)
    writePrivateJson(duplicateName, JSON.parse(readFileSync(originalPath, 'utf8')))
    expectLockError(() => duplicateLock.readOperationState(), 'STATE_CORRUPTION')

    const malformedRoot = tempRoot()
    const malformedLock = createLockAt(malformedRoot, 'tauri')
    malformedLock.registerRuntimeLease()
    const malformedPath = highestStateFile(malformedLock)
    writeFileSync(malformedPath, '{not-json\n', { encoding: 'utf8', flag: 'w' })
    if (process.platform !== 'win32') chmodSync(malformedPath, 0o600)
    expectLockError(() => malformedLock.readOperationState(), 'STATE_CORRUPTION')
  })

  it.each(['registered', 'draining', 'exclusive', 'completed'])(
    'fences and removes a dead %s intent exactly once',
    async (phase) => {
      const root = tempRoot()
      const worker = await runWorker(
        root,
        'cli',
        0,
        join(root, 'forbidden-home'),
        `intent:${phase}`
      )
      const cleaner = createLockAt(root, 'tauri')
      const before = cleaner.readOperationState()
      const cleanup = cleaner.cleanupStaleRecords()
      expect(cleanup).toEqual({
        removedLeaseIds: [],
        abandonedIntent: true,
        stateRevision: before.stateRevision + 1,
      })
      expect(cleaner.readOperationState()).toMatchObject({
        stateRevision: before.stateRevision + 1,
        fencingGenerationHighWater: before.fencingGenerationHighWater + 1,
        exclusiveIntent: null,
      })
      expect(cleaner.cleanupStaleRecords()).toMatchObject({
        abandonedIntent: false,
        stateRevision: before.stateRevision + 1,
      })
      expectLockError(() => cleaner.assertExclusiveAuthority(worker.intent, phase), 'INTENT_FENCED')
    }
  )

  it('removes an already abandoned dead intent', async () => {
    const root = tempRoot()
    await runWorker(root, 'mcp', 0, join(root, 'forbidden-home'), 'intent:exclusive')
    const cleaner = createLockAt(root, 'tauri')
    const path = highestStateFile(cleaner)
    const state = JSON.parse(readFileSync(path, 'utf8'))
    state.exclusiveIntent.phase = 'abandoned'
    writePrivateJson(path, state, false)
    expect(cleaner.cleanupStaleRecords().abandonedIntent).toBe(true)
    expect(cleaner.readOperationState().exclusiveIntent).toBeNull()
  })

  it('never automatically clears a dead mutating intent', async () => {
    const root = tempRoot()
    await runWorker(root, 'cli', 0, join(root, 'forbidden-home'), 'intent:mutating')
    const cleaner = createLockAt(root, 'tauri')
    const before = cleaner.readOperationState()
    expect(cleaner.cleanupStaleRecords()).toEqual({
      removedLeaseIds: [],
      abandonedIntent: false,
      stateRevision: before.stateRevision,
    })
    expect(cleaner.readOperationState()).toEqual(before)
  })

  it('matches the shared strict JSON golden fixtures', () => {
    for (const fixture of goldenFixtures.cases) {
      if (fixture.valid) {
        expect(validateDatabaseOperationRecord(fixture.record), fixture.name).toEqual(
          fixture.record
        )
      } else {
        expect(() => validateDatabaseOperationRecord(fixture.record), fixture.name).toThrow(
          DatabaseOperationLockError
        )
      }
    }
  })

  it('classifies unpublished mutex and host stages as incomplete, not stable corruption', () => {
    const root = tempRoot()
    const initializer = createLockAt(root, 'cli')
    initializer.getOwnerEvidence()
    const paths = initializer.getPaths()
    rmSync(paths.hostIdentity)
    writeFileSync(join(root, `.machine-host-identity-${randomUUID()}.json`), '{partial')
    expect(createLockAt(root, 'tauri').getOwnerEvidence().hostId).toBeDefined()

    const incompleteRoot = tempRoot()
    const probe = createLockAt(incompleteRoot, 'mcp')
    probe.getOwnerEvidence()
    const incompletePaths = probe.getPaths()
    mkdirSync(incompletePaths.registrationMutex, { mode: 0o700 })
    const token = join(incompletePaths.registrationMutex, `token-${randomUUID()}`)
    mkdirSync(token, { mode: 0o700 })
    writeFileSync(join(token, `staged-mutex-${randomUUID()}.json`), '{partial', { mode: 0o600 })
    const waiter = new DatabaseOperationLock({
      rootDir: incompleteRoot,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'tauri',
      mutexTtlMs: 1_000,
      acquireTimeoutMs: 0,
      clock: () => Date.now() + 2_000,
    })
    if (process.platform === 'win32') {
      expectLockError(() => waiter.registerRuntimeLease(), 'MUTEX_BUSY')
      expect(existsSync(incompletePaths.registrationMutex)).toBe(true)
    } else {
      expect(waiter.registerRuntimeLease()).toMatchObject({ recordKind: 'runtime_lease' })
    }

    const malformedRoot = tempRoot()
    mkdirSync(malformedRoot, { recursive: true })
    writeFileSync(join(malformedRoot, 'machine-host-identity.json'), '{partial', { mode: 0o600 })
    const malformed = createLockAt(malformedRoot, 'cli')
    expectLockError(() => malformed.getOwnerEvidence(), 'HOST_ID_CORRUPTION')
  })

  it('defines a pre-publication failure and committed post-publication degradation precisely', () => {
    const beforePublish = new DatabaseOperationLock({
      rootDir: tempRoot(),
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      testHooks: {
        afterPrune: () => {
          throw new Error('after prune')
        },
      },
    })
    expectLockError(() => beforePublish.registerRuntimeLease(), 'FILESYSTEM_FAILURE')
    expect(beforePublish.readOperationState()).toMatchObject({ stateRevision: 0, leases: [] })
    expect(beforePublish.getLifecycleHealth()).toMatchObject({
      fenced: false,
      registered: false,
      lastCommittedStateRevision: null,
    })

    const afterRename = new DatabaseOperationLock({
      rootDir: tempRoot(),
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'mcp',
      testHooks: {
        afterRename: () => {
          throw new Error('after rename')
        },
      },
    })
    const renamedLease = afterRename.registerRuntimeLease()
    expect(afterRename.readOperationState()).toMatchObject({
      stateRevision: 1,
      leases: [{ leaseId: renamedLease.leaseId }],
    })
    expect(afterRename.getLifecycleHealth()).toMatchObject({
      fenced: true,
      registered: false,
      durabilityUncertain: true,
      lastCommittedStateRevision: 1,
    })
    expectLockError(() => afterRename.renewRuntimeLease(renamedLease), 'OWNER_SELF_FENCED')

    const unsupportedDirectorySync = new DatabaseOperationLock({
      rootDir: tempRoot(),
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'tauri',
      testHooks: {
        directorySync: () => false,
      },
    })
    const unsupportedLease = unsupportedDirectorySync.registerRuntimeLease()
    expect(unsupportedDirectorySync.readOperationState()).toMatchObject({
      stateRevision: 1,
      leases: [{ leaseId: unsupportedLease.leaseId }],
    })
    expect(unsupportedDirectorySync.getLifecycleHealth()).toEqual({
      healthy: false,
      fenced: false,
      registered: true,
      shouldDrain: false,
      reason:
        'DIRECTORY_SYNC_UNSUPPORTED: State record is published but directory fsync is unsupported',
      stateRevision: 1,
      fencingGeneration: unsupportedLease.fencingGeneration,
      maintenanceDegraded: true,
      durabilityUncertain: false,
      lastCommittedStateRevision: 1,
    })

    for (const hook of ['afterFsync', 'afterRelease']) {
      const lock = new DatabaseOperationLock({
        rootDir: tempRoot(),
        databaseIdentity: DATABASE_IDENTITY,
        runtimeId: 'browser-data-server',
        testHooks: {
          [hook]: () => {
            throw new Error(hook)
          },
        },
      })
      const lease = lock.registerRuntimeLease()
      expect(lock.readOperationState()).toMatchObject({
        stateRevision: 1,
        leases: [{ leaseId: lease.leaseId }],
      })
      expect(lock.getLifecycleHealth()).toMatchObject({
        healthy: false,
        fenced: false,
        registered: true,
        maintenanceDegraded: true,
        durabilityUncertain: false,
        lastCommittedStateRevision: 1,
      })
    }
  })

  it('prunes before publication and retries an enumerated immutable-record turnover', () => {
    const root = tempRoot()
    const churn = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'cli',
      maxStateRecords: 3,
    })
    for (let index = 0; index < 8; index += 1) {
      const lease = churn.registerRuntimeLease()
      churn.releaseRuntimeLease(lease)
      expect(readdirSync(churn.getPaths().stateRecords).length).toBeLessThanOrEqual(3)
    }
    expect(readdirSync(churn.getPaths().stateRecords)).toHaveLength(3)

    let removed = false
    const reader = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'tauri',
      maxStateRecords: 3,
      testHooks: {
        afterStateDirectoryRead({ names, path }) {
          if (removed || names.length < 2) return
          removed = true
          rmSync(join(path, [...names].sort()[0]))
        },
      },
    })
    expect(reader.readOperationState()).toMatchObject({ stateRevision: 16, leases: [] })
    expect(removed).toBe(true)
  })

  it('reclaims an expired complete mutex using its unique full authority evidence', () => {
    const root = tempRoot()
    const initializer = createLockAt(root, 'cli')
    const owner = initializer.getOwnerEvidence()
    const paths = initializer.getPaths()
    const mutexId = randomUUID()
    mkdirSync(paths.registrationMutex, { mode: 0o700 })
    const token = join(paths.registrationMutex, `token-${mutexId}`)
    mkdirSync(token, { mode: 0o700 })
    writePrivateJson(join(token, 'mutex.json'), {
      protocol: DATABASE_OPERATION_PROTOCOL,
      protocolVersion: 1,
      recordKind: 'registration_mutex',
      databaseIdentity: DATABASE_IDENTITY,
      mutexId,
      owner,
      acquiredAt: new Date(Date.now() - 10_000).toISOString(),
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
      ttlMs: 5_000,
    })
    expect(createLockAt(root, 'mcp').registerRuntimeLease()).toMatchObject({
      recordKind: 'runtime_lease',
    })
  })

  it('retries mutex disappearance during holder release instead of reporting corruption', () => {
    const root = tempRoot()
    const holder = createLockAt(root, 'cli')
    const owner = holder.getOwnerEvidence()
    const paths = holder.getPaths()
    const mutexId = randomUUID()
    mkdirSync(paths.registrationMutex, { mode: 0o700 })
    const token = join(paths.registrationMutex, `token-${mutexId}`)
    mkdirSync(token, { mode: 0o700 })
    writePrivateJson(join(token, 'mutex.json'), {
      protocol: DATABASE_OPERATION_PROTOCOL,
      protocolVersion: 1,
      recordKind: 'registration_mutex',
      databaseIdentity: DATABASE_IDENTITY,
      mutexId,
      owner,
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 5_000).toISOString(),
      ttlMs: 5_000,
    })
    let turnedOver = false
    const waiter = new DatabaseOperationLock({
      rootDir: root,
      databaseIdentity: DATABASE_IDENTITY,
      runtimeId: 'mcp',
      testHooks: {
        afterMutexRootStat({ path }) {
          if (turnedOver || path !== paths.registrationMutex) return
          turnedOver = true
          rmSync(path, { recursive: true })
        },
      },
    })
    expect(waiter.registerRuntimeLease()).toMatchObject({ recordKind: 'runtime_lease' })
    expect(turnedOver).toBe(true)
  })

  it('survives repeated multi-process contention well beyond retention', async () => {
    const root = tempRoot()
    const results = await Promise.all(
      ['cli', 'mcp', 'browser-data-server', 'tauri'].map((runtimeId) =>
        runWorker(root, runtimeId, 0, join(root, `forbidden-${runtimeId}`), 'churn', 12)
      )
    )
    const observer = createLockAt(root, 'tauri')
    expect(results).toHaveLength(4)
    expect(observer.readOperationState()).toMatchObject({ stateRevision: 96, leases: [] })
    expect(readdirSync(observer.getPaths().stateRecords).length).toBeLessThanOrEqual(8)
  })

  it('rejects database aliases and symlink coordination roots without filesystem effects', () => {
    const inertRoot = join(tempRoot(), 'never-created')
    for (const alias of ['shikin.db', '/tmp/shikin.db', 'COM.ASF.SHIKIN:SHIKIN.DB']) {
      expectLockError(
        () =>
          new DatabaseOperationLock({
            rootDir: inertRoot,
            databaseIdentity: alias,
            runtimeId: 'cli',
          }),
        'INVALID_DATABASE_IDENTITY'
      )
    }
    expect(existsSync(inertRoot)).toBe(false)

    const parent = tempRoot()
    const target = join(parent, 'target')
    const alias = join(parent, 'alias')
    mkdirSync(target)
    symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const unsafe = createLockAt(alias, 'tauri')
    expectLockError(() => unsafe.getOwnerEvidence(), 'UNSAFE_PATH')
    expect(readdirSync(target)).toEqual([])
  })

  it.runIf(process.platform !== 'linux')(
    'uses conservative non-Linux process liveness without claiming unavailable cleanup',
    async () => {
      const root = tempRoot()
      const dead = await runWorker(root, 'mcp', -40_000, join(root, 'forbidden-home'))
      const cleaner = createLockAt(root, 'tauri')
      expect(cleaner.cleanupStaleRecords().removedLeaseIds).toEqual([dead.lease.leaseId])

      const liveRoot = tempRoot()
      const live = new DatabaseOperationLock({
        rootDir: liveRoot,
        databaseIdentity: DATABASE_IDENTITY,
        runtimeId: 'cli',
        leaseTtlMs: 5_000,
        heartbeatIntervalMs: 1_000,
        clock: () => Date.now() - 10_000,
      })
      const lease = live.registerRuntimeLease()
      expect(createLockAt(liveRoot, 'tauri').cleanupStaleRecords().removedLeaseIds).toEqual([])
      expect(live.releaseRuntimeLease(lease)).toBe(true)
    }
  )

  it('uses private directory/file modes for every generated coordination record', () => {
    if (process.platform === 'win32') return
    const lock = createLock('browser-data-server')
    lock.registerRuntimeLease()

    expect(statSync(lock.getPaths().root).mode & 0o777).toBe(0o700)
    expect(statSync(lock.getPaths().operationRoot).mode & 0o777).toBe(0o700)
    expect(statSync(highestStateFile(lock)).mode & 0o777).toBe(0o600)
    expect(statSync(lock.getPaths().hostIdentity).mode & 0o777).toBe(0o600)
  })
})

function createLock(runtimeId) {
  return createLockAt(tempRoot(), runtimeId)
}

function cancelableIntentFixture(phase, testHooks) {
  const root = tempRoot()
  const owner = new DatabaseOperationLock({
    rootDir: root,
    databaseIdentity: DATABASE_IDENTITY,
    runtimeId: 'cli',
    ...(testHooks === undefined ? {} : { testHooks }),
  })
  const peer = createLockAt(root, 'mcp')
  let ownerLease = owner.registerRuntimeLease()
  let peerLease = peer.registerRuntimeLease()
  let intent = owner.acquireExclusiveIntent('restore', { cancellationFixture: true })
  if (phase !== 'registered') intent = owner.drainExclusiveIntent(intent)
  if (phase === 'exclusive') {
    peer.releaseRuntimeLease(peerLease)
    peerLease = null
    owner.releaseRuntimeLease(ownerLease)
    ownerLease = null
    intent = owner.drainExclusiveIntent(intent)
  }
  return { owner, peer, ownerLease, peerLease, intent }
}

function rewriteAuthoritativeState(lock, update) {
  const currentPath = highestStateFile(lock)
  const current = JSON.parse(readFileSync(currentPath, 'utf8'))
  const next = update(structuredClone(current))
  if (next.stateRevision === current.stateRevision) {
    writePrivateJson(currentPath, next, false)
    return
  }
  const nextName = `operation-state-${String(next.stateRevision).padStart(20, '0')}-${randomUUID()}.json`
  writePrivateJson(join(lock.getPaths().stateRecords, nextName), next)
}

function createLockAt(rootDir, runtimeId) {
  return new DatabaseOperationLock({ rootDir, databaseIdentity: DATABASE_IDENTITY, runtimeId })
}

function tempRoot() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shikin-operation-lock-')))
  roots.push(root)
  return root
}

function expectLockError(action, code) {
  try {
    action()
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseOperationLockError)
    expect(error.code).toBe(code)
  }
}

function highestStateFile(lock) {
  const names = readdirSync(lock.getPaths().stateRecords).sort()
  return join(lock.getPaths().stateRecords, names.at(-1))
}

function writePrivateJson(path, value, exclusive = true) {
  writeFileSync(path, `${JSON.stringify(value)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: exclusive ? 'wx' : 'w',
  })
  if (process.platform !== 'win32') chmodSync(path, 0o600)
}

function readSuccessorMutex(lock) {
  return readCompleteMutex(lock.getPaths().registrationMutex)
}

function readCompleteMutex(path) {
  const [token] = readdirSync(path)
  return JSON.parse(readFileSync(join(path, token, 'mutex.json'), 'utf8'))
}

function mutexRecord(owner, now, mutexId) {
  return {
    protocol: DATABASE_OPERATION_PROTOCOL,
    protocolVersion: 1,
    recordKind: 'registration_mutex',
    databaseIdentity: DATABASE_IDENTITY,
    mutexId,
    owner,
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 5_000).toISOString(),
    ttlMs: 5_000,
  }
}

function publishCompleteMutex(destination, record) {
  const candidate = `${destination}.candidate-${randomUUID()}`
  const token = join(candidate, `token-${record.mutexId}`)
  mkdirSync(token, { recursive: true, mode: 0o700 })
  writePrivateJson(join(token, 'mutex.json'), record)
  renameSync(candidate, destination)
}

function runWorker(root, runtimeId, clockOffset, forbiddenHome, action = 'register', count = 1) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve('scripts/database-operation-lock.worker.mjs'),
        root,
        DATABASE_IDENTITY,
        runtimeId,
        String(clockOffset),
        action,
        String(count),
      ],
      {
        env: {
          ...process.env,
          HOME: forbiddenHome,
          XDG_DATA_HOME: join(forbiddenHome, 'xdg'),
          APPDATA: join(forbiddenHome, 'appdata'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}: ${stderr}`))
      else {
        try {
          resolvePromise(JSON.parse(stdout.trim()))
        } catch (error) {
          reject(new Error(`worker returned malformed output: ${stdout}`, { cause: error }))
        }
      }
    })
  })
}
