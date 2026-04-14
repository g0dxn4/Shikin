import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const DATA_DIR = join(homedir(), '.local', 'share', 'com.asf.shikin')
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

export function resolveNotebookPath(relativePath: string): string {
  if (!isSafeNotebookPathInput(relativePath, { allowEmpty: true })) {
    throw new Error('Path traversal detected')
  }

  const resolvedBase = resolve(NOTEBOOK_DIR)
  const resolvedPath = resolve(resolvedBase, relativePath || '.')
  const confinedPath = relative(resolvedBase, resolvedPath)

  if (confinedPath === '' || (!confinedPath.startsWith('..') && !isAbsolute(confinedPath))) {
    return resolvedPath
  }

  throw new Error('Path traversal detected')
}
