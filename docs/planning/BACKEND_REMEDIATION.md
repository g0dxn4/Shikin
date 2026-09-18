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

Current independent work is **in progress, not yet integrated**:

- Reporting eligibility including ledger staging, split-aware category readers, gross/deficit wording, read-only recap generation and explicit saving.
- Pure/lazy storage initialization, native-binding preflight before filesystem mutation, explicit custom-root migration approval, native/Node policy parity and accurate failure diagnostics.

Subsequent dependent work covers additive schema, audited corrections/classifications, dated reconciliation/coverage/supersession, valuation/quote identity, atomic imports/keyset traversal, virtual maintenance/payment links and instance diagnostics. Optional bucket hierarchy remains outside the correctness scope.

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

Remaining DEP-01 decisions: ordinary custom-XDG migration opt-in, native desktop isolation, installation-specific wrapper remediation, and resolved database identity before writes. These are not silently included in this small fix.

**DEP-02: confirmed source-level diagnostic/ordering concern, not yet fixed.** `cli/src/database.ts:openDb` gives initialization advice for any constructor failure; module-level `prepareAppDataDir` runs before native binding validation. A complete fix must address ordering as well as distinguish ABI, missing-file, access and corruption errors. A message-only change cannot establish that a wrong-runtime invocation never relocates data.

## Source verification ledger

All open entries require isolated acceptance tests before being called runtime-confirmed or fixed.

| ID     | Assessment                                    | Current source / next action                                                                                                                                                                                                                   |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMP-03 | Open, source-confirmed                        | `cli/src/tools/transactions.ts:getSpendingSummary` and `audit-and-context.ts:getOtherExpensesFindings` omit reporting/archive/staging eligibility. Summary already groups by currency; Other Expenses does not.                                |
| IMP-22 | Open, source-confirmed                        | Summary/recap category grouping ignores `transaction_splits`; split-aware frontend helpers already exist. Reconcile eligible per-currency parent totals with allocations exactly once.                                                         |
| IMP-24 | Open; separate correctness from new semantics | `cli/src/insights/recap.ts` reports gross flows and clamps deficit wording. Preserve/label gross basis, fix signed deficit text; do not invent refund/principal recognition without explicit source relationships.                             |
| IMP-04 | Open, source-confirmed                        | `financial-insights.ts:getSpendingRecap` and `insights/recap.ts` persist by default through `insights/shared.ts:saveRecap`. Define explicit save behavior and update tests that currently expect persistence.                                  |
| IMP-01 | Open; policy required                         | `transactions.ts:updateTransaction` blocks metadata edits on finalized batches. Introduce an audited allowlisted correction path without relaxing financial guards.                                                                            |
| IMP-23 | Open, source-confirmed                        | `currency-and-splits.ts:splitTransaction` is atomic but lacks matching lifecycle, preview and audit protections. Share the agreed correction policy with IMP-01.                                                                               |
| IMP-02 | Open, narrower than historical wording        | `transactions.ts:matchTransferTransactions` rejects excluded rows; the batch-finalization guard explicitly permits the match action. Preserve both original treatments for reversible match/unmatch.                                           |
| IMP-17 | Open, source-confirmed                        | Transaction update replaces supplied `source`/`note`; imports still use note tokens for identity. Separate edit audit metadata from import provenance.                                                                                         |
| IMP-06 | Open, source-confirmed                        | `accounts.ts:getEffectiveLedgerBalance` is all-date while reconcile/finalize accept dated observations. Define current versus as-of behavior and preserve later activity.                                                                      |
| IMP-07 | Open, source-confirmed                        | Finalization selects all staged rows and clears them; min/max dates do not establish settlement or complete statement coverage.                                                                                                                |
| IMP-08 | Open; workflow absent                         | Protected bridge replacement/supersession requires an explicit atomic, audited workflow; generic deletion stays blocked.                                                                                                                       |
| IMP-09 | Open, source-confirmed                        | CLI card/net-worth readers and frontend `net-worth-store.ts` use absolute card balances as debt. Test negative debt, zero, and positive customer credit without changing stored signs.                                                         |
| IMP-19 | Open, source-confirmed                        | CLI net worth sums nominal currencies and ignores market quote currency. Frontend has conversion/completeness handling; do not generalize this CLI finding to every UI reader.                                                                 |
| IMP-20 | Open, conditional                             | CLI and frontend net-worth readers add account balances plus linked holdings, which can overlap. Explicit cash-plus-holdings versus portfolio-snapshot ownership, including unresolved legacy ambiguity, is defined in the approved contracts. |
| IMP-21 | Open, source-confirmed reader risk            | Investment quote readers join/partition by symbol. Quote provider currency and instrument identity require a separate bounded audit and synthetic fixtures.                                                                                    |
| IMP-10 | Open, source-confirmed                        | CLI transaction query is capped at 100 without traversal or an ID tie-break. Frontend paging does not fix the CLI contract.                                                                                                                    |
| IMP-11 | Partially mitigated                           | Fuzzy duplicate rules remain; same-source disjoint external-ID mitigation already exists. Test legitimate repeats separately from reimports.                                                                                                   |
| IMP-12 | Open, source-confirmed                        | Import identity columns exist, but CLI CSV identity still depends on mutable note tokens without source namespacing. Design backfill/conflict behavior before migrating anything.                                                              |
| IMP-13 | Open, source-confirmed                        | CSV preview lacks intrafile dedup state; apply commits row-wise. Choose atomic or explicitly resumable semantics, not an undocumented mixture.                                                                                                 |
| IMP-14 | Open, source-confirmed                        | Account metadata schemas lack explicit set/clear distinction; transaction category clearing also needs a supported contract.                                                                                                                   |
| IMP-15 | Open, source-confirmed                        | Bucket API exposes creation/list/allocation, not maintenance/reversal/reallocation. Virtual corrections must not change real account balances.                                                                                                 |
| IMP-05 | Historical basis defect appears fixed         | Reconcile uses effective ledger, applies inside a transaction and verifies parity. Keep regressions; do not reopen the old stored-balance diagnosis.                                                                                           |
| IMP-16 | Existing guard; regression scope remains      | Current price service rejects non-positive quotes. Verify unsupported/provider-error/sub-cent cases without live provider calls; no historical data repair is authorized.                                                                      |
| IMP-18 | Original diagnosis invalid                    | Category is optional; explicitly blank category is rejected. Quiet mode suppresses successes, not errors. Do not patch omission as though it were broken.                                                                                      |

### Shared reporting boundary needing care

`packages/finance-core/src/reporting.ts:getCashFlowEligibility` already handles posting status, reporting treatment, archive status and technical transaction kinds. Its candidate currently has **no ledger-treatment field**. Merely routing a reader through that helper will not, by itself, exclude posted-but-staged rows. The next reporting slice must settle and test staging semantics consistently across adapters/readers rather than duplicate incomplete filters.

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

This ledger is a work queue, not a claim that all listed defects have been fixed or that every historical incident applies to the current build. The next financial correctness slice is reporting eligibility, split-aware category totals, and explicit recap persistence.
