# Native frontend integration

Status: complete — all 19 screens integrated, review findings resolved, and final validation passed. Local commits only; nothing installed, released, or pushed.

## Outcome and completion bar

Integrate the approved `designs/shikin-native-concept/prototype.html` direction into the existing React/Tauri/browser application. Preserve all 19 routes and real workflows. The prototype supplies appearance, information architecture, and interaction references **only**: none of its fixtures, balances, scenario math, mock settings, or read-only limitations belong in production.

Completion means:

- A calm native light/dark interface, 216px / 72px persistent collapsible sidebar, six desktop groups, contextual section navigation, and a mobile Overview / Transactions / Accounts / More layout.
- All 19 real screens use the new design; existing create/edit/archive/delete/import/reconcile/review/export/automation actions remain connected to their existing services and protections.
- A single compact shell page title; no repeated promotional headings above cards. Real chart titles, legends, dates, summaries, filters, and accessible alternatives remain.
- Charts and totals use real existing finance logic, with currency/date/transfer semantics preserved. No fabricated figures or prototype calculations.
- Transactions have explicit page navigation and bounded, parameterized database reads with deterministic ordering. Filters, splits, review reasons, edit lookup, and mutation refresh remain correct.
- No database schema/data-location change, reset, restore, or new destructive initialization. No operation in this work targets the user's real finance directory.
- Relevant unit/integration checks, full type/lint/format checks, browser E2E on isolated data, preservation checks, visual inspection, and an integrated review pass. Any unavailable runtime check or pre-existing failure is reported explicitly.

## Protected boundaries

Do not modify database schemas/migrations, data-location resolution, initialization/storage relocation, Rust snapshot/restore, CLI/MCP public contracts, finance-core semantics, or financial mutation bodies as part of this redesign.

Protected paths include:

- `schema/**`, `src-tauri/migrations/**`, `src-tauri/src/database_snapshot.rs`
- `src/lib/database.ts`, `scripts/data-server.mjs`, `scripts/app-data-dir.mjs`
- `packages/finance-core/src/**` (except additional tests if justified)
- Existing write methods in transaction/account/budget/goal/investment/receivable stores and split/reconciliation/import services

No new SQL `ALTER`, `DROP`, data `DELETE`, reset, seed-on-startup, or schema-version change. Existing user-requested mutation functions remain available and unchanged. Test-only fixture writes are allowed exclusively in temporary isolated databases, with unique fixture ownership and scoped cleanup.

`App.tsx` startup is intentionally not read-only: recurrence materialization, rates, history, net-worth snapshots, and price updates already exist. Preserve their behavior and lifecycle; do not duplicate them. Preservation fixtures must use future recurring dates and distinguish allowed cache/history upserts from protected finance records.

## Context map

| Area | Files | Planned change / dependencies |
| --- | --- | --- |
| Shell / navigation | `src/components/layout/{app-shell,sidebar,bottom-nav,tauri-title-bar}.tsx`, new shared navigation model | Six groups and all route tabs; compact header; persistent collapse; mobile More; preserve skip link, scroll/focus, Tauri chrome, and globally mounted dialogs |
| Appearance | `src/lib/theme.ts`, `src/main.tsx`, `src/components/ThemeSettings.tsx`, `src/stores/ui-store.ts`, `src/lib/constants.ts` | Native palettes/fonts/chart tokens, simple appearance control, collapse persistence; preserve stored custom-theme payloads |
| Global / primitive styling | `src/styles/globals.css`, `src/components/ui/*`, shared confirmation/pagination wrappers | Semantic surfaces, readable light/dark controls, modest radii, restrained motion; remove decorative glass/grid/glow dependence |
| App presentation | `src/App.tsx` | Theme-aware notifications/overlays only; routes and startup behavior unchanged |
| Overview / insights | Dashboard, insights, reports, net-worth, spending-insights, spending-heatmap pages; dashboard presentation components | Real-data charts and layouts in approved direction; retain analytical algorithms and accessible tables |
| Activity | Transactions and category-management pages; transaction presentation/forms; new read-only query module/hook | Explicit paginated ledger, filters and details; preserve timeline/review, imports, split rules, and mutation handlers |
| Accounts | Accounts, investments, receivables pages and domain presentation/forms | Native account/portfolio/owed-money views with real actions and data |
| Planning | Budgets, goals, bills, bill-calendar, debt-payoff, forecast pages and budget/goal presentation/forms | Native progress/calendar/scenario views, retaining all real domain services and controls |
| Settings | Settings and extensions pages | Native preferences/capabilities presentation; all actual configuration/data-management actions retained |
| Translation | Existing EN/ES page namespaces plus common shell namespace | Translate new labels without replacing existing vocabulary or losing namespaces |
| Tests | Existing page/component/store/theme tests; navigation/responsive/layout/transactions E2E; preservation regression | Update presentation assertions while retaining business/protection assertions |
| Design instructions | `DESIGN.md`, design section of `CLAUDE.md` | Establish approved HTML/native production system as source of truth; retire conflicting forced-dark/glass guidance |

## Route coverage and group ownership

| Group | Existing routes |
| --- | --- |
| Overview | `/` |
| Transactions | `/transactions`, `/categories` |
| Accounts | `/accounts`, `/investments`, `/receivables` |
| Planning | `/budgets`, `/goals`, `/bills`, `/bill-calendar`, `/debt-payoff`, `/forecast` |
| Insights | `/insights`, `/reports`, `/net-worth`, `/spending-insights`, `/spending-heatmap` |
| Settings | `/settings`, `/extensions` |

These are navigation groups, not deletion or merging of domain functionality. Recurring rules remain in Bills / transaction actions; subscriptions already surface within Forecast. Do not invent additional routes or add an assistant.

## Explicit product / architecture decisions

### Appearance

- Native light and dark become the simple supported defaults, using system-native sans typography and tabular financial figures.
- Preserve legacy valid `theme` payloads and advanced customization; do not clear or overwrite them during loading. A separate `appearance` preference chooses native light/dark versus saved custom appearance. Advanced controls may live behind a disclosure.
- Legacy fallback is explicit: when `appearance` is absent and a valid saved `theme` exists, keep that custom appearance selected; when both are absent/invalid, use native light. A user can select native light/dark without losing the saved custom appearance.
- Native-mode switching writes ONLY `appearance`; loading never writes either key. Explicit edits/reset in advanced custom settings may update `theme`, but native switching must not. Test a pre-seeded custom payload through native switching and reload and assert byte-equivalent stored `theme` and the ability to select it again. Keep initial theme application before rendering to avoid flash.
- Use semantic tokens for foreground, muted text, borders, surfaces, chart grids/tooltips and statuses. Do not globally replace user-selected category/goal colors.
- No heavy blur/glass/glow or mandatory animation. Respect reduced motion and Tauri/WebKit constraints.

### Shared presentation contracts

Foundation introduces a small, stable presentation vocabulary (toolbar/action row, panel, metric strip, controlled section/filter components as needed), not a new design framework. Pages continue owning their state/services. The shell owns the sole route `h1`; page actions remain visible in compact local toolbars. Preserve accessible field labels and chart headings.

Page workers may use the foundation's exported components and utility classes; they must not edit foundation files concurrently. Required shared changes return to the orchestrator for integration. Keep React Router 7, React Hook Form/Zod, Recharts, Zustand, Tailwind, and existing Radix primitives. Do not add libraries merely to mimic the prototype; a dependency requires a demonstrated gap and explicit integration decision.

### Monetary display rule (all 19 screens)

Every monetary aggregate must use existing currency conversion with completeness diagnostics, be grouped/labeled by currency, or be omitted with a clear unavailable state. Never raw-sum unrelated currencies or label a partial converted sum as complete. Cash-flow displays must use canonical posting/reporting eligibility, not only transaction type. This applies beyond the transaction page.

Inventory / ownership: Accounts' raw account/asset sums belong to worker C; Bills' run-rate sums and Forecast's inputs belong to worker D; Spending Heatmap's daily/category sums belong to worker A. Existing `useCurrencyStore.convertToPreferred`, `getTotalBalanceInPreferred`, the Reports implementation, Dashboard analytics conversion diagnostics, and Net Worth store are reference patterns. Worker D additionally owns read-only `src/lib/forecast-service.ts`, `src/stores/forecast-store.ts`, and their tests if required to provide properly scoped/converted forecast reads. Worker A owns only analytical presentation/read helpers for dashboard/heatmap; C converts/group totals at the page boundary. No worker may change currency-store or finance-core semantics or financial mutation bodies. Add mixed-currency and missing-rate tests to each affected source before calling its totals complete.

### Transaction read boundary

Create a separate typed query request/result boundary using existing `query()` transport and parameter binding, not new HTTP endpoints or schema changes.

Request: search, type, source-or-destination account, category, date bounds, normalized posting status, currency, review reason, whitelisted sort, page size and offset. Normalize null, empty and whitespace legacy statuses as posted exactly like finance-core `normalizePostingStatus`; SQL uses `COALESCE(NULLIF(TRIM(status), ''), 'posted')`. Test posted filters and review counts for all three legacy cases.

Result: page rows with current joined/protection metadata, matching count, full-result review counts/currency facets and any required summaries. Financial summaries must use existing reporting/conversion semantics; do not sum different currencies or only visible rows.

Required behavior:

- SQL filters precede `LIMIT`/`OFFSET`; deterministic sort includes a unique ID tie-breaker.
- Literal substring search escapes SQL LIKE wildcard/escape characters.
- Split transactions match split categories instead of parent categories; source and destination account filters both work.
- Review counts/eligibility and protection flags agree with the existing behavior.
- Default 50 rows, selectable 25 / 50 / 100; previous/next, numbered pages, total and visible range. Reset page on filter/sort changes, clamp after deleting the last row, preserve context when details close.
- Do not repurpose the global transaction store into a persistent page-only cache: Dashboard and other consumers must not receive partial data accidentally.
- Keep paged read state local/separate. Bounded by-ID loading is mandatory in edit mode; render the edit form only after the requested record is loaded. Loading, not-found and error states must prohibit submission of a blank/default edit form. Test editing a page-2 record while the global transaction store is initially empty.
- Define a single page-query invalidation entrypoint for add/edit/delete/review/import. Every success path must invoke it or publish an existing event consumed by the page; dialog close is not a substitute for a tested success signal. Refresh page rows, count, facets/review counts and page bounds together, reject stale request results, and test deleting the last row on the last page. Existing financial mutation implementations stay unchanged. Worker B owns the required dialog/presentation success callbacks and import UI integration, not import-service writes.
- Retain existing timeline and review workflows. Bulk editing is not currently implemented and is **not** added by this migration.

## Execution sequence

### Phase 0 — baseline and plan gate

1. Inventory files, routes, persistence boundaries, tests, and ownership (completed by read-only exploration).
2. Baseline `pnpm check` and `pnpm test:run` before application edits.
3. Independently review this plan with Sol high because financial preservation and cross-component coupling warrant a high-consequence planning gate.
4. Resolve material findings. Record a local checkpoint of the approved prototype and plan; do not push, tag, release, or rewrite existing commits.

Baseline observed:

- `pnpm check`: PASS.
- `pnpm test:run`: 1195 passed, 1 failed, 100 files. Pre-existing CLI automation-context test expected one monthly occurrence inside an inclusive 30-day window, which can legitimately contain two depending on the current month. Root cause was reproduced before app changes. A minimal test-only fixture stabilization now gives that fixture an explicit fixed-day anchor and end date of today; its focused test passes. No production CLI or recurrence behavior changed. Full suite will run again as the integration gate.

### Phase 1 — shared native foundation (one worker)

Own shell/navigation, appearance/theme settings, global/shared UI styling, constants, UI collapse state, shell translations/tests, settings/extensions pages, and corresponding E2E navigation/responsive/layout expectations. Also expose a non-invasive startup-state attribute in `App.tsx`: initial pending, running while existing startup tasks execute, ready only after their existing `Promise.allSettled` completes, error when startup errors remain. Do not change task ordering, writes, retries or price scheduling. Tests await this readiness and use no-investment fixtures.

Deliver stable component/CSS contracts and 19-route nav model. Keep routes/startup/global dialogs intact. Retain existing settings functionality and saved customization. Validate nearest theme/store/layout/settings tests, typecheck/lint, and native light/dark shell in isolation before integration.

### Phase 2 — page migration (four independent workers)

Launch only from the clean committed foundation. Each worker uses an isolated worktree and must return a preserved branch/commit.

- **A — Overview + Insights:** six pages plus their presentational/dashboard components, page namespaces and tests.
- **B — Transactions + Categories:** two pages, read-only pagination module/hook and query tests, transaction edit lookup/presentation, activity namespace/tests, transaction and preservation E2E. No mutation-body changes.
- **C — Accounts:** accounts/investments/receivables pages and their presentation/forms, namespaces and tests.
- **D — Planning:** six planning pages and budget/goal presentation/forms, namespaces and tests.

No concurrent ownership of globals, shared UI, common locale, dependency manifests, app startup, store mutations, or migration code. Workers report shared needs instead of changing shared files. Preserve existing domain forms/workflows; tokenizing their presentation is in scope.

### Phase 3 — integrate and validate

1. Inspect each returned diff, protected paths, commit/branch validity and actual tests; integrate sequentially. Commit/branch preservation failure blocks integration.
2. Run nearest affected tests, then `pnpm check`, full tests, frontend build and CLI build as appropriate.
3. Run sanitized isolated E2E, including all-route reachability and data preservation. Existing tests must not be weakened by skipping paths or removing assertions just to accept a new layout.
4. Inspect real-data fixtures (synthetic only) at 1440×900, 1280×800, wide desktop, and 390×844. Cover light/dark, collapsed/expanded sidebar, mobile More, header/subnav overlap, filters, charts, keyboard focus, dialogs, empty/error/loading states, and long content.
5. Validate available native/WebKit runtime/build support without launching against real app storage. If unavailable, explicitly report the limitation rather than claim desktop runtime validation.

### Phase 4 — integrated review and closure

Use one integrated general reviewer on Sol high for the complete testable changes, explicitly covering preserved financial boundaries and all-screen regressions. Track each stable finding ID as open/fixed/rejected/deferred with evidence. Fix verified in-scope material issues through original owners. Resume the same reviewer once for named IDs and changed delta; no unbounded review/refactor loop.

Update this plan with actual outcomes, update design instructions, provide verification results and remaining limitations. No automatic production data conversion, cleanup, release or deployment.

## Data preservation regression

Using the repository's isolated E2E data-server only:

1. Create uniquely named synthetic accounts, posted/pending/transfer transactions, split-category memberships and future recurring rules. Avoid investment refresh and due recurrence effects in the fixture.
2. Before app startup capture exact counts for protected finance tables plus canonical ordered rows for the protected fixtures (accounts, transactions, splits, categories, recurring rules). Use the full table count as well as fixture IDs so unexpected duplicate inserts cannot pass.
3. Mount the full application and await observable startup completion (not merely first paint or network idle). Navigate all groups, filter/page/sort/review transaction reads, reload and await completion again, switch appearance, and expand/collapse navigation.
4. Assert EXACT before/after counts for protected finance tables and byte/deep equality of canonical fixture records including centavos, currencies, statuses, provenance and balances. The only allowed mutations are to an explicit enumerated exchange-rate/cache, balance-history and net-worth snapshot table allowlist. No fixture may materialize a due recurrence or schedule investment refresh; unexpected inserts, updates or deletions of protected data fail the check.
5. Test user-initiated transaction edits/add/delete on **separate** owned fixtures using existing workflows and assert existing balance-impact rules, so preservation tests do not accidentally prohibit legitimate user actions.
6. Cleanup only the fixture's unique IDs/prefix; never an unqualified delete. Never point the server or browser bridge at real storage.

## Validation commands and environment

Safe static/unit commands: `pnpm check`, `pnpm test:run`, `pnpm build`, `pnpm build:cli`.

E2E: use `scripts/e2e-dev.mjs` through Playwright configuration; unset inherited `SHIKIN_BROWSER_USE_REAL_DATA`, `VITE_DATA_SERVER_URL`, `SHIKIN_DATA_SERVER_URL`, `SHIKIN_DATA_SERVER_PORT`, `SHIKIN_WEB_HOSTED`, and `SHIKIN_WEB_STATIC_ROOT` before starting. Verify the logged temporary data directory. Do not run `node scripts/data-server.mjs`, real-data dev mode, or default Tauri dev against the user's environment.

Do not claim checks that have not run. Any baseline fixture failure is tracked separately from frontend regressions.

## Rollback

- Preserve the original commits and the approved prototype checkpoint. Use additive implementation commits; never rewrite the user's existing history.
- If a phase fails, do not integrate its branch; preserve it for diagnosis. If an integrated frontend change must be rolled back, revert its code commit(s), not database contents.
- No database migration is planned, so there is no data rollback operation. Never restore/replace/reset the real user database to undo a UI change.
- Temporary validation databases may be disposed of only after confirming they are task-created isolated directories.

## Finding / outcome ledger

- BASE-1: fixed — date-sensitive mock recurrence fixture bounded to one explicitly anchored occurrence; focused regression passes; production logic unchanged.
- P1: fixed in plan — null/empty/whitespace posting normalization required and tested.
- P2: fixed in plan — mandatory edit by-ID loading/gating and one explicit success-invalidation path.
- P3: fixed in plan — all-screen monetary aggregate rule, source inventory and read-only ownership assigned.
- P4: fixed in plan — exact protected counts/rows, explicit startup completion and cache/history allowlist.
- P5: fixed in plan — legacy fallback, appearance-only writes and byte-preserving custom-theme test specified.
- Planning gate: APPROVED by Sol high after verifying P1–P5 corrections.
- Shared foundation and all four page groups: integrated, with preserved local commits and no production storage/schema/mutation changes.
- R1: fixed — the paginated query consumes legacy transaction-store refreshes through its existing invalidation event, covering startup recurrence without editing financial mutation bodies. Race/cleanup regressions pass.
- R2: fixed — all five affected views subscribe to mutable currency inputs; deferred rates, preference changes and invalid-rate updates recompute or withhold totals appropriately.
- R3: fixed — Overview uses the existing net-worth calculation, including unlinked holdings, and refreshes after account/investment changes. A live synthetic $12.34 expense immediately updated net worth from $70,767.34 to $70,755.00 without navigation/reload.
- R3-1: fixed — module-level serialization at the shared read-only net-worth calculation boundary survives unmount/remount and coordinates every caller. Caller errors propagate without poisoning subsequent reads. Actual-store remount/error regressions pass; financial calculation rules and snapshot/write methods remain unchanged.
- V1: fixed — category bars scale against the true maximum of an unsorted input; zero spending is not inflated. Unit and live visual checks passed.
- Integrated Sol high review: complete. Named findings were corrected and checked through bounded delta-only follow-ups; the final R3-1 closure reported no material findings. Earlier reviewer sessions had been cleaned up, so their continuations were explicitly limited to the same named findings rather than new broad reviews. No open material findings remain.

## Execution results

- Baseline after the isolated CLI fixture correction: 100 files / 1,196 tests passed.
- Integrated application before final review fixes: `pnpm check`, 115 files / 1,275 tests, `pnpm build`, and `pnpm build:cli` passed. The CLI deployment/hosted shared-database smoke uses temporary data.
- Full Chromium and WebKit E2E suites each passed 79 cases, with 13 intentional viewport-specific skips. Initial stale test selectors/translated heading expectations were corrected without weakening data assertions. After the final shared-read change, all 12 affected dashboard/preservation cases passed again in each engine.
- Preservation E2E now mounts and visits all 19 routes, exercises real transaction paging/filtering, toggles appearance, reloads, and asserts exact protected table counts and canonical fixture equality on desktop and mobile.
- Visual browser audits covered all 19 routes at 1280×800, 1440×900, 1920×1080 and 390×844 in both native appearances: 152 route/appearance/viewport combinations, each with one visible page heading, no document overflow, and no browser exceptions. Synthetic fixtures only.
- Final integrated checks: `pnpm check`, **116 files / 1,292 tests**, frontend build, `pnpm build:cli` deployment/hosted shared-database smoke, and `pnpm exec tauri build --no-bundle` all passed.
- Protected schemas, data-location code, finance-core calculations, CLI/MCP contracts and existing financial mutation bodies were not changed. The final net-worth-store exception is read coordination only; its calculation body and snapshot/write methods are unchanged.
- Linux desktop compilation passed with `pnpm exec tauri build --no-bundle`. The resulting application was **not launched against user storage**, installed, released, or pushed.
- WebKit 26 was tested with Playwright's matching browser build. Missing host libraries were extracted into a temporary test-only runtime; no system package installation was performed.
- Non-blocking build diagnostics: Vite reports the existing >500KB chunk/dynamic-import warnings. No dependency or bundling refactor is included.
