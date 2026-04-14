import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { NOTEBOOK_DIR, resolveNotebookPath } from './notebook-path.js'

// Ensure notebook directory exists
mkdirSync(NOTEBOOK_DIR, { recursive: true })

export async function readNote(relativePath: string): Promise<string> {
  return readFileSync(resolveNotebookPath(relativePath), 'utf-8')
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  const fullPath = resolveNotebookPath(relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  const fullPath = resolveNotebookPath(relativePath)
  let existing = ''
  try {
    existing = readFileSync(fullPath, 'utf-8')
  } catch {
    // Start a new note when the file does not exist yet.
  }
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, existing + '\n' + content, 'utf-8')
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

export async function deleteNote(relativePath: string): Promise<void> {
  unlinkSync(resolveNotebookPath(relativePath))
}
