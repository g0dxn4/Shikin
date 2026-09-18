import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PRIVATE_FILE_MODE, ensurePrivateDirectory, hardenPathMode } from './app-data-dir.js'
import { NOTEBOOK_DIR, isSafeNotebookPathInput, resolveNotebookPath } from './notebook-path.js'
import { prepareStorageForWrite, validateNativeSqliteBinding } from './storage-context.js'

function writePrivateNoteFile(path: string, content: string, flag: 'w' | 'wx' | 'a' = 'w'): void {
  writeFileSync(path, content, { encoding: 'utf-8', mode: PRIVATE_FILE_MODE, flag })
  hardenPathMode(path, PRIVATE_FILE_MODE)
}

export async function readNote(relativePath: string): Promise<string> {
  return readFileSync(resolveNotebookPath(relativePath), 'utf-8')
}

function prepareNotebookWrite(relativePath: string): string {
  // Reject lexical traversal and probe the native binding before any storage
  // mutation. Resolve and check the final notebook path only after preparation
  // so migrated symlink components cannot bypass the confinement check.
  if (!isSafeNotebookPathInput(relativePath, { allowEmpty: true })) {
    throw new Error('Path traversal detected')
  }
  validateNativeSqliteBinding()
  prepareStorageForWrite()
  const fullPath = resolveNotebookPath(relativePath)
  ensurePrivateDirectory(NOTEBOOK_DIR)
  ensurePrivateDirectory(dirname(fullPath))
  return fullPath
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  writePrivateNoteFile(prepareNotebookWrite(relativePath), content)
}

export async function writeNoteIfAbsent(relativePath: string, content: string): Promise<boolean> {
  const fullPath = prepareNotebookWrite(relativePath)
  try {
    writePrivateNoteFile(fullPath, content, 'wx')
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  const fullPath = prepareNotebookWrite(relativePath)
  writePrivateNoteFile(fullPath, '\n' + content, 'a')
}

export async function noteExists(relativePath: string): Promise<boolean> {
  return existsSync(resolveNotebookPath(relativePath))
}

export async function listNotes(directory?: string): Promise<string[]> {
  const targetPath = directory ? resolveNotebookPath(directory) : NOTEBOOK_DIR
  if (!existsSync(targetPath)) return []
  const entries = readdirSync(targetPath, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const prefix = directory ? `${directory}/` : ''
    if (entry.isDirectory()) {
      results.push(`${prefix}${entry.name}/`)
    } else if (entry.name.endsWith('.md')) {
      results.push(`${prefix}${entry.name}`)
    }
  }
  return results.sort()
}
