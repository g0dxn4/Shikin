import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PRIVATE_FILE_MODE, ensurePrivateDirectory, hardenPathMode } from './app-data-dir.js'
import { NOTEBOOK_DIR, isSafeNotebookPathInput, resolveNotebookPath } from './notebook-path.js'
import { prepareStorageForWrite, validateNativeSqliteBinding } from './storage-context.js'

function writePrivateNoteFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf-8', mode: PRIVATE_FILE_MODE })
  hardenPathMode(path, PRIVATE_FILE_MODE)
}

export async function readNote(relativePath: string): Promise<string> {
  return readFileSync(resolveNotebookPath(relativePath), 'utf-8')
}

function prepareNotebookWrite(relativePath: string): string {
  // Reject lexical traversal before any storage mutation, while still probing the
  // native binding before filesystem-backed path checks or preparation.
  if (!isSafeNotebookPathInput(relativePath, { allowEmpty: true })) {
    throw new Error('Path traversal detected')
  }
  validateNativeSqliteBinding()
  const fullPath = resolveNotebookPath(relativePath)
  prepareStorageForWrite()
  ensurePrivateDirectory(NOTEBOOK_DIR)
  ensurePrivateDirectory(dirname(fullPath))
  return fullPath
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  writePrivateNoteFile(prepareNotebookWrite(relativePath), content)
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  validateNativeSqliteBinding()
  const fullPath = resolveNotebookPath(relativePath)
  let existing = ''
  try {
    existing = readFileSync(fullPath, 'utf-8')
  } catch {
    // Start a new note when the file does not exist yet.
  }
  prepareStorageForWrite()
  ensurePrivateDirectory(NOTEBOOK_DIR)
  ensurePrivateDirectory(dirname(fullPath))
  writePrivateNoteFile(fullPath, existing + '\n' + content)
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
