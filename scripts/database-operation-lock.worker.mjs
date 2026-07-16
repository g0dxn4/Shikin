import childProcess from 'node:child_process'
import fs, { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { DatabaseOperationLock } from './database-operation-lock.mjs'
import { prepareMutationJournal } from './database-operation-recovery-journal.mjs'

const [
  rootDir,
  databaseIdentity,
  runtimeId,
  clockOffsetSource = '0',
  action = 'register',
  countSource = '1',
] = process.argv.slice(2)
const clockOffset = Number(clockOffsetSource)
const count = Number(countSource)

function waitForMarker(path, timeoutMs = 30_000) {
  if (!path) throw new Error('worker marker path is required')
  const started = Date.now()
  while (!existsSync(path)) {
    if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for ${path}`)
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10)
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function claimWithAmbientLivenessMutation(lock, mutation, expectedOwnerStartedAt) {
  if (!expectedOwnerStartedAt) throw new Error('live owner start evidence is required')
  const restore = installAmbientLivenessMutation(mutation, expectedOwnerStartedAt)
  let authority
  let failure
  try {
    authority = lock.claimRecoveryAuthority()
  } catch (error) {
    failure = error
  } finally {
    restore()
  }

  if (failure !== undefined) {
    return {
      ok: false,
      code: failure?.code ?? 'WORKER_FAILURE',
      message: failure?.message,
    }
  }
  const intent = lock.assertRecoveryAuthority(authority)
  lock.releaseRecoveryAuthority(authority)
  return { ok: true, intent, state: lock.readOperationState() }
}

function claimWithTimedOutGetconf(lock) {
  const fakeBin = process.env.SHIKIN_FAKE_GETCONF_BIN
  if (!fakeBin) throw new Error('fake getconf directory is required')
  const absoluteSleep = ['/bin/sleep', '/usr/bin/sleep'].find((path) => existsSync(path))
  if (absoluteSleep === undefined) throw new Error('absolute sleep executable is unavailable')
  const originalPath = process.env.PATH
  let result
  try {
    mkdirSync(fakeBin, { mode: 0o700 })
    const fakeGetconf = `${fakeBin}/getconf`
    writeFileSync(fakeGetconf, `#!/bin/sh\nexec ${absoluteSleep} 30\n`, { mode: 0o700 })
    chmodSync(fakeGetconf, 0o700)
    process.env.PATH = fakeBin
    try {
      const authority = lock.claimRecoveryAuthority()
      const intent = lock.assertRecoveryAuthority(authority)
      lock.releaseRecoveryAuthority(authority)
      result = { ok: true, intent, state: lock.readOperationState() }
    } catch (error) {
      result = {
        ok: false,
        code: error?.code ?? 'WORKER_FAILURE',
        message: error?.message,
      }
    }
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    rmSync(fakeBin, { recursive: true, force: true })
  }
  return {
    ...result,
    pathRestored: process.env.PATH === originalPath,
    fakeGetconfRemoved: !existsSync(fakeBin),
  }
}

function installAmbientLivenessMutation(mutation, expectedOwnerStartedAt) {
  const originalArrayFind = Array.prototype.find
  const originalStringLastIndexOf = String.prototype.lastIndexOf
  const originalStringSlice = String.prototype.slice
  const originalStringSplit = String.prototype.split
  const originalStringStartsWith = String.prototype.startsWith
  const originalStringTrim = String.prototype.trim
  const originalArrayJoin = Array.prototype.join
  const originalNumber = Number
  const originalNumberIsFinite = Number.isFinite
  const originalNumberIsSafeInteger = Number.isSafeInteger
  const originalMathFloor = Math.floor
  const originalDate = Date
  const originalDateGetTime = Date.prototype.getTime
  const originalDateParse = Date.parse
  const originalDateToISOString = Date.prototype.toISOString
  const originalFsReadFileSync = fs.readFileSync
  const originalExecFileSync = childProcess.execFileSync

  if (mutation === 'array-find') {
    Array.prototype.find = () => 'btime 0'
    return () => {
      Array.prototype.find = originalArrayFind
    }
  }
  if (mutation === 'string-starts-with') {
    String.prototype.startsWith = () => false
    return () => {
      String.prototype.startsWith = originalStringStartsWith
    }
  }
  if (mutation === 'string-split') {
    String.prototype.split = function (separator, limit) {
      const source = String(this)
      if (separator === '\n' && source.includes('\nbtime ')) return ['btime 0']
      return originalStringSplit.call(this, separator, limit)
    }
    return () => {
      String.prototype.split = originalStringSplit
    }
  }
  if (mutation === 'string-slice') {
    String.prototype.slice = function (start, end) {
      if (start === 6 && originalStringStartsWith.call(this, 'btime ')) return '0'
      return originalStringSlice.call(this, start, end)
    }
    return () => {
      String.prototype.slice = originalStringSlice
    }
  }
  if (mutation === 'string-trim') {
    String.prototype.trim = function () {
      const source = originalStringTrim.call(this)
      const fields = originalStringSplit.call(source, /\s+/)
      if (fields.length > 20 && /^[A-Za-z]$/.test(fields[0])) {
        fields[19] = '0'
        return originalArrayJoin.call(fields, ' ')
      }
      return source
    }
    return () => {
      String.prototype.trim = originalStringTrim
    }
  }
  if (mutation === 'string-last-index-of') {
    String.prototype.lastIndexOf = function (search, position) {
      const result = originalStringLastIndexOf.call(this, search, position)
      return search === ')' && result >= 2 ? result - 2 : result
    }
    return () => {
      String.prototype.lastIndexOf = originalStringLastIndexOf
    }
  }
  if (mutation === 'number') {
    const bootMatch = /^btime (\d+)$/m.exec(readFileSync('/proc/stat', 'utf8'))
    if (bootMatch === null) throw new Error('Linux boot time is unavailable')
    const bootSeconds = bootMatch[1]
    function MutatedNumber(value) {
      const converted = originalNumber(value)
      return String(value) === bootSeconds ? converted - 1 : converted
    }
    Object.setPrototypeOf(MutatedNumber, originalNumber)
    MutatedNumber.prototype = originalNumber.prototype
    globalThis.Number = MutatedNumber
    return () => {
      globalThis.Number = originalNumber
    }
  }
  if (mutation === 'number-is-finite') {
    Number.isFinite = () => false
    return () => {
      Number.isFinite = originalNumberIsFinite
    }
  }
  if (mutation === 'number-is-safe-integer') {
    Number.isSafeInteger = () => false
    return () => {
      Number.isSafeInteger = originalNumberIsSafeInteger
    }
  }
  if (mutation === 'math-floor') {
    Math.floor = (value) => originalMathFloor(value) + 1
    return () => {
      Math.floor = originalMathFloor
    }
  }
  if (mutation === 'date-constructor') {
    function MutatedDate(...values) {
      if (!new.target) return originalDate(...values)
      const date = Reflect.construct(originalDate, values)
      if (originalDateToISOString.call(date) !== expectedOwnerStartedAt) return date
      return new originalDate(originalDateGetTime.call(date) + 1_000)
    }
    Object.setPrototypeOf(MutatedDate, originalDate)
    MutatedDate.prototype = originalDate.prototype
    globalThis.Date = MutatedDate
    return () => {
      globalThis.Date = originalDate
    }
  }
  if (mutation === 'date-get-time') {
    Date.prototype.getTime = () => Number.NaN
    return () => {
      Date.prototype.getTime = originalDateGetTime
    }
  }
  if (mutation === 'date-parse') {
    Date.parse = (value) => originalDateParse(value) + 1_000
    return () => {
      Date.parse = originalDateParse
    }
  }
  if (mutation === 'date-to-iso-string') {
    Date.prototype.toISOString = function () {
      const formatted = originalDateToISOString.call(this)
      if (formatted !== expectedOwnerStartedAt) return formatted
      return originalDateToISOString.call(new originalDate(originalDateGetTime.call(this) + 1_000))
    }
    return () => {
      Date.prototype.toISOString = originalDateToISOString
    }
  }
  if (mutation === 'node-read-file-sync') {
    fs.readFileSync = function (path, ...options) {
      const source = originalFsReadFileSync.call(this, path, ...options)
      if (typeof source !== 'string' || !/^\/proc\/\d+\/stat$/.test(String(path))) return source
      const closing = originalStringLastIndexOf.call(source, ')')
      const fields = originalStringSplit.call(
        originalStringTrim.call(originalStringSlice.call(source, closing + 2)),
        /\s+/
      )
      fields[19] = '0'
      return `${originalStringSlice.call(source, 0, closing + 2)}${originalArrayJoin.call(fields, ' ')}\n`
    }
    syncBuiltinESMExports()
    return () => {
      fs.readFileSync = originalFsReadFileSync
      syncBuiltinESMExports()
    }
  }
  if (mutation === 'node-exec-file-sync') {
    childProcess.execFileSync = function (file, ...options) {
      if (file === 'getconf') return '1\n'
      return originalExecFileSync.call(this, file, ...options)
    }
    syncBuiltinESMExports()
    return () => {
      childProcess.execFileSync = originalExecFileSync
      syncBuiltinESMExports()
    }
  }
  throw new Error(`unknown liveness mutation ${mutation}`)
}

try {
  const claimVerificationBarrier = action === 'claim-barrier'
  const claimMutexBarrier = action === 'claim-mutex-barrier'
  const mutexContentionMarker =
    action === 'cleanup' ? process.env.SHIKIN_MUTEX_CONTENTION_MARKER : undefined
  let mutexContentionSignalled = false
  const lock = new DatabaseOperationLock({
    rootDir,
    databaseIdentity,
    runtimeId,
    clock: () => Date.now() + clockOffset,
    ...(claimVerificationBarrier || claimMutexBarrier || mutexContentionMarker
      ? {
          testHooks: {
            ...(claimVerificationBarrier
              ? {
                  afterCommittedRecoveryVerification() {
                    writeFileSync(process.env.SHIKIN_CLAIM_READY_MARKER, 'ready\n')
                    waitForMarker(process.env.SHIKIN_CLAIM_RELEASE_MARKER)
                  },
                }
              : {}),
            ...(claimMutexBarrier
              ? {
                  afterPrune() {
                    writeFileSync(process.env.SHIKIN_CLAIM_READY_MARKER, 'ready\n')
                    waitForMarker(process.env.SHIKIN_CLAIM_RELEASE_MARKER)
                  },
                }
              : {}),
            ...(mutexContentionMarker
              ? {
                  afterMutexContention() {
                    if (mutexContentionSignalled) return
                    mutexContentionSignalled = true
                    writeFileSync(mutexContentionMarker, 'contended\n')
                  },
                }
              : {}),
          },
        }
      : {}),
  })
  if (action === 'register') {
    const lease = lock.registerRuntimeLease()
    output({ lease, state: lock.readOperationState() })
  } else if (action === 'churn') {
    for (let index = 0; index < count; index += 1) {
      const lease = lock.registerRuntimeLease()
      lock.releaseRuntimeLease(lease)
    }
    output({ state: lock.readOperationState() })
  } else if (action.startsWith('intent:')) {
    const targetPhase = action.slice('intent:'.length)
    const lease = lock.registerRuntimeLease()
    let intent = lock.acquireExclusiveIntent('restore', { worker: true })
    if (targetPhase !== 'registered') intent = lock.drainExclusiveIntent(intent)
    lock.releaseRuntimeLease(lease)
    if (['exclusive', 'mutating', 'completed'].includes(targetPhase)) {
      intent = lock.drainExclusiveIntent(intent)
    }
    if (['mutating', 'completed'].includes(targetPhase)) {
      const state = lock.readOperationState()
      const prepared = prepareMutationJournal({
        operationRoot: lock.getPaths().operationRoot,
        stateRevision: state.stateRevision,
        intent,
        writeArtifact({ role, path }) {
          writeFileSync(path, `${role}\0worker-journal`)
          return {
            integrityCheck: 'ok',
            foreignKeyCheck: 'ok',
            schemaContractCheck: 'ok',
            sidecarCheck: 'ok',
          }
        },
      })
      intent = lock.beginExclusiveMutation(intent, prepared.proof)
    }
    if (targetPhase === 'completed') intent = lock.completeExclusiveMutation(intent)
    output({ intent, state: lock.readOperationState() })
  } else if (action === 'cleanup') {
    const cleanup = lock.cleanupStaleRecords()
    output({ cleanup, state: lock.readOperationState() })
  } else if (action.startsWith('claim-liveness-mutation:')) {
    output(
      claimWithAmbientLivenessMutation(
        lock,
        action.slice('claim-liveness-mutation:'.length),
        process.env.SHIKIN_LIVE_OWNER_STARTED_AT
      )
    )
  } else if (action === 'claim-getconf-timeout') {
    output(claimWithTimedOutGetconf(lock))
  } else if (['claim', 'claim-barrier', 'claim-mutex-barrier', 'claim-hold'].includes(action)) {
    const authority = lock.claimRecoveryAuthority()
    const intent = lock.assertRecoveryAuthority(authority)
    if (action === 'claim-hold') {
      writeFileSync(process.env.SHIKIN_CLAIM_READY_MARKER, 'ready\n')
      waitForMarker(process.env.SHIKIN_CLAIM_RELEASE_MARKER)
      lock.assertRecoveryAuthority(authority)
    }
    lock.releaseRecoveryAuthority(authority)
    output({ ok: true, intent, state: lock.readOperationState() })
  } else {
    throw new Error(`unknown worker action ${action}`)
  }
} catch (error) {
  if (action.startsWith('claim')) {
    output({ ok: false, code: error?.code ?? 'WORKER_FAILURE', message: error?.message })
  } else {
    process.stderr.write(`${error?.stack ?? error}\n`)
    process.exitCode = 1
  }
}
