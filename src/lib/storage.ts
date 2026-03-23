/**
 * Dual-backend key-value storage.
 *
 * - Tauri mode:  delegates to @tauri-apps/plugin-store (dynamic import)
 * - Browser mode: calls the bridge API server at DATA_SERVER_URL
 */

import { isTauri, DATA_SERVER_URL } from './runtime'

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
}

function createBrowserStore(): Store {
  return {
    async get(key: string): Promise<unknown> {
      try {
        const res = await fetch(
          `${DATA_SERVER_URL}/api/store/${encodeURIComponent(key)}`,
        )
        if (!res.ok) return null
        const data = await res.json()
        return data.value ?? null
      } catch {
        // Data server unreachable — degrade gracefully
        return null
      }
    },

    async set(key: string, value: unknown): Promise<void> {
      try {
        await fetch(
          `${DATA_SERVER_URL}/api/store/${encodeURIComponent(key)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
          },
        )
      } catch {
        // Data server unreachable — silently drop the write
      }
    },

    async save(): Promise<void> {
      // no-op — server persists immediately
    },
  }
}

async function createTauriStore(path?: string): Promise<Store> {
  // Dynamic import via Function() to avoid TS2307 when plugin-store types aren't installed
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { load: loadStore } = (await Function(
    'return import("@tauri-apps/plugin-store")',
  )()) as { load: (path: string, opts?: { autoSave?: boolean }) => Promise<any> }
  const store = await loadStore(path ?? 'settings.json', { autoSave: true })
  return {
    async get(key: string) {
      return store.get(key)
    },
    async set(key: string, value: unknown) {
      await store.set(key, value)
    },
    async save() {
      await store.save()
    },
  }
}

/**
 * Load a store. The `_path` parameter selects the Tauri store file
 * (defaults to 'settings.json'). In browser mode it is ignored since
 * the bridge API server manages its own persistence.
 */
export async function load(_path?: string): Promise<Store> {
  if (isTauri) {
    return createTauriStore(_path)
  }
  return createBrowserStore()
}
