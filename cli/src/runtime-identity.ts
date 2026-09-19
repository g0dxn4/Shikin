import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { relative, resolve } from 'node:path'
import { PRIVATE_FILE_MODE, hardenPathMode } from './app-data-dir.js'

export const RUNTIME_IDENTITY_FILE_NAME = 'runtime-identity.json'
const RUNTIME_IDENTITY_VERSION = 1
const MAX_IDENTITY_BYTES = 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type RuntimeIdentityStatus =
  | { status: 'available'; id: string }
  | { status: 'unavailable'; reason: 'missing' | 'invalid' | 'unsafe' | 'unreadable' }

function identityPath(appDataDir: string): string {
  return resolve(appDataDir, RUNTIME_IDENTITY_FILE_NAME)
}

function isConfined(parent: string, child: string): boolean {
  const pathFromParent = relative(parent, child)
  return (
    pathFromParent !== '..' &&
    !pathFromParent.startsWith('../') &&
    !pathFromParent.startsWith('..\\')
  )
}

function validatedAppDataDir(appDataDir: string): string {
  const lexicalRoot = resolve(appDataDir)
  const rootStats = lstatSync(lexicalRoot)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('Runtime identity storage root is unsafe.')
  }
  return realpathSync(lexicalRoot)
}

function waitForConcurrentCreator(): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
}

function parseIdentity(contents: string): string | null {
  try {
    const value = JSON.parse(contents) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (
      Object.keys(record).sort().join(',') !== 'localInstanceId,version' ||
      record.version !== RUNTIME_IDENTITY_VERSION ||
      typeof record.localInstanceId !== 'string' ||
      !UUID_PATTERN.test(record.localInstanceId)
    ) {
      return null
    }
    return record.localInstanceId.toLowerCase()
  } catch {
    return null
  }
}

function readIdentityFile(appDataDir: string): RuntimeIdentityStatus {
  let canonicalRoot: string
  try {
    canonicalRoot = validatedAppDataDir(appDataDir)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'unavailable', reason: 'missing' }
    }
    return { status: 'unavailable', reason: 'unsafe' }
  }

  const path = identityPath(appDataDir)
  if (!isConfined(resolve(appDataDir), path)) {
    return { status: 'unavailable', reason: 'unsafe' }
  }

  let fd: number | null = null
  try {
    const stats = lstatSync(path)
    if (stats.isSymbolicLink() || !stats.isFile()) {
      return { status: 'unavailable', reason: 'unsafe' }
    }
    const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
    fd = openSync(path, constants.O_RDONLY | noFollow)
    const openedStats = fstatSync(fd)
    if (!openedStats.isFile() || openedStats.size > MAX_IDENTITY_BYTES) {
      return { status: 'unavailable', reason: 'invalid' }
    }
    const canonicalPath = realpathSync(path)
    if (!isConfined(canonicalRoot, canonicalPath)) {
      return { status: 'unavailable', reason: 'unsafe' }
    }
    const id = parseIdentity(readFileSync(fd, 'utf8'))
    return id ? { status: 'available', id } : { status: 'unavailable', reason: 'invalid' }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { status: 'unavailable', reason: 'missing' }
    }
    if (error instanceof Error && 'code' in error && error.code === 'ELOOP') {
      return { status: 'unavailable', reason: 'unsafe' }
    }
    return { status: 'unavailable', reason: 'unreadable' }
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Read-only: never creates a directory or identity and never repairs invalid content. */
export function readRuntimeIdentity(appDataDir: string): RuntimeIdentityStatus {
  return readIdentityFile(appDataDir)
}

/** Call only after authorized storage preparation and successful database initialization. */
export function initializeRuntimeIdentity(appDataDir: string, candidateId: string): string {
  const normalizedId = candidateId.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalizedId)) {
    throw new Error('Runtime identity candidate must be a UUID.')
  }

  validatedAppDataDir(appDataDir)
  const path = identityPath(appDataDir)
  if (!isConfined(resolve(appDataDir), path)) {
    throw new Error('Runtime identity path is unsafe.')
  }

  let fd: number | null = null
  let created = false
  try {
    fd = openSync(path, 'wx', PRIVATE_FILE_MODE)
    created = true
    writeFileSync(
      fd,
      `${JSON.stringify({ version: RUNTIME_IDENTITY_VERSION, localInstanceId: normalizedId })}\n`,
      'utf8'
    )
    fsyncSync(fd)
    closeSync(fd)
    fd = null
    hardenPathMode(path, PRIVATE_FILE_MODE)
    return normalizedId
  } catch (error) {
    if (fd !== null) closeSync(fd)
    if (created) {
      try {
        unlinkSync(path)
      } catch {
        // Preserve the initialization failure; the next read will report the residue honestly.
      }
    }
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error

    let existing = readIdentityFile(appDataDir)
    for (let attempt = 0; attempt < 20 && existing.status === 'unavailable'; attempt += 1) {
      if (existing.reason === 'unsafe' || existing.reason === 'missing') break
      waitForConcurrentCreator()
      existing = readIdentityFile(appDataDir)
    }
    if (existing.status === 'available') return existing.id
    throw new Error(`Existing runtime identity is ${existing.reason}; refusing to replace it.`, {
      cause: error,
    })
  }
}
