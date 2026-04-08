import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

const DATA_DIR = join(homedir(), '.local', 'share', 'com.asf.shikin')
const NOTEBOOK_DIR = join(DATA_DIR, 'notebook')

// Ensure notebook directory exists
mkdirSync(NOTEBOOK_DIR, { recursive: true })

export async function readNote(relativePath: string): Promise<string> {
  return readFileSync(join(NOTEBOOK_DIR, relativePath), 'utf-8')
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  const fullPath = join(NOTEBOOK_DIR, relativePath)
  mkdirSync(dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content, 'utf-8')
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  const fullPath = join(NOTEBOOK_DIR, relativePath)
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
  return existsSync(join(NOTEBOOK_DIR, relativePath))
}

export async function listNotes(directory?: string): Promise<string[]> {
  const targetPath = directory ? join(NOTEBOOK_DIR, directory) : NOTEBOOK_DIR
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
  unlinkSync(join(NOTEBOOK_DIR, relativePath))
}
