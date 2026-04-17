# Shikin CLI and MCP

Shikin exposes the local finance engine through a CLI and an MCP server.

## Install

From the repo root:

```bash
pnpm install
cd cli && npm install
```

## CLI Usage

Run commands from `cli/`:

```bash
npx tsx src/cli.ts list-accounts
npx tsx src/cli.ts add-transaction --amount 12.50 --type expense --description "Lunch" --account-id acct_123
npx tsx src/cli.ts manage-recurring-transaction --action create --description "Rent" --amount 1200 --type expense --frequency monthly --account-id acct_123
npx tsx src/cli.ts diagnose
```

Notes:

- When multiple accounts exist, pass `--account-id` explicitly for commands that write transactions or recurring rules.
- Structured options must be valid JSON.
- The CLI reads and writes the shared Shikin database in `~/.local/share/com.asf.shikin/shikin.db`.

## MCP Server

Start the MCP server from `cli/`:

```bash
npx tsx src/mcp-server.ts
```

Claude Desktop example:

```json
{
  "mcpServers": {
    "shikin": {
      "command": "npx",
      "args": ["tsx", "/path/to/Shikin/cli/src/mcp-server.ts"]
    }
  }
}
```

## Diagnostics

Use `diagnose` to confirm the shared database is ready for CLI/MCP use:

```bash
npx tsx src/cli.ts diagnose
```

This prints JSON with:

- tool count
- CLI/MCP available vs unavailable tool counts
- unavailable tool names by surface
- migration count
- latest migration marker
- account/category/transaction counts

`diagnose` is a CLI-only preflight command. Use it before starting the MCP server when you want a quick readiness check against the shared database and current tool surface.

## MCP Resources

The MCP server also exposes read-only resources:

- `shikin://accounts`
- `shikin://categories`
- `shikin://recent-transactions`

## Environment Variables

- `SHIKIN_MCP_LOG=1`: emit per-request MCP timing logs to stderr.
- `SHIKIN_DATA_SERVER_PORT`: override the local browser bridge port.
- `SHIKIN_DATA_SERVER_BRIDGE_TOKEN`: bridge token used by browser mode.
- `SHIKIN_DATA_SERVER_MAX_JSON_BODY_BYTES`: override the data-server JSON request size limit.
- `SHIKIN_DATA_SERVER_MAX_PROXY_BODY_BYTES`: override the ChatGPT proxy request size limit.
- `SHIKIN_DATA_SERVER_MAX_DB_IMPORT_BYTES`: override the SQLite import payload size limit.

## Current Scope

- CLI and MCP share the same 44-tool definition catalog in `cli/src/tools.ts`.
- 42 tools are currently available end-to-end; 2 compatibility placeholders (`get-financial-news`, `get-congressional-trades`) return structured unavailable responses on both CLI and MCP surfaces.
- The app does not ship a built-in AI chat UI; AI integrations connect through MCP or call the CLI directly.
