/**
 * Browser-compatible key-value storage using localStorage.
 * Drop-in replacement for @tauri-apps/plugin-store.
 * All methods are async to maintain the same interface as the Tauri Store.
 */

const STORAGE_PREFIX = 'valute:'

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
}

function createStore(): Store {
  return {
    async get(key: string): Promise<unknown> {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}${key}`)
      if (raw === null) return null
      try {
        return JSON.parse(raw)
      } catch {
        return raw
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      localStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(value))
    },

    async save(): Promise<void> {
      // no-op — localStorage persists automatically
    },
  }
}

/**
 * Load a store. The `_path` parameter is accepted for API compatibility
 * with the Tauri Store's `load('settings.json')` but is ignored since
 * we use a single localStorage namespace.
 */
export async function load(_path?: string): Promise<Store> {
  return createStore()
}
