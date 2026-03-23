export const isTauri =
  typeof window !== 'undefined' &&
  ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)

export const DATA_SERVER_URL = 'http://localhost:1480'
