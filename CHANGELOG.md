# Changelog

All notable changes to Shikin are documented in this file.

## [Unreleased]

### Added

- CI workflow at `.github/workflows/ci.yml` for lint, typecheck, unit tests, and build.
- Database backup export/import in Settings for browser-local snapshots.
- CSV transaction import/export flows with validation and reporting feedback.
- Transfer destination account flow in transaction form and transfer-aware balance handling.
- Playwright coverage for budgets and subscriptions pages.
- Theme customization MVP in Settings (presets, token editor, apply/save/reset/revert).
- CLI and MCP now expose the shipped 44-tool surface (42 available tools + 2 compatibility placeholders: `get-financial-news`, `get-congressional-trades`) from shared definitions.

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
