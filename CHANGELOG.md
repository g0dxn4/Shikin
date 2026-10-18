# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

### MCP usability and safety

- Preserve the complete CLI/full MCP catalog and add an opt-in core profile plus enforced read-only tool and standalone database access. A capabilities resource reports the fixed launch profile.
- Register full strict input schemas, return compact JSON and structured content, preserve actionable errors, and provide instructions that treat imported text as untrusted data.
- Add atomic metadata/category/subcategory/split correction batches with preview binding, all-or-nothing audit writes, and idempotent retry receipts. Bank amounts, identities, and original source evidence remain intact.
- Generate current tool/schema inventories and check them in CI; retain a pinned legacy compatibility fixture. Add a reproducible original/candidate benchmark using isolated synthetic databases.

### Financial history and received payments

- Capture monthly budget configuration and gross/net evidence, explicitly label retrospective reconstructions, and append correction revisions without overwriting original limits or silently following live budget changes.
- Add a budget-history panel with reviewed previews and correction reasons.
- Link multiple received installments to expected receivables, preserve legacy unattributed receipts, void mistaken payment links without deleting source evidence, and guard linked bank records across app/CLI/MCP paths.
- Add receipt review and selective unlink flows to the Receivables page.

### Documentation and upgrade notes

- Research current MCP specifications and authoritative agent-tool guidance, compare established finance applications, and document implemented functionality and prioritized gaps.
- Refresh architecture, database, CLI, portable skill, automation workflows, and generated inventory references.
- Back up first and upgrade app, CLI, and MCP together through schema 26. Migrations 025/026 are additive and do not invent historical limits or income transactions. Read-only MCP does not migrate data.
- Full remains the default; core is an evaluated candidate, not a claim that a particular tool count improves every model. Generic undo still has domain limits. See `docs/guides/AGENT-WORKFLOWS-UPGRADE.md` and `docs/benchmarks/MCP-BENCHMARKS.md`.

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
