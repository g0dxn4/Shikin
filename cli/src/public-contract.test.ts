// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ToolDefinition } from './tools.js'

vi.mock('./database.js', () => ({
  query: vi.fn(() => []),
  execute: vi.fn(),
  transaction: vi.fn((callback: () => unknown) => callback()),
  close: vi.fn(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  DATABASE_BACKUP_SETTING_KEY: 'database_backups',
}))

const { APPLICATION_VERSION } = await import('./version.js')
const { COMMAND_CATALOG_VERSION } = await import('./contracts.js')
const { builtInTools } = await import('./tools.js')
const { createProgram, COMMAND_CATALOG_VERSION: EXPOSED_CATALOG_VERSION } = await import('./cli.js')
const { createMcpServer, createMcpToolHandler, registerMcpResources } =
  await import('./mcp-server.js')

const inventory = JSON.parse(
  readFileSync(resolve(process.cwd(), 'cli/src/fixtures/public-automation-inventory.json'), 'utf8')
) as { tools: string[]; commands: string[] }

describe('public automation contract', () => {
  it('pins every built-in tool and command plus independently versioned contracts', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const program = createProgram(builtInTools)

    await program.parseAsync(['node', 'shikin', 'tools', '--json'])
    const catalog = JSON.parse(String(log.mock.calls[0]?.[0])) as Record<string, unknown>

    expect(builtInTools).toHaveLength(108)
    expect(program.commands).toHaveLength(113)
    expect(builtInTools.map((tool) => tool.name).sort()).toEqual(inventory.tools)
    expect(program.commands.map((command) => command.name()).sort()).toEqual(inventory.commands)
    expect(program.version()).toBe('1.1.0')
    expect(APPLICATION_VERSION).toBe('1.1.0')
    expect(COMMAND_CATALOG_VERSION).toBe('2026-09-19.backend-remediation')
    expect(EXPOSED_CATALOG_VERSION).toBe(COMMAND_CATALOG_VERSION)
    expect(COMMAND_CATALOG_VERSION).not.toBe(APPLICATION_VERSION)
    expect(catalog).toMatchObject({
      success: true,
      catalogVersion: COMMAND_CATALOG_VERSION,
      schemaVersion: 'cli-tools-json.v1',
      commandCount: 113,
      toolCount: 108,
      compatibility: {
        effects: {
          declaredOnly: true,
        },
      },
    })

    const commands = catalog.commands as Array<{ name: string; effects?: unknown }>
    expect(commands.find((command) => command.name === 'get-spending-recap')?.effects).toEqual({
      readOnly: true,
      writesTo: [],
    })
    expect(commands.find((command) => command.name === 'save-spending-recap')?.effects).toEqual({
      readOnly: false,
      idempotent: true,
      writesTo: ['recaps', 'audit_log'],
    })
    expect(commands.find((command) => command.name === 'query-transactions')?.effects).toEqual({
      readOnly: true,
      writesTo: [],
    })
    expect(commands.find((command) => command.name === 'get-runtime-diagnostics')?.effects).toEqual(
      {
        readOnly: true,
        idempotent: true,
      }
    )
    expect(commands.find((command) => command.name === 'import-transactions')?.effects).toEqual({
      writesTo: [
        'accounts',
        'transactions',
        'duplicate_review_decisions',
        'audit_log',
        'app_data_state',
      ],
    })
    expect(
      commands.find((command) => command.name === 'bind-transaction-import-identity')?.effects
    ).toEqual({ writesTo: ['transactions', 'audit_log', 'app_data_state'] })
    expect(commands.find((command) => command.name === 'list-accounts')?.effects).toBeUndefined()
    expect(commands.find((command) => command.name === 'add-transaction')?.effects).toBeUndefined()
  })

  it('keeps plugin-like tools additive without changing the built-in fixture', () => {
    const pluginLikeTool: ToolDefinition = {
      name: 'fixture-plugin-tool',
      description: 'Plugin-like additive fixture',
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    }
    const builtInNamesBefore = builtInTools.map((tool) => tool.name).sort()
    const program = createProgram([...builtInTools, pluginLikeTool])

    expect(program.commands.map((command) => command.name()).sort()).toEqual(
      [...inventory.commands, pluginLikeTool.name].sort()
    )
    expect(builtInTools.map((tool) => tool.name).sort()).toEqual(builtInNamesBefore)
    expect(builtInNamesBefore).toEqual(inventory.tools)
  })

  it('uses application semver in MCP metadata rather than the catalog contract version', () => {
    const server = createMcpServer([]) as unknown as {
      server: { _serverInfo: { name: string; version: string } }
    }

    expect(server.server._serverInfo).toEqual({ name: 'shikin', version: APPLICATION_VERSION })
    expect(server.server._serverInfo.version).not.toBe(COMMAND_CATALOG_VERSION)
  })

  it('keeps MCP success and failure response envelopes stable', async () => {
    const successHandler = createMcpToolHandler({
      name: 'contract-success',
      description: 'Contract success fixture',
      schema: z.object({ value: z.number() }),
      execute: async ({ value }: { value: number }) => value * 2,
    })
    const failureHandler = createMcpToolHandler({
      name: 'contract-failure',
      description: 'Contract failure fixture',
      schema: z.object({ value: z.number() }),
      execute: async () => ({ success: false, reason: 'not_allowed', message: 'Not allowed.' }),
    })

    const success = await successHandler({ value: 2 })
    const failure = await failureHandler({ value: 2 })

    expect(success).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ success: true, result: 4 }, null, 2) }],
    })
    expect(failure.isError).toBe(true)
    expect(JSON.parse(failure.content[0]!.text)).toEqual({
      success: false,
      reason: 'not_allowed',
      message: 'Not allowed.',
      error: 'Not allowed.',
      errorType: 'execution_error',
    })
  })

  it('keeps MCP resource names, URIs, and serialized response fields stable', async () => {
    const resource = vi.fn()
    registerMcpResources({ resource } as never)

    expect(resource.mock.calls.map(([name, uri]) => [name, uri])).toEqual([
      ['accounts', 'shikin://accounts'],
      ['categories', 'shikin://categories'],
      ['recent-transactions', 'shikin://recent-transactions'],
    ])

    const handler = resource.mock.calls[1]?.[2] as (uri: URL) => Promise<unknown>
    await expect(handler(new URL('shikin://categories'))).resolves.toEqual({
      contents: [
        {
          uri: 'shikin://categories',
          mimeType: 'application/json',
          text: '[]',
        },
      ],
    })
  })
})
