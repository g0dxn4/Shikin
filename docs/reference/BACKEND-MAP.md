# Backend map

Current runtime ownership and automation entry points. For the architectural
rationale and financial invariants, see [Architecture](../guides/ARCHITECTURE.md).
Historical remediation plans remain under `docs/planning/`.

## Runtime entry points

| Runtime              | Entry point                                                             | Data access                                        |
| -------------------- | ----------------------------------------------------------------------- | -------------------------------------------------- |
| Desktop              | `src-tauri/src/main.rs`, `src-tauri/src/lib.rs`, `src/main.tsx`         | Tauri SQL adapter and local app-data files         |
| Browser development  | `scripts/dev.mjs` → finance-core build, Vite, `scripts/data-server.mjs` | Isolated local bridge by default                   |
| Packaged private web | `cli/src/web-host.ts`, desktop hosted-access integration                | Same local database; loopback listener             |
| CLI                  | `cli/src/cli.ts`                                                        | Shared tool handlers through `cli/src/database.ts` |
| MCP                  | `cli/src/mcp-server.ts`                                                 | Same handlers, selected by fixed launch profile    |

Installed paths are resolved by shared storage helpers. Linux normally uses
`~/.local/share/com.asf.shikin`; custom test roots use explicit isolation and must
not inspect or move legacy user data. Use [CLI environment guidance](../../cli/README.md)
for cross-platform paths and custom-root rules.

## Shared CLI catalog

`cli/src/tools/index.ts` composes domain definitions under `cli/src/tools/`. Each
contains a name, description, Zod input object, implementation, and optional
audited effects. Handlers reuse finance-core rules and runtime-specific services.
The Commander adapter generates kebab-case options, coerces CLI values, prints
JSON results, and closes the database on completion.

`shikin tools --json` provides catalog/schema versions, compatibility metadata,
required migrations, and effects. `diagnose`, `tools`, `validate`, `web`, and
`record` are CLI-only built-ins. The [generated inventory](MCP-TOOL-INVENTORY.md)
and JSON companion include exact current counts, every schema and implementation,
and core/read-only eligibility. The v1.2.1 name fixture remains a compatibility
floor; enabled trusted-local plugins are additive.

## MCP registration and permissions

`mcp-profiles.ts` owns the explicit core roster, option parser, permission filter,
and server instructions. Full is the default. Core is opt-in. `--read-only`
excludes any write, unknown-effect, or plugin tool and cannot be widened by a
later call. Registrations are sorted and fixed for the process. The CLI catalog
remains complete independently of MCP launch options.

`mcp-server.ts` uses SDK `registerTool` with the complete strict Zod object, a
common success-envelope output schema, and declared effects annotations. Handlers
revalidate, preserve domain errors, and produce compact JSON text plus matching
structured content. The negotiated SDK transport remains stdio with its existing
2025-11-25 protocol support.

| Resource                       | Purpose                                                |
| ------------------------------ | ------------------------------------------------------ |
| `shikin://accounts`            | Active accounts and aliases                            |
| `shikin://categories`          | Category reference data                                |
| `shikin://recent-transactions` | Bounded recent nonarchived rows                        |
| `shikin://capabilities`        | Fixed profile, effective tool names, permission policy |

The standalone read-only entrypoint configures SQLite access before opening a
handle. The `createMcpServer` factory controls tool policy; an embedded host must
configure its own database restrictions. Read-only annotations alone are not
a security boundary. See [MCP research/design](../research/MCP-DESIGN.md).

## Domain workflows and boundaries

| Workflow                        | Shared rules / service                                                        | Entry points                                               |
| ------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Scoped reports/budgets          | finance-core report scope/window/projector; app/CLI scoped adapters           | Budgets, Reports, `get-spending-summary`, `upsert-budget`  |
| Metadata and atomic batches     | `cli/src/transaction-corrections.ts`, `cli/src/tools/transaction-batch.ts`    | Single correction and bounded preview/apply batch          |
| Economic classification/refunds | finance-core consumption and classification plans; app/CLI services           | Classification preview/apply tools and app editors         |
| Budget-history revisions        | `finance-core/budget-history`, `src/lib/budget-history.ts`, CLI history tools | Budget-history panel, capture/read tools                   |
| Receivable installments         | `finance-core/receivable-payments`, app payment service, CLI receivable tools | Expected-payment matching and link voids                   |
| Imports and duplicates          | finance-core statement identities/plans and app/CLI import adapters           | CSV/statement previews and reviewed apply                  |
| Reconciliation and transfers    | Shared ledger, coverage, and evidence contracts                               | Account history, transfer matching, card-payment workflows |
| Virtual reserves                | finance-core cashflow buckets and runtime adapters                            | Bucket allocate/reverse/correct tools and app flows        |

Budget-history and receipt migration definitions are in shared 025/026 modules.
Metadata-batch retry receipts reuse `audit_log`; there is no second operation
store. These additions preserve original bank evidence and existing CLI names.
They do not add automatic budget rollover or exclusive assignment rules.

## SQLite and migration ownership

- `src/lib/database.ts` adapts Tauri SQL and browser HTTP. Its transaction services
  expose atomic writes; the browser bridge leases a real server transaction and
  reports final status so an expired lease cannot masquerade as a commit.
- `scripts/data-server.mjs` owns local SQLite initialization/migration and the
  internal `/api/db/*`, `/api/store/*`, and `/api/fs/*` bridge. Requests are guarded
  by origin/token checks and bounded bodies. This internal SQL bridge is not an
  unrestricted MCP tool or a public REST API.
- `cli/src/database.ts` uses better-sqlite3, enables foreign keys, checks schema
  objects and migration markers, and owns backups/restores. Normal access uses
  WAL and synchronous immediate transactions/savepoints. Read-only access skips
  storage preparation/journal changes and sets query-only access.
- Tauri Rust registers packaged base SQL. The app's JavaScript migration runner
  applies newer shared migrations, following the existing 024 model. The CLI
  startup does not migrate the live schema; restore can upgrade its staged
  candidate copy. Readiness requires schema 26.

See [Database reference](DATABASE.md) and
[upgrade notes](../guides/AGENT-WORKFLOWS-UPGRADE.md) for schema/export compatibility.
Do not replace released migrations; add a shared version and update every adapter,
readiness check, export policy, and migration regression test.

## Local settings and notebook storage

`src/lib/storage.ts` selects Tauri plugin-store or the browser data-server store.
`src/lib/virtual-fs.ts` and `src/lib/notebook.ts` use local filesystem adapters;
`cli/src/notebook.ts` uses the same app-data notebook directory. SQLite snapshots
alone do not include those files. Trusted-local plugin manifests and enablement
state are read during discovery; plugin JavaScript runs only on invocation.

## Validation and remaining boundaries

Vitest includes shared financial planners, real SQLite migration/rollback tests,
app/CLI parity, transport contracts, read-only enforcement, import and restore
safety, and frontend behavior. Playwright exercises browser workflows at desktop
and narrow viewports. `pnpm inventory:check` rejects generated documentation drift.
The [MCP benchmark](../benchmarks/MCP-BENCHMARKS.md) uses real SDK transport and
fresh synthetic fixtures; provider token usage and live-model selection remain
separate evaluation work.

Preserved product limits include deferred recurring transfer rules, inferred
credit-card APR of zero where no APR is stored, and subscription planning without
a full browser subscription editor. See the [financial capability matrix](../research/FINANCIAL-CAPABILITIES.md)
for implemented features and the prioritized follow-up work.
