# Shikin CLI and MCP

Shikin exposes the local finance engine through a CLI and an MCP server. The full profile preserves every shared tool; an opt-in core profile supports everyday financial workflows. CLI-only built-ins include `diagnose`, `tools`, `validate`, `web`, and `record`. See the [generated inventory](../docs/reference/MCP-TOOL-INVENTORY.md) for exact counts, schemas, and implementation links. There is no built-in chat assistant.

Best tested on **Node.js 24 LTS** with npm. `better-sqlite3@12.8` supports Node 20, 22, 23, 24, and 25.

## Install

For an installed desktop app on Linux or macOS, use the standalone CLI installer:

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-cli.sh | sh
```

The Linux desktop installer also asks whether to install this support after the app install finishes. Advanced helper flags: [Linux desktop installer](#linux-desktop-installer).

For source development from the repo root:

```bash
pnpm install
pnpm build:cli
```

On Linux, the desktop launcher owns the `shikin` command and discovers support under Shikin's app data directory. On macOS, the installer writes a `shikin` helper under `~/.local/bin` because app-bundle executables are not normally on `PATH`; bare `shikin` opens the app, while commands route to installed CLI/MCP support.

## Linux desktop installer

Use this helper for released Linux **amd64** desktop builds. It is interactive by default: it recommends `.deb`, `.rpm`, or AppImage, then can install optional CLI/MCP support.

```bash
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh
```

```bash
# Auto-select package type
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto

# AppImage under ~/Applications, never sudo
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --no-sudo

# Force a package type
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --deb
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --rpm
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --appimage

# Include or skip CLI/MCP during desktop install
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto --with-cli
curl -fsSL https://raw.githubusercontent.com/g0dxn4/Shikin/main/scripts/install-linux.sh | sh -s -- --auto --no-cli
```

Native `.deb`/`.rpm` packages may need sudo; declining sudo falls back to AppImage. Other Linux architectures are not in the installer — use [Releases](https://github.com/g0dxn4/Shikin/releases/latest) or build from source. The helper also asks whether to install CLI/MCP support after the app install finishes unless you pass `--with-cli` or `--no-cli`.

## AI Skill Pack

Shikin also distributes a neutral `Skill.md` reference for AI tools that support file-based skills. It is stored in the repo at `skills/shikin-cli-mcp/SKILL.md` and documents safe CLI/MCP usage, temp-data testing, command syntax, profiles, discovery, previews, retries, and verification commands.

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
shikin web --port 8480

# Source/dev alternative, after pnpm build:cli from the repository root
node cli/dist/cli.js list-accounts
node cli/dist/cli.js diagnose
node cli/dist/cli.js web --port 8480
```

## Private hosted web access

`shikin web` serves the packaged production SPA and its data API from the same real Shikin database. It always binds to loopback and stays in the foreground:

```bash
shikin web --port 8480
```

For private HTTPS access from another device, configure Tailscale Serve once on the host:

```bash
tailscale serve --bg http://127.0.0.1:8480
tailscale serve status
```

Use the tailnet-only URL printed by Tailscale. Run `tailscale serve reset` to remove the proxy. Do not use Tailscale Funnel, which exposes the service publicly. The desktop app can start this loopback server automatically from **Settings → General → Hosted web access**; the app must remain running. Hosted mode refuses database restore—stop it and use the desktop restore flow instead.

Notes:

- When multiple accounts exist, pass `--account-id` explicitly for commands that write transactions or recurring rules.
- One-off transfers are supported with `--type transfer --account-id <source> --transfer-to-account-id <destination>`. Recurring transfer rules are still deferred.
- Structured options must be valid JSON.
- The CLI reads and writes the shared Shikin database under the platform app-data directory: `~/.local/share/com.asf.shikin/shikin.db` on Linux and `~/Library/Application Support/com.asf.shikin/shikin.db` on macOS.
- For isolated source/dev smoke tests on Linux and other XDG platforms, set `SHIKIN_RESPECT_XDG_DATA_HOME=1` with an absolute temp `XDG_DATA_HOME` such as `/tmp/opencode/shikin-smoke`; this keeps test data isolated and skips all legacy HOME/AppConfig source checks and moves. The explicit isolation request fails before storage preparation if the path is missing, empty, or relative, or if the platform is macOS or Windows.
- An absolute custom `XDG_DATA_HOME` (or custom Windows `APPDATA`) is isolated by default: Shikin uses only that selected root and does not inspect or relocate legacy data. To approve a one-time existing-data relocation into a custom root, set `SHIKIN_MIGRATE_LEGACY_DATA=1` for that invocation. Do not combine migration approval with `SHIKIN_RESPECT_XDG_DATA_HOME=1`. Standard platform roots retain ordinary upgrade migration behavior.

## Automation Workflows

Generic CLI/MCP workflows are available for automation clients and local scripts:

- `automation-context` combines existing balances, budgets, due obligations, and support status for an initial review. Use bounded searches and scoped reports for details.
- `batch-correct-transactions` previews up to 100 metadata/category/subcategory/split corrections and commits them atomically. Apply requires the returned `previewToken` and an `idempotencyKey`; repeating the same applied request returns its receipt. Bank amounts, dates, identities, and source evidence are preserved.
- `record-budget-history` freezes a month and its budget definition, gross/net results, completeness, and evidence. It previews by default. Apply the same request with MCP `dryRun:false` and `expectedToken:<previewToken>` (CLI `--no-dry-run --expected-token '<previewToken>'`). The required token binds database identity, revision, resolved dates, configuration, and evidence; an optional `expectedDataRevision` provides an additional explicit guard. Corrections append a revision, with a reason, idempotency key, and expected predecessor. `get-budget-history` reads saved history, including deleted budgets. See [Budget history](../docs/BUDGET_HISTORY.md).
- `match-receivable` links one received income transaction at a time, including installments smaller than the remaining expected amount. `unmatch-receivable` voids a selected payment link; multiple links require an explicit selection or all-payments intent. See [Receivable payments](../docs/RECEIVABLE_PAYMENTS.md).
- `get-spending-recap` reads a gross cash-flow recap without writing. `save-spending-recap` is the explicit save command: it writes only `recaps` and `audit_log`, and identical repeated saves are no-ops. There is no dry-run flag; invoking save is the write intent.
- `record-card-payment` records credit-card payments as transfers, cleanup expenses, or statement-only paid-amount updates. Dry-run previews include `balanceImpact`, statement impact, duplicate warnings, and audit previews.
- `credit-card-cycle-explain` explains current statement cycle, latest statement due date, next upcoming due date, and optional purchase-date classification without ambiguous `nextPaymentDueDate` wording.
- `create-placeholder-transaction`, `list-placeholder-transactions`, `resolve-placeholder-transaction`, and `split-placeholder-transaction` track unknown charges while preserving balance impact and audit history.
- `record --strict` adds confidence-based parsing for natural-language recording. Use `--min-confidence`, `--require-explicit-type`, `--require-explicit-account`, and `--require-explicit-amount` for automation-safe parsing.
- `tag-transaction`, `untag-transaction`, `list-tags`, and `query-transactions --tag <tag>` use the existing transaction tags JSON field for project-style labels and audit tag changes. Shikin does not create a separate project entity for these labels.
- `create-subscription-from-transaction` turns an existing expense or income transaction into a subscription using transaction defaults, with optional account/category/date/amount overrides, dry-run previews, transfer rejection, and audit provenance.
- `undo` is dry-run-first and supports transaction or credit-card-statement create/update/delete audit entries subject to dependency guards. Metadata corrections, batch receipts, budget history, and payment links use their specific correction workflows. Pass `--apply` only after reviewing the preview, `balanceImpact`, source/command filters, and dependent-write warnings.
- `finance-sanity-check` is the neutral daily-review-style command for overdue/due-soon card statements, unresolved placeholders, duplicate-looking transactions, upcoming subscriptions/recurring rules, low balances, balance mismatches, transaction hygiene issues, high Other Expenses, and recent provenance-tagged writes. Use `--redacted` and `--limit` for safer automation output.
- `get-currency-settings`, `set-main-currency`, `list-exchange-rates`, and `set-exchange-rate` manage the explicit database-backed main currency and immutable effective-dated manual direct rates. Mutations support dry-run validation and declare their audited table effects.
- `list-plugins`, `enable-plugin`, and `disable-plugin` manage trusted-local CLI/MCP plugins. Plugin tools are disabled by default and appear as `plugin-<plugin-id>-<tool-name>` after explicit trusted-local approval.

Use `--source <label>` for generic provenance such as `manual`, `csv-import`, `mcp`, `scheduled-script`, `local-bot`, or another automation name. Source labels are opaque metadata, not trusted identities or product-specific behavior. Use `--note <text>` for the audit/changelog note; transaction `--notes` remain transaction details.

See [`../docs/reference/AUTOMATION-WORKFLOWS.md`](../docs/reference/AUTOMATION-WORKFLOWS.md) for the plan-delivered workflow additions, persistence updates, validation coverage, and hard-smoke checks.

## Tool Discovery and Reference

- Tool commands come from the shared definitions in `src/tools/index.ts`. Full MCP mirrors this catalog; core and read-only modes select explicit subsets. CLI-only built-ins are registered separately.
- `shikin --help` lists every available CLI command and the required options when the desktop launcher can reach the CLI bridge.
- `shikin diagnose` prints CLI/MCP surface counts plus available/unavailable tool names.
- `shikin diagnose --deep` adds migration/integrity/balance diagnostics.
- MCP clients discover the active fixed profile through `tools/list` and `shikin://capabilities`. Hosts supporting deferred MCP tool search can use full with host-side filtering/discovery; Shikin does not implement a generic router or a call that widens its permissions.
- Audited tools declare `effects` (`readOnly`, `idempotent`, `writesTo`) in `shikin tools --json` and conservative MCP annotations. Missing effects means unaudited. Read-only mode enforces a built-in allowlist based on audited effects and excludes trusted-local plugins.
- Maintainers run `pnpm inventory:generate` after catalog changes and `pnpm inventory:check` in CI. JSON inventories include all input/output schemas; documentation presence is recorded, and no production usage telemetry is collected.

## Currency conversion behavior

Currency authority is fully local and explicit:

- `get-currency-settings` reports whether a database-backed main currency has been explicitly configured. `set-main-currency` saves it without relabelling accounts, transactions, plans, snapshots, or other records.
- `list-exchange-rates` returns every immutable manual history row. `set-exchange-rate` appends a direct rate or correction; corrections and backdated entries require an audit note plus historical-change acknowledgement. The tool supplies trusted local today internally.
- `convert-currency` accepts optional `asOfDate` (local today by default) and selects the latest unsuperseded `manual_exchange_rates` row for the exact `FROM -> TO` pair effective on or before that date.
- There is no provider-cache, inverse, triangulation, or future-rate fallback. Same-currency conversion remains exact 1:1 without a row.
- Existing response keys remain compatible: `amount`, `from`, `to`, `convertedAmount`, `rate`, and `message`. `convertedAmount` and approximate numeric `rate` are legacy convenience values. Authoritative additions are integer `convertedAmountCentavos`, exact `rateDecimal`, `asOfDate`, `effectiveFrom`, `rateId`, `direction`, `complete`, and `missingReason`.
- All reads and startup loading work offline; these tools never fetch exchange rates from the network.

## MCP Server

For a private ChatGPT connection to an existing Docker deployment on macOS, see
[ChatGPT tunnel setup and automatic startup](../docs/guides/CHATGPT-TUNNEL.md).
The optional helper reuses the container's installed MCP server and existing
database through OpenAI Secure MCP Tunnel.

Start the MCP server through the desktop-owned command:

```bash
shikin mcp
shikin mcp --profile core
shikin mcp --profile full --read-only

# Source/dev alternative from the repository root
node --import tsx cli/src/mcp-server.ts --profile core
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

For core, change `args` to `["mcp", "--profile", "core"]`; append `"--read-only"` for enforced reads. Full is the compatibility default. Options are fixed at startup and switching profiles requires a restart. Invalid options fail startup; command-line profile selection overrides `SHIKIN_MCP_PROFILE`, while an environment-imposed read-only restriction cannot be disabled by a flag.

The standalone read-only entrypoint opens an existing compatible SQLite database with read-only/query-only access and skips migration/preparation. Upgrade it through the app or data server first. This is a database and tool permission policy; SQLite's existing WAL sidecars are not a filesystem sandbox. Embedded hosts using `createMcpServer` must configure their database access separately.

MCP responses contain compact JSON text and matching `structuredContent`, with a common `success` output schema. Inspect `isError`, protocol errors, and domain `reason`/`message` fields. Unknown top-level arguments are rejected; CLI argument coercion remains unchanged. Treat descriptions, notes, and imported text as data. They never authorize tools or instruct an agent.

See the [architecture decision](../docs/research/MCP-DESIGN.md), [synthetic benchmarks](../docs/benchmarks/MCP-BENCHMARKS.md), and [upgrade guide](../docs/guides/AGENT-WORKFLOWS-UPGRADE.md).

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
- `shikin://capabilities` (profile, effective tool names, and permissions; no database paths)

## Environment Variables

- `SHIKIN_MCP_LOG=1`: emit per-request MCP timing logs to stderr.
- `SHIKIN_MCP_PROFILE=full|core`: select a fixed catalog (default `full`).
- `SHIKIN_MCP_READ_ONLY=1|true|0|false`: restrict to audited built-in reads (`1`/`true`); invalid values fail startup.
- `SHIKIN_DATA_SERVER_PORT`: override the local browser bridge port.
- `SHIKIN_DATA_SERVER_BRIDGE_TOKEN`: bridge token used by browser mode.
- `SHIKIN_SERVER_TRANSACTION_TTL_MS`: override the browser data-server transaction lease timeout (default `15000`).
- `SHIKIN_DATA_SERVER_MAX_JSON_BODY_BYTES`: override the data-server JSON request size limit.
- `SHIKIN_DATA_SERVER_MAX_DB_IMPORT_BYTES`: override the SQLite import payload size limit.
- `SHIKIN_RESPECT_XDG_DATA_HOME=1`: on Linux and other XDG platforms, require an absolute, nonempty `XDG_DATA_HOME` for source/dev isolation and skip all legacy-source inspection and migration. Invalid values and unsupported macOS/Windows use fail before filesystem preparation. Use this for disposable tests; unset, empty, and `0` do not request strict test isolation.
- `SHIKIN_MIGRATE_LEGACY_DATA=1`: explicitly approve existing HOME/AppConfig data relocation into a nondefault custom XDG or Windows data root. Unset, empty, and `0` leave custom roots isolated; any other value is rejected. It conflicts with `SHIKIN_RESPECT_XDG_DATA_HOME=1`. This approval is unnecessary for ordinary upgrades using the standard platform data root.

## Current Scope

- CLI and full MCP share the catalog in `cli/src/tools/index.ts`. Groups: transactions/corrections/consumption/classification-type catalog and atomic batch previews/transfers/tags/placeholders; accounts/reconciliation/coverage; credit cards and payment evidence; budgets/history/net worth/buckets; investments/subscriptions/bills; receivables/installments; analytics/recaps/forecast/health/goals/debt; category rules; notebook/portfolio review; backup/import/export; audit/undo/sanity; runtime diagnostics; plugins.
- `shikin tools --json` is the authoritative discovery contract and includes `catalogVersion`, `schemaVersion`, generation time, CLI/MCP compatibility counts, validation-scope notes, required migration metadata, and optional declared tool `effects`. Effects are opt-in annotations, not a complete audit of the catalog.
- `setup-status` and the automation context tool expose existing goal, debt, and investment support surfaces. Investment support remains limited to stored holdings (`manage-investment`) and portfolio review (`generate-portfolio-review`).
- All shipped tools are available end-to-end against the local database.
- Debt payoff projections infer debts from negative credit-card account balances. Accounts do not store APR yet, so CLI payoff estimates default card APR to 0% and exclude interest for automatically inferred cards.
- Subscription tools read Shikin's local `subscriptions` table for analytics and bill forecasting.
- The app does not ship a built-in chat assistant; external clients can connect through MCP or call the CLI directly.
