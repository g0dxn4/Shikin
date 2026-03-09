/**
 * Browser-compatible virtual filesystem backed by IndexedDB.
 * Replaces @tauri-apps/plugin-fs and @tauri-apps/api/path for browser use.
 *
 * Files are stored as key-value pairs where keys are virtual path strings
 * and values are file content strings. Directories are implicit — they exist
 * whenever a file exists under that prefix.
 */

const DB_NAME = 'valute-fs'
const DB_VERSION = 1
const STORE_NAME = 'files'

/** Virtual app data directory prefix. */
export const APP_DATA_DIR = '/valute/'

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  return dbPromise
}

function tx(
  mode: IDBTransactionMode
): Promise<{ store: IDBObjectStore; done: Promise<void> }> {
  return openDB().then((db) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    return { store, done }
  })
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// ── Path utilities (replace @tauri-apps/api/path) ──────────────────

/** Returns the virtual app data directory path. */
export async function appDataDir(): Promise<string> {
  return APP_DATA_DIR
}

/** Returns the virtual home directory path. */
export async function homeDir(): Promise<string> {
  return '/home/'
}

/** Joins path segments with '/', normalizing double slashes. */
export async function join(...parts: string[]): Promise<string> {
  return parts
    .join('/')
    .replace(/\/+/g, '/')
}

// ── Filesystem operations (replace @tauri-apps/plugin-fs) ──────────

/** Read a text file from the virtual filesystem. */
export async function readTextFile(path: string): Promise<string> {
  const { store } = await tx('readonly')
  const result = await idbRequest(store.get(path))
  if (result === undefined) {
    throw new Error(`File not found: ${path}`)
  }
  return result as string
}

/** Write a text file to the virtual filesystem. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  const { store, done } = await tx('readwrite')
  store.put(content, path)
  await done
}

/** Check whether a path exists (file or implicit directory). */
export async function exists(path: string): Promise<boolean> {
  const { store } = await tx('readonly')
  // Check exact file match
  const result = await idbRequest(store.get(path))
  if (result !== undefined) return true

  // Check if any key starts with this path as a directory prefix
  const prefix = path.endsWith('/') ? path : path + '/'
  const cursor = store.openKeyCursor(IDBKeyRange.bound(prefix, prefix + '\uffff'))
  const first = await idbRequest(cursor)
  return first !== null
}

/** Remove a file from the virtual filesystem. */
export async function remove(path: string): Promise<void> {
  const { store, done } = await tx('readwrite')
  store.delete(path)
  await done
}

export interface DirEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

/**
 * List entries in a virtual directory.
 * Returns immediate children only (files and sub-directory names).
 */
export async function readDir(path: string): Promise<DirEntry[]> {
  const prefix = path.endsWith('/') ? path : path + '/'
  const { store } = await tx('readonly')

  return new Promise<DirEntry[]>((resolve, reject) => {
    const entries = new Map<string, DirEntry>()
    const request = store.openKeyCursor(
      IDBKeyRange.bound(prefix, prefix + '\uffff')
    )

    request.onsuccess = () => {
      const cursor = request.result
      if (cursor) {
        const key = cursor.key as string
        const relative = key.slice(prefix.length)
        const slashIndex = relative.indexOf('/')

        if (slashIndex === -1) {
          // Direct child file
          entries.set(relative, {
            name: relative,
            isDirectory: false,
            isFile: true,
          })
        } else {
          // Child of a subdirectory — register the directory
          const dirName = relative.slice(0, slashIndex)
          if (!entries.has(dirName)) {
            entries.set(dirName, {
              name: dirName,
              isDirectory: true,
              isFile: false,
            })
          }
        }
        cursor.continue()
      } else {
        resolve(Array.from(entries.values()))
      }
    }

    request.onerror = () => reject(request.error)
  })
}

/**
 * Create a directory. This is a no-op in the virtual filesystem since
 * directories are implicit, but is provided for API compatibility.
 */
export async function mkdir(
  _path: string,
  _options?: { recursive?: boolean }
): Promise<void> {
  // Directories are implicit — nothing to do
}
