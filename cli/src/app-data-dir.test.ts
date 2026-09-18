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
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  SHIKIN_APP_ID,
  createStorageContext,
  getAppDataDir,
  getXdgDataHome,
  prepareAppDataDir,
} from './app-data-dir.js'

const tempDirs: string[] = []
const sqliteFileSuffixes = ['', '-wal', '-shm', '-journal']

type PrepareResult = { appDataDir: string } | { error: string }

interface SyntheticRoots {
  root: string
  home: string
  config: string
  data: string
  userProfile: string
  appData: string
}

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

function createSyntheticRoots(): SyntheticRoots {
  const root = createTempDir('shikin-app-data-test-')
  const roots = {
    root,
    home: join(root, 'home'),
    config: join(root, 'config'),
    data: join(root, 'data'),
    userProfile: join(root, 'user-profile'),
    appData: join(root, 'app-data'),
  }

  for (const dir of [roots.home, roots.config, roots.data, roots.userProfile, roots.appData]) {
    mkdirSync(dir, { recursive: true })
  }

  return roots
}

function syntheticEnv(roots: SyntheticRoots, overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    HOME: roots.home,
    XDG_CONFIG_HOME: roots.config,
    XDG_DATA_HOME: roots.data,
    USERPROFILE: roots.userProfile,
    APPDATA: roots.appData,
    SHIKIN_RESPECT_XDG_DATA_HOME: '',
    ...overrides,
  }
}

function writeMarkerFamily(dir: string, marker: string): void {
  mkdirSync(dir, { recursive: true })
  for (const suffix of sqliteFileSuffixes) {
    writeFileSync(join(dir, `shikin.db${suffix}`), `${marker}${suffix}`)
  }
}

function expectMarkerFamily(dir: string, marker: string): void {
  for (const suffix of sqliteFileSuffixes) {
    expect(readFileSync(join(dir, `shikin.db${suffix}`), 'utf-8')).toBe(`${marker}${suffix}`)
  }
}

function capturePrepareAppDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = 'linux'
): PrepareResult {
  try {
    return { appDataDir: prepareAppDataDir(env, platform) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

function prepareScriptAppDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = 'linux'
): PrepareResult {
  const scriptUrl = new URL('../../scripts/app-data-dir.mjs', import.meta.url).href
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { prepareAppDataDir } from ${JSON.stringify(scriptUrl)}; try { process.stdout.write(JSON.stringify({ appDataDir: prepareAppDataDir(process.env, ${JSON.stringify(platform)}) })) } catch (error) { process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }`,
    ],
    {
      encoding: 'utf-8',
      env: {
        HOME: env.HOME ?? '',
        XDG_CONFIG_HOME: env.XDG_CONFIG_HOME ?? '',
        XDG_DATA_HOME: env.XDG_DATA_HOME ?? '',
        USERPROFILE: env.USERPROFILE ?? '',
        APPDATA: env.APPDATA ?? '',
        SHIKIN_RESPECT_XDG_DATA_HOME: env.SHIKIN_RESPECT_XDG_DATA_HOME ?? '',
        SHIKIN_MIGRATE_LEGACY_DATA: env.SHIKIN_MIGRATE_LEGACY_DATA ?? '',
      },
    }
  )

  return JSON.parse(output) as PrepareResult
}

function prepareGuardedScriptAppDataDir(
  platform: 'darwin' | 'win32',
  roots: SyntheticRoots
): PrepareResult {
  const scriptUrl = new URL('../../scripts/app-data-dir.mjs', import.meta.url).href
  const output = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import { prepareAppDataDir } from ${JSON.stringify(scriptUrl)}; const env = new Proxy({ SHIKIN_RESPECT_XDG_DATA_HOME: '1', SHIKIN_MIGRATE_LEGACY_DATA: '' }, { get(target, property, receiver) { if (property !== 'SHIKIN_RESPECT_XDG_DATA_HOME' && property !== 'SHIKIN_MIGRATE_LEGACY_DATA') throw new Error('Unexpected environment access: ' + String(property)); return Reflect.get(target, property, receiver) } }); try { process.stdout.write(JSON.stringify({ appDataDir: prepareAppDataDir(env, ${JSON.stringify(platform)}) })) } catch (error) { process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }`,
    ],
    {
      encoding: 'utf-8',
      env: {
        HOME: roots.home,
        XDG_CONFIG_HOME: roots.config,
        XDG_DATA_HOME: roots.data,
        USERPROFILE: roots.userProfile,
        APPDATA: roots.appData,
        SHIKIN_RESPECT_XDG_DATA_HOME: '',
      },
    }
  )

  return JSON.parse(output) as PrepareResult
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

  it('applies custom-root migration policy consistently across pure platform contexts', () => {
    const linuxCustom = createStorageContext(
      {
        HOME: '/home/example',
        XDG_DATA_HOME: '/srv/shikin-data',
      },
      'linux'
    )
    expect(linuxCustom).toMatchObject({ isCustomDataRoot: true, allowLegacyMigration: false })

    const windowsStandard = createStorageContext(
      {
        USERPROFILE: 'C:\\Users\\example',
        APPDATA: 'C:\\Users\\example\\AppData\\Roaming',
      },
      'win32'
    )
    expect(windowsStandard).toMatchObject({
      isCustomDataRoot: false,
      allowLegacyMigration: true,
    })

    const windowsCustom = createStorageContext(
      {
        USERPROFILE: 'C:\\Users\\example',
        APPDATA: 'D:\\ShikinData',
      },
      'win32'
    )
    expect(windowsCustom).toMatchObject({ isCustomDataRoot: true, allowLegacyMigration: false })

    const windowsApproved = createStorageContext(
      {
        USERPROFILE: 'C:\\Users\\example',
        APPDATA: 'D:\\ShikinData',
        SHIKIN_MIGRATE_LEGACY_DATA: '1',
      },
      'win32'
    )
    expect(windowsApproved.allowLegacyMigration).toBe(true)

    const macos = createStorageContext({ HOME: '/Users/example' }, 'darwin')
    expect(macos).toMatchObject({ isCustomDataRoot: false, allowLegacyMigration: true })
  })

  it('moves legacy HOME data into a newly configured XDG data home', () => {
    const homeDir = createTempDir('shikin-home-')
    const xdgDataHome = createTempDir('shikin-xdg-data-')
    const legacyDir = join(homeDir, '.local', 'share', SHIKIN_APP_ID)
    const expectedDir = join(xdgDataHome, SHIKIN_APP_ID)
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(expectedDir, { recursive: true })
    writeFileSync(join(legacyDir, 'shikin.db'), 'legacy database')

    expect(
      prepareAppDataDir({
        HOME: homeDir,
        XDG_DATA_HOME: xdgDataHome,
        SHIKIN_MIGRATE_LEGACY_DATA: '1',
      })
    ).toBe(expectedDir)
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('legacy database')
    expect(statSync(expectedDir).mode & 0o777).toBe(0o700)
  })

  it('respects valid explicit XDG isolation in both helpers without moving marker families', () => {
    const roots = createSyntheticRoots()
    const env = syntheticEnv(roots, { SHIKIN_RESPECT_XDG_DATA_HOME: '1' })
    const legacyDir = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
    const appConfigDir = join(roots.config, SHIKIN_APP_ID)
    const expectedDir = join(roots.data, SHIKIN_APP_ID)
    writeMarkerFamily(legacyDir, 'legacy')
    writeMarkerFamily(appConfigDir, 'app-config')

    const directResult = capturePrepareAppDataDir(env)
    const scriptResult = prepareScriptAppDataDir(env)

    expect(directResult).toEqual({ appDataDir: expectedDir })
    expect(scriptResult).toEqual(directResult)
    expectMarkerFamily(legacyDir, 'legacy')
    expectMarkerFamily(appConfigDir, 'app-config')
    expect(existsSync(join(expectedDir, 'shikin.db'))).toBe(false)
    expect(statSync(expectedDir).mode & 0o777).toBe(0o700)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['relative', 'relative-test-root'],
  ])(
    'rejects %s XDG_DATA_HOME before either helper can migrate marker families',
    (_description, xdgDataHome) => {
      const roots = createSyntheticRoots()
      const env = syntheticEnv(roots, {
        XDG_DATA_HOME: xdgDataHome,
        SHIKIN_RESPECT_XDG_DATA_HOME: '1',
      })
      const appConfigDir = join(roots.config, SHIKIN_APP_ID)
      const fallbackTarget = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
      const configuredTarget = join(roots.data, SHIKIN_APP_ID)
      writeMarkerFamily(appConfigDir, 'app-config')

      const directResult = capturePrepareAppDataDir(env)
      const scriptResult = prepareScriptAppDataDir(env)

      expect(directResult).toEqual({
        error:
          'SHIKIN_RESPECT_XDG_DATA_HOME=1 requires XDG_DATA_HOME to be a nonempty absolute path',
      })
      expect(scriptResult).toEqual(directResult)
      expectMarkerFamily(appConfigDir, 'app-config')
      expect(existsSync(fallbackTarget)).toBe(false)
      expect(existsSync(configuredTarget)).toBe(false)
    }
  )

  it.each(['true', '2', ' 1 '])(
    'rejects invalid isolation flag value %j before either helper touches storage',
    (configuredValue) => {
      const roots = createSyntheticRoots()
      const env = syntheticEnv(roots, {
        SHIKIN_RESPECT_XDG_DATA_HOME: configuredValue,
      })
      const legacyDir = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
      const appConfigDir = join(roots.config, SHIKIN_APP_ID)
      const configuredTarget = join(roots.data, SHIKIN_APP_ID)
      writeMarkerFamily(legacyDir, 'legacy')
      writeMarkerFamily(appConfigDir, 'app-config')

      const directResult = capturePrepareAppDataDir(env)
      const scriptResult = prepareScriptAppDataDir(env)

      expect(directResult).toEqual({
        error: `SHIKIN_RESPECT_XDG_DATA_HOME must be unset, empty, "0", or "1"; received ${JSON.stringify(configuredValue)}`,
      })
      expect(scriptResult).toEqual(directResult)
      expectMarkerFamily(legacyDir, 'legacy')
      expectMarkerFamily(appConfigDir, 'app-config')
      expect(existsSync(configuredTarget)).toBe(false)
    }
  )

  it.each(['darwin', 'win32'] as const)(
    'rejects explicit XDG isolation on %s before reading any platform path',
    (platform) => {
      const roots = createSyntheticRoots()
      const accessedKeys: PropertyKey[] = []
      const env = new Proxy(
        {
          SHIKIN_RESPECT_XDG_DATA_HOME: '1',
          SHIKIN_MIGRATE_LEGACY_DATA: '',
        } as NodeJS.ProcessEnv,
        {
          get(target, property, receiver) {
            accessedKeys.push(property)
            if (
              property !== 'SHIKIN_RESPECT_XDG_DATA_HOME' &&
              property !== 'SHIKIN_MIGRATE_LEGACY_DATA'
            ) {
              throw new Error(`Unexpected environment access: ${String(property)}`)
            }
            return Reflect.get(target, property, receiver)
          },
        }
      )

      const expectedResult = {
        error: `SHIKIN_RESPECT_XDG_DATA_HOME=1 is supported only on XDG platforms; received platform ${platform}`,
      }
      expect(capturePrepareAppDataDir(env, platform)).toEqual(expectedResult)
      expect(prepareGuardedScriptAppDataDir(platform, roots)).toEqual(expectedResult)
      expect(accessedKeys).toEqual(['SHIKIN_RESPECT_XDG_DATA_HOME', 'SHIKIN_MIGRATE_LEGACY_DATA'])
    }
  )

  it.each(['', '0'])(
    'migrates AppConfig into a custom root only with explicit approval when isolation is %j',
    (configuredValue) => {
      const roots = createSyntheticRoots()
      const env = syntheticEnv(roots, {
        SHIKIN_RESPECT_XDG_DATA_HOME: configuredValue,
      })
      const appConfigDir = join(roots.config, SHIKIN_APP_ID)
      const expectedDir = join(roots.data, SHIKIN_APP_ID)
      writeMarkerFamily(appConfigDir, 'app-config')

      expect(prepareAppDataDir({ ...env, SHIKIN_MIGRATE_LEGACY_DATA: '1' })).toBe(expectedDir)
      expectMarkerFamily(expectedDir, 'app-config')
      for (const suffix of sqliteFileSuffixes) {
        expect(existsSync(join(appConfigDir, `shikin.db${suffix}`))).toBe(false)
      }
    }
  )

  it('skips every legacy source for an unapproved custom root in both helpers', () => {
    const roots = createSyntheticRoots()
    const env = syntheticEnv(roots)
    const legacyDir = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
    const appConfigDir = join(roots.config, SHIKIN_APP_ID)
    const expectedDir = join(roots.data, SHIKIN_APP_ID)
    writeMarkerFamily(legacyDir, 'legacy')
    writeMarkerFamily(appConfigDir, 'app-config')

    const directResult = capturePrepareAppDataDir(env)
    const scriptResult = prepareScriptAppDataDir(env)

    expect(directResult).toEqual({ appDataDir: expectedDir })
    expect(scriptResult).toEqual(directResult)
    expectMarkerFamily(legacyDir, 'legacy')
    expectMarkerFamily(appConfigDir, 'app-config')
    expect(existsSync(join(expectedDir, 'shikin.db'))).toBe(false)
  })

  it.each(['true', '2', ' 1 '])(
    'rejects invalid legacy migration approval %j without touching marker families',
    (configuredValue) => {
      const roots = createSyntheticRoots()
      const env = syntheticEnv(roots, { SHIKIN_MIGRATE_LEGACY_DATA: configuredValue })
      const legacyDir = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
      writeMarkerFamily(legacyDir, 'legacy')

      const expected = {
        error: `SHIKIN_MIGRATE_LEGACY_DATA must be unset, empty, "0", or "1"; received ${JSON.stringify(configuredValue)}`,
      }
      expect(capturePrepareAppDataDir(env)).toEqual(expected)
      expect(prepareScriptAppDataDir(env)).toEqual(expected)
      expectMarkerFamily(legacyDir, 'legacy')
    }
  )

  it('rejects conflicting isolation and migration approval before filesystem access', () => {
    const roots = createSyntheticRoots()
    const env = syntheticEnv(roots, {
      SHIKIN_RESPECT_XDG_DATA_HOME: '1',
      SHIKIN_MIGRATE_LEGACY_DATA: '1',
    })
    const legacyDir = join(roots.home, '.local', 'share', SHIKIN_APP_ID)
    writeMarkerFamily(legacyDir, 'legacy')

    const expected = {
      error: 'SHIKIN_RESPECT_XDG_DATA_HOME=1 conflicts with SHIKIN_MIGRATE_LEGACY_DATA=1',
    }
    expect(capturePrepareAppDataDir(env)).toEqual(expected)
    expect(prepareScriptAppDataDir(env)).toEqual(expected)
    expectMarkerFamily(legacyDir, 'legacy')
  })

  it('resolves strict isolation without falling back to the host home directory', () => {
    const env = new Proxy(
      {
        SHIKIN_RESPECT_XDG_DATA_HOME: '1',
        SHIKIN_MIGRATE_LEGACY_DATA: '',
        XDG_DATA_HOME: '/tmp/shikin-isolated-no-home-read',
      } as NodeJS.ProcessEnv,
      {
        get(target, property, receiver) {
          if (!Reflect.has(target, property)) {
            throw new Error(`Unexpected environment access: ${String(property)}`)
          }
          return Reflect.get(target, property, receiver)
        },
      }
    )

    const context = createStorageContext(env, 'linux')
    expect(context.appDataDir).toBe('/tmp/shikin-isolated-no-home-read/com.asf.shikin')
    expect(context.appConfigDir).toBe(context.appDataDir)
    expect(context.legacyAppDataDir).toBe(context.appDataDir)
  })

  it('creates an immutable pure context without creating its selected directory', () => {
    const roots = createSyntheticRoots()
    const selectedRoot = join(roots.root, 'pure-context-root')
    const context = createStorageContext(
      syntheticEnv(roots, { XDG_DATA_HOME: selectedRoot, SHIKIN_RESPECT_XDG_DATA_HOME: '1' })
    )

    expect(Object.isFrozen(context)).toBe(true)
    expect(context.appDataDir).toBe(join(selectedRoot, SHIKIN_APP_ID))
    expect(existsSync(context.appDataDir)).toBe(false)
  })

  it('preserves ordinary AppConfig migration at the standard XDG data root', () => {
    const roots = createSyntheticRoots()
    const standardDataHome = join(roots.home, '.local', 'share')
    const env = syntheticEnv(roots, { XDG_DATA_HOME: standardDataHome })
    const appConfigDir = join(roots.config, SHIKIN_APP_ID)
    const expectedDir = join(standardDataHome, SHIKIN_APP_ID)
    writeMarkerFamily(appConfigDir, 'app-config')

    expect(prepareAppDataDir(env)).toBe(expectedDir)
    expectMarkerFamily(expectedDir, 'app-config')
    expect(existsSync(join(appConfigDir, 'shikin.db'))).toBe(false)
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

    expect(
      prepareAppDataDir({
        HOME: homeDir,
        XDG_DATA_HOME: xdgDataHome,
        SHIKIN_MIGRATE_LEGACY_DATA: '1',
      })
    ).toBe(expectedDir)
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
        SHIKIN_MIGRATE_LEGACY_DATA: '1',
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

    expect(
      prepareAppDataDir({
        HOME: homeDir,
        XDG_DATA_HOME: xdgDataHome,
        SHIKIN_MIGRATE_LEGACY_DATA: '1',
      })
    ).toBe(expectedDir)
    expect(readFileSync(join(expectedDir, 'shikin.db'), 'utf-8')).toBe('current database')
    const backupName = readdirSync(expectedDir).find((name) =>
      name.startsWith('shikin.db.legacy-backup-')
    )
    expect(backupName).toBeDefined()
    expect(readFileSync(join(expectedDir, backupName || ''), 'utf-8')).toBe('legacy database')
    expect(existsSync(join(legacyDir, 'shikin.db'))).toBe(false)
  })
})
