# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

### Changed

- Removed the unused undated currency-conversion API (`convertCurrencyTotals` and its types) from `@shikin/finance-core`. Ledger conversions use only exact, dated manual exchange-rate evidence.
- Bills calculates monthly equivalents with exact core arithmetic: a weekly 37.00 bill is now 160.77/month (was 160.76), and a few near-limit amounts move by one cent. Rules with an unknown frequency, an invalid amount, or an oversized amount show an unavailable estimate with a reason instead of an invented number. Their rows still appear.
- Reports, forecasts, and spending insights are no longer discarded or reloaded when the same currency history is simply reloaded. A real change (main currency, or an added, removed, or reordered exchange-rate record) still invalidates them, and missing currency authority still shows as incomplete.
- Recurring catch-up is all-or-nothing in the CLI, app, and browser bridge: if any due rule fails, no occurrences, balances, or next dates change. New occurrences keep the rule's subcategory, tags, and destination. Archived accounts, invalid anchor days, and unknown frequencies are refused consistently. If entries are saved but the screen fails to refresh, the app shows a warning instead of reporting a failed save.
- Update controls in the app and in Settings ignore repeat clicks while a check, install, or restart is already running, so an update never installs twice. If the available version is already installed, Settings offers Restart instead of Install.
- New financial writes (add, import, update, delete, match/unmatch, placeholders, undo, recurring posting, card payments, reconciliation) and ledger projections now refuse malformed or incomplete evidence consistently across the CLI, app, and browser bridge, with nothing written. Examples: unknown statuses, negative or fractional amounts, self-transfers, pending transfers without a destination, malformed currencies. Existing records are never rewritten. Editing or deleting an ambiguous historical row explains the correction needed instead of guessing. Currency comparisons ignore case and surrounding spaces everywhere, as the shared core already did.

### Internal structure

- Current database schema metadata (migration names, version, readiness columns) now has a single owner in finance-core, shared by the CLI, desktop/browser adapter, and data bridge. Historical migration vocabularies are pinned. No schema, migration output, or restore behavior changed.
- Persisted import-review evidence rules (fingerprint material, same-source identity, decision matching) are shared from finance-core by the CLI importer and in-app statement import. Stored decisions remain compatible across both.
- Gross cash-flow eligibility SQL and report integrity validation are defined once in finance-core reporting. CLI and app report adapters keep their own queries and messages.
- Strict investment instrument identity decoding moved next to its encoder in finance-core valuation. Quote-chart availability is unchanged.
- The local data bridge's database connection, request gate, transaction leases, restore, and shutdown state now have one owner module (`scripts/data-server-session.mjs`). Ordering, lease, restore, and shutdown behavior is unchanged.
- CLI CSV import and `add-transaction` share a typed internal transaction-preparation module (`cli/src/transaction-mutations.ts`) instead of the importer calling the public tool. Tool schemas, previews, and import results are unchanged.
- CLI credit-card statement display amounts, effective status, and bill-entry reads come from one module (`cli/src/statement-read.ts`), used by card tools, automation context, and upcoming bills. Displayed statuses and amounts are unchanged.
- The bulk consumption-classification dialog's session logic (context, preview, apply, receipt) lives in a feature hook (`use-consumption-bulk-session.ts`), separate from allocation rendering. Reviewed payloads and apply protections are unchanged.
- The statement-import dialog's session state and actions live in a feature hook (`use-statement-import-session.ts`). Reviewed-input binding, draft recovery, and commit-after-close refresh are unchanged.
- Transaction full-edit, inline-review, delete, and metadata-only availability come from operation-specific selectors in `transaction-inspection-eligibility.ts` instead of inline page and dialog conditions. Availability and protection-message precedence are unchanged.
- The dashboard `NetWorthPeriod` type lives in `overview-account-comparison-helpers.ts`, removing the only file-level import cycle in the app (type-only). No runtime change.
- Frontend transaction evidence reads, capacity guards, and correction auditing live in `src/lib/transaction-evidence.ts`. Split and card-payment workflows keep their own read schedules.
- Overview chart tick budgets and locale handling come from one policy module (`overview-chart-policy.ts`) shared by the three overview charts. Chart output is unchanged.
- Native (desktop) database schema migration and readiness helpers live in `src/lib/tauri-database-schema.ts`, separate from the connection, queue, and restore lifecycle in `src/lib/database.ts`.
- CLI audit snapshot codecs and generic undo replay live in dedicated modules (`cli/src/{transaction-audit,statement-audit,audit-read,transaction-values}.ts`, `cli/src/tools/undo.ts`). Persisted audit JSON and undo behavior are unchanged.
- Removed three unused account-action exports (`AccountMaintenanceAction`, `CardStatementsAction`, `PaymentEvidenceIcon`); the controlled dialogs and account page are unchanged.
- Removed the unreachable legacy live exchange-rate service (`src/lib/exchange-rate-service.ts`). Dated manual FX remains the only rate authority; stored historical rate data is untouched. Docs no longer claim automatic online rate refresh.
- The local data bridge has an explicit startup entry (`scripts/data-server-runtime.mjs`) and a separate migrations module (`scripts/data-server-migrations.mjs`). Importing them no longer starts a server; `node scripts/data-server.mjs` and `shikin web` behave as before.
- Ledger posting legs (signs, transfer legs, pending/staged/archive eligibility) are built by one finance-core function with closed per-caller compatibility profiles for the CLI, app store, undo, and strict core. Every caller's results are unchanged.
- The investment store's currency-history subscription uses the shared `currencyAuthorityKey` instead of its own copy of the comparison. Freshness behavior is unchanged.
- App and Settings share per-instance update download progress mechanics (`src/hooks/use-update-download-progress.ts`). Their distinct install and restart flows are unchanged.
- Statement import, account maintenance, and legacy import-identity actions keep their post-commit refresh and invalidation steps in dedicated `src/lib/*-actions.ts` modules, separate from persistence. Refresh and invalidation behavior is unchanged.
- The large CLI tool bundles (`audit-and-context`, `data-ops`, `investments-and-subscriptions`) are split into focused modules (transaction queries, spending summary, audit history, automation context, finance sanity, CSV import, export, backup, finance profile, investments, subscriptions, upcoming bills). All 118 tools keep their order, names, schemas, and output; the public inventory now also pins tool order.
- Manual and scheduled investment quote updates share one publication sequence (`src/lib/investment-price-publication.ts`: failures → save → timestamp → holdings refresh). Provider calls, cadence, and partial-failure behavior are unchanged.
- Built-in CLI commands are described once in an ordered descriptor list that drives both Commander registration and catalog discovery. Help text, flags, defaults, aliases, and `tools --json` output are byte-identical.

## [1.2.1] - 2026-10-17

Prepared release notes.

### Private ChatGPT tunnel for existing Docker MCP

- Optional macOS host helper forwards an already installed Shikin MCP server inside a running Docker container over a private outbound OpenAI Secure MCP Tunnel, with LaunchAgent login supervision, readiness checks, and diagnostics.
- Rejected or partial setup cleanup is ownership-safe. Equivalent state-path spellings identify the same installation; interior `..` follows the real parent after existing symlink components, and a path that is itself a symlink is rejected.
- `list-accounts` now declares audited read-only metadata (`effects.readOnly` and MCP `readOnlyHint: true`).

### Upgrade notes

- Back up first.
- No schema migration is introduced from 1.2.0.
- The helper does not install or replace the Docker CLI/MCP bundle, change Compose, or expose a web port.
- If you need the new `list-accounts` `readOnlyHint` live, upgrade the installed CLI/MCP to 1.2.1 through the normal reviewed deployment path. Installing a DMG or checking out this Git tree does not update the container or configure ChatGPT.
- Personal Pro is documented as read/fetch only. Full writes require Business/Enterprise/Edu according to the current ChatGPT tunnel guide. Keep ChatGPT confirmations.
- This release does not claim live Mac or ChatGPT operation. A successful ChatGPT safe read remains required before treating the connection as verified.

## [1.2.0] - 2026-10-04

Prepared release notes.

### Scoped budgets and reports

- Scoped budgets and reports with an explicit currency, account/category/tag inclusions and exclusions, gross cash-flow or classified NET calculations, contributor inspection, and historical comparisons.

### FX, consumption, and recurring estimates

- Direct dated manual FX rates preserve missing-rate incompleteness and keep expense completeness independent.
- Consumption classifications, pinned revisions, independent source coverage, and reviewed bulk changes.
- Separate estimates for recurring rules and subscriptions, with scope limitations made explicit rather than combining potentially overlapping sources.

### Native UI

- Refined native Dashboard, Accounts, Settings, and transaction dialogs, including narrow and keyboard layouts.

### CLI and MCP

- Shared automation catalog is 118 CLI/MCP tools and 123 CLI commands including built-ins. Scoped budget operations extend the existing tools, with audited mutations, write-free dry runs, and filter-bound contributor pagination.

### Repository hygiene and CI

- Versioned inventory in CI, isolated fixtures, and a flaky-test guard.

### Upgrade notes

- Back up first.
- Upgrade desktop and CLI/MCP together (schema 24). Do not reopen migrated data with older clients.
- Stored amounts and denominations are preserved; legacy USD-tagged rows are not automatically reinterpreted.
- Changing a budget currency requires amount re-entry.
- Generic budget delete undo remains unsupported.

## [1.1.0] - 2026-09-20

Prepared release notes. The `v1.1.0` Git tag is created after CI and packaging checks pass.

### Native UI

- Native light and dark appearances with a responsive desktop and mobile shell, grouped navigation, and stacked narrow layouts.
- Overview, accounts, transactions, and related screens follow the native layout; the shell owns the compact route heading.
- Saved custom themes remain available behind advanced appearance controls, and the selected appearance applies at startup.

### Reviewed imports, history, payments, buckets, and valuation

- Reviewed statement imports, staged history, coverage, settlement, exact-row finalization, and reviewed reconciliation-bridge supersession.
- Account history maintenance in Accounts; verified legacy import identity can be bound without inventing original source content.
- Card statement payment evidence with unlink that voids evidence without deleting the source transaction or changing account balances.
- Virtual cashflow buckets with allocate, correct, and reverse flows that preserve original allocations and do not change bank balances.
- Ownership-aware valuation: incomplete prices or FX no longer invent converted totals. Legacy holdings stay stored and may need price or valuation identity configuration.
- Credit-card payments from a cash or deposit account, CETES as an investment type, CSV import/export, and transfer destination handling in the transaction form.
- Database backup export and import in Settings using SQLite’s online backup API.

### CLI and MCP

- Shared automation catalog is 108 CLI/MCP tools and 113 CLI commands including built-ins. `shikin tools --json` is the discovery contract and reports only declared effects.
- Dry-run-first money writes, undo, finance sanity check, trusted-local plugins, backup/restore, runtime diagnostics, and loopback `shikin web`.
- Generic workflows for card payments, credit-card cycle explanation, placeholders, strict recording, tags, subscription-from-transaction, and explicit recap save.

### Validation and preservation

- Stronger transaction mutations with explicit database transactions and parameterized queries, including tag filters.
- Import balance bounds, goal patch writes, identity binding, account provenance guards, and debt-payoff extra-payment validation (including fractional-cent rejection).
- Localization, document-language sync, and accessibility fixes in updated UI flows.

### Repository hygiene and CI

- GitHub Actions workflow for release preflight, `pnpm check`, unit tests, app/CLI builds, and e2e.
- Docs, contributing notes, and `docs/reference/AUTOMATION-WORKFLOWS.md` for provenance, persistence, and smoke coverage.
- Clarified v1 limits for recurring transfer rules, inferred card APR at 0%, and installment-plan modeling.
