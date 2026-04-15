/**
 * Dual-backend key-value storage.
 *
 * - Tauri mode:  delegates to @tauri-apps/plugin-store (dynamic import)
 * - Browser mode: calls the bridge API server at DATA_SERVER_URL
 */

import { isTauri, DATA_SERVER_URL, withDataServerHeaders } from './runtime'

export interface Store {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  save(): Promise<void>
}

function createErrorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown }
  error.cause = cause
  return error
}

async function browserStorageRequest(
  input: RequestInfo | URL,
  init: RequestInit,
  context: string
): Promise<Response> {
  let res: Response

  try {
    res = await fetch(input, init)
  } catch (err) {
    throw createErrorWithCause(
      `Cannot reach data server at ${DATA_SERVER_URL} while ${context}. ` +
        `Original error: ${err instanceof Error ? err.message : err}`,
      err
    )
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(
      `Storage request failed (${res.status}) while ${context}${text ? `: ${text}` : ''}`
    )
  }

  return res
}

function createBrowserStore(): Store {
  return {
    async get(key: string): Promise<unknown> {
      const res = await browserStorageRequest(
        `${DATA_SERVER_URL}/api/store/${encodeURIComponent(key)}`,
        {
          headers: withDataServerHeaders(),
        },
        `reading storage key "${key}"`
      )
      const data = await res.json()
      return data.value ?? null
    },

    async set(key: string, value: unknown): Promise<void> {
      await browserStorageRequest(
        `${DATA_SERVER_URL}/api/store/${encodeURIComponent(key)}`,
        {
          method: 'PUT',
          headers: withDataServerHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ value }),
        },
        `writing storage key "${key}"`
      )
    },

    async save(): Promise<void> {
      // no-op — server persists immediately
    },
  }
}

async function createTauriStore(path?: string): Promise<Store> {
  // Dynamic import via Function() to avoid TS2307 when plugin-store types aren't installed
  interface TauriStoreModule {
    load: (path: string, opts?: { autoSave?: boolean }) => Promise<TauriStore>
  }

  interface TauriStore {
    get: (key: string) => Promise<unknown> | unknown
    set: (key: string, value: unknown) => Promise<void> | void
    save: () => Promise<void> | void
  }

  const { load: loadStore } = (await Function(
    'return import("@tauri-apps/plugin-store")'
  )()) as TauriStoreModule
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
