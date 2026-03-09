import { appDataDir, join } from '@tauri-apps/api/path'
import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  remove,
  exists,
} from '@tauri-apps/plugin-fs'

const NOTEBOOK_DIR = 'notebook'

const DIRECTORIES = [
  'weekly-reviews',
  'holdings',
  'signals',
  'education',
]

export async function getNotebookPath(): Promise<string> {
  const appData = await appDataDir()
  return await join(appData, NOTEBOOK_DIR)
}

export async function ensureDirectory(relativePath: string): Promise<void> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  if (!(await exists(fullPath))) {
    await mkdir(fullPath, { recursive: true })
  }
}

export async function initNotebook(): Promise<void> {
  const base = await getNotebookPath()
  if (!(await exists(base))) {
    await mkdir(base, { recursive: true })
  }

  for (const dir of DIRECTORIES) {
    const dirPath = await join(base, dir)
    if (!(await exists(dirPath))) {
      await mkdir(dirPath, { recursive: true })
    }
  }

  // Create index if it doesn't exist
  const indexPath = await join(base, 'index.md')
  if (!(await exists(indexPath))) {
    await writeTextFile(
      indexPath,
      `# Val's Notebook\n\nThis is Val's research notebook for tracking investment insights, portfolio reviews, and educational notes.\n\n## Sections\n\n- **weekly-reviews/** — Automated portfolio performance reviews\n- **holdings/** — Per-symbol research and analysis notes\n- **signals/** — Congressional trades and market signals\n- **education/** — Financial concepts and explanations\n`
    )
  }
}

export async function readNote(relativePath: string): Promise<string> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  return readTextFile(fullPath)
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)

  // Ensure parent directory exists
  const parts = relativePath.split('/')
  if (parts.length > 1) {
    const parentDir = parts.slice(0, -1).join('/')
    await ensureDirectory(parentDir)
  }

  await writeTextFile(fullPath, content)
}

export async function appendNote(relativePath: string, content: string): Promise<void> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)

  let existing = ''
  try {
    existing = await readTextFile(fullPath)
  } catch {
    // File doesn't exist yet
  }

  await writeTextFile(fullPath, existing + '\n' + content)
}

export async function listNotes(directory?: string): Promise<string[]> {
  const base = await getNotebookPath()
  const targetPath = directory ? await join(base, directory) : base

  if (!(await exists(targetPath))) return []

  const entries = await readDir(targetPath)
  const results: string[] = []

  for (const entry of entries) {
    const prefix = directory ? `${directory}/` : ''
    if (entry.isDirectory) {
      results.push(`${prefix}${entry.name}/`)
    } else if (entry.name.endsWith('.md')) {
      results.push(`${prefix}${entry.name}`)
    }
  }

  return results.sort()
}

export async function deleteNote(relativePath: string): Promise<void> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  await remove(fullPath)
}

export async function noteExists(relativePath: string): Promise<boolean> {
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  return exists(fullPath)
}
