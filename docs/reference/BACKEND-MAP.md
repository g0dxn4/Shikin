# Backend Mapping (Historical Hardening Notes)

This is a practical backend map for the current repo layout. It is a documentation-only artifact that started as hardening-planning material and still contains historical milestone references.

## 1) Key backend entry points

- **Desktop app runtime**
  - `src/main.tsx` → app shell and routing.
  - `src-tauri/src/main.rs` → starts `shikin_lib::run()`.
  - `src-tauri/src/lib.rs` → Rust bootstrap + plugin registration (`sql`, `store`, `fs`, `updater`).
  - `src-tauri/migrations/001_core_tables.sql`, `003_credit_cards.sql` and migration list in `src-tauri/src/lib.rs`.
- **Browser mode runtime**
  - `pnpm dev` executes `scripts/dev.mjs`, which starts `scripts/data-server.mjs` and Vite in one process group.
  - Browser runtime DB/storage calls are funneled through `src/lib/database.ts`, `src/lib/storage.ts`, and `src/lib/virtual-fs.ts`.
- **CLI mode**
  - `cli/src/cli.ts` registers every command from `cli/src/tools.ts` and runs via Commander.
- Current shared tool surface: **41 tool definitions** (from `cli/src/tools.ts`), including **2 structured unavailable placeholders** for external-feed features.
- MVP limitation decisions: CLI transaction-write tools reject transfer writes; debt payoff uses inferred credit-card balances with APR fixed at 0% because account APR is not stored; browser subscription management is a placeholder while CLI/MCP can read local subscription rows.
- **MCP mode**
  - `cli/src/mcp-server.ts` registers the same `tools` and bootstraps MCP over stdio.

## 1a) Local HTTP listeners

- **`scripts/data-server.mjs`**
  - HTTP listener: `createServer(...).listen(1480, '127.0.0.1')` (loopback only).
  - Access is guarded by local bridge auth: origin must be `http://localhost:1420` and `X-Shikin-Bridge` must match `SHIKIN_DATA_SERVER_BRIDGE_TOKEN`.
  - Public endpoints: `/api/db/*`, `/api/store/*`, and `/api/fs/*`.

## 2) CLI flow

1. `cli/src/cli.ts`:
   - Creates a `commander` program and iterates `tools` from `cli/src/tools.ts`.
   - Converts tool `zod` schemas into command options (`zodToOptions`).
   - Coerces string inputs to numbers/booleans (`coerceInput`).
   - Executes `tool.execute(...)` and prints JSON response.
   - Calls `close()` from `cli/src/database.ts` in finally.

2. `cli/src/tools.ts`:
   - Defines 41 shared tool definitions (39 available end-to-end, plus 2 structured unavailable placeholders).
   - Each tool is self-contained: schema + business SQL + return payload.
   - `add-transaction`, `update-transaction`, and recurring write paths reject transfer writes in the CLI/MCP MVP. Use separate explicit-account withdrawal/deposit entries as the documented workaround.

3. `cli/src/database.ts` (CLI-only data layer):
   - Uses `better-sqlite3` against `~/.local/share/com.asf.shikin/shikin.db`.
   - Converts positional placeholders `$1`/`$2` → `?` for better-sqlite3.
   - Exposes `query`, `execute`, `close` (no HTTP/network surface).

## 3) MCP flow

- `cli/src/mcp-server.ts` creates `McpServer({ name: 'shikin', version: '0.1.0' })`.
- Registers **all 41** shared tool definitions from `tools` with:
  - tool name
  - description
  - `tool.schema.shape`
  - `tool.execute` wrapped in MCP response.
- Registers MCP resources for quick reads:
  - `accounts` → `shikin://accounts` (`query('SELECT ... FROM accounts')`)
  - `categories` → `shikin://categories`
  - `recent-transactions` → `shikin://recent-transactions` (ordered + limited)
- Connects via `StdioServerTransport`; SIGINT calls `close()`.

## 4) Database and storage layers

- **Dual runtime abstraction (`src/lib/database.ts`)**
  - `isTauri` branch (`src/lib/runtime.ts`): dynamic import of `@tauri-apps/plugin-sql`, `Database.load('sqlite:shikin.db')`.
  - Browser branch (`DATA_SERVER_URL = http://localhost:1480`): POST to `/api/db/query`, `/api/db/execute`, and `/api/db/transaction`.
  - Export/import APIs:
    - `exportDatabaseSnapshot()` (`/api/db/export` in browser; direct fs read in Tauri)
    - `importDatabaseSnapshot()` (`/api/db/import` in browser; direct fs write in Tauri)
  - `withTransaction()` is the browser-safe multi-step transaction path; `runInTransaction()` is Tauri-only.
  - Browser recurring materialization remains a dedicated endpoint wrapper: `materializeRecurringTransactionsBrowser()` → `/api/recurring/materialize`.

- **Migration ownership (runtime reality)**
  - Tauri Rust registration (`src-tauri/src/lib.rs`): **001-003 only**.
  - Browser/Tauri JS migration runner (`src/lib/database.ts`): **004-008 and 010-014**.
  - Migration `009` is intentionally absent from the JS sequence in `src/lib/database.ts`.
  - `cli/src/database.ts` performs no schema migration.

- **CLI DB (`cli/src/database.ts`)**
  - Local SQLite path: `~/.local/share/com.asf.shikin/shikin.db`.
  - `journal_mode = WAL`, FK constraints enabled.
  - No schema migrations in this file (relies on DB/file lifecycle and app scripts to ensure structure).

- **Browser bridge DB (`scripts/data-server.mjs`)**
  - Direct `better-sqlite3` DB at `~/.local/share/com.asf.shikin/shikin.db`.
  - Own migration runner (`_migrations` table, ids 001-014, with no `009_*` migration defined).
  - Endpoints used by app:
    - `POST /api/db/query`
    - `POST /api/db/execute`
    - `POST /api/db/transaction`
    - `GET /api/db/export`
    - `POST /api/db/import`
  - Server-side browser transactions use a short lease (`SHIKIN_SERVER_TRANSACTION_TTL_MS`, default `15000`) and auto-rollback on expiry.
  - Transaction finalization is status-bearing: callers should treat `status` as authoritative (`committed`, `rolled_back`, `expired_rolled_back`).

- **Settings store abstraction**
  - App: `src/lib/storage.ts`
    - Tauri path: `@tauri-apps/plugin-store`
    - Browser: calls data-server key endpoints (`/api/store[/<key>]`).
  - Browser concrete settings persistence: `scripts/data-server.mjs` `settings.json` at `~/.local/share/com.asf.shikin/settings.json`.

## 5) Notebook storage

- **App abstraction (`src/lib/virtual-fs.ts`)**
  - Dual mode: Tauri plugin FS vs browser data-server FS endpoints.
  - Used by `src/lib/notebook.ts`.
- **App notebook (`src/lib/notebook.ts`)**
  - `NOTEBOOK_DIR = notebook` under app data path.
  - Initializes directories: `weekly-reviews`, `holdings`, `signals`, `education`.
  - CRUD helpers: `initNotebook`, `readNote`, `writeNote`, `appendNote`, `listNotes`, `deleteNote`.
- **CLI notebook (`cli/src/notebook.ts`)**
  - Direct fs under `~/.local/share/com.asf.shikin/notebook`.
  - Same API shape (`readNote`, `writeNote`, `appendNote`, `noteExists`, `listNotes`, `deleteNote`).

## 6) Shared schema / types

- Canonical TypeScript domain model is in:
  - `src/types/common.ts`
  - `src/types/database.ts`
- Runtime money conversion helpers: `src/lib/money.ts`.
- Full DB schema documented in `docs/reference/DATABASE.md` (tables + migrations assumptions).
- Cross-layer note: CLI currently consumes SQL strings directly and does not import these shared domain interfaces in `cli/src/tools.ts`.

## 7) Backend tests / gaps

- App domain tests exist, but almost all DB-touching tests mock `@/lib/database`.
  - Examples: `src/lib/__tests__/anomaly-service.test.ts`, `exchange-rate-service.test.ts`, `forecast-service.test.ts`, `split-service.test.ts`.
  - Store-heavy tests: `src/stores/__tests__/*-store.test.ts` mock DB calls.
- E2E exists for UI flows (`e2e/*.spec.ts`) but does not exercise CLI/MCP/datastore server internals directly.
- **Practical CLI/MCP/data-server strategy:**
  - **CLI (`cli/src/tools.ts`)**: add integration tests that execute real SQL against a temp DB for one CRUD path (`add-account`/`add-transaction`/delete) plus one aggregate path (`get-balance-overview` or equivalent).
   - **MCP (`cli/src/mcp-server.ts`)**: add a transport harness that boots the server, asserts all **41** tool registrations, and executes one representative tool end-to-end.
  - **Data server (`scripts/data-server.mjs`)**: add HTTP contract tests for `/api/db/*`, `/api/store*`, and `/api/fs/*`.
  - **Hardening checks**: add explicit `safePath` boundary cases (relative paths, separator tricks, normalization edge cases) as verification tests.

## 8) Outbound integrations

- **Updater manifest**: `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` (`https://github.com/g0dxn4/Shikin/releases/latest/download/latest.json`).
- **Exchange rates**: `src/lib/exchange-rate-service.ts` → `https://api.frankfurter.app`.
- **Prices**: `src/lib/price-service.ts` → Alpha Vantage + CoinGecko APIs.
- **News**: `src/lib/news-service.ts` → Finnhub + NewsAPI.
- **Congressional trades dataset**: `src/lib/congressional-trades.ts` → house stock watcher S3 dataset.
- **CLI/MCP external-feed placeholders**: `get-financial-news` and `get-congressional-trades` do not call those feeds in the MVP; they return structured unavailable responses.

## 9) Major hardening hotspots already identified

1. **Local server trust boundary (data-server)**
   - `scripts/data-server.mjs` now binds loopback-only (`127.0.0.1:1480`) and enforces origin + per-run bridge token checks on every request.
   - Treat it as a local-network trust boundary and keep regression tests for auth/host behavior.

2. **Path confinement in FS endpoints**
   - `safePath` in `scripts/data-server.mjs` now uses `path.relative`/`resolve` to prevent traversal across the data root boundary.

3. **CLI/bridge error handling gaps**
   - Browser `src/lib/storage.ts` `createBrowserStore()` swallows get/set failures (reads return `null`, writes silently drop).
   - `cli/src/tools.ts` is feature-complete but several integrations are placeholders/deferred (notably external-feed placeholders return structured unavailable results).

4. **Schema/API drift risk**

- Tauri and browser share `src/lib/database.ts` abstractions, while CLI + data-server carry independent migration/init and path assumptions (`~/.local/share/com.asf.shikin`).

5. **MCP/CLI DB layer consistency**
   - Both CLI and MCP intentionally share `cli/src/tools.ts`, but operational behavior can diverge because storage path and migration lifecycle differ between CLI process and app data-server path.

## 10) Milestone 6 checkpoint notes

This doc is the mapping baseline; the local bridge hardening items below are already implemented, with verification work still useful for future regression.

### Historical Immediate (P0/P1) fixes to scope

1. **Constrain `scripts/data-server.mjs` to caller-local trust only**
   - File(s): `scripts/data-server.mjs`
   - Implemented in code: explicit loopback bind + origin check + required shared bridge token.

2. **Fix filesystem traversal checks in data-server handlers**
   - File(s): `scripts/data-server.mjs`
   - Implemented in code: `safePath` now uses `path.relative`/`resolve` for confinement checks.

3. **Stop silent storage failure in browser store path**
   - File(s): `src/lib/storage.ts`
   - Convert failure handling in `createBrowserStore()` from swallowed reads/writes to surfaced errors so callers can react.

4. **Make migration/state assumptions explicit across CLI/MCP/app bridges**
   - File(s): `cli/src/database.ts`, `scripts/data-server.mjs`, `src/lib/database.ts`, `src-tauri/src/lib.rs`
   - Define and enforce migration table expectations, DB path, and version checks at startup.

### Near-term validation work

1. Add contract tests for `scripts/data-server.mjs` endpoints (`/api/db/*`, `/api/fs/*`, `/api/store/*`).
2. Add CLI runtime smoke coverage for critical commands in `cli/src/tools.ts` (CRUD + balance integrity).
3. Add a notebook persistence matrix test across Tauri/browser/CLI note backends for directory shape and file operations.

### Historical acceptance criteria for Milestone 2

- No unauthenticated destructive write path without explicit local authorization.
- No notebook/settings traversal bypass via relative path tricks.
- No silent failures for local settings reads/writes in browser mode.
- Any path or migration drift between CLI/MCP and app runtime is documented and enforced.

---

Status: historical planning artifact, kept as a backend reference map.
