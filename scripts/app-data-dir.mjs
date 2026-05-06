import { homedir } from 'node:os'
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path'

export const SHIKIN_APP_ID = 'com.asf.shikin'
export const PRIVATE_DIR_MODE = 0o700
export const PRIVATE_FILE_MODE = 0o600
const DB_FILE_NAME = 'shikin.db'
const SQLITE_FILE_SUFFIXES = ['', '-wal', '-shm', '-journal']
const SQLITE_SIDECAR_SUFFIXES = SQLITE_FILE_SUFFIXES.slice(1)

function isAbsolutePath(path, platform) {
  return platform === 'win32' ? win32.isAbsolute(path) : isAbsolute(path)
}

function joinPath(platform, ...parts) {
  return platform === 'win32' ? win32.join(...parts) : join(...parts)
}

function dirnamePath(platform, path) {
  return platform === 'win32' ? win32.dirname(path) : dirname(path)
}

function resolvePath(platform, path) {
  return platform === 'win32' ? win32.resolve(path) : resolve(path)
}

function getHomeDir(env, platform = process.platform) {
  const configuredHome = platform === 'win32' ? env.USERPROFILE || env.HOME : env.HOME
  if (configuredHome && isAbsolutePath(configuredHome, platform)) {
    return configuredHome
  }

  return homedir()
}

export function getXdgDataHome(env = process.env) {
  const configuredDataHome = env.XDG_DATA_HOME
  if (configuredDataHome && isAbsolutePath(configuredDataHome, 'linux')) {
    return configuredDataHome
  }

  return joinPath('linux', getHomeDir(env, 'linux'), '.local', 'share')
}

function getXdgConfigHome(env = process.env) {
  const configuredConfigHome = env.XDG_CONFIG_HOME
  if (configuredConfigHome && isAbsolutePath(configuredConfigHome, 'linux')) {
    return configuredConfigHome
  }

  return joinPath('linux', getHomeDir(env, 'linux'), '.config')
}

function getPlatformDataHome(env, platform = process.platform) {
  if (platform === 'darwin') {
    return joinPath(platform, getHomeDir(env, platform), 'Library', 'Application Support')
  }

  if (platform === 'win32') {
    const configuredAppData = env.APPDATA
    if (configuredAppData && isAbsolutePath(configuredAppData, platform)) {
      return configuredAppData
    }

    return joinPath(platform, getHomeDir(env, platform), 'AppData', 'Roaming')
  }

  return getXdgDataHome(env)
}

export function getAppDataDir(env = process.env, platform = process.platform) {
  return joinPath(platform, getPlatformDataHome(env, platform), SHIKIN_APP_ID)
}

function getPlatformConfigHome(env, platform = process.platform) {
  if (platform === 'darwin' || platform === 'win32') {
    return getPlatformDataHome(env, platform)
  }

  return getXdgConfigHome(env)
}

function getAppConfigDir(env, platform = process.platform) {
  return joinPath(platform, getPlatformConfigHome(env, platform), SHIKIN_APP_ID)
}

function getLegacyAppDataDir(env, platform = process.platform) {
  return joinPath(platform, getHomeDir(env, platform), '.local', 'share', SHIKIN_APP_ID)
}

function isSamePath(left, right, platform) {
  return resolvePath(platform, left) === resolvePath(platform, right)
}

function isMissingOrEmptyDirectory(path) {
  if (!existsSync(path)) return true

  const stats = lstatSync(path)
  return stats.isDirectory() && !stats.isSymbolicLink() && readdirSync(path).length === 0
}

function formatMigrationError(error) {
  return error instanceof Error ? error.message : String(error)
}

function moveDirectory(source, target) {
  try {
    renameSync(source, target)
    return
  } catch (error) {
    if (error?.code !== 'EXDEV') {
      throw error
    }
  }

  const tempTarget = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    cpSync(source, tempTarget, { recursive: true, errorOnExist: true })
    renameSync(tempTarget, target)
    rmSync(source, { recursive: true, force: true })
  } catch (error) {
    rmSync(tempTarget, { recursive: true, force: true })
    throw error
  }
}

function sqliteFamilyMembers(sourceDir, targetDir, targetName) {
  return SQLITE_FILE_SUFFIXES.map((suffix) => ({
    source: join(sourceDir, `${DB_FILE_NAME}${suffix}`),
    target: join(targetDir, `${targetName}${suffix}`),
  })).filter((member) => existsSync(member.source))
}

function removeSqliteSidecars(dir, fileName) {
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    rmSync(join(dir, `${fileName}${suffix}`), { force: true })
  }
}

function moveSqliteFamily(sourceDir, targetDir, targetName) {
  const members = sqliteFamilyMembers(sourceDir, targetDir, targetName)
  if (!members.some((member) => member.source.endsWith(DB_FILE_NAME))) return

  const existingTarget = members.find((member) => existsSync(member.target))
  if (existingTarget) {
    throw new Error(`target SQLite file already exists: ${existingTarget.target}`)
  }

  const stamp = `${process.pid}-${Date.now()}`
  const stagedMembers = members.map((member) => ({
    ...member,
    temp: `${member.target}.tmp-${stamp}`,
  }))
  const promotedTargets = []

  try {
    for (const member of stagedMembers) {
      cpSync(member.source, member.temp, { errorOnExist: true })
      hardenPathMode(member.temp, PRIVATE_FILE_MODE)
    }

    for (const member of stagedMembers) {
      renameSync(member.temp, member.target)
      promotedTargets.push(member.target)
      hardenPathMode(member.target, PRIVATE_FILE_MODE)
    }
  } catch (error) {
    for (const member of stagedMembers) {
      rmSync(member.temp, { force: true })
    }
    for (const promotedTarget of promotedTargets) {
      rmSync(promotedTarget, { force: true })
    }
    throw error
  }

  for (const member of stagedMembers) {
    try {
      rmSync(member.source, { force: true })
    } catch (error) {
      console.warn(
        `[storage] Migrated ${member.source}, but could not remove the legacy source file: ${formatMigrationError(error)}`
      )
    }
  }
}

function migrateLegacySqliteFamily(legacyAppDataDir, appDataDir) {
  const legacyDbPath = join(legacyAppDataDir, DB_FILE_NAME)
  if (!existsSync(legacyDbPath)) return

  ensurePrivateDirectory(appDataDir)

  const appDataDbPath = join(appDataDir, DB_FILE_NAME)
  if (existsSync(appDataDbPath)) {
    const backupName = `${DB_FILE_NAME}.legacy-backup-${Date.now()}`
    console.warn(
      `[storage] Both legacy and app data databases exist; preserving legacy database as ${backupName}`
    )
    moveSqliteFamily(legacyAppDataDir, appDataDir, backupName)
    return
  }

  removeSqliteSidecars(appDataDir, DB_FILE_NAME)
  moveSqliteFamily(legacyAppDataDir, appDataDir, DB_FILE_NAME)
}

function migrateLegacyAppDataDir(env, platform = process.platform) {
  const appDataDir = getAppDataDir(env, platform)
  const legacyAppDataDir = getLegacyAppDataDir(env, platform)

  if (!isSamePath(appDataDir, legacyAppDataDir, platform) && existsSync(legacyAppDataDir)) {
    try {
      mkdirSync(dirnamePath(platform, appDataDir), { recursive: true, mode: PRIVATE_DIR_MODE })

      if (isMissingOrEmptyDirectory(appDataDir)) {
        if (existsSync(appDataDir)) {
          rmdirSync(appDataDir)
        }
        moveDirectory(legacyAppDataDir, appDataDir)
      } else {
        migrateLegacySqliteFamily(legacyAppDataDir, appDataDir)
      }
    } catch (error) {
      console.warn(
        `[storage] Could not migrate legacy app data directory to app data: ${formatMigrationError(error)}`
      )
    }
  }

  return appDataDir
}

function migrateAppConfigSqliteFamily(env, appDataDir, platform = process.platform) {
  const appConfigDir = getAppConfigDir(env, platform)
  if (isSamePath(appConfigDir, appDataDir, platform)) return

  const appConfigDbPath = join(appConfigDir, DB_FILE_NAME)
  if (!existsSync(appConfigDbPath)) return

  try {
    ensurePrivateDirectory(appDataDir)

    const appDataDbPath = join(appDataDir, DB_FILE_NAME)
    if (existsSync(appDataDbPath)) {
      const backupName = `${DB_FILE_NAME}.app-config-backup-${Date.now()}`
      console.warn(
        `[storage] Both AppConfig and app data databases exist; preserving AppConfig database as ${backupName}`
      )
      moveSqliteFamily(appConfigDir, appDataDir, backupName)
      return
    }

    removeSqliteSidecars(appDataDir, DB_FILE_NAME)
    moveSqliteFamily(appConfigDir, appDataDir, DB_FILE_NAME)
  } catch (error) {
    console.warn(
      `[storage] Could not migrate AppConfig database to app data: ${formatMigrationError(error)}`
    )
  }
}

export function hardenPathMode(path, mode) {
  try {
    chmodSync(path, mode)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return
    }
    if (process.platform !== 'win32') {
      throw error
    }
  }
}

export function ensurePrivateDirectory(path) {
  try {
    mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE })
  } catch (error) {
    if (error?.code !== 'EEXIST') {
      throw error
    }
  }

  const stats = lstatSync(path)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Refusing to use non-directory app data path: ${path}`)
  }

  hardenPathMode(path, PRIVATE_DIR_MODE)
}

export function prepareAppDataDir(env = process.env, platform = process.platform) {
  const appDataDir = migrateLegacyAppDataDir(env, platform)
  migrateAppConfigSqliteFamily(env, appDataDir, platform)
  ensurePrivateDirectory(appDataDir)
  return appDataDir
}
