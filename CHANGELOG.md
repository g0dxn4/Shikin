# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

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
