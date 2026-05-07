---
name: shikin-cli-mcp
description: Portable AI skill for operating, testing, and integrating Shikin's local-first CLI and MCP server, including command syntax, safe temp data setup, tool catalog expectations, and MCP client configuration.
---

# Shikin CLI and MCP

## Goal

Use Shikin's desktop-owned `shikin` command and MCP server safely and consistently from AI assistants and automation tools.

## Safety Rules

- Do not run write commands against the user's real finance database unless they explicitly ask for it.
- For tests and smoke checks, set `XDG_DATA_HOME` to a temp directory under `/tmp/opencode` so Shikin uses an isolated database.
- Initialize a temp database with `scripts/data-server.mjs`; it runs migrations and seeds default categories.

## User-Facing UX

- `shikin` launches the desktop app.
- `shikin <command>` runs finance CLI commands.
- `shikin mcp` starts the MCP stdio server.
- The npm package must not own a public `shikin` binary. It installs support bridges used by the desktop-owned command.
- Use `shikin --help` and `shikin diagnose --deep` for installed-user diagnostics.

## Source/Development UX

Use these commands from the repository root when testing locally:

```bash
pnpm --dir cli build
node cli/dist/cli.js --help
node cli/dist/cli.js diagnose --deep
node cli/dist/mcp-server.js
```

For temp-data smoke tests:

```bash
XDG_DATA_HOME=/tmp/opencode/shikin-smoke node scripts/data-server.mjs
XDG_DATA_HOME=/tmp/opencode/shikin-smoke node cli/dist/cli.js list-accounts
```

`scripts/data-server.mjs` keeps serving after migrations, so automated tests should spawn it, wait for `[data-server] Listening`, then terminate it before running CLI/MCP checks.

## CLI Conventions

- Commands print JSON.
- Failed domain operations return JSON with `success: false` and should exit non-zero.
- Flags are generated from schema keys as kebab-case, for example `accountId` becomes `--account-id`.
- Structured flags use JSON strings, for example `--splits '[{"categoryId":"...","amount":12},{"categoryId":"...","amount":18}]'`.
- `query-transactions` has alias `list-transactions`.
- `get-spending-summary --period` accepts `week`, `month`, `year`, or `custom`.

## MCP Configuration

MCP-compatible clients should run the desktop-owned command:

```json
{
  "command": "shikin",
  "args": ["mcp"]
}
```

For JSON configs that group servers by name:

```json
{
  "mcpServers": {
    "shikin": {
      "command": "shikin",
      "args": ["mcp"]
    }
  }
}
```

The MCP server exposes the same shared tool catalog as the CLI and these resources:

- `shikin://accounts`
- `shikin://categories`
- `shikin://recent-transactions`

## Representative Tool Surface

Current catalog size is 68 tools. All shipped tools are available end-to-end against the local database.
The lists below are representative groups for orientation; use `shikin tools --json` for the authoritative command, argument, enum, catalog/schema version, compatibility, and required-migration metadata.

Transaction tools:

- `add-transaction`
- `update-transaction`
- `delete-transaction`
- `query-transactions`
- `get-spending-summary`
- `split-transaction`

Account and analytics tools:

- `list-accounts`
- `create-account`
- `update-account`
- `delete-account`
- `list-categories`
- `get-balance-overview`
- `analyze-spending-trends`
- `get-credit-card-status`
- `get-net-worth`

Budget, planning, and health tools:

- `create-budget`
- `get-budget-status`
- `delete-budget`
- `create-goal`
- `update-goal`
- `get-goal-status`
- `get-financial-health-score`
- `get-spending-recap`
- `get-education-tip`
- `get-debt-payoff-plan`

Investment, subscription, and automation tools:

- `manage-investment`
- `get-upcoming-bills`
- `list-subscriptions`
- `get-subscription-spending`
- `manage-category-rules`
- `manage-recurring-transaction`
- `materialize-recurring`
- `get-spending-anomalies`
- `get-forecasted-cash-flow`
- `convert-currency`
- `backup-database` (CLI also has alias `backup`)
- `restore-database` (CLI also has alias `restore`; guarded restore refuses unsafe active handles)
- `audit-list`
- `audit-show`
- `assistant-context`

Goal, debt, and investment support is discoverable through `setup-status` and `assistant-context`. Investment support intentionally stays on the existing `manage-investment` and `generate-portfolio-review` tools; do not assume broader broker sync or price-fetching capabilities from this skill.

Notebook tools:

- `write-notebook`
- `read-notebook`
- `list-notebook`
- `generate-portfolio-review`

## Verification Checklist

Run focused checks after CLI/MCP changes:

```bash
pnpm --dir cli build
pnpm test:run cli/src
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm lint
```

For a high-confidence live smoke, use a temp `XDG_DATA_HOME`, initialize with `scripts/data-server.mjs`, run each CLI command through `node cli/dist/cli.js`, and connect to `node cli/dist/mcp-server.js` with an MCP stdio client to verify `listTools`, representative `callTool`, and resource reads.
