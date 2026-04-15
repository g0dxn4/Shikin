import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock virtual-fs before importing notebook
const mockJoin = vi.fn(async (...parts: string[]) => parts.join('/'))
const mockReadTextFile = vi.fn()
const mockWriteTextFile = vi.fn()
const mockReadDir = vi.fn()
const mockMkdir = vi.fn()
const mockRemove = vi.fn()
const mockExists = vi.fn()
const mockAppDataDir = vi.fn(async () => '/app/data')

vi.mock('@/lib/virtual-fs', () => ({
  appDataDir: mockAppDataDir,
  join: mockJoin,
  readTextFile: mockReadTextFile,
  writeTextFile: mockWriteTextFile,
  readDir: mockReadDir,
  mkdir: mockMkdir,
  remove: mockRemove,
  exists: mockExists,
}))

// Import after mocking
const { readNote, writeNote, appendNote, deleteNote, noteExists, listNotes, ensureDirectory } =
  await import('@/lib/notebook')

describe('notebook path validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExists.mockResolvedValue(false)
  })

  describe('path traversal prevention', () => {
    it('rejects absolute paths', async () => {
      await expect(readNote('/etc/passwd')).rejects.toThrow('Absolute paths are not allowed')
    })

    it('revents simple parent directory traversal', async () => {
      await expect(readNote('../secret.txt')).rejects.toThrow(
        'Path traversal detected: path escapes notebook boundary'
      )
    })

    it('rejects chained parent directory traversal', async () => {
      await expect(readNote('../../../etc/passwd')).rejects.toThrow(
        'Path traversal detected: path escapes notebook boundary'
      )
    })

    it('rejects mixed valid and invalid traversal', async () => {
      await expect(readNote('notes/../../secret.txt')).rejects.toThrow(
        'Path traversal detected: path escapes notebook boundary'
      )
    })

    it('rejects backslash-based traversal', async () => {
      await expect(readNote('..\\..\\windows\\system32\\secret.txt')).rejects.toThrow(
        'Path traversal detected: path escapes notebook boundary'
      )
    })

    it('allows safe current directory references', async () => {
      mockExists.mockResolvedValue(true)
      mockReadTextFile.mockResolvedValue('content')

      await expect(readNote('./notes.txt')).resolves.toBe('content')
    })

    it('allows valid nested paths', async () => {
      mockExists.mockResolvedValue(true)
      mockReadDir.mockResolvedValue([])

      await expect(listNotes('weekly-reviews')).resolves.toEqual([])
    })

    it('allows single-level paths', async () => {
      mockExists.mockResolvedValue(true)
      mockReadTextFile.mockResolvedValue('content')

      await expect(readNote('notes.txt')).resolves.toBe('content')
    })

    it('rejects null bytes in paths', async () => {
      await expect(readNote('notes\0.txt')).rejects.toThrow('Null bytes are not allowed in paths')
    })
  })

  describe('path validation coverage', () => {
    it('validates paths in writeNote', async () => {
      await expect(writeNote('../../secret.txt', 'content')).rejects.toThrow(
        'Path traversal detected'
      )
    })

    it('validates paths in appendNote', async () => {
      await expect(appendNote('../../../etc/passwd', 'content')).rejects.toThrow(
        'Path traversal detected'
      )
    })

    it('validates paths in deleteNote', async () => {
      await expect(deleteNote('../important.txt')).rejects.toThrow('Path traversal detected')
    })

    it('validates paths in noteExists', async () => {
      await expect(noteExists('/absolute/path.txt')).rejects.toThrow(
        'Absolute paths are not allowed'
      )
    })

    it('validates paths in ensureDirectory', async () => {
      await expect(ensureDirectory('../../secret')).rejects.toThrow('Path traversal detected')
    })

    it('validates directory parameter in listNotes', async () => {
      await expect(listNotes('../secret')).rejects.toThrow('Path traversal detected')
    })

    it('allows listNotes without directory parameter', async () => {
      mockExists.mockResolvedValue(true)
      mockReadDir.mockResolvedValue([])

      await expect(listNotes()).resolves.toEqual([])
    })
  })

  describe('edge cases', () => {
    it('handles paths with multiple slashes', async () => {
      mockExists.mockResolvedValue(true)
      mockReadDir.mockResolvedValue([])

      await expect(listNotes('weekly-reviews//2024')).resolves.toEqual([])
    })

    it('handles paths with dots but no traversal', async () => {
      mockExists.mockResolvedValue(true)
      mockReadTextFile.mockResolvedValue('content')

      await expect(readNote('notes.v1.txt')).resolves.toBe('content')
    })

    it('allows deep nesting within boundary', async () => {
      mockExists.mockResolvedValue(true)
      mockWriteTextFile.mockResolvedValue(undefined)

      await expect(
        writeNote('education/deep/nested/path/within/boundary.md', 'content')
      ).resolves.toBeUndefined()
    })
  })
})
