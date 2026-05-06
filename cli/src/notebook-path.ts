import { lstatSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { prepareAppDataDir } from './app-data-dir.js'

const DATA_DIR = prepareAppDataDir()
export const NOTEBOOK_DIR = join(DATA_DIR, 'notebook')

export function isSafeNotebookPathInput(
  value: string,
  options?: { allowEmpty?: boolean }
): boolean {
  if (typeof value !== 'string') return false

  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return options?.allowEmpty === true
  }

  if (trimmed.includes('\0')) return false
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return false

  return !trimmed.split(/[\\/]+/).some((segment) => segment === '..')
}

function assertNoSymlinkComponents(resolvedBase: string, resolvedPath: string): void {
  try {
    const baseStats = lstatSync(resolvedBase)
    if (baseStats.isSymbolicLink() || !baseStats.isDirectory()) {
      throw new Error('Notebook directory is not a safe directory')
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return
    }
    throw error
  }

  const confinedPath = relative(resolvedBase, resolvedPath)
  if (!confinedPath) return

  let currentPath = resolvedBase
  for (const segment of confinedPath.split(/[\\/]+/)) {
    currentPath = resolve(currentPath, segment)
    try {
      const stats = lstatSync(currentPath)
      if (stats.isSymbolicLink()) {
        throw new Error('Path symlink detected')
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return
      }
      throw error
    }
  }
}

export function resolveNotebookPath(relativePath: string): string {
  if (!isSafeNotebookPathInput(relativePath, { allowEmpty: true })) {
    throw new Error('Path traversal detected')
  }

  const resolvedBase = resolve(NOTEBOOK_DIR)
  const resolvedPath = resolve(resolvedBase, relativePath || '.')
  const confinedPath = relative(resolvedBase, resolvedPath)

  if (confinedPath === '' || (!confinedPath.startsWith('..') && !isAbsolute(confinedPath))) {
    assertNoSymlinkComponents(resolvedBase, resolvedPath)
    return resolvedPath
  }

  throw new Error('Path traversal detected')
}
