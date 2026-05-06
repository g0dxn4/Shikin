// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { SHIKIN_APP_ID, getAppDataDir, getXdgDataHome, prepareAppDataDir } from './app-data-dir.js'

const tempDirs: string[] = []

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('XDG app data directory', () => {
  it('stores app data under absolute XDG_DATA_HOME when configured', () => {
    const xdgDataHome = '/tmp/shikin-xdg-data-home'

    expect(getXdgDataHome({ HOME: '/home/example', XDG_DATA_HOME: xdgDataHome })).toBe(xdgDataHome)
    expect(getAppDataDir({ HOME: '/home/example', XDG_DATA_HOME: xdgDataHome })).toBe(
      join(xdgDataHome, SHIKIN_APP_ID)
    )
  })

  it('falls back to HOME/.local/share when XDG_DATA_HOME is unset or empty', () => {
    expect(getXdgDataHome({ HOME: '/home/example' })).toBe('/home/example/.local/share')
    expect(getXdgDataHome({ HOME: '/home/example', XDG_DATA_HOME: '' })).toBe(
      '/home/example/.local/share'
    )
  })

  it('ignores relative XDG_DATA_HOME values per the XDG spec', () => {
    expect(getXdgDataHome({ HOME: '/home/example', XDG_DATA_HOME: 'relative/data' })).toBe(
      '/home/example/.local/share'
    )
  })

  it('falls back to node homedir when HOME is not absolute', () => {
    expect(getXdgDataHome({ HOME: 'relative-home', XDG_DATA_HOME: '' })).toBe(
      join(homedir(), '.local', 'share')
    )
  })

  it('matches Tauri app data locations on macOS and Windows', () => {
    expect(getAppDataDir({ HOME: '/Users/example' }, 'darwin')).toBe(
      '/Users/example/Library/Application Support/com.asf.shikin'
    )
    expect(
      getAppDataDir(
        { APPDATA: 'C:\\Users\\example\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\example' },
        'win32'
      )
    ).toBe(win32.join('C:\\Users\\example\\AppData\\Roaming', SHIKIN_APP_ID))
  })

  it('moves legacy HOME data into a newly configured XDG data home', () => {
    const homeDir = createTempDir('shikin-home-')
    const xdgDataHome = createTempDir('shikin-xdg-data-')
    const legacyDir = join(homeDir, '.local', 'share', SHIKIN_APP_ID)
    const expectedDir = join(xdgDataHome, SHIKIN_APP_ID)
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(legacyDir, 'shikin.db'), 'legacy database')

    expect(prepareAppDataDir({ HOME: homeDir, XDG_DATA_HOME: xdgDataHome })).toBe(expectedDir)
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('legacy database')
    expect(statSync(expectedDir).mode & 0o777).toBe(0o700)
  })

  it('hardens an existing app data directory', () => {
    const homeDir = createTempDir('shikin-home-')
    const appDataDir = join(homeDir, '.local', 'share', SHIKIN_APP_ID)
    mkdirSync(appDataDir, { recursive: true })
    chmodSync(appDataDir, 0o755)

    expect(prepareAppDataDir({ HOME: homeDir, XDG_DATA_HOME: '' })).toBe(appDataDir)
    expect(statSync(appDataDir).mode & 0o777).toBe(0o700)
  })

  it('moves the legacy sqlite family into a non-empty app data directory when the target db is absent', () => {
    const homeDir = createTempDir('shikin-home-')
    const xdgDataHome = createTempDir('shikin-xdg-data-')
    const legacyDir = join(homeDir, '.local', 'share', SHIKIN_APP_ID)
    const expectedDir = join(xdgDataHome, SHIKIN_APP_ID)
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(expectedDir, 'settings.json'), '{}')
    writeFileSync(join(expectedDir, 'shikin.db-wal'), 'orphaned wal')
    writeFileSync(join(expectedDir, 'shikin.db-journal'), 'orphaned journal')
    writeFileSync(join(legacyDir, 'shikin.db'), 'legacy database')
    writeFileSync(join(legacyDir, 'shikin.db-wal'), 'legacy wal')
    writeFileSync(join(legacyDir, 'shikin.db-journal'), 'legacy journal')

    expect(prepareAppDataDir({ HOME: homeDir, XDG_DATA_HOME: xdgDataHome })).toBe(expectedDir)
    expect(readFileSync(join(expectedDir, 'settings.json'), 'utf-8')).toBe('{}')
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('legacy database')
    expect(readFileSync(join(expectedDir, 'shikin.db-wal'), 'utf-8')).toBe('legacy wal')
    expect(readFileSync(join(expectedDir, 'shikin.db-journal'), 'utf-8')).toBe('legacy journal')
    expect(existsSync(join(legacyDir, 'shikin.db'))).toBe(false)
  })

  it('moves the legacy Tauri AppConfig sqlite family into app data when no app data db exists', () => {
    const homeDir = createTempDir('shikin-home-')
    const xdgDataHome = createTempDir('shikin-xdg-data-')
    const xdgConfigHome = createTempDir('shikin-xdg-config-')
    const appConfigDir = join(xdgConfigHome, SHIKIN_APP_ID)
    const expectedDir = join(xdgDataHome, SHIKIN_APP_ID)
    mkdirSync(appConfigDir, { recursive: true })
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(expectedDir, 'settings.json'), '{}')
    writeFileSync(join(expectedDir, 'shikin.db-shm'), 'orphaned shm')
    writeFileSync(join(appConfigDir, 'shikin.db'), 'app config database')
    writeFileSync(join(appConfigDir, 'shikin.db-journal'), 'app config journal')

    expect(
      prepareAppDataDir({
        HOME: homeDir,
        XDG_DATA_HOME: xdgDataHome,
        XDG_CONFIG_HOME: xdgConfigHome,
      })
    ).toBe(expectedDir)
    expect(readFileSync(join(expectedDir, 'settings.json'), 'utf-8')).toBe('{}')
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('app config database')
    expect(readFileSync(join(expectedDir, 'shikin.db-journal'), 'utf-8')).toBe('app config journal')
    expect(existsSync(join(expectedDir, 'shikin.db-shm'))).toBe(false)
    expect(existsSync(join(appConfigDir, 'shikin.db'))).toBe(false)
  })

  it('does not back up the active database when app config and app data paths match', () => {
    const homeDir = createTempDir('shikin-home-')
    const appDataDir = join(homeDir, 'Library', 'Application Support', SHIKIN_APP_ID)
    mkdirSync(appDataDir, { recursive: true })
    writeFileSync(join(appDataDir, 'shikin.db'), 'current database')

    expect(prepareAppDataDir({ HOME: homeDir }, 'darwin')).toBe(appDataDir)
    expect(readFileSync(join(appDataDir, 'shikin.db'), 'utf-8')).toBe('current database')
    expect(
      readdirSync(appDataDir).some((name) => name.startsWith('shikin.db.app-config-backup-'))
    ).toBe(false)
  })

  it('preserves a legacy sqlite family as a backup when the app data db already exists', () => {
    const homeDir = createTempDir('shikin-home-')
    const xdgDataHome = createTempDir('shikin-xdg-data-')
    const legacyDir = join(homeDir, '.local', 'share', SHIKIN_APP_ID)
    const expectedDir = join(xdgDataHome, SHIKIN_APP_ID)
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(expectedDir, 'shikin.db'), 'current database')
    writeFileSync(join(legacyDir, 'shikin.db'), 'legacy database')

    expect(prepareAppDataDir({ HOME: homeDir, XDG_DATA_HOME: xdgDataHome })).toBe(expectedDir)
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('current database')
    const backupName = readdirSync(expectedDir).find((name) =>
      name.startsWith('shikin.db.legacy-backup-')
    )
    expect(backupName).toBeDefined()
    expect(readFileSync(join(expectedDir, backupName || ''), 'utf-8')).toBe('legacy database')
    expect(existsSync(join(legacyDir, 'shikin.db'))).toBe(false)
  })
})
