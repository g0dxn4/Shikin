import { describe, expect, it } from 'vitest'
import {
  assignStatementOccurrenceOrdinals,
  canonicalStatementIdentityMaterial,
  type StatementIdentityInput,
} from './statement-fingerprint.js'

const base: StatementIdentityInput = {
  accountId: 'account-1',
  sourceNamespace: 'bank.example/checking-feed',
  date: '2026-05-04',
  type: 'expense',
  amountCentavos: 1_299,
  currency: 'mxn',
  description: '  Coffee   Shop ',
}

describe('canonical statement identity material', () => {
  it('uses only account, source namespace, and exact external ID for external identity', () => {
    const first = canonicalStatementIdentityMaterial({
      ...base,
      externalId: ' bank-row-7 ',
      occurrenceOrdinal: 3,
    })
    const reclassified = canonicalStatementIdentityMaterial({
      ...base,
      type: 'income',
      currency: 'USD',
      description: 'a corrected description',
      externalId: ' bank-row-7 ',
      occurrenceOrdinal: 99,
    })

    expect(first).toEqual(reclassified)
    expect(first).toMatchObject({ strategy: 'external_id', externalId: ' bank-row-7 ' })
    expect(first.canonicalMaterial).toContain('"sourceNamespace":"bank.example/checking-feed"')
    expect(first.canonicalMaterial).toContain('"externalId":" bank-row-7 "')
    expect(first.canonicalMaterial).not.toContain('"type"')
    expect(first.canonicalMaterial).not.toContain('"currency"')

    expect(
      canonicalStatementIdentityMaterial({
        ...base,
        sourceNamespace: 'another-provider',
        externalId: ' bank-row-7 ',
      }).canonicalMaterial
    ).not.toBe(first.canonicalMaterial)
  })

  it('centrally groups fallback rows and preserves duplicate occurrences', () => {
    const duplicate = { ...base }
    const other = { ...base, description: 'Groceries', amountCentavos: 2_500 }
    const assignments = assignStatementOccurrenceOrdinals([base, duplicate, other])

    expect(assignments.map(({ occurrenceOrdinal }) => occurrenceOrdinal)).toEqual([0, 1, 0])
    expect(assignments[0]?.fallbackGroupCanonicalMaterial).toBe(
      assignments[1]?.fallbackGroupCanonicalMaterial
    )
    expect(assignments[2]?.fallbackGroupCanonicalMaterial).not.toBe(
      assignments[0]?.fallbackGroupCanonicalMaterial
    )
  })

  it('keeps the fallback identity multiset stable when statement rows are reordered', () => {
    const rows: StatementIdentityInput[] = [
      base,
      { ...base },
      { ...base, description: 'Groceries', amountCentavos: 2_500 },
    ]
    const reordered = [rows[2]!, rows[0]!, rows[1]!]

    expect(fallbackMaterials(rows)).toEqual(fallbackMaterials(reordered))
  })

  it('includes type and currency in fallback material and reports missing ordinals', () => {
    const assignment = assignStatementOccurrenceOrdinals([base])[0]!
    const material = canonicalStatementIdentityMaterial({
      ...base,
      occurrenceOrdinal: assignment.occurrenceOrdinal,
    })
    expect(material).toMatchObject({ strategy: 'occurrence_ordinal', occurrenceOrdinal: 0 })
    expect(material.canonicalMaterial).toContain('"description":"coffee shop"')
    expect(material.canonicalMaterial).toContain('"type":"expense"')
    expect(material.canonicalMaterial).toContain('"currency":"MXN"')
    expect(material.canonicalMaterial).toContain('"occurrenceOrdinal":0')

    const reclassified = canonicalStatementIdentityMaterial({
      ...base,
      type: 'income',
      occurrenceOrdinal: assignment.occurrenceOrdinal,
    })
    expect(reclassified.canonicalMaterial).not.toBe(material.canonicalMaterial)

    expect(canonicalStatementIdentityMaterial(base)).toEqual({
      strategy: 'unresolved',
      reason: 'missing_external_id_and_occurrence_ordinal',
      canonicalMaterial: null,
    })
  })
})

function fallbackMaterials(rows: StatementIdentityInput[]): string[] {
  const assignments = assignStatementOccurrenceOrdinals(rows)
  return rows
    .map(
      (row, index) =>
        canonicalStatementIdentityMaterial({
          ...row,
          occurrenceOrdinal: assignments[index]!.occurrenceOrdinal,
        }).canonicalMaterial
    )
    .filter((material): material is string => material !== null)
    .sort()
}
