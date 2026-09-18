import { isAbsolute } from 'node:path'

export const REAL_DATA_OPT_IN = 'SHIKIN_BROWSER_USE_REAL_DATA'

export function shouldUseRealAppData(env = process.env) {
  return env[REAL_DATA_OPT_IN] === '1'
}

export function isolatedAppDataEnvironment(root, platform = process.platform) {
  if (platform !== 'darwin' && platform !== 'win32' && !isAbsolute(root)) {
    throw new Error('Linux/XDG development isolation requires an absolute temporary root')
  }

  if (platform === 'darwin') {
    return {
      HOME: root,
      SHIKIN_RESPECT_XDG_DATA_HOME: '0',
      SHIKIN_MIGRATE_LEGACY_DATA: '0',
    }
  }

  if (platform === 'win32') {
    return {
      APPDATA: root,
      USERPROFILE: root,
      SHIKIN_RESPECT_XDG_DATA_HOME: '0',
      SHIKIN_MIGRATE_LEGACY_DATA: '0',
    }
  }

  return {
    HOME: root,
    XDG_DATA_HOME: root,
    SHIKIN_RESPECT_XDG_DATA_HOME: '1',
    SHIKIN_MIGRATE_LEGACY_DATA: '0',
  }
}
