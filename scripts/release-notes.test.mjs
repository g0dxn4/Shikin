// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractReleaseNotes,
  normalizeReleaseVersion,
  writeGitHubOutput,
} from './release-notes.mjs'

const changelog = `# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

### Added

- Pending work that must not appear in a tagged release.

## [1.1.0] - 2026-09-20

### Added

- Changelog notes on the GitHub release page.

### Fixed

- Updater \`latest.json\` notes were boilerplate.

## [1.0.10] - 2026-05-19

### Added

- Historical notes that must stay in their own section.
`

const tempDirs = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'shikin-release-notes-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('normalizeReleaseVersion', () => {
  it('strips a leading v from tags and trims whitespace', () => {
    expect(normalizeReleaseVersion('v1.1.0')).toBe('1.1.0')
    expect(normalizeReleaseVersion(' 1.1.0 ')).toBe('1.1.0')
  })

  it('rejects a missing tag/version', () => {
    expect(() => normalizeReleaseVersion('')).toThrow('Release tag/version is required')
    expect(() => normalizeReleaseVersion(undefined)).toThrow('Release tag/version is required')
  })
})

describe('extractReleaseNotes', () => {
  it('extracts the Keep a Changelog section for a requested tag', () => {
    const notes = extractReleaseNotes(changelog, 'v1.1.0')

    expect(notes).toBe(
      `### Added

- Changelog notes on the GitHub release page.

### Fixed

- Updater \`latest.json\` notes were boilerplate.`
    )
    expect(notes).not.toContain('Pending work')
    expect(notes).not.toContain('Historical notes')
    expect(notes).not.toContain('## [1.0.10]')
    expect(notes).not.toContain('## [1.1.0]')
  })

  it('matches a heading without a date and does not treat ### as a boundary', () => {
    const notes = extractReleaseNotes(
      `## [1.2.0]

### Added

- Still the 1.2.0 section.

## [1.1.0] - 2026-09-20

- Older release.
`,
      '1.2.0'
    )

    expect(notes).toContain('Still the 1.2.0 section.')
    expect(notes).not.toContain('Older release.')
  })

  it('does not treat a longer version as the requested section', () => {
    expect(() =>
      extractReleaseNotes(
        `## [1.1.10] - 2026-09-21

- Patch ten.

## [1.1.0] - 2026-09-20

- One one zero.
`,
        '1.1.0'
      )
    ).not.toThrow()

    expect(
      extractReleaseNotes(
        `## [1.1.10] - 2026-09-21

- Patch ten.

## [1.1.0] - 2026-09-20

- One one zero.
`,
        '1.1.0'
      )
    ).toBe('- One one zero.')
  })

  it('fails when the version section is missing', () => {
    expect(() => extractReleaseNotes(changelog, '1.2.0')).toThrow(
      'CHANGELOG.md has no section for version 1.2.0'
    )
  })

  it('fails when the version section is empty', () => {
    expect(() =>
      extractReleaseNotes(
        `## [1.1.0] - 2026-09-20

## [1.0.10] - 2026-05-19

- Older notes.
`,
        'v1.1.0'
      )
    ).toThrow('CHANGELOG.md section for version 1.1.0 is empty')
  })
})

describe('writeGitHubOutput', () => {
  it('writes a multiline value with a random heredoc delimiter', () => {
    const file = join(tempDir(), 'github_output')
    writeFileSync(file, 'previous=1\n')

    const delimiter = writeGitHubOutput(file, 'body', 'line 1\nline 2')
    const written = readFileSync(file, 'utf8')

    expect(delimiter).toMatch(/^ghadelim_[a-f0-9]{32}$/)
    expect(written).toBe(`previous=1\nbody<<${delimiter}\nline 1\nline 2\n${delimiter}\n`)
  })

  it('retries until the delimiter is not present in the value', () => {
    const file = join(tempDir(), 'github_output')
    const delimiters = ['ghadelim_collision', 'ghadelim_uniqueok']

    const delimiter = writeGitHubOutput(file, 'body', 'notes with ghadelim_collision inside', () =>
      delimiters.shift()
    )

    expect(delimiter).toBe('ghadelim_uniqueok')
    expect(readFileSync(file, 'utf8')).toBe(
      'body<<ghadelim_uniqueok\nnotes with ghadelim_collision inside\nghadelim_uniqueok\n'
    )
  })
})
