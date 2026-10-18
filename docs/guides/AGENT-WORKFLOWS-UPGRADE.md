# Agent workflows: migration and compatibility

This unreleased change extends the v1.2.1 / schema-24 baseline. It preserves all
existing built-in CLI and full-profile MCP tool names, adds financial workflows,
and requires schema 26. Application semver is unchanged until maintainers prepare
a release; the automation catalog is versioned independently.

## Upgrade sequence

1. Export a SQLite backup through Settings → Data or the existing
   `backup-database` tool. Keep settings and filesystem notebooks separately if
   you need a complete machine setup backup.
2. Close older app, CLI, MCP, and hosted-web processes that access the database.
3. Upgrade the app and CLI/MCP bundle together. Start the app or its data server
   to run the shared migration sequence. Ordinary CLI/MCP startup validates
   readiness without migrating the live database. The advanced restore workflow
   can upgrade a staged backup copy before validation and replacement.
4. Run `shikin diagnose --deep`, inspect migration readiness, and confirm the
   expected accounts and balances before restarting automation.
5. Start MCP with the existing full default or opt into `--profile core`.
   `--read-only` requires an already initialized, compatible database.

Do not edit migration markers to bypass a failed migration. A failure preserves
the original data and reports the invalid legacy evidence or schema state to
repair. Older binaries must not write the migrated database; their schema
readiness guard should reject a future schema. To roll back the upgrade, restore
the pre-upgrade backup and use its matching prior binaries. This loses changes
made after that backup, so review and preserve any new work first.

## Migration 025: budget history

`packages/finance-core/src/025_budget_history.ts` creates
`budget_history_revisions`, append-only and revision-chain guards, and financial
data-revision tracking. No old month or original limit is inferred during
migration. Existing `budgets` and `budget_periods` remain intact.

A capture stores the budget definition, calendar window, gross and net results,
known subtotals, completeness/coverage issues, and contributing evidence. Saved
history has no cascading foreign key to a live budget, category, or transaction.
Deleting or editing those live rows cannot silently rewrite a saved month.
Corrections append a revision with a reason and expected predecessor. A past
month first captured now is explicitly a retrospective reconstruction.

Writes require the exact preview token as `expectedToken`. It binds database
identity, revision, the resolved date window, and the complete captured plan;
crossing midnight or switching databases can invalidate a review even when the
numeric revision is unchanged. An already committed identical key returns its
saved receipt before stale-state checks, so a transport retry does not recapture
the month.

History does not automatically close every month. Reading a report does not
capture history, and a missing month does not mean zero spending. Monthly
comparators for weekly/yearly plans are marked noncomparable instead of inventing
a monthly allowance. See [Budget history](../BUDGET_HISTORY.md).

## Migration 026: receivable payment evidence

`packages/finance-core/src/026_receivable_payments.ts` adds a preserved
`unattributed_received_amount` baseline and `receivable_payment_links` with
immutable source snapshots, unique active source ownership, void metadata, and
aggregate/source guards. Valid legacy single matches become explicit links;
unlinked received amounts remain unattributed evidence rather than invented bank
payments. Inconsistent legacy amounts, status, or linked financial evidence block
the migration atomically and require review.

The equation is:

`received_amount = unattributed_received_amount + sum(active linked payments)`

Matching an existing ordinary income transaction changes expected-payment
tracking only. It cannot create or duplicate posted income. Each installment
uses one complete bank transaction; allocating a single payment across several
invoices is future work. Voiding a mistaken link preserves its source snapshot
and leaves the bank transaction and account balance intact. See
[Receivable payments](../RECEIVABLE_PAYMENTS.md).

## Adapter and export compatibility

The shared migration definitions are consumed by the native app's JavaScript SQL
adapter, hosted data server, synthetic test migrator, and CLI readiness checks.
This follows the existing schema-24 ownership model; no duplicate Rust migration
implementation is introduced. Readiness validates the new columns, indexes, and
triggers as well as migration markers.

SQLite snapshots naturally include both new tables. Structured finance exports
include them too; redacted exports remove free-form snapshot/reason/request
evidence according to the export policy. A redacted export is for review, not a
full-fidelity database backup.

## MCP compatibility

| Surface                           | Behavior                                                                                                                   |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Existing tool names and CLI flags | Retained; new functionality is additive.                                                                                   |
| Full profile                      | Compatibility default, including specialist tools and enabled trusted-local plugins.                                       |
| Core profile                      | Fixed opt-in everyday subset; omitted tools require restarting with full.                                                  |
| Read-only                         | Excludes writes, unknown effects, and plugins; standalone SQLite access is also read-only.                                 |
| Tool inputs                       | MCP now rejects unknown top-level fields. Fix misspelled fields; CLI coercion remains unchanged.                           |
| Tool results                      | Compact JSON text plus matching structured content; existing domain fields remain.                                         |
| SDK / protocol                    | Existing locked SDK and negotiated 2025-11-25 behavior retained; newer protocol work is separate.                          |
| Retry behavior                    | Metadata batch receipts and history keys replay the original operation; other workflows retain their documented contracts. |

The metadata batch uses existing `audit_log` operation records for retry receipts;
it does not add a separate generic operation database. A preview binds the exact
request and source database revision. Apply saves corrections, per-row audit
evidence, and the receipt atomically. Reversing a committed metadata mistake is
a new reviewed correction; generic `undo` does not support these batch receipts.

See [MCP design](../research/MCP-DESIGN.md), the
[generated inventory](../reference/MCP-TOOL-INVENTORY.md), and
[benchmarks and validation](../benchmarks/MCP-BENCHMARKS.md).
