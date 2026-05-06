// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NOTEBOOK_DIR, isSafeNotebookPathInput, resolveNotebookPath } from './notebook-path.js'

const tempDirs = new Set<string>()

afterEach(() => {
  vi.unstubAllEnvs()
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
    symlinkSync(outsideDir, join(notebookPathModule.NOTEBOOK_DIR, 'linked'), 'dir')

    await expect(writeNote('linked/escape.md', 'escaped')).rejects.toThrow('Path symlink detected')
    expect(existsSync(escapedFile)).toBe(false)
  })
})
