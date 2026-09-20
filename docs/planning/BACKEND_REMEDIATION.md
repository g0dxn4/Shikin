# Backend remediation ledger

Source baseline: `ae3eed7` · triaged 2026-09-18.

This is a sanitized source-level work plan. The private external handoff and its incident evidence remain outside the repository. Source matches below do not establish that current user data is incorrect. No real records are used for reproductions or repairs.

## Safety and scope

- Use fresh, synthetic temporary HOME/data/config roots. Never run installed automation against user storage to reproduce a finding.
- Do not reset the running demo, repair the user's ledger, remove protected bridges, weaken finalized-history safeguards wholesale, or replay real statements.
- Keep frontend icon cleanup independent of backend ownership. No install, push, release, or production migration is part of this work.
- Reproduce a bounded cluster, agree its semantics, implement and test it, then perform one integrated risk-matched review. Storage, provenance, reconciliation and migration changes require a Sol high-or-higher final gate.

## Authorized continuation

The user has authorized completing the remaining actionable remediation across React, CLI and MCP. [Approved implementation contracts](./BACKEND_IMPLEMENTATION_CONTRACTS.md) define the financial semantics before durable schema or mutation changes. This does not authorize production repairs, installation or release.

**Source remediation complete locally; final financial/storage gate passed:**

- Reporting eligibility including ledger staging, validated split-aware category readers, currency/invalid-data completeness, gross/deficit wording, read-only recap generation and explicit saving. Remaining forecast/health/anomaly/recurring/upcoming-bill adapters are included.
- Pure/lazy storage initialization, native-binding preflight before filesystem mutation, explicit custom-root migration approval, native/Node policy parity and distinct ABI/missing/permission/open/invalid/schema diagnostics.
- Additive migration 021, atomic native/hosted execution, staged CLI restore through 019→020→021, read-only CLI readiness and future-schema rejection. New evidence tables do not themselves implement domain workflows.
- Declared recap effects and `save-spending-recap`: the foundation checkpoint exposes 92 shared tools / 97 CLI commands. Financial revision triggers exclude recap/audit writes.

- Audited metadata/split corrections and explicit consumption classifications, with preserved match/unmatch provenance and protected financial membership. CORR-01–05 integration fixes cover unresolved placeholders, unsafe allocation amounts, the public split path, category direction and declared revision effects.
- Dated reconciliation, independent coverage, deliberate pending settlement, exact-row finalization and token-bound bridge supersession. Native account maintenance includes coverage/history, explicit settlement, reviewed finalization/supersession and legacy identity binding, with local-calendar boundaries and guarded dialog lifecycles.
- Ownership-aware exact-decimal valuation, signed card credit/debt, verified quote identity and explicit FX completeness across CLI/React. VAL-01–06 retain native subtotals without FX, normalize tiny numeric inputs, correct cross-currency ROI, suppress unknown gains, sort comparable values and preserve actual provider quote dates.
- Reversible virtual bucket maintenance with shared CLI/native policy, Budgets maintenance/history dialogs and locked source/target revalidation. Virtual corrections do not mutate real accounts or transactions.
- Atomic imports, separate identity/content fingerprints, candidate-specific decisions, actionable reviewed React previews, exhaustive keyset traversal and additive/redacted evidence export. Cross-source external IDs no longer bypass ambiguity review.
- Payment evidence linking/unlinking, canonical capacity and baseline accounting across shared policy, CLI and native services/dialogs. Native reviews bind lineage, operation, normalized inputs and evidence; strict calendar dates, signed card credit/overdraft parity and postcommit lifecycle handling are integrated.
- Read-only CLI/hosted/native runtime diagnostics and Settings data-identity panel; instance identity is initialized only by explicit startup, outside database backups.
- Native consumption classification, unclassified transaction review and Reports gross/net basis with independent classification and coverage completeness.
- Registered automation discovery: **108 shared tools / 113 CLI commands**, catalog `2026-09-19.backend-remediation`; application remains `1.0.10`.

**All actionable in-scope findings are closed.** Native safety/navigation, nullable maintenance, isolated acceptance and the Sol high financial/storage final gate are complete. Final evidence and deployment limits are recorded below. Optional bucket hierarchy, new category automation and a new subscription-management GUI remain outside this remediation scope. The historical 92/97 foundation inventory is not the current domain inventory.

## Completed first slice: explicit-isolation fail-closed (historical)

**DEP-01 at initial triage: partially mitigated; remaining gap reproduced.**

Current `scripts/install-cli.sh` launchers do not contain the handoff's hard-coded runtime HOME/XDG overrides. They pin a Node executable. `cli/src/app-data-dir.ts` and `scripts/app-data-dir.mjs` already support `SHIKIN_RESPECT_XDG_DATA_HOME=1` with an absolute XDG data root, and browser development supplies that option.

At that baseline, an invalid/missing XDG root or unsupported platform silently disabled the requested isolation. A disposable synthetic reproduction confirmed that `SHIKIN_RESPECT_XDG_DATA_HOME=1` plus a relative XDG path moved a fake AppConfig database into the fallback HOME data directory.

Approved bounded fix:

- Validate the explicit isolation request before any filesystem preparation or migration.
- Accept unset/empty/`0` as normal mode, and `1` only with an absolute XDG root on XDG platforms; reject unsupported platforms and other nonempty flag values rather than fall back.
- Mirror CLI and data-server behavior, with synthetic source/destination preservation tests.
- Preserve ordinary-mode storage resolution and migration behavior. Do not claim that setting XDG alone is safe isolation, or that this repairs a separately installed wrapper.

Status: **bounded slice fixed and reviewed**. Planning review approved this scope with no blockers. Commit `5c3e33d` adds the guard and synthetic-root parity tests. Integrated Sol high database review reported no material database issues; subsequent DEP-01 work is covered by the final gate below.

The later integrated storage slice adds explicit custom-root migration consent and native/Node isolation policy parity. Installed-wrapper remediation and native macOS/Windows execution are not claimed. Runtime/instance identity is integrated and covered by the final gate.

**DEP-02: fixed and reviewed.** Database/notebook imports no longer prepare storage. Immutable context validation and cached in-memory native-binding preflight precede authorized preparation, and constructor/schema errors retain distinct codes/causes. Synthetic tests cover failure preservation and lazy notebook migration; this is more than a message-only change.

## Initial source verification ledger (historical triage)

The following table preserves the initial diagnosis, not the current implementation state. The integrated-delivery section above and checkpoints below supersede its original open statuses. Final closure evidence and limits are recorded below.

| ID     | Assessment                               | Current source / next action                                                                                                                                                                                                                   |
| ------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMP-03 | Implemented; final review due            | Shared eligibility now covers posted/cleared, normal reporting/ledger, archive/kind exclusions and native-currency completeness across the audited readers.                                                                                    |
| IMP-22 | Implemented; final review due            | Summary/recap and remaining reader adapters use validated split allocations exactly once; malformed eligible evidence reports incomplete/unresolved IDs.                                                                                       |
| IMP-24 | Partially implemented                    | Gross basis is explicit and deficit wording is signed. Explicit allocation classifications and net-consumption semantics are still in progress; no heuristic refunds/principal.                                                                |
| IMP-04 | Implemented; final review due            | Default recap reads write no tables. Explicit save has stable logical identity, audits actual changes and leaves identical repeat saves unchanged; deployed CLI/MCP preservation checks pass.                                                  |
| IMP-01 | Open; policy required                    | `transactions.ts:updateTransaction` blocks metadata edits on finalized batches. Introduce an audited allowlisted correction path without relaxing financial guards.                                                                            |
| IMP-23 | Open, source-confirmed                   | `currency-and-splits.ts:splitTransaction` is atomic but lacks matching lifecycle, preview and audit protections. Share the agreed correction policy with IMP-01.                                                                               |
| IMP-02 | Open, narrower than historical wording   | `transactions.ts:matchTransferTransactions` rejects excluded rows; the batch-finalization guard explicitly permits the match action. Preserve both original treatments for reversible match/unmatch.                                           |
| IMP-17 | Open, source-confirmed                   | Transaction update replaces supplied `source`/`note`; imports still use note tokens for identity. Separate edit audit metadata from import provenance.                                                                                         |
| IMP-06 | Open, source-confirmed                   | `accounts.ts:getEffectiveLedgerBalance` is all-date while reconcile/finalize accept dated observations. Define current versus as-of behavior and preserve later activity.                                                                      |
| IMP-07 | Open, source-confirmed                   | Finalization selects all staged rows and clears them; min/max dates do not establish settlement or complete statement coverage.                                                                                                                |
| IMP-08 | Open; workflow absent                    | Protected bridge replacement/supersession requires an explicit atomic, audited workflow; generic deletion stays blocked.                                                                                                                       |
| IMP-09 | Open, source-confirmed                   | CLI card/net-worth readers and frontend `net-worth-store.ts` use absolute card balances as debt. Test negative debt, zero, and positive customer credit without changing stored signs.                                                         |
| IMP-19 | Open, source-confirmed                   | CLI net worth sums nominal currencies and ignores market quote currency. Frontend has conversion/completeness handling; do not generalize this CLI finding to every UI reader.                                                                 |
| IMP-20 | Open, conditional                        | CLI and frontend net-worth readers add account balances plus linked holdings, which can overlap. Explicit cash-plus-holdings versus portfolio-snapshot ownership, including unresolved legacy ambiguity, is defined in the approved contracts. |
| IMP-21 | Open, source-confirmed reader risk       | Investment quote readers join/partition by symbol. Quote provider currency and instrument identity require a separate bounded audit and synthetic fixtures.                                                                                    |
| IMP-10 | Open, source-confirmed                   | CLI transaction query is capped at 100 without traversal or an ID tie-break. Frontend paging does not fix the CLI contract.                                                                                                                    |
| IMP-11 | Partially mitigated                      | Fuzzy duplicate rules remain; same-source disjoint external-ID mitigation already exists. Test legitimate repeats separately from reimports.                                                                                                   |
| IMP-12 | Open, source-confirmed                   | Import identity columns exist, but CLI CSV identity still depends on mutable note tokens without source namespacing. Design backfill/conflict behavior before migrating anything.                                                              |
| IMP-13 | Open, source-confirmed                   | CSV preview lacks intrafile dedup state; apply commits row-wise. Choose atomic or explicitly resumable semantics, not an undocumented mixture.                                                                                                 |
| IMP-14 | Open, source-confirmed                   | Account metadata schemas lack explicit set/clear distinction; transaction category clearing also needs a supported contract.                                                                                                                   |
| IMP-15 | Open, source-confirmed                   | Bucket API exposes creation/list/allocation, not maintenance/reversal/reallocation. Virtual corrections must not change real account balances.                                                                                                 |
| IMP-05 | Historical basis defect appears fixed    | Reconcile uses effective ledger, applies inside a transaction and verifies parity. Keep regressions; do not reopen the old stored-balance diagnosis.                                                                                           |
| IMP-16 | Existing guard; regression scope remains | Current price service rejects non-positive quotes. Verify unsupported/provider-error/sub-cent cases without live provider calls; no historical data repair is authorized.                                                                      |
| IMP-18 | Original diagnosis invalid               | Category is optional; explicitly blank category is rejected. Quiet mode suppresses successes, not errors. Do not patch omission as though it were broken.                                                                                      |

### Shared reporting boundary needing care

`packages/finance-core/src/reporting.ts:getCashFlowEligibility` now validates ledger treatment as well as posting/reporting/archive/kind eligibility; absent legacy treatment retains normal semantics. Shared adapters exclude staged rows and validate parent amounts, currencies and split ownership/totals before returning complete aggregates. Excluded malformed rows must not poison eligible reporting. Gross recorded totals do not establish independent statement coverage.

## Original implementation sequence

1. **Isolation and initialization:** finish the bounded explicit-isolation guard; separately design normal migration intent and native-runtime preflight/diagnostics.
2. **Reporting correctness and read-only recap:** IMP-03/22/04, with accurate gross-flow/deficit wording from IMP-24. Tests cover exclusions, staging, archived mirrors, splits, currency grouping and all-table no-write checks.
3. **Audited corrections and matching:** IMP-01/23/17/02. Field allowlists, provenance preservation, reversible treatments, dry-run/apply parity and rollback precede any relaxation.
4. **Dated reconciliation and settlement:** IMP-06/07/08, retaining IMP-05 regression. Do not treat staging as evidence that a bank hold settled.
5. **Liability and portfolio valuation:** IMP-09/19/20/21, retaining IMP-16 regression. Do not infer a positive card balance is malformed or double-count linked assets.
6. **Imports and exhaustive reads:** IMP-11/12/13/10. Source-scoped identity and conflict semantics precede backfill and resumability decisions.
7. **Correction APIs and diagnostics:** IMP-14/15, existing-payment statement linking (UX-01), non-sensitive instance identity (DEP-03), completeness/discovery improvements (UX-02/04). Optional bucket hierarchy (UX-03) remains an enhancement, not a corruption fix.

## Validation and parallel icon cleanup — 2026-09-18

- `pnpm check`, **121 test files / 1,340 tests**, and frontend build passed on the integrated isolation and icon changes. The focused CLI/MCP public-contract and isolation selection also passed all 84 tests.
- `pnpm build:cli` now deploys the production package and performs a real MCP SDK handshake, checks parity of all **91 shared tools** with the CLI catalog, validates input schemas, reads the same synthetic account and transaction through both surfaces, checks invalid-input/domain error behavior, and exercises financial dry runs through both CLI and MCP.
- Exact snapshots of every SQLite table before/after those reads and dry runs remained unchanged. The committed account/expense fixtures are intentionally created only in fresh disposable storage before that preservation baseline. This verifies the exercised contracts, not every financial calculation or the still-open recap side effect.
- The deployment harness now overrides HOME, USERPROFILE, APPDATA, LOCALAPPDATA, XDG and temporary-directory roots, strips inherited Shikin runtime options, and uses an ephemeral loopback port. Linux deployment/MCP execution passed. macOS/Windows environment construction was added but not executed on those native operating systems.
- Decorative goal emojis now render through the existing Lucide pack, including human-readable EN/ES picker labels. Stored icon strings and form payloads are unchanged. **UI-01 fixed:** unknown inherited object-property names now safely select the fallback icon; three regressions failed before the guard and pass afterward.
- Browser checks used a separate, newly created hosted fixture—not the user's running preview—and verified keyboard icon selection, saved legacy icon value, Lucide rendering in Goals and Overview, and a 390px layout without overflow. That temporary server and its data were removed afterward. No real financial records were read or modified.
- Integrated final review: no material database issues. No install, release, or push performed.

## Foundation checkpoint — 2026-09-18

At source commit `c7c71c5` (integrated as `9c2358f`), **127 files / 1,439 tests**, `pnpm check`, and the packaged CLI/hosted/92-tool MCP smoke passed in isolated storage. Focused foundation/fixture validation passed 100 tests. The serial full suite took about 126 seconds; a 120-second wrapper timeout is insufficient and is not evidence of a product hang.

Migration tests cover fresh/legacy upgrade, rollback, revision exclusions, staged restore preservation and active-versus-voided payment evidence references. Native migration execution uses a SQLite-backed command shim; it is not installed-app or macOS/Windows deployment evidence. Domain workflows and the final integrated financial gate remain outstanding.

## Domain integration checkpoint — 2026-09-19

Integrated commits: valuation `3337965`, accounts/reconciliation `eb978a6`, valuation corrections `eda8f26`, correction-policy fixes `da08f83`, and imports/traversal `92bdd83`. Bucket maintenance and locked revalidation were previously integrated as `37f5ce9` / `9767001`.

Parent-run focused checks passed: 34 valuation/UI tests, 53 correction/split tests, 55 account/reconciliation tests and 18 import tests. Root and CLI TypeScript checks passed at `92bdd83`. These selected runs are not a full-suite or final-review claim; legacy fixture/catalog integration remains unfinished.

| Finding      | State | Evidence / remaining action                                                                                                                         |
| ------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUCKET-01–02 | Fixed | Locked allocation inputs and patch-only metadata updates; 16 focused bucket tests previously passed.                                                |
| CORR-01–05   | Fixed | Integrated correction guard regressions; 53 parent-run selected tests passed.                                                                       |
| VAL-01–05    | Fixed | Integrated native subtotal, numeric precision, ROI and UI fixes; 34 parent-run selected tests passed.                                               |
| VAL-06       | Fixed | Actual AV/Finnhub/CoinGecko source dates, failure preservation and retrieval-based refresh cadence are integrated.                                  |
| IMP-F01      | Fixed | Unbound legacy matches require candidate-specific review despite an incoming external ID.                                                           |
| IMP-F02      | Fixed | CLI and native imports validate safe cumulative/resulting account balances atomically.                                                              |
| IMP-F03      | Fixed | React transaction creation and evidence-only decisions audit in the same transaction.                                                               |
| IMP-F04      | Fixed | Redacted export removes raw identity material and external identifiers alongside sensitive provenance.                                              |
| IMP-F05      | Fixed | Real SQLite preservation/rollback and refresh regressions are restored.                                                                             |
| IMP-F06      | Fixed | Native review shows candidate pairs/counts/limitations, recovers stale decisions and invalidates committed imports even after closing.              |
| IMP-F07–08   | Fixed | Malformed OFX/QIF financial rows, dates and ambiguous currencies/accounts reject atomically; missing source currency is disclosed.                  |
| IMP-F09      | Fixed | Only genuinely distinct IDs within the same case-sensitive namespace bypass fuzzy review; OFX/QFX and other cross-source matches require decisions. |

No real/demo financial data was used for these validations. No installation, provider quote request, push, release or production migration is claimed.

## Native and automation checkpoint — 2026-09-19

At integrated `3e4d5dc`, the parent ran the full Vitest suite: **161 files / 1,751 tests passed** (parallel run). Root, CLI and finance-core TypeScript, repository ESLint/format checks and the production Vite build passed after native policy integration. Existing bundle-size warnings remain nonblocking. Earlier parent selections passed 116 import/payment/provider tests, 79 account-history/Settings tests and 28 Accounts integration tests. These are executed checks, not an installed-app or final-review claim.

The catalog delivery additionally ran 261 contract/CLI/MCP tests and the packaged **108-tool** CLI/MCP/hosted smoke on its branch. Subsequent integrated domain changes still require final validation. No dependency manifests or lockfiles were changed.

The existing synthetic preview required a backend-only schema upgrade because the new frontend queried 021 columns/tables against its old 020 server. The deleting development supervisor was detached, the backend shut down gracefully, and Vite stayed running. Private backups and before/after hashes verified that every existing column value in **26 tables, including 566 transactions**, was preserved. The current preview uses schema 021 and its authenticated runtime-diagnostics endpoint succeeds. This was not a real-user-data or production migration.

### Named integration closure

| Finding          | State | Required closure                                                                                                                     |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ACC-01–03        | Fixed | Original stored-balance provenance and truthful preview/applied compatibility responses; integrated tests/types pass.                |
| ACC-04–06        | Fixed | Local dates, context guards, saved-but-refresh-failed messaging and immediate postcommit invalidation before store refresh.          |
| IMP-IDENTITY-UI  | Fixed | Reviewed native binding in staged history and Transaction details; exact opaque IDs and unknown original content preserved.          |
| PAY-01           | Fixed | Report-excluded ordinary repayment evidence remains eligible; known classifications still constrain capacity.                        |
| PAY-02–05        | Fixed | Strict dates, lineage/input/evidence-bound tokens, signed-credit/overdraft parity and committed-refresh lifecycle handling.          |
| ACCT-UI01–03     | Fixed | Statement controls, separate portfolio-account maintenance and exact account deep links; background refresh keeps dialogs mounted.   |
| CONS-UI01–02     | Fixed | Historical net periods with strict dates, latest-only loading/error/retry behavior and contextual review links.                      |
| IMP-14 remainder | Fixed | Goal/recurring/subscription set-clear-omit semantics, hidden recurring subcategory preservation and native investment-note clearing. |
| FINAL-GATE       | Fixed | Sol high final financial/storage gate passed after the named account-evidence and server-lifecycle fixes.                            |

Additional integration findings: **IMP-STAGING-UI fixed** by explicit native posted/staged/pending import choices, pending acknowledgement, stable batch IDs and option-bound tokens. **IMP-STAGE-01 fixed** by retaining per-prefix safe-integer balance checks for normal imports while staged rows remain neutral. **IMP-NULL-01 fixed** by synchronous, patch-only goal updates that do not rewrite omitted financial fields.

## Integrated acceptance checkpoint — 2026-09-19

At `1b859fe`, parent validation passed:

- **166 Vitest files / 1,824 tests**, using `--maxWorkers=2 --testTimeout=15000`. Earlier five-second defaults produced subprocess-startup timeouts in rollback/diagnostics tests; their isolated reruns and the complete bounded run passed. No repository timeout was relaxed.
- Root, CLI and finance-core TypeScript; repository ESLint and source formatting; production Vite build. Existing chunk-size warnings remain nonblocking.
- **27 Rust library tests**, with `cargo test --locked --offline --lib`, including storage policy, native transactions, snapshot/WAL and local identity. This is Linux source validation, not installed cross-platform execution.
- Packaged **108-tool CLI/MCP** parity and representative import, correction, coverage, payment, runtime-read, recap and hosted-web workflows. A stale smoke expectation omitted the payment-link reader's correct `writesTo: []`; the expectation was corrected, not the declared effects. The successful local smoke used offline cached package assembly, disabled lifecycle scripts explicitly and copied the existing ABI-tested SQLite binding. No dependency manifest/lockfile changed. An earlier packaging attempt reused cached packages but ran the native addon's installer in its disposable bundle; no application installation is claimed.
- Fresh isolated hosted-browser acceptance: native staged OFX import without balance impact; exact legacy identity binding preserving unknown content and original provenance; deliberate pending settlement and dated finalization retaining later activity; reviewed bridge supersession preserving current and later anchors; real card payment plus statement-only baseline and unlink; native classification with known-currency subtotals and independent coverage incompleteness; bucket allocation, atomic correction and reversal with immutable signed history and no real-account changes.
- Mobile portfolio deep links reveal/focus the correct separately managed account without horizontal overflow. Settings exposes schema/version and separate opaque lineage/local-instance identities without paths. Background-refresh dialog survival was checked in the browser after its fix. A mobile pending-import preview required explicit acknowledgement, displayed one staged/pending row and zero balance impact without overflow; cancellation created no transaction.

All browser mutations used a fresh synthetic root, not the populated preview or real finances. The preserved preview remains available and still contains **566 transactions**, with SQLite quick-check passing. No live market-provider request, installed-app launch, push, release or production migration was performed. macOS/Windows installed execution remains untested. The final review approval is recorded below.

### Final-gate findings

| ID                 | State            | Evidence / required closure                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DB-FINAL-01        | Fixed / approved | At `a46de9a`, CLI/native guards block generic mode changes with reconciliation observations and currency changes with reconciliation/coverage evidence, including zero-balance/no-transaction accounts. Parent checks passed: 38 guard/rollback tests plus 15 account-history regressions. Same-context metadata and evidence-free account changes remain supported. Sol high follow-up explicitly approved this finding's closure. |
| LOCK-01            | Fixed / approved | Fixed at `5dc9a80` with asynchronous server ownership. Current validation: 1,838 tests / 167 files, types/lint/format, app/CLI builds, 27 Rust tests and controlled offline 108-tool smoke passed. Four WebKit desktop/mobile rapid-report-period runs now passed with unchanged read-only table digests and no external requests. Sol follow-up found the separate shutdown lifecycle gap below.                                   |
| LOCK01-SHUTDOWN-01 | Fixed / approved | At `0620681`, shutdown closes admission and drains the active owner before closing SQLite/exiting. A deterministic disconnected-restore/SIGTERM test failed before the fix and passed afterward; parent HTTP contracts passed 16/16. Sol high explicitly approved the severe gate.                                                                                                                                                  |

## Final closure — 2026-09-19

At `0620681`, including the mobile history-width fix `e2887bc`:

- **1,839 tests / 167 files passed**, with two workers and a 15-second command-line timeout; no repository timeout defaults changed.
- Root/CLI/finance-core TypeScript, repository ESLint, source formatting, production frontend and CLI builds passed. **27 Rust library tests passed** offline/locked.
- The rebuilt packaged CLI/MCP passed the controlled offline **108-tool** smoke again, reusing 130 cached packages with zero downloads and disabled lifecycle scripts.
- Four WebKit desktop/mobile-viewport history/report runs passed, including rapid period changes, unchanged all-table read digests, no horizontal overflow and no external requests. The earlier Chromium financial-mutation acceptance remains recorded above.
- The **Sol high financial/storage final gate passed**. The original full review and bounded follow-ups closed DB-FINAL-01, LOCK-01 and LOCK01-SHUTDOWN-01; no material findings remain open.
- The existing preview backend was refreshed without restarting Vite or reseeding. Backups and logical hashes verified **all 35 application tables unchanged**, including **566 transactions**; schema 21 diagnostics and SQLite quick-check passed.

This closes the requested source remediation, not an installed-platform release certification. macOS/Windows installed execution remains unperformed; browser acceptance is targeted rather than exhaustive. No real finances were repaired, no live provider request was made, and no application installation, push, release or production migration was performed.

## Language accessibility and code-quality follow-up

Integrated fixes: `b3d9ffb`, with scoped HMR listener cleanup in `1c2234c`.

| Finding    | State                     | Fix and closure evidence                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| QA-LANG-01 | Fixed / verified / closed | Document language now follows i18next's resolved language at startup and on subsequent changes. Real-i18next regressions failed against the old code, then passed. Browser tests verify English/Spanish switching, navigation, persisted reloads, regional Spanish and unsupported-language fallback.   |
| QA-LANG-02 | Fixed / verified / closed | Settings now displays the resolved language rather than an unmatched regional code. A cached `es-MX` preference was reproduced with Spanish UI but English HTML/selector before the fix; afterward the heading, HTML and selector all resolve to Spanish while the cached preference remains unchanged. |

Closure checks at `1c2234c`:

- **1,844 tests / 168 files passed**, including five new real-i18next regressions; the focused i18n/Settings selection passed 33 tests.
- **28 browser tests passed:** seven language scenarios across Chromium and WebKit, each at desktop and mobile widths, using an isolated synthetic hosted database. The original `es-MX` reproduction was also manually rechecked through agent-browser.
- Repository TypeScript (root, CLI and finance-core), ESLint, source formatting and production frontend build passed. The existing large-chunk build warning remains a nonblocking performance follow-up; no bundle refactor was included.
- Independent integrated code-quality review approved both findings with **no material findings** in the language/bootstrap/Settings scope. Module-local listeners use Vite disposal cleanup rather than production global state. Static HTML retains English until JavaScript runs, intentionally.

Both issues were marked closed only after integration, regression tests, browser verification and review. No financial code, schema or dependency changes were made. Repository-wide automated checks are not a claim of an exhaustive architectural audit; installed-platform validation limits above still apply.
