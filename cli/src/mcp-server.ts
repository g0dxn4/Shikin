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

let activeRequestCount = 0
let shutdownStarted = false

function toMcpTextResult(payload: unknown, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  }
}

function shouldLogMcpRequests(): boolean {
  return process.env.SHIKIN_MCP_LOG === '1' || process.env.SHIKIN_MCP_LOG === 'true'
}

function logMcpEvent(event: string, details: Record<string, unknown>): void {
  if (!shouldLogMcpRequests()) {
    return
  }

  console.error(
    JSON.stringify({
      scope: 'shikin-mcp',
      event,
      timestamp: new Date().toISOString(),
      ...details,
    })
  )
}

function beginRequest(): void {
  activeRequestCount += 1
}

function endRequest(): void {
  activeRequestCount = Math.max(0, activeRequestCount - 1)
}

async function waitForInFlightRequests(timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (activeRequestCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function shutdownProcess(code: number, error?: unknown): Promise<never> {
  if (shutdownStarted) {
    process.exit(code)
  }

  shutdownStarted = true

  if (error) {
    console.error('MCP server error:', error)
  }

  await waitForInFlightRequests()
  close()
  process.exit(code)
}

function createResourceResponse(uri: URL, payload: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function createMcpResourceHandler(
  resourceName: string,
  resolver: () => unknown
): (uri: URL) => Promise<ReturnType<typeof createResourceResponse>> {
  return async (uri: URL) => {
    const startedAt = Date.now()
    beginRequest()

    try {
      const payload = await resolver()
      logMcpEvent('resource_completed', {
        resource: resourceName,
        durationMs: Date.now() - startedAt,
        success: true,
      })
      return createResourceResponse(uri, payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logMcpEvent('resource_completed', {
        resource: resourceName,
        durationMs: Date.now() - startedAt,
        success: false,
        error: message,
      })
      return createResourceResponse(
        uri,
        toMcpErrorEnvelope(message, 'execution_error', { resource: resourceName })
      )
    } finally {
      endRequest()
    }
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
    const startedAt = Date.now()
    beginRequest()

    if (tool.mcpUnavailableMessage) {
      const result = toUnavailableResult(tool.mcpUnavailableMessage)
      logMcpEvent('tool_completed', {
        tool: tool.name,
        durationMs: Date.now() - startedAt,
        success: false,
        errorType: 'unavailable_error',
      })
      endRequest()
      return result
    }

    try {
      const parsed = tool.schema.parse(input)
      const result = await tool.execute(parsed)
      if (isFailureResult(result)) {
        const failureResult = toFailureResult(result)
        logMcpEvent('tool_completed', {
          tool: tool.name,
          durationMs: Date.now() - startedAt,
          success: false,
          errorType: 'execution_error',
        })
        return failureResult
      }
      logMcpEvent('tool_completed', {
        tool: tool.name,
        durationMs: Date.now() - startedAt,
        success: true,
      })
      return toMcpTextResult(result)
    } catch (err) {
      logMcpEvent('tool_completed', {
        tool: tool.name,
        durationMs: Date.now() - startedAt,
        success: false,
        errorType: err instanceof z.ZodError ? 'validation_error' : 'execution_error',
        error: err instanceof Error ? err.message : String(err),
      })
      return formatMcpToolError(err)
    } finally {
      endRequest()
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
  server.resource(
    'accounts',
    'shikin://accounts',
    createMcpResourceHandler('accounts', () => {
      const accounts = query<Record<string, unknown>>(
        'SELECT id, name, type, currency, balance FROM accounts WHERE is_archived = 0 ORDER BY name'
      )
      return accounts.map((account) => ({
        ...account,
        balance: fromCentavos(account.balance as number),
      }))
    })
  )

  server.resource(
    'categories',
    'shikin://categories',
    createMcpResourceHandler('categories', () =>
      query<Record<string, unknown>>(
        'SELECT id, name, type, color FROM categories ORDER BY type, name'
      )
    )
  )

  server.resource(
    'recent-transactions',
    'shikin://recent-transactions',
    createMcpResourceHandler('recent-transactions', () => {
      const transactions = query<Record<string, unknown>>(
        `SELECT t.id, t.description, t.type, t.amount, t.date, c.name as category, a.name as account
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         LEFT JOIN accounts a ON t.account_id = a.id
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT 20`
      )
      return transactions.map((transaction) => ({
        ...transaction,
        amount: fromCentavos(transaction.amount as number),
      }))
    })
  )
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
    void shutdownProcess(1, err)
  })

  process.on('SIGINT', () => {
    void shutdownProcess(0)
  })

  process.on('SIGTERM', () => {
    void shutdownProcess(0)
  })
}
