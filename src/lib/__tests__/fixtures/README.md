# Schema characterization fixtures

## `shikin-empty-v018.db`

- **Purpose:** immutable, empty-user-data input for the real migration 018 → 019 characterization test.
- **Source revision:** `4db7c796731549ee857a30b36da26f3490e6ea5d` (`feat: streamline dashboard and long lists`), the repository parent before migration 019.
- **Generated:** 2026-07-15 UTC on Linux with Node.js and the revision's actual `scripts/data-server.mjs` startup/migration engine.
- **SHA-256:** `9f9ebc1a677679d32c3647115d8b6b7b05bce06b3986617a2b62bef3a1a51e11`
- **Size:** 413,696 bytes.

Generation used a clean archive of the source revision, isolated `HOME` and `XDG_DATA_HOME` directories, and the repository's installed compatible runtime dependencies. After the engine reached its listening state, it was stopped and its WAL was checkpointed. The 15 built-in category seed rows were removed so the fixture has no application/user rows; `_migrations` is intentionally retained as schema provenance. The database was then vacuumed.

Verification performed before copying the fixture:

1. `PRAGMA integrity_check` returned `ok`.
2. `_migrations` contained the actual 15 migration rows in runtime order and ended at `018_placeholder_transactions`.
3. Every application table other than `_migrations` had zero rows.
4. No migration-019 marker or `account_mode` schema definition was present.

The test re-verifies the committed SHA-256, integrity, migration endpoint, and empty-user-data property before inserting representative dummy rows. Any fixture regeneration must update this document and the pinned hash in the test.
