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
- CLI and MCP now expose the shipped 39-tool surface from shared definitions, with every shipped tool available end-to-end.
- Credit card account cards can record a payment from a cash/deposit account as a transfer, reducing the card balance used.

### Changed

- Strengthened transaction mutations with explicit DB transactions to reduce balance drift risk.
- Improved dashboard analytics with month-over-month deltas and chart drilldown links.
- Updated docs and development tracking to reflect browser-first architecture and current status.
- Added startup theme hydration so saved themes apply at app boot.

### Fixed

- Multiple localization and accessibility gaps in updated UI flows.

### Docs

- Refreshed README, contributing notes, planning docs, sprint overviews, and backlog.
- Added archival guidance for historical research docs.
- Clarified v1 limitations for recurring transfer rules, debt APR defaults, and installment-plan modeling.
