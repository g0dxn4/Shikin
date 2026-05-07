// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import dayjs from 'dayjs'
import type * as ToolsModule from './tools.js'
import { CLI_DATABASE_MIGRATIONS } from './migrations.js'

vi.mock('./tools.js', () => ({ tools: [] }))
vi.mock('./database.js', () => ({
  close: vi.fn(),
  query: vi.fn(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))

const { close, query } = await import('./database.js')
const { tools: actualTools } = await vi.importActual<typeof ToolsModule>('./tools.js')
const {
  CLI_SCHEMA_VERSION,
  COMMAND_CATALOG_VERSION,
  coerceInput,
  createProgram,
  EXPECTED_MIGRATIONS,
  zodToOptions,
} = await import('./cli.js')

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
  it('uses shikin as the command name for the unified desktop CLI', () => {
    expect(createProgram([]).name()).toBe('shikin')
  })

  it('uses the shared migration list for diagnose drift prevention', () => {
    expect(EXPECTED_MIGRATIONS).toBe(CLI_DATABASE_MIGRATIONS)
    expect(EXPECTED_MIGRATIONS).toHaveLength(13)
  })

  it('keeps all tool definitions discoverable as CLI commands', () => {
    const program = createProgram(actualTools)
    const commandNames = program.commands.map((command) => command.name())

    expect(commandNames).toContain('diagnose')
    expect(commandNames).toEqual(expect.arrayContaining(actualTools.map((tool) => tool.name)))
  })

  it('keeps list-transactions as an alias for query-transactions', () => {
    const program = createProgram(actualTools)
    const queryTransactions = program.commands.find(
      (command) => command.name() === 'query-transactions'
    )

    expect(queryTransactions?.aliases()).toContain('list-transactions')
  })

  it('keeps short aliases for database backup and restore commands', () => {
    const program = createProgram(actualTools)
    const backupDatabase = program.commands.find((command) => command.name() === 'backup-database')
    const restoreDatabase = program.commands.find(
      (command) => command.name() === 'restore-database'
    )

    expect(backupDatabase?.aliases()).toContain('backup')
    expect(restoreDatabase?.aliases()).toContain('restore')
  })

  it('routes list-transactions through the query-transactions command', async () => {
    const tool = {
      name: 'query-transactions',
      description: 'Query transactions',
      schema: z.object({ limit: z.number().optional() }),
      execute: vi.fn(async () => ({ success: true, transactions: [] })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'list-transactions', '--limit', '5'])

    expect(tool.execute).toHaveBeenCalledWith({ limit: 5 })
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify({ success: true, transactions: [] }, null, 2)
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('passes global --redacted through when a tool schema owns redacted', async () => {
    const tool = {
      name: 'export-data',
      description: 'Export data',
      schema: z.object({
        format: z.enum(['json', 'csv']).default('json'),
        redacted: z.boolean().default(false),
      }),
      execute: vi.fn(async (input: Record<string, unknown>) => ({ success: true, input })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'export-data', '--format', 'csv', '--redacted'])

    expect(tool.execute).toHaveBeenCalledWith({ format: 'csv', redacted: true })
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      input: { format: 'csv', redacted: true },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('returns machine-readable command discovery metadata', async () => {
    const tool = {
      name: 'catalog-demo',
      description: 'Catalog test tool',
      schema: z.object({
        kind: z.enum(['expense', 'income']).describe('Transaction kind'),
        dryRun: z.boolean().default(false).describe('Preview only'),
        activeOnly: z.boolean().optional().default(true).describe('Only active items'),
        redacted: z.boolean().default(false).describe('Redact tool payload'),
        splits: z.array(z.object({ amount: z.number() })).optional(),
      }),
      execute: vi.fn(async () => ({ success: true })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'tools', '--json'])

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    const catalogDemo = output.commands.find(
      (command: { name: string }) => command.name === 'catalog-demo'
    )
    const validateCommand = output.commands.find(
      (command: { name: string }) => command.name === 'validate'
    )

    expect(output.success).toBe(true)
    expect(output.catalogVersion).toBe(COMMAND_CATALOG_VERSION)
    expect(output.schemaVersion).toBe(CLI_SCHEMA_VERSION)
    expect(Number.isNaN(Date.parse(output.generatedAt))).toBe(false)
    expect(output.commandCount).toBe(output.commands.length)
    expect(output.toolCount).toBe(1)
    expect(output.compatibility).toMatchObject({
      localFirst: true,
      sharedCatalog: true,
      cli: { availableToolCount: 1, unavailableToolCount: 0, unavailableTools: [] },
      mcp: { availableToolCount: 1, unavailableToolCount: 0, unavailableTools: [] },
      validation: { scope: 'schema' },
    })
    expect(output.database).toMatchObject({
      requiredMigrations: [...CLI_DATABASE_MIGRATIONS],
      latestRequiredMigration: '016_cli_qol_foundation',
      migrationCount: CLI_DATABASE_MIGRATIONS.length,
      expectsCurrent016FoundationSchema: true,
      foundationMigration: '016_cli_qol_foundation',
    })
    expect(output.outputOptions.map((option: { name: string }) => option.name)).toEqual([
      'json',
      'pretty',
      'quiet',
      'redacted',
    ])
    expect(catalogDemo.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'kind', type: 'enum', enumValues: ['expense', 'income'] }),
        expect.objectContaining({ name: 'dryRun', flag: 'dry-run', type: 'boolean' }),
        expect.objectContaining({ name: 'activeOnly', flag: 'no-active-only', type: 'boolean' }),
        expect.objectContaining({ name: 'redacted', flag: 'redacted', type: 'boolean' }),
        expect.objectContaining({ name: 'splits', type: 'array<object>', isStructured: true }),
      ])
    )
    expect(catalogDemo.validationScope).toBe('schema')
    expect(catalogDemo.outputOptions.map((option: { name: string }) => option.name)).toEqual([
      'json',
      'pretty',
      'quiet',
    ])
    expect(validateCommand.outputOptions.map((option: { name: string }) => option.name)).toEqual([
      'json',
      'pretty',
      'quiet',
    ])
    expect(logSpy.mock.calls[0]?.[0]).not.toContain('\n')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('validates another command without executing it', async () => {
    const tool = {
      name: 'validate-demo',
      description: 'Validate test tool',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income']),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async () => ({ success: true })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync([
      'node',
      'shikin',
      'validate',
      'validate-demo',
      '--amount',
      '12.34',
      '--type',
      'expense',
      '--dry-run',
    ])

    expect(tool.execute).not.toHaveBeenCalled()
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      command: 'validate-demo',
      validationScope: 'schema',
      input: { amount: 12.34, type: 'expense', dryRun: true },
      message:
        'validate-demo input is schema-valid. No domain checks ran and no changes were made.',
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('validates default-true boolean options using the real --no-* flag shape', async () => {
    const tool = {
      name: 'validate-boolean-demo',
      description: 'Validate boolean flag test tool',
      schema: z.object({
        activeOnly: z.boolean().optional().default(true),
      }),
      execute: vi.fn(async () => ({ success: true })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync([
      'node',
      'shikin',
      'validate',
      'validate-boolean-demo',
      '--no-active-only',
    ])

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      command: 'validate-boolean-demo',
      input: { activeOnly: false },
    })

    await program.parseAsync([
      'node',
      'shikin',
      'validate',
      'validate-boolean-demo',
      '--active-only=false',
    ])

    expect(JSON.parse(logSpy.mock.calls[1]?.[0] as string)).toMatchObject({
      success: false,
      code: 'COMMAND_ERROR',
      message: 'Unknown option --active-only for validate-boolean-demo.',
    })
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('parses optional boolean false consistently for CLI execution and validation', async () => {
    const tool = {
      name: 'optional-bool-demo',
      description: 'Optional boolean test tool',
      schema: z.object({ active: z.boolean().optional() }),
      execute: vi.fn(async (input: Record<string, unknown>) => ({ success: true, input })),
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([tool]).parseAsync([
      'node',
      'shikin',
      'optional-bool-demo',
      '--active',
      'false',
    ])

    expect(tool.execute).toHaveBeenCalledWith({ active: false })
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      input: { active: false },
    })

    vi.mocked(close).mockReset()
    await createProgram([tool]).parseAsync([
      'node',
      'shikin',
      'validate',
      'optional-bool-demo',
      '--active',
      'false',
    ])

    expect(JSON.parse(logSpy.mock.calls[1]?.[0] as string)).toMatchObject({
      success: true,
      input: { active: false },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('treats validate target arguments as target options when names collide with output flags', async () => {
    const tool = {
      name: 'export-data',
      description: 'Export data',
      schema: z.object({ redacted: z.boolean().optional().default(false) }),
      execute: vi.fn(async () => ({ success: true })),
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([tool]).parseAsync([
      'node',
      'shikin',
      'validate',
      'export-data',
      '--redacted',
    ])

    expect(tool.execute).not.toHaveBeenCalled()
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      command: 'export-data',
      input: { redacted: true },
    })
  })

  it('previews natural-language records with formatted amounts and local dates', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([])

    await program.parseAsync([
      'node',
      'shikin',
      'record',
      '--source',
      'luna',
      '--note',
      'Discord balance note',
      'Amazon',
      'case',
      '1,234.56',
      'MXN',
      'category',
      'shopping',
      'today',
    ])

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output).toMatchObject({
      success: true,
      requiresConfirmation: true,
      parsed: {
        amount: 1234.56,
        currency: 'MXN',
        type: 'expense',
        description: 'Amazon case',
        category: 'shopping',
        date: dayjs().format('YYYY-MM-DD'),
      },
      metadata: {
        source: 'luna',
        note: 'Discord balance note',
      },
    })
    expect(output.suggestedCommand.args.amount).toBe(1234.56)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not treat lowercase prose after an amount as a currency code', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([])

    await program.parseAsync(['node', 'shikin', 'record', 'paid', '10', 'for', 'lunch'])

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output).toMatchObject({
      success: true,
      parsed: {
        amount: 10,
        currency: null,
        description: 'paid for lunch',
      },
    })
  })

  it('routes record preview and apply through the add-transaction tool', async () => {
    const addTransaction = {
      name: 'add-transaction',
      description: 'Add transaction',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income', 'transfer']),
        description: z.string(),
        category: z.string().optional(),
        date: z.string(),
        account: z.string().optional(),
        accountId: z.string().optional(),
        notes: z.string().optional(),
        source: z.string().optional(),
        note: z.string().optional(),
        status: z.enum(['pending', 'posted', 'cleared']).optional().default('posted'),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async (input: Record<string, unknown>) =>
        input.dryRun
          ? { success: true, dryRun: true, wouldCreate: input }
          : { success: true, transaction: { id: 'tx-applied', ...input } }
      ),
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      '--account',
      'checking',
      '--category',
      'Food',
      '--status',
      'pending',
      '--source',
      'luna',
      '--note',
      'metadata memo',
      'Coffee',
      '4.50',
    ])

    expect(addTransaction.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 4.5,
        type: 'expense',
        description: 'Coffee',
        account: 'checking',
        category: 'Food',
        status: 'pending',
        source: 'luna',
        note: 'metadata memo',
        dryRun: true,
      })
    )
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      dryRun: true,
      requiresConfirmation: true,
      wouldCreate: {
        account: 'checking',
        status: 'pending',
      },
      suggestedCommand: {
        command: 'add-transaction',
        args: expect.not.objectContaining({ dryRun: expect.anything() }),
      },
    })

    vi.mocked(close).mockReset()
    logSpy.mockClear()
    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      '--apply',
      '--account-id',
      'acct-1',
      '--status',
      'posted',
      'Coffee',
      '4.50',
    ])

    expect(addTransaction.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: 'acct-1', status: 'posted', dryRun: false })
    )
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      applied: true,
      transaction: { id: 'tx-applied', accountId: 'acct-1', dryRun: false },
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('blocks exact duplicate natural-language records before apply', async () => {
    const addTransaction = {
      name: 'add-transaction',
      description: 'Add transaction',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income', 'transfer']),
        description: z.string(),
        date: z.string(),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async (input: Record<string, unknown>) =>
        input.dryRun
          ? {
              success: true,
              dryRun: true,
              wouldCreate: { ...input, accountId: 'acct-1', currency: 'USD' },
            }
          : { success: true, transaction: { id: 'tx-applied', ...input } }
      ),
    }
    vi.mocked(query).mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM transactions') && params?.[0] === 'acct-1') {
        return [
          {
            id: 'tx-existing',
            account_id: 'acct-1',
            date: params[1],
            amount: 450,
            type: 'expense',
            description: 'coffee',
          },
        ]
      }
      return []
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      '--apply',
      'Coffee',
      '4.50',
    ])

    expect(addTransaction.execute).toHaveBeenCalledTimes(1)
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: false,
      reason: 'duplicate_transaction',
      duplicate: {
        kind: 'exact_duplicate',
        existingTransactionId: 'tx-existing',
      },
    })
    expect(process.exitCode).toBe(1)
  })

  it('checks record duplicates against the requested transaction status', async () => {
    const addTransaction = {
      name: 'add-transaction',
      description: 'Add transaction',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income', 'transfer']),
        description: z.string(),
        date: z.string(),
        status: z.enum(['pending', 'posted', 'cleared']).default('posted'),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async (input: Record<string, unknown>) =>
        input.dryRun
          ? {
              success: true,
              dryRun: true,
              wouldCreate: { ...input, accountId: 'acct-1', currency: 'USD' },
            }
          : { success: true, transaction: { id: 'tx-applied', ...input } }
      ),
    }
    vi.mocked(query).mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM transactions') && params?.[4] === 'posted') {
        return [
          {
            id: 'tx-posted',
            account_id: 'acct-1',
            date: params[1],
            amount: 450,
            type: 'expense',
            status: 'posted',
            description: 'coffee',
          },
        ]
      }
      return []
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      '--apply',
      '--status',
      'pending',
      'Coffee',
      '4.50',
    ])

    expect(addTransaction.execute).toHaveBeenCalledTimes(2)
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      applied: true,
      transaction: { id: 'tx-applied', status: 'pending' },
    })
  })

  it('applies natural-language record duplicates when allowDuplicate is explicit', async () => {
    const addTransaction = {
      name: 'add-transaction',
      description: 'Add transaction',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income', 'transfer']),
        description: z.string(),
        date: z.string(),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async (input: Record<string, unknown>) =>
        input.dryRun
          ? {
              success: true,
              dryRun: true,
              wouldCreate: { ...input, accountId: 'acct-1', currency: 'USD' },
            }
          : { success: true, transaction: { id: 'tx-applied', ...input } }
      ),
    }
    vi.mocked(query).mockImplementation((sql: string, params?: unknown[]) => {
      if (sql.includes('FROM transactions') && params?.[0] === 'acct-1') {
        return [
          {
            id: 'tx-existing',
            account_id: 'acct-1',
            date: params[1],
            amount: 450,
            type: 'expense',
            description: 'coffee',
          },
        ]
      }
      return []
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      '--apply',
      '--allow-duplicate',
      'Coffee',
      '4.50',
    ])

    expect(addTransaction.execute).toHaveBeenCalledTimes(2)
    expect(addTransaction.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ dryRun: false, allowDuplicate: true })
    )
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: true,
      applied: true,
      duplicateOverride: {
        allowed: true,
        duplicate: {
          kind: 'exact_duplicate',
          existingTransactionId: 'tx-existing',
        },
      },
      transaction: { id: 'tx-applied', allowDuplicate: true },
    })
  })

  it('rejects record entries with explicit currency when the resolved account currency is unknown', async () => {
    const addTransaction = {
      name: 'add-transaction',
      description: 'Add transaction',
      schema: z.object({
        amount: z.number().positive(),
        type: z.enum(['expense', 'income', 'transfer']),
        description: z.string(),
        category: z.string().optional(),
        date: z.string(),
        dryRun: z.boolean().default(false),
      }),
      execute: vi.fn(async () => ({
        success: true,
        dryRun: true,
        wouldCreate: { currency: '' },
      })),
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await createProgram([addTransaction]).parseAsync([
      'node',
      'shikin',
      'record',
      'Coffee',
      '4.50',
      'USD',
    ])

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      success: false,
      code: 'RECORD_CURRENCY_UNKNOWN',
      message: 'Record parsed currency USD, but the resolved account currency is unknown.',
    })
    expect(addTransaction.execute).toHaveBeenCalledTimes(1)
  })

  it('honors quiet and redacted output flags', async () => {
    const tool = {
      name: 'secret-demo',
      description: 'Secret output test tool',
      schema: z.object({}),
      execute: vi.fn(async () => ({ success: true, token: 'secret-value' })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'secret-demo', '--quiet'])

    expect(logSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)

    vi.mocked(close).mockReset()
    await createProgram([tool]).parseAsync(['node', 'shikin', 'secret-demo', '--redacted'])

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({
      success: true,
      token: '[REDACTED]',
    })
    expect(close).toHaveBeenCalledTimes(1)
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
          code: 'MISSING_ACCOUNT',
          hint: 'Run shikin list-accounts to find a valid account, or set an alias with shikin set-account-alias.',
        },
        null,
        2
      )
    )
    expect(errorSpy).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('short-circuits CLI-unavailable tools without executing implementation code', async () => {
    const tool = {
      name: 'feed-placeholder',
      description: 'Test unavailable CLI tool output',
      schema: z.object({}),
      cliUnavailableMessage: 'This feed is not configured yet.',
      execute: vi.fn(async () => ({ success: true })),
    }

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([tool])

    await program.parseAsync(['node', 'shikin', 'feed-placeholder'])

    expect(process.exitCode).toBe(1)
    expect(tool.execute).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledWith(
      JSON.stringify(
        {
          success: false,
          code: 'UNAVAILABLE_ERROR',
          message: 'This feed is not configured yet.',
          error: 'This feed is not configured yet.',
          errorType: 'unavailable_error',
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
        { name: '015_primary_account' },
        { name: '016_cli_qol_foundation' },
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
            migrationCount: 13,
            latestMigration: '016_cli_qol_foundation',
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
                expected: 13,
                applied: 13,
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

  it('reports missing and unexpected migrations for diagnose --deep', async () => {
    vi.mocked(query)
      .mockReturnValueOnce([
        { name: '001_core_tables' },
        { name: '003_credit_cards' },
        { name: '999_legacy_ai_memory' },
      ])
      .mockReturnValueOnce([{ count: 2 }])
      .mockReturnValueOnce([{ count: 14 }])
      .mockReturnValueOnce([{ count: 42 }])
      .mockReturnValueOnce([{ integrity_check: 'ok' }])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const program = createProgram([])

    await program.parseAsync(['node', 'shikin', 'diagnose', '--deep'])

    const output = JSON.parse(logSpy.mock.calls[0]?.[0] as string)
    expect(output.database.integrity.migrations).toEqual({
      expected: 13,
      applied: 3,
      missing: CLI_DATABASE_MIGRATIONS.filter(
        (migration) => migration !== '001_core_tables' && migration !== '003_credit_cards'
      ),
      unexpected: ['999_legacy_ai_memory'],
    })
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
