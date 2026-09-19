import { describe, expect, it } from 'vitest'
import {
  canonicalImportFinancialContent,
  importContentFingerprint,
  importPlanToken,
  prepareImportIdentities,
  sha256Fingerprint,
} from './imports.js'

const base = {
  accountId: 'account-1',
  sourceNamespace: 'Bank Feed',
  externalId: '001-AbC',
  date: '2026-04-01',
  type: 'expense' as const,
  amountCentavos: 1234,
  currency: 'usd',
  transferToAccountId: null,
}

describe('import identity and content contracts', () => {
  it('uses a known SHA-256 vector and versioned fingerprints', () => {
    expect(sha256Fingerprint('abc')).toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
    expect(importPlanToken({ stable: true })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('keeps exact opaque external IDs and case-sensitive source scopes', () => {
    const [first] = prepareImportIdentities([{ ...base, description: 'Editable label' }], [base])
    const [differentId] = prepareImportIdentities(
      [{ ...base, externalId: '1-AbC', description: 'Editable label' }],
      [{ ...base, externalId: '1-AbC' }]
    )
    const [differentSource] = prepareImportIdentities(
      [{ ...base, sourceNamespace: 'bank Feed', description: 'Editable label' }],
      [{ ...base, sourceNamespace: 'bank Feed' }]
    )
    expect(first.identityKey).not.toBe(differentId.identityKey)
    expect(first.identityKey).not.toBe(differentSource.identityKey)
  })

  it('separates financial content from editable metadata', () => {
    const material = canonicalImportFinancialContent(base)
    expect(material).not.toContain('description')
    expect(importContentFingerprint(base)).toBe(importContentFingerprint({ ...base }))
    expect(importContentFingerprint(base)).not.toBe(
      importContentFingerprint({ ...base, amountCentavos: 1235 })
    )
  })

  it('preserves multiplicity for fallback rows', () => {
    const identityRows = [0, 1].map(() => ({
      ...base,
      externalId: null,
      description: 'Same source row',
    }))
    const financialRows = [0, 1].map(() => ({ ...base, externalId: null }))
    const prepared = prepareImportIdentities(identityRows, financialRows)
    expect(prepared[0].identityKey).not.toBe(prepared[1].identityKey)
    expect(prepared[0].contentFingerprint).toBe(prepared[1].contentFingerprint)
  })
})
