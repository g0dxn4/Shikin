// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('./tools.js', () => ({ tools: [] }))
vi.mock('./database.js', () => ({ close: vi.fn(), query: vi.fn() }))

const { close, query } = await import('./database.js')
const { coerceInput, createProgram, zodToOptions } = await import('./cli.js')

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(close).mockReset()
  vi.mocked(query).mockReset()
  process.exitCode = undefined
})

describe('CLI input coercion', () => {
  it('parses structured JSON while preserving free-form string whitespace', () => {
    const schema = z.object({
      content: z.string(),
      splits: z.array(
        z.object({
          amount: z.number(),
          note: z.string(),
        })
      ),
    })

    const input = {
      content: '  keep leading and trailing whitespace  ',
      splits: ' [{"amount":"12.5","note":"  keep nested spacing  "}] ',
    }

    expect(coerceInput(input, schema)).toEqual({
      content: '  keep leading and trailing whitespace  ',
      splits: [{ amount: 12.5, note: '  keep nested spacing  ' }],
    })
  })

  it('throws a clear error for malformed structured JSON input', () => {
    const schema = z.object({
      splits: z.array(z.object({ amount: z.number() })),
    })

    expect(() => coerceInput({ splits: '[{"amount":10,}]' }, schema)).toThrow(
      'Invalid JSON for --splits. Provide valid JSON for structured options.'
    )
  })
})

describe('CLI option registration', () => {
  it('registers defaulted booleans as flags (not value-taking)', () => {
    const schema = z.object({
      dryRun: z.boolean().default(false),
    })

    const options = zodToOptions(schema)
    expect(options[0]).toMatchObject({
      flag: 'dry-run',
      isBoolean: true,
      required: false,
      defaultValue: false,
    })
  })

  it('marks wrapped structured options and includes JSON guidance text', () => {
    const schema = z.object({
      payload: z
        .array(z.object({ id: z.string() }))
        .nullable()
        .optional(),
    })

    const options = zodToOptions(schema)
    expect(options[0]?.isStructured).toBe(true)
    expect(options[0]?.description).toContain('Pass as JSON')
  })
})

describe('CLI command execution', () => {
  it('returns a nonzero exit code for tool-level failures while preserving JSON output', async () => {
    const tool = {
      name: 'domain-failure',
      description: 'Test tool-level failure output',
      schema: z.object({}),
      execute: vi.fn(async () => ({
        success: false,
        message: 'Account missing-account not found.',
        reason: 'missing_account',
      })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'domain-failure'])

    expect(process.exitCode).toBe(1)
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: false,
          message: 'Account missing-account not found.',
          reason: 'missing_account',
        },
        null,
        2
      )
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('prints database health details for diagnose', async () => {
    vi.mocked(query)
      .mockReturnValueOnce([{ name: '001_core_tables' }, { name: '010_transaction_splits' }])
      .mockReturnValueOnce([{ count: 2 }])
      .mockReturnValueOnce([{ count: 14 }])
      .mockReturnValueOnce([{ count: 42 }])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([])

    await program.parseAsync(['node', 'shikin', 'diagnose'])

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          toolCount: 0,
          database: {
            ready: true,
            migrationCount: 2,
            latestMigration: '010_transaction_splits',
            accountCount: 2,
            categoryCount: 14,
            transactionCount: 42,
          },
        },
        null,
        2
      )
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('parses structured JSON through a real CLI command path', async () => {
    const tool = {
      name: 'split-demo',
      description: 'Test structured CLI parsing',
      schema: z.object({
        splits: z.array(
          z.object({
            categoryId: z.string(),
            amount: z.number(),
          })
        ),
      }),
      execute: vi.fn(async ({ splits }) => ({
        success: true,
        splits,
      })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync([
      'node',
      'shikin',
      'split-demo',
      '--splits',
      '[{"categoryId":"cat-1","amount":"4.5"},{"categoryId":"cat-2","amount":"5.5"}]',
    ])

    expect(tool.execute).toHaveBeenCalledWith({
      splits: [
        { categoryId: 'cat-1', amount: 4.5 },
        { categoryId: 'cat-2', amount: 5.5 },
      ],
    })
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          splits: [
            { categoryId: 'cat-1', amount: 4.5 },
            { categoryId: 'cat-2', amount: 5.5 },
          ],
        },
        null,
        2
      )
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
