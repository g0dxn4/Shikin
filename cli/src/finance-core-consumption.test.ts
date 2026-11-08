// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
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

  it('preserves the currency declaration inventory and package export routes', () => {
    const declarations = readFileSync(
      resolve(process.cwd(), 'packages/finance-core/dist/currency.d.ts'),
      'utf8'
    )
    expect(
      [...declarations.matchAll(/export (?:interface|type|declare function) (\w+)/g)]
        .map((match) => match[1])
        .sort()
    ).toEqual(['CurrencyAmount', 'CurrencyTotal', 'aggregateCentavosByCurrency'])
    const manifest = JSON.parse(
      readFileSync(resolve(process.cwd(), 'packages/finance-core/package.json'), 'utf8')
    )
    expect(manifest.private).toBe(true)
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    })
    expect(manifest.exports['./fx']).toEqual({
      types: './dist/fx.d.ts',
      import: './dist/fx.js',
      default: './dist/fx.js',
    })
    expect(manifest.exports).not.toHaveProperty('./currency')
  })

  it('rejects retired imports while preserving aggregation and dated FX declarations', () => {
    const filename = resolve(process.cwd(), 'cli/src/finance-core-import-contract.ts')
    const source = `
      import {
        aggregateCentavosByCurrency, convertCurrencyTotals, convertDatedAmounts,
        type CurrencyAmount, type CurrencyTotal, type ConversionRate,
        type ConvertedCurrencyTotal, type CurrencyConversionResult, type DatedExchangeRate,
      } from '@shikin/finance-core';
      export { aggregateCentavosByCurrency, convertCurrencyTotals, convertDatedAmounts };
      export type Contract = [
        CurrencyAmount, CurrencyTotal, ConversionRate, ConvertedCurrencyTotal,
        CurrencyConversionResult, DatedExchangeRate,
      ];
    `
    const options: ts.CompilerOptions = {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: [],
    }
    const host = ts.createCompilerHost(options)
    const getSourceFile = host.getSourceFile.bind(host)
    host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
      path === filename
        ? ts.createSourceFile(path, source, languageVersion)
        : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile)
    const program = ts.createProgram([filename], options, host)
    expect(
      ts.getPreEmitDiagnostics(program).map((diagnostic) => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }))
    ).toEqual([
      {
        code: 2305,
        message:
          "Module '\"@shikin/finance-core\"' has no exported member 'convertCurrencyTotals'.",
      },
      {
        code: 2305,
        message: "Module '\"@shikin/finance-core\"' has no exported member 'ConversionRate'.",
      },
      {
        code: 2305,
        message:
          "Module '\"@shikin/finance-core\"' has no exported member 'ConvertedCurrencyTotal'.",
      },
      {
        code: 2305,
        message:
          "Module '\"@shikin/finance-core\"' has no exported member 'CurrencyConversionResult'.",
      },
    ])
  })

  it('exposes aggregation and dated FX but not the undated converter through the package root', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import * as core from '@shikin/finance-core';
         console.log(JSON.stringify({
           undated: Object.hasOwn(core, 'convertCurrencyTotals'),
           aggregation: typeof core.aggregateCentavosByCurrency,
           dated: typeof core.convertDatedAmounts,
         }));`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      undated: false,
      aggregation: 'function',
      dated: 'function',
    })
  })

  it('rejects a named ESM import of the retired undated converter', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { convertCurrencyTotals } from '@shikin/finance-core'; console.log(convertCurrencyTotals);",
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("does not provide an export named 'convertCurrencyTotals'")
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
