// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NOTEBOOK_DIR, isSafeNotebookPathInput, resolveNotebookPath } from './notebook-path.js'

const tempDirs = new Set<string>()

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('./storage-context.js')
  vi.resetModules()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs.clear()
})

describe('notebook path security', () => {
  it('keeps note paths confined to the notebook directory', () => {
    expect(resolveNotebookPath('holdings/AAPL.md')).toBe(`${NOTEBOOK_DIR}/holdings/AAPL.md`)
    expect(() => resolveNotebookPath('../notebook-evil/AAPL.md')).toThrow('Path traversal detected')
    expect(() => resolveNotebookPath('/etc/passwd')).toThrow('Path traversal detected')
  })

  it('rejects unsafe notebook tool path inputs before filesystem access', () => {
    expect(isSafeNotebookPathInput('weekly-reviews/2026-04-14.md')).toBe(true)
    expect(isSafeNotebookPathInput('../outside.md')).toBe(false)
    expect(isSafeNotebookPathInput('C:\\temp\\outside.md')).toBe(false)
  })

  it('places notebook files under absolute XDG_DATA_HOME when configured', async () => {
    const xdgDataHome = '/tmp/shikin-notebook-xdg-data-home'

    vi.stubEnv('HOME', '/home/example')
    vi.stubEnv('XDG_DATA_HOME', xdgDataHome)
    vi.resetModules()

    const notebookPathModule = await import('./notebook-path.js')

    expect(notebookPathModule.NOTEBOOK_DIR).toBe(join(xdgDataHome, 'com.asf.shikin', 'notebook'))
  })

  it('does not create app-data or notebook directories when notebook modules are imported or listed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shikin-notebook-import-'))
    const homeDir = join(root, 'home')
    const xdgDataHome = join(root, 'data')
    tempDirs.add(root)
    mkdirSync(homeDir, { recursive: true })

    vi.stubEnv('HOME', homeDir)
    vi.stubEnv('XDG_DATA_HOME', xdgDataHome)
    vi.stubEnv('SHIKIN_RESPECT_XDG_DATA_HOME', '1')
    vi.resetModules()

    const [{ listNotes }, { NOTEBOOK_DIR: notebookDir }] = await Promise.all([
      import('./notebook.js'),
      import('./notebook-path.js'),
    ])
    expect(existsSync(join(xdgDataHome, 'com.asf.shikin'))).toBe(false)
    await expect(listNotes()).resolves.toEqual([])
    expect(existsSync(notebookDir)).toBe(false)
  })

  it('does not prepare notebook storage when the native binding prerequisite fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'shikin-notebook-abi-'))
    const dataHome = join(root, 'data')
    tempDirs.add(root)
    vi.stubEnv('HOME', join(root, 'home'))
    vi.stubEnv('XDG_DATA_HOME', dataHome)
    vi.stubEnv('SHIKIN_RESPECT_XDG_DATA_HOME', '1')
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

    const { writeNote } = await import('./notebook.js')
    await expect(writeNote('blocked.md', 'never written')).rejects.toThrow(
      /NODE_MODULE_VERSION mismatch/
    )
    expect(existsSync(join(dataHome, 'com.asf.shikin'))).toBe(false)
  })

  it('rejects notebook writes through symlinks inside the notebook directory', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'shikin-notebook-home-'))
    const xdgDataHome = mkdtempSync(join(tmpdir(), 'shikin-notebook-xdg-'))
    tempDirs.add(homeDir)
    tempDirs.add(xdgDataHome)

    vi.stubEnv('HOME', homeDir)
    vi.stubEnv('XDG_DATA_HOME', xdgDataHome)
    vi.resetModules()

    const [{ writeNote }, notebookPathModule] = await Promise.all([
      import('./notebook.js'),
      import('./notebook-path.js'),
    ])
    const outsideDir = join(homeDir, 'outside-notebook')
    const escapedFile = join(outsideDir, 'escape.md')
    mkdirSync(outsideDir, { recursive: true })
    mkdirSync(notebookPathModule.NOTEBOOK_DIR, { recursive: true })
    symlinkSync(outsideDir, join(notebookPathModule.NOTEBOOK_DIR, 'linked'), 'dir')

    await expect(writeNote('linked/escape.md', 'escaped')).rejects.toThrow('Path symlink detected')
    expect(existsSync(escapedFile)).toBe(false)
  })
})
