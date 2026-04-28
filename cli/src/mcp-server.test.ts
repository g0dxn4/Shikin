// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('./database.js', () => ({
  query: vi.fn(),
  execute: vi.fn(),
  close: vi.fn(),
}))

const { query } = await import('./database.js')
const { tools } = await import('./tools.js')
const { createMcpToolHandler, registerMcpResources, registerMcpTools } =
  await import('./mcp-server.js')

describe('MCP tool registration', () => {
  it('keeps tool names unique and client-safe', () => {
    const toolNames = tools.map((tool) => tool.name)

    expect(new Set(toolNames).size).toBe(toolNames.length)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(tool.description.trim()).not.toBe('')
      if (tool.cliUnavailableMessage && tool.mcpUnavailableMessage) {
        expect(tool.cliUnavailableMessage).toBe(tool.mcpUnavailableMessage)
      }
    }
  })

  it('registers the current shared tool catalog', () => {
    const registerTool = vi.fn()

    registerMcpTools({ tool: registerTool } as never, tools)

    const toolNames = registerTool.mock.calls.map(([name]) => name)

    expect(toolNames).toEqual(tools.map((tool) => tool.name))
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'list-subscriptions',
        'get-spending-summary',
        'get-education-tip',
        'get-financial-news',
        'get-congressional-trades',
      ])
    )
  })

  it('executes real shared tools through the MCP handler without CLI-only coercion', async () => {
    const queryMock = vi.mocked(query)
    queryMock.mockReset()
    queryMock.mockReturnValueOnce([
      {
        id: 'acct-1',
        name: 'Checking',
        type: 'checking',
        currency: 'USD',
        balance: 12345,
        credit_limit: null,
        statement_closing_day: null,
        payment_due_day: null,
      },
    ])

    const listAccounts = tools.find((tool) => tool.name === 'list-accounts')
    expect(listAccounts).toBeDefined()

    const handler = createMcpToolHandler(listAccounts!)
    const result = await handler({ type: 'checking', _meta: { client: 'contract-test' } })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBeUndefined()
    expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('AND type = $1'), ['checking'])
    expect(payload).toEqual({
      accounts: [
        {
          id: 'acct-1',
          name: 'Checking',
          type: 'checking',
          currency: 'USD',
          balance: 123.45,
        },
      ],
      message: 'Found 1 account.',
    })
  })

  it('strips MCP client metadata before schema validation', async () => {
    const execute = vi.fn(async ({ id }: { id: string }) => ({ success: true, id }))
    const handler = createMcpToolHandler({
      name: 'strict-tool',
      description: 'Test strict metadata handling',
      schema: z.object({ id: z.string() }).strict(),
      execute,
    })

    const result = await handler({ id: 'item-1', _meta: { client: 'contract-test' } })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBeUndefined()
    expect(execute).toHaveBeenCalledWith({ id: 'item-1' })
    expect(payload).toEqual({ success: true, id: 'item-1' })
  })
})

describe('MCP tool error envelopes', () => {
  it('returns stable unavailable responses for placeholder tools', async () => {
    const unavailableTool = {
      name: 'placeholder-unavailable-tool',
      description: 'Test placeholder unavailable tool',
      schema: z.object({}),
      mcpUnavailableMessage: 'This tool is unavailable in this release surface.',
      execute: vi.fn(),
    }
    const handler = createMcpToolHandler(unavailableTool)

    const result = await handler({ symbol: 'AAPL' })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBe(true)
    expect(payload).toEqual({
      success: false,
      message: unavailableTool.mcpUnavailableMessage,
      error: unavailableTool.mcpUnavailableMessage,
      errorType: 'unavailable_error',
    })
  })

  it('returns stable unavailable responses for real unavailable catalog tools', async () => {
    const unavailableTools = tools.filter((tool) => tool.mcpUnavailableMessage)

    expect(unavailableTools.map((tool) => tool.name).sort()).toEqual([
      'get-congressional-trades',
      'get-financial-news',
    ])

    for (const tool of unavailableTools) {
      const handler = createMcpToolHandler(tool)
      const result = await handler({})
      const payload = JSON.parse(result.content[0]!.text)

      expect(result.isError).toBe(true)
      expect(payload).toEqual({
        success: false,
        message: tool.mcpUnavailableMessage,
        error: tool.mcpUnavailableMessage,
        errorType: 'unavailable_error',
      })
    }
  })

  it('returns validation errors with a top-level error string and field-level issues', async () => {
    const execute = vi.fn()
    const handler = createMcpToolHandler({
      name: 'validate-input',
      description: 'Test validation envelope',
      schema: z.object({
        amount: z.number().positive(),
        nested: z.object({
          memo: z.string().min(1),
        }),
      }),
      execute,
    })

    const result = await handler({ amount: '10', nested: {} })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBe(true)
    expect(payload).toMatchObject({
      success: false,
      message: 'Tool input validation failed.',
      error: 'Tool input validation failed.',
      errorType: 'validation_error',
    })
    expect(payload.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_type',
          field: 'amount',
          path: ['amount'],
        }),
        expect.objectContaining({
          code: 'invalid_type',
          field: 'nested.memo',
          path: ['nested', 'memo'],
        }),
      ])
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('normalizes tool-level domain failures into MCP isError responses', async () => {
    const handler = createMcpToolHandler({
      name: 'domain-failure',
      description: 'Test domain failure envelope',
      schema: z.object({ amount: z.number() }),
      execute: async () => ({
        success: false,
        message: 'Account missing-account not found.',
        reason: 'missing_account',
      }),
    })

    const result = await handler({ amount: 10 })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBe(true)
    expect(payload).toEqual({
      success: false,
      message: 'Account missing-account not found.',
      error: 'Account missing-account not found.',
      errorType: 'execution_error',
      reason: 'missing_account',
    })
  })

  it('returns execution errors separately from validation failures', async () => {
    const handler = createMcpToolHandler({
      name: 'explode',
      description: 'Test execution envelope',
      schema: z.object({ amount: z.number() }),
      execute: async () => {
        throw new Error('database unavailable')
      },
    })

    const result = await handler({ amount: 10 })
    const payload = JSON.parse(result.content[0]!.text)

    expect(result.isError).toBe(true)
    expect(payload).toEqual({
      success: false,
      message: 'database unavailable',
      error: 'database unavailable',
      errorType: 'execution_error',
    })
  })
})

describe('MCP resource registration', () => {
  it('registers resources that serialize query results into JSON payloads', async () => {
    const queryMock = vi.mocked(query)
    queryMock.mockReset()
    queryMock
      .mockReturnValueOnce([
        { id: 'acct-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 12345 },
      ])
      .mockReturnValueOnce([{ id: 'cat-1', name: 'Food', type: 'expense', color: '#fff' }])
      .mockReturnValueOnce([
        {
          id: 'txn-1',
          description: 'Coffee',
          type: 'expense',
          amount: 450,
          date: '2026-01-01',
          category: 'Food',
          account: 'Checking',
        },
      ])

    const registerResource = vi.fn()
    registerMcpResources({ resource: registerResource } as never)

    const accountsHandler = registerResource.mock.calls[0]?.[2] as (uri: URL) => Promise<{
      contents: Array<{ text: string }>
    }>
    const categoriesHandler = registerResource.mock.calls[1]?.[2] as (uri: URL) => Promise<{
      contents: Array<{ text: string }>
    }>
    const recentTransactionsHandler = registerResource.mock.calls[2]?.[2] as (uri: URL) => Promise<{
      contents: Array<{ text: string }>
    }>

    const accountsResult = await accountsHandler(new URL('shikin://accounts'))
    const categoriesResult = await categoriesHandler(new URL('shikin://categories'))
    const recentTransactionsResult = await recentTransactionsHandler(
      new URL('shikin://recent-transactions')
    )

    expect(registerResource.mock.calls.map(([name]) => name)).toEqual([
      'accounts',
      'categories',
      'recent-transactions',
    ])
    expect(JSON.parse(accountsResult.contents[0]!.text)).toEqual([
      { id: 'acct-1', name: 'Checking', type: 'checking', currency: 'USD', balance: 123.45 },
    ])
    expect(JSON.parse(categoriesResult.contents[0]!.text)).toEqual([
      { id: 'cat-1', name: 'Food', type: 'expense', color: '#fff' },
    ])
    expect(JSON.parse(recentTransactionsResult.contents[0]!.text)).toEqual([
      {
        id: 'txn-1',
        description: 'Coffee',
        type: 'expense',
        amount: 4.5,
        date: '2026-01-01',
        category: 'Food',
        account: 'Checking',
      },
    ])
  })

  it('returns structured execution errors for resource failures', async () => {
    const queryMock = vi.mocked(query)
    queryMock.mockReset()
    queryMock.mockImplementation(() => {
      throw new Error('database unavailable')
    })

    const registerResource = vi.fn()
    registerMcpResources({ resource: registerResource } as never)

    const accountsHandler = registerResource.mock.calls[0]?.[2] as (uri: URL) => Promise<{
      contents: Array<{ text: string }>
    }>

    const result = await accountsHandler(new URL('shikin://accounts'))

    expect(JSON.parse(result.contents[0]!.text)).toEqual({
      success: false,
      message: 'database unavailable',
      error: 'database unavailable',
      errorType: 'execution_error',
      resource: 'accounts',
    })
  })
})
