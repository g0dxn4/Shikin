# Changelog

All notable changes to Valute are documented in this file.

## [Unreleased] - 2026-03-17

### Added

- CI workflow at `.github/workflows/ci.yml` for lint, typecheck, unit tests, and build.
- Database backup export/import in Settings for browser-local snapshots.
- AI panel tool visibility enhancements (state badges + runtime duration) and load-older paging.
- CSV transaction import/export flows with validation and reporting feedback.
- Transfer destination account flow in transaction form and transfer-aware balance handling.
- Playwright coverage for budgets and subscriptions pages.
- Theme customization MVP in Settings (presets, token editor, apply/save/reset/revert).
- AI prompt-to-theme generation flow using configured provider credentials.

### Changed

- Strengthened transaction mutations with explicit DB transactions to reduce balance drift risk.
- Improved dashboard analytics with month-over-month deltas and chart drilldown links.
- Updated docs and development tracking to reflect browser-first architecture and current status.
- Added startup theme hydration so saved themes apply at app boot.

### Fixed

- Conversation persistence race risks on first message in newly created conversations.
- OAuth `isConfigured` logic to correctly account for OAuth mode.
- Multiple localization and accessibility gaps in updated UI flows.
- Added validation guards for AI-generated theme payloads before applying CSS variables.

### Docs

- Refreshed README, contributing notes, planning docs, sprint overviews, and backlog.
- Added archival guidance for historical research docs.
