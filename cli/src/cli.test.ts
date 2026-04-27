// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type * as ToolsModule from './tools.js'

vi.mock('./tools.js', () => ({ tools: [] }))
vi.mock('./database.js', () => ({ close: vi.fn(), query: vi.fn() }))

const { close, query } = await import('./database.js')
const { tools: actualTools } = await vi.importActual<typeof ToolsModule>('./tools.js')
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

  it('registers default-true booleans as --no-* flags', () => {
    const schema = z.object({
      activeOnly: z.boolean().optional().default(true),
    })

    const options = zodToOptions(schema)
    expect(options[0]).toMatchObject({
      flag: 'active-only',
      isBoolean: true,
      required: false,
      defaultValue: true,
    })
  })
})

describe('CLI command execution', () => {
  it('keeps all tool definitions discoverable as CLI commands', () => {
    const program = createProgram(actualTools)
    const commandNames = program.commands.map((command) => command.name())

    expect(commandNames).toContain('diagnose')
    expect(commandNames).toEqual(expect.arrayContaining(actualTools.map((tool) => tool.name)))
  })

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
      .mockReturnValueOnce([
        { name: '001_core_tables' },
        { name: '014_recurring_rules_currency_backfill' },
      ])
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
          toolAvailability: {
            cliAvailable: 0,
            cliUnavailable: 0,
            cliUnavailableTools: [],
            mcpAvailable: 0,
            mcpUnavailable: 0,
            mcpUnavailableTools: [],
          },
          database: {
            ready: true,
            migrationCount: 2,
            latestMigration: '014_recurring_rules_currency_backfill',
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

  it('includes deep integrity details for diagnose --deep', async () => {
    vi.mocked(query)
      .mockReturnValueOnce([
        { name: '001_core_tables' },
        { name: '003_credit_cards' },
        { name: '004_category_rules' },
        { name: '005_recurring_rules' },
        { name: '006_goals' },
        { name: '007_recaps' },
        { name: '010_transaction_splits' },
        { name: '011_net_worth_snapshots' },
        { name: '012_account_balance_history' },
        { name: '013_recurring_rules_currency' },
        { name: '014_recurring_rules_currency_backfill' },
      ])
      .mockReturnValueOnce([{ count: 2 }])
      .mockReturnValueOnce([{ count: 14 }])
      .mockReturnValueOnce([{ count: 42 }])
      .mockReturnValueOnce([{ integrity_check: 'ok' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        {
          accountId: 'acct-1',
          accountName: 'Checking',
          storedBalance: 5000,
          computedBalance: 4800,
        },
        {
          accountId: 'acct-2',
          accountName: 'Savings',
          storedBalance: 12000,
          computedBalance: 12000,
        },
      ])
      .mockReturnValueOnce([{ name: 'id' }, { name: 'description' }, { name: 'currency' }])
      .mockReturnValueOnce([
        {
          ruleId: 'rule-legacy',
          description: 'Legacy Missing Currency',
          accountId: 'acct-1',
          accountName: 'Checking',
          ruleCurrency: null,
          accountCurrency: 'USD',
        },
        {
          ruleId: 'rule-mismatch',
          description: 'Mismatch Rule',
          accountId: 'acct-2',
          accountName: 'Savings',
          ruleCurrency: 'EUR',
          accountCurrency: 'USD',
        },
      ])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([])

    await program.parseAsync(['node', 'shikin', 'diagnose', '--deep'])

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          toolCount: 0,
          toolAvailability: {
            cliAvailable: 0,
            cliUnavailable: 0,
            cliUnavailableTools: [],
            mcpAvailable: 0,
            mcpUnavailable: 0,
            mcpUnavailableTools: [],
          },
          database: {
            ready: true,
            migrationCount: 11,
            latestMigration: '014_recurring_rules_currency_backfill',
            accountCount: 2,
            categoryCount: 14,
            transactionCount: 42,
            integrity: {
              integrityCheck: {
                ok: true,
                result: 'ok',
              },
              foreignKeyCheck: {
                ok: true,
                violations: [],
              },
              migrations: {
                expected: 11,
                applied: 11,
                missing: [],
                unexpected: [],
              },
              balances: {
                ok: false,
                mismatches: [
                  {
                    accountId: 'acct-1',
                    accountName: 'Checking',
                    storedBalance: 5000,
                    computedBalance: 4800,
                    difference: 200,
                  },
                ],
              },
              recurringRuleCurrency: {
                checked: true,
                ok: false,
                missingCurrency: [
                  {
                    ruleId: 'rule-legacy',
                    description: 'Legacy Missing Currency',
                    accountId: 'acct-1',
                    accountName: 'Checking',
                  },
                ],
                accountCurrencyMismatch: [
                  {
                    ruleId: 'rule-mismatch',
                    description: 'Mismatch Rule',
                    accountId: 'acct-2',
                    accountName: 'Savings',
                    ruleCurrency: 'EUR',
                    accountCurrency: 'USD',
                  },
                ],
              },
            },
          },
        },
        null,
        2
      )
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('reports CLI and MCP availability for the real tool catalog', async () => {
    vi.mocked(query)
      .mockReturnValueOnce([{ name: '001_core_tables' }])
      .mockReturnValueOnce([{ count: 1 }])
      .mockReturnValueOnce([{ count: 2 }])
      .mockReturnValueOnce([{ count: 3 }])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram(actualTools)

    await program.parseAsync(['node', 'shikin', 'diagnose'])

    const cliUnavailableTools = actualTools
      .filter((tool) => tool.cliUnavailableMessage)
      .map((tool) => tool.name)
      .sort()
    const mcpUnavailableTools = actualTools
      .filter((tool) => tool.mcpUnavailableMessage)
      .map((tool) => tool.name)
      .sort()

    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          toolCount: actualTools.length,
          toolAvailability: {
            cliAvailable: actualTools.length - cliUnavailableTools.length,
            cliUnavailable: cliUnavailableTools.length,
            cliUnavailableTools,
            mcpAvailable: actualTools.length - mcpUnavailableTools.length,
            mcpUnavailable: mcpUnavailableTools.length,
            mcpUnavailableTools,
          },
          database: {
            ready: true,
            migrationCount: 1,
            latestMigration: '001_core_tables',
            accountCount: 1,
            categoryCount: 2,
            transactionCount: 3,
          },
        },
        null,
        2
      )
    )
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('supports disabling default-true boolean options with --no-* flags', async () => {
    const tool = {
      name: 'list-demo',
      description: 'Test default-true booleans',
      schema: z.object({
        activeOnly: z.boolean().optional().default(true),
      }),
      execute: vi.fn(async ({ activeOnly }) => ({ success: true, activeOnly })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'list-demo', '--no-active-only'])

    expect(tool.execute).toHaveBeenCalledWith({ activeOnly: false })
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: true,
          activeOnly: false,
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
