import {
  appDataDir,
  join,
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  remove,
  exists,
} from '@/lib/virtual-fs'

const NOTEBOOK_DIR = 'notebook'

/**
 * Validates that a relative path does not escape the notebook directory boundary.
 * Prevents path traversal attacks like ../../../etc/passwd
 */
function validateRelativePath(relativePath: string): void {
  if (!relativePath || relativePath.trim().length === 0) {
    throw new Error('Path is required')
  }

  if (/^[a-zA-Z]:[\\/]/.test(relativePath) || relativePath.startsWith('\\\\')) {
    throw new Error('Absolute paths are not allowed')
  }

  // Reject absolute paths
  if (relativePath.startsWith('/')) {
    throw new Error('Absolute paths are not allowed')
  }

  // Reject paths that try to traverse up
  const normalized = relativePath.replace(/\\/g, '/')
  const parts = normalized.split('/').filter((p) => p.length > 0)

  let depth = 0
  for (const part of parts) {
    if (part === '..') {
      depth--
      if (depth < 0) {
        throw new Error('Path traversal detected: path escapes notebook boundary')
      }
    } else if (part !== '.' && part !== '') {
      depth++
    }
  }

  // Reject paths containing null bytes
  if (relativePath.includes('\0')) {
    throw new Error('Null bytes are not allowed in paths')
  }

  // Reject paths with suspicious patterns
  if (/\.\.[\\/]/.test(relativePath) || /[\\/]\.\./.test(relativePath)) {
    // Additional check for .. in the middle of paths
    const hasTraversal = parts.some((p) => p === '..')
    if (hasTraversal) {
      // Re-validate depth calculation for mixed paths
      const netDepth = parts.reduce((acc, p) => {
        if (p === '..') return acc - 1
        if (p === '.' || p === '') return acc
        return acc + 1
      }, 0)
      if (netDepth < 0) {
        throw new Error('Path traversal detected: path escapes notebook boundary')
      }
    }
  }
}

const DIRECTORIES = ['weekly-reviews', 'holdings', 'signals', 'education']

export async function getNotebookPath(): Promise<string> {
  const appData = await appDataDir()
  return await join(appData, NOTEBOOK_DIR)
}

export async function ensureDirectory(relativePath: string): Promise<void> {
  validateRelativePath(relativePath)
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
      `# Shikin Notebook\n\nThis notebook tracks investment insights, portfolio reviews, and educational notes.\n\n## Sections\n\n- **weekly-reviews/** — Automated portfolio performance reviews\n- **holdings/** — Per-symbol research and analysis notes\n- **signals/** — Congressional trades and market signals\n- **education/** — Financial concepts and explanations\n`
    )
  }
}

export async function readNote(relativePath: string): Promise<string> {
  validateRelativePath(relativePath)
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  return readTextFile(fullPath)
}

export async function writeNote(relativePath: string, content: string): Promise<void> {
  validateRelativePath(relativePath)
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
  validateRelativePath(relativePath)
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
  if (directory) {
    validateRelativePath(directory)
  }
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
  validateRelativePath(relativePath)
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  await remove(fullPath)
}

export async function noteExists(relativePath: string): Promise<boolean> {
  validateRelativePath(relativePath)
  const base = await getNotebookPath()
  const fullPath = await join(base, relativePath)
  return exists(fullPath)
}
