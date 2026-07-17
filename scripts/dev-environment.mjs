export const REAL_DATA_OPT_IN = 'SHIKIN_BROWSER_USE_REAL_DATA'

export function shouldUseRealAppData(env = process.env) {
  return env[REAL_DATA_OPT_IN] === '1'
}

export function isolatedAppDataEnvironment(root, platform = process.platform) {
  if (platform === 'darwin') {
    return { HOME: root }
  }

  if (platform === 'win32') {
    return { APPDATA: root }
  }

  return {
    XDG_DATA_HOME: root,
    SHIKIN_RESPECT_XDG_DATA_HOME: '1',
  }
}
