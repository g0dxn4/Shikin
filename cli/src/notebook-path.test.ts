// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { NOTEBOOK_DIR, isSafeNotebookPathInput, resolveNotebookPath } from './notebook-path.js'

describe('notebook path security', () => {
  it('keeps note paths confined to the notebook directory', () => {
    expect(resolveNotebookPath('holdings/AAPL.md')).toBe(`${NOTEBOOK_DIR}/holdings/AAPL.md`)
    expect(() => resolveNotebookPath('../notebook-evil/AAPL.md')).toThrow('Path traversal detected')
    expect(() => resolveNotebookPath('/etc/passwd')).toThrow('Path traversal detected')
  })

  it('rejects unsafe notebook tool path inputs before filesystem access', () => {
    expect(isSafeNotebookPathInput('weekly-reviews/2026-04-14.md')).toBe(true)
    expect(isSafeNotebookPathInput('../outside.md')).toBe(false)
    expect(isSafeNotebookPathInput('C:\\temp\\outside.md')).toBe(false)
  })
})
