# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

### Added

- CI workflow at `.github/workflows/ci.yml` for lint, typecheck, unit tests, and build.
- Database backup export/import in Settings for browser-local snapshots.
- CSV transaction import/export flows with validation and reporting feedback.
- Transfer destination account flow in transaction form and transfer-aware balance handling.
- Playwright coverage for budgets and core navigation pages.
- Theme customization MVP in Settings (presets, token editor, apply/save/reset/revert).
- CLI and MCP now expose the shipped shared-tool surface from shared definitions, with every shipped tool available end-to-end.
- Credit card account cards can record a payment from a cash/deposit account as a transfer, reducing the card balance used.
- Generic automation workflows for card payments, credit-card cycle explanations, placeholder transactions, strict recording, tags, subscription-from-transaction, undo, and finance sanity checks.
- Trusted-local CLI/MCP plugin management tools with explicit enable/disable workflow and extension documentation.
- CETES as an investment type, including schema migration support and local UI guidance for government-note holdings.

### Changed

- Strengthened transaction mutations with explicit DB transactions to reduce balance drift risk.
- Hardened CLI/MCP finance writes with dry-run previews, duplicate warnings, opaque source provenance, audit notes, and redacted review output where supported.
- Extended investment price refresh behavior with broader market-data fallback handling and per-symbol currency persistence.
- Improved dashboard analytics with month-over-month deltas and chart drilldown links.
- Updated docs and development tracking to reflect browser-first architecture and current status.
- Added startup theme hydration so saved themes apply at app boot.

### Fixed

- Multiple localization and accessibility gaps in updated UI flows.
- Fixed SQLite positional-parameter handling for tag-filtered transaction queries and transaction hygiene sanity checks.

### Docs

- Refreshed README, contributing notes, planning docs, sprint overviews, and backlog.
- Added archival guidance for historical research docs.
- Clarified v1 limitations for recurring transfer rules, debt APR defaults, and installment-plan modeling.
- Added `docs/reference/AUTOMATION-WORKFLOWS.md` covering the plan-delivered workflows, provenance semantics, persistence updates, and hard-smoke coverage.
