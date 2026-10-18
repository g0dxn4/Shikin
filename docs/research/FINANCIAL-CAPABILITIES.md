# Financial capabilities research and implementation priorities

Research date: 2026-10-17. Baseline inspected: `880a70c` (Shikin 1.2.1).
This is a capability and invariants review, not financial advice or a claim that
every competing product has been tested. Product statements below come from the
primary sources linked in each section; Shikin statements come from the inspected
repository. No competitor implementation code is incorporated.

## Decisions

1. Preserve the shared integer-money ledger, correction, coverage, and reporting
   machinery. Shikin already implements much of the requested financial model.
2. Add explicit, append-only budget captures and revisions. An old date alone
   must not imply that a currently configured budget was the original plan.
3. Model received installments as links to existing posted bank transactions.
   Expected income must remain separate from account balances and actual income.
4. Reuse virtual cashflow buckets for reserves. Saving an allocation must never
   manufacture an expense or recurring bank transaction.
5. Extend existing scopes and category tooling incrementally. A broad replacement
   budget/category system would duplicate working reporting semantics.

## Competitor evidence and lessons

| Product       | Observed behavior in primary documentation                                                                                                                                                      | Consequence for Shikin                                                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Actual Budget | Local-first; category envelopes use received money; unused category money rolls forward; negative balances have an explicit rollover option.                                                    | Keep an actual-cash view separate from forecasts; make rollover policy visible.                                                                                |
| Firefly III   | Budgets, categories, and tags are separate concepts; budget amounts belong to periods. Rules can assign a category and a budget independently.                                                  | Transaction taxonomy must not be the sole definition of a budget. Reuse Shikin's independent scopes.                                                           |
| Sure          | Shared server/API clients and an external MCP endpoint; releases describe splits, budgeting/goals, and rollover work. Some planning features are explicitly preview features.                   | Share domain policy across clients and label feature maturity. Do not assume a release headline proves accounting invariants.                                  |
| Sure CLI      | Stable JSON envelope, versioned schemas, preview writes by default, explicit apply, transaction/category/budget/recurring commands.                                                             | Use a predictable automation contract and retain compatibility; these ideas do not require copying its implementation.                                         |
| YNAB          | Refunds go back to the spending category; target settings can affect past and future instances. API documentation uses explicit numeric units, wrappers, errors, and incremental reads.         | Preserve original refund evidence and report offsets separately. Frozen historical budget versions need a stronger contract than mutable target configuration. |
| Monarch       | Category and flex budgets; exclusions remove categories from budget without removing their cash flow; expense rollover includes prior balance, current plan, and actual spending.               | Budget exclusion must not hide bank activity. Show planned, actual, and carried amounts separately.                                                            |
| Lunch Money   | Expected versus actual income settings, per-category rollover options, and dated balance-adjustment history. Changing the global budget period deletes previous budgets according to its guide. | Keep the useful separation and history behavior; do not copy destructive period reconfiguration.                                                               |

### Actual Budget

Actual's [overview](https://actualbudget.org/) and
[budgeting guide](https://actualbudget.org/docs/budgeting/) describe local-first,
received-income budgeting, category balances, and rollover. A reserve therefore
belongs in a planning balance, not in cash expenditure.

Its [transfer documentation](https://actualbudget.org/docs/transactions/transfers/)
links both sides of an internal movement. Its
[reconciliation guide](https://actualbudget.org/docs/accounts/reconciliation/)
distinguishes cleared from uncleared totals and locks reconciled transactions.
Shikin's existing transfer matching and bank observations serve related purposes
without requiring the same storage design.

The [duplicate-merge guide](https://actualbudget.org/docs/transactions/merging/)
prefers bank-synced/imported evidence over manually entered records. Shikin should
retain its own persisted source identities instead of identifying duplicates by
amount alone. Actual's
[bulk-editing guide](https://actualbudget.org/docs/transactions/bulk-editing/)
warns about split-transaction behavior; Shikin batches must validate the final
allocation state and reject unsafe whole-parent changes. Its
[rules guide](https://actualbudget.org/docs/budgeting/rules/) documents ordered
matching and conflict resolution, reinforcing the need for explicit rule precedence.

### Firefly III

The mandatory [documentation entry point](https://docs.firefly-iii.org/) returned
HTTP 403 to this research client. Its official documentation repository was used
for the [budget management guide](https://github.com/firefly-iii/docs/blob/main/docs/docs/how-to/firefly-iii/finances/budgets.md).
That guide assigns limits to individual periods, supports accumulating budgets,
and documents limitations for overlapping monthly/yearly periods. Independent
budget comparisons must not be added together as if they were disjoint spending.
The indexed official
[rule-action reference](https://docs.firefly-iii.org/references/firefly-iii/rule-actions/)
lists category, budget, and tag assignment separately.

The [official application repository](https://github.com/firefly-iii/firefly-iii)
also documents budgets/categories/tags, piggy banks, and a broad REST API. Use the
product concepts as research; Shikin does not need Firefly's server architecture.

### Sure and Sure CLI

The [Sure repository](https://github.com/we-promise/sure) is a self-hosted application
with several clients. Its
[client guide](https://github.com/we-promise/sure/blob/main/docs/clients.md)
describes a common server, authentication, financial data, MCP read access, and
HTTP API clients. Its
[0.7.4 announcement](https://github.com/we-promise/sure/discussions/3286)
places budgets and envelope-style goals together and identifies preview status.

The separate [Sure CLI repository](https://github.com/we-promise/sure-cli) documents
an agent-first contract: JSON `{data, meta, error}`, versioned schemas, dry-run
default, and explicit `--apply`. It also distinguishes financial status,
transaction operations, imports, recurring records, and client-side planning.
These are useful interface patterns, not evidence that every write is atomic or
that every retry is idempotent.

### YNAB

The official
[inflow guide](https://support.ynab.com/en_us/how-to-add-income-and-other-inflows-H1ZNjfZJi)
distinguishes new income from inflows offsetting existing expenses. The
[credit-card refund guide](https://support.ynab.com/fr/credit-card-refunds-and-returns-H1J7qDWkj)
routes refunds to the purchase category. Shikin already retains refunds as bank
transactions and links consumption classifications to purchases; do not change
the original purchase amount to make net expenditure look correct.

The [target guide](https://support.ynab.com/how-to-use-targets-rk5kkI9ks) states that
editing a target changes prior and future instances. That is different from the
user's requirement to preserve original Shikin budget configurations.

The [official API guide](https://api.ynab.com/) documents stable response wrappers,
structured errors, numeric units, specific requests, and delta reads. These
support compact, explicit automation responses; Shikin should keep its own
centavo contract rather than adopt YNAB's numeric representation.

### Monarch

The [budget guide](https://help.monarch.com/hc/en-us/articles/360048883631-Creating-Your-Budget-in-Monarch)
describes expected-income cashflow planning, category/group organization, flex
budgets, and budget-only exclusions. Transfers and credit-card payments are
excluded from ordinary budget/cash-flow spending. A transaction excluded from a
budget can still contribute to actual spending reports.

The [rollover guide](https://help.monarch.com/hc/en-us/articles/4411119762196-Rollover-Budgets)
uses prior rollover plus current planned amount minus current actual expenditure.
It permits starting balances for irregular bills. This supports an explicit
reserve balance with no fictional monthly payment.

### Lunch Money

The [budget setup guide](https://support.lunchmoney.app/guides/budgeting/step-2-setting-up-your-budget)
separates expected and actual income and supports category rollover policies.
It explicitly warns that changing the global budgeting period deletes old
budgets. Shikin should preserve historical configurations when a current plan
changes rather than reproduce that behavior.

The [budgeting guide](https://support.lunchmoney.app/guides/budgeting/step-4-budgeting)
supports dated balance adjustments with adjustment history while retaining past
spending. It distinguishes moving existing planned money between categories from
changing a starting balance. Neither operation is a bank expense. Frozen Shikin
captures should likewise distinguish a historical correction from a new plan or
a retrospective reconstruction.

## Shikin baseline: reuse versus gaps

| Capability                               | Baseline evidence                                                                                        | Status and implementation direction                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Integer money and ledger effects         | `packages/finance-core/src/ledger.ts`, `currency.ts`, transaction services                               | Present. Preserve safe integer cents, currency identity, and status-dependent ledger effects.                                                                                                     |
| Independent scoped budgets               | `024_scoped_budgets.ts`, `report-scope.ts`, CLI `budgets-and-net-worth.ts`, `src/stores/budget-store.ts` | Present for category/account/tag inclusions and exclusions, gross cashflow or net consumption. Budgets may overlap and are not additive.                                                          |
| Historical original budget configuration | `docs/planning/SCOPED_BUDGETS.md`, budget store/readers                                                  | Missing: historical reads use today's definition; legacy `budget_periods` does not establish original configuration. Implement append-only captures and revisions.                                |
| Subcategories                            | `subcategories` table, transaction `subcategory_id`, category-rule fields                                | Storage and transaction fields exist. Baseline category management is primarily top-level; scoped reporting has no subcategory selector. Extend these paths rather than create a second taxonomy. |
| Per-transaction budget override          | Scope matches exact category/account/tag dimensions                                                      | Tags can express exclusions, but dedicated assignment precedence/override history is not established. Backlog.                                                                                    |
| Semantic classification batches          | `classification-batch.ts`, `classification-policy.ts`                                                    | Present for consumption roles and versioned custom classifications. This is distinct from bulk category/metadata correction.                                                                      |
| Gross/net expenditure and refunds        | `corrections.ts`, `dated-consumption.ts`, `scoped-reporting.ts`                                          | Present. Linked refunds retain recognition date and purchase-category semantics; unknown evidence yields incomplete totals rather than zero.                                                      |
| Split purchases                          | Shared corrections, CLI `currency-and-splits.ts`, frontend `split-service.ts`                            | Present. Preserve parent bank amount and exact allocation totals.                                                                                                                                 |
| Transfers and card payments              | CLI transaction matching, `payments.ts`, card-payment service                                            | Present with protected relationships and recovery paths. Reuse these instead of entering payments again as expenses.                                                                              |
| Source coverage and duplicate imports    | `reconciliation.ts`, `statement-fingerprint.ts`, import identity services                                | Present: independent source-period evidence, persisted import identity, staged history, duplicate detection. Missing months are not proof of zero spending.                                       |
| Reserves/sinking funds                   | `cashflow-buckets.ts`, CLI bucket tools, frontend bucket service                                         | Present as virtual allocations, with reversal/replacement evidence. Not a general automatic month-by-month budget rollover engine.                                                                |
| Annual subscriptions                     | CLI `investments-and-subscriptions.ts`, `scoped-estimates.ts`                                            | Present: monthly/yearly equivalents and separate recurring estimates. Estimates can overlap across sources and must not be totaled as verified actuals.                                           |
| Expected income                          | Receivable tools/store and recurring forecasts                                                           | Present as a separate lifecycle with amount/received/remaining. Creating a receivable does not create bank income.                                                                                |
| Partial client payments                  | CLI `receivables.ts` baseline `match-receivable`                                                         | Gap: it requires payment equal to the whole remaining amount and stores only one link. Implement multiple immutable payment links with selective reversals.                                       |
| Audit and recovery                       | Audit/context tools, shared corrections, bucket reversals                                                | Present but domain-specific. Generic undo does not cover every entity or financial dependency. Document supported recovery instead of promising universal undo.                                   |

## Financial invariants for this work

- Bank transaction ID, amount, currency, date, and original import evidence are
  not rewritten to categorize, split, reserve, or settle an expected payment.
- Internal transfers and credit-card payments must not become duplicate expenses.
- Refunds preserve both gross expenditure and the offset needed for net reporting.
- A historical capture stores what was known and configured at capture time.
  A later correction adds a revision; an old period first captured today is
  labeled retrospective, not represented as an original contemporaneous record.
- Unknown classification, FX, or statement coverage remains explicitly incomplete.
- Reserve allocations and recurring estimates remain separate from posted cashflow.
- Received installments reference posted/cleared ordinary income, stay within the
  expected receivable, and cannot reuse a bank transaction for another receipt.
- A receipt reversal removes its contribution while preserving the link and source
  snapshot. Repeating an active match does not create income or a second receipt.
- Database guards protect financial evidence across frontend, CLI, and MCP paths.

## Implemented from this review

[Budget history](../BUDGET_HISTORY.md) adds migration 025 and frozen monthly
configuration, gross and net measures, source completeness, reasoned correction
revisions, and explicitly labeled retrospective reconstructions. Existing scoped
reporting supplies the calculations; no competing ledger or fabricated historical
transactions were introduced.

[Receivable payments](../RECEIVABLE_PAYMENTS.md) adds migration 026, multiple
posted bank receipts per expected payment, explicit receipt reversal, immutable
source evidence, preserved legacy received amounts, safe replay, and guarded
previews. The frontend, CLI, and MCP share the financial planner, with database
guards covering other transaction workflows. One bank transaction spanning
several invoices remains an explicit limit.

Existing category/account/tag scopes, refunds, transfer matching, source coverage,
virtual reserve allocations, and annual subscription equivalents are reused.
Automatic budget rollover and a second category taxonomy were not added.

## Prioritized follow-up work

1. Add full subcategory management and subcategory-aware budget scopes; specify
   exact matching and parent inclusion explicitly and preserve historical scope.
2. Introduce optional automatic rollover as period allocations linked to existing
   reserves, with an explicit overspending policy and auditable adjustments.
3. Add versioned budget-assignment rules and explicit transaction overrides, with
   documented precedence and atomic reclassification previews.
4. Support one bank payment apportioned across several invoices, after defining
   allocation ownership, limits, corrections, and migration compatibility.
5. Improve unified planning coverage diagnostics and receivable schedules while
   keeping expected receipts and annual monthly equivalents separate from actuals.

## License boundary

The inspected [Actual repository](https://github.com/actualbudget/actual) declares
MIT. [Sure](https://github.com/we-promise/sure/blob/main/LICENSE) and
[Firefly III](https://github.com/firefly-iii/firefly-iii) declare AGPLv3. The separate
[Sure CLI license](https://github.com/we-promise/sure-cli/blob/main/LICENSE) is MIT.
YNAB, Monarch, and Lunch Money were studied through their public product/API
documentation; no open-source implementation license is assumed. This work uses
independently authored Shikin changes and references product behavior only.
