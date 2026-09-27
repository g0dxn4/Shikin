# Scoped budgets and reports (CLI)

Use a disposable database for trials. Replace IDs below with IDs from `shikin list-accounts` and `shikin list-categories`; amounts are major units, not cents. The `--scope` structured JSON syntax is exercised by `cli/src/cli.test.ts`. MCP accepts the same object fields without shell quoting.

```sh
# Native MXN plan, no FX rate needed for MXN transactions. A posted MXN 250
# Food expense in this month yields spentAmount 250, remaining 750.
shikin create-budget --budget-id food-month --name Food --amount 1000 --currency MXN --category-id food --json
shikin get-budget-status --budget-id food-month --as-of 2026-09-20 --time-zone America/Mexico_City --json

# Source account, not transfer destination; exclusions win.
shikin create-budget --budget-id personal --amount 1000 --currency MXN --scope '{"accountIds":["bank"],"excludeAccountIds":["joint"]}' --json
# ANY category inside the dimension, AND with account/tags. Exact IDs, no descendants.
shikin create-budget --budget-id groceries-pets --amount 1000 --currency MXN --scope '{"categoryIds":["grocery","pet"],"tags":["business"],"excludeTags":["personal"]}' --json
# Recognition refund tags (not tags inherited from a referenced purchase).
shikin get-spending-summary --basis net_consumption --currency MXN --scope '{"categoryIds":["grocery"],"tags":["business"]}' --as-of 2026-09-20 --json
# Read-only, separately reported rule/subscription equivalents; combined is null.
shikin get-spending-summary --basis recurring_estimate --currency MXN --as-of 2026-09-20 --json
# Paginate contributor parents using the contributorQuery descriptor from the summary/status.
shikin query-transactions --budget-id groceries-pets --as-of 2026-09-20 --time-zone America/Mexico_City --limit 20 --json
# Reuse the same arguments with --cursor '<nextCursor>' until nextCursor is null.
```

Scopes match exact allocation categories, source accounts, and recognition-transaction tags. Refunds reduce **net** consumption on refund date in the referenced purchase category; the refund's account and tags control selection. Gross expense and net consumption are distinct; unknown classification, FX, coverage, repayment allocation, or dangling references yield null complete converted totals with known subtotals/issues, not zero. NET requires independently verified source coverage. Estimates are not actual spending, may overlap across sources, and subscriptions cannot prove tag matching (tag-scoped subscriptions are incomplete). No recurring rows are created by these reads.

Summary's `report` contains the canonical core result: `report.totals` (nullable converted centavos), `report.known`, `nativeTotals`, issues, allocations and groups. Gross `totalExpenses`/`totalIncome`/`netSavings` are converted **major units** in the selected currency when complete; `totalsByCurrency` and `byCategory` preserve native-currency major-unit evidence and category identity/count/percentage. Native subtotals remain known-only if `nativeTotalsComplete=false`; see `nativeTotalsReason` and issues. NET retains native-centavo `totals`/`totalsByCurrency` arrays, `byCategory` (native centavos), `unresolvedIds`, `coverageComplete`, `uncoveredAccountIds`, `currencyScope` and `mainConversion` aliases; converted seven-field totals are at `report.totals`. `mainConversion` exposes converted totals, known consumption, selected conversion evidence and the recognition-date policy, not an independently recalculated FX path. The new selected currency does not make native denominations additive.

Default inclusive window ends at `asOf`; `--through period_end` explicitly includes future posted rows within the period. `--start` and `--end` must both be supplied for a custom range. Week start defaults to Sunday; supply `--week-starts-on 1` for Monday. Timezone defaults to runtime-local; set `--time-zone` plus `--as-of` for reproducibility. Stored transaction dates remain date-only. Current plan definitions apply to historical reads; cross-plan-period custom windows have null limit comparisons. Different/overlapping independent budget limits are **not additive**. Native currency stays stored; switching it requires explicit re-entry of `amount` (no auto-conversion). An explicit-ID create replay uses fresh-create defaults, not upsert preservation; replay an identical scope/basis/currency/active definition to get a no-op. Legacy plan denominations are not reinterpreted. Deleting a category retains dangling budget scope for inspection rather than widening to all categories. Deleting a budget cascades its legacy `budget_periods`; the existing generic `undo` does **not** support budgets or restore those rows. Delete responses say so; use a backup to restore period history rather than assuming an undo is possible.
