# Backend Mapping (Milestone 1)

This is a practical backend map for the current repo layout. It is a documentation-only artifact for hardening planning.

## 1) Key backend entry points

- **Desktop app runtime**
  - `src/main.tsx` → app shell and routing.
  - `src-tauri/src/main.rs` → starts `shikin_lib::run()`.
  - `src-tauri/src/lib.rs` → Rust bootstrap + plugin registration (`sql`, `store`, `fs`, `updater`, `oauth_listen`).
  - `src-tauri/migrations/001_core_tables.sql`, `002_ai_memories.sql`, `003_credit_cards.sql` and migration list in `src-tauri/src/lib.rs` (001-003 only).
- **Browser mode runtime**
  - `pnpm dev` executes `scripts/dev.mjs`, which starts `scripts/data-server.mjs`, `scripts/oauth-server.mjs`, and Vite in one process group.
  - Browser runtime DB/storage calls are funneled through `src/lib/database.ts`, `src/lib/storage.ts`, and `src/lib/virtual-fs.ts`.
- **CLI mode**
  - `cli/src/cli.ts` registers every command from `cli/src/tools.ts` and runs via Commander.
  - Current tool surface: **44 tools** (from `cli/src/tools.ts`).
- **MCP mode**
  - `cli/src/mcp-server.ts` registers the same `tools` and bootstraps MCP over stdio.

## 1a) Local HTTP listeners

- **`scripts/data-server.mjs`**
  - HTTP listener: `createServer(...).listen(1480, '127.0.0.1')` (loopback only).
  - Access is guarded by local bridge auth: origin must be `http://localhost:1420` and `X-Shikin-Bridge` must match `SHIKIN_DATA_SERVER_BRIDGE_TOKEN`.
  - Public endpoints: `/api/db/*`, `/api/store/*`, `/api/fs/*`, and `/api/proxy/chatgpt/*`.

- **`scripts/oauth-server.mjs`**
  - HTTP listener: `createServer(...).listen(1455, '127.0.0.1')`.
  - Route: `GET /auth/callback` only; forwards to SPA callback on `http://localhost:1420`.

- **Tauri invoke surface (`src-tauri/src/lib.rs`)**
  - `oauth_listen(port)` binds one-shot on `127.0.0.1:<port>`.
  - Parses one incoming request (`GET /auth/callback?...`) and returns `{ code, state }`.
  - Listener timeout: 120s (`tokio::time::timeout`).

## 1b) AI proxy surface (`scripts/data-server.mjs`)

- Route family: `/api/proxy/chatgpt/*` (handler currently forwards any incoming HTTP method; typical use is `POST`).
- Access to proxy routes also goes through the same origin + bridge-token validation used by all data-server handlers.
- Forwards to `https://chatgpt.com/backend-api/codex/*` and passes through relevant auth headers.
- Rewrites Codex-incompatible request fields (`store=false`, removes `max_output_tokens`, strips `previous_response_id`).
- Uses in-memory `codexItemCache` to resolve `item_reference` entries across stream/tool-loop follow-ups.

## 2) CLI flow

1. `cli/src/cli.ts`:
   - Creates a `commander` program and iterates `tools` from `cli/src/tools.ts`.
   - Converts tool `zod` schemas into command options (`zodToOptions`).
   - Coerces string inputs to numbers/booleans (`coerceInput`).
   - Executes `tool.execute(...)` and prints JSON response.
   - Calls `close()` from `cli/src/database.ts` in finally.

2. `cli/src/tools.ts`:
   - Defines 44 command tools (add/update/delete flows, analytics, notebooks, AI memory, goals, etc.).
   - Each tool is self-contained: schema + business SQL + return payload.

3. `cli/src/database.ts` (CLI-only data layer):
   - Uses `better-sqlite3` against `~/.local/share/com.asf.shikin/shikin.db`.
   - Converts positional placeholders `$1`/`$2` → `?` for better-sqlite3.
   - Exposes `query`, `execute`, `close` (no HTTP/network surface).

## 3) MCP flow

- `cli/src/mcp-server.ts` creates `McpServer({ name: 'shikin', version: '0.1.0' })`.
- Registers **all 44** tools from `tools` with:
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
  - Browser branch (`DATA_SERVER_URL = http://localhost:1480`): POST to `/api/db/query` and `/api/db/execute`.
  - Export/import APIs:
    - `exportDatabaseSnapshot()` (`/api/db/export` in browser; direct fs read in Tauri)
    - `importDatabaseSnapshot()` (`/api/db/import` in browser; direct fs write in Tauri)
  - `runInTransaction` maps to DB `BEGIN/COMMIT/ROLLBACK` in both modes.

- **Migration ownership (runtime reality)**
  - Tauri Rust registration (`src-tauri/src/lib.rs`): **001-003 only**.
  - Browser/Tauri JS migration runner (`src/lib/database.ts`): **004-008 and 010-012**.
  - Migration `009` is absent from the JS sequence in `src/lib/database.ts`.
  - `cli/src/database.ts` performs no schema migration.

- **CLI DB (`cli/src/database.ts`)**
  - Local SQLite path: `~/.local/share/com.asf.shikin/shikin.db`.
  - `journal_mode = WAL`, FK constraints enabled.
  - No schema migrations in this file (relies on DB/file lifecycle and app scripts to ensure structure).

- **Browser bridge DB (`scripts/data-server.mjs`)**
  - Direct `better-sqlite3` DB at `~/.local/share/com.asf.shikin/shikin.db`.
  - Own migration runner (`_migrations` table, ids 001-012, with no `009_*` migration defined).
  - Endpoints used by app:
    - `POST /api/db/query`
    - `POST /api/db/execute`
    - `GET /api/db/export`
    - `POST /api/db/import`
    - `POST /api/proxy/chatgpt/*` (ChatGPT Codex backend proxy)
  - AI proxy behavior includes the in-memory `codexItemCache` for stream-resolved `item_reference` follow-ups in the tool loop.

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
  - **MCP (`cli/src/mcp-server.ts`)**: add a transport harness that boots the server, asserts all **44** tool registrations, and executes one representative tool end-to-end.
  - **Data server (`scripts/data-server.mjs`)**: add HTTP contract tests for `/api/db/*`, `/api/store*`, `/api/fs/*`, `/api/proxy/chatgpt/*`, including stream/item-reference behavior via `codexItemCache`.
  - **Hardening checks**: add explicit `safePath` boundary cases (relative paths, separator tricks, normalization edge cases) as verification tests.

## 8) Outbound integrations

- **Updater manifest**: `src-tauri/tauri.conf.json` → `plugins.updater.endpoints` (`https://github.com/g0dxn4/Shikin/releases/latest/download/latest.json`).
- **OAuth token exchange**: `src/lib/oauth.ts` uses provider `tokenUrl` for token requests.
- **Exchange rates**: `src/lib/exchange-rate-service.ts` → `https://api.frankfurter.app`.
- **Prices**: `src/lib/price-service.ts` → Alpha Vantage + CoinGecko APIs.
- **News**: `src/lib/news-service.ts` → Finnhub + NewsAPI.
- **Congressional trades dataset**: `src/lib/congressional-trades.ts` → house stock watcher S3 dataset.

## 9) Major hardening hotspots already identified

1. **Local server trust boundary (data-server)**
   - `scripts/data-server.mjs` now binds loopback-only (`127.0.0.1:1480`) and enforces origin + per-run bridge token checks on every request.
   - Treat it as a local-network trust boundary and keep regression tests for auth/host behavior.

2. **Path confinement in FS endpoints**
   - `safePath` in `scripts/data-server.mjs` now uses `path.relative`/`resolve` to prevent traversal across the data root boundary.

3. **CLI/bridge error handling gaps**
   - Browser `src/lib/storage.ts` `createBrowserStore()` swallows get/set failures (reads return `null`, writes silently drop).
   - `cli/src/tools.ts` is feature-complete but several integrations are placeholders/deferred (notably `get-education-tip` returns `success: false` intentionally).

4. **Schema/API drift risk**

- Tauri and browser share `src/lib/database.ts` abstractions, while CLI + data-server carry independent migration/init and path assumptions (`~/.local/share/com.asf.shikin`).

5. **MCP/CLI DB layer consistency**
   - Both CLI and MCP intentionally share `cli/src/tools.ts`, but operational behavior can diverge because storage path and migration lifecycle differ between CLI process and app data-server path.

## 10) Milestone 6 checkpoint notes

This doc is the mapping baseline; the local bridge hardening items below are already implemented, with verification work still useful for future regression.

### Immediate (P0/P1) fixes to scope

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

### Acceptance criteria for Milestone 2

- No unauthenticated destructive write path without explicit local authorization.
- No notebook/settings traversal bypass via relative path tricks.
- No silent failures for local settings reads/writes in browser mode.
- Any path or migration drift between CLI/MCP and app runtime is documented and enforced.

---

Status: **Milestone 1 complete** (documentation map only).
