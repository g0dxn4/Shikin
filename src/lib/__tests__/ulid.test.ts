import { describe, it, expect } from 'vitest'
import { generateId } from '../ulid'

describe('ULID generation', () => {
  it('generates a valid ULID string', () => {
    const id = generateId()
    expect(id).toHaveLength(26)
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  it('generates IDs with timestamp prefix', () => {
    const id = generateId()
    // ULID timestamp is first 10 chars (Crockford Base32)
    const timestampPart = id.substring(0, 10)
    expect(timestampPart).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/)
  })
})
