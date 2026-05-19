# Shikin CLI and MCP

Shikin exposes the local finance engine through a CLI and an MCP server.

## Install

For an installed desktop app, use the standalone CLI installer:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh
```

The Linux desktop installer also asks whether to install this support after the app install finishes.

For source development from the repo root:

```bash
pnpm install
cd cli && pnpm install
pnpm run build
```

The desktop app owns the `shikin` command. The installer places the automation bridge under Shikin's app data directory, so it does not create a second user-facing CLI command.

## AI Skill Pack

Shikin also distributes a neutral `Skill.md` reference for AI tools that support file-based skills. It is stored in the repo at `skills/shikin-cli-mcp/SKILL.md` and documents safe CLI/MCP usage, temp-data testing, command syntax, MCP configuration, expected tool counts, and verification commands.

Install a portable copy under Shikin app data:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh
```

Install directly into a supported tool or a custom skills root:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --opencode
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --agents
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-skill.sh | sh -s -- --dir ~/.config/my-ai-tool/skills
```

## CLI Usage

After the desktop launcher is installed and CLI support is installed:

```bash
shikin # open the app
shikin list-accounts
shikin add-transaction --amount 12.50 --type expense --description "Lunch" --account-id acct_123
shikin manage-recurring-transaction --action create --description "Rent" --amount 1200 --type expense --frequency monthly --account-id acct_123
shikin record-card-payment --from-account checking --card-account rewards-card --amount 250 --apply-to-latest-statement --dry-run
shikin finance-sanity-check --days-ahead 14 --json
shikin query-transactions --tag "tax prep" --json
shikin undo --last --dry-run --json
shikin diagnose

# Source/dev alternative
pnpm exec tsx src/cli.ts list-accounts
pnpm exec tsx src/cli.ts add-transaction --amount 12.50 --type expense --description "Lunch" --account-id acct_123
pnpm exec tsx src/cli.ts manage-recurring-transaction --action create --description "Rent" --amount 1200 --type expense --frequency monthly --account-id acct_123
pnpm exec tsx src/cli.ts diagnose
```

Notes:

- When multiple accounts exist, pass `--account-id` explicitly for commands that write transactions or recurring rules.
- One-off transfers are supported with `--type transfer --account-id <source> --transfer-to-account-id <destination>`. Recurring transfer rules are still deferred.
- Structured options must be valid JSON.
- The CLI reads and writes the shared Shikin database in `~/.local/share/com.asf.shikin/shikin.db`.

## Automation Workflows

Generic CLI/MCP workflows are available for automation clients and local scripts:

- `record-card-payment` records credit-card payments as transfers, cleanup expenses, or statement-only paid-amount updates. Dry-run previews include `balanceImpact`, statement impact, duplicate warnings, and audit previews.
- `credit-card-cycle-explain` explains current statement cycle, latest statement due date, next upcoming due date, and optional purchase-date classification without ambiguous `nextPaymentDueDate` wording.
- `create-placeholder-transaction`, `list-placeholder-transactions`, `resolve-placeholder-transaction`, and `split-placeholder-transaction` track unknown charges while preserving balance impact and audit history.
- `record --strict` adds confidence-based parsing for natural-language recording. Use `--min-confidence`, `--require-explicit-type`, `--require-explicit-account`, and `--require-explicit-amount` for automation-safe parsing.
- `tag-transaction`, `untag-transaction`, `list-tags`, and `query-transactions --tag <tag>` use the existing transaction tags JSON field for project-style labels and audit tag changes. Shikin does not create a separate project entity for these labels.
- `create-subscription-from-transaction` turns an existing expense or income transaction into a subscription using transaction defaults, with optional account/category/date/amount overrides, dry-run previews, transfer rejection, and audit provenance.
- `undo` is dry-run-first and can roll back transaction or credit-card-statement audit entries. Pass `--apply` only after reviewing the preview, `balanceImpact`, source/command filters, and dependent-write warnings.
- `finance-sanity-check` is the neutral daily-review-style command for overdue/due-soon card statements, unresolved placeholders, duplicate-looking transactions, upcoming subscriptions/recurring rules, low balances, balance mismatches, transaction hygiene issues, high Other Expenses, and recent provenance-tagged writes. Use `--redacted` and `--limit` for safer automation output.
- `list-plugins`, `enable-plugin`, and `disable-plugin` manage trusted-local CLI/MCP plugins. Plugin tools are disabled by default and appear as `plugin-<plugin-id>-<tool-name>` after explicit trusted-local approval.

Use `--source <label>` for generic provenance such as `manual`, `csv-import`, `mcp`, `scheduled-script`, `local-bot`, or another automation name. Source labels are opaque metadata, not trusted identities or product-specific behavior. Use `--note <text>` for the audit/changelog note; transaction `--notes` remain transaction details.

See [`../docs/reference/AUTOMATION-WORKFLOWS.md`](../docs/reference/AUTOMATION-WORKFLOWS.md) for the plan-delivered workflow additions, persistence updates, validation coverage, and hard-smoke checks.

## Tool Discovery and Reference

- Tool commands come from the shared definitions in `src/tools/index.ts` and are mirrored in MCP; CLI-only built-ins such as `diagnose`, `tools`, `validate`, and `record` are registered separately.
- `shikin --help` lists every available CLI command and the required options when the desktop launcher can reach the CLI bridge.
- `shikin diagnose` prints CLI/MCP surface counts plus available/unavailable tool names.
- `shikin diagnose --deep` adds migration/integrity/balance diagnostics.
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

Start the MCP server through the desktop-owned command:

```bash
shikin mcp

# Source/dev alternative
pnpm exec tsx src/mcp-server.ts
```

Claude Desktop example:

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

## Diagnostics

Use `diagnose` to confirm the shared database is ready for CLI/MCP use:

```bash
shikin diagnose
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

- CLI and MCP share the same tool definition catalog in `cli/src/tools/index.ts`, including `backup-database`, guarded `restore-database`, `undo`, `finance-sanity-check`, `audit-list`, `audit-show`, `automation-context`, and plugin management tools.
- `shikin tools --json` is the authoritative discovery contract and includes `catalogVersion`, `schemaVersion`, generation time, CLI/MCP compatibility counts, validation-scope notes, and required migration metadata.
- `setup-status` and the automation context tool expose existing goal, debt, and investment support surfaces. Investment support remains limited to stored holdings (`manage-investment`) and portfolio review (`generate-portfolio-review`).
- All shipped tools are available end-to-end against the local database.
- Debt payoff projections infer debts from negative credit-card account balances. Accounts do not store APR yet, so CLI payoff estimates default card APR to 0% and exclude interest for automatically inferred cards.
- Subscription tools read Shikin's local `subscriptions` table for analytics and bill forecasting.
- The app does not ship a built-in chat assistant; external clients can connect through MCP or call the CLI directly.
