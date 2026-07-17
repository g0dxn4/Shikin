// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  aggregateCentavosByCurrency,
  calculateSignedLedgerDeltas,
  type LedgerAccountContext,
} from '@shikin/finance-core'

const account: LedgerAccountContext = {
  accountId: 'smoke-account',
  currency: 'MXN',
  accountMode: 'transactional',
}

describe('@shikin/finance-core package consumption', () => {
  it('exposes declarations to CLI TypeScript without importing package source', () => {
    expect(aggregateCentavosByCurrency([{ currency: 'mxn', amountCentavos: 125 }])).toEqual([
      { currency: 'MXN', amountCentavos: 125 },
    ])
    expect(
      calculateSignedLedgerDeltas({ type: 'income', amountCentavos: 125, currency: 'MXN', account })
    ).toMatchObject({ status: 'applied' })
    expect(
      readFileSync(resolve(process.cwd(), 'packages/finance-core/dist/index.d.ts'), 'utf8')
    ).toContain("export * from './ledger.js'")
  })

  it('loads emitted JavaScript through Node ESM conditional exports', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { aggregateCentavosByCurrency } from '@shikin/finance-core'; console.log(JSON.stringify(aggregateCentavosByCurrency([{ currency: 'usd', amountCentavos: 7 }])));",
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual([{ currency: 'USD', amountCentavos: 7 }])
  })
})
