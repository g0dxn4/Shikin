// @vitest-environment node
import type * as NodeFs from 'node:fs'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const APP_ID = 'com.asf.shikin'
const tempDirs = new Set<string>()

function syntheticRoots() {
  const root = mkdtempSync(join(tmpdir(), 'shikin-notebook-mig-'))
  tempDirs.add(root)
  const home = join(root, 'home')
  const data = join(root, 'data')
  const config = join(root, 'config')
  mkdirSync(home, { recursive: true })
  mkdirSync(data, { recursive: true })
  mkdirSync(config, { recursive: true })
  return { root, home, data, config }
}

function stubApprovedCustomRoot(roots: { home: string; data: string; config: string }) {
  vi.stubEnv('HOME', roots.home)
  vi.stubEnv('XDG_DATA_HOME', roots.data)
  vi.stubEnv('XDG_CONFIG_HOME', roots.config)
  vi.stubEnv('SHIKIN_MIGRATE_LEGACY_DATA', '1')
  vi.stubEnv('SHIKIN_RESPECT_XDG_DATA_HOME', '')
}

function legacyNotebookDir(home: string) {
  return join(home, '.local', 'share', APP_ID, 'notebook')
}

function targetNotebookDir(data: string) {
  return join(data, APP_ID, 'notebook')
}

async function loadNotebook() {
  vi.resetModules()
  return import('./notebook.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('./storage-context.js')
  vi.doUnmock('node:fs')
  vi.resetModules()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('notebook writes across approved custom-root migration', () => {
  it('appends to a legacy notebook after migration instead of overwriting it', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'keep.md'), 'legacy body')
    stubApprovedCustomRoot(roots)

    const { appendNote } = await loadNotebook()
    await appendNote('keep.md', 'appended')

    expect(readFileSync(join(targetNotebookDir(roots.data), 'keep.md'), 'utf-8')).toBe(
      'legacy body\nappended'
    )
  })

  it('rejects writes through a file symlink that only appears after migration', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    const outsideFile = join(roots.root, 'outside.md')
    writeFileSync(outsideFile, 'outside-secret')
    symlinkSync(outsideFile, join(legacyDir, 'linked.md'))
    stubApprovedCustomRoot(roots)

    const { writeNote } = await loadNotebook()
    await expect(writeNote('linked.md', 'escaped')).rejects.toThrow('Path symlink detected')
    expect(readFileSync(outsideFile, 'utf-8')).toBe('outside-secret')
  })

  it('rejects writes through a directory symlink that only appears after migration', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    const outsideDir = join(roots.root, 'outside')
    mkdirSync(outsideDir, { recursive: true })
    symlinkSync(outsideDir, join(legacyDir, 'linked'), 'dir')
    stubApprovedCustomRoot(roots)

    const { writeNote } = await loadNotebook()
    await expect(writeNote('linked/escape.md', 'escaped')).rejects.toThrow('Path symlink detected')
    expect(existsSync(join(outsideDir, 'escape.md'))).toBe(false)
  })

  it('appends to a write-only migrated note without reading it', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    const legacyFile = join(legacyDir, 'secret.md')
    writeFileSync(legacyFile, 'do-not-lose')
    // Write-only: append must not require read access, so no bytes are lost.
    chmodSync(legacyFile, 0o200)
    stubApprovedCustomRoot(roots)

    try {
      const { appendNote } = await loadNotebook()
      await appendNote('secret.md', 'appended')
      const migrated = join(targetNotebookDir(roots.data), 'secret.md')
      expect(readFileSync(migrated, 'utf-8')).toBe('do-not-lose\nappended')
    } finally {
      const migrated = join(targetNotebookDir(roots.data), 'secret.md')
      if (existsSync(migrated)) chmodSync(migrated, 0o600)
      if (existsSync(legacyFile)) chmodSync(legacyFile, 0o600)
    }
  })

  it('preserves migrated bytes when append is denied write access', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    const legacyFile = join(legacyDir, 'readonly.md')
    writeFileSync(legacyFile, 'do-not-lose')
    chmodSync(legacyFile, 0o400)
    stubApprovedCustomRoot(roots)

    try {
      const { appendNote } = await loadNotebook()
      await expect(appendNote('readonly.md', 'appended')).rejects.toMatchObject({ code: 'EACCES' })
      const migrated = join(targetNotebookDir(roots.data), 'readonly.md')
      expect(existsSync(migrated)).toBe(true)
      chmodSync(migrated, 0o600)
      expect(readFileSync(migrated, 'utf-8')).toBe('do-not-lose')
    } finally {
      const migrated = join(targetNotebookDir(roots.data), 'readonly.md')
      if (existsSync(migrated)) chmodSync(migrated, 0o600)
      if (existsSync(legacyFile)) chmodSync(legacyFile, 0o600)
    }
  })

  it('preserves invalid UTF-8 bytes in a migrated note when appending', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    const legacyBytes = Buffer.from([0xff, 0xfe, 0x80, 0x41])
    writeFileSync(join(legacyDir, 'binary.md'), legacyBytes)
    stubApprovedCustomRoot(roots)

    const { appendNote } = await loadNotebook()
    await appendNote('binary.md', 'appended')

    const migrated = readFileSync(join(targetNotebookDir(roots.data), 'binary.md'))
    expect(migrated).toEqual(Buffer.concat([legacyBytes, Buffer.from('\nappended')]))
  })

  it('does not overwrite a competitor file created during an exclusive write', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    stubApprovedCustomRoot(roots)

    const targetPath = join(targetNotebookDir(roots.data), 'race.md')
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof NodeFs>()
      return {
        ...actual,
        writeFileSync: ((
          path: Parameters<typeof actual.writeFileSync>[0],
          data: Parameters<typeof actual.writeFileSync>[1],
          options?: Parameters<typeof actual.writeFileSync>[2]
        ) => {
          const flag = typeof options === 'object' && options !== null ? options.flag : undefined
          if (path === targetPath && flag === 'wx') {
            actual.writeFileSync(targetPath, 'competitor', { encoding: 'utf-8', mode: 0o600 })
          }
          return actual.writeFileSync(path, data, options)
        }) as typeof actual.writeFileSync,
      }
    })

    const { writeNoteIfAbsent } = await loadNotebook()
    await expect(writeNoteIfAbsent('race.md', 'loser')).resolves.toBe(false)
    expect(readFileSync(targetPath, 'utf-8')).toBe('competitor')
  })

  it('writes a note only when it is still absent after preparation', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'review.md'), 'already there')
    stubApprovedCustomRoot(roots)

    const { writeNoteIfAbsent } = await loadNotebook()
    await expect(writeNoteIfAbsent('review.md', 'replacement')).resolves.toBe(false)
    expect(readFileSync(join(targetNotebookDir(roots.data), 'review.md'), 'utf-8')).toBe(
      'already there'
    )
    await expect(writeNoteIfAbsent('fresh.md', 'brand new')).resolves.toBe(true)
    expect(readFileSync(join(targetNotebookDir(roots.data), 'fresh.md'), 'utf-8')).toBe('brand new')
  })

  it('does not migrate storage when listing, importing, or reading a missing note', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'keep.md'), 'legacy body')
    stubApprovedCustomRoot(roots)

    const { listNotes, noteExists, readNote } = await loadNotebook()
    const targetRoot = join(roots.data, APP_ID)
    expect(existsSync(targetRoot)).toBe(false)
    await expect(listNotes()).resolves.toEqual([])
    await expect(noteExists('keep.md')).resolves.toBe(false)
    await expect(readNote('keep.md')).rejects.toThrow()
    expect(existsSync(targetRoot)).toBe(false)
    expect(readFileSync(join(legacyDir, 'keep.md'), 'utf-8')).toBe('legacy body')
  })

  it('does not migrate storage when a native binding failure happens on append', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'keep.md'), 'legacy body')
    stubApprovedCustomRoot(roots)
    vi.resetModules()
    vi.doMock('./storage-context.js', async (importOriginal) => {
      const actual = (await importOriginal()) as Record<string, unknown>
      return {
        ...actual,
        validateNativeSqliteBinding: () => {
          throw new Error('NODE_MODULE_VERSION mismatch')
        },
      }
    })

    const { appendNote } = await import('./notebook.js')
    await expect(appendNote('keep.md', 'appended')).rejects.toThrow(/NODE_MODULE_VERSION mismatch/)
    expect(existsSync(join(roots.data, APP_ID))).toBe(false)
    expect(readFileSync(join(legacyDir, 'keep.md'), 'utf-8')).toBe('legacy body')
  })

  it('rejects lexical traversal before migrating a custom-root notebook', async () => {
    const roots = syntheticRoots()
    const legacyDir = legacyNotebookDir(roots.home)
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, 'keep.md'), 'legacy body')
    stubApprovedCustomRoot(roots)

    const { writeNote, appendNote } = await loadNotebook()
    await expect(writeNote('../outside.md', 'nope')).rejects.toThrow('Path traversal detected')
    await expect(appendNote('../outside.md', 'nope')).rejects.toThrow('Path traversal detected')
    expect(existsSync(join(roots.data, APP_ID))).toBe(false)
    expect(readFileSync(join(legacyDir, 'keep.md'), 'utf-8')).toBe('legacy body')
  })
})
