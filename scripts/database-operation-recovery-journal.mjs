import { createHash as liveCreateHash, randomBytes as liveRandomBytes } from 'node:crypto'
import {
  Dir as LiveDir,
  Stats as LiveStats,
  chmodSync as liveChmodSync,
  closeSync as liveCloseSync,
  constants as liveFsConstants,
  fchmodSync as liveFchmodSync,
  fstatSync as liveFstatSync,
  fsyncSync as liveFsyncSync,
  lstatSync as liveLstatSync,
  mkdirSync as liveMkdirSync,
  openSync as liveOpenSync,
  opendirSync as liveOpendirSync,
  readdirSync as liveReaddirSync,
  readSync as liveReadSync,
  realpathSync as liveRealpathSync,
  writeSync as liveWriteSync,
} from 'node:fs'
import {
  basename as liveBasename,
  dirname as liveDirname,
  join as liveJoin,
  resolve as liveResolve,
} from 'node:path'
import { MessagePort as LiveMessagePort, Worker as LiveWorker } from 'node:worker_threads'
import {
  canonicalRecoveryJournalBytes,
  recoveryArtifactKey,
  recoveryOperationKey,
  recoveryRecordHash,
} from './database-operation-recovery-journal-canonical.mjs'
import { SHIKIN_SCHEMA_CONTRACT_IDENTITY } from './shikin-schema-contract-identity.mjs'

const createHashBuiltin = liveCreateHash
const randomBytesBuiltin = liveRandomBytes
const FsDir = LiveDir
const FsStats = LiveStats
const fsChmodSync = liveChmodSync
const fsCloseSync = liveCloseSync
const fsFchmodSync = liveFchmodSync
const fsFstatSync = liveFstatSync
const fsFsyncSync = liveFsyncSync
const fsLstatSync = liveLstatSync
const fsMkdirSync = liveMkdirSync
const fsOpenSync = liveOpenSync
const fsOpendirSync = liveOpendirSync
const fsReaddirSync = liveReaddirSync
const fsReadSync = liveReadSync
const fsRealpathSync = liveRealpathSync.native
const fsWriteSync = liveWriteSync
const FS_OPEN_RDONLY = liveFsConstants.O_RDONLY
const FS_OPEN_DIRECTORY = liveFsConstants.O_DIRECTORY ?? 0
const FS_OPEN_NOFOLLOW = liveFsConstants.O_NOFOLLOW ?? 0
const FS_OPEN_CREAT = liveFsConstants.O_CREAT
const FS_OPEN_EXCL = liveFsConstants.O_EXCL
const FS_OPEN_RDWR = liveFsConstants.O_RDWR
const pathBasename = liveBasename
const pathDirname = liveDirname
const pathJoin = liveJoin
const pathResolve = liveResolve
const WorkerConstructor = LiveWorker
const MessagePortConstructor = LiveMessagePort
const objectCreate = Object.create
const objectDefineProperties = Object.defineProperties
const objectDefineProperty = Object.defineProperty
const objectFreeze = Object.freeze
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor
const objectGetOwnPropertySymbols = Object.getOwnPropertySymbols
const objectGetPrototypeOf = Object.getPrototypeOf
const objectIs = Object.is
const objectKeys = Object.keys
const objectPrototype = Object.prototype
const ErrorConstructor = Error
const errorPrototype = ErrorConstructor.prototype
const arrayPrototype = Array.prototype
const arrayIsArray = Array.isArray
const numberIsSafeInteger = Number.isSafeInteger
const numberIsNaN = Number.isNaN
const NumberConstructor = Number
const BigIntConstructor = BigInt
const StringConstructor = String
const TypeErrorConstructor = TypeError
const PromiseConstructor = Promise
const SharedArrayBufferConstructor = SharedArrayBuffer
const Int32ArrayConstructor = Int32Array
const Uint8ArrayConstructor = Uint8Array
const DateConstructor = Date
const bufferPrototype = Buffer.prototype
const uint8ArrayPrototype = Uint8ArrayConstructor.prototype
const typedArrayPrototype = objectGetPrototypeOf(uint8ArrayPrototype)
const fsStatsPrototype = FsStats.prototype
const typeErrorPrototype = TypeErrorConstructor.prototype
const runtimePlatform = process.platform
const runtimeNodeVersion = process.versions.node
const runtimeExecutablePath = process.execPath
const runtimeEnvironment = process.env
const runtimeIsTest = runtimeEnvironment.NODE_ENV === 'test'
const monotonicNowNanoseconds = process.hrtime.bigint.bind(process.hrtime)
const setImmediateBuiltin = setImmediate
const mathMin = Math.min
const jsonParse = JSON.parse
const reflectGet = Reflect.get
const reflectOwnKeys = Reflect.ownKeys
const dateGetTime = Function.prototype.call.bind(Date.prototype.getTime)
const dateToISOString = Function.prototype.call.bind(Date.prototype.toISOString)
const directoryCloseSync = Function.prototype.call.bind(FsDir.prototype.closeSync)
const directoryReadSync = Function.prototype.call.bind(FsDir.prototype.readSync)
const hasOwnProperty = Function.prototype.call.bind(Object.prototype.hasOwnProperty)
const regexpExec = Function.prototype.call.bind(RegExp.prototype.exec)
const stringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt)
const stringToLowerCase = Function.prototype.call.bind(String.prototype.toLowerCase)
const bufferAlloc = Buffer.alloc.bind(Buffer)
const bufferAllocUnsafe = Buffer.allocUnsafe.bind(Buffer)
const bufferByteLength = Buffer.byteLength.bind(Buffer)
const bufferCompare = Buffer.compare.bind(Buffer)
const bufferFrom = Buffer.from.bind(Buffer)
const bufferEquals = Function.prototype.call.bind(Buffer.prototype.equals)
const bufferIncludes = Function.prototype.call.bind(Buffer.prototype.includes)
const bufferSubarray = Function.prototype.call.bind(Buffer.prototype.subarray)
const bufferToString = Function.prototype.call.bind(Buffer.prototype.toString)
const atomicsCompareExchange = Atomics.compareExchange.bind(Atomics)
const atomicsLoad = Atomics.load.bind(Atomics)
const atomicsNotify = Atomics.notify.bind(Atomics)
const atomicsStore = Atomics.store.bind(Atomics)
const atomicsWait = Atomics.wait.bind(Atomics)
const uint8ArrayFill = Function.prototype.call.bind(Uint8Array.prototype.fill)
const uint8ArraySet = Function.prototype.call.bind(Uint8Array.prototype.set)
const setHas = Function.prototype.call.bind(Set.prototype.has)
const promiseCatch = Function.prototype.call.bind(Promise.prototype.catch)
const workerOn = Function.prototype.call.bind(WorkerConstructor.prototype.on)
const workerRemoveListener = Function.prototype.call.bind(
  WorkerConstructor.prototype.removeListener
)
const workerTerminate = Function.prototype.call.bind(WorkerConstructor.prototype.terminate)
const workerUnref = Function.prototype.call.bind(WorkerConstructor.prototype.unref)
const messagePortUnref = Function.prototype.call.bind(MessagePortConstructor.prototype.unref)
const weakMapGet = Function.prototype.call.bind(WeakMap.prototype.get)
const weakMapSet = Function.prototype.call.bind(WeakMap.prototype.set)
const weakSetAdd = Function.prototype.call.bind(WeakSet.prototype.add)
const weakSetHas = Function.prototype.call.bind(WeakSet.prototype.has)
const bootstrapHashInstance = createHashBuiltin('sha256')
const hashPrototype = objectGetPrototypeOf(bootstrapHashInstance)
const bootstrapBigIntStatsPrototype = objectGetPrototypeOf(
  fsLstatSync(runtimeExecutablePath, { bigint: true })
)
const bootstrapBufferInstancePrototype = objectGetPrototypeOf(bufferAlloc(0))
const hashDigest = Function.prototype.call.bind(hashPrototype.digest)
const hashUpdate = Function.prototype.call.bind(hashPrototype.update)
const statsIsDirectory = Function.prototype.call.bind(fsStatsPrototype.isDirectory)
const statsIsFile = Function.prototype.call.bind(fsStatsPrototype.isFile)
const statsIsSymbolicLink = Function.prototype.call.bind(fsStatsPrototype.isSymbolicLink)
const protectedPrototypeIntegritySnapshots = captureProtectedPrototypeIntegritySnapshots()

const PROTOCOL = 'shikin.database-operation-recovery-journal'
const PROTOCOL_VERSION = 1
const DATABASE_IDENTITY = 'com.asf.shikin:shikin.db'
const RECOVERY_DIRECTORY = 'recovery-journal-v1'
const OPERATIONS_DIRECTORY = 'operations'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_WRITABLE_FILE_MODE = 0o600
const PRIVATE_READ_ONLY_FILE_MODE = 0o400
const HASH_CHUNK_SIZE = 1024 * 1024
const MAX_RECORD_BYTES = 1024 * 1024
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024
const MAX_COMMITTED_BINDING_STRING_BYTES = 16_384
const MAX_COMMITTED_BINDING_KEYS = 24
const MAX_COMMITTED_BINDING_OBJECTS = 3
const LOWER_HEX_64 = /^[0-9a-f]{64}$/
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const RECORD_NAME = /^00000000000000000000-([0-9a-f]{64})\.json$/
const OPERATION_RECORD_ENTRIES = objectFreeze(['artifacts', 'records'])
const RUNTIME_IDS = objectFreeze(['cli', 'mcp', 'browser-data-server', 'tauri'])
const ROLES = objectFreeze(['candidate', 'rollback'])
const CHECK_KEYS = objectFreeze([
  'integrityCheck',
  'foreignKeyCheck',
  'schemaContractCheck',
  'sidecarCheck',
])
const FAULT_POINTS = new Set([
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
  'after-artifacts-directory-fsync',
  'after-records-directory-fsync',
  'after-operation-directory-fsync',
  'after-operations-directory-fsync',
  'after-recovery-root-fsync',
  'after-operation-root-fsync',
])

const COMMITTED_DIRECTORY_SCANNER_SOURCE = String.raw`
import { Dir, opendirSync } from 'node:fs'

const opendirSyncBuiltin = opendirSync
const directoryReadSync = Function.prototype.call.bind(Dir.prototype.readSync)
const directoryCloseSync = Function.prototype.call.bind(Dir.prototype.closeSync)
const stringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt)
const arrayPush = Function.prototype.call.bind(Array.prototype.push)
const atomicsWait = Atomics.wait.bind(Atomics)
const jsonStringify = JSON.stringify
const stdoutWrite = process.stdout.write.bind(process.stdout)
const stderrWrite = process.stderr.write.bind(process.stderr)
const processExit = process.exit.bind(process)
const processKill = process.kill.bind(process)
const nodeVersion = process.versions.node
const paths = [process.argv[1], process.argv[2], process.argv[3], process.argv[4]]
const fault = process.argv[5]
const expectedCounts = [1, 2, 1, 2]

function safeName(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 512) return null
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = stringCharCodeAt(value, index)
    if (
      !(
        (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
        (codeUnit >= 0x61 && codeUnit <= 0x7a) ||
        (codeUnit >= 0x30 && codeUnit <= 0x39) ||
        codeUnit === 0x2e ||
        codeUnit === 0x5f ||
        codeUnit === 0x2d
      )
    ) {
      return null
    }
  }
  return value
}

function scan(path, role, expectedCount) {
  let directory
  let pendingError
  const names = []
  try {
    directory = opendirSyncBuiltin(path, { bufferSize: 1 })
    for (let index = 0; index <= expectedCount; index += 1) {
      let entry
      try {
        if (fault === 'scanner-read-failure' && role === 1 && index === 0) {
          throw new Error('test read failure')
        }
        entry = directoryReadSync(directory)
      } catch (error) {
        pendingError = error
        break
      }
      if (entry === null) break
      arrayPush(names, safeName(entry.name))
    }
  } catch (error) {
    pendingError = error
  } finally {
    if (directory !== undefined) {
      try {
        directoryCloseSync(directory)
        if (
          role === 1 &&
          (fault === 'scanner-close-failure' || fault === 'scanner-read-failure')
        ) {
          throw new Error('test close failure')
        }
      } catch (error) {
        if (pendingError === undefined) pendingError = error
      }
    }
  }
  return pendingError === undefined ? { names } : { error: { kind: 'filesystem', role } }
}

const entries = []
let response
for (let role = 0; role < 4; role += 1) {
  const result = scan(paths[role], role + 1, expectedCounts[role])
  if (result.error !== undefined) {
    response = { v: 1, nodeVersion, error: result.error }
    break
  }
  arrayPush(entries, result.names)
}

if (response === undefined) {
  const mismatch = {
      'recovery-count-mismatch': 0,
      'operation-count-mismatch': 1,
      'records-count-mismatch': 2,
      'artifacts-count-mismatch': 3,
  }[fault]
  const unsafe = {
    'recovery-name-mismatch': 0,
    'operation-name-mismatch': 1,
    'records-name-mismatch': 2,
    'artifacts-name-mismatch': 3,
  }[fault]
  if (mismatch !== undefined) arrayPush(entries[mismatch], 'unexpected')
  if (unsafe !== undefined) entries[unsafe][0] = null
  response = { v: 1, nodeVersion, entries }
}

if (fault === 'scanner-timeout') {
  atomicsWait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000)
} else if (fault === 'scanner-status') {
  processExit(9)
} else if (fault === 'scanner-signal') {
  processKill(process.pid, 'SIGTERM')
} else if (fault === 'scanner-stderr') {
  stderrWrite('scanner stderr\n')
} else if (fault === 'scanner-malformed-response') {
  stdoutWrite('{\n')
  processExit(0)
} else if (fault === 'scanner-extra-output') {
  stdoutWrite(jsonStringify(response) + '\nextra\n')
  processExit(0)
} else if (fault === 'scanner-protocol-version') {
  response.v = 2
} else if (fault === 'scanner-node-version') {
  response.nodeVersion = '0.0.0'
}
stdoutWrite(jsonStringify(response) + '\n')
`

const COMMITTED_DIRECTORY_BROKER_SOURCE = String.raw`
'use strict'
const childProcess = require('node:child_process')
const path = require('node:path')
const util = require('node:util')
const workerThreads = require('node:worker_threads')

const spawnSyncBuiltin = childProcess.spawnSync
const pathJoin = path.join
const TextDecoderConstructor = util.TextDecoder
const workerDataValue = workerThreads.workerData
const processExecPath = process.execPath
const processNodeVersion = process.versions.node
const processExit = process.exit.bind(process)
const setImmediateBuiltin = setImmediate
const STATE = 0
const VERSION = 1
const OUTCOME = 2
const REQUEST_LENGTH = 3
const RESPONSE_LENGTH = 4
const DETAIL = 5
const HEADER_WORDS = 16
const BOOT = 0
const READY = 1
const RESERVED = 2
const RUN = 3
const CANCEL = 4
const DONE = 5
const RELEASE = 6
const FAILED = 7
const NONE = 0
const OK = 1
const FILESYSTEM_ERROR = 2
const LAYOUT_MISMATCH = 3
const RESPONSE_OVERFLOW = 4
const SCANNER_TIMEOUT = 5
const SCANNER_FAILURE = 6
const CANCELLED = 7
const PROTOCOL_ERROR = 8
const RECOVERY = 1
const OPERATION = 2
const RECORDS = 3
const ARTIFACTS = 4
const BROKER = 5
const SCANNER = 6
const REQUEST_CAPACITY = 32 * 1024
const RESPONSE_CAPACITY = 8 * 1024
const REQUEST_OFFSET = HEADER_WORDS * 4
const RESPONSE_OFFSET = REQUEST_OFFSET + REQUEST_CAPACITY
const sharedBuffer = workerDataValue.sharedBuffer
const header = new Int32Array(sharedBuffer, 0, HEADER_WORDS)
const sharedBytes = new Uint8Array(sharedBuffer)
const requestBytes = new Uint8Array(sharedBuffer, REQUEST_OFFSET, REQUEST_CAPACITY)
const responseBytes = new Uint8Array(sharedBuffer, RESPONSE_OFFSET, RESPONSE_CAPACITY)
const scannerSource = workerDataValue.scannerSource
const bootstrapFault = workerDataValue.bootstrapFault
const atomicsCompareExchange = Atomics.compareExchange.bind(Atomics)
const atomicsLoad = Atomics.load.bind(Atomics)
const atomicsNotify = Atomics.notify.bind(Atomics)
const atomicsStore = Atomics.store.bind(Atomics)
const atomicsWait = Atomics.wait.bind(Atomics)
const arrayIsArray = Array.isArray
const arrayPush = Function.prototype.call.bind(Array.prototype.push)
const bufferFrom = Buffer.from.bind(Buffer)
const bufferIsBuffer = Buffer.isBuffer
const bufferIndexOf = Function.prototype.call.bind(Buffer.prototype.indexOf)
const bufferSubarray = Function.prototype.call.bind(Buffer.prototype.subarray)
const jsonParse = JSON.parse
const jsonStringify = JSON.stringify
const numberIsInteger = Number.isInteger
const objectCreate = Object.create
const objectKeys = Object.keys
const regexpTest = Function.prototype.call.bind(RegExp.prototype.test)
const stringCharCodeAt = Function.prototype.call.bind(String.prototype.charCodeAt)
const textDecoder = new TextDecoderConstructor('utf-8', { fatal: true, ignoreBOM: true })
const textDecode = Function.prototype.call.bind(TextDecoderConstructor.prototype.decode)
const uint8ArrayFill = Function.prototype.call.bind(Uint8Array.prototype.fill)
const uint8ArraySet = Function.prototype.call.bind(Uint8Array.prototype.set)
const uint8ArraySubarray = Function.prototype.call.bind(Uint8Array.prototype.subarray)
const setHas = Function.prototype.call.bind(Set.prototype.has)
const lowerHex64 = /^[0-9a-f]{64}$/
const requestFaults = new Set([
  'malformed-request',
  'worker-malformed-response',
  'response-overflow',
  'scanner-spawn-error',
  'scanner-timeout',
  'scanner-status',
  'scanner-signal',
  'scanner-stderr',
  'scanner-malformed-response',
  'scanner-extra-output',
  'scanner-protocol-version',
  'scanner-node-version',
  'scanner-read-failure',
  'scanner-close-failure',
  'recovery-count-mismatch',
  'recovery-name-mismatch',
  'operation-count-mismatch',
  'operation-name-mismatch',
  'records-count-mismatch',
  'records-name-mismatch',
  'artifacts-count-mismatch',
  'artifacts-name-mismatch',
  'pre-done-timeout',
  'cancellation-delay',
  'malformed-cancelled-terminal',
  'release-delay',
  'release-failed',
  'failed-state',
])
const scannerFaults = new Set([
  'scanner-timeout',
  'scanner-status',
  'scanner-signal',
  'scanner-stderr',
  'scanner-malformed-response',
  'scanner-extra-output',
  'scanner-protocol-version',
  'scanner-node-version',
  'scanner-read-failure',
  'scanner-close-failure',
  'recovery-count-mismatch',
  'recovery-name-mismatch',
  'operation-count-mismatch',
  'operation-name-mismatch',
  'records-count-mismatch',
  'records-name-mismatch',
  'artifacts-count-mismatch',
  'artifacts-name-mismatch',
])
const expectedCounts = [1, 2, 1, 2]
const scannerEnvironment = objectCreate(null)
scannerEnvironment.LANG = 'C'
scannerEnvironment.LC_ALL = 'C'
scannerEnvironment.NODE_OPTIONS = ''
scannerEnvironment.NODE_PATH = ''
scannerEnvironment.LD_PRELOAD = ''
scannerEnvironment.LD_LIBRARY_PATH = ''
let activeFault = null

function publishCas(from, to) {
  const observed = atomicsCompareExchange(header, STATE, from, to)
  if (observed === from) atomicsNotify(header, STATE)
  return observed
}

function clearTerminal() {
  uint8ArrayFill(responseBytes, 0)
  atomicsStore(header, OUTCOME, NONE)
  atomicsStore(header, RESPONSE_LENGTH, 0)
  atomicsStore(header, DETAIL, NONE)
}

function writeTerminal(outcome, detail, payload) {
  uint8ArrayFill(responseBytes, 0)
  if (payload !== undefined) uint8ArraySet(responseBytes, payload, 0)
  atomicsStore(header, OUTCOME, outcome)
  atomicsStore(header, DETAIL, detail)
  atomicsStore(header, RESPONSE_LENGTH, payload === undefined ? 0 : payload.length)
}

function publishCancelled() {
  if (activeFault === 'malformed-cancelled-terminal') {
    writeTerminal(OK, BROKER)
  } else {
    writeTerminal(CANCELLED, NONE)
  }
  publishCas(CANCEL, DONE)
}

function publishRunTerminal(outcome, detail, payload) {
  writeTerminal(outcome, detail, payload)
  const observed = publishCas(RUN, DONE)
  if (observed === CANCEL) publishCancelled()
}

function headerHasZeroReservedWords() {
  for (let index = 6; index < HEADER_WORDS; index += 1) {
    if (atomicsLoad(header, index) !== 0) return false
  }
  return true
}

function exactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || arrayIsArray(value)) return false
  const keys = objectKeys(value)
  if (keys.length !== expected.length) return false
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== expected[index]) return false
  }
  return true
}

function safeAsciiName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 512) return false
  for (let index = 0; index < name.length; index += 1) {
    const codeUnit = stringCharCodeAt(name, index)
    if (
      !(
        (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
        (codeUnit >= 0x61 && codeUnit <= 0x7a) ||
        (codeUnit >= 0x30 && codeUnit <= 0x39) ||
        codeUnit === 0x2e ||
        codeUnit === 0x5f ||
        codeUnit === 0x2d
      )
    ) {
      return false
    }
  }
  return true
}

function publishScannerResult(result, fault) {
  if (fault === 'scanner-spawn-error') {
    publishRunTerminal(FILESYSTEM_ERROR, SCANNER)
    return
  }
  if (result.error !== undefined) {
    publishRunTerminal(
      result.error !== null && result.error.code === 'ETIMEDOUT'
        ? SCANNER_TIMEOUT
        : FILESYSTEM_ERROR,
      SCANNER
    )
    return
  }
  if (result.signal !== null) {
    publishRunTerminal(SCANNER_FAILURE, SCANNER)
    return
  }
  if (result.status === null || result.status !== 0) {
    publishRunTerminal(SCANNER_FAILURE, SCANNER)
    return
  }
  if (!bufferIsBuffer(result.stderr) || result.stderr.length !== 0) {
    publishRunTerminal(SCANNER_FAILURE, SCANNER)
    return
  }
  if (!bufferIsBuffer(result.stdout) || result.stdout.length < 2 || result.stdout.length > 8192) {
    publishRunTerminal(SCANNER_FAILURE, SCANNER)
    return
  }
  const firstLf = bufferIndexOf(result.stdout, 0x0a)
  if (firstLf !== result.stdout.length - 1 || bufferIndexOf(result.stdout, 0x0d) !== -1) {
    publishRunTerminal(SCANNER_FAILURE, SCANNER)
    return
  }
  const body = bufferSubarray(result.stdout, 0, -1)
  let response
  let text
  try {
    text = textDecode(textDecoder, body)
    response = jsonParse(text)
  } catch {
    publishRunTerminal(PROTOCOL_ERROR, SCANNER)
    return
  }
  if (
    jsonStringify(response) !== text ||
    !exactKeys(response, ['v', 'nodeVersion', response.error === undefined ? 'entries' : 'error'])
  ) {
    publishRunTerminal(PROTOCOL_ERROR, SCANNER)
    return
  }
  if (response.v !== 1 || response.nodeVersion !== processNodeVersion) {
    publishRunTerminal(PROTOCOL_ERROR, SCANNER)
    return
  }
  if (response.error !== undefined) {
    if (
      !exactKeys(response.error, ['kind', 'role']) ||
      response.error.kind !== 'filesystem' ||
      !numberIsInteger(response.error.role) ||
      response.error.role < RECOVERY ||
      response.error.role > ARTIFACTS
    ) {
      publishRunTerminal(PROTOCOL_ERROR, SCANNER)
      return
    }
    publishRunTerminal(FILESYSTEM_ERROR, response.error.role)
    return
  }
  if (!arrayIsArray(response.entries) || response.entries.length !== 4) {
    publishRunTerminal(PROTOCOL_ERROR, SCANNER)
    return
  }
  for (let role = 0; role < 4; role += 1) {
    const names = response.entries[role]
    if (!arrayIsArray(names) || names.length > expectedCounts[role] + 1) {
      publishRunTerminal(PROTOCOL_ERROR, SCANNER)
      return
    }
    if (names.length !== expectedCounts[role]) {
      publishRunTerminal(LAYOUT_MISMATCH, role + 1)
      return
    }
    for (let index = 0; index < names.length; index += 1) {
      if (!safeAsciiName(names[index])) {
        publishRunTerminal(LAYOUT_MISMATCH, role + 1)
        return
      }
    }
  }
  if (fault === 'response-overflow') {
    publishRunTerminal(RESPONSE_OVERFLOW, BROKER)
    return
  }
  if (fault === 'worker-malformed-response') {
    publishRunTerminal(OK, NONE, bufferFrom('{', 'ascii'))
    return
  }
  if (
    fault === 'pre-done-timeout' ||
    fault === 'cancellation-delay' ||
    fault === 'malformed-cancelled-terminal'
  ) {
    atomicsWait(header, 6, 0, 100)
  }
  publishRunTerminal(OK, NONE, body)
}

function runScanner(request) {
  const recoveryRoot = pathJoin(request.operationRoot, 'recovery-journal-v1')
  const operations = pathJoin(recoveryRoot, 'operations')
  const operation = pathJoin(operations, request.operationKey)
  const args = [
    '--disable-proto=throw',
    '--no-addons',
    '--no-global-search-paths',
    '--no-deprecation',
    '--no-warnings',
    '--input-type=module',
    '--eval',
    scannerSource,
    '--',
    recoveryRoot,
    operation,
    pathJoin(operation, 'records'),
    pathJoin(operation, 'artifacts'),
  ]
  if (setHas(scannerFaults, request.fault)) arrayPush(args, request.fault)
  const spawnOptions = objectCreate(null)
  spawnOptions.shell = false
  spawnOptions.encoding = null
  spawnOptions.stdio = ['ignore', 'pipe', 'pipe']
  spawnOptions.timeout = 5000
  spawnOptions.killSignal = 'SIGKILL'
  spawnOptions.maxBuffer = 8192
  spawnOptions.detached = false
  spawnOptions.env = scannerEnvironment
  const result = spawnSyncBuiltin(processExecPath, args, spawnOptions)
  publishScannerResult(result, request.fault)
}

function readRequest() {
  if (
    atomicsLoad(header, VERSION) !== 1 ||
    atomicsLoad(header, OUTCOME) !== NONE ||
    atomicsLoad(header, RESPONSE_LENGTH) !== 0 ||
    atomicsLoad(header, DETAIL) !== NONE ||
    !headerHasZeroReservedWords()
  ) {
    throw new Error('invalid header')
  }
  const length = atomicsLoad(header, REQUEST_LENGTH)
  if (length < 1 || length > REQUEST_CAPACITY) throw new Error('invalid request length')
  const text = textDecode(textDecoder, uint8ArraySubarray(requestBytes, 0, length))
  const request = jsonParse(text)
  if (
    !exactKeys(request, ['v', 'nodeVersion', 'operationRoot', 'operationKey', 'fault']) ||
    request.v !== 1 ||
    request.nodeVersion !== processNodeVersion ||
    typeof request.operationRoot !== 'string' ||
    typeof request.operationKey !== 'string' ||
    !regexpTest(lowerHex64, request.operationKey) ||
    (request.fault !== null &&
      (typeof request.fault !== 'string' || !setHas(requestFaults, request.fault))) ||
    jsonStringify(request) !== text
  ) {
    throw new Error('invalid request')
  }
  activeFault = request.fault
  if (activeFault === 'malformed-request') throw new Error('injected malformed request')
  return request
}

function releasedMemoryIsZero() {
  for (let index = 4; index < sharedBytes.length; index += 1) {
    if (sharedBytes[index] !== 0) return false
  }
  return true
}

function resetReleasedRequest() {
  if (activeFault === 'release-delay') atomicsWait(header, 6, 0, 100)
  if (activeFault === 'release-failed' || !releasedMemoryIsZero()) {
    publishCas(RELEASE, FAILED)
    return
  }
  activeFault = null
  atomicsStore(header, VERSION, 1)
  clearTerminal()
  atomicsStore(header, REQUEST_LENGTH, 0)
  if (publishCas(RELEASE, READY) !== RELEASE) publishCas(RELEASE, FAILED)
}

function processRun() {
  try {
    const request = readRequest()
    if (request.fault === 'failed-state') {
      publishCas(RUN, FAILED)
      return
    }
    runScanner(request)
  } catch {
    publishRunTerminal(PROTOCOL_ERROR, BROKER)
  }
}

function mainLoop() {
  for (;;) {
    const state = atomicsLoad(header, STATE)
    if (state === READY || state === RESERVED || state === DONE) {
      atomicsWait(header, STATE, state)
    } else if (state === RUN) {
      processRun()
    } else if (state === CANCEL) {
      publishCancelled()
    } else if (state === RELEASE) {
      resetReleasedRequest()
    } else if (state === FAILED) {
      atomicsWait(header, STATE, FAILED)
    } else {
      const observed = atomicsCompareExchange(header, STATE, state, FAILED)
      if (observed === state) atomicsNotify(header, STATE)
    }
  }
}

function bootstrap() {
  if (bootstrapFault === 'error-before-exit') {
    setImmediateBuiltin(() => {
      throw new Error('injected broker startup error')
    })
    return
  }
  if (bootstrapFault === 'exit-before-ready') {
    processExit(19)
    return
  }
  if (bootstrapFault === 'never-ready' || bootstrapFault === 'termination-timeout') {
    atomicsWait(header, 6, 0)
    return
  }
  try {
    if (
      !(sharedBuffer instanceof SharedArrayBuffer) ||
      sharedBuffer.byteLength !== 64 * 1024 ||
      typeof scannerSource !== 'string' ||
      typeof spawnSyncBuiltin !== 'function' ||
      typeof pathJoin !== 'function' ||
      typeof atomicsCompareExchange !== 'function' ||
      typeof atomicsWait !== 'function' ||
      atomicsLoad(header, VERSION) !== 1 ||
      atomicsLoad(header, OUTCOME) !== NONE ||
      atomicsLoad(header, REQUEST_LENGTH) !== 0 ||
      atomicsLoad(header, RESPONSE_LENGTH) !== 0 ||
      atomicsLoad(header, DETAIL) !== NONE ||
      !headerHasZeroReservedWords()
    ) {
      throw new Error('startup failure')
    }
    if (publishCas(BOOT, READY) !== BOOT) {
      publishCas(BOOT, FAILED)
      return
    }
  } catch {
    publishCas(BOOT, FAILED)
    return
  }
  mainLoop()
}

bootstrap()
`

const OPERATION_KEY_DOMAIN = bufferFrom(
  'shikin.database-operation-recovery-journal/v1/operation-key\0',
  'utf8'
)
const ARTIFACT_KEY_DOMAIN = bufferFrom(
  'shikin.database-operation-recovery-journal/v1/artifact-key\0',
  'utf8'
)
const ARTIFACT_CONTENT_DOMAIN = bufferFrom(
  'shikin.database-operation-recovery-journal/v1/artifact-content\0',
  'utf8'
)
const RECORD_DOMAIN = bufferFrom('shikin.database-operation-recovery-journal/v1/record\0', 'utf8')
const ZERO_BYTE = bufferFrom([0])
const DATABASE_IDENTITY_HASH = hashDigest(
  hashUpdate(createHashBuiltin('sha256'), DATABASE_IDENTITY, 'utf8'),
  'hex'
)

const BROKER_SHARED_BYTES = 64 * 1024
const BROKER_HEADER_WORDS = 16
const BROKER_REQUEST_BYTES = 32 * 1024
const BROKER_RESPONSE_BYTES = 8 * 1024
const BROKER_REQUEST_OFFSET = BROKER_HEADER_WORDS * 4
const BROKER_RESPONSE_OFFSET = BROKER_REQUEST_OFFSET + BROKER_REQUEST_BYTES
const BROKER_STATE_INDEX = 0
const BROKER_VERSION_INDEX = 1
const BROKER_OUTCOME_INDEX = 2
const BROKER_REQUEST_LENGTH_INDEX = 3
const BROKER_RESPONSE_LENGTH_INDEX = 4
const BROKER_DETAIL_INDEX = 5
const BROKER_BOOT = 0
const BROKER_READY = 1
const BROKER_RESERVED = 2
const BROKER_RUN = 3
const BROKER_CANCEL = 4
const BROKER_DONE = 5
const BROKER_RELEASE = 6
const BROKER_FAILED = 7
const BROKER_OUTCOME_NONE = 0
const BROKER_OUTCOME_OK = 1
const BROKER_OUTCOME_FILESYSTEM_ERROR = 2
const BROKER_OUTCOME_LAYOUT_MISMATCH = 3
const BROKER_OUTCOME_RESPONSE_OVERFLOW = 4
const BROKER_OUTCOME_SCANNER_TIMEOUT = 5
const BROKER_OUTCOME_SCANNER_FAILURE = 6
const BROKER_OUTCOME_CANCELLED = 7
const BROKER_OUTCOME_PROTOCOL_ERROR = 8
const BROKER_DETAIL_NONE = 0
const BROKER_DETAIL_RECOVERY = 1
const BROKER_DETAIL_OPERATION = 2
const BROKER_DETAIL_RECORDS = 3
const BROKER_DETAIL_ARTIFACTS = 4
const BROKER_DETAIL_BROKER = 5
const BROKER_DETAIL_SCANNER = 6
const BROKER_BOOTSTRAP_TIMEOUT_MS = 2_000
const BROKER_TERMINATION_TIMEOUT_MS = 2_000
const BROKER_RESPONSE_TIMEOUT_MS = 7_000
const BROKER_CANCELLATION_TIMEOUT_MS = 2_000
const BROKER_RELEASE_TIMEOUT_MS = 2_000
const BROKER_TEST_RESPONSE_TIMEOUT_MS = 25
const BROKER_TEST_CANCELLATION_TIMEOUT_MS = 25
const BROKER_TEST_RELEASE_TIMEOUT_MS = 25
const BROKER_PROTOCOL_VERSION = 1

export const RECOVERY_JOURNAL_SCANNER_FAULTS_FOR_TEST = objectFreeze([
  'malformed-request',
  'worker-malformed-response',
  'response-overflow',
  'scanner-spawn-error',
  'scanner-timeout',
  'scanner-status',
  'scanner-signal',
  'scanner-stderr',
  'scanner-malformed-response',
  'scanner-extra-output',
  'scanner-protocol-version',
  'scanner-node-version',
  'scanner-read-failure',
  'scanner-close-failure',
  'recovery-count-mismatch',
  'recovery-name-mismatch',
  'operation-count-mismatch',
  'operation-name-mismatch',
  'records-count-mismatch',
  'records-name-mismatch',
  'artifacts-count-mismatch',
  'artifacts-name-mismatch',
  'pre-done-timeout',
  'cancellation-delay',
  'malformed-cancelled-terminal',
  'release-delay',
  'release-failed',
  'failed-state',
])
const recoveryJournalScannerFaultsForTest = new Set(RECOVERY_JOURNAL_SCANNER_FAULTS_FOR_TEST)
const RECOVERY_JOURNAL_BROKER_BOOTSTRAP_FAULTS_FOR_TEST = objectFreeze([
  'constructor-failure',
  'error-before-exit',
  'exit-before-ready',
  'never-ready',
  'termination-timeout',
])
const recoveryJournalBrokerBootstrapFaultsForTest = new Set(
  RECOVERY_JOURNAL_BROKER_BOOTSTRAP_FAULTS_FOR_TEST
)
const recoveryJournalBrokerBootstrapFaultForTest = runtimeIsTest
  ? runtimeEnvironment.SHIKIN_RECOVERY_JOURNAL_BROKER_BOOTSTRAP_FAULT
  : undefined

const COMMITTED_OPTIONS_KEYS = objectFreeze(['operationRoot', 'stateRevision', 'intent'])
const COMMITTED_INTENT_KEYS = objectFreeze([
  'recordKind',
  'operationId',
  'operation',
  'phase',
  'owner',
  'fencingGeneration',
  'createdAt',
  'updatedAt',
  'recoveryCommitment',
])
const COMMITTED_OWNER_KEYS = objectFreeze([
  'ownerId',
  'runtimeId',
  'hostId',
  'processId',
  'processStartedAt',
])
const RECOVERY_COMMITMENT_KEYS = objectFreeze([
  'shikin.recovery.protocol',
  'shikin.recovery.version',
  'shikin.recovery.recordSha256',
  'shikin.recovery.durability',
  'shikin.recovery.claimSequence',
])

const proofState = new WeakMap()
const verifiedTokenState = new WeakMap()
const committedEvidenceTokenState = new WeakMap()
const internalRecoveryJournalErrors = new WeakSet()
const internalCommittedBoundaryErrors = new WeakSet()
let interArtifactHashTestHook
let recoveryJournalScannerFaultForTest

export class RecoveryJournalError extends ErrorConstructor {
  constructor(code, message, cause) {
    super(message)
    objectDefineProperties(this, {
      name: {
        configurable: true,
        enumerable: true,
        value: 'RecoveryJournalError',
        writable: true,
      },
      code: { configurable: true, enumerable: true, value: code, writable: true },
    })
    if (cause !== undefined) {
      objectDefineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: cause,
        writable: true,
      })
    }
  }
}

function createInternalRecord(fields) {
  const record = objectCreate(null)
  const keys = objectKeys(fields)
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    objectDefineProperty(record, key, {
      configurable: true,
      enumerable: true,
      value: fields[key],
      writable: true,
    })
  }
  return record
}

function freezeInternalRecord(fields) {
  return objectFreeze(createInternalRecord(fields))
}

// Array.prototype.push performs [[Set]] and can dispatch inherited numeric properties.
function appendArrayValue(values, value) {
  const nextIndex = NumberConstructor(values.length)
  objectDefineProperty(
    values,
    StringConstructor(nextIndex),
    createInternalRecord({
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    })
  )
}

function freezeIndexedIntegritySequence(values) {
  const sequence = objectCreate(null)
  for (let index = 0; index < values.length; index += 1) {
    objectDefineProperty(
      sequence,
      StringConstructor(index),
      createInternalRecord({
        configurable: false,
        enumerable: true,
        value: values[index],
        writable: false,
      })
    )
  }
  objectDefineProperty(
    sequence,
    'length',
    createInternalRecord({
      configurable: false,
      enumerable: false,
      value: values.length,
      writable: false,
    })
  )
  return objectFreeze(sequence)
}

function captureIntegrityDescriptor(descriptor) {
  const data = hasOwnProperty(descriptor, 'value')
  return freezeInternalRecord({
    kind: data ? 'data' : 'accessor',
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    writable: data ? descriptor.writable : undefined,
    value: data ? descriptor.value : undefined,
    get: data ? undefined : descriptor.get,
    set: data ? undefined : descriptor.set,
  })
}

function captureProtectedPrototypeIntegritySnapshots() {
  const targets = []
  const seen = new WeakSet()
  const roots = [
    objectPrototype,
    ErrorConstructor,
    errorPrototype,
    TypeErrorConstructor,
    typeErrorPrototype,
    fsStatsPrototype,
    bootstrapBigIntStatsPrototype,
    bootstrapBufferInstancePrototype,
    bufferPrototype,
    uint8ArrayPrototype,
    typedArrayPrototype,
    hashPrototype,
  ]
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    let target = roots[rootIndex]
    while (target !== null && !weakSetHas(seen, target)) {
      weakSetAdd(seen, target)
      appendArrayValue(targets, target)
      target = objectGetPrototypeOf(target)
    }
  }

  const snapshots = []
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex]
    const currentKeys = reflectOwnKeys(target)
    const keys = []
    const descriptors = []
    for (let keyIndex = 0; keyIndex < currentKeys.length; keyIndex += 1) {
      const key = currentKeys[keyIndex]
      appendArrayValue(keys, key)
      appendArrayValue(
        descriptors,
        captureIntegrityDescriptor(objectGetOwnPropertyDescriptor(target, key))
      )
    }
    appendArrayValue(
      snapshots,
      freezeInternalRecord({
        target,
        prototype: objectGetPrototypeOf(target),
        keys: freezeIndexedIntegritySequence(keys),
        descriptors: freezeIndexedIntegritySequence(descriptors),
      })
    )
  }
  return freezeIndexedIntegritySequence(snapshots)
}

function integrityDescriptorIsExact(descriptor, expected) {
  if (descriptor === undefined) return false
  const data = hasOwnProperty(descriptor, 'value')
  if ((data ? 'data' : 'accessor') !== expected.kind) return false
  if (
    descriptor.configurable !== expected.configurable ||
    descriptor.enumerable !== expected.enumerable
  ) {
    return false
  }
  if (data) {
    return descriptor.writable === expected.writable && objectIs(descriptor.value, expected.value)
  }
  return objectIs(descriptor.get, expected.get) && objectIs(descriptor.set, expected.set)
}

function protectedPrototypeIntegrityIsExact() {
  try {
    for (
      let targetIndex = 0;
      targetIndex < protectedPrototypeIntegritySnapshots.length;
      targetIndex += 1
    ) {
      const snapshot = protectedPrototypeIntegritySnapshots[targetIndex]
      if (!objectIs(objectGetPrototypeOf(snapshot.target), snapshot.prototype)) return false
      const keys = reflectOwnKeys(snapshot.target)
      if (keys.length !== snapshot.keys.length) return false
      for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
        const key = keys[keyIndex]
        if (!objectIs(key, snapshot.keys[keyIndex])) return false
        if (
          !integrityDescriptorIsExact(
            objectGetOwnPropertyDescriptor(snapshot.target, key),
            snapshot.descriptors[keyIndex]
          )
        ) {
          return false
        }
      }
    }
    return true
  } catch {
    return false
  }
}

function assertProtectedPrototypeIntegrity() {
  if (!protectedPrototypeIntegrityIsExact()) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'Committed recovery prototype integrity check failed'
    )
  }
}

export function setRecoveryJournalInterArtifactHashTestHookForTest(hook) {
  if (
    runtimeEnvironment.NODE_ENV !== 'test' ||
    (hook !== undefined && typeof hook !== 'function')
  ) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Recovery test hook is test-only')
  }
  interArtifactHashTestHook = hook
}

export function setRecoveryJournalScannerFaultForTest(fault) {
  if (
    runtimeEnvironment.NODE_ENV !== 'test' ||
    (fault !== undefined &&
      (typeof fault !== 'string' || !setHas(recoveryJournalScannerFaultsForTest, fault)))
  ) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Recovery scanner fault is test-only')
  }
  recoveryJournalScannerFaultForTest = fault
}

export function prepareMutationJournal(options) {
  try {
    const binding = validatePrepareOptions(options)
    requireLinuxDurability()
    const rootIdentity = validateOperationRoot(binding.operationRoot)
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    const parentIdentities = ensureJournalParents(paths, rootIdentity)

    if (pathExists(paths.operation)) {
      throw journalError(
        'RECOVERY_PREPARATION_INCOMPLETE',
        'An operation directory already exists and must not be read, modified, or reused'
      )
    }

    const directoryIdentities = new Map(
      parentIdentities.map((identity) => [identity.path, identity])
    )
    const operationIdentity = createPrivateDirectory(
      paths.operation,
      'after-operation-directory-create'
    )
    directoryIdentities.set(paths.operation, operationIdentity)
    const artifactsIdentity = createPrivateDirectory(
      paths.artifacts,
      'after-artifacts-directory-create'
    )
    directoryIdentities.set(paths.artifacts, artifactsIdentity)
    const recordsIdentity = createPrivateDirectory(paths.records, 'after-records-directory-create')
    directoryIdentities.set(paths.records, recordsIdentity)

    const nonce = bufferToString(randomBytesBuiltin(32), 'hex')
    const artifactRecords = {}
    const checks = {}
    for (const role of ROLES) {
      const artifactKey = recoveryArtifactKey(paths.operationKey, nonce, role)
      const filename = `${role}-${artifactKey}.sqlite`
      const artifactPath = pathJoin(paths.artifacts, filename)
      const result = writePreparedArtifact(role, artifactPath, binding, options.writeArtifact)
      artifactRecords[role] = {
        path: `artifacts/${filename}`,
        contentDigest: result.contentDigest,
        sizeBytes: result.sizeBytes,
      }
      checks[role] = result.checks
    }

    assertExactDirectoryEntries(
      paths.artifacts,
      [pathBasename(artifactRecords.candidate.path), pathBasename(artifactRecords.rollback.path)],
      true
    )
    assertNoSqliteSidecars(paths.artifacts)

    const record = {
      protocol: PROTOCOL,
      protocolVersion: PROTOCOL_VERSION,
      recordKind: 'prepared_mutation',
      sequence: 0,
      previousRecordSha256: null,
      databaseIdentity: DATABASE_IDENTITY,
      operationId: binding.intent.operationId,
      operation: binding.intent.operation,
      owner: cloneOwner(binding.intent.owner),
      fencingGeneration: binding.intent.fencingGeneration,
      createdAt: binding.intent.createdAt,
      nonce,
      candidate: artifactRecords.candidate,
      rollback: artifactRecords.rollback,
      schemaContract: schemaContractIdentity(),
      checks: {
        candidate: checks.candidate,
        rollback: checks.rollback,
      },
    }
    const canonicalBytes = canonicalRecoveryJournalBytes(record)
    const commitmentSha256 = recoveryRecordHash(canonicalBytes)
    const recordPath = pathJoin(paths.records, `00000000000000000000-${commitmentSha256}.json`)
    writePreparedRecord(recordPath, canonicalBytes)

    const durability = finishDurability(paths)
    revalidateDirectoryIdentities(directoryIdentities)
    revalidateDirectoryIdentity(rootIdentity)
    const evidence = validateCompleteOperation(paths, binding)
    if (evidence.commitmentSha256 !== commitmentSha256) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record commitment changed')
    }
    return mintPreparedMutation(binding, paths, evidence, durability)
  } catch (error) {
    throw normalizeError(error)
  }
}

export function verifyPreparedMutationProof(proof, options) {
  const state = proofState.get(proof)
  if (!state) throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof is not authentic')
  if (state.used) throw journalError('PREPARED_PROOF_USED', 'Prepared proof was already consumed')
  if (state.active) {
    throw journalError('PREPARED_PROOF_ACTIVE', 'Prepared proof already has an active verifier')
  }
  try {
    const binding = validateVerificationOptions(options)
    if (!sameBinding(binding, state.binding)) {
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof binding does not match')
    }
    requireLinuxDurability()
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    if (paths.operation !== state.paths.operation) {
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof path does not match')
    }
    const evidence = validateCompleteOperation(paths, binding, true)
    if (
      evidence.commitmentSha256 !== state.commitmentSha256 ||
      evidence.durability !== state.durability
    ) {
      closeRetainedEvidence(evidence.retainedEvidence)
      throw journalError('PREPARED_PROOF_INVALID', 'Prepared proof commitment does not match')
    }
    const token = objectFreeze(objectCreate(null))
    const tokenState = {
      proof: state,
      binding: cloneBinding(binding),
      commitment: objectFreeze({
        commitmentSha256: evidence.commitmentSha256,
        durability: evidence.durability,
      }),
      retainedEvidence: evidence.retainedEvidence,
      status: 'active',
    }
    state.active = true
    verifiedTokenState.set(token, tokenState)
    return token
  } catch (error) {
    throw normalizeError(error)
  }
}

export function revalidateVerifiedPreparedMutationToken(token, options) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState) throw journalError('PREPARED_PROOF_INVALID', 'Verified token is not authentic')
  if (tokenState.proof.used) {
    throw journalError('PREPARED_PROOF_USED', 'Prepared proof was already consumed')
  }
  if (tokenState.status !== 'active' || !tokenState.proof.active) {
    throw journalError('PREPARED_PROOF_INVALID', 'Verified token is not active')
  }
  try {
    const binding = validateVerificationOptions(options)
    if (
      !sameBinding(binding, tokenState.binding) ||
      !sameBinding(binding, tokenState.proof.binding)
    ) {
      throw journalError('PREPARED_PROOF_INVALID', 'Verified token binding does not match')
    }
    requireLinuxDurability()
    revalidateRetainedEvidence(tokenState.retainedEvidence, 'prepared')
    return tokenState.commitment
  } catch (error) {
    throw normalizeError(error)
  }
}

export function releaseVerifiedPreparedMutationToken(token) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState || tokenState.status !== 'active') return
  tokenState.status = 'released'
  tokenState.proof.active = false
  const retainedEvidence = tokenState.retainedEvidence
  tokenState.retainedEvidence = null
  closeRetainedEvidence(retainedEvidence)
}

export function consumeVerifiedPreparedMutationToken(token) {
  const tokenState = verifiedTokenState.get(token)
  if (!tokenState || tokenState.status !== 'active') return
  tokenState.status = 'consumed'
  tokenState.proof.used = true
  tokenState.proof.active = false
  const retainedEvidence = tokenState.retainedEvidence
  tokenState.retainedEvidence = null
  closeRetainedEvidence(retainedEvidence)
}

const committedDirectoryBrokerSession = await bootstrapCommittedDirectoryBroker()

function brokerNowMilliseconds() {
  return NumberConstructor(monotonicNowNanoseconds() / 1_000_000n)
}

function waitForBootstrapTurn() {
  return new PromiseConstructor((complete) => setImmediateBuiltin(complete))
}

async function bootstrapCommittedDirectoryBroker() {
  if (runtimePlatform !== 'linux') return undefined
  const bootstrapFault = recoveryJournalBrokerBootstrapFaultForTest
  if (
    bootstrapFault !== undefined &&
    !setHas(recoveryJournalBrokerBootstrapFaultsForTest, bootstrapFault)
  ) {
    return freezeInternalRecord({ bootstrapFailure: 'broker-bootstrap', worker: undefined })
  }
  if (bootstrapFault === 'constructor-failure') {
    return freezeInternalRecord({ bootstrapFailure: 'broker-bootstrap', worker: undefined })
  }

  let sharedBuffer
  let header
  let bytes
  let requestBytes
  let responseBytes
  let worker
  try {
    sharedBuffer = new SharedArrayBufferConstructor(BROKER_SHARED_BYTES)
    header = new Int32ArrayConstructor(sharedBuffer, 0, BROKER_HEADER_WORDS)
    bytes = new Uint8ArrayConstructor(sharedBuffer)
    requestBytes = new Uint8ArrayConstructor(
      sharedBuffer,
      BROKER_REQUEST_OFFSET,
      BROKER_REQUEST_BYTES
    )
    responseBytes = new Uint8ArrayConstructor(
      sharedBuffer,
      BROKER_RESPONSE_OFFSET,
      BROKER_RESPONSE_BYTES
    )
    atomicsStore(header, BROKER_VERSION_INDEX, BROKER_PROTOCOL_VERSION)
    const workerData = objectCreate(null)
    workerData.sharedBuffer = sharedBuffer
    workerData.scannerSource = COMMITTED_DIRECTORY_SCANNER_SOURCE
    workerData.bootstrapFault = bootstrapFault
    const environment = objectCreate(null)
    environment.LANG = 'C'
    environment.LC_ALL = 'C'
    environment.NODE_OPTIONS = ''
    environment.NODE_PATH = ''
    environment.LD_PRELOAD = ''
    environment.LD_LIBRARY_PATH = ''
    const workerOptions = objectCreate(null)
    workerOptions.eval = true
    workerOptions.workerData = workerData
    workerOptions.env = environment
    workerOptions.execArgv = []
    worker = new WorkerConstructor(COMMITTED_DIRECTORY_BROKER_SOURCE, workerOptions)
  } catch (error) {
    return freezeInternalRecord({
      bootstrapFailure: 'broker-bootstrap',
      bootstrapCause: error,
      worker: undefined,
    })
  }

  let online = false
  let exited = false
  let startupError
  const onOnline = () => {
    online = true
  }
  const onError = (error) => {
    startupError = error
  }
  const onExit = () => {
    exited = true
  }
  try {
    workerOn(worker, 'online', onOnline)
    workerOn(worker, 'error', onError)
    workerOn(worker, 'exit', onExit)
  } catch (error) {
    startupError = error
  }

  const startupDeadline = brokerNowMilliseconds() + BROKER_BOOTSTRAP_TIMEOUT_MS
  while (
    startupError === undefined &&
    !exited &&
    !(online && atomicsLoad(header, BROKER_STATE_INDEX) === BROKER_READY) &&
    brokerNowMilliseconds() < startupDeadline
  ) {
    await waitForBootstrapTurn()
  }
  if (
    startupError === undefined &&
    !exited &&
    online &&
    atomicsLoad(header, BROKER_STATE_INDEX) === BROKER_READY
  ) {
    await waitForBootstrapTurn()
  }
  if (
    startupError === undefined &&
    !exited &&
    online &&
    atomicsLoad(header, BROKER_STATE_INDEX) === BROKER_READY
  ) {
    try {
      workerRemoveListener(worker, 'online', onOnline)
      workerRemoveListener(worker, 'error', onError)
      workerRemoveListener(worker, 'exit', onExit)
      workerUnref(worker)
    } catch (error) {
      startupError = error
    }
  }
  if (
    startupError === undefined &&
    !exited &&
    atomicsLoad(header, BROKER_STATE_INDEX) === BROKER_READY
  ) {
    return createInternalRecord({
      bootstrapFailure: undefined,
      worker,
      header,
      bytes,
      requestBytes,
      responseBytes,
    })
  }

  if (!exited && bootstrapFault !== 'termination-timeout') {
    try {
      const termination = workerTerminate(worker)
      if (termination !== undefined && termination !== null) promiseCatch(termination, () => {})
    } catch (error) {
      if (startupError === undefined) startupError = error
    }
  }
  const terminationDeadline = brokerNowMilliseconds() + BROKER_TERMINATION_TIMEOUT_MS
  while (!exited && brokerNowMilliseconds() < terminationDeadline) {
    await waitForBootstrapTurn()
  }
  if (!exited) {
    try {
      workerUnref(worker)
    } catch (error) {
      if (startupError === undefined) startupError = error
    }
  }
  return createInternalRecord({
    bootstrapFailure: 'broker-bootstrap',
    bootstrapCause: startupError,
    terminationTimeout: !exited,
    worker: exited ? undefined : worker,
  })
}

function publishCommittedDirectoryBrokerState(session, from, to) {
  const observed = atomicsCompareExchange(session.header, BROKER_STATE_INDEX, from, to)
  if (observed === from) atomicsNotify(session.header, BROKER_STATE_INDEX)
  return observed
}

function waitForCommittedBrokerStateChange(session, state, timeout) {
  const deadline = brokerNowMilliseconds() + timeout
  let observed = atomicsLoad(session.header, BROKER_STATE_INDEX)
  while (observed === state) {
    const remaining = deadline - brokerNowMilliseconds()
    if (remaining <= 0) break
    atomicsWait(session.header, BROKER_STATE_INDEX, state, remaining)
    observed = atomicsLoad(session.header, BROKER_STATE_INDEX)
  }
  return observed
}

function markCommittedBrokerFailed(session, state) {
  const observed = publishCommittedDirectoryBrokerState(session, state, BROKER_FAILED)
  return observed === state || observed === BROKER_FAILED
}

function validateStaleCommittedBrokerCancellation(session) {
  if (
    atomicsLoad(session.header, BROKER_VERSION_INDEX) !== BROKER_PROTOCOL_VERSION ||
    atomicsLoad(session.header, BROKER_OUTCOME_INDEX) !== BROKER_OUTCOME_CANCELLED ||
    atomicsLoad(session.header, BROKER_DETAIL_INDEX) !== BROKER_DETAIL_NONE ||
    atomicsLoad(session.header, BROKER_RESPONSE_LENGTH_INDEX) !== 0
  ) {
    return false
  }
  const requestLength = atomicsLoad(session.header, BROKER_REQUEST_LENGTH_INDEX)
  if (requestLength < 0 || requestLength > BROKER_REQUEST_BYTES) return false
  for (let index = 6; index < BROKER_HEADER_WORDS; index += 1) {
    if (atomicsLoad(session.header, index) !== 0) return false
  }
  return true
}

function scrubCommittedBrokerMemory(session) {
  uint8ArrayFill(session.bytes, 0, 4)
}

function publishCommittedBrokerRelease(session, from) {
  scrubCommittedBrokerMemory(session)
  return publishCommittedDirectoryBrokerState(session, from, BROKER_RELEASE)
}

function waitForCommittedBrokerReady(session, timeout) {
  const state = waitForCommittedBrokerStateChange(session, BROKER_RELEASE, timeout)
  return state === BROKER_READY
}

function reserveCommittedDirectoryBroker() {
  const session = committedDirectoryBrokerSession
  if (runtimePlatform !== 'linux') {
    return createInternalRecord({ session: undefined, owned: false, failure: undefined })
  }
  if (session === undefined || session.bootstrapFailure !== undefined) {
    return createInternalRecord({ session, owned: false, failure: 'broker-bootstrap' })
  }
  for (;;) {
    const state = atomicsLoad(session.header, BROKER_STATE_INDEX)
    if (state === BROKER_READY) {
      const observed = publishCommittedDirectoryBrokerState(session, BROKER_READY, BROKER_RESERVED)
      if (observed === BROKER_READY) {
        return createInternalRecord({
          session,
          owned: true,
          failure: undefined,
          fault: undefined,
          cancellationIncomplete: false,
          releaseIncomplete: false,
          terminalValid: false,
        })
      }
      continue
    }
    if (state === BROKER_RESERVED || state === BROKER_RUN || state === BROKER_CANCEL) {
      return createInternalRecord({ session, owned: false, failure: 'broker-busy' })
    }
    if (state === BROKER_RELEASE) {
      if (!waitForCommittedBrokerReady(session, BROKER_RELEASE_TIMEOUT_MS)) {
        return createInternalRecord({
          session,
          owned: false,
          failure: 'broker-release-incomplete',
        })
      }
      continue
    }
    if (state === BROKER_DONE) {
      if (!validateStaleCommittedBrokerCancellation(session)) {
        markCommittedBrokerFailed(session, BROKER_DONE)
        return createInternalRecord({ session, owned: false, failure: 'broker-failed' })
      }
      if (publishCommittedBrokerRelease(session, BROKER_DONE) !== BROKER_DONE) continue
      if (!waitForCommittedBrokerReady(session, BROKER_RELEASE_TIMEOUT_MS)) {
        return createInternalRecord({
          session,
          owned: false,
          failure: 'broker-release-incomplete',
        })
      }
      continue
    }
    if (state === BROKER_BOOT) {
      return createInternalRecord({ session, owned: false, failure: 'broker-bootstrap' })
    }
    if (state === BROKER_FAILED) {
      return createInternalRecord({ session, owned: false, failure: 'broker-failed' })
    }
    markCommittedBrokerFailed(session, state)
    return createInternalRecord({ session, owned: false, failure: 'broker-failed' })
  }
}

function committedBrokerFailure(detail) {
  return journalError('RECOVERY_FILESYSTEM_FAILURE', detail)
}

function attachCommittedBrokerCleanupFailure(failure, detail) {
  return journalError(
    failure.code,
    failure.message,
    journalError('RECOVERY_FILESYSTEM_FAILURE', detail, failure)
  )
}

function brokerRequestTimeout(fault) {
  return fault === 'pre-done-timeout' ||
    fault === 'cancellation-delay' ||
    fault === 'malformed-cancelled-terminal'
    ? BROKER_TEST_RESPONSE_TIMEOUT_MS
    : BROKER_RESPONSE_TIMEOUT_MS
}

function brokerCancellationTimeout(fault) {
  return fault === 'cancellation-delay' || fault === 'malformed-cancelled-terminal'
    ? BROKER_TEST_CANCELLATION_TIMEOUT_MS
    : BROKER_CANCELLATION_TIMEOUT_MS
}

function brokerReleaseTimeout(fault) {
  return fault === 'release-delay' || fault === 'release-failed'
    ? BROKER_TEST_RELEASE_TIMEOUT_MS
    : BROKER_RELEASE_TIMEOUT_MS
}

function runCommittedDirectoryBrokerScan(reservation, paths) {
  const session = reservation.session
  const fault = recoveryJournalScannerFaultForTest ?? null
  reservation.fault = fault
  const requestText =
    '{"v":1,"nodeVersion":' +
    hardenedCanonicalString(runtimeNodeVersion) +
    ',"operationRoot":' +
    hardenedCanonicalString(paths.operationRoot) +
    ',"operationKey":' +
    hardenedCanonicalString(paths.operationKey) +
    ',"fault":' +
    (fault === null ? 'null' : hardenedCanonicalString(fault)) +
    '}'
  const request = bufferFrom(requestText, 'utf8')
  if (request.length > BROKER_REQUEST_BYTES) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  uint8ArrayFill(session.requestBytes, 0)
  uint8ArrayFill(session.responseBytes, 0)
  uint8ArraySet(session.requestBytes, request, 0)
  atomicsStore(session.header, BROKER_VERSION_INDEX, BROKER_PROTOCOL_VERSION)
  atomicsStore(session.header, BROKER_OUTCOME_INDEX, BROKER_OUTCOME_NONE)
  atomicsStore(session.header, BROKER_REQUEST_LENGTH_INDEX, request.length)
  atomicsStore(session.header, BROKER_RESPONSE_LENGTH_INDEX, 0)
  atomicsStore(session.header, BROKER_DETAIL_INDEX, BROKER_DETAIL_NONE)
  for (let index = 6; index < BROKER_HEADER_WORDS; index += 1) {
    atomicsStore(session.header, index, 0)
  }
  const observed = publishCommittedDirectoryBrokerState(session, BROKER_RESERVED, BROKER_RUN)
  if (observed !== BROKER_RESERVED) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }

  let state = waitForCommittedBrokerStateChange(session, BROKER_RUN, brokerRequestTimeout(fault))
  if (state === BROKER_DONE) return readCommittedDirectoryBrokerTerminal(reservation, true)
  if (state === BROKER_RUN) {
    const winner = publishCommittedDirectoryBrokerState(session, BROKER_RUN, BROKER_CANCEL)
    if (winner === BROKER_DONE) return readCommittedDirectoryBrokerTerminal(reservation, true)
    if (winner !== BROKER_RUN && winner !== BROKER_CANCEL) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    state = BROKER_CANCEL
  }
  if (state === BROKER_CANCEL) {
    state = waitForCommittedBrokerStateChange(
      session,
      BROKER_CANCEL,
      brokerCancellationTimeout(fault)
    )
    if (state !== BROKER_DONE) {
      reservation.cancellationIncomplete = true
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout')
    }
    if (!validateStaleCommittedBrokerCancellation(session)) {
      markCommittedBrokerFailed(session, BROKER_DONE)
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout')
    }
    reservation.terminalValid = true
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-response-timeout')
  }
  if (state === BROKER_FAILED) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-failed')
  }
  throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
}

function readCommittedDirectoryBrokerTerminal(reservation, requestWasPublished) {
  const session = reservation.session
  try {
    if (atomicsLoad(session.header, BROKER_STATE_INDEX) !== BROKER_DONE) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    if (atomicsLoad(session.header, BROKER_VERSION_INDEX) !== BROKER_PROTOCOL_VERSION) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    for (let index = 6; index < BROKER_HEADER_WORDS; index += 1) {
      if (atomicsLoad(session.header, index) !== 0) {
        throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
      }
    }
    const requestLength = atomicsLoad(session.header, BROKER_REQUEST_LENGTH_INDEX)
    const responseLength = atomicsLoad(session.header, BROKER_RESPONSE_LENGTH_INDEX)
    const outcome = atomicsLoad(session.header, BROKER_OUTCOME_INDEX)
    const detail = atomicsLoad(session.header, BROKER_DETAIL_INDEX)
    if (
      requestLength < 0 ||
      requestLength > BROKER_REQUEST_BYTES ||
      (requestWasPublished && requestLength < 1) ||
      responseLength < 0 ||
      responseLength > BROKER_RESPONSE_BYTES
    ) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    let response
    if (responseLength > 0) {
      response = bufferAlloc(responseLength)
      for (let index = 0; index < responseLength; index += 1) {
        response[index] = session.responseBytes[index]
      }
    }
    validateCommittedDirectoryBrokerTerminalMatrix(outcome, detail, responseLength)
    if (outcome === BROKER_OUTCOME_OK) {
      if (!requestWasPublished) {
        throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
      }
      const parsed = parseCommittedDirectoryBrokerResponse(response)
      reservation.terminalValid = true
      return parsed
    }
    reservation.terminalValid = true
    throw committedDirectoryBrokerOutcomeError(outcome, detail)
  } catch (error) {
    if (!reservation.terminalValid) markCommittedBrokerFailed(session, BROKER_DONE)
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol', error)
  }
}

function validateCommittedDirectoryBrokerTerminalMatrix(outcome, detail, responseLength) {
  if (outcome === BROKER_OUTCOME_OK) {
    if (detail !== BROKER_DETAIL_NONE || responseLength < 1) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    return
  }
  if (responseLength !== 0) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  if (
    outcome === BROKER_OUTCOME_FILESYSTEM_ERROR &&
    detail >= BROKER_DETAIL_RECOVERY &&
    detail <= BROKER_DETAIL_SCANNER
  ) {
    return
  }
  if (
    outcome === BROKER_OUTCOME_LAYOUT_MISMATCH &&
    detail >= BROKER_DETAIL_RECOVERY &&
    detail <= BROKER_DETAIL_ARTIFACTS
  ) {
    return
  }
  if (
    (outcome === BROKER_OUTCOME_RESPONSE_OVERFLOW && detail === BROKER_DETAIL_BROKER) ||
    (outcome === BROKER_OUTCOME_SCANNER_TIMEOUT && detail === BROKER_DETAIL_SCANNER) ||
    (outcome === BROKER_OUTCOME_SCANNER_FAILURE && detail === BROKER_DETAIL_SCANNER) ||
    (outcome === BROKER_OUTCOME_CANCELLED && detail === BROKER_DETAIL_NONE) ||
    (outcome === BROKER_OUTCOME_PROTOCOL_ERROR &&
      (detail === BROKER_DETAIL_BROKER || detail === BROKER_DETAIL_SCANNER))
  ) {
    return
  }
  throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
}

function committedDirectoryBrokerRoleName(detail) {
  if (detail === BROKER_DETAIL_RECOVERY) return 'recovery'
  if (detail === BROKER_DETAIL_OPERATION) return 'operation'
  if (detail === BROKER_DETAIL_RECORDS) return 'records'
  if (detail === BROKER_DETAIL_ARTIFACTS) return 'artifacts'
  if (detail === BROKER_DETAIL_BROKER) return 'broker'
  if (detail === BROKER_DETAIL_SCANNER) return 'scanner'
  return undefined
}

function committedDirectoryBrokerOutcomeError(outcome, detail) {
  const role = committedDirectoryBrokerRoleName(detail)
  if (outcome === BROKER_OUTCOME_FILESYSTEM_ERROR) {
    return journalError('RECOVERY_FILESYSTEM_FAILURE', `${role}-filesystem`)
  }
  if (outcome === BROKER_OUTCOME_LAYOUT_MISMATCH) {
    return journalError(
      detail === BROKER_DETAIL_ARTIFACTS
        ? 'RECOVERY_ARTIFACT_CORRUPTION'
        : 'RECOVERY_JOURNAL_CORRUPTION',
      `${role}-layout`
    )
  }
  if (outcome === BROKER_OUTCOME_RESPONSE_OVERFLOW) {
    return journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-response-overflow')
  }
  if (outcome === BROKER_OUTCOME_SCANNER_TIMEOUT) {
    return journalError('RECOVERY_FILESYSTEM_FAILURE', 'scanner-timeout')
  }
  if (outcome === BROKER_OUTCOME_SCANNER_FAILURE) {
    return journalError('RECOVERY_FILESYSTEM_FAILURE', 'scanner-failure')
  }
  if (outcome === BROKER_OUTCOME_PROTOCOL_ERROR) {
    return journalError(
      'RECOVERY_FILESYSTEM_FAILURE',
      detail === BROKER_DETAIL_BROKER ? 'broker-protocol' : 'scanner-protocol'
    )
  }
  return journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
}

function parsedOwnDataValue(value, key) {
  const descriptor = objectGetOwnPropertyDescriptor(value, key)
  if (
    descriptor === undefined ||
    !hasOwnProperty(descriptor, 'value') ||
    descriptor.enumerable !== true
  ) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  return descriptor.value
}

function hasExactParsedKeys(value, expected) {
  if (value === null || typeof value !== 'object' || arrayIsArray(value)) return false
  const keys = reflectOwnKeys(value)
  if (keys.length !== expected.length) return false
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] !== expected[index]) return false
  }
  return true
}

function isSafeCommittedDirectoryName(name) {
  if (typeof name !== 'string' || name.length < 1 || name.length > 512) return false
  for (let index = 0; index < name.length; index += 1) {
    const byte = stringCharCodeAt(name, index)
    if (
      !(
        (byte >= 0x41 && byte <= 0x5a) ||
        (byte >= 0x61 && byte <= 0x7a) ||
        (byte >= 0x30 && byte <= 0x39) ||
        byte === 0x2e ||
        byte === 0x5f ||
        byte === 0x2d
      )
    ) {
      return false
    }
  }
  return true
}

function parseCommittedDirectoryBrokerResponse(responseBytes) {
  let parsed
  let text
  try {
    text = bufferToString(responseBytes, 'utf8')
    parsed = jsonParse(text)
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol', error)
  }
  if (!hasExactParsedKeys(parsed, ['v', 'nodeVersion', 'entries'])) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  const version = parsedOwnDataValue(parsed, 'v')
  const nodeVersion = parsedOwnDataValue(parsed, 'nodeVersion')
  const sourceEntries = parsedOwnDataValue(parsed, 'entries')
  if (
    version !== BROKER_PROTOCOL_VERSION ||
    nodeVersion !== runtimeNodeVersion ||
    !arrayIsArray(sourceEntries) ||
    sourceEntries.length !== 4
  ) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  const entries = []
  const expectedCounts = [1, 2, 1, 2]
  for (let role = 0; role < 4; role += 1) {
    const sourceNames = parsedOwnDataValue(sourceEntries, StringConstructor(role))
    if (!arrayIsArray(sourceNames) || sourceNames.length !== expectedCounts[role]) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
    }
    const names = []
    for (let index = 0; index < sourceNames.length; index += 1) {
      const name = parsedOwnDataValue(sourceNames, StringConstructor(index))
      if (!isSafeCommittedDirectoryName(name)) {
        throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
      }
      appendArrayValue(names, name)
    }
    objectFreeze(names)
    appendArrayValue(entries, names)
  }
  objectFreeze(entries)
  const copy = freezeInternalRecord({
    v: BROKER_PROTOCOL_VERSION,
    nodeVersion: runtimeNodeVersion,
    entries,
  })
  const canonical = committedDirectoryBrokerResponseText(copy)
  if (!bufferEquals(responseBytes, bufferFrom(canonical, 'utf8'))) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'broker-protocol')
  }
  return copy
}

function committedDirectoryBrokerResponseText(response) {
  let text =
    '{"v":1,"nodeVersion":' + hardenedCanonicalString(response.nodeVersion) + ',"entries":['
  for (let role = 0; role < response.entries.length; role += 1) {
    if (role !== 0) text += ','
    text += '['
    const names = response.entries[role]
    for (let index = 0; index < names.length; index += 1) {
      if (index !== 0) text += ','
      text += hardenedCanonicalString(names[index])
    }
    text += ']'
  }
  return `${text}]}`
}

function finalizeCommittedBrokerReservation(reservation) {
  if (!reservation.owned) return undefined
  if (reservation.cancellationIncomplete) return 'broker-cancellation-incomplete'
  const session = reservation.session
  let state = atomicsLoad(session.header, BROKER_STATE_INDEX)
  if (state === BROKER_RESERVED) {
    const observed = publishCommittedBrokerRelease(session, BROKER_RESERVED)
    state = observed === BROKER_RESERVED ? BROKER_RELEASE : observed
  } else if (state === BROKER_DONE && reservation.terminalValid) {
    const observed = publishCommittedBrokerRelease(session, BROKER_DONE)
    state = observed === BROKER_DONE ? BROKER_RELEASE : observed
  } else if (state === BROKER_RUN) {
    const observed = publishCommittedDirectoryBrokerState(session, BROKER_RUN, BROKER_CANCEL)
    state = observed === BROKER_RUN ? BROKER_CANCEL : observed
  }
  if (state === BROKER_CANCEL) {
    state = waitForCommittedBrokerStateChange(
      session,
      BROKER_CANCEL,
      brokerCancellationTimeout(reservation.fault)
    )
    if (state !== BROKER_DONE || !validateStaleCommittedBrokerCancellation(session)) {
      reservation.cancellationIncomplete = true
      return 'broker-cancellation-incomplete'
    }
    reservation.terminalValid = true
    const observed = publishCommittedBrokerRelease(session, BROKER_DONE)
    state = observed === BROKER_DONE ? BROKER_RELEASE : observed
  }
  if (state === BROKER_RELEASE) {
    if (!waitForCommittedBrokerReady(session, brokerReleaseTimeout(reservation.fault))) {
      reservation.releaseIncomplete = true
      return 'broker-release-incomplete'
    }
    return undefined
  }
  if (state === BROKER_READY) return undefined
  if (state === BROKER_FAILED) return undefined
  reservation.releaseIncomplete = true
  return 'broker-release-incomplete'
}

export function verifyCommittedRecoveryEvidence(options) {
  const reservation = reserveCommittedDirectoryBroker()
  let binding
  let retainedEvidence
  let evidenceResult
  let failure
  try {
    binding = snapshotCommittedRecoveryOptionsBoundary(options)
    assertProtectedPrototypeIntegrity()
    validateCommittedRecoverySnapshot(binding)
  } catch (error) {
    failure = normalizeCommittedError(error)
  }
  if (failure === undefined) {
    try {
      requireLinuxDurability()
      if (reservation.failure !== undefined) throw committedBrokerFailure(reservation.failure)
      const paths = journalPaths(binding.operationRoot, binding.intent.operationId, true)
      const evidence = validateCompleteOperation(paths, binding, true, 'committed', reservation)
      retainedEvidence = evidence.retainedEvidence
      assertCommittedRetainedEvidenceInvariants(
        retainedEvidence,
        evidence.retainedEvidenceExpectations
      )
      evidenceResult = createInternalRecord({
        binding,
        commitment: freezeInternalRecord({
          commitmentSha256: evidence.commitmentSha256,
          durability: evidence.durability,
        }),
        retainedEvidence,
        retainedEvidenceExpectations: evidence.retainedEvidenceExpectations,
      })
    } catch (error) {
      failure = normalizeCommittedError(error)
    }
  }

  const cleanupFailure = finalizeCommittedBrokerReservation(reservation)
  if (cleanupFailure !== undefined) {
    if (failure === undefined) {
      failure = committedBrokerFailure(cleanupFailure)
    } else {
      failure = attachCommittedBrokerCleanupFailure(failure, cleanupFailure)
    }
  } else if (reservation.cancellationIncomplete) {
    failure =
      failure === undefined
        ? committedBrokerFailure('broker-cancellation-incomplete')
        : attachCommittedBrokerCleanupFailure(failure, 'broker-cancellation-incomplete')
  }
  if (failure !== undefined) {
    closeRetainedEvidence(retainedEvidence)
    throw failure
  }

  const token = objectFreeze(objectCreate(null))
  weakMapSet(
    committedEvidenceTokenState,
    token,
    createInternalRecord({
      binding: evidenceResult.binding,
      commitment: evidenceResult.commitment,
      retainedEvidence: evidenceResult.retainedEvidence,
      retainedEvidenceExpectations: evidenceResult.retainedEvidenceExpectations,
      status: 'active',
    })
  )
  return token
}

export function revalidateVerifiedCommittedRecoveryEvidenceToken(token, options) {
  const tokenState = weakMapGet(committedEvidenceTokenState, token)
  if (!tokenState) {
    throw journalError(
      'RECOVERY_EVIDENCE_TOKEN_INVALID',
      'Committed recovery evidence token is not authentic'
    )
  }
  if (tokenState.status !== 'active') {
    throw journalError(
      'RECOVERY_EVIDENCE_TOKEN_RELEASED',
      'Committed recovery evidence token was released'
    )
  }
  try {
    const binding = snapshotCommittedRecoveryOptionsBoundary(options)
    assertProtectedPrototypeIntegrity()
    validateCommittedRecoverySnapshot(binding)
    if (!sameCommittedBinding(binding, tokenState.binding)) {
      throw journalError(
        'RECOVERY_EVIDENCE_BINDING_MISMATCH',
        'Committed recovery evidence token binding does not match'
      )
    }
    requireLinuxDurability()
    assertCommittedRetainedEvidenceInvariants(
      tokenState.retainedEvidence,
      tokenState.retainedEvidenceExpectations
    )
    revalidateRetainedEvidence(tokenState.retainedEvidence, 'committed')
    return tokenState.commitment
  } catch (error) {
    throw normalizeCommittedError(error)
  }
}

export function releaseVerifiedCommittedRecoveryEvidenceToken(token) {
  const tokenState = weakMapGet(committedEvidenceTokenState, token)
  if (!tokenState || tokenState.status !== 'active') return
  tokenState.status = 'released'
  const retainedEvidence = tokenState.retainedEvidence
  tokenState.retainedEvidence = null
  closeRetainedEvidence(retainedEvidence)
}

// Deliberately does not mint a proof. It exists only so both implementations can
// validate the shared immutable on-disk fixture in their test suites.
export function validatePreparedMutationEvidenceForTest(options) {
  try {
    const binding = validateVerificationOptions(options)
    requireLinuxDurability()
    const rootIdentity = validateOperationRoot(binding.operationRoot)
    const paths = journalPaths(binding.operationRoot, binding.intent.operationId)
    const evidence = validateCompleteOperation(paths, binding)
    revalidateDirectoryIdentity(rootIdentity)
    return objectFreeze({
      commitmentSha256: evidence.commitmentSha256,
      durability: evidence.durability,
    })
  } catch (error) {
    throw normalizeError(error)
  }
}

function mintPreparedMutation(binding, paths, evidence, durability) {
  const proof = objectFreeze(objectCreate(null))
  const state = {
    binding: cloneBinding(binding),
    paths: objectFreeze({ operation: paths.operation }),
    commitmentSha256: evidence.commitmentSha256,
    durability,
    used: false,
    active: false,
  }
  proofState.set(proof, state)
  return objectFreeze({
    proof,
    commitmentSha256: evidence.commitmentSha256,
    durability,
  })
}

function writePreparedArtifact(role, path, binding, writeArtifact) {
  let descriptor
  try {
    descriptor = openExclusiveFile(path)
    injectFault(`after-${role}-artifact-create`)
    const reservedIdentity = inspectOpenRegularFile(descriptor, path, 'reserved artifact')
    let callbackResult
    try {
      callbackResult = writeArtifact(
        objectFreeze({
          role,
          path,
          operationId: binding.intent.operationId,
          operation: binding.intent.operation,
          schemaContractIdentity: SHIKIN_SCHEMA_CONTRACT_IDENTITY,
        })
      )
    } catch (error) {
      if (
        runtimeEnvironment.NODE_ENV === 'test' &&
        (weakSetHas(internalRecoveryJournalErrors, error) ||
          error instanceof RecoveryJournalError) &&
        error.code === 'RECOVERY_TEST_FAULT'
      ) {
        throw error
      }
      throw journalError('RECOVERY_VALIDATION_FAILED', `${role} artifact callback failed`, error)
    }
    injectFault(`after-${role}-artifact-callback`)
    let checks
    try {
      checks = validateArtifactCallbackChecks(callbackResult, `${role} artifact callback`)
    } catch (error) {
      if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
      throw journalError(
        'RECOVERY_VALIDATION_FAILED',
        `${role} artifact checks are malformed`,
        error
      )
    }
    revalidateOpenRegularFile(descriptor, path, reservedIdentity, 'artifact')
    flushAndSealFile(descriptor, path, reservedIdentity, `${role} artifact`)
    injectFault(`after-${role}-artifact-fsync`)
    const artifact = hashOpenArtifact(descriptor, path, reservedIdentity, role)
    return { ...artifact, checks }
  } finally {
    if (descriptor !== undefined) fsCloseSync(descriptor)
  }
}

function writePreparedRecord(path, canonicalBytes) {
  let descriptor
  try {
    descriptor = openExclusiveFile(path)
    injectFault('after-record-create')
    const reservedIdentity = inspectOpenRegularFile(
      descriptor,
      path,
      'reserved record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    writeAll(descriptor, canonicalBytes)
    writeAll(descriptor, bufferFrom('\n'))
    injectFault('after-record-write')
    revalidateOpenRegularFile(
      descriptor,
      path,
      reservedIdentity,
      'record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    flushAndSealFile(
      descriptor,
      path,
      reservedIdentity,
      'prepared record',
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    injectFault('after-record-fsync')
  } finally {
    if (descriptor !== undefined) fsCloseSync(descriptor)
  }
}

function validateCompleteOperation(
  paths,
  binding,
  retainEvidence = false,
  bindingKind = 'prepared',
  brokerSession
) {
  requireLinuxDurability()
  let retainedEvidence =
    bindingKind === 'committed'
      ? createInternalRecord({ directories: [], files: [] })
      : { directories: [], files: [], expectedLayouts: [] }
  try {
    const artifactsDirectoryCode =
      bindingKind === 'committed' ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION'
    let retainedDirectory = openRetainedDirectoryEvidence(
      paths.operationRoot,
      'operation root',
      true,
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)
    retainedDirectory = openRetainedDirectoryEvidence(
      paths.recoveryRoot,
      'recovery root',
      bindingKind !== 'committed',
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)
    retainedDirectory = openRetainedDirectoryEvidence(
      paths.operations,
      'operations root',
      true,
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)
    retainedDirectory = openRetainedDirectoryEvidence(
      paths.operation,
      'operation directory',
      false,
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)
    retainedDirectory = openRetainedDirectoryEvidence(
      paths.artifacts,
      'artifacts directory',
      false,
      artifactsDirectoryCode,
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)
    retainedDirectory = openRetainedDirectoryEvidence(
      paths.records,
      'records directory',
      false,
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    appendArrayValue(retainedEvidence.directories, retainedDirectory)

    const committedLayout =
      bindingKind === 'committed'
        ? runCommittedDirectoryBrokerScan(brokerSession, paths)
        : undefined
    if (bindingKind === 'committed') {
      assertCommittedScannedDirectoryEntries(
        committedLayout.entries[0],
        [OPERATIONS_DIRECTORY],
        false,
        'recovery'
      )
      assertCommittedScannedDirectoryEntries(
        committedLayout.entries[1],
        OPERATION_RECORD_ENTRIES,
        false,
        'operation'
      )
    } else {
      assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY])
      assertExactDirectoryEntries(paths.operation, OPERATION_RECORD_ENTRIES)
    }
    const recordEntries =
      bindingKind === 'committed'
        ? committedLayout.entries[2]
        : safeDirectoryEntries(paths.records, 'records directory')
    const recordMatch =
      recordEntries.length === 1 ? regexpExec(RECORD_NAME, recordEntries[0]) : null
    if (recordMatch === null) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        bindingKind === 'committed'
          ? 'records-layout'
          : 'Records directory must contain exactly one prepared record'
      )
    }
    const recordName = recordEntries[0]
    const commitmentFromName = recordMatch[1]
    const recordPath =
      bindingKind === 'committed'
        ? `${paths.records}/${recordName}`
        : pathJoin(paths.records, recordName)
    const recordEvidence = openRetainedFileEvidence(
      recordPath,
      'prepared record',
      'RECOVERY_JOURNAL_CORRUPTION',
      MAX_RECORD_BYTES,
      true,
      undefined,
      undefined,
      bindingKind
    )
    appendArrayValue(retainedEvidence.files, recordEvidence)
    const recordBytes = readRetainedFileEvidence(
      recordEvidence,
      MAX_RECORD_BYTES,
      'RECOVERY_JOURNAL_CORRUPTION',
      bindingKind
    )
    if (recordBytes.length < 2 || recordBytes[recordBytes.length - 1] !== 0x0a) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Prepared record must end in exactly one LF'
      )
    }
    const canonicalBytes = bufferSubarray(recordBytes, 0, -1)
    if (
      canonicalBytes[canonicalBytes.length - 1] === 0x0a ||
      bufferIncludes(canonicalBytes, 0x0d)
    ) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Prepared record has a noncanonical terminator'
      )
    }
    const commitmentSha256 =
      bindingKind === 'committed'
        ? hardenedRecoveryRecordHash(canonicalBytes)
        : recoveryRecordHash(canonicalBytes)
    if (commitmentSha256 !== commitmentFromName) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Prepared record filename hash does not match'
      )
    }
    if (
      bindingKind === 'committed' &&
      commitmentSha256 !== binding.intent.recoveryCommitment['shikin.recovery.recordSha256']
    ) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Prepared record does not match the committed recovery hash'
      )
    }
    let record
    try {
      record = jsonParse(bufferToString(canonicalBytes, 'utf8'))
    } catch (error) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record is malformed JSON', error)
    }
    if (bindingKind === 'committed') validateCommittedRecord(record, binding, paths)
    else validatePreparedRecord(record, binding, paths)
    let recanonicalized
    try {
      recanonicalized =
        bindingKind === 'committed'
          ? hardenedCanonicalRecoveryJournalBytes(record)
          : canonicalRecoveryJournalBytes(record)
    } catch (error) {
      throw journalError(
        'RECOVERY_JOURNAL_CORRUPTION',
        'Prepared record is not canonical JSON',
        error
      )
    }
    if (!bufferEquals(canonicalBytes, recanonicalized)) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record bytes are noncanonical')
    }

    const expectedArtifactNames =
      bindingKind === 'committed'
        ? [
            hardenedArtifactFilename(paths.operationKey, record.nonce, 'candidate'),
            hardenedArtifactFilename(paths.operationKey, record.nonce, 'rollback'),
          ]
        : [pathBasename(record.candidate.path), pathBasename(record.rollback.path)]
    if (bindingKind === 'committed') {
      assertCommittedScannedDirectoryEntries(
        committedLayout.entries[3],
        expectedArtifactNames,
        true,
        'artifacts'
      )
    } else {
      assertExactDirectoryEntries(paths.artifacts, expectedArtifactNames, true)
      assertNoSqliteSidecars(paths.artifacts)
    }
    for (let roleIndex = 0; roleIndex < ROLES.length; roleIndex += 1) {
      const role = ROLES[roleIndex]
      const artifactPath =
        bindingKind === 'committed'
          ? `${paths.artifacts}/${expectedArtifactNames[roleIndex]}`
          : pathJoin(paths.artifacts, expectedArtifactNames[roleIndex])
      const retainedFile = openRetainedFileEvidence(
        artifactPath,
        `${role} artifact`,
        'RECOVERY_ARTIFACT_CORRUPTION',
        MAX_ARTIFACT_BYTES,
        false,
        role,
        record[role].sizeBytes,
        bindingKind
      )
      appendArrayValue(retainedEvidence.files, retainedFile)
    }
    const retainedEvidenceExpectations =
      bindingKind === 'committed'
        ? createCommittedRetainedEvidenceExpectations(paths, recordPath, expectedArtifactNames, [
            record.candidate.sizeBytes,
            record.rollback.sizeBytes,
          ])
        : undefined
    if (bindingKind === 'committed') {
      assertCommittedRetainedEvidenceInvariants(retainedEvidence, retainedEvidenceExpectations)
    }
    const openedArtifacts = [retainedEvidence.files[1], retainedEvidence.files[2]]
    for (let index = 0; index < openedArtifacts.length; index += 1) {
      const opened = openedArtifacts[index]
      const artifact = hashOpenArtifact(
        opened.descriptor,
        opened.path,
        opened.identity,
        opened.role,
        opened.expectedSizeBytes,
        bindingKind
      )
      if (
        artifact.contentDigest !== record[opened.role].contentDigest ||
        artifact.sizeBytes !== record[opened.role].sizeBytes
      ) {
        throw journalError(
          'RECOVERY_ARTIFACT_CORRUPTION',
          `${opened.role} artifact digest or size does not match`
        )
      }
      if (index === 0) runInterArtifactHashTestHook(openedArtifacts)
    }
    if (bindingKind !== 'committed') {
      retainedEvidence.expectedLayouts = [
        objectFreeze({
          path: paths.recoveryRoot,
          expected: [OPERATIONS_DIRECTORY],
          artifact: false,
        }),
        objectFreeze({
          path: paths.operation,
          expected: OPERATION_RECORD_ENTRIES,
          artifact: false,
        }),
        objectFreeze({ path: paths.records, expected: [recordName], artifact: false }),
        objectFreeze({ path: paths.artifacts, expected: expectedArtifactNames, artifact: true }),
      ]
    }
    revalidateRetainedEvidence(retainedEvidence, bindingKind)
    if (bindingKind === 'committed') {
      const result = freezeInternalRecord({
        commitmentSha256,
        record,
        durability: 'linux-fsync-complete',
        retainedEvidence: retainEvidence ? retainedEvidence : undefined,
        retainedEvidenceExpectations: retainEvidence ? retainedEvidenceExpectations : undefined,
      })
      if (retainEvidence) retainedEvidence = null
      return result
    }
    const result = {
      commitmentSha256,
      record,
      durability: 'linux-fsync-complete',
    }
    if (retainEvidence) {
      result.retainedEvidence = retainedEvidence
      retainedEvidence = null
    }
    return result
  } finally {
    closeRetainedEvidence(retainedEvidence)
  }
}

function createCommittedRetainedEvidenceExpectations(
  paths,
  recordPath,
  artifactNames,
  artifactSizes
) {
  const directories = [
    freezeInternalRecord({
      path: paths.operationRoot,
      label: 'operation root',
      mutable: true,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
    }),
    freezeInternalRecord({
      path: paths.recoveryRoot,
      label: 'recovery root',
      mutable: false,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
    }),
    freezeInternalRecord({
      path: paths.operations,
      label: 'operations root',
      mutable: true,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
    }),
    freezeInternalRecord({
      path: paths.operation,
      label: 'operation directory',
      mutable: false,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
    }),
    freezeInternalRecord({
      path: paths.artifacts,
      label: 'artifacts directory',
      mutable: false,
      code: 'RECOVERY_ARTIFACT_CORRUPTION',
    }),
    freezeInternalRecord({
      path: paths.records,
      label: 'records directory',
      mutable: false,
      code: 'RECOVERY_JOURNAL_CORRUPTION',
    }),
  ]
  const files = [
    freezeInternalRecord({
      path: recordPath,
      label: 'prepared record',
      code: 'RECOVERY_JOURNAL_CORRUPTION',
      role: undefined,
      expectedSizeBytes: undefined,
    }),
    freezeInternalRecord({
      path: `${paths.artifacts}/${artifactNames[0]}`,
      label: 'candidate artifact',
      code: 'RECOVERY_ARTIFACT_CORRUPTION',
      role: 'candidate',
      expectedSizeBytes: artifactSizes[0],
    }),
    freezeInternalRecord({
      path: `${paths.artifacts}/${artifactNames[1]}`,
      label: 'rollback artifact',
      code: 'RECOVERY_ARTIFACT_CORRUPTION',
      role: 'rollback',
      expectedSizeBytes: artifactSizes[1],
    }),
  ]
  return freezeInternalRecord({
    directories: objectFreeze(directories),
    files: objectFreeze(files),
  })
}

function assertCommittedRetainedEvidenceInvariants(evidence, expectations) {
  if (
    evidence === null ||
    typeof evidence !== 'object' ||
    expectations === null ||
    typeof expectations !== 'object' ||
    !arrayIsArray(evidence.directories) ||
    !arrayIsArray(evidence.files) ||
    !arrayIsArray(expectations.directories) ||
    !arrayIsArray(expectations.files) ||
    evidence.directories.length !== 6 ||
    evidence.files.length !== 3 ||
    expectations.directories.length !== 6 ||
    expectations.files.length !== 3
  ) {
    throw journalError(
      'RECOVERY_EVIDENCE_TOKEN_INVALID',
      'Committed recovery evidence token does not retain exactly nine handles'
    )
  }
  for (let index = 0; index < expectations.directories.length; index += 1) {
    const retained = evidence.directories[index]
    const expected = expectations.directories[index]
    if (
      retained === null ||
      typeof retained !== 'object' ||
      retained.kind !== 'directory' ||
      retained.path !== expected.path ||
      retained.label !== expected.label ||
      retained.mutable !== expected.mutable ||
      retained.code !== expected.code ||
      retained.identity === null ||
      typeof retained.identity !== 'object' ||
      retained.snapshot === null ||
      typeof retained.snapshot !== 'object' ||
      typeof retained.identity.dev !== 'bigint' ||
      typeof retained.identity.ino !== 'bigint' ||
      retained.identity.dev !== retained.snapshot.dev ||
      retained.identity.ino !== retained.snapshot.ino ||
      !numberIsSafeInteger(retained.descriptor) ||
      retained.descriptor < 0
    ) {
      throw journalError(
        'RECOVERY_EVIDENCE_TOKEN_INVALID',
        'Committed recovery directory evidence is incomplete or misbound'
      )
    }
  }
  for (let index = 0; index < expectations.files.length; index += 1) {
    const retained = evidence.files[index]
    const expected = expectations.files[index]
    if (
      retained === null ||
      typeof retained !== 'object' ||
      retained.kind !== 'file' ||
      retained.path !== expected.path ||
      retained.label !== expected.label ||
      retained.code !== expected.code ||
      retained.role !== expected.role ||
      retained.expectedSizeBytes !== expected.expectedSizeBytes ||
      retained.identity === null ||
      typeof retained.identity !== 'object' ||
      retained.snapshot === null ||
      typeof retained.snapshot !== 'object' ||
      typeof retained.identity.dev !== 'bigint' ||
      typeof retained.identity.ino !== 'bigint' ||
      retained.identity.dev !== retained.snapshot.dev ||
      retained.identity.ino !== retained.snapshot.ino ||
      !numberIsSafeInteger(retained.descriptor) ||
      retained.descriptor < 0 ||
      (expected.role === undefined && retained.expectedSizeBytes !== undefined) ||
      (expected.role !== undefined &&
        (!isNonnegativeSafeInteger(expected.expectedSizeBytes) ||
          retained.snapshot.size !== BigIntConstructor(expected.expectedSizeBytes)))
    ) {
      throw journalError(
        'RECOVERY_EVIDENCE_TOKEN_INVALID',
        'Committed recovery file evidence is incomplete or misbound'
      )
    }
  }
  for (let left = 0; left < 9; left += 1) {
    const leftDescriptor =
      left < 6 ? evidence.directories[left].descriptor : evidence.files[left - 6].descriptor
    for (let right = left + 1; right < 9; right += 1) {
      const rightDescriptor =
        right < 6 ? evidence.directories[right].descriptor : evidence.files[right - 6].descriptor
      if (leftDescriptor === rightDescriptor) {
        throw journalError(
          'RECOVERY_EVIDENCE_TOKEN_INVALID',
          'Committed recovery evidence token contains duplicate handles'
        )
      }
    }
  }
}

function hardenedRecoveryOperationKey(databaseIdentity, operationId) {
  return hardenedDigestParts([
    OPERATION_KEY_DOMAIN,
    bufferFrom(databaseIdentity, 'utf8'),
    ZERO_BYTE,
    bufferFrom(operationId, 'utf8'),
  ])
}

function hardenedArtifactFilename(operationKey, nonce, role) {
  return `${role}-${hardenedRecoveryArtifactKey(operationKey, nonce, role)}.sqlite`
}

function hardenedRecoveryArtifactKey(operationKey, nonce, role) {
  return hardenedDigestParts([
    ARTIFACT_KEY_DOMAIN,
    bufferFrom(operationKey, 'ascii'),
    ZERO_BYTE,
    bufferFrom(nonce, 'ascii'),
    ZERO_BYTE,
    bufferFrom(role, 'ascii'),
  ])
}

function hardenedCreateRecoveryArtifactHasher(role) {
  const hasher = createHashBuiltin('sha256')
  hashUpdate(hasher, ARTIFACT_CONTENT_DOMAIN)
  hashUpdate(hasher, bufferFrom(role, 'ascii'))
  hashUpdate(hasher, ZERO_BYTE)
  return hasher
}

function hardenedRecoveryRecordHash(canonicalRecordBytes) {
  const hasher = createHashBuiltin('sha256')
  hashUpdate(hasher, RECORD_DOMAIN)
  hashUpdate(hasher, canonicalRecordBytes)
  return hashDigest(hasher, 'hex')
}

function hardenedDigestParts(parts) {
  const hasher = createHashBuiltin('sha256')
  for (let index = 0; index < parts.length; index += 1) {
    hashUpdate(hasher, parts[index])
  }
  return hashDigest(hasher, 'hex')
}

function hardenedCanonicalRecoveryJournalBytes(value) {
  return bufferFrom(hardenedCanonicalValue(value), 'utf8')
}

function hardenedCanonicalValue(value) {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'string') return hardenedCanonicalString(value)
  if (typeof value === 'number') {
    if (!numberIsSafeInteger(value) || value < 0 || objectIs(value, -0)) {
      throw new TypeErrorConstructor('canonical integers must be non-negative safe integers')
    }
    return StringConstructor(value)
  }
  if (typeof value !== 'object') throw new TypeErrorConstructor('unsupported canonical value')

  if (arrayIsArray(value)) {
    const keys = objectKeys(value)
    if (keys.length !== value.length || objectGetOwnPropertySymbols(value).length !== 0) {
      throw new TypeErrorConstructor('canonical arrays must be dense and index-only')
    }
    let output = '['
    for (let index = 0; index < value.length; index += 1) {
      if (keys[index] !== StringConstructor(index)) {
        throw new TypeErrorConstructor('canonical arrays must be dense and index-only')
      }
      if (index !== 0) output += ','
      output += hardenedCanonicalValue(value[index])
    }
    return `${output}]`
  }

  const prototype = objectGetPrototypeOf(value)
  if (prototype !== objectPrototype && prototype !== null) {
    throw new TypeErrorConstructor('canonical objects must be plain objects')
  }
  if (objectGetOwnPropertySymbols(value).length !== 0) {
    throw new TypeErrorConstructor('canonical object keys must be strings')
  }
  const keys = objectKeys(value)
  sortCanonicalKeys(keys)
  let output = '{'
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]
    if (index !== 0) output += ','
    output += `${hardenedCanonicalString(key)}:${hardenedCanonicalValue(value[key])}`
  }
  return `${output}}`
}

function hardenedCanonicalString(value) {
  let output = '"'
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = stringCharCodeAt(value, index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const low = stringCharCodeAt(value, index + 1)
      if (!numberIsSafeInteger(low) || low < 0xdc00 || low > 0xdfff) {
        throw new TypeErrorConstructor('lone Unicode surrogate')
      }
      output += value[index] + value[index + 1]
      index += 1
      continue
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new TypeErrorConstructor('lone Unicode surrogate')
    }
    if (codeUnit === 0x08) output += '\\b'
    else if (codeUnit === 0x09) output += '\\t'
    else if (codeUnit === 0x0a) output += '\\n'
    else if (codeUnit === 0x0c) output += '\\f'
    else if (codeUnit === 0x0d) output += '\\r'
    else if (codeUnit === 0x22) output += '\\"'
    else if (codeUnit === 0x5c) output += '\\\\'
    else if (codeUnit <= 0x1f) {
      const high = (codeUnit >> 4) & 0x0f
      const low = codeUnit & 0x0f
      output += `\\u00${'0123456789abcdef'[high]}${'0123456789abcdef'[low]}`
    } else output += value[index]
  }
  return `${output}"`
}

function sortCanonicalKeys(keys) {
  for (let index = 1; index < keys.length; index += 1) {
    const value = keys[index]
    let insertion = index
    while (insertion > 0 && compareCanonicalKeys(keys[insertion - 1], value) > 0) {
      keys[insertion] = keys[insertion - 1]
      insertion -= 1
    }
    keys[insertion] = value
  }
}

function compareCanonicalKeys(left, right) {
  hardenedCanonicalString(left)
  hardenedCanonicalString(right)
  return bufferCompare(bufferFrom(left, 'utf8'), bufferFrom(right, 'utf8'))
}

function copyAndSortStrings(values) {
  const copy = []
  for (let index = 0; index < values.length; index += 1) {
    appendArrayValue(copy, values[index])
  }
  return sortStrings(copy)
}

function sortStrings(values) {
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index]
    let insertion = index
    while (insertion > 0 && values[insertion - 1] > value) {
      values[insertion] = values[insertion - 1]
      insertion -= 1
    }
    values[insertion] = value
  }
  return values
}

function validatePreparedRecord(record, binding, paths) {
  assertExactKeys(
    record,
    [
      'protocol',
      'protocolVersion',
      'recordKind',
      'sequence',
      'previousRecordSha256',
      'databaseIdentity',
      'operationId',
      'operation',
      'owner',
      'fencingGeneration',
      'createdAt',
      'nonce',
      'candidate',
      'rollback',
      'schemaContract',
      'checks',
    ],
    'prepared record',
    'RECOVERY_JOURNAL_CORRUPTION'
  )
  if (
    record.protocol !== PROTOCOL ||
    record.protocolVersion !== PROTOCOL_VERSION ||
    record.recordKind !== 'prepared_mutation' ||
    record.sequence !== 0 ||
    record.previousRecordSha256 !== null ||
    record.databaseIdentity !== DATABASE_IDENTITY ||
    record.operationId !== binding.intent.operationId ||
    record.operation !== binding.intent.operation ||
    record.fencingGeneration !== binding.intent.fencingGeneration ||
    record.createdAt !== binding.intent.createdAt ||
    regexpExec(LOWER_HEX_64, record.nonce) === null ||
    !sameOwner(record.owner, binding.intent.owner)
  ) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record binding is malformed')
  }
  validateSchemaIdentity(record.schemaContract, 'RECOVERY_JOURNAL_CORRUPTION')
  assertExactKeys(record.checks, ROLES, 'artifact check pair', 'RECOVERY_JOURNAL_CORRUPTION')
  for (let roleIndex = 0; roleIndex < ROLES.length; roleIndex += 1) {
    const role = ROLES[roleIndex]
    validatePreparedArtifactChecks(
      record.checks[role],
      `${role} recorded checks`,
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    assertExactKeys(
      record[role],
      ['path', 'contentDigest', 'sizeBytes'],
      `${role} artifact record`,
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    const artifactKey = recoveryArtifactKey(paths.operationKey, record.nonce, role)
    const expectedPath = `artifacts/${role}-${artifactKey}.sqlite`
    if (
      record[role].path !== expectedPath ||
      typeof record[role].contentDigest !== 'string' ||
      regexpExec(/^sha256:[0-9a-f]{64}$/, record[role].contentDigest) === null ||
      !isNonnegativeSafeInteger(record[role].sizeBytes) ||
      record[role].sizeBytes > MAX_ARTIFACT_BYTES
    ) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${role} artifact record is malformed`)
    }
  }
}

function validateCommittedRecord(record, binding, paths) {
  assertExactKeys(
    record,
    [
      'protocol',
      'protocolVersion',
      'recordKind',
      'sequence',
      'previousRecordSha256',
      'databaseIdentity',
      'operationId',
      'operation',
      'owner',
      'fencingGeneration',
      'createdAt',
      'nonce',
      'candidate',
      'rollback',
      'schemaContract',
      'checks',
    ],
    'prepared record',
    'RECOVERY_JOURNAL_CORRUPTION'
  )
  if (
    record.protocol !== PROTOCOL ||
    record.protocolVersion !== PROTOCOL_VERSION ||
    record.recordKind !== 'prepared_mutation' ||
    record.sequence !== 0 ||
    record.previousRecordSha256 !== null ||
    regexpExec(LOWER_HEX_64, record.nonce) === null
  ) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Prepared record binding is malformed')
  }
  validateOwner(record.owner, 'RECOVERY_JOURNAL_CORRUPTION')
  const claimSequence = binding.intent.recoveryCommitment['shikin.recovery.claimSequence']
  const expectedGeneration = record.fencingGeneration + claimSequence
  if (
    record.databaseIdentity !== DATABASE_IDENTITY ||
    record.operationId !== binding.intent.operationId ||
    record.operation !== binding.intent.operation ||
    record.createdAt !== binding.intent.createdAt ||
    !isPositiveSafeInteger(record.fencingGeneration) ||
    !isPositiveSafeInteger(expectedGeneration) ||
    expectedGeneration !== binding.intent.fencingGeneration ||
    (claimSequence === 0 && !sameOwner(record.owner, binding.intent.owner))
  ) {
    throw journalError(
      'RECOVERY_LINEAGE_INVALID',
      'Committed recovery evidence lineage does not match the immutable record'
    )
  }
  validateSchemaIdentity(record.schemaContract, 'RECOVERY_VALIDATION_FAILED')
  assertExactKeys(record.checks, ROLES, 'artifact check pair', 'RECOVERY_VALIDATION_FAILED')
  for (let roleIndex = 0; roleIndex < ROLES.length; roleIndex += 1) {
    const role = ROLES[roleIndex]
    validateArtifactChecks(
      record.checks[role],
      `${role} recorded checks`,
      'RECOVERY_VALIDATION_FAILED'
    )
    assertExactKeys(
      record[role],
      ['path', 'contentDigest', 'sizeBytes'],
      `${role} artifact record`,
      'RECOVERY_JOURNAL_CORRUPTION'
    )
    const artifactKey = hardenedRecoveryArtifactKey(paths.operationKey, record.nonce, role)
    const expectedPath = `artifacts/${role}-${artifactKey}.sqlite`
    if (
      record[role].path !== expectedPath ||
      typeof record[role].contentDigest !== 'string' ||
      regexpExec(/^sha256:[0-9a-f]{64}$/, record[role].contentDigest) === null ||
      !isNonnegativeSafeInteger(record[role].sizeBytes) ||
      record[role].sizeBytes > MAX_ARTIFACT_BYTES
    ) {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', `${role} artifact record is malformed`)
    }
  }
}

class CommittedBoundaryError extends ErrorConstructor {
  constructor(code, message, cause) {
    super(message)
    objectDefineProperties(this, {
      name: {
        configurable: true,
        enumerable: true,
        value: 'CommittedBoundaryError',
        writable: true,
      },
      code: { configurable: true, enumerable: true, value: code, writable: true },
      cause: { configurable: true, enumerable: true, value: cause, writable: true },
    })
    weakSetAdd(internalCommittedBoundaryErrors, this)
  }
}

function snapshotCommittedRecoveryOptionsBoundary(options) {
  try {
    return snapshotCommittedRecoveryOptions(options)
  } catch (error) {
    if (weakSetHas(internalCommittedBoundaryErrors, error)) {
      throw journalError(error.code, error.message, error.cause)
    }
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'Committed recovery options could not be safely snapshotted',
      error
    )
  }
}

function validateCommittedRecoverySnapshot(binding) {
  try {
    validateCommittedCoreSnapshot(binding, binding.intent)
  } catch (error) {
    if (weakSetHas(internalCommittedBoundaryErrors, error)) {
      throw journalError(error.code, error.message, error.cause)
    }
    throw error
  }
  if (
    !hasOwnProperty(binding.intent, 'recoveryCommitment') ||
    binding.intent.recoveryCommitment === null ||
    typeof binding.intent.recoveryCommitment !== 'object'
  ) {
    throw journalError(
      'RECOVERY_COMMITMENT_REQUIRED',
      'The exact committed recovery metadata is required'
    )
  }
  validateCommittedCoreBinding(binding)
  validateRecoveryCommitment(binding.intent.recoveryCommitment)
  validateCommittedBindingLimits(binding)

  const claimSequence = binding.intent.recoveryCommitment['shikin.recovery.claimSequence']
  if (
    (binding.intent.phase !== 'mutating' && binding.intent.phase !== 'abandoned') ||
    !isPositiveSafeInteger(binding.intent.fencingGeneration) ||
    binding.intent.fencingGeneration <= claimSequence
  ) {
    throw journalError(
      'RECOVERY_LINEAGE_INVALID',
      'Committed recovery phase or generation lineage is invalid'
    )
  }
}

function snapshotCommittedRecoveryOptions(options) {
  const optionKeys = committedOwnKeys(options, COMMITTED_OPTIONS_KEYS, 'options')
  const intentValue = committedRead(options, 'intent')
  const intentKeys = committedOwnKeys(
    intentValue,
    COMMITTED_INTENT_KEYS,
    'intent',
    'recoveryCommitment'
  )
  const ownerValue = committedRead(intentValue, 'owner')
  committedOwnKeys(ownerValue, COMMITTED_OWNER_KEYS, 'owner')

  const owner = objectCreate(null)
  for (let index = 0; index < COMMITTED_OWNER_KEYS.length; index += 1) {
    const key = COMMITTED_OWNER_KEYS[index]
    owner[key] = committedRead(ownerValue, key)
  }
  objectFreeze(owner)

  const intent = objectCreate(null)
  for (let index = 0; index < COMMITTED_INTENT_KEYS.length; index += 1) {
    const key = COMMITTED_INTENT_KEYS[index]
    if (key === 'owner' || key === 'recoveryCommitment') continue
    intent[key] = committedRead(intentValue, key)
  }
  intent.owner = owner

  const binding = objectCreate(null)
  binding.operationRoot = committedRead(options, 'operationRoot')
  binding.stateRevision = committedRead(options, 'stateRevision')

  if (!optionKeys || !hasCommittedKey(intentKeys, 'recoveryCommitment')) {
    objectFreeze(intent)
    binding.intent = intent
    return objectFreeze(binding)
  }
  const commitmentValue = committedRead(intentValue, 'recoveryCommitment')
  if (commitmentValue === null || typeof commitmentValue !== 'object') {
    intent.recoveryCommitment = commitmentValue
    objectFreeze(intent)
    binding.intent = intent
    return objectFreeze(binding)
  }
  let commitmentIsArray
  try {
    commitmentIsArray = arrayIsArray(commitmentValue)
  } catch (error) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      'Could not inspect committed recovery object kind',
      error
    )
  }
  if (commitmentIsArray) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      'Committed recovery metadata must not be an array'
    )
  }
  committedOwnKeys(
    commitmentValue,
    RECOVERY_COMMITMENT_KEYS,
    'recovery commitment',
    undefined,
    'RECOVERY_COMMITMENT_INVALID'
  )
  const commitment = objectCreate(null)
  for (let index = 0; index < RECOVERY_COMMITMENT_KEYS.length; index += 1) {
    const key = RECOVERY_COMMITMENT_KEYS[index]
    commitment[key] = committedRead(commitmentValue, key)
  }
  objectFreeze(commitment)
  intent.recoveryCommitment = commitment
  objectFreeze(intent)
  binding.intent = intent
  return objectFreeze(binding)
}

function committedOwnKeys(
  value,
  expected,
  label,
  optionalKey,
  shapeCode = 'INVALID_RECOVERY_OPTIONS'
) {
  if (!isCommittedContainer(value)) {
    throw new CommittedBoundaryError(shapeCode, `${label} must be a fixed-shape object`)
  }
  let actual
  try {
    actual = reflectOwnKeys(value)
  } catch (error) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      `Could not inspect ${label}`,
      error
    )
  }
  const minimum = optionalKey === undefined ? expected.length : expected.length - 1
  let malformed = actual.length < minimum || actual.length > expected.length
  for (let index = 0; !malformed && index < actual.length; index += 1) {
    const key = actual[index]
    malformed = typeof key !== 'string' || !hasCommittedKey(expected, key)
  }
  for (let index = 0; !malformed && index < expected.length; index += 1) {
    const key = expected[index]
    malformed = key !== optionalKey && !hasCommittedKey(actual, key)
  }
  if (malformed) {
    throw new CommittedBoundaryError(shapeCode, `${label} has unknown or missing fields`)
  }
  return actual
}

function committedRead(value, key) {
  try {
    return reflectGet(value, key)
  } catch (error) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      `Could not read committed recovery field ${key}`,
      error
    )
  }
}

function isCommittedContainer(value) {
  if (value === null || typeof value !== 'object') return false
  try {
    return !arrayIsArray(value)
  } catch (error) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      'Could not inspect committed recovery object kind',
      error
    )
  }
}

function hasCommittedKey(keys, expected) {
  for (let index = 0; index < keys.length; index += 1) {
    if (keys[index] === expected) return true
  }
  return false
}

function validateCommittedCoreSnapshot(binding, intent) {
  const { operationRoot, stateRevision } = binding
  if (
    typeof operationRoot !== 'string' ||
    operationRoot.length === 0 ||
    typeof stateRevision !== 'number' ||
    typeof intent.recordKind !== 'string' ||
    typeof intent.operationId !== 'string' ||
    typeof intent.operation !== 'string' ||
    typeof intent.phase !== 'string' ||
    typeof intent.fencingGeneration !== 'number' ||
    typeof intent.createdAt !== 'string' ||
    typeof intent.updatedAt !== 'string'
  ) {
    throw new CommittedBoundaryError(
      'INVALID_RECOVERY_OPTIONS',
      'Committed recovery options contain a non-scalar or malformed field'
    )
  }
  for (let index = 0; index < COMMITTED_OWNER_KEYS.length; index += 1) {
    const key = COMMITTED_OWNER_KEYS[index]
    const expectedNumber = key === 'processId'
    if (
      (expectedNumber && typeof intent.owner[key] !== 'number') ||
      (!expectedNumber && typeof intent.owner[key] !== 'string')
    ) {
      throw new CommittedBoundaryError(
        'INVALID_RECOVERY_OPTIONS',
        'Committed recovery options contain a non-scalar or malformed field'
      )
    }
  }
}

function validateCommittedCoreBinding(binding) {
  const { operationRoot, stateRevision, intent } = binding
  let resolvedRoot
  try {
    resolvedRoot = pathResolve(operationRoot)
  } catch (error) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot is malformed', error)
  }
  if (
    comparablePath(operationRoot) !== comparablePath(resolvedRoot) ||
    pathBasename(operationRoot) !== DATABASE_IDENTITY_HASH ||
    !isNonnegativeSafeInteger(stateRevision) ||
    intent.recordKind !== 'exclusive_intent' ||
    !isCommittedIdentifier(intent.operationId) ||
    (intent.operation !== 'restore' && intent.operation !== 'import') ||
    !isCommittedIsoTime(intent.createdAt) ||
    !isCommittedIsoTime(intent.updatedAt) ||
    !isCommittedIdentifier(intent.owner.ownerId) ||
    !hasCommittedKey(RUNTIME_IDS, intent.owner.runtimeId) ||
    !isCommittedIdentifier(intent.owner.hostId) ||
    !numberIsSafeInteger(intent.owner.processId) ||
    intent.owner.processId < 1 ||
    intent.owner.processId > 0xffff_ffff ||
    !isCommittedIsoTime(intent.owner.processStartedAt)
  ) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Committed recovery binding is malformed')
  }
}

function validateRecoveryCommitment(commitment) {
  if (
    commitment['shikin.recovery.protocol'] !== PROTOCOL ||
    commitment['shikin.recovery.version'] !== PROTOCOL_VERSION ||
    typeof commitment['shikin.recovery.recordSha256'] !== 'string' ||
    regexpExec(LOWER_HEX_64, commitment['shikin.recovery.recordSha256']) === null ||
    commitment['shikin.recovery.durability'] !== 'linux-fsync-complete' ||
    !isNonnegativeSafeInteger(commitment['shikin.recovery.claimSequence'])
  ) {
    throw journalError('RECOVERY_COMMITMENT_INVALID', 'Committed recovery metadata is malformed')
  }
}

function validateCommittedBindingLimits(binding) {
  const { intent } = binding
  if (
    COMMITTED_OPTIONS_KEYS.length +
      COMMITTED_INTENT_KEYS.length +
      COMMITTED_OWNER_KEYS.length +
      RECOVERY_COMMITMENT_KEYS.length >
      MAX_COMMITTED_BINDING_KEYS ||
    MAX_COMMITTED_BINDING_OBJECTS !== 3
  ) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Committed recovery binding shape is too large')
  }
  const strings = [
    binding.operationRoot,
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
  ]
  let total = 0
  for (let index = 0; index < strings.length; index += 1) {
    const value = strings[index]
    if (!isWellFormedCommittedString(value)) {
      throw journalError('INVALID_RECOVERY_OPTIONS', 'Committed recovery strings must be UTF-8')
    }
    total += bufferByteLength(value, 'utf8')
    if (total > MAX_COMMITTED_BINDING_STRING_BYTES) {
      throw journalError(
        'INVALID_RECOVERY_OPTIONS',
        'Committed recovery binding exceeds the scalar string byte limit'
      )
    }
  }
}

function isCommittedIdentifier(value) {
  const length = committedCodePointLength(value)
  return length >= 1 && length <= 128
}

function isWellFormedCommittedString(value) {
  return committedCodePointLength(value) >= 0
}

function committedCodePointLength(value) {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const first = stringCharCodeAt(value, index)
    if (first >= 0xd800 && first <= 0xdbff) {
      if (index + 1 >= value.length) return -1
      const second = stringCharCodeAt(value, index + 1)
      if (second < 0xdc00 || second > 0xdfff) return -1
      index += 1
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return -1
    }
    count += 1
  }
  return count
}

function isCommittedIsoTime(value) {
  if (regexpExec(ISO_TIME, value) === null) return false
  try {
    const timestamp = new DateConstructor(value)
    return !numberIsNaN(dateGetTime(timestamp)) && dateToISOString(timestamp) === value
  } catch {
    return false
  }
}

function validatePrepareOptions(options) {
  assertExactKeys(
    options,
    ['operationRoot', 'stateRevision', 'intent', 'writeArtifact'],
    'prepare options',
    'INVALID_RECOVERY_OPTIONS'
  )
  if (typeof options.writeArtifact !== 'function') {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'writeArtifact must be a function')
  }
  return validateBinding(options)
}

function validateVerificationOptions(options) {
  assertExactKeys(
    options,
    ['operationRoot', 'stateRevision', 'intent'],
    'verification options',
    'INVALID_RECOVERY_OPTIONS'
  )
  return validateBinding(options)
}

function validateBinding(options) {
  if (typeof options.operationRoot !== 'string' || options.operationRoot.length === 0) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must be a non-empty string')
  }
  if (
    comparablePath(options.operationRoot) !== comparablePath(pathResolve(options.operationRoot))
  ) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot must be an absolute canonical path'
    )
  }
  const expectedRootBasename = DATABASE_IDENTITY_HASH
  if (pathBasename(options.operationRoot) !== expectedRootBasename) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot basename must equal the database identity SHA-256'
    )
  }
  if (!isNonnegativeSafeInteger(options.stateRevision)) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'stateRevision must be a non-negative safe integer'
    )
  }
  const intent = options.intent
  assertExactKeys(
    intent,
    [
      'recordKind',
      'operationId',
      'operation',
      'phase',
      'owner',
      'fencingGeneration',
      'createdAt',
      'updatedAt',
    ],
    'exclusive intent',
    'INVALID_RECOVERY_OPTIONS',
    ['metadata']
  )
  if (
    intent.recordKind !== 'exclusive_intent' ||
    !isIdentifier(intent.operationId) ||
    !['restore', 'import'].includes(intent.operation) ||
    intent.phase !== 'exclusive' ||
    !isPositiveSafeInteger(intent.fencingGeneration) ||
    !isIsoTime(intent.createdAt) ||
    !isIsoTime(intent.updatedAt) ||
    (intent.metadata !== undefined && !isCanonicalPlainObject(intent.metadata))
  ) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'Intent must be an exclusive restore or import intent'
    )
  }
  validateOwner(intent.owner, 'INVALID_RECOVERY_OPTIONS')
  return objectFreeze({
    operationRoot: pathResolve(options.operationRoot),
    stateRevision: options.stateRevision,
    intent: cloneIntent(intent),
  })
}

function validateOwner(owner, code) {
  assertExactKeys(
    owner,
    ['ownerId', 'runtimeId', 'hostId', 'processId', 'processStartedAt'],
    'owner evidence',
    code
  )
  if (
    !isIdentifier(owner.ownerId) ||
    !hasCommittedKey(RUNTIME_IDS, owner.runtimeId) ||
    !isIdentifier(owner.hostId) ||
    !numberIsSafeInteger(owner.processId) ||
    owner.processId < 1 ||
    owner.processId > 0xffff_ffff ||
    !isIsoTime(owner.processStartedAt)
  ) {
    throw journalError(code, 'Owner evidence is malformed')
  }
}

function validateArtifactCallbackChecks(value, label) {
  rejectThenableArtifactChecks(value, label, 'RECOVERY_VALIDATION_FAILED')
  return validateArtifactChecks(value, label)
}

function validatePreparedArtifactChecks(value, label, code) {
  rejectThenableArtifactChecks(value, label, code)
  return validateArtifactChecks(value, label, code)
}

function rejectThenableArtifactChecks(value, label, code) {
  // Prepared callback and prepared-record behavior intentionally retain the baseline thenable read.
  if (value && typeof value.then === 'function') {
    throw journalError(code, `${label} must return synchronously`)
  }
}

function validateArtifactChecks(value, label, code = 'RECOVERY_VALIDATION_FAILED') {
  assertExactKeys(value, CHECK_KEYS, label, code)
  let malformed = false
  for (let index = 0; !malformed && index < CHECK_KEYS.length; index += 1) {
    malformed = reflectGet(value, CHECK_KEYS[index]) !== 'ok'
  }
  if (malformed) {
    throw journalError(code, `${label} did not return the exact four ok checks`)
  }
  return objectFreeze({
    integrityCheck: 'ok',
    foreignKeyCheck: 'ok',
    schemaContractCheck: 'ok',
    sidecarCheck: 'ok',
  })
}

function validateSchemaIdentity(value, code) {
  assertExactKeys(
    value,
    ['rawBytesSha256', 'contractVersion', 'latestMigration'],
    'schema contract identity',
    code
  )
  if (
    value.rawBytesSha256 !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.rawBytesSha256 ||
    value.contractVersion !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.contractVersion ||
    value.latestMigration !== SHIKIN_SCHEMA_CONTRACT_IDENTITY.latestMigration
  ) {
    throw journalError(code, 'Schema contract identity does not match trusted bytes')
  }
}

function validateOperationRoot(operationRoot) {
  const resolved = pathResolve(operationRoot)
  let real
  try {
    real = fsRealpathSync(resolved)
  } catch (error) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot must already exist', error)
  }
  if (comparablePath(real) !== comparablePath(resolved)) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot must be canonical and symlink-free'
    )
  }
  const expectedBasename = DATABASE_IDENTITY_HASH
  if (pathBasename(resolved) !== expectedBasename) {
    throw journalError(
      'INVALID_RECOVERY_OPTIONS',
      'operationRoot basename must equal the database identity SHA-256'
    )
  }
  try {
    return inspectPrivateDirectory(resolved, 'operationRoot', 'INVALID_RECOVERY_OPTIONS')
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError('INVALID_RECOVERY_OPTIONS', 'operationRoot is unsafe', error)
  }
}

function journalPaths(operationRoot, operationId, hardened = false) {
  const operationKey = hardened
    ? hardenedRecoveryOperationKey(DATABASE_IDENTITY, operationId)
    : recoveryOperationKey(DATABASE_IDENTITY, operationId)
  if (hardened) {
    const recoveryRoot = `${operationRoot}/${RECOVERY_DIRECTORY}`
    const operations = `${recoveryRoot}/${OPERATIONS_DIRECTORY}`
    const operation = `${operations}/${operationKey}`
    return freezeInternalRecord({
      operationRoot,
      recoveryRoot,
      operations,
      operationKey,
      operation,
      artifacts: `${operation}/artifacts`,
      records: `${operation}/records`,
    })
  }
  const recoveryRoot = pathJoin(operationRoot, RECOVERY_DIRECTORY)
  const operations = pathJoin(recoveryRoot, OPERATIONS_DIRECTORY)
  const operation = pathJoin(operations, operationKey)
  return objectFreeze({
    operationRoot,
    recoveryRoot,
    operations,
    operationKey,
    operation,
    artifacts: pathJoin(operation, 'artifacts'),
    records: pathJoin(operation, 'records'),
  })
}

function ensureJournalParents(paths, rootIdentity) {
  const recoveryIdentity = ensurePrivateDirectory(paths.recoveryRoot, 'after-recovery-root-create')
  revalidateDirectoryIdentity(rootIdentity)
  assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY], false, true)
  const operationsIdentity = ensurePrivateDirectory(
    paths.operations,
    'after-operations-directory-create'
  )
  assertExactDirectoryEntries(paths.recoveryRoot, [OPERATIONS_DIRECTORY])
  return [recoveryIdentity, operationsIdentity]
}

function ensurePrivateDirectory(path, faultPoint) {
  try {
    fsMkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE })
    if (runtimePlatform !== 'win32') fsChmodSync(path, PRIVATE_DIRECTORY_MODE)
    injectFault(faultPoint)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
  }
  return inspectPrivateDirectory(path, 'journal directory')
}

function createPrivateDirectory(path, faultPoint) {
  try {
    fsMkdirSync(path, { mode: PRIVATE_DIRECTORY_MODE })
    if (runtimePlatform !== 'win32') fsChmodSync(path, PRIVATE_DIRECTORY_MODE)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw journalError('RECOVERY_PREPARATION_INCOMPLETE', 'Operation path already exists')
    }
    throw error
  }
  injectFault(faultPoint)
  return inspectPrivateDirectory(path, 'journal directory')
}

function inspectPrivateDirectory(path, label, code = 'RECOVERY_JOURNAL_CORRUPTION') {
  let stat
  try {
    stat = fsLstatSync(path, { bigint: true })
  } catch (error) {
    throw journalError(code, `Could not inspect ${label}`, error)
  }
  if (!statsIsDirectory(stat) || statsIsSymbolicLink(stat)) {
    throw journalError(code, `${label} is not a non-symlink directory`)
  }
  if (runtimePlatform !== 'win32' && (NumberConstructor(stat.mode) & 0o077) !== 0) {
    throw journalError(code, `${label} is not private`)
  }
  let real
  try {
    real = fsRealpathSync(path)
  } catch (error) {
    throw journalError(code, `Could not canonicalize ${label}`, error)
  }
  if (comparablePath(real) !== comparablePath(pathResolve(path))) {
    throw journalError(code, `${label} is noncanonical or traverses a symlink`)
  }
  if (stat.ino <= 0n) {
    throw journalError(code, `${label} has no stable filesystem identity`)
  }
  return objectFreeze({ path, dev: stat.dev, ino: stat.ino })
}

function revalidateDirectoryIdentity(identity) {
  const current = inspectPrivateDirectory(identity.path, 'journal directory')
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Journal directory identity changed')
  }
}

function openRetainedDirectoryEvidence(path, label, mutable, code, verificationMode) {
  let descriptor
  try {
    const flags = FS_OPEN_RDONLY | (FS_OPEN_DIRECTORY ?? 0) | (FS_OPEN_NOFOLLOW ?? 0)
    descriptor = fsOpenSync(path, flags)
    const openStat = fsFstatSync(descriptor, { bigint: true })
    const pathStat = fsLstatSync(path, { bigint: true })
    assertRetainedDirectoryStat(openStat, label, code)
    assertRetainedDirectoryStat(pathStat, label, code)
    if (statsIsSymbolicLink(pathStat)) {
      throw journalError(code, `${label} is a symlink`)
    }
    const real = fsRealpathSync(path)
    const canonicalPath = runtimePlatform === 'linux' ? path : pathResolve(path)
    if (comparablePath(real) !== comparablePath(canonicalPath)) {
      throw journalError(code, `${label} is noncanonical or traverses a symlink`)
    }
    const openSnapshot = retainedStatSnapshot(openStat, label, verificationMode)
    const pathSnapshot = retainedStatSnapshot(pathStat, label, verificationMode)
    if (
      openSnapshot.dev !== pathSnapshot.dev ||
      openSnapshot.ino !== pathSnapshot.ino ||
      (!mutable && !sameRetainedSnapshot(openSnapshot, pathSnapshot))
    ) {
      throw journalError(code, `${label} path identity changed`)
    }
    const identity =
      verificationMode === 'committed'
        ? freezeInternalRecord({ dev: openSnapshot.dev, ino: openSnapshot.ino })
        : objectFreeze({ dev: openSnapshot.dev, ino: openSnapshot.ino })
    const evidence =
      verificationMode === 'committed'
        ? freezeInternalRecord({
            descriptor,
            path,
            label,
            mutable,
            code,
            identity,
            snapshot: openSnapshot,
            kind: 'directory',
          })
        : objectFreeze({
            descriptor,
            path,
            label,
            mutable,
            code,
            identity,
            snapshot: openSnapshot,
            kind: 'directory',
          })
    descriptor = undefined
    return evidence
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError(
      verificationMode === 'committed' ? 'RECOVERY_FILESYSTEM_FAILURE' : code,
      `Could not retain ${label}`,
      error
    )
  } finally {
    if (descriptor !== undefined) closeDescriptorNoThrow(descriptor)
  }
}

function openRetainedFileEvidence(
  path,
  label,
  code,
  maximumBytes,
  requireNonempty,
  role,
  expectedSizeBytes,
  verificationMode
) {
  let descriptor
  try {
    const flags = FS_OPEN_RDONLY | (FS_OPEN_NOFOLLOW ?? 0)
    descriptor = fsOpenSync(path, flags)
    const openStat = fsFstatSync(descriptor, { bigint: true })
    const pathStat = fsLstatSync(path, { bigint: true })
    assertRetainedFileStat(openStat, label, code)
    assertRetainedFileStat(pathStat, label, code)
    if (statsIsSymbolicLink(pathStat)) throw journalError(code, `${label} is a symlink`)
    const openSnapshot = retainedStatSnapshot(openStat, label, verificationMode)
    const pathSnapshot = retainedStatSnapshot(pathStat, label, verificationMode)
    if (!sameRetainedSnapshot(openSnapshot, pathSnapshot)) {
      throw journalError(code, `${label} path snapshot changed`)
    }
    if (
      openSnapshot.size > BigIntConstructor(maximumBytes) ||
      (requireNonempty && openSnapshot.size === 0n) ||
      (expectedSizeBytes !== undefined &&
        openSnapshot.size !== BigIntConstructor(expectedSizeBytes))
    ) {
      throw journalError(code, `${label} has an invalid retained size`)
    }
    const identity =
      verificationMode === 'committed'
        ? freezeInternalRecord({ dev: openSnapshot.dev, ino: openSnapshot.ino })
        : objectFreeze({ dev: openSnapshot.dev, ino: openSnapshot.ino })
    const evidence =
      verificationMode === 'committed'
        ? freezeInternalRecord({
            descriptor,
            path,
            label,
            code,
            identity,
            snapshot: openSnapshot,
            kind: 'file',
            role,
            expectedSizeBytes,
          })
        : objectFreeze({
            descriptor,
            path,
            label,
            code,
            identity,
            snapshot: openSnapshot,
            kind: 'file',
            ...(role === undefined ? {} : { role, expectedSizeBytes }),
          })
    descriptor = undefined
    return evidence
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError(
      verificationMode === 'committed' ? 'RECOVERY_FILESYSTEM_FAILURE' : code,
      `Could not retain ${label}`,
      error
    )
  } finally {
    if (descriptor !== undefined) closeDescriptorNoThrow(descriptor)
  }
}

function retainedStatSnapshot(stat, label, verificationMode = 'prepared') {
  if (
    typeof stat.dev !== 'bigint' ||
    typeof stat.ino !== 'bigint' ||
    typeof stat.nlink !== 'bigint' ||
    typeof stat.mode !== 'bigint' ||
    typeof stat.size !== 'bigint' ||
    typeof stat.mtimeNs !== 'bigint' ||
    typeof stat.ctimeNs !== 'bigint' ||
    stat.ino <= 0n ||
    stat.nlink <= 0n
  ) {
    throw journalError(
      'RECOVERY_DURABILITY_FAILURE',
      `Stable nanosecond filesystem evidence is unavailable for ${label}`
    )
  }
  const fields = {
    dev: stat.dev,
    ino: stat.ino,
    nlink: stat.nlink,
    mode: stat.mode & 0o777n,
    size: stat.size,
    mtimeNs: stat.mtimeNs,
    ctimeNs: stat.ctimeNs,
  }
  return verificationMode === 'committed' ? freezeInternalRecord(fields) : objectFreeze(fields)
}

function assertRetainedDirectoryStat(stat, label, code) {
  if (!statsIsDirectory(stat) || statsIsSymbolicLink(stat)) {
    throw journalError(code, `${label} is not a retained directory`)
  }
  const snapshot = retainedStatSnapshot(stat, label)
  if ((snapshot.mode & 0o077n) !== 0n) {
    throw journalError(code, `${label} is not private`)
  }
}

function assertRetainedFileStat(stat, label, code) {
  if (!statsIsFile(stat) || statsIsSymbolicLink(stat)) {
    throw journalError(code, `${label} is not a retained regular file`)
  }
  const snapshot = retainedStatSnapshot(stat, label)
  if (snapshot.nlink !== 1n || snapshot.mode !== BigIntConstructor(PRIVATE_READ_ONLY_FILE_MODE)) {
    throw journalError(code, `${label} is linked or is not sealed read-only`)
  }
}

function sameRetainedSnapshot(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

function revalidateRetainedEvidence(evidence, verificationMode) {
  if (!evidence) {
    throw journalError('PREPARED_PROOF_INVALID', 'Verified token has no retained evidence')
  }
  const reopened =
    verificationMode === 'committed'
      ? createInternalRecord({ directories: [], files: [] })
      : { directories: [], files: [] }
  try {
    for (let index = 0; index < evidence.directories.length; index += 1) {
      const retained = evidence.directories[index]
      const current = openRetainedDirectoryEvidence(
        retained.path,
        retained.label,
        retained.mutable,
        retained.code,
        verificationMode
      )
      appendArrayValue(reopened.directories, current)
      if (
        current.identity.dev !== retained.identity.dev ||
        current.identity.ino !== retained.identity.ino ||
        (verificationMode === 'prepared' &&
          !retained.mutable &&
          !sameRetainedSnapshot(current.snapshot, retained.snapshot))
      ) {
        throw journalError(retained.code, `${retained.label} retained evidence changed`)
      }
    }
    for (let index = 0; index < evidence.files.length; index += 1) {
      const retained = evidence.files[index]
      const current = openRetainedFileEvidence(
        retained.path,
        retained.label,
        retained.code,
        retained.snapshot.size,
        retained.snapshot.size > 0n,
        retained.role,
        retained.expectedSizeBytes,
        verificationMode
      )
      appendArrayValue(reopened.files, current)
      if (!sameRetainedSnapshot(current.snapshot, retained.snapshot)) {
        throw journalError(retained.code, `${retained.label} retained evidence changed`)
      }
    }
    if (verificationMode === 'prepared') {
      for (let index = 0; index < evidence.expectedLayouts.length; index += 1) {
        const layout = evidence.expectedLayouts[index]
        assertBoundedExactDirectoryEntries(
          layout.path,
          layout.expected,
          layout.artifact,
          verificationMode
        )
      }
    }
    for (let index = 0; index < evidence.directories.length; index += 1) {
      const retained = evidence.directories[index]
      const current = reopened.directories[index]
      if (!retained.mutable && !sameRetainedSnapshot(current.snapshot, retained.snapshot)) {
        throw journalError(retained.code, `${retained.label} retained evidence changed`)
      }
    }
    for (let index = 0; index < evidence.directories.length; index += 1) {
      const retained = evidence.directories[index]
      const current = fsFstatSync(retained.descriptor, { bigint: true })
      assertRetainedDirectoryStat(current, retained.label, retained.code)
      const snapshot = retainedStatSnapshot(current, retained.label, verificationMode)
      if (
        snapshot.dev !== retained.identity.dev ||
        snapshot.ino !== retained.identity.ino ||
        (!retained.mutable && !sameRetainedSnapshot(snapshot, retained.snapshot))
      ) {
        throw journalError(retained.code, `${retained.label} retained handle changed`)
      }
    }
    for (let index = 0; index < evidence.files.length; index += 1) {
      const retained = evidence.files[index]
      const current = fsFstatSync(retained.descriptor, { bigint: true })
      assertRetainedFileStat(current, retained.label, retained.code)
      if (
        !sameRetainedSnapshot(
          retainedStatSnapshot(current, retained.label, verificationMode),
          retained.snapshot
        )
      ) {
        throw journalError(retained.code, `${retained.label} retained handle changed`)
      }
    }
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError(
      'RECOVERY_FILESYSTEM_FAILURE',
      'Could not revalidate retained evidence',
      error
    )
  } finally {
    closeRetainedEvidence(reopened)
  }
}

function assertCommittedScannedDirectoryEntries(actual, expected, artifactDirectory, role) {
  const sortedActual = copyAndSortStrings(actual)
  const sortedExpected = copyAndSortStrings(expected)
  let matches = sortedActual.length === sortedExpected.length
  for (let index = 0; matches && index < sortedActual.length; index += 1) {
    matches = sortedActual[index] === sortedExpected[index]
  }
  if (!matches) {
    throw journalError(
      artifactDirectory ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION',
      `${role}-layout`
    )
  }
}

function assertBoundedExactDirectoryEntries(path, expected, artifactDirectory) {
  let directory
  const actual = []
  try {
    directory = fsOpendirSync(path)
    for (let index = 0; index <= expected.length; index += 1) {
      const entry = directoryReadSync(directory)
      if (entry === null) break
      appendArrayValue(actual, entry.name)
    }
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'Could not enumerate retained layout', error)
  } finally {
    if (directory !== undefined) {
      try {
        directoryCloseSync(directory)
      } catch {
        // Prepared-mode retained-evidence behavior is intentionally unchanged.
      }
    }
  }
  const sortedActual = sortStrings(actual)
  const sortedExpected = copyAndSortStrings(expected)
  let matches = sortedActual.length === sortedExpected.length
  for (let index = 0; matches && index < sortedActual.length; index += 1) {
    matches = sortedActual[index] === sortedExpected[index]
  }
  if (!matches) {
    let sidecar
    if (artifactDirectory) {
      for (let index = 0; index < sortedActual.length && sidecar === undefined; index += 1) {
        if (regexpExec(/\.sqlite-(?:wal|shm|journal)$/, sortedActual[index]) !== null) {
          sidecar = sortedActual[index]
        }
      }
    }
    throw journalError(
      artifactDirectory ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION',
      sidecar ? `SQLite sidecar ${sidecar} is forbidden` : 'Retained journal layout changed'
    )
  }
}

function readRetainedFileEvidence(evidence, maximumBytes, code, verificationMode = 'prepared') {
  const size = evidence.snapshot.size
  if (size <= 0n || size > BigIntConstructor(maximumBytes)) {
    throw journalError(code, `${evidence.label} has an invalid size`)
  }
  const bytes = bufferAlloc(NumberConstructor(size))
  let position = 0
  while (position < bytes.length) {
    const count = fsReadSync(
      evidence.descriptor,
      bytes,
      position,
      bytes.length - position,
      position
    )
    if (count <= 0) throw journalError(code, `${evidence.label} changed while reading`)
    position += count
  }
  const current = fsFstatSync(evidence.descriptor, { bigint: true })
  assertRetainedFileStat(current, evidence.label, code)
  if (
    !sameRetainedSnapshot(
      retainedStatSnapshot(current, evidence.label, verificationMode),
      evidence.snapshot
    )
  ) {
    throw journalError(code, `${evidence.label} changed while reading`)
  }
  return bytes
}

function closeRetainedEvidence(evidence) {
  if (!evidence) return
  const files = evidence.files
  if (arrayIsArray(files)) {
    for (let index = 0; index < files.length; index += 1) {
      closeDescriptorNoThrow(files[index].descriptor)
    }
  }
  const directories = evidence.directories
  if (arrayIsArray(directories)) {
    for (let index = 0; index < directories.length; index += 1) {
      closeDescriptorNoThrow(directories[index].descriptor)
    }
  }
}

function closeDescriptorNoThrow(descriptor) {
  try {
    fsCloseSync(descriptor)
  } catch {
    // Release and consume mark lifecycle state before best-effort descriptor closure.
  }
}

function openExclusiveFile(path) {
  const flags = FS_OPEN_CREAT | FS_OPEN_EXCL | FS_OPEN_RDWR | (FS_OPEN_NOFOLLOW ?? 0)
  try {
    const descriptor = fsOpenSync(path, flags, PRIVATE_WRITABLE_FILE_MODE)
    if (runtimePlatform !== 'win32') fsFchmodSync(descriptor, PRIVATE_WRITABLE_FILE_MODE)
    return descriptor
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw journalError('RECOVERY_JOURNAL_CORRUPTION', 'Final journal path already exists')
    }
    throw error
  }
}

function openExistingFile(path, label, corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION') {
  const flags = FS_OPEN_RDONLY | (FS_OPEN_NOFOLLOW ?? 0)
  let descriptor
  try {
    descriptor = fsOpenSync(path, flags)
    const identity = inspectOpenRegularFile(descriptor, path, label, corruptionCode, true)
    return { descriptor, identity }
  } catch (error) {
    if (descriptor !== undefined) fsCloseSync(descriptor)
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError(corruptionCode, `Could not open ${label}`, error)
  }
}

function inspectOpenRegularFile(
  descriptor,
  path,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION',
  sealed = false,
  preserveFilesystemFailure = false
) {
  let openStat
  let pathStat
  try {
    openStat = fsFstatSync(descriptor, { bigint: true })
    pathStat = fsLstatSync(path, { bigint: true })
  } catch (error) {
    throw journalError(
      preserveFilesystemFailure ? 'RECOVERY_FILESYSTEM_FAILURE' : corruptionCode,
      `Could not inspect ${label}`,
      error
    )
  }
  if (
    !statsIsFile(openStat) ||
    !statsIsFile(pathStat) ||
    statsIsSymbolicLink(pathStat) ||
    openStat.nlink !== 1n ||
    pathStat.nlink !== 1n ||
    openStat.ino <= 0n ||
    openStat.dev !== pathStat.dev ||
    openStat.ino !== pathStat.ino
  ) {
    throw journalError(corruptionCode, `${label} is replaced, linked, or not a stable regular file`)
  }
  if (runtimePlatform !== 'win32') {
    const mode = NumberConstructor(pathStat.mode) & 0o777
    if (sealed ? mode !== PRIVATE_READ_ONLY_FILE_MODE : (mode & 0o077) !== 0) {
      throw journalError(
        corruptionCode,
        sealed ? `${label} is not sealed read-only` : `${label} is not private`
      )
    }
  }
  return objectFreeze({ dev: openStat.dev, ino: openStat.ino })
}

function revalidateOpenRegularFile(
  descriptor,
  path,
  identity,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION',
  sealed = false,
  preserveFilesystemFailure = false
) {
  const current = inspectOpenRegularFile(
    descriptor,
    path,
    label,
    corruptionCode,
    sealed,
    preserveFilesystemFailure
  )
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw journalError(corruptionCode, `${label} identity changed`)
  }
}

function flushAndSealFile(
  descriptor,
  path,
  identity,
  label,
  corruptionCode = 'RECOVERY_ARTIFACT_CORRUPTION'
) {
  try {
    fsFsyncSync(descriptor)
    fsFchmodSync(descriptor, PRIVATE_READ_ONLY_FILE_MODE)
    fsFsyncSync(descriptor)
  } catch (error) {
    throw journalError('RECOVERY_DURABILITY_FAILURE', `Could not flush and seal ${label}`, error)
  }
  revalidateOpenRegularFile(descriptor, path, identity, label, corruptionCode, true)
}

function hashOpenArtifact(
  descriptor,
  path,
  identity,
  role,
  expectedSizeBytes,
  verificationMode = 'prepared'
) {
  let stat
  try {
    stat = fsFstatSync(descriptor, { bigint: true })
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not stat ${role} artifact`, error)
  }
  if (
    stat.size > BigIntConstructor(MAX_ARTIFACT_BYTES) ||
    (expectedSizeBytes !== undefined && stat.size !== BigIntConstructor(expectedSizeBytes))
  ) {
    throw journalError(
      'RECOVERY_ARTIFACT_CORRUPTION',
      `${role} artifact opened size is unexpected or exceeds the 8 GiB limit`
    )
  }
  const hasher = hardenedCreateRecoveryArtifactHasher(role)
  const chunk = bufferAllocUnsafe(HASH_CHUNK_SIZE)
  let position = 0
  while (position < NumberConstructor(stat.size)) {
    const length = mathMin(chunk.length, NumberConstructor(stat.size) - position)
    let count
    try {
      count = fsReadSync(descriptor, chunk, 0, length, position)
    } catch (error) {
      throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not hash ${role} artifact`, error)
    }
    if (count <= 0) {
      throw journalError('RECOVERY_ARTIFACT_CORRUPTION', `${role} artifact changed while hashing`)
    }
    hashUpdate(hasher, bufferSubarray(chunk, 0, count))
    position += count
  }
  revalidateOpenRegularFile(
    descriptor,
    path,
    identity,
    `${role} artifact`,
    'RECOVERY_ARTIFACT_CORRUPTION',
    true,
    verificationMode === 'committed'
  )
  const finalStat = fsFstatSync(descriptor, { bigint: true })
  if (finalStat.size !== stat.size) {
    throw journalError(
      'RECOVERY_ARTIFACT_CORRUPTION',
      `${role} artifact size changed while hashing`
    )
  }
  const result = {
    contentDigest: `sha256:${hashDigest(hasher, 'hex')}`,
    sizeBytes: NumberConstructor(stat.size),
  }
  return verificationMode === 'committed' ? freezeInternalRecord(result) : result
}

function openArtifactEvidence(path, role, expectedSizeBytes) {
  const { descriptor, identity } = openExistingFile(path, `${role} artifact`)
  try {
    const snapshot = linuxFileSnapshot(descriptor, `${role} artifact`)
    if (snapshot.size > BigInt(MAX_ARTIFACT_BYTES) || snapshot.size !== BigInt(expectedSizeBytes)) {
      throw journalError(
        'RECOVERY_ARTIFACT_CORRUPTION',
        `${role} artifact opened size is unexpected or exceeds the 8 GiB limit`
      )
    }
    return objectFreeze({ descriptor, identity, path, role, expectedSizeBytes, snapshot })
  } catch (error) {
    fsCloseSync(descriptor)
    throw error
  }
}

function linuxFileSnapshot(descriptor, label) {
  let stat
  try {
    stat = fsFstatSync(descriptor, { bigint: true })
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not snapshot ${label}`, error)
  }
  if (
    typeof stat.mtimeNs !== 'bigint' ||
    typeof stat.ctimeNs !== 'bigint' ||
    typeof stat.size !== 'bigint'
  ) {
    throw journalError(
      'RECOVERY_DURABILITY_FAILURE',
      `Linux stat evidence is unavailable for ${label}`
    )
  }
  return objectFreeze({ size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs })
}

function revalidateArtifactEvidence(opened) {
  revalidateOpenRegularFile(
    opened.descriptor,
    opened.path,
    opened.identity,
    `${opened.role} artifact`,
    'RECOVERY_ARTIFACT_CORRUPTION',
    true
  )
  const current = linuxFileSnapshot(opened.descriptor, `${opened.role} artifact`)
  if (
    current.size !== opened.snapshot.size ||
    current.mtimeNs !== opened.snapshot.mtimeNs ||
    current.ctimeNs !== opened.snapshot.ctimeNs
  ) {
    throw journalError(
      'RECOVERY_ARTIFACT_CORRUPTION',
      `${opened.role} artifact changed during complete evidence verification`
    )
  }
}

function readSecureFile(path, label, maximumBytes, corruptionCode = 'RECOVERY_JOURNAL_CORRUPTION') {
  const { descriptor, identity } = openExistingFile(path, label, corruptionCode)
  try {
    const stat = fsFstatSync(descriptor, { bigint: true })
    if (stat.size <= 0n || stat.size > BigInt(maximumBytes)) {
      throw journalError(corruptionCode, `${label} has an invalid size`)
    }
    const bytes = bufferAlloc(NumberConstructor(stat.size))
    let position = 0
    while (position < bytes.length) {
      const count = fsReadSync(descriptor, bytes, position, bytes.length - position, position)
      if (count <= 0) {
        throw journalError(corruptionCode, `${label} changed while reading`)
      }
      position += count
    }
    revalidateOpenRegularFile(descriptor, path, identity, label, corruptionCode, true)
    if (fsFstatSync(descriptor, { bigint: true }).size !== stat.size) {
      throw journalError(corruptionCode, `${label} size changed while reading`)
    }
    return bytes
  } finally {
    fsCloseSync(descriptor)
  }
}

function runInterArtifactHashTestHook(openedArtifacts) {
  if (interArtifactHashTestHook === undefined) return
  if (runtimeEnvironment.NODE_ENV !== 'test') {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Recovery test hook is test-only')
  }
  const snapshot = []
  for (let index = 0; index < openedArtifacts.length; index += 1) {
    const opened = openedArtifacts[index]
    appendArrayValue(snapshot, objectFreeze({ role: opened.role, path: opened.path }))
  }
  interArtifactHashTestHook(objectFreeze(snapshot))
}

function finishDurability(paths) {
  requireLinuxDurability()
  for (const [path, faultPoint] of [
    [paths.artifacts, 'after-artifacts-directory-fsync'],
    [paths.records, 'after-records-directory-fsync'],
    [paths.operation, 'after-operation-directory-fsync'],
    [paths.operations, 'after-operations-directory-fsync'],
    [paths.recoveryRoot, 'after-recovery-root-fsync'],
    [paths.operationRoot, 'after-operation-root-fsync'],
  ]) {
    syncDirectory(path)
    injectFault(faultPoint)
  }
  return 'linux-fsync-complete'
}

function syncDirectory(path) {
  let descriptor
  try {
    const flags = FS_OPEN_RDONLY | (FS_OPEN_DIRECTORY ?? 0) | (FS_OPEN_NOFOLLOW ?? 0)
    descriptor = fsOpenSync(path, flags)
    const stat = fsFstatSync(descriptor, { bigint: true })
    if (!statsIsDirectory(stat)) {
      throw journalError('RECOVERY_DURABILITY_FAILURE', 'Directory sync target is not a directory')
    }
    fsFsyncSync(descriptor)
  } catch (error) {
    if (weakSetHas(internalRecoveryJournalErrors, error)) throw error
    throw journalError('RECOVERY_DURABILITY_FAILURE', `Could not fsync directory ${path}`, error)
  } finally {
    if (descriptor !== undefined) fsCloseSync(descriptor)
  }
}

function assertExactDirectoryEntries(
  path,
  expected,
  artifactDirectory = false,
  allowMissingExpected = false
) {
  const actual = sortStrings(safeDirectoryEntries(path, 'journal directory'))
  const sortedExpected = copyAndSortStrings(expected)
  if (allowMissingExpected && actual.length === 0) return
  let matches = actual.length === sortedExpected.length
  for (let index = 0; matches && index < actual.length; index += 1) {
    matches = actual[index] === sortedExpected[index]
  }
  if (!matches) {
    throw journalError(
      artifactDirectory ? 'RECOVERY_ARTIFACT_CORRUPTION' : 'RECOVERY_JOURNAL_CORRUPTION',
      'Journal directory contains missing or unexpected entries'
    )
  }
}

function assertNoSqliteSidecars(path) {
  const entries = safeDirectoryEntries(path, 'artifacts directory')
  let sidecar
  for (let index = 0; index < entries.length && sidecar === undefined; index += 1) {
    if (regexpExec(/\.sqlite-(?:wal|shm|journal)$/, entries[index]) !== null)
      sidecar = entries[index]
  }
  if (sidecar) {
    throw journalError('RECOVERY_ARTIFACT_CORRUPTION', `SQLite sidecar ${sidecar} is forbidden`)
  }
}

function safeDirectoryEntries(path, label) {
  try {
    return fsReaddirSync(path)
  } catch (error) {
    throw journalError('RECOVERY_FILESYSTEM_FAILURE', `Could not read ${label}`, error)
  }
}

function pathExists(path) {
  try {
    fsLstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function writeAll(descriptor, bytes) {
  let offset = 0
  while (offset < bytes.length) {
    const written = fsWriteSync(descriptor, bytes, offset, bytes.length - offset)
    if (written <= 0) throw journalError('RECOVERY_FILESYSTEM_FAILURE', 'Short journal write')
    offset += written
  }
}

function injectFault(point) {
  const configured = runtimeEnvironment.SHIKIN_RECOVERY_JOURNAL_TEST_FAULT
  if (runtimeEnvironment.NODE_ENV !== 'test' || configured === undefined || configured === '')
    return
  if (!FAULT_POINTS.has(configured)) {
    throw journalError('INVALID_RECOVERY_OPTIONS', 'Unknown recovery journal test fault point')
  }
  if (configured === point) {
    throw journalError('RECOVERY_TEST_FAULT', `Injected recovery journal fault after ${point}`)
  }
}

function assertExactKeys(value, required, label, code, optional = []) {
  if (!isPlainObject(value)) throw journalError(code, `${label} must be a plain object`)
  const actual = objectKeys(value)
  let malformed = actual.length < required.length
  for (let index = 0; !malformed && index < required.length; index += 1) {
    malformed = !hasOwnProperty(value, required[index])
  }
  for (let index = 0; !malformed && index < actual.length; index += 1) {
    const key = actual[index]
    malformed = !hasCommittedKey(required, key) && !hasCommittedKey(optional, key)
  }
  if (malformed) throw journalError(code, `${label} has unknown or missing fields`)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || arrayIsArray(value)) return false
  const prototype = objectGetPrototypeOf(value)
  return prototype === objectPrototype || prototype === null
}

function isCanonicalPlainObject(value) {
  if (!isPlainObject(value)) return false
  try {
    canonicalRecoveryJournalBytes(value)
    return true
  } catch {
    return false
  }
}

function isIdentifier(value) {
  if (typeof value !== 'string') return false
  const codePoints = committedCodePointLength(value)
  return codePoints >= 1 && codePoints <= 128
}

function isIsoTime(value) {
  if (typeof value !== 'string' || regexpExec(ISO_TIME, value) === null) return false
  try {
    const timestamp = new DateConstructor(value)
    return !numberIsNaN(dateGetTime(timestamp)) && dateToISOString(timestamp) === value
  } catch {
    return false
  }
}

function isNonnegativeSafeInteger(value) {
  return numberIsSafeInteger(value) && value >= 0 && !objectIs(value, -0)
}

function isPositiveSafeInteger(value) {
  return numberIsSafeInteger(value) && value >= 1
}

function cloneOwner(owner) {
  return {
    ownerId: owner.ownerId,
    runtimeId: owner.runtimeId,
    hostId: owner.hostId,
    processId: owner.processId,
    processStartedAt: owner.processStartedAt,
  }
}

function cloneIntent(intent) {
  const clone = {
    recordKind: intent.recordKind,
    operationId: intent.operationId,
    operation: intent.operation,
    phase: intent.phase,
    owner: cloneOwner(intent.owner),
    fencingGeneration: intent.fencingGeneration,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  }
  if (intent.metadata !== undefined) clone.metadata = structuredClone(intent.metadata)
  return objectFreeze(clone)
}

function cloneBinding(binding) {
  return objectFreeze({
    operationRoot: binding.operationRoot,
    stateRevision: binding.stateRevision,
    intent: cloneIntent(binding.intent),
  })
}

function schemaContractIdentity() {
  return {
    rawBytesSha256: SHIKIN_SCHEMA_CONTRACT_IDENTITY.rawBytesSha256,
    contractVersion: SHIKIN_SCHEMA_CONTRACT_IDENTITY.contractVersion,
    latestMigration: SHIKIN_SCHEMA_CONTRACT_IDENTITY.latestMigration,
  }
}

function sameBinding(left, right) {
  return (
    left.operationRoot === right.operationRoot &&
    left.stateRevision === right.stateRevision &&
    left.intent.recordKind === right.intent.recordKind &&
    left.intent.operationId === right.intent.operationId &&
    left.intent.operation === right.intent.operation &&
    left.intent.phase === right.intent.phase &&
    left.intent.fencingGeneration === right.intent.fencingGeneration &&
    left.intent.createdAt === right.intent.createdAt &&
    left.intent.updatedAt === right.intent.updatedAt &&
    sameOptionalMetadata(left.intent.metadata, right.intent.metadata) &&
    sameOwner(left.intent.owner, right.intent.owner)
  )
}

function sameCommittedBinding(left, right) {
  const leftCommitment = left.intent.recoveryCommitment
  const rightCommitment = right.intent.recoveryCommitment
  return (
    left.operationRoot === right.operationRoot &&
    left.stateRevision === right.stateRevision &&
    left.intent.recordKind === right.intent.recordKind &&
    left.intent.operationId === right.intent.operationId &&
    left.intent.operation === right.intent.operation &&
    left.intent.phase === right.intent.phase &&
    left.intent.fencingGeneration === right.intent.fencingGeneration &&
    left.intent.createdAt === right.intent.createdAt &&
    left.intent.updatedAt === right.intent.updatedAt &&
    sameOwner(left.intent.owner, right.intent.owner) &&
    leftCommitment['shikin.recovery.protocol'] === rightCommitment['shikin.recovery.protocol'] &&
    leftCommitment['shikin.recovery.version'] === rightCommitment['shikin.recovery.version'] &&
    leftCommitment['shikin.recovery.recordSha256'] ===
      rightCommitment['shikin.recovery.recordSha256'] &&
    leftCommitment['shikin.recovery.durability'] ===
      rightCommitment['shikin.recovery.durability'] &&
    leftCommitment['shikin.recovery.claimSequence'] ===
      rightCommitment['shikin.recovery.claimSequence']
  )
}

function sameOptionalMetadata(left, right) {
  if (left === undefined || right === undefined) return left === right
  return bufferEquals(canonicalRecoveryJournalBytes(left), canonicalRecoveryJournalBytes(right))
}

function sameOwner(left, right) {
  return (
    isPlainObject(left) &&
    left.ownerId === right.ownerId &&
    left.runtimeId === right.runtimeId &&
    left.hostId === right.hostId &&
    left.processId === right.processId &&
    left.processStartedAt === right.processStartedAt &&
    objectKeys(left).length === 5
  )
}

function comparablePath(path) {
  return runtimePlatform === 'win32' ? stringToLowerCase(path) : path
}

function requireLinuxDurability() {
  if (runtimePlatform !== 'linux') {
    throw journalError(
      'RECOVERY_DURABILITY_FAILURE',
      'Recovery journal proof issuance and verification require Linux fsync semantics'
    )
  }
}

function revalidateDirectoryIdentities(identities) {
  for (const identity of identities.values()) revalidateDirectoryIdentity(identity)
}

function journalError(code, message, cause) {
  const error = new RecoveryJournalError(code, message, cause)
  weakSetAdd(internalRecoveryJournalErrors, error)
  return error
}

function normalizeError(error) {
  if (weakSetHas(internalRecoveryJournalErrors, error) || error instanceof RecoveryJournalError) {
    return error
  }
  return journalError(
    'RECOVERY_FILESYSTEM_FAILURE',
    error?.message ?? StringConstructor(error),
    error
  )
}

function normalizeCommittedError(error) {
  if (weakSetHas(internalRecoveryJournalErrors, error)) return error
  return journalError(
    'RECOVERY_FILESYSTEM_FAILURE',
    'Committed recovery evidence verification failed',
    error
  )
}
