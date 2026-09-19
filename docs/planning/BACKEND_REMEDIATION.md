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

**Integrated locally; final financial review still due:**

- Reporting eligibility including ledger staging, validated split-aware category readers, currency/invalid-data completeness, gross/deficit wording, read-only recap generation and explicit saving. Remaining forecast/health/anomaly/recurring/upcoming-bill adapters are included.
- Pure/lazy storage initialization, native-binding preflight before filesystem mutation, explicit custom-root migration approval, native/Node policy parity and distinct ABI/missing/permission/open/invalid/schema diagnostics.
- Additive migration 021, atomic native/hosted execution, staged CLI restore through 019→020→021, read-only CLI readiness and future-schema rejection. New evidence tables do not themselves implement domain workflows.
- Declared recap effects and `save-spending-recap`: the foundation checkpoint exposes 92 shared tools / 97 CLI commands. Financial revision triggers exclude recap/audit writes.

- Audited metadata/split corrections and explicit consumption classifications, with preserved match/unmatch provenance and protected financial membership. CORR-01–05 integration fixes cover unresolved placeholders, unsafe allocation amounts, the public split path, category direction and declared revision effects.
- Dated reconciliation, independent coverage, deliberate pending settlement, exact-row finalization and token-bound bridge supersession. Native account maintenance exposes ownership declarations, observation dates and nullable clearing; advanced reconciliation dialogs remain unfinished.
- Ownership-aware exact-decimal valuation, signed card credit/debt, verified quote identity and explicit FX completeness across CLI/React. VAL-01–05 fixes retain native subtotals without FX, normalize tiny numeric inputs, correct cross-currency ROI, suppress unknown gains and sort comparable values.
- Reversible virtual bucket maintenance, including locked target/source revalidation; real accounts are not mutated by these virtual corrections.
- Atomic imports, separate identity/content fingerprints, candidate-specific decisions, reviewed React import previews, exhaustive keyset traversal and additive evidence export. Import preservation/redaction follow-up remains open below.

**Not complete:** payment evidence workflows, runtime-instance diagnostics, remaining actual frontend workflow parity, discovery/catalog synchronization, full integrated validation and the final financial review. Provider quote-as-of handling and named import follow-up are in progress. Optional bucket hierarchy remains outside the correctness scope. The historical 92/97 foundation inventory is not the final domain inventory.

## Completed first slice: explicit-isolation fail-closed

**DEP-01: partially mitigated in current source; remaining gap reproduced.**

Current `scripts/install-cli.sh` launchers do not contain the handoff's hard-coded runtime HOME/XDG overrides. They pin a Node executable. `cli/src/app-data-dir.ts` and `scripts/app-data-dir.mjs` already support `SHIKIN_RESPECT_XDG_DATA_HOME=1` with an absolute XDG data root, and browser development supplies that option.

However, an invalid/missing XDG root or unsupported platform silently disables the requested isolation. A disposable synthetic reproduction confirmed that `SHIKIN_RESPECT_XDG_DATA_HOME=1` plus a relative XDG path moved a fake AppConfig database into the fallback HOME data directory.

Approved bounded fix:

- Validate the explicit isolation request before any filesystem preparation or migration.
- Accept unset/empty/`0` as normal mode, and `1` only with an absolute XDG root on XDG platforms; reject unsupported platforms and other nonempty flag values rather than fall back.
- Mirror CLI and data-server behavior, with synthetic source/destination preservation tests.
- Preserve ordinary-mode storage resolution and migration behavior. Do not claim that setting XDG alone is safe isolation, or that this repairs a separately installed wrapper.

Status: **bounded slice fixed and reviewed**. Planning review approved this scope with no blockers. Commit `5c3e33d` adds the guard and synthetic-root parity tests. Integrated Sol high database review reported no material database issues; broader DEP-01 work below remains open.

The later integrated storage slice adds explicit custom-root migration consent and native/Node isolation policy parity. Installed-wrapper remediation and native macOS/Windows execution are not claimed; runtime/instance identity remains open.

**DEP-02: implementation integrated; final review due.** Database/notebook imports no longer prepare storage. Immutable context validation and cached in-memory native-binding preflight precede authorized preparation, and constructor/schema errors retain distinct codes/causes. Synthetic tests cover failure preservation and lazy notebook migration; this is more than a message-only change.

## Initial source verification ledger (historical triage)

The following table preserves the initial diagnosis, not the current implementation state. The integrated-delivery section above and checkpoints below supersede its original open statuses. Final closure still requires isolated acceptance tests and the integrated financial review.

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

## Sequenced implementation clusters

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

| Finding      | State | Evidence / remaining action                                                                                                                                         |
| ------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BUCKET-01–02 | Fixed | Locked allocation inputs and patch-only metadata updates; 16 focused bucket tests previously passed.                                                                |
| CORR-01–05   | Fixed | Integrated correction guard regressions; 53 parent-run selected tests passed.                                                                                       |
| VAL-01–05    | Fixed | Integrated native subtotal, numeric precision, ROI and UI fixes; 34 parent-run selected tests passed.                                                               |
| VAL-06       | Open  | Provider adapters currently stamp retrieval day instead of actual provider quote-as-of metadata. Preserve honest source dates and prior quotes on invalid metadata. |
| IMP-F01      | Open  | Incoming external IDs must not silently distinguish an otherwise identical unbound legacy row; candidate review/binding needs coverage in both import adapters.     |
| IMP-F02      | Open  | Import cumulative/current account balances require safe-integer checks, not only per-row checks.                                                                    |
| IMP-F03      | Open  | React import and evidence-only duplicate decisions need atomic audit parity.                                                                                        |
| IMP-F04      | Open  | Redacted exports must not leak descriptions/source identifiers embedded in raw identity material.                                                                   |
| IMP-F05      | Open  | Restore the previous import preservation/refresh guarantees as real SQLite regressions after the service test rewrite.                                              |

No real/demo financial data was used for these validations. No installation, provider quote request, push, release or production migration is claimed.

This ledger is a work queue, not a claim that all listed defects have been fixed or that every historical incident applies to the current build.
