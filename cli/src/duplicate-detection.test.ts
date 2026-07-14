import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('./database.js', () => ({ query: mockQuery }))

import { findTransactionDuplicate } from './duplicate-detection.js'

const existing = {
  id: 'existing-1',
  account_id: 'account-1',
  date: '2026-05-01',
  amount: 12_00,
  type: 'expense' as const,
  status: 'posted' as const,
  transfer_to_account_id: null,
  description: 'Cafe purchase',
  source: 'statement-import',
  note: 'externalId=statement-row-1',
}

describe('transaction duplicate provenance', () => {
  beforeEach(() => mockQuery.mockReset())

  it('suppresses duplicate suspicion when statement external IDs differ', () => {
    mockQuery.mockReturnValue([existing])

    const result = findTransactionDuplicate({
      accountId: 'account-1',
      date: '2026-05-01',
      amountCentavos: 12_00,
      type: 'expense',
      status: 'posted',
      description: 'Cafe purchase',
      source: 'statement-import',
      note: 'externalId=statement-row-2',
    })

    expect(result.match).toBeNull()
  })

  it('reports the matching evidence when external IDs agree', () => {
    mockQuery.mockReturnValue([existing])

    const result = findTransactionDuplicate({
      accountId: 'account-1',
      date: '2026-05-01',
      amountCentavos: 12_00,
      type: 'expense',
      status: 'posted',
      description: 'Cafe purchase',
      source: 'statement-import',
      note: 'externalId=statement-row-1',
    })

    expect(result.match).toMatchObject({
      kind: 'exact_duplicate',
      signals: expect.arrayContaining([
        'same_account',
        'same_amount',
        'same_date',
        'same_normalized_description',
        'same_external_id',
      ]),
      provenance: {
        candidateSource: 'statement-import',
        existingSource: 'statement-import',
        candidateExternalIds: ['statement-row-1'],
        existingExternalIds: ['statement-row-1'],
      },
    })
  })

  it('keeps duplicate suspicion when distinct external IDs come from different sources', () => {
    mockQuery.mockReturnValue([{ ...existing, source: 'provider-b' }])

    const result = findTransactionDuplicate({
      accountId: 'account-1',
      date: '2026-05-01',
      amountCentavos: 12_00,
      type: 'expense',
      status: 'posted',
      description: 'Cafe purchase',
      source: 'provider-a',
      note: 'externalId=provider-a-row-2',
    })

    expect(result.match?.kind).toBe('exact_duplicate')
  })
})
