// @vitest-environment node
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  isDirectExecution,
  parseApplicationVersion,
  validateReleaseVersions,
} from './release-preflight.mjs'

const syncedVersions = {
  'package.json': '1.0.10',
  'cli/package.json': '1.0.10',
  'src-tauri/tauri.conf.json': '1.0.10',
  'src-tauri/Cargo.toml': '1.0.10',
  'src-tauri/Cargo.lock (package shikin)': '1.0.10',
  'cli/src/version.ts': '1.0.10',
}

describe('release preflight application version parsing', () => {
  it('parses the exported application version literal', () => {
    expect(parseApplicationVersion("export const APPLICATION_VERSION = '1.0.10'\n")).toBe('1.0.10')
  })

  it('rejects computed or renamed version exports', () => {
    expect(() =>
      parseApplicationVersion('export const APPLICATION_VERSION = getVersion()\n')
    ).toThrow('Could not locate literal APPLICATION_VERSION')
    expect(() => parseApplicationVersion("export const VERSION = '1.0.10'\n")).toThrow(
      'Could not locate literal APPLICATION_VERSION'
    )
  })
})

describe('release preflight version validation', () => {
  it('accepts synchronized semver sources and a matching tag', () => {
    expect(validateReleaseVersions(syncedVersions, '1.0.10')).toEqual({
      errors: [],
      uniqueVersions: ['1.0.10'],
    })
  })

  it('reports source and tag mismatches', () => {
    const sourceMismatch = validateReleaseVersions({
      ...syncedVersions,
      'cli/src/version.ts': '1.0.11',
    })
    const tagMismatch = validateReleaseVersions(syncedVersions, '1.0.11')

    expect(sourceMismatch.errors).toEqual([
      expect.stringContaining('Version mismatch detected across release files'),
    ])
    expect(sourceMismatch.errors[0]).toContain('cli/src/version.ts: 1.0.11')
    expect(tagMismatch.errors).toEqual([
      'Tag version mismatch: git tag is "1.0.11" but release files are "1.0.10"',
    ])
  })

  it('rejects a catalog contract identifier as application semver', () => {
    const result = validateReleaseVersions({
      'cli/src/version.ts': '2026-07-14.financial-semantics',
    })

    expect(result.errors).toEqual([
      'cli/src/version.ts has invalid semver version: "2026-07-14.financial-semantics"',
    ])
  })
})

describe('release preflight entry point guard', () => {
  it('distinguishes direct execution from module import', () => {
    const scriptPath = '/tmp/release-preflight.mjs'
    const scriptUrl = pathToFileURL(scriptPath).href

    expect(isDirectExecution(scriptUrl, scriptPath)).toBe(true)
    expect(isDirectExecution(import.meta.url, scriptPath)).toBe(false)
  })
})
