#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { tools, type ToolDefinition } from './tools.js'
import { query, close } from './database.js'
import { fromCentavos } from './money.js'

type McpToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

type McpErrorType = 'validation_error' | 'execution_error' | 'unavailable_error'

type McpValidationIssue = {
  code: string
  field?: string
  path: string[]
  message: string
}

type McpErrorEnvelope = {
  success: false
  message: string
  error: string
  errorType: McpErrorType
  issues?: McpValidationIssue[]
} & Record<string, unknown>

function toMcpTextResult(payload: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function formatIssueField(path: (string | number)[]): string | undefined {
  if (path.length === 0) return undefined
  return path.map(String).join('.')
}

function isFailureResult(value: unknown): value is Record<string, unknown> & { success: false } {
  return (
    typeof value === 'object' && value !== null && 'success' in value && value.success === false
  )
}

function toMcpErrorEnvelope(
  message: string,
  errorType: McpErrorType,
  extra: Record<string, unknown> = {}
): McpErrorEnvelope {
  return {
    success: false,
    message,
    error: message,
    errorType,
    ...extra,
  }
}

function toValidationIssues(error: z.ZodError): McpValidationIssue[] {
  return error.issues.map((issue) => ({
    code: issue.code,
    field: formatIssueField(issue.path),
    path: issue.path.map(String),
    message: issue.message,
  }))
}

function toUnavailableResult(message: string): McpToolResult {
  return toMcpTextResult(toMcpErrorEnvelope(message, 'unavailable_error'), true)
}

function toFailureResult(result: Record<string, unknown>): McpToolResult {
  const message =
    typeof result.error === 'string'
      ? result.error
      : typeof result.message === 'string'
        ? result.message
        : 'Tool execution failed.'

  return toMcpTextResult(
    {
      ...result,
      ...toMcpErrorEnvelope(message, 'execution_error'),
    },
    true
  )
}

export function formatMcpToolError(err: unknown): McpToolResult {
  const payload: McpErrorEnvelope =
    err instanceof z.ZodError
      ? toMcpErrorEnvelope('Tool input validation failed.', 'validation_error', {
          issues: toValidationIssues(err),
        })
      : toMcpErrorEnvelope(err instanceof Error ? err.message : String(err), 'execution_error')

  return toMcpTextResult(payload, true)
}

export function createMcpToolHandler(tool: ToolDefinition) {
  return async (input: Record<string, unknown>): Promise<McpToolResult> => {
    if (tool.mcpUnavailableMessage) {
      return toUnavailableResult(tool.mcpUnavailableMessage)
    }

    try {
      const parsed = tool.schema.parse(input)
      const result = await tool.execute(parsed)
      if (isFailureResult(result)) {
        return toFailureResult(result)
      }
      return toMcpTextResult(result)
    } catch (err) {
      return formatMcpToolError(err)
    }
  }
}

export function registerMcpTools(
  server: Pick<McpServer, 'tool'>,
  toolDefinitions: ToolDefinition[] = tools
): void {
  for (const tool of toolDefinitions) {
    server.tool(tool.name, tool.description, tool.schema.shape, createMcpToolHandler(tool))
  }
}

export function registerMcpResources(server: Pick<McpServer, 'resource'>): void {
  server.resource('accounts', 'shikin://accounts', async (uri) => {
    const accounts = query<Record<string, unknown>>(
      'SELECT id, name, type, currency, balance FROM accounts WHERE is_archived = 0 ORDER BY name'
    )
    const formatted = accounts.map((a) => ({
      ...a,
      balance: fromCentavos(a.balance as number),
    }))
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    }
  })

  server.resource('categories', 'shikin://categories', async (uri) => {
    const categories = query<Record<string, unknown>>(
      'SELECT id, name, type, color FROM categories ORDER BY type, name'
    )
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(categories, null, 2),
        },
      ],
    }
  })

  server.resource('recent-transactions', 'shikin://recent-transactions', async (uri) => {
    const transactions = query<Record<string, unknown>>(
      `SELECT t.id, t.description, t.type, t.amount, t.date, c.name as category, a.name as account
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN accounts a ON t.account_id = a.id
       ORDER BY t.date DESC, t.created_at DESC
       LIMIT 20`
    )
    const formatted = transactions.map((t) => ({
      ...t,
      amount: fromCentavos(t.amount as number),
    }))
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(formatted, null, 2),
        },
      ],
    }
  })
}

export function createMcpServer(toolDefinitions: ToolDefinition[] = tools): McpServer {
  const server = new McpServer({
    name: 'shikin',
    version: '0.1.0',
  })

  registerMcpTools(server, toolDefinitions)
  registerMcpResources(server)

  return server
}

async function main() {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

function isDirectExecution(importMetaUrl: string): boolean {
  const entryPoint = process.argv[1]
  if (!entryPoint) return false
  return pathToFileURL(entryPoint).href === importMetaUrl
}

if (isDirectExecution(import.meta.url)) {
  main().catch((err) => {
    console.error('MCP server error:', err)
    close()
    process.exit(1)
  })

  process.on('SIGINT', () => {
    close()
    process.exit(0)
  })
}
