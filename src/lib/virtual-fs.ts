/**
 * Dual-backend virtual filesystem.
 *
 * - Tauri mode: delegates to @tauri-apps/plugin-fs and @tauri-apps/api/path
 * - Browser mode: calls the bridge API server at DATA_SERVER_URL
 *
 * Keeps the same exported API so consumers (notebook.ts, portfolio-review.ts)
 * work unchanged.
 */

import { isTauri, DATA_SERVER_URL, withDataServerHeaders } from '@/lib/runtime'

// ── Lazy Tauri imports (avoid bundling in browser builds) ───────────

const tauriPath = () => import('@tauri-apps/api/path')
// Dynamic import to avoid type errors when plugin-fs types aren't installed
interface TauriFsModule {
  readTextFile: (path: string) => Promise<string>
  writeTextFile: (path: string, content: string) => Promise<void>
  exists: (path: string) => Promise<boolean>
  readDir: (path: string) => Promise<DirEntry[]>
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  remove: (path: string, options?: { recursive?: boolean }) => Promise<void>
}

const tauriFs = (): Promise<TauriFsModule> =>
  Function('return import("@tauri-apps/plugin-fs")')() as Promise<TauriFsModule>

// ── Types ───────────────────────────────────────────────────────────

export interface DirEntry {
  name: string
  isDirectory: boolean
  isFile: boolean
}

// ── Path utilities ──────────────────────────────────────────────────

/** Returns the app data directory path. */
export async function appDataDir(): Promise<string> {
  if (isTauri) {
    const { appDataDir: tauriAppDataDir } = await tauriPath()
    return tauriAppDataDir()
  }

  const res = await fetch(`${DATA_SERVER_URL}/api/fs/appdata`, {
    headers: withDataServerHeaders(),
  })
  const data = await res.json()
  return data.path
}

/** Joins path segments. */
export async function join(...parts: string[]): Promise<string> {
  if (isTauri) {
    const { join: tauriJoin } = await tauriPath()
    return tauriJoin(...parts)
  }

  const params = new URLSearchParams()
  parts.forEach((p) => params.append('parts', p))
  const res = await fetch(`${DATA_SERVER_URL}/api/fs/join?${params}`, {
    headers: withDataServerHeaders(),
  })
  const data = await res.json()
  return data.path
}

// ── Filesystem operations ───────────────────────────────────────────

/** Read a text file. */
export async function readTextFile(path: string): Promise<string> {
  if (isTauri) {
    const { readTextFile: tauriRead } = await tauriFs()
    return tauriRead(path)
  }

  const res = await fetch(`${DATA_SERVER_URL}/api/fs/read?path=${encodeURIComponent(path)}`, {
    headers: withDataServerHeaders(),
  })
  if (!res.ok) throw new Error(`File not found: ${path}`)
  const data = await res.json()
  return data.content
}

/** Write a text file. */
export async function writeTextFile(path: string, content: string): Promise<void> {
  if (isTauri) {
    const { writeTextFile: tauriWrite } = await tauriFs()
    await tauriWrite(path, content)
    return
  }

  await fetch(`${DATA_SERVER_URL}/api/fs/write`, {
    method: 'PUT',
    headers: withDataServerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content }),
  })
}

/** Check whether a path exists. */
export async function exists(path: string): Promise<boolean> {
  if (isTauri) {
    const { exists: tauriExists } = await tauriFs()
    return tauriExists(path)
  }

  const res = await fetch(`${DATA_SERVER_URL}/api/fs/exists?path=${encodeURIComponent(path)}`, {
    headers: withDataServerHeaders(),
  })
  const data = await res.json()
  return data.exists
}

/** List entries in a directory. */
export async function readDir(path: string): Promise<DirEntry[]> {
  if (isTauri) {
    const { readDir: tauriReadDir } = await tauriFs()
    const entries = await tauriReadDir(path)
    // Tauri's DirEntry already has name, isDirectory, isFile
    return entries.map((e: DirEntry) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      isFile: e.isFile,
    }))
  }

  const res = await fetch(`${DATA_SERVER_URL}/api/fs/readdir?path=${encodeURIComponent(path)}`, {
    headers: withDataServerHeaders(),
  })
  if (!res.ok) return []
  const data = await res.json()
  // Bridge returns { name, isDirectory }; derive isFile
  return (data.entries as Array<{ name: string; isDirectory: boolean }>).map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory,
    isFile: !e.isDirectory,
  }))
}

/** Create a directory. */
export async function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  if (isTauri) {
    const { mkdir: tauriMkdir } = await tauriFs()
    await tauriMkdir(path, { recursive: options?.recursive })
    return
  }

  await fetch(`${DATA_SERVER_URL}/api/fs/mkdir`, {
    method: 'POST',
    headers: withDataServerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, recursive: options?.recursive }),
  })
}

/** Remove a file. */
export async function remove(path: string): Promise<void> {
  if (isTauri) {
    const { remove: tauriRemove } = await tauriFs()
    await tauriRemove(path)
    return
  }

  await fetch(`${DATA_SERVER_URL}/api/fs/remove?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: withDataServerHeaders(),
  })
}
