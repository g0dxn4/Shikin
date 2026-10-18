# Monthly budget history

## What is saved

Migration `025_budget_history` adds `budget_history_revisions`. Each record is a frozen calendar-month calculation with a versioned JSON payload. It saves the budget name, integer-centavo limit, native currency, original plan period, account/category/tag scope, gross-or-net basis, active status, definition timestamps, report cutoff/time zone, gross spending, classified net consumption, known subtotals, remaining amounts, classification and statement-coverage diagnostics, and the native allocation/FX/refund/repayment evidence used in the calculation.

The same pure `planBudgetHistory` projector in `packages/finance-core/src/budget-history.ts` serves the app and CLI/MCP. It reuses `projectScopedReport`; it does not introduce a second spending calculator. Refunds, split allocation, dated FX, transfer exclusions, and incomplete evidence retain the shared report semantics.

`get-budget-status` remains a live view of the **current** budget definition applied to selected dates. `get-budget-history` reads saved versions. These are separate concepts: viewing an old date in a live report does not establish what the limit was at that time.

## Capture, reconstruction, and correction

- **Current-month capture:** includes actuals through today's date in the requested time zone. Future posted rows are excluded. This is a capture during the month, not a claim that the month has closed.
- **First capture of a past month:** explicitly labeled `retrospective_reconstruction`. Without earlier saved evidence, Shikin cannot establish an original historical limit. Review the current definition and supply historical overrides and a reason describing the evidence.
- **Correction:** append revision N+1 with `expectedRevision: N`. The base configuration comes from the saved revision, even when the live budget was subsequently edited or deleted. Optional overrides change the historical limit, currency, name, scope, or basis. The new revision recalculates from today's recorded evidence, while revision N retains its original figures and configuration.
- **Late ledger correction:** changing or importing a transaction never silently rewrites saved history. Record a new revision to include it.
- **Uncaptured month:** remains missing. The migration does not fabricate months from current limits or from the older `budget_periods.spent` cache.

Deleting a live budget does not delete its history. The history table deliberately has no cascading foreign keys to budgets, categories, accounts, or transactions. Earlier source identifiers and captured native amounts remain available even if live records later change.

Monthly records for weekly or yearly budgets retain that original period and their month-only actuals. Their remaining amount is `null`, because one calendar month's spending cannot establish the remaining amount for a different plan interval. No automatic proration is performed.

## Financial invariants

All money in the snapshot is integer centavos. CLI/MCP accepts major-unit `correction.amount`, converts it once at the boundary, and stores `configuration.amountCentavos`. Currency changes require an explicit replacement amount; changing a currency code never reinterprets or converts the old amount implicitly.

Gross expenses and classified net consumption are saved independently. Net totals require explicit classifications and independent statement coverage. Incomplete totals and their remaining amounts are `null`, with a separate known subtotal and diagnostics. Missing coverage is not a zero balance. Gross expenses retain the existing gross-report coverage policy; their coverage diagnostics are still recorded.

History does not move cash, change bank amounts, create transactions, allocate reserves, or alter the current budget. Existing virtual cashflow buckets remain the reserve mechanism.

## Safe automation workflow

1. Read `get-budget-history` for the budget and month. Start with `expectedRevision: 0` only if the month has no saved record.
2. Call `record-budget-history` with a stable `idempotencyKey`, an explicit `reason`, and `dryRun: true`. Inspect the saved currency, scope, cutoff, gross/net completeness, and proposed revision.
3. Apply the same request and key with `dryRun: false` and **`expectedToken` equal to the preview's top-level `previewToken`**. Every new apply requires this token. Optionally also pass `expectedDataRevision` equal to the preview's `history.sourceState.dataRevision`; the app supplies both guards.
4. If an apply response is lost, retry the **exact apply request** with the same idempotency key. A successful prior receipt is returned without recalculation, extra revisions, or duplicate audit entries.
5. A new correction needs a new key and the latest `expectedRevision`. A reused key with different parameters is rejected. A changed request, source state, or resolved cutoff requires a fresh preview. Omit previous `expectedToken` and `expectedDataRevision` guards when requesting that fresh preview; retain the intended request and key if nothing committed.

The `sha256:<64 lowercase hexadecimal digits>` token binds the normalized request and key, database identity and financial data revision, resolved calendar cutoff and time zone, saved configuration, original revision chain, gross/net calculations, and complete captured evidence. Generated row IDs and execution timestamps are excluded. A preview becomes stale across midnight if its current-month cutoff changes, even without a database write. A different database with the same revision number also invalidates the token. `budget_history_preview_required` asks for an initial preview; `budget_history_stale_preview` asks for a fresh review. Neither error writes history or audit entries. Successful retries are resolved from the existing receipt before current-state or clock checks.

The new tool defaults to `dryRun: true`; recording a revision requires explicit `dryRun: false` and `expectedToken` in MCP. The generated CLI exposes `--no-dry-run --expected-token <previewToken>` to apply a reviewed capture; omitting `--no-dry-run` previews the revision. The app's Save button applies its reviewed request explicitly, and retains its exact token and key for a retry after a failed response. This is a new API; there is no unguarded legacy history-write mode.

Example tool payload for reconstructing January:

```json
{
  "budgetId": "existing-budget-id",
  "month": "2026-01",
  "expectedRevision": 0,
  "idempotencyKey": "home-2026-01-initial",
  "reason": "January limit from the original planning worksheet; statement imported through January 31",
  "correction": { "amount": 1500 },
  "timeZone": "America/Mexico_City",
  "dryRun": true
}
```

Amounts in this input use the captured budget's native currency. A currency override must be accompanied by an amount. To save after reviewing this response, repeat the payload with `dryRun: false` and add `expectedToken` copied unchanged from the returned `previewToken`.

`get-budget-history` returns the latest revision for each budget/month by default. `includeRevisions: true` shows the original and all corrections. Native allocation, statement-coverage rows, FX details, and complete diagnostics require `includeEvidence: true`. Default diagnostics show up to 10 issues and 20 unresolved classification IDs with counts and a truncation flag. Reads use bounded `limit`/`offset` pagination. With `budgetId`, `startMonth`, and `endMonth`, the result lists missing captured months across up to 120 months and labels a longer coverage request as truncated.

## App workflow

Open **Budgets → Monthly budget history**. Choose a budget and month, optionally replace the historical limit, enter the reason/evidence, and review the capture or correction. Saving preserves earlier revisions. The table includes all returned versions, the original-capture label, retrospective provenance, gross/net amounts, and reasons. Clicking a month selects it for a correction. Deleted budgets with saved history remain selectable.

The panel limits a read to 200 recent revisions and labels truncation. Select a specific budget to narrow the view; the CLI/MCP provides paginated access to all history. Scope, currency, name, and basis corrections are available through CLI/MCP in this increment.

## Migration, backup, and compatibility

The app's native and hosted startup paths apply `025` and its subsequent migrations in one transactional upgrade tail. The CLI's staged restore path uses the identical generated SQL and schema-object checks. An ordinary CLI read does not auto-migrate a database. Upgrade the app, CLI, and MCP together after creating a backup.

`025` adds one table, one index, and protective triggers, then writes its migration marker. It does not modify bank transactions, the current budget, or legacy `budget_periods`. SQLite protection rejects UPDATE, DELETE, revision gaps, cross-month revision parents, and attempts to replace existing history identities with `INSERT OR REPLACE`. The table uses `WITHOUT ROWID` with its explicit text primary key, removing hidden `rowid`/`_rowid_`/`oid` replacement paths. No history consumer depends on SQLite-generated integer row IDs. The receipt and its audit event commit together; an audit failure rolls the operation back. A saved history revision advances `app_data_state.data_revision` once.

Full SQLite backups include this table and its schema. The existing staged full-database restore workflow preserves history without issuing ordinary DELETEs against immutable records. Data exports include `budget_history_revisions`; redacted exports remove snapshot JSON, request JSON, reasons, and idempotency keys. Redacted reports are not restorable database backups.

## Deliberate limits and next increments

- Captures are explicit; there is no automatic background month closure or implicit historical backfill. A future month-close workflow must preserve the same provenance and revision controls.
- Current budget definition edits do not manufacture historical versions for previously uncaptured months.
- Weekly/yearly snapshots are month-only observations, without an inferred monthly limit.
- Corrections cannot supply arbitrary spending totals. Correct the ledger evidence first, then append a recomputed revision.
- Individual history records cannot be erased or generically undone. Correct mistakes by appending a reasoned revision; use the existing full-database restore workflow when recovery requires restoring an entire verified backup.

## Validation and design references

Synthetic SQLite integration tests in `cli/src/budget-history.sqlite.test.ts` exercise original configuration preservation after edits/deletion, late-ledger correction revisions, partial refunds, missing coverage, dry-run/read purity, audit rollback, required preview tokens, changed intent, midnight cutoff changes, same-revision database changes, exact committed retries after clock/source changes, SQLite append-only enforcement including hidden-rowid REPLACE attempts, missing-month pagination, non-monthly comparison rules, app/CLI projection parity, normalized app request keys, and the additive 024→025 migration. Export redaction has a regression in `cli/src/data-ops-export.test.ts`.

UI tests in `src/components/budgets/__tests__/budget-history-panel.test.tsx` verify unknown totals, invalidation of previews after amount/month edits, source-revision and preview-token binding on save, and retention of the exact request, token, and idempotency key when a failed save is retried.

SQLite's [isolation documentation](https://www.sqlite.org/isolation.html) explains why the existing write transaction boundary provides a coherent snapshot and serializes writers. Its [conflict documentation](https://www.sqlite.org/lang_conflict.html) explains that REPLACE can delete a conflicting row and that delete triggers depend on recursive-trigger settings; the extra insert identity guard prevents this alternate overwrite path. [WITHOUT ROWID](https://www.sqlite.org/withoutrowid.html) removes hidden row IDs and does not update `last_insert_rowid()`, which these explicit-ID adapters do not use. Lunch Money's [budget adjustment workflow](https://support.lunchmoney.app/guides/budgeting/step-4-budgeting) provides a useful product reference for explicit adjustments while preserving prior spending. Shikin's immutable version chain follows this project's explicit auditability requirements; it is not a copied implementation.
