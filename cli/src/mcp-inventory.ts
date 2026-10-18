import { performance } from 'node:perf_hooks'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from './mcp-server.js'
import { DEFAULT_MCP_OPTIONS, type McpOptions } from './mcp-profiles.js'
import { builtInTools } from './tools.js'

/** Capture the actual negotiated MCP contract, without opening a financial database. */
export async function inspectMcpCatalog(options: McpOptions = DEFAULT_MCP_OPTIONS) {
  const server = createMcpServer(builtInTools, options)
  const client = new Client({ name: 'shikin-catalog-inspector', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const start = performance.now()
  try {
    await server.connect(serverTransport)
    await client.connect(clientTransport)
    const initialized = performance.now()
    const catalog = await client.listTools()
    const listed = performance.now()
    const serialized = JSON.stringify(catalog)
    return {
      options,
      catalog,
      metrics: {
        toolCount: catalog.tools.length,
        schemaBytes: Buffer.byteLength(serialized, 'utf8'),
        schemaCharacters: serialized.length,
        initializeMs: initialized - start,
        listMs: listed - initialized,
      },
    }
  } finally {
    await client.close()
    await server.close()
  }
}
