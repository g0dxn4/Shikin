#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { tools } from './tools.js'
import { query, close } from './database.js'
import { fromCentavos } from './money.js'

const server = new McpServer({
  name: 'shikin',
  version: '0.1.0',
})

// Register all 43+ tools
for (const tool of tools) {
  server.tool(
    tool.name,
    tool.description,
    tool.schema.shape,
    async (input: Record<string, unknown>) => {
      try {
        const parsed = tool.schema.parse(input)
        const result = await tool.execute(parsed)
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        }
      } catch (err) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        }
      }
    }
  )
}

// Register MCP resources for quick reads
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

// Start server
async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('MCP server error:', err)
  close()
  process.exit(1)
})

process.on('SIGINT', () => {
  close()
  process.exit(0)
})
