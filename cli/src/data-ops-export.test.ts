// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }))

vi.mock('./database.js', () => ({
  query: mockQuery,
  execute: vi.fn(),
  transaction: <T>(callback: () => T): T => callback(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
}))

vi.mock('./ulid.js', () => ({ generateId: () => 'test-id' }))

import { dataOpsTools } from './tools/data-ops'

const exportData = dataOpsTools.find((tool) => tool.name === 'export-data')!

describe('export-data import provenance redaction', () => {
  beforeEach(() => mockQuery.mockReset())

  it('redacts canonical identity material, opaque external IDs, and original-row JSON only in redacted exports', async () => {
    const sensitiveDescription = 'SENTINEL private medical purchase'
    const opaqueExternalId = 'SENTINEL-OPAQUE-BANK-ID'
    const importFingerprint = JSON.stringify({
      version: 1,
      description: sensitiveDescription,
      externalId: opaqueExternalId,
    })
    const transaction = {
      id: 'tx-1',
      description: sensitiveDescription,
      import_source: 'statement:ofx',
      import_external_id: opaqueExternalId,
      import_fingerprint: importFingerprint,
      import_content_fingerprint: 'sha256:opaque-content-hash',
    }
    const originalRowJson = JSON.stringify({ description: sensitiveDescription })

    mockQuery.mockImplementation((sql?: string) => {
      if (sql?.includes('FROM transactions ')) return [transaction]
      if (sql?.includes('FROM audit_log ')) {
        return [{ id: 'audit-1', before_json: originalRowJson, after_json: originalRowJson }]
      }
      return []
    })

    const unredacted = await exportData.execute(
      exportData.schema.parse({ format: 'json', redacted: false })
    )
    expect(unredacted.data.transactions[0]).toMatchObject(transaction)
    expect(unredacted.data.audit_log[0]).toMatchObject({
      before_json: originalRowJson,
      after_json: originalRowJson,
    })

    const redacted = await exportData.execute(
      exportData.schema.parse({ format: 'json', redacted: true })
    )
    expect(redacted.data.transactions[0]).toMatchObject({
      description: '[REDACTED]',
      import_source: '[REDACTED]',
      import_external_id: '[REDACTED]',
      import_fingerprint: '[REDACTED]',
      import_content_fingerprint: 'sha256:opaque-content-hash',
    })
    expect(redacted.data.audit_log[0]).toMatchObject({
      before_json: '[REDACTED]',
      after_json: '[REDACTED]',
    })
    expect(JSON.stringify(redacted)).not.toContain(sensitiveDescription)
    expect(JSON.stringify(redacted)).not.toContain(opaqueExternalId)
  })
})
