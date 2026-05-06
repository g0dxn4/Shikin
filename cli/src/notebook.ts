import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PRIVATE_FILE_MODE, ensurePrivateDirectory, hardenPathMode } from './app-data-dir.js'
import { NOTEBOOK_DIR, resolveNotebookPath } from './notebook-path.js'

// Ensure notebook directory exists
ensurePrivateDirectory(NOTEBOOK_DIR)

function writePrivateNoteFile(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf-8', mode: PRIVATE_FILE_MODE })
  hardenPathMode(path, PRIVATE_FILE_MODE)
}

export async function readNote(relativePath: string): Promise<string> {
  return readFileSync(resolveNotebookPath(relativePath), 'utf-8')
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  const fullPath = resolveNotebookPath(relativePath)
  ensurePrivateDirectory(dirname(fullPath))
  writePrivateNoteFile(fullPath, content)
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  const fullPath = resolveNotebookPath(relativePath)
  let existing = ''
  try {
    existing = readFileSync(fullPath, 'utf-8')
  } catch {
    // Start a new note when the file does not exist yet.
  }
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
