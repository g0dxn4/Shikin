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
- Transfer writes are intentionally limited in the MVP: CLI transaction-write tools reject `type=transfer`. Record the withdrawal and matching deposit as separate entries with explicit account IDs until linked-transfer write support is added.
- Structured options must be valid JSON.
- The CLI reads and writes the shared Shikin database in `~/.local/share/com.asf.shikin/shikin.db`.

## Tool Discovery and Reference

- All CLI commands come from the shared tool definitions in `src/tools.ts` and are mirrored in MCP.
- `npx tsx src/cli.ts --help` lists every available CLI command and the required options.
- `npx tsx src/cli.ts diagnose` prints CLI/MCP surface counts plus available/unavailable tool names.
- `npx tsx src/cli.ts diagnose --deep` adds migration/integrity/balance diagnostics.
- MCP clients can discover the same tool set via the standard MCP `tools/list` flow and read resources listed below.

## Currency conversion behavior

`convert-currency` uses only the locally stored `exchange_rates` table:

- It looks up a stored pair for `FROM -> TO`, then falls back to an inverse rate if available.
- It uses the most recently stored matching rate in the table; it does not enforce freshness itself.
- If a stored rate is missing or invalid, it returns explicit guidance to refresh/import rates first.
- The CLI path does **not** fetch rates from the network.

To use currency conversion from CLI successfully, ensure rates are populated before calling the tool:

- run the desktop/web app once so it can refresh/cache rates, or
- import a DB snapshot that already contains populated `exchange_rates`, or
- insert/update rows directly in `exchange_rates` by another process/tool.

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
- `SHIKIN_SERVER_TRANSACTION_TTL_MS`: override the browser data-server transaction lease timeout (default `15000`).
- `SHIKIN_DATA_SERVER_MAX_JSON_BODY_BYTES`: override the data-server JSON request size limit.
- `SHIKIN_DATA_SERVER_MAX_DB_IMPORT_BYTES`: override the SQLite import payload size limit.

## Current Scope

- CLI and MCP share the same 41-tool definition catalog in `cli/src/tools.ts`.
- 39 tools are currently available end-to-end; 2 compatibility placeholders (`get-financial-news`, `get-congressional-trades`) return structured unavailable responses on both CLI and MCP surfaces.
- Debt payoff projections infer debts from negative credit-card account balances. Accounts do not store APR in the MVP, so CLI payoff estimates default APR to 0% and exclude interest.
- Subscription tools read Shikin's local `subscriptions` table for analytics. The browser subscriptions page is still a placeholder and is not wired to create, edit, or list those rows.
- The app does not ship a built-in chat assistant; external clients can connect through MCP or call the CLI directly.
