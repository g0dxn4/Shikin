# Pre-push mock-data QA

## Result

**Passed at `56e6bf8`.** All 19 screens were exercised with isolated synthetic data at desktop and mobile widths. Five application findings and two stale browser-test expectations were fixed, verified and closed. Nothing was pushed or released.

This is targeted pre-push acceptance, not proof that every control, financial scenario or installed platform has been exhaustively tested.

## Environment and preservation

- Production browser assets; independent finance, planning, cross-browser and automated-test databases, each with its own HOME/config/data root and loopback server.
- Populated fixtures copied from a frozen synthetic backup, not from or into real storage: 5 accounts, 566 transactions, 6 budgets, 3 goals, 8 recurring rules, 4 subscriptions, 5 receivables, 4 investments and historical charts.
- Only clone FX-cache and latest mock quote timestamps were refreshed; no market data was fetched. Unbound investments intentionally retained unknown current valuations.
- Startup legitimately materialized a synthetic $104 electricity payment. This was distinguished from test mutations and preservation failures.
- Original preview was not reset/reseeded; no real finances, schema, installed app or dependencies were changed. External browser/provider access was blocked.

## Screen coverage

Chromium interaction coverage: every row below at **1280×900 and 390×844**, with screenshots, readiness, semantic heading, usable controls, navigation and horizontal-overflow checks. Independent WebKit sweeps covered all 19 routes at **1280×900 and 375×812**, including another sweep after the UI fixes.

| Screen            | Meaningful exercised behavior                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview          | Summary, History, Compare Accounts and history range; unavailable-total explanation                                                              |
| Transactions      | Search, type/date filters, Timeline/Ledger/Review; expense create/edit/reload/delete/cancel with exact centavo balance checks                    |
| Categories        | Validation, create/edit, cancel/Escape and reload persistence                                                                                    |
| Accounts          | Account create/edit/cancel; history accordion and screen-reader values; maintenance/statement dialogs; $10 card payment and exact ledger effects |
| Investments       | Stock filter, range selection and notes-only edit; invalid-name rejection and honest unpriced state                                              |
| Receivables       | Open/Overdue filters; create/edit/reload and validation                                                                                          |
| Budgets           | Periods, budget create/edit; virtual bucket allocate/correct/reverse, immutable history and unchanged bank balances                              |
| Goals             | Create/edit, stored contribution/progress and persistence                                                                                        |
| Bills             | Status filters, rule create/cancel; restored per-row edit, save/reload and notes/end-date null clearing                                          |
| Bill calendar     | Month navigation, populated day selection and recurring-payment state                                                                            |
| Debt payoff       | Avalanche/Snowball, extra payment, invalid negative/unsafe/fractional-cent drafts, valid decimals, correction and clear                          |
| Forecast          | Account and date-range changes                                                                                                                   |
| Insights          | Capability-card navigation                                                                                                                       |
| Reports           | Gross/Net, current/previous/custom periods, completeness/counts and filtered transaction-review navigation                                       |
| Net worth         | Ranges, accessible history table, unavailable totals and cause-specific warnings                                                                 |
| Spending insights | Insights, month-over-month and year-over-year views                                                                                              |
| Heatmap           | Range/day selection and transaction drill-down                                                                                                   |
| Settings          | EN→ES→EN, document language, reload persistence, light/dark and mobile appearance                                                                |
| Extensions        | Capability navigation; no installs or external actions                                                                                           |

## Closed findings

| ID                        | State                     | Correction and closure evidence                                                                                                                                                                                                                                                                                                                                 |
| ------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DASH-COMPARE-EMPTY-E2E    | Fixed / verified / closed | Empty-fixture test now asserts the actual comparison empty state and absence of unavailable account pickers. Populated comparison was separately exercised.                                                                                                                                                                                                     |
| TXN-ACCOUNT-BALANCE-LABEL | Fixed / verified / closed | Stale `Current Balance` selector updated to `Observed balance`; the full create/edit/persist expense scenario now passes in both layouts.                                                                                                                                                                                                                       |
| PREPUSH-FIN-01            | Fixed / verified / closed | Overview/Net Worth distinguish missing FX, unvalued holdings and unresolved ownership; no blank currency interpolation or fabricated totals. EN/ES browser checks and reason-specific regressions passed.                                                                                                                                                       |
| PREPUSH-FIN-02            | Fixed / verified / closed | History text alternatives format original centavos with account currency. Browser read-back matched $40,838.85, not $408.39; plot and ledger unchanged.                                                                                                                                                                                                         |
| PREPUSH-FIN-03            | Fixed / verified / closed | Removed primary raw-ID dump; incomplete count, model evidence and both period-bound review links remain. Navigation reaches the filtered transaction screen.                                                                                                                                                                                                    |
| PREPUSH-PLAN-01           | Fixed / verified / closed | Invalid extra-payment drafts retain the accepted projection and show accessible errors. Store rejects unsafe/noninteger/negative centavos. Final review caught fractional-cent precision; a red/green regression and native step-mismatch guard closed it. Chromium/WebKit desktop/mobile checks passed for rejection, decimals, correction and keyboard clear. |
| PREPUSH-PLAN-02           | Fixed / verified / closed | Visible bills now open the existing editor with the correct rule ID; Add Rule remains create mode. Desktop/mobile edit/save/reload/null-clear passed. Only notes/end-date/updated-at changed; transaction, split and account hashes remained unchanged.                                                                                                         |

Fixes: `326c4da`, `ec8dd0a`, `fd2602f`, `493fad9`, `a385a12`, `56e6bf8`.

The **Sol high integrated financial UI/input review** initially failed only the remaining fractional-cent case in PREPUSH-PLAN-01. The same reviewer inspected the named fix and reported no material findings. All other supplied IDs had already passed. No finding was closed merely because its initial implementation existed.

## Final checks

- **1,867 unit/integration tests / 169 files passed.** Two workers, 15-second command-line timeout; repository timeout defaults unchanged.
- **87 existing browser-suite tests passed; 15 expected viewport-specific skips.** Each skipped desktop/mobile layout case has its applicable counterpart in the other project.
- **4 additional cross-engine/viewport debt-validation cases passed**, covering the final precision fix and accepted-plan preservation.
- **38 populated WebKit route checks passed after the UI fixes**, with no page errors, no external requests and unchanged protected financial-row digests. The final one-line precision follow-up additionally passed the four focused browser cases above.
- Root/CLI/finance-core TypeScript, configured ESLint, source formatting, frontend/CLI builds and release preflight passed.
- **27 Rust library tests passed** offline/locked; Rust code was unchanged.
- Controlled offline **108-tool packaged CLI/MCP smoke passed**, using cached dependencies with lifecycle scripts disabled and loopback-only networking.
- All four isolated databases passed SQLite quick-check and foreign-key checks.

The existing Vite large-chunk warning is nonblocking. An extra lint probe outside the configured scope found two pre-existing warnings in `e2e/fixtures/tauri-mock.ts`; these were not application defects and were not expanded into unrelated cleanup. Changed E2E files passed lint.

## Evidence and limits

Private evidence: `/tmp/shikin-prepush-qa-szo283km/` contains initial/final receipts, screenshots, repro recording, logs, database verification and closure checks. Initial reports retain discovery-time OPEN states; this ledger records the verified final disposition.

The existing browser suite was copied to a temporary harness because its SQL helpers hardcode the development Origin on port 1420. Only those Origin headers were redirected to the isolated hosted origin; assertions and application authorization were not weakened. The existing preview ports were not reused.

Not claimed in this fresh manual pass: every statement/import/link/unlink path, split workflow, receivable matching/received workflow, full income/inactive-rule management, accepted live-provider price binding/refresh, updater/installer behavior or installed macOS/Windows/native GUI execution. Earlier focused acceptance and automated tests cover several of these, but are not substituted for fresh installed-platform certification.
