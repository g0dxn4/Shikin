import { describe, expect, it } from 'vitest'
import {
  canonicalImportFinancialContent,
  existingImportEvidenceFingerprint,
  hasDistinctSameSourceExternalIdentity,
  importContentFingerprint,
  importPlanToken,
  matchesImportReviewDecision,
  prepareImportIdentities,
  sha256Fingerprint,
  type ExistingImportEvidence,
  type ImportReviewDecision,
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

describe('persisted import review primitives', () => {
  const evidence: ExistingImportEvidence = {
    id: 'existing-1',
    accountId: 'account-1',
    sourceNamespace: null,
    externalId: null,
    identityFingerprint: null,
    contentFingerprint: null,
    type: 'expense',
    amountCentavos: 1000,
    currency: 'USD',
    date: '2026-07-13',
    transferToAccountId: null,
    updatedAt: '2026-07-13T12:00:00.000Z',
  }

  it('preserves the existing adapter evidence fingerprint bytes', () => {
    expect(existingImportEvidenceFingerprint(evidence)).toBe(
      'sha256:746d0043f0e5b42b9205b11a099f4030b78d0b510a2300029d17b116a0b70d7c'
    )
    expect(
      existingImportEvidenceFingerprint({
        ...evidence,
        sourceNamespace: ' Other Source ',
        externalId: ' 001-AbC ',
        identityFingerprint: 'opaque:Identity/Ω',
        contentFingerprint: 'sha256:ContentCase',
      })
    ).toBe('sha256:91a9b126ad314182cd952cf92c41d670ae099d6c03107512a94a251b029ef9ee')
  })

  it.each([
    [null, 'sha256:c662c42dda6aa918443e707cccf0f76f657dd45c1837069e273617e8444e4387'],
    ['', 'sha256:4fda2f394e65e310139166e47008a79e21a2562c1bbc67f6758ba714b4f1f280'],
    [' ', 'sha256:91415d26306c5c41c1884f0017cdfa26d3df152216d20241d07f2562aacd324d'],
  ])('keeps updatedAt %j distinct in evidence', (updatedAt, expected) => {
    expect(existingImportEvidenceFingerprint({ ...evidence, updatedAt })).toBe(expected)
  })

  it.each([
    [' Bank Feed ', '001-AbC', 'Bank Feed', '1-AbC', true],
    ['Bank Feed', ' 001-AbC ', ' Bank Feed ', '001-AbC', true],
    ['Bank Feed', '001-AbC', 'bank Feed', '1-AbC', false],
    ['Bank Feed', '001-AbC', 'Bank Feed', '001-AbC', false],
    [null, '001-AbC', 'Bank Feed', '1-AbC', false],
    [' ', '001-AbC', 'Bank Feed', '1-AbC', false],
    ['Bank Feed', null, 'Bank Feed', '1-AbC', false],
    ['Bank Feed', '', 'Bank Feed', '1-AbC', false],
    ['Bank Feed', ' \t', 'Bank Feed', '1-AbC', false],
    ['Bank Feed', '001-AbC', 'Bank Feed', null, false],
    ['Bank Feed', '001-AbC', 'Bank Feed', ' \t', false],
    ['Bank Feed', '001-AbC', ' \t', '1-AbC', false],
  ] as const)(
    'checks same-source distinct IDs for %j/%j and %j/%j',
    (existingSource, existingId, source, externalId, expected) => {
      expect(
        hasDistinctSameSourceExternalIdentity(existingSource, existingId, source, externalId)
      ).toBe(expected)
    }
  )

  const decision: ImportReviewDecision = {
    candidateIdentityKey: 'identity',
    candidateContentFingerprint: 'content',
    existingTransactionId: 'existing-1',
    existingEvidenceFingerprint: 'evidence',
    decision: 'keep_existing',
  }

  it('matches all four fields independently of the selected decision', () => {
    expect(
      matchesImportReviewDecision(decision, 'identity', 'content', 'existing-1', 'evidence')
    ).toBe(true)
    expect(
      matchesImportReviewDecision(
        { ...decision, decision: 'distinct' },
        'identity',
        'content',
        'existing-1',
        'evidence'
      )
    ).toBe(true)
  })

  it.each([
    'candidateIdentityKey',
    'candidateContentFingerprint',
    'existingTransactionId',
    'existingEvidenceFingerprint',
  ] as const)('rejects a mismatched %s', (field) => {
    expect(
      matchesImportReviewDecision(
        { ...decision, [field]: 'stale' },
        'identity',
        'content',
        'existing-1',
        'evidence'
      )
    ).toBe(false)
  })
})
