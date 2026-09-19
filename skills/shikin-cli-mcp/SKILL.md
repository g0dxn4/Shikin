---
name: shikin-cli-mcp
description: Portable AI skill for operating, testing, and integrating Shikin's local-first CLI and MCP server, including command syntax, safe temp data setup, tool catalog expectations, and MCP client configuration.
---

# Shikin CLI and MCP

## Goal

Use Shikin's desktop-owned `shikin` command and MCP server safely and consistently from AI assistants and automation tools.

## Safety Rules

- Do not run write commands against the user's real finance database unless they explicitly ask for it.
- For tests and smoke checks, set `SHIKIN_RESPECT_XDG_DATA_HOME=1` with an absolute `XDG_DATA_HOME` under `/tmp/opencode` so Shikin uses an isolated database and does not auto-move legacy HOME/AppConfig data into the temp dir.
- Initialize a temp database with `scripts/data-server.mjs`; it runs migrations and seeds default categories.
- Prefer dry-run or preview modes before writes (`--dry-run`, `--apply` only after review, or tool-specific preview defaults).
- Treat `source` as an opaque provenance label and `note` as audit/changelog metadata. Transaction `notes` are user-facing transaction details.
- Use redacted output (`--redacted` or tool `redacted: true`) when returning finance details into shared logs, transcripts, or automation systems.

## User-Facing UX

- `shikin` launches the desktop app.
- `shikin <command>` runs finance CLI commands.
- `shikin web --port 8480` serves the packaged app on loopback for private Tailscale Serve access.
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
SHIKIN_RESPECT_XDG_DATA_HOME=1 XDG_DATA_HOME=/tmp/opencode/shikin-smoke node scripts/data-server.mjs
SHIKIN_RESPECT_XDG_DATA_HOME=1 XDG_DATA_HOME=/tmp/opencode/shikin-smoke node cli/dist/cli.js list-accounts
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

Current catalog size is 108 shared CLI/MCP tools and 113 total CLI commands including CLI-only built-ins. All shipped tools are available end-to-end against the local database.
The lists below are representative groups for orientation; use `shikin tools --json` for the authoritative command, argument, enum, catalog/schema version, declared-effects, compatibility, and required-migration metadata. Effects are declaration-only: absence means unaudited, not read-only.

Transaction tools:

- `add-transaction`
- `update-transaction`
- `delete-transaction`
- `correct-transaction-metadata`
- `set-transaction-consumption`, `clear-transaction-consumption`
- `bind-transaction-import-identity`
- `query-transactions`
- `match-transfer-transactions`, `unmatch-transfer-transactions`
- `get-spending-summary`
- `split-transaction`
- `tag-transaction`, `untag-transaction`, `list-tags` (project-style labels stored as transaction tags, not a separate project entity)

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
- `reconcile` (apply requires `basis=effective_ledger`)
- `set-source-coverage`, `list-source-coverage`
- `settle-staged-transactions`
- `finalize-staged-statement-history`
- `supersede-reconciliation-bridge`
- `update-bucket`, `delete-bucket`, `reverse-bucket-allocation`, `correct-bucket-allocation`
- `link-card-statement-payment`, `unlink-card-statement-payment`, `list-card-statement-payment-links`

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
- `list-investments`
- `manage-receivable`, `list-receivables`, `match-receivable`, `unmatch-receivable`
- `get-upcoming-bills`
- `list-subscriptions`
- `get-subscription-spending`
- `create-subscription-from-transaction`
- `manage-category-rules`
- `manage-recurring-transaction`
- `materialize-recurring`
- `get-spending-anomalies`
- `get-forecasted-cash-flow`
- `convert-currency`
- `backup-database` (CLI also has alias `backup`)
- `restore-database` (CLI alias: `restore`; previews by default, requires `apply:true` to replace data, and keeps a rollback backup)
- `audit-list`
- `audit-show`
- `undo`
- `finance-sanity-check`
- `automation-context`
- `get-runtime-diagnostics` (read-only opaque build/schema/lineage/local-instance status; no storage paths)

Goal, debt, and investment support is discoverable through `setup-status` and `automation-context`. Investment support includes `manage-investment`, `list-investments`, and `generate-portfolio-review`; do not assume broker sync or automatic price fetching.

Notebook tools:

- `write-notebook`
- `read-notebook`
- `list-notebook`
- `generate-portfolio-review`

## Safe Workflow Patterns

- For money movement, run dry-run previews first. Examples: `record-card-payment --dry-run`, placeholder create/resolve/split dry-runs, and `undo` without `--apply`.
- Spending and recaps use gross cash flow by default. Request net consumption explicitly, and treat incomplete classification or independently verified source coverage as known subtotals—not a complete net result. Transaction date extrema do not prove coverage.
- Use `correct-transaction-metadata` for audited metadata changes; it never rewrites immutable original source/import evidence, money, or balances. Set consumption ownership explicitly at transaction/split level and preserve reference caps.
- For imports, keep case-sensitive source namespaces/external IDs separate from content fingerprints. Unreviewed apply is atomic only when no decisions are required; otherwise submit exact candidate decisions with a fresh preview token. Use `bind-transaction-import-identity` only for explicitly verified legacy identity; it does not invent an original content fingerprint. Traverse imports with `query-transactions` keyset cursors and restart if a write makes a cursor stale.
- For incomplete statement history, import rows with `ledgerTreatment=staged_no_balance_impact` and one `stagingBatchId`. Record independent printed-period coverage, explicitly settle pending rows, then preview and finalize exact posted/cleared membership. Pending rows never auto-promote. If later reconciliation anchors block finalization, use reviewed bridge supersession with the exact fresh token.
- For reconciliation, preview `reconcile` first and inspect the effective ledger, stored balance, and bridge. Apply only with `basis=effective_ledger` after confirming the observed balance.
- Use `accountMode=snapshot_only` for observed valuation accounts that do not have a transaction ledger. Transaction writers reject snapshot-only accounts; create a new transactional account instead of changing the balance basis after history exists.
- Cashflow buckets are virtual envelopes. Reverse/correct allocations by appending linked negative reversal/replacement rows; these workflows must not change real accounts or transactions.
- For card payment evidence, maintain `paid = unattributed baseline + active links`. Use `apply_to_unpaid` for new paid evidence and `attribute_existing` to assign existing baseline. Unlinking voids the link while preserving immutable IDs and leaves transactions/account balances unchanged.
- For exact own-account payment pairs, preview `match-transfer-transactions`; use `unmatch-transfer-transactions` to reverse a mistaken link without deleting either imported row.
- For investments, provide explicit holding ownership plus exact decimal manual price, provider, instrument ID, exchange, and quote currency; do not infer or claim provider verification.
- For expected client income, use receivables rather than pending transactions. Preview `match-receivable` and use `unmatch-receivable` for corrections.
- For subscription automation, use `create-subscription-from-transaction` against an existing expense or income transaction. Review derived defaults and overrides before applying; transfers are not valid subscription sources.
- For project-style organization, use transaction tags: `tag-transaction`, `untag-transaction`, `list-tags`, and `query-transactions --tag <tag>`.
- For rollback, start with `undo --last --dry-run` or filter by `--audit-id`, `--transaction-id`, `--statement-id`, `--source`, `--command`, or `--account`. Apply only after checking dependent-write warnings and balance impact.
- For a neutral daily review, use `finance-sanity-check --redacted --limit <n>` to inspect due card statements, unresolved placeholders, duplicate-looking transactions, upcoming bills, balance mismatches, transaction hygiene, high Other Expenses, and recent provenance-tagged writes.
- `get-runtime-diagnostics` is a read-only installed-instance check. Its result is intentionally opaque and contains no filesystem paths; reading it must not initialize an identity sidecar.
- Before an automation contract upgrade, create a backup and upgrade the desktop app, CLI bridge, and MCP server together. Rollback means restoring that backup and the matching prior binaries. Do not assume an old binary can enforce guards introduced by a future schema.

## Verification Checklist

Run focused checks after CLI/MCP changes:

```bash
pnpm --dir cli build
pnpm test:run cli/src
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm lint
```

For a high-confidence live smoke, use `SHIKIN_RESPECT_XDG_DATA_HOME=1` plus a temp absolute `XDG_DATA_HOME`, initialize with `scripts/data-server.mjs`, run each CLI command through `node cli/dist/cli.js`, and connect to `node cli/dist/mcp-server.js` with an MCP stdio client to verify `listTools`, representative `callTool`, and resource reads.
